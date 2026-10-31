// reminders.mjs — Rappels de matchs + collecte des actus externes + flux RSS enrichi
// Lancé automatiquement toutes les heures par GitHub Actions (gratuit).
// Lit/écrit dans Firestore via l'API REST (règles Firestore ouvertes requises).
// La collecte des flux RSS externes se fait ICI (côté serveur : pas de CORS, pas de proxy)
// → fini les proxys gratuits en panne, et le flux public contient TOUT :
// articles IA, résultats, pronostics, actus presse filtrées, stats, classement.

const PROJECT = "lnx-data";
const API_KEY = "AIzaSyAESkXTPEvXGWK5LTd55_XTHWwexTHvtG4";
const BASE_PATH = "artifacts/default-app-id/public/data";
const SITE_URL = "https://lnx-data.netlify.app/"; // ⚠️ REMPLACE par l'URL réelle de ton app (B2-3 ou C-5)
const VAPID_PUBLIC_KEY = "BFxrHv11rQ5N21z-SP-QDKnXCSFrXsEy4ovLUmE9TO-fzanQFdOsUl4iGPkylKZ55YvlnQevC2RJe5o82ZScnFg";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const TZ = "Europe/Paris";
const MAX_EXT_ITEMS = 10;  // actus externes max dans le flux public
const MAX_FEED_ITEMS = 50; // items max dans le flux public

const API = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${BASE_PATH}`;

// Même algorithme de hash que le site (pour des ids de documents identiques)
const hashId = (s) => { let h = 5381; const str = String(s); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return "h" + h.toString(36); };
const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function fsVal(v) {
  if (v == null || "nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) { const o = {}; for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = fsVal(val); return o; }
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsVal);
  return null;
}
async function getCol(col) {
  const r = await fetch(`${API}/${col}?key=${API_KEY}&pageSize=1000`);
  if (!r.ok) throw new Error(`Firestore GET ${col}: ${r.status}`);
  const j = await r.json();
  return (j.documents || []).map((d) => {
    const o = { id: d.name.split("/").pop() };
    for (const [k, v] of Object.entries(d.fields || {})) o[k] = fsVal(v);
    return o;
  });
}
async function getDoc(col, id) {
  const r = await fetch(`${API}/${col}/${encodeURIComponent(id)}?key=${API_KEY}`);
  if (!r.ok) return null;
  const j = await r.json();
  const o = { id: j.name.split("/").pop() };
  for (const [k, v] of Object.entries(j.fields || {})) o[k] = fsVal(v);
  return o;
}
async function getSettings() { const d = await getDoc("settings", "general"); return d || {}; }
async function patchDoc(col, id, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) fields[k] = { nullValue: null };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
    else if (typeof v === "number" && Number.isInteger(v)) fields[k] = { integerValue: String(v) };
    else if (typeof v === "number") fields[k] = { doubleValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  const r = await fetch(`${API}/${col}/${encodeURIComponent(id)}?key=${API_KEY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!r.ok) throw new Error(`Firestore PATCH ${col}/${id}: ${r.status}`);
}
async function docExists(col, id) {
  const r = await fetch(`${API}/${col}/${encodeURIComponent(id)}?key=${API_KEY}`);
  return r.ok;
}
async function markSent(id) {
  await fetch(`${API}/reminders/${encodeURIComponent(id)}?key=${API_KEY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { sentAt: { timestampValue: new Date().toISOString() } } })
  });
}
async function delSub(id) {
  await fetch(`${API}/push-subs/${encodeURIComponent(id)}?key=${API_KEY}`, { method: "DELETE" });
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const heureFr = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const jourFr = (iso) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });

// ===== LECTURE DES FLUX RSS EXTERNES (RSS 2.0 + Atom, sans dépendance) =====
function decodeEnt(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
}
function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEnt(m[1]).trim() : "";
}
function parseFeed(xmlText) {
  const items = [];
  for (const it of xmlText.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
    items.push({ title: pickTag(it, "title"), link: pickTag(it, "link"), pubDate: pickTag(it, "pubDate") || pickTag(it, "dc:date"), description: pickTag(it, "description") });
  }
  for (const en of xmlText.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []) {
    let link = "";
    const lm = en.match(/<link[^>]*href="([^"]+)"/i);
    if (lm) link = lm[1];
    items.push({ title: pickTag(en, "title"), link, pubDate: pickTag(en, "updated") || pickTag(en, "published"), description: pickTag(en, "summary") || pickTag(en, "content") });
  }
  return items.filter(i => i.title);
}
// Récupère les flux, filtre les mots-clés, sauvegarde dans rss-items (mêmes docs que l'app)
async function collectExternalFeeds(feeds, keywords) {
  const fresh = []; const failed = [];
  if (!Array.isArray(feeds) || !feeds.length || !Array.isArray(keywords) || !keywords.length) return { fresh, failed };
  const cutoff = Date.now() - 30 * 24 * 3600e3;
  for (const feed of feeds) {
    if (!feed || !feed.url) continue;
    try {
      const r = await fetch(feed.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LynxBot/1.0)" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const items = parseFeed(await r.text()).slice(0, 20);
      for (const it of items) {
        const hay = normalize(it.title + " " + String(it.description || "").replace(/<[^>]*>/g, " "));
        const hits = keywords.filter(k => k && hay.includes(normalize(k)));
        if (!hits.length) continue;
        const d = it.pubDate ? new Date(it.pubDate) : new Date();
        if (isNaN(d.getTime()) || d.getTime() < cutoff) continue;
        const key = String(it.link || it.title || "").trim().toLowerCase();
        const desc = String(it.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
        const item = { title: String(it.title).slice(0, 200), link: it.link || "", description: desc, source: feed.name || "Flux externe", keywords: hits.join(", "), pubDate: d.toISOString(), fetchedAt: new Date().toISOString() };
        await patchDoc("rss-items", hashId(key), item);
        fresh.push(item);
      }
    } catch (e) { failed.push(`${feed.name || feed.url} (${String(e.message || e).slice(0, 60)})`); }
  }
  return { fresh, failed };
}

// ===== ITEMS AUTOMATIQUES (templates simples, 0 quota IA) =====
const isLynxMatch = (m) => /valence/i.test(`${m.homeTeam || ""}${m.awayTeam || ""}`);
const isFinished = (m) => m.scoreHome !== null && m.scoreHome !== undefined && m.scoreAway !== null && m.scoreAway !== undefined;
function computeActiveSeason(matches, rankings) {
  const seasons = new Set();
  for (const m of matches) if (m.season) seasons.add(m.season);
  for (const r of rankings) if (r.season) seasons.add(r.season);
  const sorted = [...seasons].sort();
  return sorted[sorted.length - 1] || "";
}
// Résultat court pour les matchs récents SANS article IA (l'article complet existe déjà → pas de doublon)
function buildResultItems(matches, newsIds, activeSeason) {
  const cutoff = Date.now() - 14 * 24 * 3600e3;
  const recent = matches.filter(m => m.season === activeSeason && isLynxMatch(m) && isFinished(m) && new Date(m.date).getTime() >= cutoff).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-10);
  const items = [];
  for (const m of recent) {
    if (newsIds.has(`auto_result_${hashId(m.id)}`)) continue;
    const isHome = /valence/i.test(m.homeTeam || "");
    const lynx = isHome ? m.scoreHome : m.scoreAway, opp = isHome ? m.scoreAway : m.scoreHome;
    const oppName = (isHome ? m.awayTeam : m.homeTeam) || "adversaire";
    const res = lynx > opp ? "Victoire" : (lynx < opp ? "Défaite" : "Match nul");
    items.push({
      title: `${res} des Lynx : Valence ${lynx} - ${opp} ${oppName}`,
      description: `Match du ${jourFr(m.date)} ${isHome ? "à domicile" : "à l'extérieur"}. Score final : Lynx de Valence ${lynx}, ${oppName} ${opp}. Classement, stats et prochain match sur le site.`,
      date: m.date, guid: `res-${hashId(m.id)}`, category: "Résultat"
    });
  }
  return items;
}
// Stats de la semaine (série en cours, meilleurs pointeurs)
function buildStatsItem(matches, roster, leaguePlayers, activeSeason) {
  const played = matches.filter(m => m.season === activeSeason && isLynxMatch(m) && isFinished(m)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const res = played.slice(-5).map(m => { const ih = /valence/i.test(m.homeTeam || ""); const my = ih ? m.scoreHome : m.scoreAway, op = ih ? m.scoreAway : m.scoreHome; return my > op ? "V" : my < op ? "D" : "N"; });
  let streak = 0, lastR = null;
  if (res.length) { lastR = res[res.length - 1]; for (let i = res.length - 1; i >= 0 && res[i] === lastR; i--) streak++; }
  const topLynx = roster.filter(p => p.season === activeSeason).map(p => ({ name: p.name, goals: Number(p.goals) || 0, pts: (Number(p.goals) || 0) + (Number(p.assists) || 0) })).sort((a, b) => b.pts - a.pts || b.goals - a.goals)[0];
  const topLeague = leaguePlayers.filter(p => p.season === activeSeason).sort((a, b) => (Number(b.pts) || 0) - (Number(a.pts) || 0))[0];
  const lines = [];
  if (streak >= 3 && lastR) lines.push(`Série en cours : ${streak} ${lastR === "V" ? "victoires" : lastR === "D" ? "défaites" : "matchs nuls"} de suite.`);
  if (topLynx && topLynx.pts > 0) lines.push(`Meilleur pointeur des Lynx : ${topLynx.name} (${topLynx.pts} pts, dont ${topLynx.goals} buts).`);
  if (topLeague && Number(topLeague.pts) > 0) lines.push(`Meilleur pointeur de la ligue : ${topLeague.name} (${topLeague.team}, ${topLeague.pts} pts).`);
  if (!lines.length) return null;
  const d = new Date();
  const week = Math.floor((d - new Date(d.getUTCFullYear(), 0, 1)) / (7 * 24 * 3600e3));
  return { title: "📊 Stats Lynx de la semaine", description: lines.join(" "), date: d.toISOString(), guid: `stats-${activeSeason}-${d.getUTCFullYear()}-w${week}`, category: "Stats" };
}
// Évolution du classement : compare la place des Lynx au run précédent
function buildRankItem(rankings, activeSeason, state) {
  const rs = rankings.filter(r => r.season === activeSeason && r.team);
  for (const poule of ["A", "B"]) {
    const rows = rs.filter(r => (r.poule || "A") === poule).sort((a, b) => (Number(b.pts) || 0) - (Number(a.pts) || 0));
    const idx = rows.findIndex(r => /valence/i.test(r.team || ""));
    if (idx >= 0) {
      const pos = idx + 1;
      const prevPos = state.lynxRankPoule === poule && state.lynxRankPos ? Number(state.lynxRankPos) : null;
      let item = null;
      if (prevPos && prevPos !== pos) {
        item = {
          title: `📈 Classement : les Lynx ${pos < prevPos ? "montent" : "reculent"} (${prevPos}ᵉ → ${pos}ᵉ place)`,
          description: `Poule ${poule} : les Lynx de Valence passent de la ${prevPos}ᵉ à la ${pos}ᵉ place (${rows[idx].pts} pts). Classement complet sur le site.`,
          date: new Date().toISOString(), guid: `rank-${activeSeason}-${poule}-${prevPos}-${pos}`, category: "Classement"
        };
      }
      return { item, state: { lynxRankPoule: poule, lynxRankPos: String(pos), updatedAt: new Date().toISOString() } };
    }
  }
  return { item: null, state };
}

// ===== FLUX RSS PUBLIC ENRICHI =====
async function buildFeed(news, extItems, autoItems) {
  const feedItems = [];
  for (const n of news) {
    if (!n.title || !n.date) continue;
    const nid = String(n.id || "");
    let cat = "Article";
    if (nid.startsWith("auto_result_")) cat = "Résultat";
    else if (nid.startsWith("auto_preview_")) cat = "Pronostic";
    feedItems.push({ title: n.title, description: String(n.content || "").replace(/[#*>]/g, "").slice(0, 400), date: n.date, guid: `lynx-${nid || hashId(n.title)}`, category: cat });
  }
  const extSorted = [...extItems].filter(i => i.pubDate).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0, MAX_EXT_ITEMS);
  for (const it of extSorted) feedItems.push({ title: `[${it.source}] ${it.title}`, description: it.description || "", date: it.pubDate, guid: `ext-${hashId(String(it.link || it.title || "").toLowerCase())}`, category: "Presse" });
  for (const it of autoItems) feedItems.push(it);
  // lastBuildDate = date du dernier item → le fichier ne change que si le contenu change (pas de commit inutile)
  const sorted = feedItems.filter(i => i.date && !isNaN(new Date(i.date))).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, MAX_FEED_ITEMS);
  const last = sorted.length ? new Date(sorted[0].date).toUTCString() : new Date(0).toUTCString();
  const items = sorted.map((n) => `  <item>
    <title>${esc(n.title)}</title>
    <description>${esc(n.description)}…</description>
    <category>${esc(n.category)}</category>
    <pubDate>${new Date(n.date).toUTCString()}</pubDate>
    <guid isPermaLink="false">${esc(n.guid)}</guid>
  </item>`).join("\n");
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Les Lynx de Valence — Actus officielles</title>
  <link>${esc(SITE_URL)}</link>
  <description>Toute l'actu des Lynx de Valence : résultats, pronostics, articles, presse, stats et classement (hockey sur glace)</description>
  <language>fr</language>
  <lastBuildDate>${last}</lastBuildDate>
${items}
</channel>
</rss>`;
  const fs = await import("node:fs/promises");
  await fs.writeFile("feed.xml", feed, "utf8");
  console.log(`feed.xml régénéré (${sorted.length} items : ${sorted.filter(i => i.category === "Presse").length} presse, ${sorted.filter(i => i.category === "Résultat").length} résultats, ${sorted.filter(i => i.category === "Classement" || i.category === "Stats").length} auto).`);
}

async function main() {
  const now = Date.now();
  const [matches, subs, news, rankings, roster, leaguePlayers, existingExt, settings] = await Promise.all([
    getCol("calendar"), getCol("push-subs"), getCol("news"), getCol("ranking"), getCol("roster"), getCol("league-players"), getCol("rss-items"), getSettings()
  ]);
  const activeSeason = computeActiveSeason(matches, rankings);
  console.log(`Saison active : ${activeSeason || "?"} — Matchs : ${matches.length}, News : ${news.length}`);

  // 1) RAPPELS : J-1 (fenêtre 24h→23h avant) et H-1 (dans l'heure précédant le match)
  const toSend = [];
  for (const m of matches) {
    if (!isLynxMatch(m) || isFinished(m) || !m.date) continue;
    const T = new Date(m.date).getTime();
    if (T <= now) continue;
    const isHome = /valence/i.test(m.homeTeam || "");
    const opp = isHome ? m.awayTeam : m.homeTeam;
    const lieu = isHome ? "à domicile" : "à l'extérieur";
    const affiche = isHome ? `Lynx de Valence vs ${opp}` : `${opp} vs Lynx de Valence`;
    if (now >= T - 24 * 3600e3 && now < T - 23 * 3600e3) {
      toSend.push({ tag: `j1_${hashId(m.id)}`, title: "🏒 C'est demain !", body: `${affiche} — ${jourFr(m.date)} à ${heureFr(m.date)}, ${lieu}. Prépare ton écharpe !` });
    }
    if (now >= T - 3600e3 && now < T) {
      toSend.push({ tag: `h1_${hashId(m.id)}`, title: "🏒 C'est l'heure !", body: `${affiche} démarre à ${heureFr(m.date)} (${lieu}). Dernière heure pour mettre ton maillot !` });
    }
  }
  console.log(`Rappels à envoyer : ${toSend.length} — Abonnés push : ${subs.length}`);
  if (toSend.length && subs.length && VAPID_PRIVATE_KEY) {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails("mailto:contact@lynx-valence.fr", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    for (const t of toSend) {
      if (await docExists("reminders", t.tag)) { console.log(`Déjà envoyé : ${t.tag}`); continue; }
      let ok = 0;
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: t.title, body: t.body, url: SITE_URL, tag: t.tag }));
          ok++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) { await delSub(s.id).catch(() => {}); } // abonnement expiré → nettoyage
        }
      }
      await markSent(t.tag);
      console.log(`Rappel ${t.tag} envoyé à ${ok} abonné(s).`);
    }
  }

  // 2) COLLECTE DES ACTUS EXTERNES (côté serveur : les proxys enflammés de l'app ne servent plus que de secours)
  const collect = await collectExternalFeeds(settings.rssFeeds, settings.rssKeywords);
  console.log(`Actus externes : ${collect.fresh.length} article(s) synchronisé(s) dans l'app.${collect.failed.length ? " Flux en échec : " + collect.failed.join(", ") : ""}`);

  // 3) ITEMS AUTO (templates sans IA)
  const newsIds = new Set(news.map(n => String(n.id || "")));
  const autoItems = [...buildResultItems(matches, newsIds, activeSeason)];
  const statsItem = buildStatsItem(matches, roster, leaguePlayers, activeSeason);
  if (statsItem) autoItems.push(statsItem);
  const rankState = await getDoc("settings", "rssState");
  const { item: rankItem, state: newRankState } = buildRankItem(rankings, activeSeason, rankState || {});
  if (rankItem) autoItems.push(rankItem);
  if (newRankState && (!rankState || rankState.lynxRankPos !== newRankState.lynxRankPos || rankState.lynxRankPoule !== newRankState.lynxRankPoule)) {
    await patchDoc("settings", "rssState", newRankState);
  }

  // 4) FLUX RSS ENRICHI (articles IA + presse filtrée + résultats + stats + classement)
  const extItems = [...existingExt, ...collect.fresh];
  await buildFeed(news, extItems, autoItems);
}

main().catch((e) => { console.error(e); process.exit(1); });
