// ===== RENDU DE L'ACCUEIL : accordion, scores FFHG du jour, classement vivant, rivaux, trajectoire, séries & records, jour de match =====
        // v2.22 : cases de l'accueil réductibles — un chevron sur chaque titre replie/déplie la carte (mémorisé par appareil)
        function initHomeCollapse() {
            const home = document.getElementById('home-summary');
            if (!home) return;
            let saved = {};
            try { saved = JSON.parse(localStorage.getItem('lynx_home_fold') || '{}'); } catch (e) {}
            home.querySelectorAll('h3').forEach(h => {
                if (h.dataset.foldInit) return;
                const card = h.closest('div[class*="rounded-xl"]');
                if (!card) return;
                // le bandeau-titre = l'ancêtre du titre qui est enfant direct de la carte
                let header = h;
                while (header.parentElement && header.parentElement !== card) header = header.parentElement;
                const body = [...card.children].filter(c => c !== header && !header.contains(c));
                if (!body.length) return;
                h.dataset.foldInit = '1';
                const key = normalize(h.textContent).replace(/[^a-z0-9]/g, '').slice(0, 20) || 'case';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'home-fold-btn ml-auto shrink-0 w-7 h-7 rounded-full text-gray-400 hover:text-lynx-red hover:bg-gray-100 dark:hover:bg-gray-800 transition text-xs';
                btn.setAttribute('aria-label', 'Réduire / déployer cette case');
                const setOpen = (open, persist) => {
                    body.forEach(b => { b.style.display = open ? '' : 'none'; });
                    btn.textContent = open ? '▴' : '▾';
                    if (persist) { saved[key] = open ? 0 : 1; try { localStorage.setItem('lynx_home_fold', JSON.stringify(saved)); } catch (e) {} }
                };
                const toggle = (e) => { e.stopPropagation(); setOpen(body[0].style.display === 'none', true); };
                btn.onclick = toggle;
                header.classList.add('cursor-pointer', 'select-none');
                header.appendChild(btn);
                header.onclick = toggle;
                setOpen(!(saved[key] === 1), false);
            });
        }

        // v2.22 : classement vivant — via l'interface JSON de la FFHG (celle que la page calendrier du site appelle en arrière-plan) :
        // numéros de match, horaires, scores et drapeau « en cours », sans dépendre de la mise en page HTML.
        const FFHG_DIVS = [
            { div: 'D1', comp: 241, phase: 721 },
            { div: 'D2', comp: 198, phase: 567 }
        ];
        let ffhgSeasonCache = { at: 0, rows: [] };
        let ffhgRowsWrittenAt = 0;
        // v2.22 : cache en base (settings/ffhg-rows, écrit par l'action GitHub à chaque cycle complet ET par l'app
        // après une récupération relais réussie) — lecture Firestore = zéro relais CORS, ça marche même quand les proxys meurent.
        async function ffhgRowsFromBase() {
            try {
                const d = await getDoc(doc(db, `${basePath}/settings/ffhg-rows`));
                if (!d || !d.exists || !d.exists()) return null;
                const v = d.data() || {};
                if (!v.rows || Date.now() - (Number(v.at) || 0) > 6 * 3600e3) return null;
                const arr = JSON.parse(v.rows);
                return Array.isArray(arr) && arr.length ? arr : null;
            } catch (e) { return null; }
        }
        async function ffhgSeasonRows() {
            if (ffhgSeasonCache.rows.length && Date.now() - ffhgSeasonCache.at < 1800e3) return ffhgSeasonCache.rows;
            const fromBase = await ffhgRowsFromBase();
            if (fromBase) { ffhgSeasonCache = { at: Date.now(), rows: fromBase }; return fromBase; }
            const rows = [];
            for (const d of FFHG_DIVS) {
                const before = rows.length;
                for (let page = 1; page <= 8; page++) {
                    let txt = '';
                    try {
                        txt = await liveFetchText('https://www.hockeyfrance.com/competitions/wp-admin/admin-ajax.php?action=get_rencontres&page=' + page + '&equipe_id=&competition_id=' + d.comp + '&phase_id=' + d.phase + '&date_min=&date_max=&par_page=50&journee=&limite=0');
                    } catch (e) { break; }
                    if (!txt) break;
                    let j = null;
                    try { j = JSON.parse(txt); } catch (e) { break; }
                    const arr = (j && j.data && Array.isArray(j.data.data)) ? j.data.data : [];
                    for (const r of arr) {
                        const rec = r.receveur, vis = r.visiteur;
                        const dt = (r.calendrier && (r.calendrier.date_debut || r.calendrier.date_fin)) || r.date_rencontre || '';
                        if (!rec || !vis || !dt) continue;
                        let gh = null, ga = null;
                        if (Array.isArray(r.score)) {
                            for (const s of r.score) {
                                if (s && s.equipe_id === rec.id) gh = Number(s.score);
                                else if (s && s.equipe_id === vis.id) ga = Number(s.score);
                            }
                        }
                        rows.push({ div: d.div, id: String(r.id), date: dt.replace(' ', 'T'), home: rec.libelle_court || rec.libelle || '', away: vis.libelle_court || vis.libelle || '', homeFull: rec.libelle_complet || '', awayFull: vis.libelle_complet || '', gh, ga, vp: r.victoire_par || '', live: !!r.en_cours, done: r.etat === 'T' });
                    }
                    const meta = (j && j.data && j.data.meta) || {};
                    const per = Number(meta.per_page) || 50;
                    const tot = Number(meta.total) || 0;
                    if (!arr.length || arr.length < per || (rows.length - before) >= tot) break;
                }
            }
            if (rows.length) {
                ffhgSeasonCache = { at: Date.now(), rows };
                // v2.22 : l'app alimente elle aussi le cache en base (1 écriture/h max) — le prochain chargement
                // et les autres appareils liront la base au lieu de passer par les relais.
                if (Date.now() - ffhgRowsWrittenAt > 3600e3) {
                    ffhgRowsWrittenAt = Date.now();
                    try { await setDoc(doc(db, `${basePath}/settings/ffhg-rows`), { rows: JSON.stringify(rows), at: Date.now() }, { merge: true }); } catch (e) {}
                }
            }
            return rows;
        }
        async function fetchDayLiveScores(dayM) {
            if (Date.now() - liveDayCache.at < 60e3) return liveDayCache.list;
            const found = [];
            try {
                const rows = await ffhgSeasonRows();
                const d0 = new Date(); d0.setHours(0, 0, 0, 0);
                const d1 = new Date(d0.getTime() + 24 * 3600e3);
                const wanted = (dayM || []).map(m => ({ m, h: normalize(m.homeTeam), a: normalize(m.awayTeam) })).filter(w => w.h && w.a);
                for (const r of rows) {
                    if (r.gh == null || r.ga == null) continue;
                    const t = new Date(r.date).getTime();
                    if (!(t >= d0.getTime() && t < d1.getTime())) continue;
                    const rh = normalize(r.home), ra = normalize(r.away);
                    const hit = wanted.find(w => (w.h === rh && w.a === ra) || (w.h === ra && w.a === rh));
                    if (!hit) continue;
                    const same = hit.h === rh;
                    found.push({ tA: hit.m.homeTeam, tB: hit.m.awayTeam, gA: same ? r.gh : r.ga, gB: same ? r.ga : r.gh });
                }
            } catch (e) {}
            liveDayCache = { at: Date.now(), list: found };
            return found;
        }
        async function renderLiveStandings(ranking, matches) {
            const el = document.getElementById('home-live-ranking');
            if (!el) return;
            try {
                const d0 = new Date(); d0.setHours(0, 0, 0, 0);
                const d1 = new Date(d0.getTime() + 24 * 3600e3);
                const dayM = (matches || []).filter(m => { const t = new Date(m.date).getTime(); return t >= d0.getTime() && t < d1.getTime() && (!m.type || m.type === 'Saison'); });
                if (!dayM.length) { el.innerHTML = ''; return; }
                const others = dayM.filter(m => !(normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence')));
                if (!others.length) { el.innerHTML = ''; return; }
                const live = await fetchDayLiveScores(others);
                const used = [];
                const sim = others.map(m => {
                    const sc = live.find(x => !used.includes(x) && ((normalize(x.tA) === normalize(m.homeTeam) && normalize(x.tB) === normalize(m.awayTeam)) || (normalize(x.tA) === normalize(m.awayTeam) && normalize(x.tB) === normalize(m.homeTeam))));
                    if (!sc) return null;
                    used.push(sc);
                    const gh = normalize(sc.tA) === normalize(m.homeTeam) ? sc.gA : sc.gB;
                    const ga = normalize(sc.tA) === normalize(m.homeTeam) ? sc.gB : sc.gA;
                    return { m, gh, ga };
                }).filter(Boolean);
                if (!sim.length) { el.innerHTML = ''; return; }
                const clone = (ranking || []).map(r => ({ ...r }));
                sim.forEach(({ m, gh, ga }) => {
                    const h = clone.find(r => normalize(r.team) === normalize(m.homeTeam)), a = clone.find(r => normalize(r.team) === normalize(m.awayTeam));
                    if (!h || !a) return;
                    if (gh > ga) h.pts = (h.pts || 0) + 3; else if (ga > gh) a.pts = (a.pts || 0) + 3; else { h.pts = (h.pts || 0) + 1; a.pts = (a.pts || 0) + 1; }
                });
                const sorted = sortRankFFHG(clone, activeSeason);
                const li = sorted.findIndex(t => normalize(t.team).includes('valence'));
                if (li < 0) { el.innerHTML = ''; return; }
                const from = Math.max(0, li - 2);
                const win = sorted.slice(from, li + 3);
                el.innerHTML = `<div class="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700"><h4 class="text-xs font-semibold text-red-600 mb-2 text-center uppercase tracking-wider">🔴 En direct — classement si les scores tiennent</h4>${sim.map(({ m, gh, ga }) => `<div class="text-xs text-center text-gray-500 dark:text-gray-400">${xmlEsc(m.homeTeam)} <b class="tabular-nums text-gray-700 dark:text-gray-200">${gh}-${ga}</b> ${xmlEsc(m.awayTeam)} <span class="text-[10px] text-gray-400">(en cours)</span></div>`).join('')}<div class="mt-2 space-y-0.5">${win.map((t, i) => { const p = from + i + 1; return `<div class="flex justify-between text-xs px-2 py-1 rounded ${normalize(t.team).includes('valence') ? 'bg-red-50 dark:bg-red-900/20 font-bold' : ''}"><span>${p}. ${xmlEsc(t.team)}</span><span class="tabular-nums">${t.pts} pts</span></div>`; }).join('')}</div></div>`;
            } catch (e) { el.innerHTML = ''; }
        }

        // Concurrents directs : équipes juste devant/derrière les Lynx au classement — forme et dernier résultat
        function renderHomeRivals(rows) {
            const el = document.getElementById('home-rivals');
            if (!el) return;
            try {
                const sorted = [...(rows || [])].sort((a, b) => (b.pts || 0) - (a.pts || 0) || ((b.bp || 0) - (b.bc || 0)) - ((a.bp || 0) - (a.bc || 0)));
                const iL = sorted.findIndex(t => normalize(t.team).includes('valence'));
                if (!sorted.length || iL < 0) { el.innerHTML = ''; return; }
                const rivals = sorted.filter((t, i) => i !== iL && Math.abs(i - iL) <= 2);
                if (!rivals.length) { el.innerHTML = ''; return; }
                const played = allMatches.filter(x => x.season === activeSeason && isMatchFinished(x) && (!x.type || x.type === 'Saison')).sort((a2, b2) => new Date(a2.date) - new Date(b2.date));
                const dotsOf = (f) => String(f || '').split('').map(c => `<span class="form-dot ${c === 'V' || c === 'v' ? 'form-win' : (c === 'D' || c === 'd' ? 'form-loss' : 'form-draw')}"></span>`).join('') || '<span class="text-[10px] text-gray-400">—</span>';
                const html = rivals.map((t) => {
                    const rk = sorted.indexOf(t) + 1;
                    const lm = played.filter(x => normalize(x.homeTeam).includes(normalize(t.team)) || normalize(x.awayTeam).includes(normalize(t.team))).slice(-1)[0];
                    const ih = lm ? normalize(lm.homeTeam).includes(normalize(t.team)) : false;
                    let lastTxt = '<span class="text-gray-400">pas encore joué</span>';
                    if (lm) {
                        const s = ih ? lm.scoreHome : lm.scoreAway, o = ih ? lm.scoreAway : lm.scoreHome;
                        const r = s > o ? 'V' : (s < o ? 'D' : 'N');
                        const col = r === 'V' ? 'text-green-600' : (r === 'D' ? 'text-red-500' : 'text-gray-400');
                        lastTxt = `<span class="${col} font-black">${r}</span> ${lm.scoreHome}-${lm.scoreAway}${lm.isProl ? ' (pr.)' : ''} <span class="text-gray-400">vs</span> ${ih ? lm.awayTeam : lm.homeTeam}`;
                    }
                    return `<div class="flex items-center gap-2 py-1 text-[11px] border-t dark:border-gray-700"><span class="w-4 text-center font-black text-gray-400">${rk}</span><img src="${getLogo(t.team)}" class="w-4 h-4 object-contain"><span class="font-bold truncate flex-1">${t.team}</span><span class="text-gray-500">${t.pts || 0} pts</span><span class="flex items-center gap-0.5">${dotsOf(t.form)}</span><span class="truncate max-w-[45%] text-gray-500">${lastTxt}</span></div>`;
                }).join('');
                el.innerHTML = `<div class="pt-3 mt-3 border-t border-gray-200 dark:border-gray-700"><h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 text-center uppercase tracking-wider">⚔️ Concurrents directs</h4>${html}</div>`;
            } catch (e) { console.warn('renderHomeRivals', e); }
        }

        // --- v2.18 : trajectoire des Lynx au classement — position après chaque match joué (courbe SVG) ---
        function lynxTrajectorySvg(season) {
            try {
                const hasPoules = seasonHasPoules(season);
                const pool = (allMatches || []).filter(m => m.season === season && isMatchFinished(m) && (!m.type || m.type === 'Saison'));
                const lpRef = pool.find(m => normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence'));
                if (hasPoules && !lpRef) return '';
                const lynxPoule = hasPoules ? String(lpRef.poule || 'B').toUpperCase() : null;
                const ms = pool.filter(m => !hasPoules || String(m.poule || 'B').toUpperCase() === lynxPoule).sort((a, b) => new Date(a.date) - new Date(b.date));
                if (ms.length < 2) return '';
                const teams = {};
                ms.forEach(m => { teams[normalize(m.homeTeam)] = { team: m.homeTeam, pts: 0, bp: 0, bc: 0 }; teams[normalize(m.awayTeam)] = { team: m.awayTeam, pts: 0, bp: 0, bc: 0 }; });
                const fmt = getFormat(season);
                const spots = Number(fmt.playoffSpots) || 8, maint = Number(fmt.maintienSpots) || 0;
                const nb = Object.keys(teams).length;
                let iL = 0; const pts = [];
                ms.forEach(m => {
                    const h = teams[normalize(m.homeTeam)], a = teams[normalize(m.awayTeam)];
                    if (!h || !a) return;
                    h.pts += matchPoints(m.scoreHome, m.scoreAway, m.isProl); a.pts += matchPoints(m.scoreAway, m.scoreHome, m.isProl);
                    h.bp += m.scoreHome; h.bc += m.scoreAway; a.bp += m.scoreAway; a.bc += m.scoreHome;
                    if (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence')) {
                        iL++;
                        const rank = Object.values(teams).sort((x, y) => (y.pts - x.pts) || ((y.bp - y.bc) - (x.bp - x.bc))).findIndex(t => normalize(t.team).includes('valence')) + 1;
                        pts.push({ n: iL, rank, m });
                    }
                });
                if (pts.length < 2) return '';
                const W = 560, H = 170, padL = 34, padR = 44, padT = 26, padB = 18;
                const fx = (n) => padL + (n - 1) / Math.max(1, pts.length - 1) * (W - padL - padR);
                const fy = (r) => padT + (r - 1) / Math.max(1, nb - 1) * (H - padT - padB);
                let g = '';
                if (nb > spots) g += `<rect x="${padL}" y="${fy(1)}" width="${W - padL - padR}" height="${fy(spots) - fy(1)}" fill="rgba(34,197,94,0.10)"/>`;
                if (maint > 0 && nb > maint) g += `<rect x="${padL}" y="${fy(nb - maint + 1)}" width="${W - padL - padR}" height="${fy(nb) - fy(nb - maint + 1)}" fill="rgba(239,68,68,0.10)"/>`;
                [[1, '1er'], [spots, nb > spots ? spots + 'e' : ''], [nb, nb + 'e']].forEach(pp => { const r = pp[0], lbl = pp[1]; if (!lbl || r > nb) return; g += `<line x1="${padL}" y1="${fy(r)}" x2="${W - padR}" y2="${fy(r)}" stroke="rgba(128,128,128,0.25)" stroke-dasharray="3 3" stroke-width="1"/><text x="${padL - 5}" y="${fy(r) + 3}" font-size="9" font-weight="bold" text-anchor="end" fill="#9CA3AF">${lbl}</text>`; });
                const path = pts.map((p, i) => (i ? 'L' : 'M') + fx(p.n).toFixed(1) + ' ' + fy(p.rank).toFixed(1)).join(' ');
                g += `<path d="${path}" fill="none" stroke="#D90429" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
                pts.forEach(p => { const isH = normalize(p.m.homeTeam).includes('valence'); const sL = isH ? p.m.scoreHome : p.m.scoreAway, sO = isH ? p.m.scoreAway : p.m.scoreHome; const opp = isH ? p.m.awayTeam : p.m.homeTeam; g += `<circle cx="${fx(p.n).toFixed(1)}" cy="${fy(p.rank).toFixed(1)}" r="3.5" fill="${nb > spots && p.rank <= spots ? '#16A34A' : (maint > 0 && p.rank > nb - maint ? '#EF4444' : '#D90429')}"><title>M${p.n} : ${xmlEsc(opp)} ${sL}-${sO} — ${p.rank}e place</title></circle>`; });
                const last = pts[pts.length - 1];
                g += `<text x="${(fx(last.n) + 6).toFixed(1)}" y="${(fy(last.rank) + 3).toFixed(1)}" font-size="10" font-weight="900" fill="#D90429">${last.rank}e</text>`;
                return `<div class="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700"><div class="text-[9px] uppercase font-bold text-gray-400 tracking-wider text-center mb-1">📈 Trajectoire au classement — après chacun des ${pts.length} matchs joués</div><svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">${g}</svg></div>`;
            } catch (e) { console.warn('lynxTrajectorySvg', e); return ''; }
        }

        // --- v2.13 : Séries & records de la saison — bloc 100 % automatique (aucune saisie) ---
        function renderSeriesRecords(sMatches, rankingRows) {
            const el = document.getElementById('home-series');
            const box = document.getElementById('home-series-container');
            if (!el || !box) return;
            try {
                const done = (sMatches || []).filter(x => isMatchFinished(x) && (!x.type || x.type === 'Saison') && (normalize(x.homeTeam).includes('valence') || normalize(x.awayTeam).includes('valence'))).sort((a, b) => new Date(a.date) - new Date(b.date));
                if (!done.length) { box.classList.add('hidden'); return; }
                const isH = (m) => normalize(m.homeTeam).includes('valence');
                const resOf = (m) => { const s = isH(m) ? m.scoreHome : m.scoreAway, o = isH(m) ? m.scoreAway : m.scoreHome; return s > o ? 'V' : (s < o ? 'D' : 'N'); };
                const results = done.map(resOf);
                const nbV = results.filter(r => r === 'V').length, nbN = results.filter(r => r === 'N').length, nbD = results.filter(r => r === 'D').length;
                let streakType = results[results.length - 1] || '', streakN = 0;
                for (let i = results.length - 1; i >= 0; i--) { if (results[i] === streakType) streakN++; else break; }
                let bestStreak = 0, cur = 0; results.forEach(r => { if (r === 'V') { cur++; if (cur > bestStreak) bestStreak = cur; } else cur = 0; });
                let bigWin = null;
                done.forEach(m => { const s = isH(m) ? m.scoreHome : m.scoreAway, o = isH(m) ? m.scoreAway : m.scoreHome; if (s - o > 0 && (!bigWin || s - o > bigWin.diff)) bigWin = { diff: s - o, txt: s + '-' + o + ' vs ' + (isH(m) ? m.awayTeam : m.homeTeam) }; });
                let raceTxt = '';
                try {
                    const fmt = getFormat(activeSeason); // v2.17 : suit le format réel de la saison (top 12 en D1 auto-détectée)
                    const spots = Number(fmt.playoffSpots) || 8;
                    const maint = Number(fmt.maintienSpots) || 0;
                    const sorted = [...(rankingRows || [])].sort((a, b) => (b.pts || 0) - (a.pts || 0) || ((b.bp || 0) - (b.bc || 0)) - ((a.bp || 0) - (a.bc || 0)));
                    const iL = sorted.findIndex(t => normalize(t.team).includes('valence'));
                    if (iL >= 0 && sorted.length > 1) {
                        const pos = iL + 1;
                        if (maint > 0 && iL >= sorted.length - maint) { const gap = (sorted[sorted.length - maint - 1].pts || 0) - (sorted[iL].pts || 0); raceTxt = '🔴 ' + pos + 'e — zone de maintien (à ' + gap + ' pt' + (gap > 1 ? 's' : '') + ' du sursis)'; }
                        else if (sorted.length > spots && iL >= spots) { const gap = (sorted[spots - 1].pts || 0) - (sorted[iL].pts || 0); raceTxt = '🟠 ' + pos + 'e — à ' + gap + ' pt' + (gap > 1 ? 's' : '') + ' des playoffs'; }
                        else if (sorted.length > spots) { raceTxt = '🟢 ' + pos + 'e — en position de playoffs' + (iL === spots - 1 ? ' (dernier ticket !)' : ''); }
                        else { raceTxt = '🟢 ' + pos + 'e sur ' + sorted.length; }
                    }
                } catch (e) {}
                // v2.17 : comparaison avec la saison précédente — points des Lynx après le même nombre de matchs joués
                let prevTxt = '';
                try {
                    const m0 = String(activeSeason || '').match(/^(\d{4})/);
                    if (m0 && done.length) {
                        const y = Number(m0[1]);
                        const prevSeason = `${y - 1}-${y}`;
                        const prevDone = allMatches.filter(x => x.season === prevSeason && (!x.type || x.type === 'Saison') && (normalize(x.homeTeam).includes('valence') || normalize(x.awayTeam).includes('valence')) && isMatchFinished(x)).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, done.length);
                        if (prevDone.length) {
                            let pPts = 0, cPts = 0;
                            prevDone.forEach(x => { const iH = normalize(x.homeTeam).includes('valence'); pPts += matchPoints(iH ? x.scoreHome : x.scoreAway, iH ? x.scoreAway : x.scoreHome, x.isProl); });
                            done.forEach(x => { const iH = normalize(x.homeTeam).includes('valence'); cPts += matchPoints(iH ? x.scoreHome : x.scoreAway, iH ? x.scoreAway : x.scoreHome, x.isProl); });
                            const diffTxt = cPts > pPts ? ` (+${cPts - pPts})` : (cPts < pPts ? ` (${cPts - pPts})` : '');
                            prevTxt = `📅 Après ${done.length} match(s) : ${cPts} pts cette saison contre ${pPts} à la même hauteur en ${prevSeason}${diffTxt}`;
                        }
                    }
                } catch (e) {}
                const dots = results.slice(-5).map(r => `<span class="form-dot ${r === 'V' ? 'form-win' : (r === 'D' ? 'form-loss' : 'form-draw')}" title="${r}"></span>`).join('');
                const streakTxt = streakN + (streakType === 'V' ? ' victoire' + (streakN > 1 ? 's' : '') : streakType === 'D' ? ' défaite' + (streakN > 1 ? 's' : '') : ' nul' + (streakN > 1 ? 's' : ''));
                const streakCls = streakType === 'V' ? 'text-green-600' : (streakType === 'D' ? 'text-red-500' : 'text-gray-500');
                const lbl = (t) => `<div class="text-[9px] uppercase font-bold text-gray-400 tracking-wider whitespace-nowrap">${t}</div>`;
                box.classList.remove('hidden');
                el.innerHTML = `<div class="flex items-center justify-center flex-wrap gap-x-5 gap-y-2">
                        <div class="flex items-center gap-1" title="5 derniers résultats">${dots}</div>
                        <div class="text-center">${lbl('Série')}<div class="text-xs md:text-sm font-black ${streakCls}">${streakTxt}</div></div>
                        <div class="text-center">${lbl('Bilan')}<div class="text-xs md:text-sm font-black text-lynx-red">${nbV}V-${nbN}N-${nbD}D</div></div>
                        ${bestStreak >= 2 ? `<div class="text-center">${lbl('Record')}<div class="text-xs md:text-sm font-black text-green-600">${bestStreak} victoires d'affilée</div></div>` : ''}
                        ${bigWin ? `<div class="text-center min-w-0">${lbl('Plus large victoire')}<div class="text-xs md:text-sm font-black text-gray-700 dark:text-gray-200 truncate max-w-[140px] md:max-w-[200px]" title="${xmlEsc(bigWin.txt)}">${xmlEsc(bigWin.txt)}</div></div>` : ''}
                    </div>
                    ${raceTxt ? `<div class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-center text-[11px] md:text-xs font-bold text-gray-600 dark:text-gray-300">${raceTxt}</div>` : ''}
                    ${prevTxt ? `<div class="text-center text-[11px] md:text-xs font-bold text-gray-600 dark:text-gray-300">${prevTxt}</div>` : ''}
                    ${lynxTrajectorySvg(activeSeason)}<div id="home-playoffs-odds"></div><div id="home-reliability-svg"></div>`;
            } catch (e) { console.warn('renderSeriesRecords', e); }
        }

        // --- v2.12 : Mode jour de match — bandeau héros sur l'accueil (J-1 sobre, J hero, live, résultat) ---
        let matchdayTimer = null;
        function matchdayCountdownTxt(kickoffMs) {
            const ms = kickoffMs - Date.now();
            if (ms <= 0) return null;
            const h = Math.floor(ms / 3600e3), mn = Math.floor((ms % 3600e3) / 60000), s = Math.floor((ms % 60000) / 1000);
            return h > 0 ? `${h}h${String(mn).padStart(2, '0')}` : (mn > 0 ? `${mn} min ${String(s).padStart(2, '0')}s` : `${s} s`);
        }
        function renderMatchDay(next, sMatches, rankingRows) {
            const el = document.getElementById('matchday-banner');
            if (!el) return;
            const now = new Date();
            const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
            if (matchdayTimer) { clearInterval(matchdayTimer); matchdayTimer = null; }
            const nextM = (next && next.length) ? next[0] : null;
            // match Lynx du jour (même s'il a déjà un score : score live FFHG ou match terminé)
            const lynxToday = (sMatches || []).filter(x => sameDay(new Date(x.date), now) && (normalize(x.homeTeam).includes('valence') || normalize(x.awayTeam).includes('valence'))).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
            let mode = null, m = null, dtm = null, hasTime = false, kickoff = null;
            if (lynxToday) {
                m = lynxToday;
                dtm = new Date(m.date);
                hasTime = !!(dtm.getHours() || dtm.getMinutes());
                kickoff = new Date(dtm.getTime());
                if (!hasTime) kickoff.setHours(20, 0, 0, 0);
                // score présent avant kickoff + 2h30 = score live en cours ; après = match vraiment terminé
                mode = isMatchFinished(m) ? ((Date.now() >= kickoff.getTime() + 2.5 * 3600e3) ? 'done' : 'live') : ((now >= kickoff) ? 'live' : 'day');
            } else if (nextM) {
                const d2 = new Date(nextM.date);
                const tomorrow = new Date(now.getTime() + 86400e3);
                if (sameDay(d2, tomorrow)) { mode = 'eve'; m = nextM; dtm = d2; hasTime = !!(d2.getHours() || d2.getMinutes()); }
            }
            if (!mode) {
                el.classList.add('hidden'); el.innerHTML = '';
                document.body.classList.remove('matchday');
                return;
            }
            el.classList.remove('hidden');
            const timeTxt = (d, ht) => ht ? `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}` : '~20h00';
            const tomorrow2 = new Date(now.getTime() + 86400e3);
            const tDay = (mode === 'eve') ? tomorrow2 : now;
            const ticket = (ticketItems || []).map(t => ({ ...t, eventDate: parseTicketDate(t.label) })).filter(t => t.url && t.eventDate && sameDay(new Date(t.eventDate), tDay)).sort((a, b) => (a.eventDate || 0) - (b.eventDate || 0))[0];
            // v2.13 : pronostic du site rappelé dans le bandeau (la veille et le jour de match)
            let predTxt = '';
            try {
                const pi = m ? getMatchPredInfo(m) : null;
                if (pi && !pi.past && pi.s) {
                    const lH = normalize(m.homeTeam).includes('valence');
                    const sL = lH ? pi.s[0] : pi.s[1], sO = lH ? pi.s[1] : pi.s[0];
                    predTxt = 'Lynx ' + sL + ' - ' + sO + (pi.draw ? ' (ap)' : '') + (pi.fiab ? ' (fiabilité ' + pi.fiab + ' %)' : '');
                }
            } catch (e) {}
            if (mode === 'day') {
                document.body.classList.add('matchday');
                const rivals = new Set();
                try {
                    const sorted = [...(rankingRows || [])].sort((a, b) => (b.pts || 0) - (a.pts || 0) || ((b.bp || 0) - (b.bc || 0)) - ((a.bp || 0) - (a.bc || 0)));
                    const iL = sorted.findIndex(t => normalize(t.team).includes('valence'));
                    if (iL >= 0) sorted.forEach((t, i) => { if (i !== iL && Math.abs(i - iL) <= 2) rivals.add(normalize(t.team)); });
                } catch (e) {}
                const others = (sMatches || []).filter(x => {
                    const d = new Date(x.date);
                    return sameDay(d, now) && !(normalize(x.homeTeam).includes('valence') || normalize(x.awayTeam).includes('valence')) && (!x.type || x.type === 'Saison');
                }).sort((a, b) => new Date(a.date) - new Date(b.date));
                const othersHtml = others.map(x => {
                    const fin = isMatchFinished(x);
                    const xd = new Date(x.date);
                    const xh = (xd.getHours() || xd.getMinutes()) ? `${xd.getHours()}h${String(xd.getMinutes()).padStart(2, '0')}` : '—';
                    const rv = rivals.has(normalize(x.homeTeam)) || rivals.has(normalize(x.awayTeam));
                    return `<div class="flex items-center gap-2 text-[11px] md:text-xs py-1 border-t border-white/10"><span class="w-4 text-center">${rv ? '⚔️' : '🏒'}</span><img src="${getLogo(x.homeTeam)}" class="w-4 h-4 object-contain"><span class="font-bold truncate">${xmlEsc(x.homeTeam)}</span><span class="opacity-60 font-black">${fin ? `${x.scoreHome}-${x.scoreAway}` : 'vs'}</span><span class="font-bold truncate">${xmlEsc(x.awayTeam)}</span><img src="${getLogo(x.awayTeam)}" class="w-4 h-4 object-contain"><span class="ml-auto opacity-70 font-mono whitespace-nowrap">${fin ? 'terminé' : xh}</span></div>`;
                }).join('');
                el.innerHTML = `<div class="matchday-hero text-white p-5 md:p-8 rounded-2xl shadow-2xl border border-red-400/40 relative overflow-hidden">
                    <div class="absolute -top-16 -right-16 w-56 h-56 bg-red-500/30 blur-3xl rounded-full"></div>
                    <div class="absolute -bottom-16 -left-16 w-56 h-56 bg-lynx-red/20 blur-3xl rounded-full"></div>
                    <div class="relative z-10 text-center">
                        <div class="text-[11px] md:text-sm font-black uppercase tracking-[0.35em] text-red-300 mb-2"><span class="matchday-pulse inline-block">🏒</span> Jour de match</div>
                        <h2 class="text-2xl md:text-4xl font-black leading-tight drop-shadow">${xmlEsc(m.homeTeam)} <span class="text-red-300">vs</span> ${xmlEsc(m.awayTeam)}</h2>
                        <div class="text-sm md:text-base font-bold opacity-90 mt-1">${timeTxt(dtm, hasTime)}${m.venue ? ' · ' + xmlEsc(m.venue) : ''}</div>
                        ${predTxt ? `<div class="mt-2 text-xs md:text-sm font-bold bg-white/10 border border-white/20 rounded-full px-3 py-1 inline-block">🔮 Pronostic du site : ${xmlEsc(predTxt)}</div>` : ''}
                        <div class="mt-4 flex items-center justify-center gap-4 md:gap-8">
                            <img src="${getLogo(m.homeTeam)}" class="w-14 h-14 md:w-20 md:h-20 object-contain drop-shadow">
                            <div class="text-center">
                                <div class="text-[9px] md:text-[10px] uppercase font-bold tracking-widest opacity-70">Coup d'envoi dans</div>
                                <div id="matchday-countdown" class="text-3xl md:text-5xl font-black font-mono">—</div>
                            </div>
                            <img src="${getLogo(m.awayTeam)}" class="w-14 h-14 md:w-20 md:h-20 object-contain drop-shadow">
                        </div>
                        <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
                            <button class="open-h2h bg-white/15 hover:bg-white/25 border border-white/25 text-white font-bold text-xs md:text-sm px-4 py-2 rounded-lg transition" data-home="${xmlEsc(m.homeTeam)}" data-away="${xmlEsc(m.awayTeam)}">Face-à-Face</button>
                            <button id="matchday-live" class="bg-white text-red-700 font-black text-xs md:text-sm px-4 py-2 rounded-lg shadow hover:scale-105 transition" title="Ouvre le direct avec le n° du match déjà rempli — choisis l'équipe suivie en un clic">🔴 Suivre en direct</button>
                            <button id="matchday-ia" class="bg-white/15 hover:bg-white/25 border border-white/25 text-white font-bold text-xs md:text-sm px-4 py-2 rounded-lg transition"><i class="fa-solid fa-robot mr-1 text-red-300"></i>Analyse IA du match</button>
                            <a href="https://www.hockeyfrance.tv/" target="_blank" rel="noopener" class="bg-white/15 hover:bg-white/25 border border-white/25 text-white font-bold text-xs md:text-sm px-4 py-2 rounded-lg transition" title="La FFHG diffuse les matchs en vidéo (hockeyfrance.tv)">📺 Regarder ↗</a>
                            ${ticket ? `<a href="${xmlEsc(ticket.url)}" target="_blank" rel="noopener" class="bg-lynx-red hover:bg-red-600 text-white font-black text-xs md:text-sm px-4 py-2 rounded-lg shadow transition">🎟️ Réserver mes places ↗</a>` : ''}
                        </div>
                    </div>
                    ${others.length ? `<div class="relative z-10 mt-5 pt-4 border-t border-white/15"><div class="text-[10px] uppercase tracking-[0.25em] font-bold opacity-70 mb-1 text-center">🏒 Ce soir ${seasonHasPoules(activeSeason) ? 'dans la poule' : 'dans le championnat'}</div>${othersHtml}</div>` : ''}
                </div>`;
                const btnIa = document.getElementById('matchday-ia');
                if (btnIa) btnIa.onclick = () => { const b = document.getElementById('btn-ask-bot-h2h'); if (b) b.click(); };
                // v2.22 : direct pré-rempli dès la veille — même mécanique que le bouton des lignes du calendrier
                const blDay = document.getElementById('matchday-live');
                if (blDay) blDay.onclick = () => {
                    if (m && m.ffhgId) { liveJumpToMatch(m.ffhgId, m.homeTeam, m.awayTeam); return; }
                    const t = document.querySelector('.main-nav-tab[data-content="live-match"]');
                    if (t) t.click();
                    else { const sel = document.getElementById('mobile-nav-select'); if (sel) { sel.value = 'live-match'; sel.dispatchEvent(new Event('change')); } }
                };
                const tick = () => {
                    const cdEl = document.getElementById('matchday-countdown');
                    if (!cdEl) { if (matchdayTimer) { clearInterval(matchdayTimer); matchdayTimer = null; } return; }
                    const txt = matchdayCountdownTxt(kickoff.getTime());
                    if (txt) cdEl.textContent = txt;
                    else { if (matchdayTimer) { clearInterval(matchdayTimer); matchdayTimer = null; } renderMatchDay(next, sMatches, rankingRows); }
                };
                tick();
                matchdayTimer = setInterval(tick, 1000);
                return;
            }
            if (mode === 'live') {
                document.body.classList.add('matchday');
                const scoreNow = (m && isMatchFinished(m)) ? `<div class="text-4xl md:text-6xl font-black font-mono mt-3">${m.scoreHome} <span class="opacity-50">-</span> ${m.scoreAway}</div>` : '';
                el.innerHTML = `<div class="bg-gradient-to-r from-red-700 via-red-600 to-red-800 text-white p-5 md:p-8 rounded-2xl shadow-2xl border border-red-400/50 text-center relative overflow-hidden">
                    <div class="absolute -top-16 -right-16 w-56 h-56 bg-red-400/30 blur-3xl rounded-full"></div>
                    <div class="relative z-10">
                        <div class="text-[11px] md:text-sm font-black uppercase tracking-[0.35em] mb-2"><span class="matchday-pulse inline-block">🔴</span> Le match a commencé !</div>
                        <h2 class="text-2xl md:text-4xl font-black leading-tight drop-shadow">${xmlEsc(m.homeTeam)} <span class="opacity-70">vs</span> ${xmlEsc(m.awayTeam)}</h2>
                        ${scoreNow}
                        <div class="mt-4 flex items-center justify-center gap-2 flex-wrap"><button id="matchday-live" class="bg-white text-red-700 font-black text-sm md:text-base px-6 py-3 rounded-lg shadow hover:scale-105 transition">Suivre le match en direct ➜</button><a href="https://www.hockeyfrance.tv/" target="_blank" rel="noopener" class="bg-black/40 hover:bg-black/60 border border-white/30 text-white font-bold text-xs md:text-sm px-4 py-3 rounded-lg transition" title="La FFHG diffuse les matchs en vidéo (hockeyfrance.tv)">📺 Regarder ↗</a></div>
                    </div>
                </div>`;
                const bl = document.getElementById('matchday-live');
                if (bl) bl.onclick = () => {
                    if (m && m.ffhgId) { liveJumpToMatch(m.ffhgId, m.homeTeam, m.awayTeam); return; } // n° connu → direct pré-rempli + choix d'équipe
                    const t = document.querySelector(`.main-nav-tab[data-content="live-match"]`);
                    if (t) t.click();
                    else { const sel = document.getElementById('mobile-nav-select'); if (sel) { sel.value = 'live-match'; sel.dispatchEvent(new Event('change')); } }
                };
                return;
            }
            if (mode === 'done') {
                document.body.classList.add('matchday');
                const dm = m;
                const iH = normalize(dm.homeTeam).includes('valence');
                const sL = iH ? dm.scoreHome : dm.scoreAway, sO = iH ? dm.scoreAway : dm.scoreHome;
                const win = sL > sO, draw = sL === sO;
                const res = draw ? 'Match nul' : (win ? 'Victoire des Lynx !' : 'Défaite des Lynx');
                el.innerHTML = `<div class="text-white p-5 md:p-8 rounded-2xl shadow-2xl text-center ${draw ? 'bg-gradient-to-r from-gray-700 to-gray-900 border-gray-400/40' : (win ? 'bg-gradient-to-r from-emerald-700 to-green-800 border-green-300/40' : 'bg-gradient-to-r from-red-900 to-gray-900 border-red-400/40')} border">
                    <div class="text-[11px] md:text-sm font-black uppercase tracking-[0.35em] opacity-80 mb-2">🏒 Match terminé</div>
                    <h2 class="text-2xl md:text-4xl font-black leading-tight">${xmlEsc(dm.homeTeam)} <span class="opacity-80 font-mono">${dm.scoreHome}-${dm.scoreAway}${dm.isProl ? ' (pr.)' : ''}</span> ${xmlEsc(dm.awayTeam)}</h2>
                    <div class="mt-2 text-base md:text-xl font-black ${win ? 'text-green-300' : (draw ? 'text-gray-200' : 'text-red-300')}">${win ? '🏆' : (draw ? '🤝' : '💪')} ${res}</div>
                    <div class="mt-1 text-xs opacity-70">Le résumé arrive dans les Actus dès que les stats du match sont complètes.</div>
                </div>`;
                return;
            }
            if (mode === 'eve') {
                document.body.classList.remove('matchday');
                const dTxt = dtm.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                el.innerHTML = `<div class="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 p-4 rounded-xl shadow flex flex-col md:flex-row items-center gap-3 md:gap-4 text-center md:text-left">
                    <div class="text-3xl md:text-4xl">🦁</div>
                    <div class="flex-1">
                        <div class="font-black text-amber-900 dark:text-amber-200 text-base md:text-lg">Demain, c'est match !</div>
                        <div class="text-sm text-amber-800 dark:text-amber-300 font-bold">${xmlEsc(m.homeTeam)} vs ${xmlEsc(m.awayTeam)} — ${dTxt} à ${timeTxt(dtm, hasTime)}${m.venue ? ' · ' + xmlEsc(m.venue) : ''}</div>
                        ${predTxt ? `<div class="text-xs text-amber-700 dark:text-amber-400 font-bold mt-0.5">🔮 Pronostic du site : ${xmlEsc(predTxt)}</div>` : ''}
                    </div>
                    ${ticket ? `<a href="${xmlEsc(ticket.url)}" target="_blank" rel="noopener" class="bg-amber-500 hover:bg-amber-600 text-white font-black text-xs md:text-sm px-4 py-2 rounded-lg shadow transition whitespace-nowrap">🎟️ Réserver ↗</a>` : ''}
                </div>`;
                return;
            }
        }