// ===== MOTEUR DE PRONOSTICS : Poisson, absents, Monte-Carlo, cotes, jauge, prévisions =====
        // (le commentaire « IMPORT HANDLERS » hérité du monolithe est un orphelin : il précède ici le moteur, à deleter si gênant)
        // --- IMPORT HANDLERS ---
        // ==================== MOTEUR DE PRÉDICTION (Poisson + forme + dom/ext) ====================
        const factorial = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
        const poissonPmf = (lambda, k) => Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);

        function buildPoolModel(matches) {
            const st = {};
            const lastTs = matches.length ? Math.max(...matches.map(m => new Date(m.date).getTime() || 0)) : 0;
            matches.forEach(m => {
                const ageW = Math.max(0, (lastTs - (new Date(m.date).getTime() || lastTs)) / (7 * 24 * 3600e3));
                const w = Math.pow(0.92, ageW); // décroissance temporelle : un match perd 8 % de poids par semaine
                const acc = (team, gf, ga, isHome) => {
                    const k = normalize(team);
                    if (!st[k]) st[k] = { team, homeGF: 0, homeGA: 0, homeM: 0, homeN: 0, awayGF: 0, awayGA: 0, awayM: 0, awayN: 0, form: [], lastTs: 0 };
                    const s = st[k];
                    if (isHome) { s.homeGF += w * gf; s.homeGA += w * ga; s.homeM += w; s.homeN++; } else { s.awayGF += w * gf; s.awayGA += w * ga; s.awayM += w; s.awayN++; }
                    const ts = new Date(m.date).getTime() || 0;
                    if (ts > (s.lastTs || 0)) s.lastTs = ts;
                    s.form.push(matchPoints(isHome ? gf : ga, isHome ? ga : gf, m.isProl));
                };
                acc(m.homeTeam, m.scoreHome, m.scoreAway, true);
                acc(m.awayTeam, m.scoreAway, m.scoreHome, false);
            });
            const n = matches.length || 1;
            return { stats: st, nowTs: lastTs, avgHomeGF: matches.reduce((s, m) => s + (m.scoreHome || 0), 0) / n, avgAwayGF: matches.reduce((s, m) => s + (m.scoreAway || 0), 0) / n };
        }

        // v2.18 : facteur absence — absents/blessés déclarés en Admin (blessés, suspendus).
        // JAMAIS appliqué à une date déjà passée : le backtest rejoue l'historique à l'identique,
        // la fiabilité mesurée et les badges des matchs joués restent purs.
        function absencesAt(teamName, ts) {
            const t = normalize(teamName || '');
            if (!t || !Array.isArray(absentPlayers) || !absentPlayers.length) return [];
            const dt = (ts != null && !isNaN(new Date(ts))) ? new Date(ts) : new Date();
            const day = dt.toISOString().slice(0, 10);
            return absentPlayers.filter(a => a && normalize(a.team) === t && String(a.from || '') <= day && (!a.to || String(a.to) >= day));
        }
        function absenceShare(teamName, playerName) {
            const t = normalize(teamName || ''), pn = normalize(playerName || '');
            if (!pn) return null;
            let tot = 0, mine = 0;
            (leaguePlayers || []).forEach(p => {
                if (String(p.season) !== String(activeSeason)) return;
                if (normalize(String(p.team || '')) !== t) return;
                const pts = Number(p.pts) || 0;
                tot += pts;
                if (normalize(String(p.name || '')) === pn) mine += pts;
            });
            if (!tot) return null;
            return Math.min(0.45, mine / tot); // part des points de l'équipe portée par ce joueur
        }
        function absenceAdj(teamName, matchTs) {
            if (!matchTs || isNaN(new Date(matchTs)) || new Date(matchTs).getTime() < Date.now()) return { att: 1, gk: false, n: 0 };
            const act = absencesAt(teamName, matchTs);
            if (!act.length) return { att: 1, gk: false, n: 0 };
            let share = 0, gk = false;
            act.forEach(a => {
                if (String(a.pos) === 'G') { gk = true; return; }
                const s = absenceShare(a.team, a.name);
                share += (s != null) ? s : 0.15; // joueur inconnu en base → part forfaitaire raisonnable
            });
            return { att: Math.max(0.6, 1 - Math.min(0.4, share)), gk, n: act.length };
        }
        function predictMatch(model, homeTeam, awayTeam, matchTs) {
            const st = model.stats;
            const h = st[normalize(homeTeam)], a = st[normalize(awayTeam)];
            // Forces attaque/défense, distinctes à domicile vs à l'extérieur
            const hAtt = h && h.homeM ? h.homeGF / h.homeM : model.avgHomeGF;
            const hDef = h && h.homeM ? h.homeGA / h.homeM : model.avgAwayGF;
            const aAtt = a && a.awayM ? a.awayGF / a.awayM : model.avgAwayGF;
            const aDef = a && a.awayM ? a.awayGA / a.awayM : model.avgHomeGF;
            // Forme sur les 5 derniers matchs (0 à 1)
            const formFactor = (s) => { const f = s ? s.form.slice(-5) : []; return f.length ? f.reduce((x, y) => x + y, 0) / (f.length * 3) : 0.5; };
            const fh = formFactor(h), fa = formFactor(a);
            const lamH0 = Math.max(0.15, ((hAtt + aDef) / 2) * (0.85 + 0.3 * fh));
            const lamA0 = Math.max(0.15, ((aAtt + hDef) / 2) * (0.85 + 0.3 * fa));
            // Fatigue : une équipe qui a joué il y a moins de 30 h (back-to-back) voit son attaque réduite de 10 %
            const lamH = (matchTs && h && h.lastTs && (matchTs - h.lastTs) < 30 * 3600e3) ? lamH0 * 0.9 : lamH0;
            const lamA = (matchTs && a && a.lastTs && (matchTs - a.lastTs) < 30 * 3600e3) ? lamA0 * 0.9 : lamA0;
            // v2.18 : facteur absence — attaque réduite selon la part de points des absents,
            // attaque adverse facilitée de 12 % si le gardien titulaire manque à l'appel.
            const adjH = absenceAdj(homeTeam, matchTs), adjA = absenceAdj(awayTeam, matchTs);
            const lamHF = lamH * adjH.att * (adjA.gk ? 1.12 : 1);
            const lamAF = lamA * adjA.att * (adjH.gk ? 1.12 : 1);
            let pH = 0, pA = 0, pT = 0, best = { p: 0, s: [0, 0] };
            for (let i = 0; i <= 9; i++) for (let j = 0; j <= 9; j++) {
                const p = poissonPmf(lamHF, i) * poissonPmf(lamAF, j);
                if (i > j) pH += p; else if (j > i) pA += p; else pT += p;
                if (p > best.p) best = { p, s: [i, j] };
            }
            // Prolongation : répartition selon la forme relative
            const otHc = Math.min(0.75, Math.max(0.25, 0.5 + (fh - fa) * 0.3));
            const pHomeWin = pH + pT * otHc, pAwayWin = pA + pT * (1 - otHc);
            const eH = 3 * pH + 2 * (pT * otHc) + 1 * (pT * (1 - otHc));
            const eA = 3 * pA + 2 * (pT * (1 - otHc)) + 1 * (pT * otHc);
            // Confiance selon le volume de données des deux équipes
            const sample = Math.min(h ? (h.homeN || h.homeM) : 0, a ? (a.awayN || a.awayM) : 0);
            const conf = Math.max(0.2, Math.min(0.95, 0.25 + 0.13 * sample));
            // v2.18 : jamais de nul au pronostic — si le score le plus probable est un nul, on le garde comme
            // score de fin de temps réglementaire et on désigne un vainqueur en prolongation.
            const expDraw = best.s[0] === best.s[1];
            const expWinner = pHomeWin >= pAwayWin ? 'H' : 'A';
            // v2.22 : probabilités détaillées pour le barème FFHG des scénarios (V=3, V-prol=2, D-prol=1, D=0)
            return { pHomeWin, pAwayWin, pT, pH, pA, otHc, expScore: best.s, expDraw, expWinner, ePts: [eH, eA], conf, absN: adjH.n + adjA.n, lamH: lamHF, lamA: lamAF };
        }

        function backtestModel(season, poules) {
            // Rejoue chaque match déjà joué avec SEULEMENT les données antérieures → mesure la fiabilité réelle
            const done = allMatches.filter(m => m.season === season && isMatchFinished(m) && (!m.type || m.type === 'Saison')).sort((a, b) => new Date(a.date) - new Date(b.date));
            if (done.length < 8) return { acc: null, sample: 0, hist: {} };
            const hist = {};
            let correct = 0, total = 0;
            for (let i = 6; i < done.length; i++) {
                const m = done[i];
                const g = poules ? (m.poule || 'B').toUpperCase() : '';
                const prior = done.slice(0, i).filter(x => (poules ? (x.poule || 'B').toUpperCase() : '') === g);
                if (prior.length < 3) continue;
                const model = buildPoolModel(prior);
                const p = predictMatch(model, m.homeTeam, m.awayTeam, new Date(m.date).getTime());
                hist[m.id] = { s: p.expScore, pH: p.pHomeWin, pA: p.pAwayWin, d: p.expDraw, w: p.expWinner };
                const actual = m.scoreHome > m.scoreAway ? 'H' : (m.scoreAway > m.scoreHome ? 'A' : null);
                if (!actual) continue;
                total++;
                if ((p.pHomeWin >= p.pAwayWin ? 'H' : 'A') === actual) correct++;
            }
            return { acc: total >= 4 ? correct / total : null, sample: total, hist };
        }

        function monteCarlo(agg, preds, spots, n) {
            const res = {};
            if (!preds.length) { Object.keys(agg).forEach(k => res[k] = 1); return res; }
            const counts = {};
            for (let s = 0; s < n; s++) {
                const pts = {};
                Object.entries(agg).forEach(([k, a]) => { pts[k] = a.cur; });
                preds.forEach(p => {
                    const homeWins = Math.random() < p.pHomeWin;
                    const winner = homeWins ? p.match.homeTeam : p.match.awayTeam;
                    const loser = homeWins ? p.match.awayTeam : p.match.homeTeam;
                    const ot = Math.random() < 0.4;
                    const wk = normalize(winner), lk = normalize(loser);
                    pts[wk] = (pts[wk] || 0) + (ot ? 2 : 3);
                    if (ot) pts[lk] = (pts[lk] || 0) + 1;
                });
                Object.entries(pts).sort((a, b) => b[1] - a[1]).slice(0, spots).forEach(([k]) => { counts[k] = (counts[k] || 0) + 1; });
            }
            Object.keys(counts).forEach(k => res[k] = counts[k] / n);
            return res;
        }

        function computeForecast(season) {
            const poules = seasonHasPoules(season);
            const spots = getFormat(season).playoffSpots || 8;
            const groups = poules ? ['A', 'B'] : [''];
            const groupsOut = {};
            const projections = {};
            const bt = backtestModel(season, poules);
            groups.forEach(g => {
                const all = allMatches.filter(m => m.season === season && (!m.type || m.type === 'Saison') && (!poules || (m.poule || 'B').toUpperCase() === g));
                const played = all.filter(m => isMatchFinished(m));
                if (!played.length) return;
                const model = buildPoolModel(played);
                const csvRows = (poules ? (g === 'A' ? rankingA : rankingB) : [...rankingA, ...rankingB]).filter(r => r.season === season);
                const curRank = computeLiveRanking(season, poules ? g : 'B', csvRows);
                const agg = {};
                curRank.forEach(t => { agg[normalize(t.team)] = { team: t.team, cur: t.pts || 0, mj: t.mj || 0, exp: 0, remM: 0 }; });
                played.forEach(m => [m.homeTeam, m.awayTeam].forEach(t => { const k = normalize(t); if (!agg[k]) agg[k] = { team: t, cur: 0, mj: 0, exp: 0, remM: 0 }; }));
                const rem = all.filter(m => !isMatchFinished(m));
                const preds = [];
                rem.forEach(m => {
                    const p = predictMatch(model, m.homeTeam, m.awayTeam, new Date(m.date).getTime());
                    preds.push({ match: m, ...p });
                    const hA = agg[normalize(m.homeTeam)], aA = agg[normalize(m.awayTeam)];
                    if (hA) { hA.exp += p.ePts[0]; hA.remM++; }
                    if (aA) { aA.exp += p.ePts[1]; aA.remM++; }
                });
                const pPO = monteCarlo(agg, preds, spots, 400);
                const table = Object.values(agg).map(a => ({ ...a, projPts: a.cur + a.exp, minPts: a.cur, maxPts: a.cur + 3 * a.remM, pPO: pPO[normalize(a.team)] || 0 })).sort((x, y) => y.projPts - x.projPts || (y.cur - x.cur));
                groupsOut[g] = { table, preds };
                table.forEach(t => projections[normalize(t.team)] = { expectedPts: t.projPts, remaining: t.remM, cur: t.cur });
            });
            return { groups: groupsOut, reliability: bt.acc, backtestSample: bt.sample, histPreds: bt.hist || {}, projections };
        }

        let forecastCache = { key: '', data: null };
        // v2.22 : les prévisions ne se recalculent qu'à la JOURNÉE complète (demande d'Ugo) — rentrer un match
        // d'une journée en cours ne fait plus bouger les prévisions des autres matchs du même jour.
        function doneJourneesCount(season) {
            const ms = (allMatches || []).filter(m => m && m.season === season && (!m.type || m.type === 'Saison'));
            const groups = {};
            ms.forEach(m => { const k = m.journee || ('d:' + String(m.date || '').slice(0, 10)); (groups[k] = groups[k] || []).push(m); });
            let done = 0;
            Object.values(groups).forEach(g => {
                // une journée est « complète » quand tous ses matchs ont un score — ou quand un match sans score
                // date de plus de 21 jours (reporté sans reprogrammation : il ne doit pas figer les prévisions)
                if (g.every(m => isMatchFinished(m) || (!isMatchFinished(m) && m.date && (Date.now() - new Date(m.date).getTime()) > 21 * 864e5))) done++;
            });
            return done;
        }
        function getForecast(season) {
            const doneCount = allMatches.filter(m => m.season === season && isMatchFinished(m)).length;
            const doneJ = doneJourneesCount(season);
            const key = season + '|' + doneJ + '|' + JSON.stringify(seasonFormats[season] || {});
            if (forecastCache.key === key && forecastCache.data) return forecastCache.data;
            let data = null;
            try { if (doneCount >= 4) data = computeForecast(season); } catch (e) { console.error('Forecast error', e); data = null; }
            forecastCache = { key, data };
            return data;
        }

        // ==================== v2.21 : stats avancées & visuels (Monte-Carlo accueil, buts attendus, fiabilité, heatmap, radar) ====================
        let liveProbModel = null; // modèle de saison en cache pour la jauge de probabilité en direct
        function poissonSample(l) { if (!(l > 0)) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }

        // ⚽ Marché des buts sur la carte du prochain match (Poisson du site — 0 IA)
        function renderGoalsMarket(m) {
            try {
                const el = document.getElementById('upcoming-match-content');
                if (!el || !m) return;
                const played = allMatches.filter(x => x.season === activeSeason && (!x.type || x.type === 'Saison') && isMatchFinished(x));
                if (played.length < 3) return;
                const p = predictMatch(buildPoolModel(played), m.homeTeam, m.awayTeam, new Date(m.date).getTime());
                const lamT = (p.lamH || 0) + (p.lamA || 0);
                if (!(lamT > 0.2)) return;
                let cum = 0; for (let k = 0; k <= 5; k++) cum += poissonPmf(lamT, k);
                const over = Math.round((1 - cum) * 100);
                const btts = Math.round((1 - Math.exp(-(p.lamH || 0))) * (1 - Math.exp(-(p.lamA || 0))) * 100);
                el.insertAdjacentHTML('beforeend', `<div class="mt-2 text-[11px] font-bold text-gray-500 dark:text-gray-300 text-center" title="Modèle Poisson du site (attaque/défense, forme, domicile/extérieur)">⚽ Buts attendus : ${lamT.toFixed(1).replace('.', ',')} · +5,5 buts : <span class="text-lynx-red">${over} %</span> · Les deux marquent : <span class="text-lynx-red">${btts} %</span></div>`);
            } catch (e) {}
        }

        // 🏆 + 🎯 Monte-Carlo playoffs & courbe de fiabilité sur l'accueil (réutilise le moteur de prévisions, en cache)
        function updateHomeForecast() {
            try {
                const poEl = document.getElementById('home-playoffs-odds');
                const rlEl = document.getElementById('home-reliability-svg');
                if (!poEl && !rlEl) return;
                const fc = getForecast(activeSeason);
                if (poEl) {
                    let html = '';
                    if (fc && fc.groups) {
                        const poules = seasonHasPoules(activeSeason);
                        const grp = fc.groups[poules ? 'B' : ''] || Object.values(fc.groups)[0];
                        const row = grp && grp.table ? grp.table.find(t => normalize(t.team).includes('valence')) : null;
                        if (row && row.pPO != null) {
                            const pct = Math.round((row.pPO || 0) * 100);
                            const pos = grp.table.indexOf(row) + 1;
                            html = `<div class="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700"><div class="text-[9px] uppercase font-bold text-gray-400 tracking-wider text-center mb-1">🏆 Probabilité de playoffs — saison jouée 400 fois par le modèle</div><div class="flex items-center justify-center gap-4"><div class="text-3xl font-black tabular-nums ${pct >= 50 ? 'text-green-600' : 'text-amber-500'}">${pct} %</div><div class="text-[11px] text-gray-500 dark:text-gray-300">position projetée : <b>${pos}e</b><br>total projeté : <b>~${Math.round(row.projPts)} pts</b> (${row.remM} match(s) restant(s))</div></div><div class="mt-2 h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 max-w-sm mx-auto"><div class="h-full bg-green-500 transition-all duration-700" style="width:${pct}%"></div></div></div>`;
                        }
                    }
                    poEl.innerHTML = html;
                }
                if (rlEl) {
                    let html = '';
                    const hist = fc && fc.histPreds ? fc.histPreds : null;
                    if (hist) {
                        const done = allMatches.filter(m => m.season === activeSeason && isMatchFinished(m) && (!m.type || m.type === 'Saison')).sort((a, b) => new Date(a.date) - new Date(b.date));
                        const pts = []; let ok = 0, tot = 0;
                        done.forEach(m => {
                            const h = hist[m.id];
                            if (!h) return;
                            const actual = m.scoreHome > m.scoreAway ? 'H' : (m.scoreAway > m.scoreHome ? 'A' : null);
                            if (!actual) return;
                            tot++;
                            if ((h.pH >= h.pA ? 'H' : 'A') === actual) ok++;
                            if (tot >= 4) pts.push({ n: tot, pct: Math.round(100 * ok / tot) });
                        });
                        if (pts.length >= 3) {
                            const W = 560, H = 120, padL = 32, padR = 44, padT = 12, padB = 16;
                            const fx = (n) => padL + (n - 1) / Math.max(1, pts.length - 1) * (W - padL - padR);
                            const fy = (p) => padT + (100 - p) / 100 * (H - padT - padB);
                            let g = `<line x1="${padL}" y1="${fy(50).toFixed(1)}" x2="${W - padR}" y2="${fy(50).toFixed(1)}" stroke="rgba(128,128,128,0.35)" stroke-dasharray="3 3"/><text x="${padL - 5}" y="${(fy(50) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#9CA3AF">50 %</text><line x1="${padL}" y1="${fy(100).toFixed(1)}" x2="${W - padR}" y2="${fy(100).toFixed(1)}" stroke="rgba(128,128,128,0.15)" stroke-dasharray="3 3"/><text x="${padL - 5}" y="${(fy(100) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#9CA3AF">100 %</text>`;
                            g += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + fx(p.n).toFixed(1) + ' ' + fy(p.pct).toFixed(1)).join(' ')}" fill="none" stroke="#D90429" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
                            pts.forEach(p => { g += `<circle cx="${fx(p.n).toFixed(1)}" cy="${fy(p.pct).toFixed(1)}" r="3" fill="#D90429"><title>Après ${p.n} matchs rejoués : ${p.pct} % de vainqueurs corrects</title></circle>`; });
                            const last = pts[pts.length - 1];
                            g += `<text x="${(fx(last.n) + 5).toFixed(1)}" y="${(fy(last.pct) + 3).toFixed(1)}" font-size="10" font-weight="900" fill="#D90429">${last.pct} %</text>`;
                            html = `<div class="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700"><div class="text-[9px] uppercase font-bold text-gray-400 tracking-wider text-center mb-1">🎯 Fiabilité du modèle, match après match (backtest sans triche)</div><svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">${g}</svg></div>`;
                        }
                    }
                    rlEl.innerHTML = html;
                }
            } catch (e) { console.warn('updateHomeForecast', e); }
        }

        // 🕸️ Radar comparé du Face-à-Face (5 axes, saison en cours)
        function teamSeasonMetrics(team) {
            const nk = normalize(team);
            const ms = allMatches.filter(m => m.season === activeSeason && (!m.type || m.type === 'Saison') && isMatchFinished(m) && (normalize(m.homeTeam) === nk || normalize(m.awayTeam) === nk));
            let bp = 0, bc = 0, pts = 0;
            ms.forEach(m => { const h = normalize(m.homeTeam) === nk; bp += h ? m.scoreHome : m.scoreAway; bc += h ? m.scoreAway : m.scoreHome; pts += matchPoints(h ? m.scoreHome : m.scoreAway, h ? m.scoreAway : m.scoreHome, m.isProl); });
            const n = ms.length || 1;
            const last5 = ms.slice(-5);
            let f5 = 0; last5.forEach(m => { const h = normalize(m.homeTeam) === nk; f5 += matchPoints(h ? m.scoreHome : m.scoreAway, h ? m.scoreAway : m.scoreHome, m.isProl); });
            return { n: ms.length, att: bp / n, def: bc / n, pts: pts / n, f5: last5.length ? f5 / (last5.length * 3) : 0.5, diff: (bp - bc) / n };
        }
        function renderH2HRadar(tA, tB) {
            const host = document.getElementById('h2h-radar');
            if (!host) return;
            try {
                if (!tA || !tB) { host.innerHTML = ''; return; }
                const A = teamSeasonMetrics(tA), B = teamSeasonMetrics(tB);
                if (!A.n || !B.n) { host.innerHTML = ''; return; }
                const axes = [['Attaque', A.att, B.att], ['Défense', -A.def, -B.def], ['Forme (5)', A.f5, B.f5], ['Rendement', A.pts, B.pts], ['Diff. buts', A.diff, B.diff]];
                const R = 82, cx = 110, cy = 108;
                const pt = (i, v) => { const ang = -Math.PI / 2 + i * 2 * Math.PI / axes.length; return [cx + Math.cos(ang) * R * v, cy + Math.sin(ang) * R * v]; };
                let g = '';
                [0.25, 0.5, 0.75, 1].forEach(r => { g += `<polygon points="${axes.map((_, i) => pt(i, r).map(x => x.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="rgba(128,128,128,0.25)"/>`; });
                axes.forEach((ax, i) => { const p = pt(i, 1.22); g += `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" font-size="9" font-weight="bold" text-anchor="middle" fill="#9CA3AF">${ax[0]}</text>`; });
                const sc = (raw, i) => { if (i === 2) return Math.max(0.08, Math.min(0.98, raw)); const pair = [axes[i][1], axes[i][2]]; const lo = Math.min(pair[0], pair[1], 0), hi = Math.max(pair[0], pair[1], 0.001); return 0.15 + 0.75 * (raw - lo) / ((hi - lo) || 1); };
                const poly = (vals, col) => `<polygon points="${vals.map((v, i) => pt(i, v).map(x => x.toFixed(1)).join(',')).join(' ')}" fill="${col}" fill-opacity="0.22" stroke="${col}" stroke-width="2"/>`;
                g += poly(axes.map((ax, i) => sc(ax[1], i)), '#D90429') + poly(axes.map((ax, i) => sc(ax[2], i)), '#0369A1');
                host.innerHTML = `<div class="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700"><div class="text-[9px] uppercase font-bold text-gray-400 tracking-wider text-center mb-1">🕸️ Radar comparé (saison en cours)</div><div class="flex justify-center gap-4 text-[10px] font-bold mb-1"><span class="text-lynx-red">■ ${xmlEsc(tA)}</span><span class="text-sky-700 dark:text-sky-400">■ ${xmlEsc(tB)}</span></div><svg viewBox="0 0 220 220" class="w-full max-w-[340px] mx-auto h-auto">${g}</svg></div>`;
            } catch (e) { host.innerHTML = ''; }
        }

        // ⏱️ Heatmap : quand les Lynx marquent (et encaissent), par tranche de 10 min — depuis les rapports live
        async function renderGoalsTiming() {
            const el = document.getElementById('chart-goals-timing');
            if (!el) return;
            try {
                const reps = (await dbFetchCol('live-reports')).map(d => d.data).filter(r => r && Array.isArray(r.events) && r.date && (!r.season || String(r.season) === String(activeSeason)));
                const buckets = Array.from({ length: 7 }, () => ({ f: 0, c: 0 }));
                const bIdx = (min) => Math.max(0, Math.min(6, Math.floor(min / 10)));
                reps.forEach(r => {
                    const lynxHome = normalize(r.homeTeam || '').includes('valence');
                    (r.events || []).forEach(e => {
                        if (!e || !e.time) return;
                        const mm = String(e.time).match(/(\d+)/);
                        if (!mm) return;
                        const bucketIdx = bIdx(Number(mm[1]));
                        if (e.ty === 'BUT') {
                            buckets[bucketIdx][(e.side === 'H') === lynxHome ? 'f' : 'c']++;
                        } else if (e.ty === 'TIR') {
                            buckets[bucketIdx].s = (buckets[bucketIdx].s || 0) + 1;
                        }
                    });
                });
                const totF = buckets.reduce((s, b) => s + b.f, 0), totC = buckets.reduce((s, b) => s + b.c, 0), totS = buckets.reduce((s, b) => s + (b.s || 0), 0);
                if (!totF && !totC) { el.innerHTML = '<div class="text-xs text-gray-400 italic text-center py-4">Aucun but enregistré dans les matchs suivis en direct — la heatmap se remplira au fil des matchs.</div>'; return; }
                
const maxV = Math.max(1, ...buckets.map(b => Math.max(b.f, b.c)));
const maxS = Math.max(1, ...buckets.map(b => b.s || 0));

const W = 560;
const H = 170;
const padL = 26;
const padB = 28;
const bw = (W - padL - 12) / 7;

const shotH = totS > 0 ? (H - padB - 6) * 0.15 : 0;
                
                
                let g = '';
                buckets.forEach((b, i) => {
                    const x = padL + i * bw;
                    // v2.23 : Ajouter les tirs en arrière-plan (petits points gris clair)
                    if (b.s && b.s > 0 && totS > 0) {
                        const sh = Math.min(shotH, (H - padB - 6) * b.s / maxS);
                        const yShot = H - padB - sh;
                        for (let j = 0; j < Math.min(b.s, 5); j++) {
                            const offset = j * 3;
                            g += `<circle cx="${(x + bw / 2 + offset - 6).toFixed(1)}" cy="${(yShot + j * 2).toFixed(1)}" r="1.5" fill="#E5E7EB" opacity="0.6"><title>Tirs : ${b.s}</title></circle>`;
                        }
                        if (b.s > 5) {
                            g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(yShot - 2).toFixed(1)}" font-size="8" text-anchor="middle" fill="#9CA3AF">+${b.s}</text>`;
                        }
                    }
                    const hf = (H - padB - 6) * b.f / maxV, hc = (H - padB - 6) * b.c / maxV;
                   
                    g += `<rect x="${(x + 2).toFixed(1)}" y="${(H - padB - hf).toFixed(1)}" width="${(bw / 2 - 3).toFixed(1)}" height="${Math.max(0, hf).toFixed(1)}" fill="#D90429" rx="2"><title>Buts Lynx ${i === 6 ? '60 min et +' : i * 10 + '-' + (i * 10 + 10) + ' min'} : ${b.f}</title></rect>`;
                    g += `<rect x="${(x + bw / 2 + 1).toFixed(1)}" y="${(H - padB - hc).toFixed(1)}" width="${(bw / 2 - 3).toFixed(1)}" height="${Math.max(0, hc).toFixed(1)}" fill="#64748B" rx="2"><title>Buts encaissés : ${b.c}</title></rect>`;
                    g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - padB + 12}" font-size="9" text-anchor="middle" fill="#9CA3AF">${i === 6 ? '60+' : i * 10}</text>`;
                });
                g += `<line x1="${padL}" y1="${H - padB}" x2="${W - 12}" y2="${H - padB}" stroke="rgba(128,128,128,0.4)"/>`;
                const legend = '<div class="flex justify-center gap-4 text-[10px] font-bold text-gray-500 mt-1"><span><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:#D90429"></span> Buts Lynx (' + totF + ')</span><span><span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:#64748B"></span> Buts encaissés (' + totC + ')</span>' + (totS > 0 ? '<span><span class="inline-block w-2.5 h-2.5 rounded-full" style="background:#E5E7EB"></span> Tirs (' + totS + ')</span>' : '') + '</div>';
                el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">${g}</svg>` + legend;
            } catch (e) { console.warn('renderGoalsTiming', e); }
        }

        // Pronostic à afficher sur une ligne de calendrier : à venir = modèle actuel ; joué = pronostic rejoué avant-match
        // v2.22 : filet de sécurité — prédiction d'un match JOUÉ recalculée à la volée (uniquement avec les matchs
        // d'AVANT, sans tricher) quand elle manque au backtest : le badge 🔮 reste affiché quoi qu'il arrive
        // (cache figé par une journée avec un match reporté, match recréé/restauré, import…).
        const pastPredMemo = new Map();
        function pastPredOnTheFly(m) {
            try {
                const key = activeSeason + '|' + doneJourneesCount(activeSeason);
                const hit = pastPredMemo.get(m.id);
                if (hit && hit.key === key) return hit.val;
                const t0 = new Date(m.date).getTime();
                const inPoule = seasonHasPoules(m.season) ? (x) => (x.poule || 'B').toUpperCase() === (m.poule || 'B').toUpperCase() : () => true;
                const prior = (allMatches || []).filter(x => x && x.season === m.season && (!x.type || x.type === 'Saison') && isMatchFinished(x) && new Date(x.date).getTime() < t0 && inPoule(x));
                if (prior.length < 3) return null;
                const p = predictMatch(buildPoolModel(prior), m.homeTeam, m.awayTeam, t0);
                const actW = m.scoreHome > m.scoreAway ? 'H' : (m.scoreAway > m.scoreHome ? 'A' : null);
                const val = { past: true, s: p.expScore, pct: Math.round(Math.max(p.pHomeWin, p.pAwayWin) * 100), exact: p.expScore[0] === m.scoreHome && p.expScore[1] === m.scoreAway, right: !!actW && (p.pHomeWin >= p.pAwayWin ? 'H' : 'A') === actW, draw: !!p.expDraw, w: p.expWinner };
                pastPredMemo.set(m.id, { key, val });
                return val;
            } catch (e) { return null; }
        }
        function getMatchPredInfo(m) {
            try {
                if (!m || m.season !== activeSeason || (m.type && m.type !== 'Saison')) return null;
                const fc = getForecast(activeSeason);
                if (!fc) return null;
                if (isMatchFinished(m)) {
                    const h = (fc.histPreds || {})[m.id];
                    if (!h) return pastPredOnTheFly(m); // v2.22 : une prédiction jouée ne disparaît jamais
                    const exact = h.s[0] === m.scoreHome && h.s[1] === m.scoreAway;
                    const predW = h.pH >= h.pA ? 'H' : 'A';
                    const actW = m.scoreHome > m.scoreAway ? 'H' : (m.scoreAway > m.scoreHome ? 'A' : null);
                    return { past: true, s: h.s, pct: Math.round(Math.max(h.pH, h.pA) * 100), exact, right: !!actW && predW === actW, draw: !!h.d, w: h.w };
                }
                const gk = seasonHasPoules(activeSeason) ? (m.poule || 'B').toUpperCase() : '';
                const grp = fc.groups[gk];
                if (!grp || !grp.preds) return null;
                const p = grp.preds.find(x => x.match && (x.match.id === m.id || (x.match.date === m.date && x.match.homeTeam === m.homeTeam && x.match.awayTeam === m.awayTeam)));
                if (!p) return null;
                return { past: false, s: p.expScore, pct: Math.round(Math.max(p.pHomeWin, p.pAwayWin) * 100), fiab: Math.round((fc.reliability || 0.5) * p.conf * 100), draw: !!p.expDraw, w: p.expWinner };
            } catch (e) { return null; }
        }

        function renderForecasts(forecast) {
            const wrap = document.getElementById('forecasts-content');
            const relWrap = document.getElementById('forecast-reliability');
            if (!wrap) return;
            if (!forecast || !Object.keys(forecast.groups).length) {
                if (relWrap) relWrap.innerHTML = '';
                wrap.innerHTML = '<div class="bg-white/70 dark:bg-dark-card/70 p-6 rounded-xl shadow-xl text-center text-gray-500 italic">Pas encore assez de résultats joués pour lancer les prévisions (quelques matchs requis).</div>';
                return;
            }
            const acc = forecast.reliability;
            if (relWrap) {
                relWrap.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                    <div class="bg-white/70 dark:bg-dark-card/70 p-4 rounded-xl shadow-xl border-l-4 ${acc ? (acc >= 0.55 ? 'border-green-500' : 'border-yellow-500') : 'border-gray-400'}">
                        <div class="text-[10px] uppercase font-bold text-gray-500 mb-1">Fiabilité du modèle (backtest sur les matchs déjà joués)</div>
                        <div class="flex items-center gap-3"><span class="text-3xl font-black ${acc ? (acc >= 0.55 ? 'text-green-500' : 'text-yellow-500') : 'text-gray-400'}">${acc ? Math.round(acc * 100) + '%' : '—'}</span>
                        <span class="text-xs text-gray-500">${forecast.backtestSample ? 'Vainqueur correctement prédit sur ' + forecast.backtestSample + ' matchs rejoués (Poisson + forme + dom/ext).' : 'Moins de 8 matchs joués : fiabilité pas encore mesurable.'}</span></div>
                    </div>
                    <div class="bg-white/70 dark:bg-dark-card/70 p-4 rounded-xl shadow-xl border-l-4 border-lynx-red">
                        <div class="text-[10px] uppercase font-bold text-gray-500 mb-1">Barème appliqué (D1 & D2)</div>
                        <div class="text-xs text-gray-600 dark:text-gray-300 font-semibold">Victoire : 3 pts (2 après prolong./TAB) &bull; Défaite : 0 pt (1 après prolong./TAB)</div>
                    </div>
                </div>`;
            }
            const poules = seasonHasPoules(activeSeason);
            let html = '';
            Object.entries(forecast.groups).forEach(([g, gr]) => {
                const title = poules ? (g === 'A' ? 'Poule A' : 'Poule B') : 'Championnat';
                html += `<div class="bg-white/70 dark:bg-dark-card/70 p-4 md:p-6 rounded-xl shadow-xl">
                    <h3 class="text-xl font-bold mb-4 flex items-center"><i class="fa-solid fa-chart-line mr-2 text-lynx-red"></i> Projection Finale — ${title}</h3>
                    <div class="overflow-x-auto"><table class="w-full text-left text-sm md:text-base">
                        <thead class="ranking-header"><tr>
                            <th class="p-3 rounded-tl-lg">#</th><th class="p-3">Équipe</th>
                            <th class="p-3 text-center">Pts</th><th class="p-3 text-center">Projeté</th>
                            <th class="p-3 text-center hidden md:table-cell">Min–Max</th><th class="p-3 text-center hidden md:table-cell">Reste</th>
                            <th class="p-3 text-center rounded-tr-lg" title="Probabilité de finir en zone playoff (Monte-Carlo)">Playoffs</th>
                        </tr></thead>
                        <tbody class="divide-y dark:divide-gray-700">
                        ${gr.table.map((t, i) => {
                            const isL = normalize(t.team).includes('valence');
                            const ppo = Math.round((t.pPO || 0) * 100);
                            const totalT = gr.table.length;
                            const fmtZ = getFormat(activeSeason);
                            const poS = fmtZ.playoffSpots || 8;
                            const mtS = fmtZ.maintienSpots || 0;
                            const inPO = i < poS;
                            const inMT = mtS > 0 && i >= totalT - mtS;
                            const zStyle = isL ? '' : (inMT ? 'background:rgba(239,68,68,0.07);' : (inPO ? 'background:rgba(16,185,129,0.07);' : ''));
                            const zBorder = (i === poS && i < totalT) ? 'border-top:3px solid #10b981;' : ((mtS > 0 && i === totalT - mtS && i > 0) ? 'border-top:3px solid #ef4444;' : '');
                            return `<tr class="${isL ? 'bg-red-50 dark:bg-red-900/20' : ''}"${(zStyle || zBorder) ? ` style="${zStyle}${zBorder}"` : ''}>
                                <td class="p-3 font-bold">${i + 1}</td>
                                <td class="p-3 flex items-center gap-2"><img src="${getLogo(t.team)}" class="w-5 h-5 object-contain" onerror="this.style.display='none'"><span class="truncate max-w-[120px] md:max-w-none">${t.team}</span></td>
                                <td class="p-3 text-center font-bold">${t.cur}</td>
                                <td class="p-3 text-center font-black ${isL ? 'text-lynx-red' : ''}">${Math.round(t.projPts)}</td>
                                <td class="p-3 text-center text-xs text-gray-500 hidden md:table-cell">${t.minPts}–${t.maxPts}</td>
                                <td class="p-3 text-center text-xs text-gray-500 hidden md:table-cell">${t.remM}</td>
                                <td class="p-3">
                                    <div class="flex items-center gap-2"><div class="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"><div class="h-full ${ppo >= 70 ? 'bg-green-500' : (ppo >= 35 ? 'bg-yellow-500' : 'bg-red-500')}" style="width:${ppo}%"></div></div><span class="text-xs font-bold w-9 text-right">${ppo}%</span></div>
                                </td>
                            </tr>`;
                        }).join('')}
                        </tbody></table></div>
                </div>`;
                if (gr.preds && gr.preds.length) {
                    html += `<div class="bg-white/70 dark:bg-dark-card/70 p-4 md:p-6 rounded-xl shadow-xl">
                        <h3 class="text-xl font-bold mb-4 flex items-center"><i class="fa-solid fa-crosshairs mr-2 text-lynx-red"></i> Pronostics du modèle — ${title} (${gr.preds.length} matchs restants)</h3>
                        <div class="space-y-2">
                        ${[...gr.preds].sort((a, b) => new Date(a.match.date) - new Date(b.match.date)).map(p => {
                            const pw = Math.round(p.pHomeWin * 100);
                            const isLynx = normalize(p.match.homeTeam).includes('valence') || normalize(p.match.awayTeam).includes('valence');
                            const fiab = Math.round((acc || 0.5) * p.conf * 100);
                            return `<div class="flex flex-wrap items-center gap-2 p-2 rounded-lg ${isLynx ? 'bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/40' : 'bg-gray-50 dark:bg-gray-800/50'} text-sm">
                                <span class="text-[10px] text-gray-400 font-bold w-16 hidden md:inline">${new Date(p.match.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                                <span class="flex-1 min-w-[90px] text-right truncate font-bold">${p.match.homeTeam}</span>
                                <span class="text-xs text-gray-400 font-black">vs</span>
                                <span class="flex-1 min-w-[90px] truncate font-bold">${p.match.awayTeam}</span>
                                <span class="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded font-bold" title="Score le plus probable${p.expDraw ? ' (après prolongation)' : ''}">${p.expScore[0]}–${p.expScore[1]}${p.expDraw ? ' <span class="text-[9px] text-gray-400 font-bold">ap</span>' : ''}</span>
                                <div class="w-20 md:w-28 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex"><div class="h-full bg-blue-500" style="width:${pw}%"></div><div class="h-full bg-red-500" style="width:${100 - pw}%"></div></div>
                                <span class="text-[10px] font-bold w-16 text-right">${pw}% / ${100 - pw}%</span>
                                <span class="text-[9px] w-16 text-right ${fiab >= 55 ? 'text-green-600 font-bold' : 'text-gray-400'}" title="Fiabilité = justesse du modèle (backtest) × volume de données des équipes">Fiab. ${fiab}%</span>
                            </div>`;
                        }).join('')}
                        </div>
                    </div>`;
                }
            });
            wrap.innerHTML = html || '<div class="text-center text-gray-400 italic p-4">Aucune donnée.</div>';
        }