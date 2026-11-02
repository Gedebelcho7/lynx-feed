// reminders.mjs — Rappels de matchs + collecte des actus externes + flux RSS enrichi
// Lancé automatiquement toutes les heures par GitHub Actions (gratuit).
// Lit/écrit dans Firestore via l'API REST (règles Firestore ouvertes requises).
// La collecte des flux RSS externes se fait ICI (côté serveur : pas de CORS, pas de proxy)
// → fini les proxys gratuits en panne, et le flux public contient TOUT :
// articles IA, résultats, pronostics, actus presse filtrées, stats, classement.

const PROJECT = "lnx-data";
const API_KEY = "AIzaSyAESkXTPEvXGWK5LTd55_XTHWwexTHvtG4";
const BASE_PATH = "artifacts/default-app-id/public/data";
const SITE_URL = "https://lnx-data.netlify.app/"; // ⚠️ REMPLACE par l'URL réelle de ton app (étape B2-3)
const FEED_URL = "https://gedebelcho7.github.io/lynx-feed/"; // ⚠️ REMPLACE par l'URL Pages du dépôt lynx-feed (étape B2-3) — l'URL où vivent feed.xml et actus.html
const KIT_VERSION = "2.11"; // version du kit — doit correspondre à APP_VERSION du site ; visible dans les logs de l'action et dans Admin → Diagnostic (doc settings/health)
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
async function collectExternalFeeds(feeds, keywords, knownIds) {
  const fresh = []; const newItems = []; const failed = [];
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
async function buildFeed(news, extItems, autoItems, ticketEvents) {
  const feedItems = [];
  for (const n of news) {
    if (!n.title || !n.date) continue;
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
  for (const it of autoItems) feedItems.push(it);
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
async function goalAlerts(settings, subs) {
  if (!settings.liveAlertsEnabled || !settings.liveMatchId || !subs.length || !VAPID_PRIVATE_KEY) return;
  let state = await getDoc("settings", "live-state");
  const mid = String(settings.liveMatchId);
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
    pushes.push({ title: won ? "🏆 Victoire des Lynx !" : nul ? "🏁 Match nul" : "💔 Défaite des Lynx...",
      body: `Score final : ${homeName} ${hs} - ${as} ${awayName}`, tag: `liveend_${mid}` });
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
    const iid = hashId(String(it.link || it.title || "").toLowerCase());
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
  const [matches, subs, news, rankings, roster, leaguePlayers, existingExt, settings] = await Promise.all([
    getCol("calendar"), getCol("push-subs"), getCol("news"), getCol("ranking"), getCol("roster"), getCol("league-players"), getCol("rss-items"), getSettings()
  ]);
  const activeSeason = computeActiveSeason(matches, rankings);
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
  try { await goalAlerts(settings, subs.filter(s => !s.prefs || s.prefs.goals !== false)); } catch (e) { console.warn("Alertes live : " + (e && e.message ? e.message : e)); }

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
    const feedCount = await buildFeed(news, extItems, autoItems, tkt.future);
    // 5) PUSH « NOUVEL ARTICLE » (selon les préférences de chaque appareil ; non bloquant)
    try { await articlePush(news, subs); } catch (e) { console.warn("Push articles : " + (e && e.message ? e.message : e)); }
    // 6) DOC DE SANTÉ : ce que l'Admin → Diagnostic de l'affiche affiche
    try {
      await patchDoc("settings", "health", { v: KIT_VERSION, lastRunAt: new Date().toISOString(), runMode: "complet (RSS + billetterie)", subsCount: subs.length, rssCycleAt: new Date().toISOString(), extFresh: collect.fresh.length, feedsFailed: String((collect.failed || []).join(" ; ")).slice(0, 300), lastTicketCheckAt: tkt.at, billetterieSeen: tkt.seen, billetterieAdded: tkt.added, feedItems: feedCount });
    } catch (e) { console.warn("health : " + (e && e.message ? e.message : e)); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
