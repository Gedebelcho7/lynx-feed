// ===================== v2.22 : STATS LIVE DE SAISON =====================
        // Moteur unique : une seule lecture des déroulés (memo 2 min), stats par équipe pour
        // l'accueil, le comparateur et la fiche adverse. Rien n'est inventé : tout vient des
        // événements archivés (live-reports) et du calendrier.
        // v2.22 : explications des stats — discrètes (ⓘ qui déplie 2 phrases au clic, compatible mobile)
        const STATS_EXPLAIN = {
            pp: 'Buts marqués en supériorité numérique divisés par les occasions (pénalités adverses). Au-dessus de 20-25 %, c\'est très bon.',
            pk: 'Part des pénalités « tuées » sans encaisser : 1 − (buts encaissés en infériorité ÷ pénalités prises). Au-dessus de 80 %, c\'est solide.',
            fb: 'Part des matchs où l\'équipe ouvre le score, et victoires dans ces matchs. Marquer le premier change tout : l\'équipe qui mène gagne beaucoup plus souvent.',
            comeback: 'Victoires après avoir été mené à la fin du 2e tiers. Signe de caractère : l\'équipe sait renverser un match mal engagé.',
            late: 'Buts marqués et encaissés dans les 5 dernières minutes du temps réglementaire. Révèle la condition physique et la gestion de fin de match.',
            resp: 'Temps moyen entre un but encaissé et la réponse. Court = l\'équipe ne doute pas ; long = elle s\'enfonce dans le match.',
            eq: 'Retours au score : buts qui remettent à égalité après avoir été mené, et victoires obtenues ensuite.',
            close: 'Matchs à un but d\'écart : victoires / total. Gagner les matchs serrés est une compétence à part entière — c\'est souvent ce qui sépare deux niveaux proches.',
            bounce: 'Résultat du match qui suit une défaite. Mesure la capacité à se relever et à casser les spirales négatives.',
            streak: 'Série de victoires ou de défaites en cours, et records de la saison. Le momentum pèse sur la confiance.',
            pen: 'Minutes de pénalité par match, et pénalités prises en fin de match. Trop de discipline coûte des buts — surtout en fin de rencontre.',
            dep: 'Part de victoires quand le meilleur buteur marque. Haut = l\'équipe dépend de lui ; bas = l\'attaque est partagée.',
            duo: 'Paire buteur → assistant la plus fréquente de la saison, issue des déroulés archivés.',
            conc: 'Part des buts marquée par les 3 meilleurs buteurs. Haut = attaque concentrée, plus facile à neutraliser ; bas = attaque diffuse.',
            solo: 'Buts marqués sans assistance. Souvent des buts d\'individu : frappe, rush, récupération haute.',
            dec: 'Joueur qui compte le plus de buts décisifs (le but qui met le vainqueur en avance pour de bon).',
            xpts: 'Points que le modèle donne à l\'équipe d\'après ses matchs (barème V=3, Vp=2, Dp=1). Plus que les points réels = sur-performance (ça redescend en général) ; moins = malchance (ça remonte).',
            shots: 'Tirs cadrés par match, issus des déroulés archivés. Meilleur signal d\'activité offensive que les buts, qui dépendent aussi de la chance.',
            eff: 'Buts marqués pour 100 tirs cadrés. Mesure la finition : une équipe efficace marque peu mais juste.',
            dna: 'Répartition des buts par tranche de 5 minutes (rouge = marqués, gris = encaissés), calculée depuis les déroulés archivés des matchs suivis. Révèle les moments forts et les passages à vide.'
        };
        document.addEventListener('click', (ev) => {
            const si = ev.target && ev.target.closest ? ev.target.closest('.stat-info') : null;
            if (si) { ev.preventDefault(); const c = si.closest('.stat-chip'); const ex = c ? c.querySelector('.stat-exp') : null; if (ex) ex.classList.toggle('hidden'); return; }
            const dc = ev.target && ev.target.closest ? ev.target.closest('.delete-clip-btn') : null;
            if (dc) { ev.preventDefault(); appConfirm('Supprimer cet écho presse ?', async () => { try { await deleteDoc(doc(db, basePath + '/press-clips/' + dc.dataset.id)); } catch (e) {} }); }
        });
        let _sstatsCache = { at: 0, key: '', v: null };
        function perPair2(x) { if (Array.isArray(x)) return [Number(x[0]) || 0, Number(x[1]) || 0]; const s = String(x || '').split('-'); return [Number(s[0]) || 0, Number(s[1]) || 0]; }
        function parseScorer(detail) { // « N° 17 Ugo Giffon (assist. N° 9 Jean Test, N° 11 Autre Test) » → { g, a }
            const s = String(detail || '').replace(/\s+/g, ' ').trim();
            const noNum = (v) => String(v || '').replace(/^n\s*°?\s*\d+\s*/i, '').trim();
            const m = s.match(/^(.*?)\s*\(\s*assist\.?\s*([^)]*)\s*\)/i);
            if (!m) return { g: noNum(s.split('(')[0]), a: '' };
            return { g: noNum(m[1]), a: noNum(String(m[2]).split(/[,;]/)[0]) };
        }
        const fmtMMSS = (sec) => Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
        const pctOrDash = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '—');
        async function seasonLiveStats() {
            const key = String(activeSeason);
            if (_sstatsCache.v && _sstatsCache.key === key && Date.now() - _sstatsCache.at < 120000) return _sstatsCache.v;
            const reps = (await dbFetchCol('live-reports')).map(d => ({ ...d.data, _id: d.id }))
                .filter(r => r && Array.isArray(r.events) && (!r.season || String(r.season) === String(activeSeason)))
                .filter(r => (r.homeTeam || '').trim() !== 'Domicile' && (r.awayTeam || '').trim() !== 'Visiteur' && (r.homeTeam || '').trim() !== '' && (r.awayTeam || '').trim() !== '');
            const T = {};
            const acc = (nm) => { const k = normalize(nm || '?'); if (!T[k]) T[k] = { name: nm || '?', rep: 0, gfRep: 0, gf: 0, ga: 0, mj: 0, w: 0, wot: 0, l: 0, lot: 0, pts: 0, realPts: 0, xPts: 0, xN: 0, closeW: 0, closeN: 0, behind2W: 0, behind2N: 0, eq: 0, eqW: 0, resp: [], late: 0, lateGa: 0, supG: 0, ppOcc: 0, infGa: 0, penN: 0, penMin: 0, pen5: 0, solo: 0, fbN: 0, fbW: 0, shotsF: 0, shotsAg: 0, shotsN: 0, scorers: {}, duos: {}, decW: {}, bounceN: 0, bounceW: 0, streak: 0, bestW: 0, bestL: 0, form: [], rest: { a: [0, 0], b: [0, 0], c: [0, 0] }, vsOpp: {}, vsTop: [0, 0], vsBot: [0, 0] }; return T[k]; };
            // 1) déroulés archivés : événements (buts, pénalités, timings, individuel)
            reps.forEach(rep => {
                const h = acc(rep.homeTeam || 'Domicile'), a = acc(rep.awayTeam || 'Visiteur');
                h.rep++; a.rep++;
                const evs = (rep.events || []).filter(e => e && (e.ty === 'BUT' || /PEN|PUN|SANCTION/i.test(String(e.ty || '')))).sort((x, y) => (Number(x.t) || 0) - (Number(y.t) || 0)); // v2.22 : le flux FFHG nomme les pénalités « SANCTION » (dur dans le flux, non archivé → 2 min par défaut)
                const goals = [];
                evs.forEach(e => {
                    const t = Number(e.t) || 0;
                    if (e.ty === 'BUT') {
                        let side = e.side === 'A' ? 'A' : 'H';
                        const csc = /\bcsc\b/i.test(String(e.who || ''));
                        if (csc) side = side === 'H' ? 'A' : 'H'; // but contre son camp : crédité à l'autre équipe
                        const team = side === 'H' ? h : a, opp = side === 'H' ? a : h;
                        const sh = goals.filter(g => g.side === 'H').length + (side === 'H' ? 1 : 0);
                        const sa = goals.filter(g => g.side === 'A').length + (side === 'A' ? 1 : 0);
                        goals.push({ t, side, sh, sa });
                        team.gfRep++;
                        if (e.sit === 'SUP') { team.supG++; opp.infGa++; }
                        if (t >= 3500) { team.late++; opp.lateGa++; }
                        const sc = parseScorer(e.who);
                        if (sc.g) team.scorers[sc.g] = (team.scorers[sc.g] || 0) + 1;
                        if (sc.a) { const dk = sc.g + ' → ' + sc.a; team.duos[dk] = (team.duos[dk] || 0) + 1; } else team.solo++;
                    } else {
                        const team = e.side === 'A' ? a : h, opp = e.side === 'A' ? h : a;
                        team.penN++; opp.ppOcc++;
                        const mm = String(e.who || e.time || '').match(/(\d+)\s*(?:min|x2|x5)/i);
                        team.penMin += mm ? Number(mm[1]) : 2;
                        if (t >= 3500) team.pen5++;
                    }
                });
                // séquence de buts : 1er but, égalisations, temps de réponse, buts décisifs
                const lastC = { H: -1, A: -1 }; let eqH = false, eqA = false;
                goals.forEach(g => {
                    const team = g.side === 'H' ? h : a;
                    const before = g.side === 'H' ? (g.sh - 1) - g.sa : (g.sa - 1) - g.sh;
                    const after = g.side === 'H' ? g.sh - g.sa : g.sa - g.sh;
                    if (before < 0 && after === 0) { team.eq++; if (g.side === 'H') eqH = true; else eqA = true; }
                    if (lastC[g.side] >= 0) { team.resp.push(Math.max(0, g.t - lastC[g.side])); lastC[g.side] = -1; }
                    lastC[g.side === 'H' ? 'A' : 'H'] = g.t;
                });
                const fh = Number(rep.scoreHome) || 0, fa = Number(rep.scoreAway) || 0;
                if (goals.length) {
                    const fs = goals[0].side, ft = fs === 'H' ? h : a;
                    ft.fbN++;
                    if ((fs === 'H' ? fh : fa) > (fs === 'H' ? fa : fh)) ft.fbW++;
                }
                // but décisif : le but qui met le vainqueur en avance pour de bon
                const winSide = fh > fa ? 'H' : (fa > fh ? 'A' : null);
                if (winSide) {
                    const winTeam = winSide === 'H' ? h : a;
                    const lead = (sd) => sd === 'H' ? (g2) => g2.sh > g2.sa : (g2) => g2.sa > g2.sh;
                    for (let i = 0; i < goals.length; i++) {
                        if (goals[i].side !== winSide) continue;
                        let ok = true;
                        for (let j = i; j < goals.length; j++) { if (!lead(winSide)(goals[j])) { ok = false; break; } }
                        if (ok) { const sc = parseScorer((rep.events || []).filter(e => e && e.ty === 'BUT').sort((x, y) => (Number(x.t) || 0) - (Number(y.t) || 0))[i] ? ((rep.events || []).filter(e => e && e.ty === 'BUT').sort((x, y) => (Number(x.t) || 0) - (Number(y.t) || 0))[i].who || '') : ''); if (sc.g) winTeam.decW[sc.g] = (winTeam.decW[sc.g] || 0) + 1; break; }
                    }
                }
                if (eqH && fh > fa) h.eqW++; if (eqA && fa > fh) a.eqW++;
                // bilan match (barème FFHG : V=3, Vp=2, Dp=1)
                h.mj++; a.mj++; h.gf += fh; h.ga += fa; a.gf += fa; a.ga += fh;
                h.shotsF += Number(rep.shotsH) || 0; h.shotsAg += Number(rep.shotsA) || 0; h.shotsN++; a.shotsF += Number(rep.shotsA) || 0; a.shotsAg += Number(rep.shotsH) || 0; a.shotsN++; // v2.22 : tirs cadrés exploités
                const prol = !!rep.isProl;
                if (fh > fa) { h.pts += prol ? 2 : 3; if (prol) h.wot++; else h.w++; a.pts += prol ? 1 : 0; a.l++; if (prol) a.lot++; }
                else if (fa > fh) { a.pts += prol ? 2 : 3; if (prol) a.wot++; else a.w++; h.pts += prol ? 1 : 0; h.l++; if (prol) h.lot++; }
                // comeback : mené après 2 tiers et victoire
                const p0 = perPair2(rep.perT && rep.perT[0]), p1 = perPair2(rep.perT && rep.perT[1]);
                const s2h = p0[0] + p1[0], s2a = p0[1] + p1[1];
                if (s2h < s2a) { h.behind2N++; if (fh > fa) h.behind2W++; }
                if (s2a < s2h) { a.behind2N++; if (fa > fh) a.behind2W++; }
            });
            // 2) calendrier complet : forme, séries, rebond, repos, serrés, points réels/mérités, par adversaire
            const cal = (allMatches || []).filter(m => m && m.season === activeSeason && (!m.type || m.type === 'Saison') && isMatchFinished(m) && m.scoreHome != null && m.scoreAway != null).sort((x, y) => new Date(x.date) - new Date(y.date));
            const realPtsOf = (s, o, prol) => (s > o ? (prol ? 2 : 3) : (s < o ? (prol ? 1 : 0) : 1));
            const _xMemo = {};
            const xOf = (m) => {
                if (_xMemo[m.id] !== undefined) return _xMemo[m.id];
                let v = null;
                try {
                    const t0 = new Date(m.date).getTime();
                    const inP = seasonHasPoules(m.season) ? (x) => (x.poule || 'B').toUpperCase() === (m.poule || 'B').toUpperCase() : () => true;
                    const prior = cal.filter(x => new Date(x.date).getTime() < t0 && inP(x));
                    if (prior.length >= 3) {
                        const p = predictMatch(buildPoolModel(prior), m.homeTeam, m.awayTeam, t0);
                        const pT = Number(p.expDraw) || 0;
                        const otHc = (p.otHc != null) ? Number(p.otHc) : 0.5;
                        v = { xH: p.pHomeWin * 3 + pT * (otHc * 2 + (1 - otHc)), xA: p.pAwayWin * 3 + pT * ((1 - otHc) * 2 + otHc) };
                    }
                } catch (e) { v = null; }
                _xMemo[m.id] = v; return v;
            };
            const lastDate = {};
            const lastRes = {};
            cal.forEach(m => {
                const prol = !!m.isProl, sh = Number(m.scoreHome), sa = Number(m.scoreAway);
                [[m.homeTeam, sh, sa, 'H'], [m.awayTeam, sa, sh, 'A']].forEach(([nm, s, o]) => {
                    const t = acc(nm);
                    t.realPts += realPtsOf(s, o, prol);
                    const xv = xOf(m); if (xv) { t.xPts += (m.homeTeam === nm ? xv.xH : xv.xA); t.xN++; }
                    // matchs serrés
                    if (Math.abs(s - o) === 1) { t.closeN++; if (s > o) t.closeW++; }
                    // forme + séries
                    const res = s > o ? (prol ? 'Vp' : 'V') : (s < o ? (prol ? 'Dp' : 'D') : 'N');
                    t.form.push(res);
                    if (res === 'V' || res === 'Vp') { t.streak = t.streak > 0 ? t.streak + 1 : 1; t.bestW = Math.max(t.bestW, t.streak); }
                    else if (res === 'D' || res === 'Dp') { t.streak = t.streak < 0 ? t.streak - 1 : -1; t.bestL = Math.max(t.bestL, -t.streak); }
                    // rebond après défaite
                    if (lastRes[nm] && (lastRes[nm] === 'D' || lastRes[nm] === 'Dp')) { t.bounceN++; if (res === 'V' || res === 'Vp') t.bounceW++; }
                    lastRes[nm] = res;
                    // repos
                    const d = new Date(m.date).getTime();
                    if (lastDate[nm]) {
                        const gap = Math.round((d - lastDate[nm]) / 864e5);
                        const bk = gap <= 2 ? 'a' : (gap <= 6 ? 'b' : 'c');
                        t.rest[bk][0]++; t.rest[bk][1] += realPtsOf(s, o, prol);
                    }
                    lastDate[nm] = d;
                    // points pris par adversaire + top/bas de tableau
                    const opp = m.homeTeam === nm ? m.awayTeam : m.homeTeam;
                    if (!t.vsOpp[opp]) t.vsOpp[opp] = [0, 0];
                    t.vsOpp[opp][0] += realPtsOf(s, o, prol); t.vsOpp[opp][1]++;
                });
            });
            // 3) individuel dérivé : top buteur, dépendance, concentration, meilleur duo, buts décisifs
            const teams = Object.values(T);
            teams.forEach(t => {
                const sorted = Object.keys(t.scorers).sort((a, b) => t.scorers[b] - t.scorers[a]);
                t.top3 = sorted.slice(0, 3);
                t.topScorer = sorted[0] || '';
                t.topScorerGoals = t.topScorer ? t.scorers[t.topScorer] : 0;
                const g3 = t.top3.reduce((s, k) => s + t.scorers[k], 0);
                t.top3Share = t.gfRep ? Math.round((g3 / t.gfRep) * 100) : null;
                const dk = Object.keys(t.duos).sort((a, b) => t.duos[b] - t.duos[a])[0];
                t.topDuo = dk ? { label: dk, n: t.duos[dk] } : null;
                t.topDec = Object.keys(t.decW).sort((a, b) => t.decW[b] - t.decW[a])[0] || '';
                t.depN = 0; t.depW = 0;
                if (t.topScorer) reps.forEach(rep => {
                    const isH = normalize(rep.homeTeam || '') === normalize(t.name), isA = normalize(rep.awayTeam || '') === normalize(t.name);
                    if (!isH && !isA) return;
                    const side = isH ? 'H' : 'A';
                    let g2 = 0;
                    (rep.events || []).forEach(e => { if (e && e.ty === 'BUT' && e.who) { let sd = e.side === 'A' ? 'A' : 'H'; if (/\bcsc\b/i.test(String(e.who))) sd = sd === 'H' ? 'A' : 'H'; if (sd === side && parseScorer(e.who).g === t.topScorer) g2++; } });
                    if (g2) { t.depN++; const sh2 = Number(rep.scoreHome) || 0, sa2 = Number(rep.scoreAway) || 0; if ((side === 'H' ? sh2 : sa2) > (side === 'H' ? sa2 : sh2)) t.depW++; }
                });
            });
            const lx = teams.find(t => normalize(t.name).includes('valence')) || null;
            const v = { teams, lx, cal, reps, at: Date.now() };
            _sstatsCache = { at: Date.now(), key, v };
            return v;
        }

        // --- Rendu accueil : bloc stats live + points mérités + fiche du prochain adversaire ---
        async function renderLiveSeasonStats() {
            const el = document.getElementById('home-live-stats');
            if (!el) return;
            const brc = document.getElementById('btn-result-card');
            if (brc && !brc._wired) { brc._wired = true; brc.onclick = () => { try { makeResultCard(); } catch (e) {} }; }
            let S; try { S = await seasonLiveStats(); } catch (e) { el.innerHTML = ''; return; }
            const L = S.lx;
            if (!L || (!L.rep && !L.mj)) { el.innerHTML = ''; return; }
            const chip = (lab, val, sub, k) => '<div class="stat-chip bg-white/70 dark:bg-dark-card/70 p-3 rounded-xl shadow border-l-4 border-lynx-red"><div class="text-[10px] font-black uppercase tracking-wider text-gray-500">' + lab + (k && STATS_EXPLAIN[k] ? ' <span class="stat-info cursor-pointer align-middle text-gray-300 hover:text-lynx-red" title="Qu\'est-ce que c\'est ?">ⓘ</span>' : '') + '</div><div class="text-xl font-black text-lynx-red">' + val + '</div>' + (sub ? '<div class="text-[10px] text-gray-400">' + sub + '</div>' : '') + (k && STATS_EXPLAIN[k] ? '<div class="stat-exp hidden mt-1 pt-1 border-t border-gray-100 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 leading-snug">' + STATS_EXPLAIN[k] + '</div>' : '') + '</div>';
            const repSub = 'sur ' + L.rep + ' déroulé(s)';
            const pp = L.ppOcc ? Math.round((L.supG / L.ppOcc) * 100) + '%' : (L.supG ? L.supG + ' buts SN' : '—'), pk = L.penN ? Math.round((1 - L.infGa / L.penN) * 100) + '%' : (L.infGa ? L.infGa + ' encaissés SN' : '—'); // v2.22 : repli si le déroulé n'a aucune sanction
            const respAvg = L.resp.length ? fmtMMSS(L.resp.reduce((s, v) => s + v, 0) / L.resp.length) : '—';
            const chips = [
                chip('Supériorité (PP)', pp, L.supG + ' buts / ' + L.ppOcc + ' occasions', 'pp'),
                chip('Infériorité (PK)', pk, L.infGa + ' encaissés / ' + L.penN + ' sanctions', 'pk'),
                chip('1er but', pctOrDash(L.fbW, L.fbN), L.fbW + ' victoires quand on ouvre le score', 'fb'),
                chip('Comebacks', L.behind2N ? L.behind2W + '/' + L.behind2N : '—', 'victoires après avoir mené... nous être mené après 2 tiers', 'comeback'),
                chip('Buts 5 dernières min', L.late + ' - ' + L.lateGa, 'marqués - encaissés (t ≥ 58:20)', 'late'),
                chip('Temps de réponse', respAvg, 'délai moyen but encaissé → réponse', 'resp'),
                chip('Égalisations', L.eq + (L.eqW ? ' (' + L.eqW + ' gagnés)' : ''), 'retours au score', 'eq'),
                chip('Matchs serrés', L.closeN ? L.closeW + '/' + L.closeN : '—', 'à 1 but d\'écart', 'close'),
                chip('Après défaite', L.bounceN ? pctOrDash(L.bounceW, L.bounceN) : '—', L.bounceN + ' fois testé', 'bounce'),
                chip('Série en cours', L.streak > 0 ? L.streak + ' victoire(s)' : (L.streak < 0 ? (-L.streak) + ' défaite(s)' : '—'), 'record : ' + L.bestW + 'V / ' + L.bestL + 'D', 'streak'),
                chip('Pénalités', L.rep ? (L.penN ? (L.penMin / Math.max(L.rep, 1)).toFixed(1) + ' min/match' : '—') : '—', L.pen5 + ' dans les 5 dernières min', 'pen'),
                chip('Dépendance', L.depN != null && L.depN !== undefined && L.topScorer ? pctOrDash(L.depW, L.depN) : '—', L.topScorer ? 'victoires quand ' + L.topScorer + ' marque (' + L.topScorerGoals + ' buts)' : '', 'dep'),
                chip('Meilleur duo', L.topDuo ? L.topDuo.n + 'x' : '—', L.topDuo ? L.topDuo.label : '', 'duo'),
                chip('Concentration', L.top3Share != null ? L.top3Share + '%' : '—', 'des buts venant du top 3', 'conc'),
                chip('Buts solos', L.gfRep ? L.solo + ' (' + Math.round(L.solo / L.gfRep * 100) + '%)' : '—', 'sans assistance', 'solo'),
                chip('Buts décisifs', L.topDec ? L.topDec + ' (' + L.decW[L.topDec] + ')' : '—', 'meilleur buteur décisif', 'dec')
            ].join('');
            // points mérités vs réels — Valence + sur/sous-performeurs de la ligue
            let xHtml = '';
            const withX = S.teams.filter(t => t.xN >= 3);
            if (withX.length) {
                const diffs = withX.map(t => ({ t, d: t.realPts - t.xPts })).sort((a, b) => b.d - a.d);
                const over = diffs.slice(0, 3).map(x => xmlEsc(x.t.name) + ' (+' + Math.round(x.d) + ')').join(', ');
                const under = diffs.slice(-3).reverse().map(x => xmlEsc(x.t.name) + ' (' + Math.round(x.d) + ')').join(', ');
                const lxReal = L.realPts, lxX = Math.round(L.xPts), dLx = Math.round(L.realPts - L.xPts);
                xHtml = '<div class="mt-4 bg-white/70 dark:bg-dark-card/70 p-4 rounded-xl shadow border-l-4 border-purple-500">'
                    + '<div class="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">🎲 Points mérités vs réels (modèle — barème V=3, Vp=2, Dp=1)</div>'
                    + '<div class="text-sm font-bold">Valence : ' + lxReal + ' pts réels — ' + lxX + ' pts mérités (' + (dLx >= 0 ? '+' : '') + dLx + ' vs modèle)</div>'
                    + '<div class="grid md:grid-cols-2 gap-2 mt-2 text-xs text-gray-600 dark:text-gray-300"><div>📈 Sur-performeurs : ' + over + '</div><div>📉 Sous-performeurs : ' + under + '</div></div></div>';
            }
            // fiche du prochain adversaire
            let oppHtml = '';
            const nxt = (allMatches || []).filter(m => m && m.season === activeSeason && (!m.type || m.type === 'Saison') && !isMatchFinished(m) && (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence'))).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
            if (nxt) {
                const oppName = normalize(nxt.homeTeam).includes('valence') ? nxt.awayTeam : nxt.homeTeam;
                const O = S.teams.find(t => normalize(t.name) === normalize(oppName));
                const oCal = S.cal.filter(m => m.homeTeam === oppName || m.awayTeam === oppName).slice(-5);
                const formTxt = oCal.map(m => { const s = m.homeTeam === oppName ? m.scoreHome : m.scoreAway, o = m.homeTeam === oppName ? m.scoreAway : m.scoreHome; return s > o ? (m.isProl ? 'Vp' : 'V') : (s < o ? (m.isProl ? 'Dp' : 'D') : 'N'); }).join(' ');
                let oGf = 0, oGa = 0, oN = 0;
                S.cal.forEach(m => { if (m.homeTeam === oppName || m.awayTeam === oppName) { oN++; oGf += m.homeTeam === oppName ? m.scoreHome : m.scoreAway; oGa += m.homeTeam === oppName ? m.scoreAway : m.scoreHome; } });
                const lp = (leaguePlayers || []).filter(p => p && p.season === activeSeason && (normalize(p.team || '').includes(normalize(oppName)) || normalize(oppName).includes(normalize(p.team || '')))).sort((a, b) => (Number(b.goals) || 0) - (Number(a.goals) || 0))[0];
                const h2h = (allMatches || []).filter(m => isMatchFinished(m) && ((normalize(m.homeTeam).includes('valence') && normalize(m.awayTeam) === normalize(oppName)) || (normalize(m.awayTeam).includes('valence') && normalize(m.homeTeam) === normalize(oppName))));
                let lxW = 0, opW = 0; h2h.forEach(m => { const ls = normalize(m.homeTeam).includes('valence') ? m.scoreHome : m.scoreAway, os = normalize(m.homeTeam).includes('valence') ? m.scoreAway : m.scoreHome; if (ls > os) lxW++; else if (os > ls) opW++; });
                const cell = (lab, val) => '<div class="bg-gray-50 dark:bg-gray-800 p-2 rounded-lg"><div class="text-[10px] font-bold uppercase text-gray-400">' + lab + '</div><div class="text-sm font-black">' + val + '</div></div>';
                oppHtml = '<div class="mt-4 bg-white/70 dark:bg-dark-card/70 p-4 rounded-xl shadow border-l-4 border-lynx-dark">'
                    + '<div class="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">🎯 Fiche du prochain adversaire — ' + xmlEsc(oppName) + ' <span class="text-[10px] text-gray-400 font-normal normal-case">(' + new Date(nxt.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ')</span></div>'
                    + '<div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">'
                    + cell('Forme (5 derniers)', formTxt || '—')
                    + cell('Buts / match', oN ? (oGf / oN).toFixed(1) + ' - ' + (oGa / oN).toFixed(1) : '—')
                    + cell('Supériorité', O ? pctOrDash(O.supG, O.ppOcc) : '—')
                    + cell('Infériorité', O && O.penN ? Math.round((1 - O.infGa / O.penN) * 100) + '%' : '—')
                    + cell('Matchs serrés', O && O.closeN ? O.closeW + '/' + O.closeN : '—')
                    + cell('Pénalités', O && O.rep ? (O.penMin / Math.max(O.rep, 1)).toFixed(1) + ' min/match' : '—')
                    + cell('Meilleur buteur', lp ? xmlEsc(lp.name || '?') + ' (' + (Number(lp.goals) || 0) + 'B)' : (O && O.topScorer ? xmlEsc(O.topScorer) + ' (' + O.topScorerGoals + 'B)' : '—'))
                    + cell('Face-à-face', lxW + 'V - ' + opW + 'D')
                    + '</div></div>';
            }
            el.innerHTML = '<div class="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">'
                + '<h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">📊 Stats live de saison ' + (L.rep ? '<span class="text-[10px] normal-case text-gray-400">(' + L.rep + ' déroulé(s) archivé(s))</span>' : '') + '</h4>'
                + '<div class="grid grid-cols-2 md:grid-cols-4 gap-2">' + chips + '</div>'
                + xHtml + oppHtml
                + '</div>';
        }

        // --- Comparateur : bloc stats live côte à côte ---
        async function renderCompLiveStats(tA, tB) {
            const el = document.getElementById('comp-live-stats');
            if (!el) return;
            let S; try { S = await seasonLiveStats(); } catch (e) { return; }
            const A = S.teams.find(t => normalize(t.name) === normalize(tA)) || null;
            const B = S.teams.find(t => normalize(t.name) === normalize(tB)) || null;
            const calOf = (nm) => S.cal.filter(m => m.homeTeam === nm || m.awayTeam === nm);
            const cs = (nm) => { const ms = calOf(nm); let mj = 0, gf = 0, ga = 0, w = 0, pts = 0; ms.forEach(m => { const s = m.homeTeam === nm ? m.scoreHome : m.scoreAway, o = m.homeTeam === nm ? m.scoreAway : m.scoreHome; mj++; gf += s; ga += o; if (s > o) { w++; pts += m.isProl ? 2 : 3; } else if (s === o) pts += 1; else if (m.isProl) pts += 1; }); return { mj, avgGF: mj ? gf / mj : 0, avgGA: mj ? ga / mj : 0, winPct: mj ? (w / mj) * 100 : 0, pts }; };
            const cA = cs(tA), cB = cs(tB);
            const bar = (lab, va, vb, mx, col, sub, k) => '<div class="stat-chip mb-3"><div class="flex justify-between text-xs font-bold mb-1"><span class="' + (va > vb ? 'text-blue-600' : '') + '">' + va + (sub ? ' <span class="text-[9px] text-gray-400 font-normal">' + sub + '</span>' : '') + '</span><span class="text-gray-400 uppercase">' + lab + (k && STATS_EXPLAIN[k] ? ' <span class="stat-info cursor-pointer text-gray-300 hover:text-lynx-red" title="Qu\'est-ce que c\'est ?">ⓘ</span>' : '') + '</span><span class="' + (vb > va ? 'text-red-600' : '') + '">' + vb + '</span></div><div class="comp-bar-container"><div class="comp-bar-l ' + col + '" style="width:' + (mx ? (va / mx) * 100 : 0) + '%"></div><div class="comp-bar-r ' + col + '" style="width:' + (mx ? (vb / mx) * 100 : 0) + '%"></div></div>' + (k && STATS_EXPLAIN[k] ? '<div class="stat-exp hidden mt-1 text-[10px] text-gray-500 dark:text-gray-400 leading-snug">' + STATS_EXPLAIN[k] + '</div>' : '') + '</div>';
            const g = (t, f) => (t ? f(t) : '—');
            const respAvg = (t) => (t && t.resp.length ? fmtMMSS(t.resp.reduce((s, v) => s + v, 0) / t.resp.length) : '—');
            const streakTxt = (t) => (!t || t.streak === 0) ? '—' : (t.streak > 0 ? t.streak + 'V' : (-t.streak) + 'D');
            let html = '<h4 class="font-bold uppercase text-xs tracking-widest mb-4 border-b pb-2 dark:border-gray-700">Stats live de saison (déroulés archivés)</h4>';
            html += bar('Buts marqués / match', cA.avgGF.toFixed(2), cB.avgGF.toFixed(2), Math.max(cA.avgGF, cB.avgGF, 0.1), 'bg-green-500', cA.mj + ' MJ');
            html += bar('Buts encaissés / match', cA.avgGA.toFixed(2), cB.avgGA.toFixed(2), Math.max(cA.avgGA, cB.avgGA, 0.1), 'bg-orange-500');
            html += bar('% victoire', Math.round(cA.winPct) + '%', Math.round(cB.winPct) + '%', 100, 'bg-purple-500');
            html += bar('Points', cA.pts, cB.pts, Math.max(cA.pts, cB.pts, 1), 'bg-blue-500');
            html += bar('Tirs cadrés / match', g(A, t => (t.shotsN ? (t.shotsF / t.shotsN).toFixed(1) : '—')), g(B, t => (t.shotsN ? (t.shotsF / t.shotsN).toFixed(1) : '—')), Math.max(A && A.shotsN ? A.shotsF / A.shotsN : 0, B && B.shotsN ? B.shotsF / B.shotsN : 0, 1), 'bg-sky-500', '', 'shots'); // v2.22 : tirs cadrés exploités
            html += bar('Efficacité (buts / tir cadré)', g(A, t => (t.shotsN && t.shotsF ? Math.round((t.gfRep / t.shotsF) * 100) + '%' : '—')), g(B, t => (t.shotsN && t.shotsF ? Math.round((t.gfRep / t.shotsF) * 100) + '%' : '—')), 30, 'bg-emerald-600', '', 'eff');
            html += bar('Supériorité (PP)', g(A, t => (t.ppOcc ? pctOrDash(t.supG, t.ppOcc) : (t.supG ? t.supG + ' SN' : '—'))), g(B, t => (t.ppOcc ? pctOrDash(t.supG, t.ppOcc) : (t.supG ? t.supG + ' SN' : '—'))), 100, 'bg-red-500', '', 'pp');
            html += bar('Infériorité (PK)', g(A, t => (t.penN ? Math.round((1 - t.infGa / t.penN) * 100) + '%' : (t.infGa ? t.infGa + ' SN' : '—'))), g(B, t => (t.penN ? Math.round((1 - t.infGa / t.penN) * 100) + '%' : (t.infGa ? t.infGa + ' SN' : '—'))), 100, 'bg-cyan-600', '', 'pk');
            html += bar('Matchs serrés gagnés', g(A, t => (t.closeN ? t.closeW + '/' + t.closeN : '—')), g(B, t => (t.closeN ? t.closeW + '/' + t.closeN : '—')), Math.max(A ? A.closeN : 0, B ? B.closeN : 0, 1), 'bg-amber-500', '', 'close');
            html += bar('Mené après 2 tiers → victoire', g(A, t => (t.behind2N ? t.behind2W + '/' + t.behind2N : '—')), g(B, t => (t.behind2N ? t.behind2W + '/' + t.behind2N : '—')), Math.max(A ? A.behind2N : 0, B ? B.behind2N : 0, 1), 'bg-pink-500', '', 'comeback');
            html += bar('Temps de réponse', respAvg(A), respAvg(B), 60, 'bg-teal-500', '', 'resp');
            html += bar('Égalisations', g(A, t => t.eq), g(B, t => t.eq), Math.max(A ? A.eq : 0, B ? B.eq : 0, 1), 'bg-lime-500', '', 'eq');
            html += bar('Buts 5 dernières min', g(A, t => t.late), g(B, t => t.late), Math.max(A ? A.late : 0, B ? B.late : 0, 1), 'bg-red-700', '', 'late');
            html += bar('Pénalités / match', g(A, t => (t.rep && t.penN ? (t.penMin / Math.max(t.rep, 1)).toFixed(1) : '—')), g(B, t => (t.rep && t.penN ? (t.penMin / Math.max(t.rep, 1)).toFixed(1) : '—')), 20, 'bg-gray-500', '', 'pen');
            html += bar('Buts solos', g(A, t => t.solo), g(B, t => t.solo), Math.max(A ? A.solo : 0, B ? B.solo : 0, 1), 'bg-slate-500', '', 'solo');
            html += bar('1er but', g(A, t => (t.fbN ? pctOrDash(t.fbW, t.fbN) : '—')), g(B, t => (t.fbN ? pctOrDash(t.fbW, t.fbN) : '—')), 100, 'bg-yellow-500', '', 'fb');
            html += bar('Rebond après défaite', g(A, t => (t.bounceN ? pctOrDash(t.bounceW, t.bounceN) : '—')), g(B, t => (t.bounceN ? pctOrDash(t.bounceW, t.bounceN) : '—')), 100, 'bg-orange-400', '', 'bounce');
            html += bar('Concentration top 3', g(A, t => (t.top3Share != null ? t.top3Share + '%' : '—')), g(B, t => (t.top3Share != null ? t.top3Share + '%' : '—')), 100, 'bg-teal-600', '', 'conc');
            html += bar('Tirs concédés / match', g(A, t => (t.shotsN ? (t.shotsAg / t.shotsN).toFixed(1) : '—')), g(B, t => (t.shotsN ? (t.shotsAg / t.shotsN).toFixed(1) : '—')), Math.max(A && A.shotsN ? A.shotsAg / A.shotsN : 0, B && B.shotsN ? B.shotsAg / B.shotsN : 0, 1), 'bg-purple-400', '', 'shots');
            html += bar('Dépendance top buteur', g(A, t => (t.topScorer ? pctOrDash(t.depW, t.depN) : '—')), g(B, t => (t.topScorer ? pctOrDash(t.depW, t.depN) : '—')), 100, 'bg-indigo-500', '', 'dep');
            html += bar('Série en cours', streakTxt(A), streakTxt(B), 10, 'bg-emerald-500', '', 'streak');
            html += bar('Points réels vs mérités', g(A, t => t.xN ? t.realPts + ' / ' + Math.round(t.xPts) : '—'), g(B, t => t.xN ? t.realPts + ' / ' + Math.round(t.xPts) : '—'), Math.max(A ? A.realPts : 0, B ? B.realPts : 0, 1), 'bg-fuchsia-500', '', 'xpts');
            // points pris par adversaire
            const oppList = (t) => (t ? Object.keys(t.vsOpp).sort((a, b) => t.vsOpp[b][0] - t.vsOpp[a][0]).map(o => xmlEsc(o) + ' ' + t.vsOpp[o][0] + ' pts en ' + t.vsOpp[o][1] + ' match(s)').join('<br>') || '—' : '—');
            html += '<div class="grid md:grid-cols-2 gap-3 mt-4 text-xs"><div class="bg-white dark:bg-gray-800 p-3 rounded-lg"><div class="font-black uppercase text-[10px] text-gray-400 mb-1">Points pris par adversaire — ' + xmlEsc(tA) + '</div>' + oppList(A) + '</div><div class="bg-white dark:bg-gray-800 p-3 rounded-lg"><div class="font-black uppercase text-[10px] text-gray-400 mb-1">Points pris par adversaire — ' + xmlEsc(tB) + '</div>' + oppList(B) + '</div></div>';
            if (!A && !B) html = '<div class="text-xs text-gray-400 p-2">Aucun déroulé archivé pour ces équipes — utilise « Tout rattraper » dans Admin → Diagnostic.</div>';
            html += '<div class="mt-4 pt-4 border-t dark:border-gray-700"><div class="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">🕸️ Radar comparatif <span class="normal-case font-normal text-gray-400">(chaque axe = part du maximum des deux équipes)</span></div><canvas id="comp-radar" width="380" height="310" class="w-full max-w-md mx-auto"></canvas></div>';
            el.innerHTML = html;
            // v2.22-b : radar 6 axes — attaque, défense, PP, PK, discipline, forme
            try {
                const cv = document.getElementById('comp-radar');
                if (cv && A && B) {
                    const formPts = (t) => (t ? t.form.slice(-5).reduce((s, v) => s + (String(v)[0] === 'V' ? 3 : (String(v)[0] === 'N' ? 1 : 0)), 0) : 0);
                    const axes = [
                        ['Attaque', A.mj ? A.gf / A.mj : 0, B.mj ? B.gf / B.mj : 0, 5],
                        ['Défense', A.mj ? Math.max(0, 5 - A.ga / A.mj) : 0, B.mj ? Math.max(0, 5 - B.ga / B.mj) : 0, 5],
                        ['PP', A.ppOcc ? A.supG / A.ppOcc : 0, B.ppOcc ? B.supG / B.ppOcc : 0, 0.3],
                        ['PK', A.penN ? 1 - A.infGa / A.penN : 0, B.penN ? 1 - B.infGa / B.penN : 0, 1],
                        ['Discipline', A.rep && A.penN ? Math.max(0, 1 - (A.penMin / A.rep) / 20) : 0, B.rep && B.penN ? Math.max(0, 1 - (B.penMin / B.rep) / 20) : 0, 1],
                        ['Forme', formPts(A), formPts(B), 15]
                    ];
                    const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2 + 8, R = Math.min(W, H) / 2 - 36;
                    const dark = document.documentElement.classList.contains('dark');
                    ctx.clearRect(0, 0, W, H);
                    ctx.strokeStyle = dark ? '#374151' : '#e5e7eb'; ctx.lineWidth = 1;
                    for (let r = 1; r <= 4; r++) { ctx.beginPath(); for (let i = 0; i <= 6; i++) { const an = -Math.PI / 2 + i * Math.PI / 3; const x = cx + Math.cos(an) * R * r / 4, y = cy + Math.sin(an) * R * r / 4; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); }
                    ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = dark ? '#9ca3af' : '#6b7280';
                    axes.forEach((ax, i) => { const an = -Math.PI / 2 + i * Math.PI / 3; ctx.fillText(ax[0], cx + Math.cos(an) * (R + 22), cy + Math.sin(an) * (R + 22) + 4); });
                    const poly = (ti, col) => { ctx.beginPath(); axes.forEach((ax, i) => { const an = -Math.PI / 2 + i * Math.PI / 3; const v = Math.max(0.02, Math.min(1, ax[ti] / (ax[3] || 1))); const x = cx + Math.cos(an) * R * v, y = cy + Math.sin(an) * R * v; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = col + '33'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); };
                    poly(1, '#3b82f6'); poly(2, '#ef4444');
                    ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#3b82f6'; ctx.textAlign = 'left'; ctx.fillText('■ ' + xmlEsc(tA), 6, 14); ctx.fillStyle = '#ef4444'; ctx.textAlign = 'right'; ctx.fillText(xmlEsc(tB) + ' ■', W - 6, 14);
                }
            } catch (e) {}
        }

        // --- Admin → Diagnostic : contrôle de fraîcheur après chaque match joué ---
        let _freshAt = 0;
        function scheduleFreshness() { try { renderFreshness(false); } catch (e) {} }
        async function renderFreshness(force) {
            const el = document.getElementById('freshness-panel');
            if (!el) return;
            const b1 = document.getElementById('btn-fresh-recheck'), b2 = document.getElementById('btn-fetch-all-reports');
            if (b1 && !b1._wired) { b1._wired = true; b1.onclick = () => renderFreshness(true); }
            if (b2 && !b2._wired) { b2._wired = true; b2.onclick = () => { try { catchUpAllReports(); } catch (e) {} }; }
            if (!force && Date.now() - _freshAt < 60000) return;
            _freshAt = Date.now();
            el.innerHTML = '<div class="text-gray-400">Vérification…</div>';
            const row = (st, lab, det) => '<div class="p-2 rounded flex justify-between gap-2 ' + (st === 'ok' ? 'bg-green-100 dark:bg-green-900/30' : (st === 'warn' ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-red-100 dark:bg-red-900/30')) + '"><span class="font-bold">' + (st === 'ok' ? '🟢' : (st === 'warn' ? '🟠' : '🔴')) + ' ' + lab + '</span><span class="text-right">' + (det || '') + '</span></div>';
            const rows = [];
            const cal = (allMatches || []).filter(m => m && m.season === activeSeason && (!m.type || m.type === 'Saison'));
            const played = cal.filter(m => isMatchFinished(m)).sort((a, b) => new Date(b.date) - new Date(a.date));
            const last = played[0];
            let reps = [];
            try { reps = (await dbFetchCol('live-reports')).map(d => ({ ...d.data, _id: d.id })).filter(r => r && Array.isArray(r.events) && (!r.season || String(r.season) === String(activeSeason))); } catch (e) {}
            const repById = {}; reps.forEach(r => { repById[r._id] = r; });
            // 1) score du dernier match
            if (!last) rows.push(row('warn', 'Dernier match', 'aucun match joué cette saison'));
            else if (last.scoreHome == null || last.scoreHome === '') rows.push(row('err', 'Score du dernier match manquant', xmlEsc((last.homeTeam || '') + ' - ' + (last.awayTeam || '')) + ' (' + new Date(last.date).toLocaleDateString('fr-FR') + ')'));
            else rows.push(row('ok', 'Score du dernier match', last.scoreHome + ' - ' + last.scoreAway));
            // 2) déroulé + buteurs vs score
            const rep = last ? repById[last.id] : null;
            if (last && last.scoreHome != null && last.scoreHome !== '') {
                if (!rep) rows.push(row('err', 'Déroulé live manquant', 'le dernier match n\'est pas archivé en base'));
                else {
                    let gh = 0, ga = 0, missH = 0, missA = 0;
                    (rep.events || []).forEach(e => {
                        if (!e || e.ty !== 'BUT' || !e.who) return;
                        let sd = e.side === 'A' ? 'A' : 'H';
                        if (/\bcsc\b/i.test(String(e.who))) sd = sd === 'H' ? 'A' : 'H'; // tolérance csc
                        if (sd === 'H') gh++; else ga++;
                    });
                    const sh = Number(rep.scoreHome) || Number(last.scoreHome), sa = Number(rep.scoreAway) || Number(last.scoreAway);
                    if (gh === sh && ga === sa) rows.push(row('ok', 'Buteurs vs score', gh + ' - ' + ga + ' cohérents'));
                    else if (gh <= sh && ga <= sa) rows.push(row('warn', 'Buts manquants dans le déroulé', (sh - gh) + ' chez nous, ' + (sa - ga) + ' chez l\'adversaire'));
                    else rows.push(row('err', 'Buteurs incohérents avec le score', gh + ' - ' + ga + ' saisis vs ' + sh + ' - ' + sa));
                }
            }
            // 3) effectifs
            const gkOk = (goalies || []).length > 0, roOk = (roster || []).length > 0, lgN = (leaguePlayers || []).filter(p => p && p.season === activeSeason).length;
            rows.push(row(gkOk ? 'ok' : 'err', 'Gardiens', gkOk ? (goalies.length + ' fiche(s)') : 'base vide'));
            rows.push(row(roOk ? 'ok' : 'err', 'Effectif', roOk ? (roster.length + ' fiche(s)') : 'base vide'));
            rows.push(row(lgN ? 'ok' : 'err', 'Top ligue', lgN ? (lgN + ' joueurs saison ' + activeSeason) : 'aucun joueur de la saison'));
            // 4) classement affiché
            const rb = document.getElementById('ranking-table-body-home');
            const nRows = rb ? rb.children.length : 0;
            rows.push(row(nRows ? 'ok' : 'warn', 'Classement', nRows ? nRows + ' lignes affichées' : 'tableau vide'));
            // 5) matchs joués sans score
            const noScore = cal.filter(m => new Date(m.date).getTime() < Date.now() && (m.scoreHome == null || m.scoreHome === ''));
            rows.push(row(noScore.length ? 'warn' : 'ok', 'Matchs joués sans score', noScore.length ? noScore.slice(0, 4).map(m => xmlEsc((m.homeTeam || '') + ' - ' + (m.awayTeam || ''))).join(', ') + (noScore.length > 4 ? '…' : '') : 'aucun'));
            // 6) matchs de Valence joués sans déroulé (avec bouton de récupération)
            const lxPlayed = played.filter(m => (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence')) && m.scoreHome != null && m.scoreHome !== '');
            const noRep = lxPlayed.filter(m => !repById[m.id]);
            if (noRep.length) rows.push(row('err', 'Matchs Valence sans déroulé archivé (' + noRep.length + ')', noRep.slice(0, 4).map(m => '<span class="inline-flex items-center gap-1">' + xmlEsc((m.homeTeam || '').split(' ')[0]) + ' - ' + xmlEsc((m.awayTeam || '').split(' ')[0]) + ' <button class="retro-one-btn underline font-bold text-lynx-red" data-ffhg="' + xmlEsc(m.ffhgId || '') + '">🎬 récupérer</button></span>').join(' · ')));
            else rows.push(row('ok', 'Déroulés Valence', 'tous archivés'));
            // 7) article du dernier résultat
            if (last) {
                const oppLast = normalize(last.homeTeam).includes('valence') ? last.awayTeam : last.homeTeam;
                const artOk = (newsList || []).some(n => { const d = new Date(n.date || n.pubDate || 0).getTime(); return isFinite(d) && d >= new Date(last.date).getTime() - 36 * 3600e3 && normalize((n.title || '') + ' ' + (n.content || '')).includes(normalize(oppLast || '###')); });
                rows.push(row(artOk ? 'ok' : 'warn', 'Article du dernier résultat', artOk ? 'publié' : 'rien sur ' + xmlEsc(oppLast || '?') + ' depuis le match — Admin → News → « Article du dernier résultat »'));
            }
            // 8) âge des caches
            let baseAt = 0;
            try { const d = await getDoc(doc(db, basePath + '/settings/ffhg-rows')); if (d && d.exists && d.exists()) baseAt = Number((d.data() || {}).at) || 0; } catch (e) {}
            const agoTxt = (ms) => { if (!ms) return 'jamais'; const mn = Math.round(ms / 60000); return mn < 90 ? mn + ' min' : Math.round(mn / 60) + ' h'; };
            const sessAge = liveFfhgCheckedAt ? Date.now() - liveFfhgCheckedAt : 0;
            const baseAge = baseAt ? Date.now() - baseAt : 0;
            const cacheOk = (baseAt && baseAge < 6 * 3600e3) || (sessAge && sessAge < 30 * 60000);
            rows.push(row(cacheOk ? 'ok' : 'warn', 'Cache données FFHG', 'base : ' + agoTxt(baseAge) + ' — session : ' + agoTxt(sessAge)));
            el.innerHTML = rows.join('');
            el.querySelectorAll('.retro-one-btn').forEach(b => { b.onclick = () => { try { retroForceOne(b.dataset.ffhg); } catch (e) {} }; });
        }
        async function retroForceOne(ffhgId) {
            if (!ffhgId) { appAlert('Numéro de match FFHG inconnu pour ce match — renseigne-le dans Admin → Alertes buts en direct, puis relance.'); return; }
            try { const dm = JSON.parse(localStorage.getItem('lynx_ffhg_retro_done') || '{}'); delete dm[String(ffhgId)]; localStorage.setItem('lynx_ffhg_retro_done', JSON.stringify(dm)); } catch (e) {}
            appAlert('🎬 Récupération du déroulé en cours…');
            let n = 0; try { n = await ffhgArchiveReports(8); } catch (e) { appAlert('❌ ' + (e && e.message ? e.message : e)); return; }
            try { _sstatsCache.at = 0; } catch (e) {}
            appAlert('🎬 ' + n + ' déroulé(s) récupéré(s) au passage.');
            try { loadLiveReportIds(); } catch (e) {}
            renderFreshness(true);
        }
        async function catchUpAllReports() {
            const st = document.getElementById('fetch-all-status');
            let total = 0;
            for (let i = 0; i < 15; i++) {
                if (st) st.textContent = '⏳ Passe ' + (i + 1) + ' — ' + total + ' déroulé(s) récupéré(s)…';
                let n = 0; try { n = await ffhgArchiveReports(8); } catch (e) { break; }
                total += n;
                if (!n) break;
            }
            try { _sstatsCache.at = 0; } catch (e) {}
            try { _pstatsCache = { t: 0, v: null }; } catch (e) {}
            try { _stCache = { t: 0, v: null }; } catch (e) {}
            if (st) st.textContent = '✅ Terminé — ' + total + ' déroulé(s) enregistré(s).';
            appAlert('🎬 Rattrapage terminé : ' + total + ' déroulé(s) archivé(s). Toutes les stats live (accueil, comparateur, fiche adverse) sont à jour.');
            try { loadLiveReportIds(); } catch (e) {}
            renderFreshness(true);
        }