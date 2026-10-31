// reminders.mjs — Rappels de matchs Lynx + régénération du flux RSS
// Lancé automatiquement toutes les heures par GitHub Actions (gratuit).
// Lit/écrit dans Firestore via l'API REST (règles Firestore ouvertes requises).

const PROJECT = "lnx-data";
const API_KEY = "AIzaSyAESkXTPEvXGWK5LTd55_XTHWwexTHvtG4";
const BASE_PATH = "artifacts/default-app-id/public/data";
const SITE_URL = "https://lnx-data.netlify.app/"; // ⚠️ REMPLACE par l'URL réelle de ton app (B2-3 ou C-5)
const VAPID_PUBLIC_KEY = "BFxrHv11rQ5N21z-SP-QDKnXCSFrXsEy4ovLUmE9TO-fzanQFdOsUl4iGPkylKZ55YvlnQevC2RJe5o82ZScnFg";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const TZ = "Europe/Paris";

const API = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${BASE_PATH}`;

// Même algorithme de hash que le site (pour des ids de documents identiques)
const hashId = (s) => { let h = 5381; const str = String(s); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return "h" + h.toString(36); };

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

async function buildFeed(news) {
  const sorted = [...news].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const last = sorted.length ? new Date(sorted[0].date).toUTCString() : new Date().toUTCString();
  const items = sorted.map((n) => `  <item>
    <title>${esc(n.title)}</title>
    <description>${esc(String(n.content || "").replace(/[#*>]/g, "").slice(0, 400))}…</description>
    <pubDate>${new Date(n.date).toUTCString()}</pubDate>
    <guid isPermaLink="false">lynx-${esc(n.id)}</guid>
  </item>`).join("\n");
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Les Lynx de Valence — Actus officielles</title>
  <link>${esc(SITE_URL)}</link>
  <description>Résultats, classements, pronostics et rappels de matchs des Lynx de Valence (hockey sur glace)</description>
  <language>fr</language>
  <lastBuildDate>${last}</lastBuildDate>
${items}
</channel>
</rss>`;
  const fs = await import("node:fs/promises");
  await fs.writeFile("feed.xml", feed, "utf8");
  console.log(`feed.xml régénéré (${sorted.length} articles).`);
}

async function main() {
  const now = Date.now();
  const [matches, subs, news] = await Promise.all([getCol("calendar"), getCol("push-subs"), getCol("news")]);
  const isLynx = (m) => /valence/i.test(`${m.homeTeam || ""}${m.awayTeam || ""}`);
  const finished = (m) => m.scoreHome !== null && m.scoreHome !== undefined && m.scoreAway !== null && m.scoreAway !== undefined;

  // Rappels : J-1 (fenêtre 24h→23h avant) et H-1 (dans l'heure précédant le match)
  const toSend = [];
  for (const m of matches) {
    if (!isLynx(m) || finished(m) || !m.date) continue;
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

  await buildFeed(news);
}

main().catch((e) => { console.error(e); process.exit(1); });
