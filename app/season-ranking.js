// --- FORMAT DE SAISON (D1 = championnat unique, D2 = poules) ---
        function seasonHasPoules(season) {
            const fmt = seasonFormats[season];
            if (fmt && fmt.division) return fmt.division === 'D2';
            // Auto-détection : poules si des données indiquent une poule A
            const hasA = rankingA.some(r => r.season === season) || allMatches.some(m => m.season === season && (m.poule || '').toUpperCase() === 'A');
            return !!hasA;
        }
        function getFormat(season) {
            const f = seasonFormats[season] || {};
            if (f.division) return { division: f.division, playoffSpots: f.playoffSpots || (f.division === 'D1' ? 12 : 8), maintienSpots: (f.maintienSpots === 0 || f.maintienSpots) ? f.maintienSpots : 0, dates: f.dates || null };
            const poules = seasonHasPoules(season);
            // Règlement officiel 2026-2027 (hockeyfrance.com, page « Formule ») — les places sont PAR POULE :
            // D1 : poule unique de 16 — 1-4 quarts directs, 5-12 huitièmes (ligne playoffs = 12e), 13e-16e phase
            // de maintien (2 tours, le perdant du tour 2 descend en D2 ; toute rencontre désigne un vainqueur).
            // D2 : 2 poules de 10 — top 8 de chaque poule en playoffs, 9e-10e de chaque poule en poule de
            // maintien aller-retour (les 2 derniers descendent en D3). Dates officielles intégrées pour 2026-2027,
            // et importables pour toute saison via l'Admin (« Importer le règlement FFHG », copier-coller).
            const dates2627 = poules
                ? { regular: ['2026-10-03', '2027-02-20'], playoffs: ['2027-02-27', '2027-04-21'], maintien: ['2027-02-27', '2027-04-10'] }
                : { regular: ['2026-10-03', '2027-03-06'], playoffs: ['2027-03-09', '2027-04-29'], maintien: ['2027-03-13', '2027-04-04'] };
            return { division: poules ? 'D2' : 'D1', playoffSpots: poules ? 8 : 12, maintienSpots: poules ? 2 : 4, dates: f.dates || (season === '2026-2027' ? dates2627 : null) };
        }
        // Affichage des dates de phase : « 3 oct. 2026 → 6 mars 2027 »
        function fmtPhaseShort(p) {
            if (!p || !p[0]) return 'dates inconnues';
            const f = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
            return p[1] ? f(p[0]) + ' → ' + f(p[1]) : f(p[0]);
        }
        // Libellé du championnat pour les textes et les prompts IA : « poule B » seulement si la saison a réellement deux poules.
        function seasonChampLbl(season) { return seasonHasPoules(season) ? 'poule B' : 'championnat de Division 1'; }
        // --- BARÈME FFHG (identique D1 & D2) : V 3 pts / V prol-TAB 2 pts / D prol-TAB 1 pt / D 0 pt ---
        function matchPoints(scoreFor, scoreAgainst, isProl) {
            if (scoreFor > scoreAgainst) return isProl ? 2 : 3;
            if (scoreFor < scoreAgainst) return isProl ? 1 : 0;
            return 1; // sécurité : ex-aequo sans prolongation renseignée
        }
        function computeLiveRanking(season, poule, existingCSVData) {
             const poules = seasonHasPoules(season);
             const teams = {};
             existingCSVData.forEach(t => { if(!t.team || t.team.trim() === '') return; if (poules && (t.poule || poule) !== poule) return; const norm = normalize(t.team); teams[norm] = { team: t.team, pts: t.pts || 0, mj: t.mj || 0, v: t.v || 0, d: t.d || 0, vp: 0, dp: 0, bp: t.bp || 0, bc: t.bc || 0, poule: poule, form: [] }; });
             // FIX : Seuls les matchs qui n'ont pas de type ou dont le type est explicitement 'Saison' sont comptés. Les Playoffs et la Poule de Maintien sont ignorés !
             const matches = allMatches.filter(m => m.season === season && isMatchFinished(m) && (!m.type || m.type === 'Saison')).sort((a,b) => new Date(a.date) - new Date(b.date));
             matches.forEach(m => {
                 if(poules && (m.poule || 'B').toUpperCase() !== poule.toUpperCase()) return; const hNorm = normalize(m.homeTeam); const aNorm = normalize(m.awayTeam);
                 if(!teams[hNorm]) teams[hNorm] = { team: m.homeTeam, pts:0, mj:0, v:0, d:0, vp:0, dp:0, bp:0, bc:0, poule: poule, form: [] }; if(!teams[aNorm]) teams[aNorm] = { team: m.awayTeam, pts:0, mj:0, v:0, d:0, vp:0, dp:0, bp:0, bc:0, poule: poule, form: [] };
                 const h = teams[hNorm]; const a = teams[aNorm]; h.mj++; a.mj++; h.bp += m.scoreHome; h.bc += m.scoreAway; a.bp += m.scoreAway; a.bc += m.scoreHome;
                 h.pts += matchPoints(m.scoreHome, m.scoreAway, m.isProl);
                 a.pts += matchPoints(m.scoreAway, m.scoreHome, m.isProl);
                 if(m.scoreHome > m.scoreAway) { if (m.isProl) { h.vp++; a.dp++; } else { h.v++; a.d++; } }
                 else if (m.scoreAway > m.scoreHome) { if (m.isProl) { a.vp++; h.dp++; } else { a.v++; h.d++; } }
                 const hWon = m.scoreHome > m.scoreAway, aWon = m.scoreAway > m.scoreHome;
                 h.form.push(hWon ? (m.isProl ? 'v' : 'V') : (aWon ? (m.isProl ? 'd' : 'D') : 'N'));
                 a.form.push(aWon ? (m.isProl ? 'v' : 'V') : (hWon ? (m.isProl ? 'd' : 'D') : 'N'));
             });
             Object.values(teams).forEach(t => { t.form = (t.form || []).slice(-5).join(''); });
             return Object.values(teams);
        }

        // v2.17 : TRI OFFICIEL FFHG en cas d'égalité de points — 1) points pris en confrontations directes,
        // 2) différence de buts en confrontations directes, 3) différence de buts générale,
        // 4) quotient général (buts marqués / buts reçus), 5) meilleure attaque. (Règlement FFHG vérifié sur
        // hockeyfrance.com pour la D1 2026-2027 ET la D2 ; le critère « aucune défaite par forfait » n'est pas
        // calculable depuis les résultats et est ignoré, comme tous les sites de classement.)
        // Utilisé partout (classement, articles, export) → plus jamais de « 4e » dans un article et « 5e » sur le site.
        function sortRankFFHG(rows, season) {
            const pool = (allMatches || []).filter(m => m.season === season && isMatchFinished(m) && (!m.type || m.type === 'Saison'));
            const cache = {};
            const h2h = (A, B) => {
                const k = [normalize(A), normalize(B)].sort().join('|');
                if (!(k in cache)) {
                    let pa = 0, pb = 0, da = 0, db = 0;
                    for (const m of pool) {
                        const ihA = normalize(m.homeTeam) === normalize(A), iaA = normalize(m.awayTeam) === normalize(A);
                        const ihB = normalize(m.homeTeam) === normalize(B), iaB = normalize(m.awayTeam) === normalize(B);
                        if (!((ihA || iaA) && (ihB || iaB))) continue;
                        const sa = ihA ? m.scoreHome : m.scoreAway, sb = ihB ? m.scoreHome : m.scoreAway;
                        if (sa === sb) { pa += 1; pb += 1; }
                        else if (sa > sb) { pa += m.isProl ? 2 : 3; pb += m.isProl ? 1 : 0; }
                        else { pb += m.isProl ? 2 : 3; pa += m.isProl ? 1 : 0; }
                        da += sa - sb; db += sb - sa;
                    }
                    cache[k] = { pa, pb, da, db };
                }
                return cache[k];
            };
            return [...(rows || [])].sort((a, b) => {
                const dP = (Number(b.pts) || 0) - (Number(a.pts) || 0);
                if (dP) return dP;
                const h = h2h(a.team, b.team);
                if (h.pa !== h.pb) return h.pb - h.pa;
                if (h.da !== h.db) return h.db - h.da;
                const dA = (Number(a.bp) || 0) - (Number(a.bc) || 0), dB = (Number(b.bp) || 0) - (Number(b.bc) || 0);
                if (dA !== dB) return dB - dA;
                const qA = (Number(a.bc) || 0) > 0 ? (Number(a.bp) || 0) / Number(a.bc) : (Number(a.bp) || 0) > 0 ? Infinity : 0;
                const qB = (Number(b.bc) || 0) > 0 ? (Number(b.bp) || 0) / Number(b.bc) : (Number(b.bp) || 0) > 0 ? Infinity : 0;
                if (qA !== qB) return qB - qA;
                return (Number(b.bp) || 0) - (Number(a.bp) || 0);
            });
        }

        // v2.21 : scénarios des concurrents — l'impact des prochains matchs des autres équipes sur la position des Lynx
        // v2.22 : moteur de scénarios RÉUTILISABLE — le bloc d'accueil ET les articles (IA ou non) passent par lui,
        // pour que les textes s'appuient sur les mêmes chiffres vérifiés (modèle interne du site, aucune invention).
        function buildRankFromMatches(matches) {
            const done = (matches || []).filter(m => m.season === activeSeason && isMatchFinished(m) && (!m.type || m.type === 'Saison'));
            const tab = {};
            done.forEach(m => { const th = m.homeTeam || '?', ta = m.awayTeam || '?';
                tab[th] = tab[th] || { team: th, pts: 0, bp: 0, bc: 0 };
                tab[ta] = tab[ta] || { team: ta, pts: 0, bp: 0, bc: 0 };
                tab[th].pts += matchPoints(Number(m.scoreHome) || 0, Number(m.scoreAway) || 0, m.isProl);
                tab[ta].pts += matchPoints(Number(m.scoreAway) || 0, Number(m.scoreHome) || 0, m.isProl);
                tab[th].bp += Number(m.scoreHome) || 0; tab[th].bc += Number(m.scoreAway) || 0;
                tab[ta].bp += Number(m.scoreAway) || 0; tab[ta].bc += Number(m.scoreHome) || 0; });
            return Object.values(tab);
        }
        function computeScenariosData(matches, rankingOpt) {
            try {
                const base = sortRankFFHG((rankingOpt && rankingOpt.length ? rankingOpt : buildRankFromMatches(matches)).map(r => ({ ...r })), activeSeason);
                const pos0 = base.findIndex(t => normalize(t.team).includes('valence'));
                if (pos0 < 0) return null;
                const now = Date.now(), horizon = now + 10 * 24 * 3600e3;
                const rivals = new Set(base.slice(Math.max(0, pos0 - 4), pos0 + 5).map(t => normalize(t.team)));
                const inWin = (m) => (new Date(m.date).getTime() || 0) > now - 6 * 3600e3 && (new Date(m.date).getTime() || 0) < horizon;
                const up = (matches || []).filter(m => m.season === activeSeason && (!m.type || m.type === 'Saison') && !isMatchFinished(m)
                    && inWin(m)
                    && !(normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence'))
                    && (rivals.has(normalize(m.homeTeam)) || rivals.has(normalize(m.awayTeam))))
                    .sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 6);
                const lynxNext = (matches || []).filter(m => m.season === activeSeason && (!m.type || m.type === 'Saison') && !isMatchFinished(m)
                    && inWin(m)
                    && (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence')))
                    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
                if (!up.length && !lynxNext) return null;
                let model = null;
                try {
                    const played = (matches || []).filter(m => m.season === activeSeason && isMatchFinished(m) && (!m.type || m.type === 'Saison'));
                    if (played.length >= 3) model = buildPoolModel(played);
                } catch (e) {}
                const pred = (m) => { try { return model ? predictMatch(model, m.homeTeam, m.awayTeam, new Date(m.date).getTime()) : null; } catch (e) { return null; } };
                const rankIdx = (t) => base.findIndex(r => normalize(r.team) === normalize(t));
                const isLynxM = (m) => normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence');
                const allUp = [...(lynxNext ? [lynxNext] : []), ...up];
                const winProb = (m, w) => { const pr = pred(m); if (!pr) return null; return normalize(w) === normalize(m.homeTeam) ? pr.pHomeWin : pr.pAwayWin; };
                const pickWinner = (m, rule) => {
                    const pr = pred(m);
                    const better = rankIdx(m.homeTeam) <= rankIdx(m.awayTeam) ? m.homeTeam : m.awayTeam; // le mieux classé = la menace la plus sérieuse
                    const worse = better === m.homeTeam ? m.awayTeam : m.homeTeam;
                    const probWin = pr ? (pr.expWinner === 'H' ? m.homeTeam : m.awayTeam) : better;
                    if (rule === 'prob') return probWin;
                    const lT = isLynxM(m) ? (normalize(m.homeTeam).includes('valence') ? m.homeTeam : m.awayTeam) : null;
                    const oT = lT ? (lT === m.homeTeam ? m.awayTeam : m.homeTeam) : null;
                    if (rule === 'ideal') return isLynxM(m) ? lT : worse;
                    if (rule === 'worst') return isLynxM(m) ? oT : better;
                    if (rule === 'real') { const fav = isLynxM(m) ? lT : worse; const pf = winProb(m, fav); return (pf != null && pf >= 0.33) ? fav : probWin; } // favorable dès 1 chance sur 3
                    return probWin;
                };
                const posOf = (adj) => { const s = sortRankFFHG(base.map(r => ({ ...r, pts: (r.pts || 0) + (adj.get(normalize(r.team)) || 0) })), activeSeason); const i = s.findIndex(t => normalize(t.team).includes('valence')); return i >= 0 ? i + 1 : null; };
                // v2.22 : barème FFHG COMPLET sur le match des Lynx — V=3, V-prol=2, D-prol=1, D=0
                // (les prolongations comptent enfin) ; chez les autres, victoire à 3 pts comme avant.
                const lynxIssue = (m, rule) => {
                    const pr = pred(m);
                    const lT = normalize(m.homeTeam).includes('valence') ? m.homeTeam : m.awayTeam;
                    const oT = lT === m.homeTeam ? m.awayTeam : m.homeTeam;
                    if (!pr || pr.pT == null) { const w = pickWinner(m, rule); return { w, ptsW: 3, ptsL: 0, ot: false, p: winProb(m, w) }; }
                    const lynxHome = normalize(m.homeTeam).includes('valence');
                    const issues = [
                        { w: lT, ptsW: 3, ptsL: 0, ot: false, p: lynxHome ? pr.pH : pr.pA },                          // victoire dans le temps réglementaire
                        { w: lT, ptsW: 2, ptsL: 1, ot: true, p: pr.pT * (lynxHome ? pr.otHc : 1 - pr.otHc) },         // victoire en prolongation
                        { w: oT, ptsW: 2, ptsL: 1, ot: true, p: pr.pT * (lynxHome ? 1 - pr.otHc : pr.otHc) },         // défaite en prolongation
                        { w: oT, ptsW: 3, ptsL: 0, ot: false, p: lynxHome ? pr.pA : pr.pH }                           // défaite dans le temps réglementaire
                    ];
                    if (rule === 'ideal') return issues[0];
                    if (rule === 'worst') return issues[3];
                    if (rule === 'real') return issues.find(i => i.w === lT && i.p >= 0.33) || issues.slice().sort((a, b) => b.p - a.p)[0];
                    return issues.slice().sort((a, b) => b.p - a.p)[0];
                };
                const mk = (rule) => {
                    const adj = new Map(); let prob = 1, hasP = false;
                    const add = (t, n) => { const k = normalize(t); adj.set(k, (adj.get(k) || 0) + n); };
                    const lines = allUp.map(m => {
                        if (isLynxM(m)) {
                            const it = lynxIssue(m, rule);
                            add(it.w, it.ptsW); add(it.w === m.homeTeam ? m.awayTeam : m.homeTeam, it.ptsL);
                            if (it.p != null) { prob *= it.p; hasP = true; }
                            return { m, w: it.w, lynx: true, ot: it.ot };
                        }
                        const w = pickWinner(m, rule);
                        add(w, 3);
                        const p = winProb(m, w); if (p != null) { prob *= p; hasP = true; }
                        return { m, w, lynx: isLynxM(m), ot: false };
                    });
                    return { adj, prob: hasP ? prob : null, lines };
                };
                const mkMean = () => {
                    const adj = new Map(); const add = (t, n) => { const k = normalize(t); adj.set(k, (adj.get(k) || 0) + n); };
                    const lines = allUp.map(m => {
                        const pr = pred(m);
                        if (pr && pr.ePts) { add(m.homeTeam, pr.ePts[0]); add(m.awayTeam, pr.ePts[1]); return { m, mean: true, eH: pr.ePts[0], eA: pr.ePts[1] }; }
                        const w = pickWinner(m, 'prob'); add(w, 3); return { m, w, lynx: isLynxM(m) };
                    });
                    return { adj, prob: null, lines };
                };
                const defs = [
                    { ico: '🏆', lbl: 'Scénario idéal', rule: 'ideal' },
                    { ico: '🎯', lbl: 'Meilleure progression réaliste', rule: 'real' },
                    { ico: '🔮', lbl: 'Le plus probable', rule: 'prob' },
                    { ico: '📊', lbl: 'Le moyen', mean: true },
                    { ico: '💀', lbl: 'Pire scénario', rule: 'worst' }
                ];
                const list = defs.map(d => { const r = d.mean ? mkMean() : mk(d.rule); return { ico: d.ico, lbl: d.lbl, pos: posOf(r.adj), prob: r.prob, lines: r.lines }; });
                // v2.22 : place la PLUS PROBABLE à l'issue des 10 jours — simulation de 1500 combinaisons de
                // résultats (barème FFHG complet, prolongations incluses). Le % d'un scénario précis est
                // forcément minuscule : c'est UNE combinaison exacte parmi des milliers ; la vraie question
                // est « où finit-on le plus souvent » — la simulation y répond.
                let dist = null, trend = null, watch = null;
                try {
                    if (model && allUp.length) {
                        const N = 1500, counts = {};
                        const prCache = new Map();
                        const prOf = (m) => { if (!prCache.has(m.id)) prCache.set(m.id, pred(m)); return prCache.get(m.id); };
                        for (let s = 0; s < N; s++) {
                            const adj = new Map(); const add = (t, n) => { const k = normalize(t); adj.set(k, (adj.get(k) || 0) + n); };
                            for (const m of allUp) {
                                const pr = prOf(m);
                                if (!pr || pr.pHomeWin == null || pr.pAwayWin == null) { const w2 = rankIdx(m.homeTeam) <= rankIdx(m.awayTeam) ? m.homeTeam : m.awayTeam; add(w2, 3); continue; }
                                const r = Math.random(), pH = pr.pHomeWin, pA = pr.pAwayWin, pT = pr.pT != null ? pr.pT : 0, otH = pr.otHc != null ? pr.otHc : 0.5;
                                if (r < pH) { add(m.homeTeam, 3); }
                                else if (r < pH + pA) { add(m.awayTeam, 3); }
                                else if (r < pH + pA + pT * otH) { add(m.homeTeam, 2); add(m.awayTeam, 1); }
                                else if (r < pH + pA + pT) { add(m.homeTeam, 1); add(m.awayTeam, 2); }
                                else { const w2 = rankIdx(m.homeTeam) <= rankIdx(m.awayTeam) ? m.homeTeam : m.awayTeam; add(w2, 3); }
                            }
                            const pp = posOf(adj); if (pp != null) counts[pp] = (counts[pp] || 0) + 1;
                        }
                        const tot = Object.keys(counts).reduce((s, p) => s + counts[p], 0) || 1;
                        dist = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a]).map(p => ({ pos: p, pct: Math.round(counts[p] * 100 / tot) }));
                        // v2.22 : tendance claire — % de monter d'au moins une place, de garder la place, de descendre
                        const cUp = Object.keys(counts).filter(p => Number(p) < pos0 + 1).reduce((s, p) => s + counts[p], 0);
                        const cSame = counts[pos0 + 1] || 0;
                        const cDown = Object.keys(counts).filter(p => Number(p) > pos0 + 1).reduce((s, p) => s + counts[p], 0);
                        trend = { up: Math.round(cUp * 100 / tot), same: Math.round(cSame * 100 / tot), down: Math.round(cDown * 100 / tot) };
                        // v2.22 : matchs a surveiller — pour chaque match des autres equipes, place MOYENNE des Lynx
                        // si le domicile gagne (fixe) vs si le visiteur gagne (fixe), les autres matchs etant simules ;
                        // ecart = influence du match, favori = vainqueur le plus favorable aux Lynx.
                        watch = [];
                        const others = allUp.filter(m => !isLynxM(m));
                        const avgPosFix = (fixM, fixW) => {
                            let sum = 0, n = 0;
                            for (let s2 = 0; s2 < 200; s2++) {
                                const adj = new Map(); const add2 = (t, x) => { const k = normalize(t); adj.set(k, (adj.get(k) || 0) + x); };
                                for (const m2 of allUp) {
                                    if (m2 === fixM) { add2(fixW, 3); continue; }
                                    const pr = prOf(m2);
                                    if (!pr || pr.pHomeWin == null || pr.pAwayWin == null) { const w2 = rankIdx(m2.homeTeam) <= rankIdx(m2.awayTeam) ? m2.homeTeam : m2.awayTeam; add2(w2, 3); continue; }
                                    const r = Math.random(), pH = pr.pHomeWin, pA = pr.pAwayWin, pT = pr.pT != null ? pr.pT : 0, otH = pr.otHc != null ? pr.otHc : 0.5;
                                    if (r < pH) { add2(m2.homeTeam, 3); }
                                    else if (r < pH + pA) { add2(m2.awayTeam, 3); }
                                    else if (r < pH + pA + pT * otH) { add2(m2.homeTeam, 2); add2(m2.awayTeam, 1); }
                                    else if (r < pH + pA + pT) { add2(m2.homeTeam, 1); add2(m2.awayTeam, 2); }
                                    else { const w2 = rankIdx(m2.homeTeam) <= rankIdx(m2.awayTeam) ? m2.homeTeam : m2.awayTeam; add2(w2, 3); }
                                }
                                const pp = posOf(adj); if (pp != null) { sum += pp; n++; }
                            }
                            return n ? sum / n : null;
                        };
                        for (const m of others) {
                            const aH = avgPosFix(m, m.homeTeam), aA = avgPosFix(m, m.awayTeam);
                            if (aH == null || aA == null) continue;
                            const fav = aH <= aA ? m.homeTeam : m.awayTeam;
                            watch.push({ m, fav, aFav: Math.min(aH, aA), aOther: Math.max(aH, aA), swing: Math.abs(aH - aA) });
                        }
                        watch.sort((a, b) => b.swing - a.swing);
                    }
                } catch (e) { dist = null; watch = null; }
                return { pos0, allUp, list, dist, trend, watch, modelOk: !!model };
            } catch (e) { return null; }
        }
        // v2.21 : scénarios des concurrents — l'impact des prochains matchs des autres équipes sur la position des Lynx
        function renderHomeScenarios(ranking, matches) {
            const el = document.getElementById('home-scenarios');
            if (!el) return;
            try {
                const data = computeScenariosData(matches, ranking);
                const pos0 = data ? data.pos0 : Math.max(0, ranking.findIndex(r => normalize(r.team).includes('valence')));
                const posTxt = (p) => p == null ? '?' : p + (p === 1 ? 'ᵉʳ' : 'e');
                // v2.22 : résumé en une phrase en tête d'accueil — position, points, prochain match, match à surveiller
                try {
                    const ol = document.getElementById('home-oneliner');
                    if (ol) {
                        const bits = [];
                        const lynxRow = ranking.find(r => normalize(r.team).includes('valence'));
                        if (lynxRow) bits.push(`📍 <span class="font-bold">${posTxt(pos0 + 1)}</span> · ${lynxRow.pts} pts`);
                        const nm = (matches || []).filter(m => m.season === activeSeason && (!m.type || m.type === 'Saison') && !isMatchFinished(m) && (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence'))).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
                        if (nm) { const d = new Date(nm.date); const ds = isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); const home = normalize(nm.homeTeam).includes('valence'); bits.push(`🗓️ ${ds} — ${home ? 'à domicile contre' : 'en déplacement à'} <span class="font-bold">${home ? nm.awayTeam : nm.homeTeam}</span>`); }
                        if (data && data.watch && data.watch.length) { const w = data.watch[0]; bits.push(`👁️ À surveiller : ${w.m.homeTeam} – ${w.m.awayTeam} (victoire <span class="font-bold text-green-600 dark:text-green-400">${w.fav}</span> favorable)`); }
                        if (bits.length) { ol.classList.remove('hidden'); ol.innerHTML = `<div class="bg-white/70 dark:bg-dark-card/70 backdrop-blur-lg p-3 rounded-xl shadow-lg border-l-4 border-lynx-dark dark:border-gray-500 text-center text-xs md:text-sm text-gray-600 dark:text-gray-300">${bits.join(' <span class="text-gray-300 dark:text-gray-600">·</span> ')}</div>`; }
                        else ol.classList.add('hidden');
                    }
                } catch (e) {}
                if (!data) { el.innerHTML = ''; return; }
                const list = data.list;
                const probTxt = (pr) => pr == null ? '' : ` <span class="text-[10px] font-bold text-gray-400">(≈ ${pr < 0.01 ? '&lt; 1' : Math.round(pr * 100)} % de chances)</span>`;
                const lineHtml = (l) => {
                    if (l.mean) {
                        const eH = l.eH == null ? '?' : l.eH.toFixed(1), eA = l.eA == null ? '?' : l.eA.toFixed(1);
                        return `<div>${l.lynx ? '🦁 ' : ''}${xmlEsc(l.m.homeTeam)} – ${xmlEsc(l.m.awayTeam)} : <b class="text-gray-600 dark:text-gray-300">${eH} – ${eA}</b> pt(s) attendus</div>`;
                    }
                    // code couleur : l'équipe qui DOIT gagner en vert — « (ap) » = victoire en prolongation (barème 2/1)
                    return `<div>${l.lynx ? '🦁 ' : ''}${xmlEsc(l.m.homeTeam)} – ${xmlEsc(l.m.awayTeam)} : <span class="text-green-600 dark:text-green-400 font-bold">${xmlEsc(l.w)}</span> gagne${l.ot ? ' <i>(après prolong.)</i>' : ''}</div>`;
                };
                const rowsHtml = list.map(sc => {
                    const cls = sc.pos == null ? 'text-gray-500' : (sc.pos < pos0 + 1 ? 'text-green-600 dark:text-green-400' : (sc.pos > pos0 + 1 ? 'text-red-500 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'));
                    const lines = sc.lines.map(lineHtml).join('');
                    return `<div class="py-2 border-t border-gray-100 dark:border-gray-700/60 flex items-start gap-2"><span class="text-base leading-5">${sc.ico}</span><div class="flex-1 min-w-0"><div class="flex items-baseline gap-2 flex-wrap"><span class="text-xs font-bold">${sc.lbl}</span><span class="text-sm font-black ${cls}">→ Lynx ${posTxt(sc.pos)}</span>${probTxt(sc.prob)}</div><div class="mt-0.5 grid grid-cols-1 sm:grid-cols-2 gap-x-3 text-[10px] text-gray-400 leading-snug">${lines}</div></div></div>`;
                }).join('');
                const distLine = (data.dist && data.dist.length)
                    ? `<div class="text-center text-[11px] font-bold">📈 Dans 10 jours, place la plus probable : <span class="text-lynx-red">${posTxt(data.dist[0].pos)}</span> <span class="text-gray-400 font-normal">(${data.dist[0].pct} % des simulations)</span></div>`
                    : '';
                const trendLine = data.trend
                    ? `<div class="text-center text-[11px] font-bold mt-0.5">⬆️ Monter : <span class="text-green-600 dark:text-green-400">${data.trend.up} %</span> <span class="text-gray-300 dark:text-gray-600">·</span> ➡️ Garder : <span class="text-gray-600 dark:text-gray-300">${data.trend.same} %</span> <span class="text-gray-300 dark:text-gray-600">·</span> ⬇️ Descendre : <span class="text-red-500 dark:text-red-400">${data.trend.down} %</span> <span class="text-gray-400 font-normal">(actuellement ${posTxt(pos0 + 1)})</span></div>`
                    : '';
                const placesLine = (data.dist && data.dist.length > 1)
                    ? `<div class="text-center text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">📊 Répartition : ${data.dist.slice(0, 4).sort((a, b) => a.pos - b.pos).map(d => `<span class="font-bold ${d.pos < pos0 + 1 ? 'text-green-600 dark:text-green-400' : d.pos === pos0 + 1 ? 'text-gray-600 dark:text-gray-300' : 'text-red-500 dark:text-red-400'}">${posTxt(d.pos)} ${d.pct} %</span>`).join(' <span class="text-gray-300 dark:text-gray-600">·</span> ')}</div>`
                    : '';
                const watchList = (data.watch || []).filter(w => w.swing >= 0.3).slice(0, 3);
                const watchHtml = watchList.length
                    ? `<details class="mt-2"><summary class="text-[10px] font-bold text-gray-400 hover:text-lynx-red cursor-pointer text-center uppercase tracking-wider select-none">👁️ Matchs à surveiller (${watchList.length})</summary><div class="mt-2 space-y-1.5">${watchList.map(w => { const dt = new Date(w.m.date); const ds = isNaN(dt) ? '' : dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); const other = w.fav === w.m.homeTeam ? w.m.awayTeam : w.m.homeTeam; return `<div class="text-[10px] text-gray-500 dark:text-gray-400 leading-snug"><span class="font-bold text-gray-600 dark:text-gray-300">${w.m.homeTeam} – ${w.m.awayTeam}</span> <span class="text-gray-400">(${ds})</span> → victoire <span class="font-bold text-green-600 dark:text-green-400">${w.fav}</span> = la meilleure pour les Lynx <span class="text-gray-400">(place moyenne ${String(w.aFav.toFixed(1)).replace('.', ',')} contre ${String(w.aOther.toFixed(1)).replace('.', ',')} si ${other} gagne)</span></div>`; }).join('')}</div></details>`
                    : '';
                el.innerHTML = `<div class="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700"><h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 text-center uppercase tracking-wider">🎲 Scénarios (10 prochains jours)</h4>${distLine}${trendLine}${placesLine}${watchHtml}<details class="mt-2"><summary class="text-[10px] font-bold text-gray-400 hover:text-lynx-red cursor-pointer text-center uppercase tracking-wider select-none">▼ Voir le détail des 5 scénarios</summary><p class="text-[10px] text-gray-400 text-center mt-2 mb-1">Actuellement ${pos0 + 1}${pos0 === 0 ? 'ᵉʳ' : 'e'} · le % d'un scénario = chance de CETTE combinaison exacte de résultats (d'où des petits chiffres) · 🎯 = issue favorable aux Lynx dès qu'elle a au moins 1 chance sur 3</p>${rowsHtml}</details></div>`;
            } catch (e) { el.innerHTML = ''; }