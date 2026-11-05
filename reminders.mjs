// reminders.mjs — Rappels de matchs + collecte des actus externes + flux RSS enrichi
// Lancé automatiquement toutes les heures par GitHub Actions (gratuit).
// Lit/écrit dans Firestore via l'API REST (règles Firestore ouvertes requises).
// La collecte des flux RSS externes se fait ICI (côté serveur : pas de CORS, pas de proxy)
// → fini les proxys gratuits en panne, et le flux public contient TOUT :
// articles IA, résultats, pronostics, actus presse filtrées, stats, classement.

const PROJECT = "lnx-data";
const API_KEY = "AIzaSyAESkXTPEvXGWK5LTd55_XTHWwexTHvtG4";
const BASE_PATH = "artifacts/default-app-id/public/data";
const SITE_URL = "https://TON-SITE.netlify.app/"; // ⚠️ REMPLACE par l'URL réelle de ton app (étape B2-3)
const FEED_URL = "https://TON-PSEUDO.github.io/lynx-feed/"; // ⚠️ REMPLACE par l'URL Pages du dépôt lynx-feed (étape B2-3) — l'URL où vivent feed.xml et actus.html
const KIT_VERSION = "2.16"; // version du kit — doit correspondre à APP_VERSION du site ; visible dans les logs de l'action et dans Admin → Diagnostic (doc settings/health)
const VAPID_PUBLIC_KEY = "BFxrHv11rQ5N21z-SP-QDKnXCSFrXsEy4ovLUmE9TO-fzanQFdOsUl4iGPkylKZ55YvlnQevC2RJe5o82ZScnFg";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const TZ = "Europe/Paris";
const DEFAULT_MATCH_HOUR = 20; // heure de coup d'envoi présumée pour les matchs importés/saisis sans horaire
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
  // ⚠️ Firestore REST plafonne toute page à 300 documents — sans pagination, on ne voit que les 300 premiers
  // (le calendrier en contient 500+ : tous les matchs à venir étaient invisibles, rappels compris !)
  const out = [];
  let token = null;
  do {
    const r = await fetch(`${API}/${col}?key=${API_KEY}&pageSize=300` + (token ? `&pageToken=${encodeURIComponent(token)}` : ""));
    if (!r.ok) throw new Error(`Firestore GET ${col}: ${r.status}`);
    const j = await r.json();
    for (const d of (j.documents || [])) {
      const o = { id: d.name.split("/").pop() };
      for (const [k, v] of Object.entries(d.fields || {})) o[k] = fsVal(v);
      out.push(o);
    }
    token = j.nextPageToken || null;
  } while (token);
  return out;
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
  const mask = Object.keys(fields).map(k => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  const r = await fetch(`${API}/${col}/${encodeURIComponent(id)}?key=${API_KEY}&${mask}`, {
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
const dayKey = (iso) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); } catch (e) { return ""; } };

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
async function collectExternalFeeds(feeds, keywords, knownIds) {
  const fresh = []; const newItems = []; const failed = [];
  if (!Array.isArray(feeds) || !feeds.length || !Array.isArray(keywords) || !keywords.length) return { fresh, failed };
  const cutoff = Date.now() - 30 * 24 * 3600e3;
  for (const feed of feeds) {
    if (!feed || !feed.url) continue;
    const fk = String(feed.kws || "").split(/[;,]/).map(s => s.trim()).filter(Boolean);
    const feedKws = fk.length ? fk : keywords;
    try {
      const r = await fetch(feed.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LynxBot/1.0)" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const items = parseFeed(await r.text()).slice(0, 20);
      for (const it of items) {
        const hay = normalize(it.title + " " + String(it.description || "").replace(/<[^>]*>/g, " "));
        const hits = feedKws.filter(k => k && hay.includes(normalize(k)));
        if (!hits.length) continue;
        const d = it.pubDate ? new Date(it.pubDate) : new Date();
        if (isNaN(d.getTime()) || d.getTime() < cutoff) continue;
        const key = String(it.link || it.title || "").trim().toLowerCase();
        const desc = String(it.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
        const item = { title: String(it.title).slice(0, 200), link: it.link || "", description: desc, source: feed.name || "Flux externe", keywords: hits.join(", "), pubDate: d.toISOString(), fetchedAt: new Date().toISOString() };
        const iid = hashId(key);
        await patchDoc("rss-items", iid, item);
        fresh.push(item);
        if (!knownIds || !knownIds.has(iid)) newItems.push(item);
      }
    } catch (e) { failed.push(`${feed.name || feed.url} (${String(e.message || e).slice(0, 60)})`); }
  }
  return { fresh, newItems, failed };
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
// Stats de la semaine (bilan, forme, classement, pointeurs, gardien — 100 % données du site, zéro IA)
function buildStatsItem(matches, roster, leaguePlayers, goalies, rankings, liveReports, activeSeason) {
  const played = matches.filter(m => m.season === activeSeason && isLynxMatch(m) && isFinished(m)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const scoreOf = (m) => { const ih = /valence/i.test(m.homeTeam || ""); return ih ? [Number(m.scoreHome), Number(m.scoreAway)] : [Number(m.scoreAway), Number(m.scoreHome)]; };
  const res = played.slice(-5).map(m => { const [my, op] = scoreOf(m); return my > op ? "V" : my < op ? "D" : "N"; });
  let streak = 0, lastR = null;
  if (res.length) { lastR = res[res.length - 1]; for (let i = res.length - 1; i >= 0 && res[i] === lastR; i--) streak++; }
  const bilan = played.map(m => { const [my, op] = scoreOf(m); return my > op ? "V" : my < op ? "D" : "N"; });
  const vCount = bilan.filter(r => r === "V").length, nCount = bilan.filter(r => r === "N").length, dCount = bilan.filter(r => r === "D").length;
  const topLynx = roster.filter(p => p.season === activeSeason).map(p => ({ name: p.name, goals: Number(p.goals) || 0, pts: (Number(p.goals) || 0) + (Number(p.assists) || 0) })).sort((a, b) => b.pts - a.pts || b.goals - a.goals)[0];
  const topBut = roster.filter(p => p.season === activeSeason).map(p => ({ name: p.name, goals: Number(p.goals) || 0 })).sort((a, b) => b.goals - a.goals)[0];
  const topGk = goalies.filter(g => g.season === activeSeason && typeof g.pct === "number" && isFinite(g.pct) && (Number(g.mj) || 0) > 0).sort((a, b) => b.pct - a.pct)[0];
  const topLeague = leaguePlayers.filter(p => p.season === activeSeason).sort((a, b) => (Number(b.pts) || 0) - (Number(a.pts) || 0))[0];
  const rs = (Array.isArray(rankings) ? rankings : []).filter(r => r && (!r.season || String(r.season) === String(activeSeason)) && r.team);
  const poule = ["A", "B"].find(p => rs.some(r => (r.poule || "A") === p && /valence/i.test(r.team || "")));
  const rows = poule ? rs.filter(r => (r.poule || "A") === poule).sort((a, b) => (Number(b.pts) || 0) - (Number(a.pts) || 0)) : [];
  const idx = rows.findIndex(r => /valence/i.test(r.team || ""));
  const lastM = played[played.length - 1];
  const next = matches.filter(m => m.season === activeSeason && isLynxMatch(m) && !isFinished(m) && String(dayKey(m.date)) >= dayKey(new Date())).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  const lines = [];
  if (played.length) lines.push(`Bilan de la saison : ${vCount} victoire(s), ${nCount} nul(s), ${dCount} défaite(s) en ${played.length} match(s).`);
  if (res.length) lines.push(`Forme (5 derniers matchs) : ${res.join(" ")}.`);
  if (streak >= 2 && lastR) lines.push(`Série en cours : ${streak} ${lastR === "V" ? "victoire(s)" : lastR === "D" ? "défaite(s)" : "match(s) nul(s)"} de suite.`);
  if (lastM) { const [my, op] = scoreOf(lastM); const opp = /valence/i.test(lastM.homeTeam || "") ? lastM.awayTeam : lastM.homeTeam; lines.push(`Dernier match : ${opp} — score ${my}-${op}${my > op ? " (victoire)" : my < op ? " (défaite)" : " (nul)"}.`); }
  const rep = (Array.isArray(liveReports) ? liveReports : []).filter(r => r && r.date && r.scoreHome != null && r.scoreAway != null && new Date(r.date).getTime() > Date.now() - 7 * 24 * 3600e3).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  if (rep && (rep.homeTeam || rep.awayTeam)) {
    const ihRep = /valence/i.test(rep.homeTeam || "");
    lines.push(`Match suivi en direct : ${rep.homeTeam} ${rep.scoreHome}-${rep.scoreAway} ${rep.awayTeam}${rep.isProl ? " (après prolongation)" : ""}.`);
    if (Array.isArray(rep.perT) && rep.perT.length) { const tiers = rep.perT.map((p, i) => "T" + (i + 1) + " " + ((p && p[0]) || 0) + "-" + ((p && p[1]) || 0)).join(", ") + (Array.isArray(rep.perP) && (rep.perP[0] || rep.perP[1]) ? " (prol. " + (rep.perP[0] || 0) + "-" + (rep.perP[1] || 0) + ")" : ""); lines.push("Score par tiers : " + tiers + "."); }
    if (Number(rep.shotsH) || Number(rep.shotsA)) lines.push(`Tirs cadrés : ${rep.shotsH || 0} - ${rep.shotsA || 0}.`);
    const buteurs = (Array.isArray(rep.events) ? rep.events : []).filter(e => e && e.ty === "BUT" && e.who && e.side === (ihRep ? "H" : "A")).map(e => String(e.who).split("(")[0].trim() + (e.sit === "SUP" ? " (en sup. num.)" : e.sit === "INF" ? " (en inf. num.)" : ""));
    if (buteurs.length) lines.push(`Buteurs des Lynx : ${buteurs.join(", ")}.`);
    if (Array.isArray(rep.mvps) && rep.mvps.length) lines.push(`Joueur du match : ${rep.mvps.join(", ")}.`);
  }
  const st = specialTeamsOf(liveReports, activeSeason); // v2.16 : logique partagée avec la page récap
  if (st) {
    const stParts = [];
    if (st.ppC) stParts.push(`supériorité numérique ${st.ppG}/${st.ppC} (${st.ppPct}%)`);
    if (st.pkC) stParts.push(`infériorité ${st.pkPct}% (${st.pkGA} but(s) encaissé(s) sur ${st.pkC} pénalités)`);
    if (st.shG) stParts.push(`${st.shG} but(s) marqué(s) en infériorité`);
    lines.push(`Spécial teams (saison, sur ${st.games} match(s) suivis en direct) : ${stParts.join(", ")}.`);
  }
  if (next) lines.push(`Prochain match : ${next.homeTeam} vs ${next.awayTeam}, le ${jourFr(next.date)}.`);
  if (idx >= 0) {
    lines.push(`Classement : ${idx + 1}${idx === 0 ? "er" : "e"} de la poule ${poule} avec ${rows[idx].pts} pts.`);
    const ahead = rows[idx - 1], behind = rows[idx + 1];
    if (ahead) { const gap = Number(ahead.pts) - Number(rows[idx].pts); lines.push(`Juste devant : ${ahead.team} (${ahead.pts} pts, ${gap === 1 ? "1 point" : gap + " points"} d'écart).`); }
    if (behind) { const gap = Number(rows[idx].pts) - Number(behind.pts); lines.push(`Juste derrière : ${behind.team} (${behind.pts} pts, ${gap === 1 ? "1 point" : gap + " points"} d'écart).`); }
  }
  if (topLynx && topLynx.pts > 0) lines.push(`Meilleur pointeur des Lynx : ${topLynx.name} (${topLynx.pts} pts, dont ${topLynx.goals} buts${played.length ? `, soit ${(topLynx.pts / played.length).toFixed(2).replace(".", ",")} pt/match d'équipe joué` : ""}).`);
  if (topBut && topBut.goals > 0 && (!topLynx || topBut.name !== topLynx.name)) lines.push(`Meilleur buteur des Lynx : ${topBut.name} (${topBut.goals} buts).`);
  if (topGk && topGk.pct > 0) lines.push(`Gardien n°1 : ${topGk.name} (${topGk.pct.toFixed(2).replace(".", ",")}% d'arrêts, ${topGk.blan || 0} blanchissage(s)).`);
  if (topLeague && Number(topLeague.pts) > 0) {
    const tp = matches.filter(m => m.season === activeSeason && isFinished(m) && (String(m.homeTeam || "").toLowerCase().includes(String(topLeague.team || "").toLowerCase()) || String(m.awayTeam || "").toLowerCase().includes(String(topLeague.team || "").toLowerCase()))).length;
    lines.push(`Meilleur pointeur de la ligue : ${topLeague.name} (${topLeague.team}, ${topLeague.pts} pts${tp ? `, soit ${(Number(topLeague.pts) / tp).toFixed(2).replace(".", ",")} pt/match d'équipe` : ""}).`);
  }
  if (!lines.length) return null;
  const d = new Date();
  const week = Math.floor((d - new Date(d.getUTCFullYear(), 0, 1)) / (7 * 24 * 3600e3));
  return { title: "📊 Stats Lynx de la semaine", description: lines.join(" "), date: d.toISOString(), guid: `stats-${activeSeason}-${d.getUTCFullYear()}-w${week}`, category: "Stats" };
}
// Évolution du classement : compare la place des Lynx au run précédent
function buildRankItem(rankings, activeSeason, state) {
  const rs = (Array.isArray(rankings) ? rankings : []).filter(r => r && (!r.season || String(r.season) === String(activeSeason)) && r.team);
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
async function buildFeed(news, extItems, autoItems, ticketEvents) {
  const feedItems = [];
  for (const n of news) {
    if (!n.title || !n.date) continue;
    if (String(n.kind || "") === "stats") continue; // l'item auto « Stats de la semaine » représente déjà cet article dans le flux
    const nid = String(n.id || "");
    let cat = "Article";
    if (nid.startsWith("auto_result_")) cat = "Résultat";
    else if (nid.startsWith("auto_preview_")) cat = "Pronostic";
    const txt = String(n.content || "").replace(/[#*>]/g, "").trim();
    const gid = `lynx-${nid || hashId(n.title)}`;
    feedItems.push({ title: n.title, description: txt, link: `${FEED_URL}actus.html#${gid}`, date: n.date, guid: gid, category: cat });
  }
  const extSorted = [...extItems].filter(i => i.pubDate).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0, MAX_EXT_ITEMS);
  for (const it of extSorted) feedItems.push({ title: `[${it.source}] ${it.title}`, description: it.description || "", link: it.link || `${FEED_URL}actus.html`, date: it.pubDate, guid: `ext-${hashId(String(it.link || it.title || "").toLowerCase())}`, category: "Presse" });
  for (const it of autoItems) feedItems.push({ ...it, link: `${FEED_URL}actus.html#${it.guid}` });
  for (const it of (ticketEvents || [])) feedItems.push({ title: "🎟️ Billetterie : " + it.label, description: "Les places sont en vente sur la billetterie en ligne du club.", link: it.url, date: new Date(it.evTs || Date.now()).toISOString(), guid: "ticket-" + hashId(String(it.url).toLowerCase()), category: "Billetterie" });
  // lastBuildDate = date du dernier item → le fichier ne change que si le contenu change (pas de commit inutile)
  const sorted = feedItems.filter(i => i.date && !isNaN(new Date(i.date))).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, MAX_FEED_ITEMS);
  const last = sorted.length ? new Date(sorted[0].date).toUTCString() : new Date(0).toUTCString();
  const items = sorted.map((n) => `  <item>
    <title>${esc(n.title)}</title>
    <description>${esc(n.description).replace(/\n/g, "<br />")}</description>
    <link>${esc(n.link || SITE_URL)}</link>
    <category>${esc(n.category)}</category>
    <pubDate>${new Date(n.date).toUTCString()}</pubDate>
    <guid isPermaLink="false">${esc(n.guid)}</guid>
  </item>`).join("\n");
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Flux Lynx de Valence — généré par reminders.mjs v${KIT_VERSION} -->
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
  // Page publique des actus : tous les articles COMPLETS, avec ancre par article
  // (c'est la cible des <link> du flux → « lire l'article » fonctionne partout, Feeder compris)
  const arts = sorted.map((n) => {
    const when = new Date(n.date);
    const dateTxt = isNaN(when) ? "" : when.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `<article class="card" id="${esc(n.guid)}">
<div class="meta">${esc(n.category)} — ${esc(dateTxt)}</div>
<h2>${esc(n.title)}</h2>
<p>${esc(n.description).replace(/\n/g, "<br />")}</p>
${n.link ? `<p class="src"><a href="${esc(n.link)}">Voir en ligne ↗</a></p>` : ""}
</article>`;
  }).join("\n");
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Les Lynx de Valence — Toutes les actus</title>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px 60px;background:#0d1117;color:#e6edf3;line-height:1.55}
a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:16px 18px;margin-bottom:14px}
.meta{font-size:.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
h2{margin:0 0 10px;font-size:1.15rem}p{margin:0}
.src{margin-top:10px}
</style></head><body>
<h1>🦁 Les Lynx de Valence — Toutes les actus</h1>
<p style="color:#8b949e;font-size:.9rem">Page générée automatiquement, mise à jour toutes les heures. <a href="${esc(SITE_URL)}">Ouvrir le site ↗</a></p>
${arts}
</body></html>`;
  await fs.writeFile("actus.html", html, "utf8");
  console.log(`actus.html régénéré (${sorted.length} articles).`);
  return sorted.length;
}

// v2.16 : spécial teams de la saison — logique partagée entre l'article stats hebdo et la page récap
function specialTeamsOf(liveReports, activeSeason) {
  const all = (Array.isArray(liveReports) ? liveReports : []).filter(r => r && Array.isArray(r.events) && (!r.season || String(r.season) === String(activeSeason)));
  let ppC = 0, ppG = 0, pkC = 0, pkGA = 0, shG = 0;
  all.forEach(r => {
    const lx = /valence/i.test(r.homeTeam || "") ? "H" : /valence/i.test(r.awayTeam || "") ? "A" : null;
    if (!lx) return;
    r.events.forEach(e => {
      if (!e || !e.ty) return;
      if (e.ty === "SANCTION") { if (e.side === lx) pkC++; else ppC++; }
      else if (e.ty === "BUT") {
        if (e.side === lx && e.sit === "SUP") ppG++;
        else if (e.side !== lx && e.sit === "SUP") pkGA++;
        if (e.side === lx && e.sit === "INF") shG++;
      }
    });
  });
  if (!ppC && !pkC) return null;
  return { ppC, ppG, pkC, pkGA, shG, games: all.length, ppPct: ppC ? Math.round(ppG * 1000 / ppC) / 10 : null, pkPct: pkC ? Math.round((1 - pkGA / pkC) * 1000) / 10 : null };
}

// v2.16 : classement calculé en direct depuis les résultats de la saison — utilisé quand la collection
// ranking n'est pas importée (le site fait pareil : computeLiveRanking). Mêmes règles FFHG :
// victoire 3 pts, victoire en prolongation 2, défaite en prolongation 1, nul 1.
// Seuls les matchs de type « Saison » comptent ; la poule est lue sur chaque match.
function liveRankingOf(matches, activeSeason) {
  const teams = {};
  (Array.isArray(matches) ? matches : []).forEach(m => {
    if (!m || m.season !== activeSeason || !isFinished(m) || (m.type && String(m.type) !== "Saison")) return;
    const hs = Number(m.scoreHome), as = Number(m.scoreAway);
    if (!isFinite(hs) || !isFinite(as) || !m.homeTeam || !m.awayTeam) return;
    const poule = String(m.poule || "").toUpperCase();
    const add = (name) => { const k = normalize(name); if (!teams[k]) teams[k] = { team: name, pts: 0, mj: 0, v: 0, n: 0, d: 0, vp: 0, dp: 0, bp: 0, bc: 0, poule: poule }; return teams[k]; };
    const h = add(m.homeTeam), a = add(m.awayTeam);
    const prol = !!m.isProl;
    h.mj++; a.mj++;
    h.bp += hs; h.bc += as; a.bp += as; a.bc += hs;
    const pt = (sf, sa) => sf > sa ? (prol ? 2 : 3) : sf < sa ? (prol ? 1 : 0) : 1;
    h.pts += pt(hs, as); a.pts += pt(as, hs);
    if (hs > as) { if (prol) { h.vp++; a.dp++; } else { h.v++; a.d++; } }
    else if (as > hs) { if (prol) { a.vp++; h.dp++; } else { a.v++; h.d++; } }
    else { h.n++; a.n++; }
  });
  return Object.values(teams);
}

// v2.16 : MOTEUR DE PRÉDICTION — porté de l'app (Poisson + forme + dom/ext, mêmes poids) → mêmes pronostics que l'onglet Prévisions
function matchPoints(scoreFor, scoreAgainst, isProl) {
  if (scoreFor > scoreAgainst) return isProl ? 2 : 3;
  if (scoreFor < scoreAgainst) return isProl ? 1 : 0;
  return 1;
}
function buildPoolModel(matches) {
  const st = {};
  const lastTs = matches.length ? Math.max(...matches.map(m => new Date(m.date).getTime() || 0)) : 0;
  matches.forEach(m => {
    const ageW = Math.max(0, (lastTs - (new Date(m.date).getTime() || lastTs)) / (7 * 24 * 3600e3));
    const w = Math.pow(0.92, ageW);
    const acc = (team, gf, ga, isHome) => {
      const k = normalize(team);
      if (!st[k]) st[k] = { team: team, homeGF: 0, homeGA: 0, homeM: 0, homeN: 0, awayGF: 0, awayGA: 0, awayM: 0, awayN: 0, form: [], lastTs: 0 };
      const s = st[k];
      if (isHome) { s.homeGF += w * gf; s.homeGA += w * ga; s.homeM += w; s.homeN++; } else { s.awayGF += w * gf; s.awayGA += w * ga; s.awayM += w; s.awayN++; }
      const ts = new Date(m.date).getTime() || 0;
      if (ts > (s.lastTs || 0)) s.lastTs = ts;
      s.form.push(matchPoints(isHome ? gf : ga, isHome ? ga : gf, m.isProl));
    };
    acc(m.homeTeam, Number(m.scoreHome) || 0, Number(m.scoreAway) || 0, true);
    acc(m.awayTeam, Number(m.scoreAway) || 0, Number(m.scoreHome) || 0, false);
  });
  const n = matches.length || 1;
  return { stats: st, nowTs: lastTs, avgHomeGF: matches.reduce((s, m) => s + (Number(m.scoreHome) || 0), 0) / n, avgAwayGF: matches.reduce((s, m) => s + (Number(m.scoreAway) || 0), 0) / n };
}
function predictMatch(model, homeTeam, awayTeam, matchTs) {
  const st = model.stats;
  const h = st[normalize(homeTeam)], a = st[normalize(awayTeam)];
  const hAtt = h && h.homeM ? h.homeGF / h.homeM : model.avgHomeGF;
  const hDef = h && h.homeM ? h.homeGA / h.homeM : model.avgAwayGF;
  const aAtt = a && a.awayM ? a.awayGF / a.awayM : model.avgAwayGF;
  const aDef = a && a.awayM ? a.awayGA / a.awayM : model.avgHomeGF;
  const formFactor = (s) => { const f = s ? s.form.slice(-5) : []; return f.length ? f.reduce((x, y) => x + y, 0) / (f.length * 3) : 0.5; };
  const fh = formFactor(h), fa = formFactor(a);
  const lamH0 = Math.max(0.15, ((hAtt + aDef) / 2) * (0.85 + 0.3 * fh));
  const lamA0 = Math.max(0.15, ((aAtt + hDef) / 2) * (0.85 + 0.3 * fa));
  const lamH = (matchTs && h && h.lastTs && (matchTs - h.lastTs) < 30 * 3600e3) ? lamH0 * 0.9 : lamH0;
  const lamA = (matchTs && a && a.lastTs && (matchTs - a.lastTs) < 30 * 3600e3) ? lamA0 * 0.9 : lamA0;
  const factorial = (x) => { let r = 1; for (let i = 2; i <= x; i++) r *= i; return r; };
  const poissonPmf = (lambda, k) => Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  let pH = 0, pA = 0, pT = 0, best = { p: 0, s: [0, 0] };
  for (let i = 0; i <= 9; i++) for (let j = 0; j <= 9; j++) {
    const p = poissonPmf(lamH, i) * poissonPmf(lamA, j);
    if (i > j) pH += p; else if (j > i) pA += p; else pT += p;
    if (p > best.p) best = { p: p, s: [i, j] };
  }
  const otHc = Math.min(0.75, Math.max(0.25, 0.5 + (fh - fa) * 0.3));
  return { pHomeWin: pH + pT * otHc, pAwayWin: pA + pT * (1 - otHc), pHomeReg: pH, pAwayReg: pA, pOtHome: otHc, pT: pT, expScore: best.s };
}

// v2.16 : PAGE RÉCAP PUBLIQUE (index.html à la racine du dépôt lynx-feed → servie par GitHub Pages)
// Vitrine simple : une seule page en défilement vertical, aucun onglet, aucune IA — uniquement des données vérifiées du site.
async function buildHomePage(matches, roster, leaguePlayers, goalies, rankings, liveReports, news, ticketEvents, activeSeason) {
  const fs = await import("node:fs/promises"); // ⚠️ obligatoire : fs est importé localement dans chaque fonction qui écrit un fichier (comme buildFeed/buildStaticNewsHtml)
  const played = matches.filter(m => m.season === activeSeason && isLynxMatch(m) && isFinished(m)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const upcoming = matches.filter(m => m.season === activeSeason && isLynxMatch(m) && !isFinished(m) && String(dayKey(m.date)) >= dayKey(new Date())).sort((a, b) => new Date(a.date) - new Date(b.date));
  const next = upcoming[0] || null;
  const scoreOf = (m) => { const ih = /valence/i.test(m.homeTeam || ""); return ih ? [Number(m.scoreHome), Number(m.scoreAway)] : [Number(m.scoreAway), Number(m.scoreHome)]; };
  const lastM = played[played.length - 1] || null;
  const forme = played.slice(-5).map(m => { const [my, op] = scoreOf(m); return { r: my > op ? "V" : my < op ? "D" : "N", my, op, opp: /valence/i.test(m.homeTeam || "") ? m.awayTeam : m.homeTeam }; });
  const bilan = { v: 0, n: 0, d: 0 };
  played.forEach(m => { const [my, op] = scoreOf(m); if (my > op) bilan.v++; else if (my < op) bilan.d++; else bilan.n++; });
  const rs = (Array.isArray(rankings) ? rankings : []).filter(r => r && (!r.season || String(r.season) === String(activeSeason)) && r.team);
  const poule = ["A", "B"].find(p => rs.some(r => (r.poule || "A") === p && /valence/i.test(r.team || "")));
  const rrows = poule ? rs.filter(r => (r.poule || "A") === poule).sort((a, b) => (Number(b.pts) || 0) - (Number(a.pts) || 0)) : [];
  const idx = rrows.findIndex(r => /valence/i.test(r.team || ""));
  const st = specialTeamsOf(liveReports, activeSeason);
  const topPts = roster.filter(p => p.season === activeSeason).map(p => ({ name: p.name, g: Number(p.goals) || 0, a: Number(p.assists) || 0 })).map(p => ({ name: p.name, g: p.g, a: p.a, pts: p.g + p.a })).filter(p => p.pts > 0).sort((a, b) => b.pts - a.pts || b.g - a.g).slice(0, 5);
  const topGk = goalies.filter(g => g.season === activeSeason && typeof g.pct === "number" && isFinite(g.pct) && (Number(g.mj) || 0) > 0).sort((a, b) => b.pct - a.pct)[0] || null;
  // Adversaire du prochain match : surbrillance classement, forme adverse, top ligue, face-à-face
  const isHomeNext = next ? /valence/i.test(next.homeTeam || "") : false;
  const oppName = next ? (isHomeNext ? next.awayTeam : next.homeTeam) : "";
  const sameName = (a, b) => !!a && !!b && normalize(a) === normalize(b);
  const teamSeason = (team) => matches.filter(m => m.season === activeSeason && isFinished(m) && (!m.type || String(m.type) === "Saison") && (sameName(m.homeTeam, team) || sameName(m.awayTeam, team))).sort((a, b) => new Date(a.date) - new Date(b.date));
  const teamFormOf = (team) => teamSeason(team).slice(-5).map(m => { const ih = sameName(m.homeTeam, team); const my = ih ? Number(m.scoreHome) : Number(m.scoreAway); const op = ih ? Number(m.scoreAway) : Number(m.scoreHome); return { r: my > op ? "V" : my < op ? "D" : "N", my, op, opp: ih ? m.awayTeam : m.homeTeam }; });
  const lynxRow = idx >= 0 ? rrows[idx] : null;
  const oppRow = oppName ? (rrows.find(r => sameName(r.team, oppName)) || null) : null;
  const oppIdx = oppRow ? rrows.indexOf(oppRow) : -1;
  const oppForme = oppName ? teamFormOf(oppName) : [];
  const oppBilan = { v: 0, n: 0, d: 0 };
  (oppName ? teamSeason(oppName) : []).forEach(m => { const ih = sameName(m.homeTeam, oppName); const my = ih ? Number(m.scoreHome) : Number(m.scoreAway); const op = ih ? Number(m.scoreAway) : Number(m.scoreHome); if (my > op) oppBilan.v++; else if (my < op) oppBilan.d++; else oppBilan.n++; });
  const lpTop = (Array.isArray(leaguePlayers) ? leaguePlayers : []).filter(p => p && p.name && (!p.season || String(p.season) === String(activeSeason))).map(p => ({ name: p.name, team: p.team || "", pts: Number(p.pts) || 0, g: Number(p.goals) || 0, a: Number(p.assists) || 0 })).sort((a, b) => b.pts - a.pts || b.g - a.g).slice(0, 10);
  const lpCount = (team) => lpTop.filter(p => sameName(p.team, team)).length;
  // Tableau face-à-face : vert = meilleure stat de la ligne, rouge = la moins bonne
  const duelRows = [];
  if (lynxRow && oppRow) {
    const nOf = (v) => { const x = Number(v); return isFinite(x) ? x : null; };
    const ratioOf = (r) => { const bp = nOf(r.bp), bc = nOf(r.bc); return (bp !== null && bc !== null && bc > 0) ? bp / bc : null; };
    const f2 = (v) => v.toFixed(2).replace(".", ",");
    const addDuel = (label, lv, ov, lowerBetter, fmt) => {
      const l = nOf(lv), o = nOf(ov);
      if (l === null && o === null) return;
      const disp = (v) => (v === null ? "—" : (fmt ? fmt(v) : String(v)));
      let lc = "text-gray-300", oc = "text-gray-300";
      if (l !== null && o !== null && l !== o) {
        const lWin = lowerBetter ? l < o : l > o;
        lc = lWin ? "text-green-400 bg-green-500/10 font-black" : "text-red-400 bg-red-500/10";
        oc = lWin ? "text-red-400 bg-red-500/10" : "text-green-400 bg-green-500/10 font-black";
      }
      duelRows.push({ label, lc, oc, l: disp(l), o: disp(o) });
    };
    addDuel("Rang au classement", idx + 1, oppIdx + 1, true);
    addDuel("Points au classement", lynxRow.pts, oppRow.pts, false);
    addDuel("Buts marqués", lynxRow.bp, oppRow.bp, false);
    addDuel("Buts encaissés", lynxRow.bc, oppRow.bc, true);
    addDuel("Ratio buts marqués / encaissés", ratioOf(lynxRow), ratioOf(oppRow), false, f2);
    addDuel("Buts marqués par match", (lynxRow.mj ? lynxRow.bp / lynxRow.mj : null), (oppRow.mj ? oppRow.bp / oppRow.mj : null), false, f2);
    addDuel("Victoires sur les 5 derniers matchs", forme.filter(f => f.r === "V").length, oppForme.filter(f => f.r === "V").length, false);
    addDuel("Victoires (saison)", (lynxRow.v || 0) + (lynxRow.vp || 0), (oppRow.v || 0) + (oppRow.vp || 0), false);
    addDuel("Joueurs dans le top pointeurs de la ligue", lpCount(lynxRow.team), lpCount(oppName), false);
  }
  // Pronostics du modèle (mêmes poids que l'app) : prochain match + toute sa journée
  const modelMatches = matches.filter(m => m.season === activeSeason && isFinished(m) && (!m.type || String(m.type) === "Saison") && m.homeTeam && m.awayTeam && String(m.poule || "").toUpperCase() === (poule || "B"));
  const poolModel = modelMatches.length >= 3 ? buildPoolModel(modelMatches) : null;
  const nextPred2 = (next && poolModel) ? predictMatch(poolModel, next.homeTeam, next.awayTeam, new Date(next.date).getTime() || 0) : null;
  const lynxPWin = nextPred2 ? (isHomeNext ? nextPred2.pHomeWin : nextPred2.pAwayWin) : null;
  const lynxPct = lynxPWin != null ? Math.round(lynxPWin * 100) : null;
  const heroScore = nextPred2 ? (isHomeNext ? nextPred2.expScore[0] + "-" + nextPred2.expScore[1] : nextPred2.expScore[1] + "-" + nextPred2.expScore[0]) : "";
  const otRisk = (nextPred2 && nextPred2.pT >= 0.18) ? " · risque de prolongation " + String(Math.round(nextPred2.pT * 100)) + " %" : "";
  const nextJ = next && next.journee ? String(next.journee) : "";
  const journeeList = nextJ ? matches.filter(m => m.season === activeSeason && String(m.journee || "") === nextJ && (!m.type || String(m.type) === "Saison") && m.homeTeam && m.awayTeam && String(m.poule || "").toUpperCase() === (poule || "B")).sort((a, b) => new Date(a.date) - new Date(b.date)) : [];
  const journeePreds = journeeList.map(m => {
    const done = isFinished(m);
    const p = (!done && poolModel) ? predictMatch(poolModel, m.homeTeam, m.awayTeam, new Date(m.date).getTime() || 0) : null;
    if (done) return { m: m, done: done, p: null, hs: Number(m.scoreHome), as: Number(m.scoreAway) };
    if (p) return { m: m, done: done, p: p, hs: p.expScore[0], as: p.expScore[1] };
    return { m: m, done: done, p: null, hs: null, as: null };
  });
  const posMap = new Map(rrows.map((r, i) => [normalize(r.team), i + 1]));
  // Pronostics du site, vérifiés contre les vrais résultats (mêmes règles que l'app, sans rejouer le passé)
  const preds = [];
  (Array.isArray(news) ? news : []).forEach(n => {
    if (!n || String(n.kind || "") !== "preview" || !n.matchId || !n.pred) return;
    const m = matches.find(x => String(x.id || "") === String(n.matchId));
    if (!m || !isFinished(m)) return;
    const ih = /valence/i.test(m.homeTeam || "");
    const my = ih ? Number(m.scoreHome) : Number(m.scoreAway);
    const op = ih ? Number(m.scoreAway) : Number(m.scoreHome);
    const pWin = Number(n.pred.pWin);
    if (!isFinite(pWin)) return;
    preds.push({ hit: (pWin >= 50) === (my > op), pWin, exp: n.pred.expScore || "", my, op, opp: ih ? m.awayTeam : m.homeTeam, date: n.date || "" });
  });
  preds.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const pOk = preds.filter(p => p.hit).length;
  const pPct = preds.length ? Math.round(pOk * 100 / preds.length) : null;
  const nextPred = next ? ((Array.isArray(news) ? news : []).find(n => n && String(n.kind || "") === "preview" && String(n.matchId || "") === String(next.id || "") && n.pred) || null) : null;
  const tkts = (Array.isArray(ticketEvents) ? ticketEvents : []).filter(t => t && t.url);
  const heure = (iso) => { const h = new Date(iso).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }); return h === "00:00" ? "~20h00" : h; };
  const card = "bg-gray-900/80 border border-gray-800 rounded-2xl p-5";
  const secH = (icon, txt) => `<h2 class="font-black text-xl mb-3"><span class="text-lynx-red">${icon}</span> ${txt}</h2>`;
  let hero = "";
  if (next) {
    const isHome = /valence/i.test(next.homeTeam || "");
    const opp = isHome ? next.awayTeam : next.homeTeam;
    const tktNext = tkts.find(t => String(t.label || "").toLowerCase().includes(String(opp || "").toLowerCase())) || (tkts.length === 1 ? tkts[0] : null);
    hero = `<section class="${card} md:col-span-2 scroll-mt-20 bg-gradient-to-br from-gray-900 to-lynx-red/20 border-lynx-red/40" id="match">
      <p class="text-xs uppercase tracking-widest text-gray-400 font-bold mb-2">Prochain match${activeSeason ? " — saison " + esc(activeSeason) : ""}</p>
      <p class="text-2xl md:text-3xl font-black">🦁 Lynx de Valence <span class="text-lynx-red">vs</span> ${esc(opp)}</p>
      <p class="mt-2 text-gray-300">${esc(jourFr(next.date))} · <strong>${heure(next.date)}</strong> · ${isHome ? "domicile" : "extérieur"}${(next.patinoire || next.venue) ? " · " + esc(next.patinoire || next.venue) : ""}</p>
      ${(nextPred2 || nextPred) ? `<p class="mt-2 text-sm inline-block bg-gray-950/60 rounded-full px-3 py-1">🔮 ${nextPred2 ? `Le modèle du site donne <strong>${String(lynxPct)} %</strong> de victoire aux Lynx (score probable <strong>${heroScore}</strong>)${otRisk}` : `Le site prédit <strong>${esc(String(nextPred.pred.pWin))} %</strong> de victoire${nextPred.pred.expScore ? " (score probable " + esc(String(nextPred.pred.expScore)) + ")" : ""}`}</p>` : ""}
      <div class="mt-4 flex flex-wrap gap-3">
        <a href="${esc(SITE_URL)}" class="bg-lynx-red hover:opacity-90 text-white font-bold px-4 py-2 rounded-xl text-sm">Ouvrir le site</a>
        ${tktNext ? `<a href="${esc(tktNext.url)}" class="border border-gray-600 hover:border-white px-4 py-2 rounded-xl text-sm font-semibold">🎟️ Réserver mes places</a>` : ""}
        <a href="${esc(FEED_URL)}actus.html" class="border border-gray-600 hover:border-white px-4 py-2 rounded-xl text-sm font-semibold">Toutes les actus</a>
      </div>
    </section>`;
  }
  let formeSec = "";
  if (lastM || forme.length) {
    formeSec = `<section class="${card} scroll-mt-20" id="forme">
      ${secH("📉", "Forme")}
      ${lastM ? `<p class="mb-3 text-lg font-bold">Dernier match : ${esc(lastM.homeTeam)} <span class="text-lynx-red">${esc(String(lastM.scoreHome))}-${esc(String(lastM.scoreAway))}</span> ${esc(lastM.awayTeam)}${lastM.isProl ? ' <span class="text-xs text-gray-400">(après prolongation)</span>' : ""}</p>` : ""}
      ${forme.length ? `<div class="flex flex-wrap gap-2 mb-3">${forme.map(f => `<span class="inline-flex items-center justify-center w-8 h-8 rounded-lg font-black text-white text-sm" style="background:${f.r === "V" ? "#10b981" : f.r === "D" ? "#ef4444" : "#9ca3af"}" title="${esc(f.opp)} ${f.my}-${f.op}">${f.r}</span>`).join("")}</div>` : ""}
      ${played.length ? `<p class="text-sm text-gray-400">Bilan : <strong class="text-gray-100">${bilan.v} V · ${bilan.n} N · ${bilan.d} D</strong> en ${played.length} match(s)</p>` : ""}
    </section>`;
  }
  let advSec = "";
  if (next && oppName) {
    advSec = `<section class="${card} scroll-mt-20" id="adversaire">
      ${secH("🔵", "Prochain adversaire — " + esc(oppName))}
      ${oppRow ? `<p class="mb-2 text-lg font-bold">${oppIdx + 1}${oppIdx === 0 ? "er" : "e"} de la poule ${esc(poule || "")} · ${esc(String(Number(oppRow.pts) || 0))} pts</p>` : ""}
      ${oppForme.length ? `<div class="flex flex-wrap gap-2 mb-3">${oppForme.map(f => `<span class="inline-flex items-center justify-center w-8 h-8 rounded-lg font-black text-white text-sm" style="background:${f.r === "V" ? "#10b981" : f.r === "D" ? "#ef4444" : "#9ca3af"}" title="${esc(f.opp)} ${f.my}-${f.op}">${f.r}</span>`).join("")}</div>` : ""}
      ${oppForme.length ? `<p class="text-sm text-gray-400">Bilan ${esc(oppName)} : <strong class="text-gray-100">${oppBilan.v} V · ${oppBilan.n} N · ${oppBilan.d} D</strong> en ${oppBilan.v + oppBilan.n + oppBilan.d} match(s)</p>` : ""}
      <p class="mt-2 text-sm text-gray-400">${isHomeNext ? "Les Lynx reçoivent " + esc(oppName) : "Les Lynx se déplacent chez " + esc(oppName)} — ${esc(jourFr(next.date))} à ${heure(next.date)}.</p>
    </section>`;
  }
  let rankSec = "";
  if (rrows.length && idx >= 0) {
    rankSec = `<section class="${card} scroll-mt-20" id="classement">
      ${secH("🏆", "Classement" + (poule ? " — poule " + esc(poule) : ""))}
      <table class="w-full text-sm"><thead><tr class="text-xs uppercase text-gray-500"><th class="px-2 py-1 text-left">#</th><th class="px-2 py-1 text-left">Équipe</th><th class="px-2 py-1 text-right">Pts</th><th class="px-2 py-1 text-right">Diff</th></tr></thead><tbody>
      ${rrows.map((r, i) => { const lx = /valence/i.test(r.team || ""); const isOpp = !!oppName && sameName(r.team, oppName); const bp = Number(r.bp), bc = Number(r.bc); const diff = isFinite(bp) && isFinite(bc) ? bp - bc : null; return `<tr class="${lx ? "bg-lynx-red/10" : isOpp ? "bg-blue-500/10" : ""} border-t border-gray-800"><td class="px-2 py-1.5 text-gray-500">${i + 1}${i !== idx && Math.abs(i - idx) <= 2 ? " ⚔️" : ""}</td><td class="px-2 py-1.5 font-semibold ${lx ? "text-lynx-red" : isOpp ? "text-blue-400" : ""}">${esc(r.team)}${lx ? " 🦁" : isOpp ? " 🔵" : ""}</td><td class="px-2 py-1.5 text-right font-black">${esc(String(Number(r.pts) || 0))}</td><td class="px-2 py-1.5 text-right text-gray-400">${diff === null ? "—" : (diff > 0 ? "+" : "") + diff}</td></tr>`; }).join("")}
      </tbody></table>
      <p class="mt-2 text-xs text-gray-500">🦁 Lynx de Valence${oppName ? " · 🔵 " + esc(oppName) + " (prochain adversaire)" : ""} · ⚔️ concurrents directs</p>
    </section>`;
  }
  let statsSec = "";
  if (topPts.length || st || topGk) {
    statsSec = `<section class="${card} scroll-mt-20" id="stats">
      ${secH("⚡", "Stats Lynx")}
      ${topPts.length ? `<p class="text-xs uppercase text-gray-500 font-bold mb-1">Top pointeurs${played.length ? " (ratio pts / match d'équipe)" : ""}</p>` + topPts.map(p => `<div class="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0"><span class="font-semibold">${esc(p.name)}</span><span class="text-sm text-gray-400">${p.pts} pts <span class="text-gray-500">(${p.g} B + ${p.a} A)</span>${played.length ? ` · <strong class="text-lynx-red">${(p.pts / played.length).toFixed(2).replace(".", ",")}/match</strong>` : ""}</span></div>`).join("") : ""}
      ${st ? `<p class="mt-3 text-sm">Spécial teams (matchs suivis en direct) : sup. num. <strong>${st.ppPct == null ? "—" : st.ppPct + "%"}</strong> (${st.ppG}/${st.ppC}) · inf. num. <strong>${st.pkPct == null ? "—" : st.pkPct + "%"}</strong> · <strong>${st.shG}</strong> but(s) en infériorité</p>` : ""}
      ${topGk ? `<p class="mt-2 text-sm text-gray-400">Gardien n°1 : <strong class="text-gray-100">${esc(topGk.name)}</strong> — ${esc(topGk.pct.toFixed(2).replace(".", ","))} % d'arrêts, ${Number(topGk.blan) || 0} blanchissage(s)</p>` : ""}
    </section>`;
  }
  let joueursSec = "";
  if (lpTop.length) {
    joueursSec = `<section class="${card} scroll-mt-20" id="joueurs">
      ${secH("🥇", "Top pointeurs de la ligue")}
      ${lpTop.map((p, i) => { const lx = /valence/i.test(p.team || ""); const isOpp = !!oppName && sameName(p.team, oppName); return `<div class="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0${lx ? " bg-lynx-red/10 rounded-lg px-2" : isOpp ? " bg-blue-500/10 rounded-lg px-2" : ""}"><span class="font-semibold">${i + 1}. ${esc(p.name)} <span class="text-xs ${lx ? "text-lynx-red" : isOpp ? "text-blue-400" : "text-gray-500"}">${esc(p.team)}</span></span><span class="text-sm text-gray-400">${p.pts} pts <span class="text-gray-500">(${p.g} B + ${p.a} A)</span></span></div>`; }).join("")}
    </section>`;
  }
  let pronoSec = "";
  if (preds.length || nextPred2 || nextPred) {
    pronoSec = `<section class="${card} scroll-mt-20" id="pronos">
      ${secH("🔮", "Pronostics du site")}
      ${preds.length ? `<p class="mb-3 text-sm">Bilan public : <strong class="text-gray-100">${pOk} pronostic(s) vérifié(s) sur ${preds.length}</strong>${pPct != null ? ` (${pPct} % de réussite)` : ""}</p>
      <div class="space-y-2">${preds.slice(0, 3).map(p => `<div class="text-sm flex justify-between gap-2 border-b border-gray-800 pb-1.5"><span>${p.hit ? "✅" : "❌"} vs ${esc(p.opp)} <span class="text-gray-500">— prédit ${esc(String(p.pWin))} %${p.exp ? " (" + esc(p.exp) + ")" : ""}</span></span><strong>${p.my}-${p.op}</strong></div>`).join("")}</div>` : `${nextPred2 ? `<p class="mb-3 text-sm">Pronostic en cours : <strong class="text-gray-100">${String(lynxPct)} %</strong> de victoire pour les Lynx${heroScore ? " (score probable " + heroScore + ")" : ""} — il sera vérifié ici après le match.</p>` : ""}<p class="text-sm text-gray-400">Les pronostics de l'app seront vérifiés ici au fil des résultats.</p>`}
    </section>`;
  }
  let duelSec = "";
  if (duelRows.length) {
    duelSec = `<section class="${card} md:col-span-2 scroll-mt-20" id="duel">
      ${secH("⚔️", "Face-à-face — Lynx vs " + esc(oppName))}
      <table class="w-full text-sm"><thead><tr class="text-xs uppercase text-gray-500"><th class="px-2 py-1 text-left">Statistique</th><th class="px-2 py-1 text-right">🦁 Lynx</th><th class="px-2 py-1 text-right">${esc(oppName)} 🔵</th></tr></thead><tbody>
      ${duelRows.map(r => `<tr class="border-t border-gray-800"><td class="px-2 py-1.5">${esc(r.label)}</td><td class="px-2 py-1.5 text-right ${r.lc}">${r.l}</td><td class="px-2 py-1.5 text-right ${r.oc}">${r.o}</td></tr>`).join("")}
      </tbody></table>
      <p class="mt-2 text-xs text-gray-500">Vert = meilleure statistique de la ligne, rouge = la moins bonne · « top pointeurs » = joueurs du club dans le top 10 de la ligue.</p>
    </section>`;
  }
  let journeeSec = "";
  if (next && journeePreds.length && rrows.length && idx >= 0) {
    const deltaMap = {};
    const addDelta = (team, pts, gFor, gAg) => { const k = normalize(team); if (!deltaMap[k]) deltaMap[k] = { pts: 0, bp: 0, bc: 0 }; deltaMap[k].pts += pts; deltaMap[k].bp += gFor; deltaMap[k].bc += gAg; };
    journeePreds.forEach(j => {
      if (j.done || j.hs === null) return;
      const isLynxM = /valence/i.test(j.m.homeTeam || "") || /valence/i.test(j.m.awayTeam || "");
      if (isLynxM) return;
      if (j.hs > j.as) addDelta(j.m.homeTeam, 3, j.hs, j.as);
      else if (j.as > j.hs) addDelta(j.m.awayTeam, 3, j.as, j.hs);
      else { addDelta(j.m.homeTeam, 1, j.hs, j.as); addDelta(j.m.awayTeam, 1, j.as, j.hs); }
    });
    const lynxJ = journeePreds.find(j => /valence/i.test(j.m.homeTeam || "") || /valence/i.test(j.m.awayTeam || "")) || null;
    const lynxHome = lynxJ ? /valence/i.test(lynxJ.m.homeTeam || "") : isHomeNext;
    const lynxRegP = nextPred2 ? (isHomeNext ? nextPred2.pHomeReg : nextPred2.pAwayReg) : null;
    const lynxOtP = nextPred2 ? nextPred2.pT * (isHomeNext ? nextPred2.pOtHome : 1 - nextPred2.pOtHome) : null;
    const oppRegP = nextPred2 ? (isHomeNext ? nextPred2.pAwayReg : nextPred2.pHomeReg) : null;
    const scenList = [
      { k: "V", icon: "🦁", label: "Les Lynx gagnent (temps réglementaire)", pL: 3, pO: 0, p: lynxRegP },
      { k: "VP", icon: "🦁", label: "Les Lynx gagnent en prolongation", pL: 2, pO: 1, p: lynxOtP },
      { k: "DP", icon: "🔵", label: "Les Lynx perdent en prolongation", pL: 1, pO: 2, p: (lynxOtP != null && nextPred2) ? Math.max(0, nextPred2.pT - lynxOtP) : null },
      { k: "D", icon: "🔵", label: "Les Lynx perdent (temps réglementaire)", pL: 0, pO: 3, p: oppRegP }
    ];
    const bestScen = scenList.reduce((a, b) => ((b.p || 0) > (a.p || 0) ? b : a), scenList[0]);
    const defaultK = nextPred2 ? bestScen.k : "V";
    const scenario = (sc) => {
      const rows = rrows.map(r => { const k = normalize(r.team); const d = deltaMap[k] || { pts: 0, bp: 0, bc: 0 }; return { team: r.team, pts: (Number(r.pts) || 0) + d.pts, bp: (Number(r.bp) || 0) + d.bp, bc: (Number(r.bc) || 0) + d.bc }; });
      let hs = 3, as = 2;
      if (lynxJ && lynxJ.hs !== null) { hs = lynxJ.hs; as = lynxJ.as; }
      const lynxWin = sc.pL > sc.pO;
      const lynxWonScore = lynxHome ? hs > as : as > hs;
      if (lynxWin !== lynxWonScore) { const t = hs; hs = as; as = t; }
      if (hs === as) { if (lynxHome) { if (lynxWin) hs++; else as++; } else { if (lynxWin) as++; else hs++; } }
      const lk = normalize(lynxRow ? lynxRow.team : (lynxHome && lynxJ ? lynxJ.m.homeTeam : (lynxJ ? lynxJ.m.awayTeam : "")));
      const okk = normalize(oppName || (lynxHome && lynxJ ? lynxJ.m.awayTeam : (lynxJ ? lynxJ.m.homeTeam : "")));
      const lrow = rows.find(r => normalize(r.team) === lk);
      if (lrow) { lrow.pts += sc.pL; lrow.bp += lynxHome ? hs : as; lrow.bc += lynxHome ? as : hs; }
      const orow = rows.find(r => normalize(r.team) === okk);
      if (orow) { orow.pts += sc.pO; orow.bp += lynxHome ? as : hs; orow.bc += lynxHome ? hs : as; }
      rows.sort((a, b) => b.pts - a.pts || (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp);
      return rows;
    };
    const scenTable = (sc) => {
      const rows = scenario(sc);
      const isBest = nextPred2 != null && sc.k === bestScen.k;
      const pct = sc.p != null ? Math.round(sc.p * 100) : null;
      return `<div class="rounded-xl border ${isBest ? "border-green-500/60 bg-green-500/5" : "border-gray-800"} p-3" data-scen="${sc.k}"${sc.k === defaultK ? "" : " hidden"}>
        <p class="font-bold mb-2 text-sm">${sc.icon} ${sc.label} — ${sc.pL} pt(s) Lynx · ${sc.pO} pt(s) ${esc(oppName)}${pct != null ? ` <span class="${isBest ? "text-green-400" : "text-gray-400"}">— ${pct} % de chances selon le modèle${isBest ? " 🔮" : ""}</span>` : ""}</p>
        <table class="w-full text-xs"><tbody>
        ${rows.map((r, i) => { const prev = posMap.get(normalize(r.team)); const lx = /valence/i.test(r.team || ""); const isOpp = !!oppName && sameName(r.team, oppName); const move = (prev && prev !== i + 1) ? (i + 1 < prev ? ` <span class="text-green-400">▲${prev - i - 1}</span>` : ` <span class="text-red-400">▼${i + 1 - prev}</span>`) : ""; return `<tr class="${lx ? "bg-lynx-red/10" : isOpp ? "bg-blue-500/10" : ""} border-t border-gray-800"><td class="px-2 py-1 text-gray-500">${i + 1}</td><td class="px-2 py-1 font-semibold ${lx ? "text-lynx-red" : isOpp ? "text-blue-400" : ""}">${esc(r.team)}${move}</td><td class="px-2 py-1 text-right font-black">${r.pts} pts</td></tr>`; }).join("")}
        </tbody></table>
      </div>`;
    };
    journeeSec = `<section class="${card} md:col-span-2 scroll-mt-20" id="journee">
      ${secH("🔮", "La journée " + esc(nextJ) + " vue par le modèle")}
      <p class="mb-3 text-xs text-gray-500">Pronostics du même moteur que le site (Poisson + forme + domicile/extérieur) — les matchs déjà joués gardent leur vrai score ; les autres comptent avec leur score prédit.</p>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">${journeePreds.map(j => { const lx = /valence/i.test(j.m.homeTeam || "") || /valence/i.test(j.m.awayTeam || ""); const tie = j.hs !== null && j.hs === j.as; const favHome = j.hs > j.as; const pct = (!j.done && j.p) ? Math.round(Math.max(j.p.pHomeWin, j.p.pAwayWin) * 100) : null; return `<div class="bg-gray-950/60 rounded-xl px-3 py-2 text-sm${lx ? " border border-lynx-red/40" : ""}"><span class="text-gray-400">${esc(jourFr(j.m.date))} · ${heure(j.m.date)}</span><br><span class="${!tie && favHome ? "text-green-400 font-bold" : ""}">${esc(j.m.homeTeam)}</span> <span class="font-black">${j.hs === null ? "vs" : String(j.hs) + "-" + String(j.as)}</span> <span class="${!tie && !favHome ? "text-green-400 font-bold" : ""}">${esc(j.m.awayTeam)}</span> <span class="text-xs text-gray-500">${j.done ? "✅ joué" : (pct != null ? pct + " %" : "")}</span></div>`; }).join("")}</div>
      <p class="mb-1 text-xs font-semibold text-gray-400">Et si… ? Classement projeté selon le résultat du match Valence–${esc(oppName)} — choisis le scénario :</p>
      <select id="scenSel" onchange="lynxScen(this.value)" class="mb-3 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm">${scenList.map(s => { const p = s.p != null ? " — " + Math.round(s.p * 100) + " %" : ""; const best = nextPred2 != null && s.k === bestScen.k; return `<option value="${s.k}"${s.k === defaultK ? " selected" : ""}>${s.icon} ${s.label}${p}${best ? " — 🔮 pronostic du modèle" : ""}</option>`; }).join("")}</select>
      ${scenList.map(scenTable).join("")}
      <script>function lynxScen(v){var d=document.querySelectorAll("#journee [data-scen]");for(var i=0;i<d.length;i++){d[i].hidden=d[i].getAttribute("data-scen")!==v;}}</script>
    </section>`;
  }
  let upSec = "";
  if (upcoming.length > 1) {
    upSec = `<section class="${card} md:col-span-2 scroll-mt-20" id="cal">
      ${secH("📅", "Prochains matchs")}
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">${upcoming.slice(0, 6).map(m => { const ih = /valence/i.test(m.homeTeam || ""); const opp = ih ? m.awayTeam : m.homeTeam; return `<div class="bg-gray-950/60 rounded-xl px-3 py-2 text-sm"><span class="text-gray-400">${esc(jourFr(m.date))}</span> · ${heure(m.date)}<br><strong>${esc(opp)}</strong> <span class="text-xs text-gray-500">${ih ? "domicile" : "extérieur"}</span></div>`; }).join("")}</div>
    </section>`;
  }
  const actus = (Array.isArray(news) ? news : []).filter(n => n && n.title && n.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  let actusSec = "";
  if (actus.length) {
    const badge = (n) => { const nid = String(n.id || ""), k = String(n.kind || ""); if (k === "stats") return "📈"; if (nid.startsWith("auto_result_")) return "📊"; if (nid.startsWith("auto_preview_")) return "🔮"; if (k === "recap" || nid.startsWith("auto_recap")) return "📅"; return "📰"; };
    actusSec = `<section class="${card} md:col-span-2 scroll-mt-20" id="actus">
      ${secH("🗞️", "Dernières actus")}
      <div class="space-y-2">${actus.map(n => { const d = new Date(n.date); const dt = isNaN(d) ? "" : d.toLocaleDateString("fr-FR", { timeZone: TZ, day: "numeric", month: "short" }); return `<a href="${esc(FEED_URL)}actus.html#lynx-${esc(String(n.id || hashId(n.title)))}" class="block bg-gray-950/60 rounded-xl px-3 py-2 border border-transparent hover:border-gray-600"><span class="text-xs text-gray-500">${dt} · ${badge(n)}</span> ${esc(n.title)}</a>`; }).join("")}</div>
      <p class="mt-3 text-sm"><a class="text-lynx-red font-semibold" href="${esc(FEED_URL)}actus.html">Tout lire →</a></p>
    </section>`;
  }
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>🦁 Lynx de Valence — le récap</title>
<meta name="description" content="Prochain match, résultats, forme, classement, stats et pronostics vérifiés des Lynx de Valence de hockey — mis à jour automatiquement.">
<meta property="og:title" content="Lynx de Valence — le récap">
<meta property="og:description" content="Prochain match, résultats, forme, classement, stats et actus des Lynx de Valence.">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { theme: { extend: { colors: { "lynx-red": "#D90429" } } } };</script>
</head><body class="bg-gray-950 text-gray-100 min-h-screen">
<header class="sticky top-0 z-20 bg-gray-950/90 backdrop-blur border-b border-gray-800">
  <div class="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
    <span class="font-black text-lg">🦁 <span class="text-lynx-red">Lynx</span> de Valence</span>
    <nav class="ml-auto flex gap-3 text-xs text-gray-400 overflow-x-auto whitespace-nowrap">
      <a class="hover:text-white" href="#match">Match</a><a class="hover:text-white" href="#forme">Forme</a><a class="hover:text-white" href="#adversaire">Adversaire</a><a class="hover:text-white" href="#classement">Classement</a><a class="hover:text-white" href="#stats">Stats</a><a class="hover:text-white" href="#joueurs">Joueurs</a><a class="hover:text-white" href="#pronos">Pronos</a><a class="hover:text-white" href="#duel">Duel</a><a class="hover:text-white" href="#journee">Journée</a><a class="hover:text-white" href="#cal">Calendrier</a><a class="hover:text-white" href="#actus">Actus</a>
    </nav>
  </div>
</header>
<main class="max-w-5xl mx-auto px-4 py-6 grid md:grid-cols-2 gap-5 pb-10">
${hero || `<section class="${card} md:col-span-2"><p class="text-gray-400">Le calendrier de la saison n'est pas encore disponible — il s'importera automatiquement depuis l'app.</p></section>`}
${formeSec}${advSec}${rankSec}${statsSec}${joueursSec}${pronoSec}${duelSec}${journeeSec}${upSec}${actusSec}
</main>
<footer class="border-t border-gray-800 py-6 text-center text-xs text-gray-500">
  <p><a class="text-gray-300 hover:text-white" href="${esc(SITE_URL)}">L'app complète 🦁</a> · <a class="text-gray-300 hover:text-white" href="${esc(FEED_URL)}feed.xml">Flux RSS</a> · <a class="text-gray-300 hover:text-white" href="${esc(FEED_URL)}actus.html">Toutes les actus</a></p>
  <p class="mt-2">Page générée automatiquement (environ une fois par heure) à partir des données du site.</p>
</footer>
</body></html>`;
  await fs.writeFile("index.html", html, "utf8");
  console.log(`index.html régénéré (récap public : ${played.length} match(s) joué(s), ${upcoming.length} à venir${st ? ", spécial teams" : ""}${oppName ? ", face-à-face " + oppName : ""}${lpTop.length ? ", top pointeurs ligue" : ""}${journeePreds.length ? ", journée " + (nextJ || "") + " projetée" : ""}).`);
}

// Les matchs importés (FFHG/CSV) ou saisis avant la mise à jour n'ont pas d'heure → minuit.
// Heure inconnue (00:00 heure Paris) → on applique DEFAULT_MATCH_HOUR pour tous les rappels.
function kickoffTs(dateIso) {
  const d = new Date(dateIso);
  if (isNaN(d)) return 0;
  const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  if (hm === "00:00" || hm === "24:00") {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    return new Date(`${day}T${String(DEFAULT_MATCH_HOUR).padStart(2, "0")}:00:00+01:00`).getTime();
  }
  return d.getTime();
}

// ============ ALERTES BUTS EN DIRECT (flux live FFHG, côté serveur : zéro proxy, zéro CORS) ============
async function ffhgLive(id) {
  const url = `https://www.hockeyfrance.com/competitions/wp-admin/admin-ajax.php?action=live_rencontre_maj&rencontre_id=${id}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "LynxBot/1.0" }, signal: ctrl.signal });
    if (!r.ok) throw new Error("FFHG HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(to); }
}
// 🪄 Détecte automatiquement le match de Valence du jour sur les pages live de la FFHG
// (même logique que le bouton « Trouver le match du jour » du site). Retourne "" si aucun.
async function liveDetectToday() {
  const urls = ["https://www.hockeyfrance.com/competitions/page-live/", "https://www.hockeyfrance.com/competitions/live/"];
  for (const u of urls) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(u, { headers: { "User-Agent": "LynxBot/1.0" }, signal: ctrl.signal });
      if (!r.ok) continue;
      const html = await r.text();
      const rx = /rencontre[\/=](\d{3,8})/g;
      let m; const seen = new Set();
      while ((m = rx.exec(html)) !== null) {
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const around = html.slice(Math.max(0, m.index - 700), Math.min(html.length, m.index + 700));
        if (/valence/i.test(around)) { clearTimeout(to); return id; }
      }
    } catch (e) {} finally { clearTimeout(to); }
  }
  return "";
}
// Le flux FFHG contient parfois PLUSIEURS clés "evenements" (doublons PHP) :
// JSON.parse ne garde que la dernière → on extrait toutes les listes du texte brut.
function liveExtractEvents(raw) {
  const events = [];
  const key = '"evenements":';
  let pos = 0;
  while (pos < raw.length) {
    const start = raw.indexOf(key, pos);
    if (start === -1) break;
    const arrStart = raw.indexOf("[", start);
    if (arrStart === -1) break;
    let depth = 0, inStr = false, escp = false, end = -1;
    for (let i = arrStart; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) { if (escp) escp = false; else if (ch === "\\") escp = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "[") depth++;
      else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) break;
    try { const arr = JSON.parse(raw.slice(arrStart, end + 1)); if (Array.isArray(arr)) events.push(...arr); } catch (e) {}
    pos = end + 1;
  }
  const byId = new Map();
  events.forEach(ev => {
    const k = ev.id || (ev.type + "|" + (ev.temps || 0) + "|" + (ev.equipe && ev.equipe.id));
    const prev = byId.get(k);
    if (!prev || JSON.stringify(ev).length > JSON.stringify(prev).length) byId.set(k, ev);
  });
  return [...byId.values()].sort((a, b) => (a.temps || 0) - (b.temps || 0));
}
// Envoie les alertes buts en push à TOUS les abonnés (config Admin → RSS → Alertes buts).
// État de progression dans settings/live-state (vu côté serveur, partagé entre cycles).
async function goalAlerts(settings, subs, matches) {
  if (!settings.liveAlertsEnabled || !subs.length || !VAPID_PRIVATE_KEY) return;
  let mid = (settings.liveMatchId ? String(settings.liveMatchId) : "").trim();
  let state = await getDoc("settings", "live-state");
  if (mid && state && state.matchId === mid && state.notifiedEnd) mid = ""; // le match configuré est terminé → on repart en détection auto
  if (!mid) {
    // 🪄 v2.13 : plus besoin de saisir le numéro avant chaque match — l'action trouve le match de Valence du jour toute seule.
    // Garde-fou : si le calendrier est importé et qu'aucun match Lynx n'a lieu aujourd'hui, on ne cherche rien.
    const list = Array.isArray(matches) ? matches : [];
    const dayKey = (d) => { try { const x = new Date(d); return x.getUTCFullYear() + "-" + x.getUTCMonth() + "-" + x.getUTCDate(); } catch (e) { return ""; } };
    const t = new Date(); const todayKey = t.getUTCFullYear() + "-" + t.getUTCMonth() + "-" + t.getUTCDate();
    const hasCal = list.some(m => m && m.date && isLynxMatch(m));
    const lynxToday = list.some(m => m && m.date && isLynxMatch(m) && dayKey(m.date) === todayKey);
    if (hasCal && !lynxToday) return;
    mid = await liveDetectToday();
    if (!mid) return;
    console.log("Alertes live : match de Valence détecté automatiquement (n° " + mid + ").");
  }
  if (!state || state.matchId !== mid) state = { matchId: mid, seenGoals: "", notifiedStart: false, notifiedEnd: false };
  if (state.notifiedEnd) return; // match terminé → plus rien à faire jusqu'au prochain match
  const raw = await ffhgLive(mid);
  let data = null;
  try { data = JSON.parse(raw); } catch (e) { throw new Error("flux FFHG illisible"); }
  if (!data || !Array.isArray(data.scores)) throw new Error("flux FFHG sans scores");
  const evts = liveExtractEvents(raw);
  const names = {};
  evts.forEach(ev => { if (ev.equipe && ev.equipe.id != null) names[ev.equipe.id] = ev.equipe.libelle_court || ev.equipe.libelle || ""; });
  const scores = data.scores;
  const home = scores[0] || {}, away = scores[1] || {};
  const homeName = names[home.equipe_id] || "Domicile", awayName = names[away.equipe_id] || "Visiteur";
  const hs = home.score || 0, as = away.score || 0;
  const isValHome = /valence/i.test(homeName);
  const seen = (state.seenGoals ? String(state.seenGoals).split(",") : []).filter(Boolean);
  const goals = evts.filter(ev => ev.type === "BUT" && ev.id);
  const pushes = [];
  if (!state.notifiedStart && (goals.length > 0 || (data.chronometre && Number(data.chronometre.milisecondes_total) > 0))) {
    state.notifiedStart = true;
    pushes.push({ title: "🥅 C'est parti !", body: `${homeName} - ${awayName} : le match Lynx est en cours !`, tag: `livestart_${mid}` });
  }
  for (const g of goals) {
    if (seen.includes(g.id)) continue;
    seen.push(g.id);
    const gTeam = g.equipe ? (g.equipe.libelle_court || g.equipe.libelle || "") : "";
    const mine = /valence/i.test(gTeam);
    const actor = g.tireur || g.joueur || g.personne || g.buteur || {};
    const nom = actor.nom_complet || ((actor.prenom || "") + " " + (actor.nom || "")).trim();
    pushes.push({ title: mine ? "🚨 BUUUT Lynx !" : "😬 But pour " + (gTeam || "l'adversaire"),
      body: `${homeName} ${hs} - ${as} ${awayName}` + (nom ? ` — ${nom}` : ""), tag: `goal_${g.id}` });
  }
  if (data.est_terminee && !state.notifiedEnd) {
    state.notifiedEnd = true;
    const nul = hs === as;
    const won = isValHome ? hs > as : as > hs;
    // v2.14 : joueur du match — les staffs désignent les MVP ~1 min après le coup de sifflet final,
    // on résout participant_joueur_id → nom via la liste des joueurs du flux.
    let mvpTxt = "";
    try {
      const partMap = {};
      (Array.isArray(data.joueurs) ? data.joueurs : []).forEach(p => {
        if (p && p.participant_id != null) { const pmn = p.nom_complet || ((p.prenom || "") + " " + (p.nom || "")).trim(); if (pmn) partMap[p.participant_id] = pmn; }
      });
      const mv = (Array.isArray(data.mvps) ? data.mvps : []).map(x => partMap[x.participant_joueur_id]).filter(Boolean);
      if (mv.length) mvpTxt = ` — ⭐ Joueur du match : ${mv.join(" et ")}`;
    } catch (e) {}
    pushes.push({ title: won ? "🏆 Victoire des Lynx !" : nul ? "🏁 Match nul" : "💔 Défaite des Lynx...",
      body: `Score final : ${homeName} ${hs} - ${as} ${awayName}${mvpTxt}`, tag: `liveend_${mid}` });
  }
  if (pushes.length) {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails("mailto:contact@lynx-valence.fr", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    for (const p of pushes) {
      let ok = 0;
      for (const s of subs) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: p.title, body: p.body, url: SITE_URL, tag: p.tag })); ok++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await delSub(s.id).catch(() => {}); } }
      }
      console.log(`Alerte live (${p.tag}) envoyée à ${ok} abonné(s).`);
    }
  }
  state.seenGoals = seen.join(",");
  await patchDoc("settings", "live-state", state);
  console.log(`Live FFHG : ${pushes.length} alerte(s) envoyée(s), ${seen.length} but(s) vus au total.`);
}

// Pousse les NOUVEAUX articles du site (résultats, pronostics, articles IA) aux abonnés.
// Max 3 par cycle ; état dans settings/articles-state (date du dernier article poussé).
async function articlePush(news, subs) {
  const targets = subs.filter(s => !s.prefs || s.prefs.articles !== false);
  if (!targets.length || !VAPID_PRIVATE_KEY) return;
  const state = await getDoc("settings", "articles-state");
  const lastDate = Number(state && state.lastDate) || 0;
  const sorted = news.filter(n => n.title && n.date).sort((a, b) => new Date(a.date) - new Date(b.date));
  const fresh = sorted.filter(n => new Date(n.date).getTime() > lastDate).slice(-3);
  if (!fresh.length) return;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails("mailto:contact@lynx-valence.fr", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  for (const n of fresh) {
    const url = `${FEED_URL}actus.html#lynx-${n.id}`;
    let ok = 0;
    for (const s of targets) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: "📰 Nouvel article Lynx", body: `${n.title} — clique pour le lire en entier.`, url, tag: `art_${hashId(String(n.id))}` }));
        ok++;
      } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await delSub(s.id).catch(() => {}); } }
    }
    console.log(`Article poussé (« ${n.title} ») à ${ok} abonné(s).`);
  }
  await patchDoc("settings", "articles-state", { lastDate: Math.max(...fresh.map(n => new Date(n.date).getTime())) });
}

// Pousse les NOUVELLES actus presse (uniquement les articles jamais vus en base — anti-doublon) aux abonnés.
// Max 2 par cycle ; respecte la préférence « Actus presse » (prefs.actus) de chaque appareil.
// Les items du flux EliteProspects Transactions déclenchent une notif dédiée « Mouvement de joueur ».
async function actusPush(newItems, subs) {
  const targets = subs.filter(s => !s.prefs || s.prefs.actus !== false);
  if (!targets.length || !VAPID_PRIVATE_KEY || !Array.isArray(newItems) || !newItems.length) return;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails("mailto:contact@lynx-valence.fr", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  for (const it of newItems.slice(0, 2)) {
    let ok = 0;
    const isMove = /transaction|mercato|recrut|eliteprospects/i.test(String(it.source || "") + " " + String(it.keywords || ""));
    const iid = hashId(String(it.link || it.title || "").trim().toLowerCase());
    for (const s of targets) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: isMove ? "🔄 Mouvement de joueur" : "🗞️ Actus Lynx", body: `${it.source} — ${it.title}`, url: it.link || `${FEED_URL}actus.html`, tag: `ext_${iid}` }));
        ok++;
      } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await delSub(s.id).catch(() => {}); } }
    }
    try { await patchDoc("rss-items", iid, { pushedAt: new Date().toISOString(), pushedTo: ok }); } catch (e) {}
    console.log(`Actus presse poussée (« ${it.title} ») à ${ok} abonné(s).`);
  }
}

// ===== BILLETTERIE : surveille la mise en vente des places sur leslynx.com/billetterie =====
// Quand le club ajoute un bouton vers plusbilletterie.helloasso.com/fr/evenements/...,
// on l'enregistre dans la collection "tickets" (lue par l'app pour la bannière d'accueil)
// et on pousse une notification à tous les abonnés si le match est à venir.
// NB : les liens de la billetterie du club sont mal fermés (<a ...>texte<a>) — la regex accepte les deux formes.
function ticketEventDate(label) {
  const t = normalize(String(label || ""));
  const mm = t.match(/(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})/);
  if (!mm) return null;
  const months = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
  const d = new Date(Number(mm[3]), months[mm[2]] - 1, Number(mm[1]));
  return isNaN(d.getTime()) ? null : d.getTime();
}
async function ticketCheck(subs) {
  const r = await fetch("https://www.leslynx.com/billetterie", { headers: { "User-Agent": "Mozilla/5.0 (compatible; LynxBot/1.0)" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const re = new RegExp('<a[^>]+href="(https?:\\/\\/[^"]*helloasso[^"]*evenement[^"]*)"[^>]*>([\\s\\S]*?)(?:<\\/a>|<a[\\s>])', 'gi');
  const seen = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    const label = m[2].replace(/<br\s*\/?>/gi, " · ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (url && label) seen.push({ url, label });
  }
  let added = 0;
  const future = [];
  for (const it of seen) {
    const id = hashId(String(it.url).toLowerCase());
    const evTs = ticketEventDate(it.label);
    if (evTs && evTs > Date.now() - 12 * 3600e3) future.push({ ...it, evTs });
    if (await docExists("tickets", id)) continue;
    await patchDoc("tickets", id, { url: it.url, label: it.label, detectedAt: new Date().toISOString() });
    added++;
    const evTs2 = ticketEventDate(it.label);
    if (evTs2 && evTs2 > Date.now() - 12 * 3600e3 && subs.length && VAPID_PRIVATE_KEY) {
      try {
        const webpush = (await import("web-push")).default;
        webpush.setVapidDetails("mailto:contact@lynx-valence.fr", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        let ok = 0;
        for (const s of subs) {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: "🎟️ Billetterie Lynx : places en vente !", body: it.label, url: it.url, tag: "ticket_" + id })); ok++; }
          catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await delSub(s.id).catch(() => {}); } }
        }
        console.log(`Billetterie : mise en vente détectée (« ${it.label} ») poussée à ${ok} abonné(s).`);
      } catch (e) { console.warn("push billetterie : " + (e && e.message ? e.message : e)); }
    }
  }
  console.log(`Billetterie : ${seen.length} évènement(s) en vente listé(s), ${added} nouveau(x) enregistré(s).`);
  return { seen: seen.length, added, future, at: new Date().toISOString() };
}

async function main() {
  const now = Date.now();
  const [matches, subs, news, rankings, roster, leaguePlayers, goalies, liveReports, existingExt, settings] = await Promise.all([
    getCol("calendar"), getCol("push-subs"), getCol("news"), getCol("ranking"), getCol("players"), getCol("league-players"), getCol("goalies"), getCol("live-reports"), getCol("rss-items"), getSettings()
  ]);
  const activeSeason = computeActiveSeason(matches, rankings);
  // v2.16 : l'effectif vit dans la collection « players » (pas « roster ») ; et le classement utilisé
  // par les stats/articles/page récap est celui importé s'il existe, sinon calculé depuis les résultats.
  const importedRank = (Array.isArray(rankings) ? rankings : []).filter(r => r && r.season === activeSeason && r.team);
  const liveRank = importedRank.length ? rankings : liveRankingOf(matches, activeSeason);
  console.log(`Saison active : ${activeSeason || "?"} — Matchs : ${matches.length}, News : ${news.length}`);
  console.log(`Kit Lynx v${KIT_VERSION} (reminders.mjs)`);

  // 0bis) TEST DES NOTIFICATIONS demandé depuis Admin → Diagnostic de l'app (settings/push-test)
  try {
    const pt = await getDoc("settings", "push-test");
    if (pt && pt.requestedAt && (!pt.pushedAt || String(pt.pushedAt) < String(pt.requestedAt))) {
      let ok = 0;
      if (subs.length && VAPID_PRIVATE_KEY) {
        const webpush = (await import("web-push")).default;
        webpush.setVapidDetails("mailto:contact@lynx-valence.fr", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        for (const s of subs) {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: "🏒 Lynx de Valence — test", body: "Si tu lis ça, les notifications marchent ! 🎉", url: SITE_URL, tag: "diag-test" })); ok++; }
          catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { await delSub(s.id).catch(() => {}); } }
        }
      }
      await patchDoc("settings", "push-test", { pushedAt: pt.requestedAt, pushedTo: ok, pushedAtIso: new Date().toISOString() });
      console.log(`Test notifications : poussé à ${ok} abonné(s).`);
    }
  } catch (e) { console.warn("Test push : " + (e && e.message ? e.message : e)); }

  // 0) ALERTES BUTS EN DIRECT (si activées dans l'Admin → RSS ; échec non bloquant)
  try { await goalAlerts(settings, subs.filter(s => !s.prefs || s.prefs.goals !== false), matches); } catch (e) { console.warn("Alertes live : " + (e && e.message ? e.message : e)); }

  // 1) RAPPELS : J-1 (fenêtre 24h→23h avant) et H-1 (dans l'heure précédant le match)
  const toSend = [];
  for (const m of matches) {
    if (!isLynxMatch(m) || isFinished(m) || !m.date) continue;
    const T = kickoffTs(m.date); // heure réelle si saisie dans l'app, sinon heure par défaut (20 h Paris)
    const kickIso = new Date(T).toISOString();
    const isHome = /valence/i.test(m.homeTeam || "");
    const opp = isHome ? m.awayTeam : m.homeTeam;
    const lieu = isHome ? "à domicile" : "à l'extérieur";
    const affiche = isHome ? `Lynx de Valence vs ${opp}` : `${opp} vs Lynx de Valence`;
    if (now >= T - 24 * 3600e3 && now < T - 23 * 3600e3) {
      toSend.push({ tag: `j1_${hashId(m.id)}`, title: "🏒 C'est demain !", body: `${affiche} — ${jourFr(m.date)} à ${heureFr(kickIso)}, ${lieu}. Prépare ton écharpe !` });
    }
    if (now >= T - 3600e3 && now < T) {
      toSend.push({ tag: `h1_${hashId(m.id)}`, title: "🏒 C'est l'heure !", body: `${affiche} démarre à ${heureFr(kickIso)} (${lieu}). Dernière heure pour mettre ton maillot !` });
    }
    if (now >= T && now < T + 30 * 60e3) {
      toSend.push({ tag: `start_${hashId(m.id)}`, title: "🔴 C'est le coup d'envoi !", body: `${affiche} a commencé (${heureFr(kickIso)}) ! Allez les Lynx ! 🦁` });
    }
  }
  console.log(`Rappels à envoyer : ${toSend.length} — Abonnés push : ${subs.length}`);
  const reminderSubs = subs.filter(s => !s.prefs || s.prefs.reminders !== false);
  if (toSend.length && reminderSubs.length && VAPID_PRIVATE_KEY) {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails("mailto:contact@lynx-valence.fr", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    for (const t of toSend) {
      if (await docExists("reminders", t.tag)) { console.log(`Déjà envoyé : ${t.tag}`); continue; }
      let ok = 0;
      for (const s of reminderSubs) {
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

  // 2) COLLECTE + FLUX : seulement toutes les ~50 minutes (l'action tourne désormais toutes les 5 min)
  const rssCycle = await getDoc("settings", "rss-state");
  const lastCollect = Number(rssCycle && rssCycle.lastCollectAt) || 0;
  if (now - lastCollect < 50 * 60e3) {
    console.log("Cycle rapide : collecte RSS et régénération du flux sautées (dernière il y a moins de 50 min).");
    try { await patchDoc("settings", "health", { v: KIT_VERSION, lastRunAt: new Date().toISOString(), runMode: "rapide (5 min)", subsCount: subs.length }); } catch (e) {}
  } else {
    try { await patchDoc("settings", "rss-state", { lastCollectAt: now }); } catch (e) { /* non bloquant */ }
    const collect = await collectExternalFeeds(settings.rssFeeds, settings.rssKeywords, new Set((existingExt || []).map(d => String(d.id))));
    console.log(`Actus externes : ${collect.fresh.length} article(s) synchronisé(s) dans l'app${collect.newItems.length ? " dont " + collect.newItems.length + " nouveau(x)" : ""}.${collect.failed.length ? " Flux en échec : " + collect.failed.join(", ") : ""}`);
    try { await actusPush(collect.newItems, subs); } catch (e) { console.warn("Push actus presse : " + (e && e.message ? e.message : e)); }
    let tkt = { seen: 0, added: 0, future: [], at: new Date().toISOString() };
    try { tkt = await ticketCheck(subs); } catch (e) { console.warn("Billetterie : " + (e && e.message ? e.message : e)); }

    // 3) ITEMS AUTO (templates sans IA)
    const newsIds = new Set(news.map(n => String(n.id || "")));
    const autoItems = [...buildResultItems(matches, newsIds, activeSeason)];
    const statsItem = buildStatsItem(matches, roster, leaguePlayers, goalies, liveRank, liveReports, activeSeason);
    if (statsItem) autoItems.push(statsItem);
    const rankState = await getDoc("settings", "rssState");
    const { item: rankItem, state: newRankState } = buildRankItem(liveRank, activeSeason, rankState || {});
    if (rankItem) autoItems.push(rankItem);
    if (newRankState && (!rankState || rankState.lynxRankPos !== newRankState.lynxRankPos || rankState.lynxRankPoule !== newRankState.lynxRankPoule)) {
      await patchDoc("settings", "rssState", newRankState);
    }

    // 4) FLUX RSS ENRICHI (articles IA + presse filtrée + résultats + stats + classement)
    const extItems = [...existingExt, ...collect.fresh];
    const feedCount = await buildFeed(news, extItems, autoItems, tkt.future);
    // 4ter) PAGE RÉCAP PUBLIQUE (index.html servie par GitHub Pages à la racine du dépôt) — vitrine simple, mêmes données vérifiées
    try { await buildHomePage(matches, roster, leaguePlayers, goalies, liveRank, liveReports, news, tkt.future, activeSeason); } catch (e) { console.warn("Page récap : " + (e && e.message ? e.message : e)); }
    // 4bis) STATS DE LA SEMAINE → aussi en article du site (badge 📈, un doc par semaine) : ce qui est dans le flux public est visible dans Actus
    // ⚠️ la date reste celle de la PREMIÈRE publication de la semaine — la réécrire à chaque cycle faisait croire au push « nouvel article » que l'article était nouveau → re-notification ~toutes les heures
    if (statsItem) { try { const exStats = (news || []).find(n => String(n.id || "") === String(statsItem.guid)); await patchDoc("news", statsItem.guid, { title: statsItem.title, content: statsItem.description, date: exStats && exStats.date ? exStats.date : statsItem.date, auto: true, kind: "stats" }); } catch (e) { console.warn("Stats en article : " + (e && e.message ? e.message : e)); } }
    // 5) PUSH « NOUVEL ARTICLE » (selon les préférences de chaque appareil ; non bloquant)
    try { await articlePush(news, subs); } catch (e) { console.warn("Push articles : " + (e && e.message ? e.message : e)); }
    // 6) DOC DE SANTÉ : ce que l'Admin → Diagnostic de l'affiche affiche
    try {
      await patchDoc("settings", "health", { v: KIT_VERSION, lastRunAt: new Date().toISOString(), runMode: "complet (RSS + billetterie)", subsCount: subs.length, rssCycleAt: new Date().toISOString(), extFresh: collect.fresh.length, feedsFailed: String((collect.failed || []).join(" ; ")).slice(0, 300), lastTicketCheckAt: tkt.at, billetterieSeen: tkt.seen, billetterieAdded: tkt.added, feedItems: feedCount });
    } catch (e) { console.warn("health : " + (e && e.message ? e.message : e)); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
