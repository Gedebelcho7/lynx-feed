// ===== CLASSEMENTS + EFFECTIF/JOUEURS (statistiques live, fiches) + LIENS UTILES =====
        function renderRanking(list, id, limit, full=false, showPoule=false) { 
            const el = document.getElementById(id); 
            if(!el) return; 
            
            // SORTING LOGIC
            let sorted = [...list];
            if(rankSort === 'bp') {
                 sorted.sort((a,b) => (b.bp||0) - (a.bp||0)); // High BP first
            } else if (rankSort === 'bc') {
                 sorted.sort((a,b) => (a.bc||0) - (b.bc||0)); // Low BC first
            } else {
                 // Default PTS — critères officiels FFHG (confrontations directes puis diff générale)
                 sorted = sortRankFFHG(list, activeSeason);
            }
            
            let rankOffset = 0; const winN = limit < 0 ? -limit : 0;
            if (winN === 0 && limit < 99) sorted = sorted.slice(0, limit); // Only slice for home widget

            // v2.14 : flèches de mouvement ▲▼ au classement — comparaison avec le classement précédent
            // (instantané mémorisé sur l'appareil ; les flèches persistent jusqu'au prochain changement de position,
            //  ce qui tolère les imports FFHG comme la saisie manuelle, même étalée dans le temps)
            let rankArrows = {};
            if (rankSort === 'pts') {
                try {
                    const store = JSON.parse(localStorage.getItem('lynx_rank_moves') || '{}');
                    const key = activeSeason + '|' + id;
                    const cur = sorted.map(t => normalize(t.team));
                    let ent = store[key];
                    if (!ent || !Array.isArray(ent.prev) || ent.prev.length !== cur.length) {
                        ent = { prev: cur, arrows: {} };
                    } else if (JSON.stringify(ent.prev) !== JSON.stringify(cur)) {
                        const ar = {};
                        cur.forEach((tm, i) => { const j = ent.prev.indexOf(tm); if (j >= 0 && j !== i) ar[tm] = j > i ? 'up' : 'down'; });
                        ent = { prev: cur, arrows: ar };
                    }
                    rankArrows = ent.arrows || {};
                    store[key] = ent;
                    localStorage.setItem('lynx_rank_moves', JSON.stringify(store));
                } catch (e) {}
            }

            // v2.20 : fenêtre autour des Lynx (accueil) — N équipes, positions réelles affichées
            if (winN > 0) {
                const iL = sorted.findIndex(t => normalize(t.team).includes('valence'));
                if (iL >= 0) { const start = Math.max(0, Math.min(iL - Math.floor(winN / 2), Math.max(0, sorted.length - winN))); rankOffset = start; sorted = sorted.slice(start, start + winN); }
            }

            // Highlighting
            const bgPts = rankSort === 'pts' ? 'bg-gray-100 dark:bg-gray-700 font-black' : 'text-gray-700 dark:text-gray-300';
            const bgBp = rankSort === 'bp' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 font-black' : 'hidden md:table-cell';
            const bgBc = rankSort === 'bc' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 font-black' : 'hidden md:table-cell';

            el.innerHTML = sorted.map((t,i) => { 
                const isL = normalize(t.team).includes('valence'); 
                const total = sorted.length;
                const mvA = rankArrows[normalize(t.team)];
                const arrowHtml = mvA === 'up' ? ' <span class="text-green-500">▲</span>' : mvA === 'down' ? ' <span class="text-red-500">▼</span>' : '';
                const fmtZ = getFormat(activeSeason);
                const singlePoule = seasonHasPoules(activeSeason) && list.length > 0 && list.every(t => t.poule === list[0].poule);
                // v2.17 : la ligne playoffs suit le format de la saison (D2 : top 8 par poule ; D1 2026-2027 : top 12, règlement FFHG)
                const poSpots = (fmtZ.playoffSpots || 8);
                const mtSpots = (fmtZ.maintienSpots || 0);
                const zonesOn = rankSort === 'pts' && full;
                const inPlayoff = zonesOn && i < poSpots;
                const inMaintien = zonesOn && mtSpots > 0 && i >= total - mtSpots;
                const zoneBg = inMaintien ? 'background:rgba(239,68,68,0.07)' : (inPlayoff ? 'background:rgba(16,185,129,0.07)' : '');
                const borderSep = zonesOn && i === poSpots && i < total ? 'border-top:3px solid #10b981' : (zonesOn && mtSpots > 0 && i === total - mtSpots && i > 0 ? 'border-top:3px solid #ef4444' : '');
                const style = isL ? '' : `${zoneBg};${borderSep}`;
                const pouleBadge = showPoule ? `<td class="p-3"><span class="text-[10px] font-black px-2 py-1 rounded text-white ${t.poule === 'A' ? 'bg-lynx-dark' : 'bg-lynx-red'}">${t.poule || '?'}</span></td>` : '';
                const formHtml = (full && t.form) ? `<td class="p-3 text-center text-[11px] font-black tracking-wider">${(t.form||'').split('').map(c => c === 'V' ? '<span class="text-green-500">V</span>' : c === 'v' ? '<span class="text-emerald-500">v</span>' : c === 'd' ? '<span class="text-orange-400">d</span>' : c === 'D' ? '<span class="text-red-500">D</span>' : '<span class="text-gray-400">N</span>').join(' ')}</td>` : '';
                const row = `
                    <td class="p-3 font-bold whitespace-nowrap">${i + 1 + rankOffset}${arrowHtml}</td>
                    ${pouleBadge}
                    <td class="p-3 flex items-center gap-2"><img src="${getLogo(t.team)}" class="w-5 h-5 object-contain"> <span class="truncate max-w-[120px] md:max-w-none cursor-pointer hover:text-lynx-red" onclick="try { openTeamDetail('${xmlEsc(t.team)}'); } catch(e) {}">${t.team}</span></td>



                    <td class="p-3 text-center ${bgPts}">${t.pts}</td>
                    <td class="p-3 text-center text-gray-500">${t.mj}</td>
                `; 
                // Full columns for global view
                const xtra = full ? `
                    <td class="p-3 text-center ${bgBp}">${t.bp}</td>
                    <td class="p-3 text-center ${bgBc}">${t.bc}</td>
                    <td class="p-3 text-center font-bold ${t.bp-t.bc>0?'text-green-500':'text-red-500'}">${t.bp-t.bc>0?'+':''}${t.bp-t.bc}</td>
                    ${formHtml}
                ` : ''; 
                return `<tr class="border-b dark:border-gray-700 ${isL?'bg-red-50 dark:bg-red-900/20':''}"${style ? ` style="${style}"` : ''}>${row}${xtra}</tr>`; 
            }).join(''); 
        }

        function renderRankingGlobal(listA, listB) { 
            const hasPoules = seasonHasPoules(activeSeason);
            const poulesC = document.getElementById('ranking-poules-container');
            const generalC = document.getElementById('ranking-general-container');
            const toggle = document.getElementById('ranking-view-toggle');
            const genTitle = document.getElementById('ranking-general-title');
            if (hasPoules) {
                const pcol = document.getElementById('ranking-poule-col'); if (pcol) pcol.style.display = ''; // v2.18 : la colonne Poule revient en D2
                if (poulesC) poulesC.classList.remove('hidden');
                if (toggle) toggle.classList.remove('hidden');
                if (generalC) generalC.classList.add('hidden');
                // Render Table A
                renderRanking(listA, 'ranking-table-body-A', 99, true, false);
                // Render Table B
                renderRanking(listB, 'ranking-table-body-B', 99, true, false);
                // Render General (Combine A + B)
                const listGen = [...listA, ...listB];
                renderRanking(listGen, 'ranking-table-body-general', 99, true, true);
            } else {
                // Format D1 : pas de poules -> classement unique
                // v2.18 : on masque la colonne « Poule » de l'en-tête — sans ça, tous les titres étaient décalés d'une colonne
                const pcol = document.getElementById('ranking-poule-col'); if (pcol) pcol.style.display = 'none';
                if (poulesC) poulesC.classList.add('hidden');
                if (toggle) toggle.classList.add('hidden');
                if (generalC) generalC.classList.remove('hidden');
                if (genTitle) genTitle.textContent = 'Classement Général (Championnat)';
                const listGen = [...listA, ...listB];
                renderRanking(listGen, 'ranking-table-body-general', 99, true, false);
            }
        }

        // --- UPDATED CLICK HANDLER TO SHOW RADAR IN MODAL ---
        // ---- Photos des joueurs (v2.13) : liste « Nom = URL » éditable dans Admin → Import FFHG ----
        function normPlayerKey(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
        function parsePlayerPhotos(text) {
            const map = {};
            String(text || '').split(/\r?\n/).forEach(line => {
                const i = line.indexOf('=');
                if (i < 1) return;
                const name = line.slice(0, i).trim(), url = line.slice(i + 1).trim();
                if (name && /^https?:\/\//i.test(url)) map[normPlayerKey(name)] = url;
            });
            return map;
        }
        function playerPhotoOf(txt) {
            if (!txt) return null;
            const nm = String(txt).replace(/^n[°o]?\s*\d+\s*/i, '').replace(/\(.*?\)/g, '').trim();
            if (!nm) return null;
            return playerPhotos[normPlayerKey(nm)] || null;
        }
        // v2.22 : totaux auto — si les matchs archivés donnent PLUS que l'import CSV (import ancien ou incomplet),
        // c'est le chiffre auto qui s'affiche, marqué 🎬 ; jamais de chiffre inférieur à l'import.
        async function renderRoster(list) {
            let auto = null;
            try { auto = (await livePlayerStats()).byName; } catch (e) {}
            const autoOf = (p, kind) => { const r = auto && auto.get(normalize(p.name)); return r ? (kind === 'g' ? (r.g || 0) : (r.a || 0)) : 0; };
            const statOf = (p, kind) => { const imp = Number(kind === 'g' ? p.goals : p.assists) || 0; const au = autoOf(p, kind); return au > imp ? { v: au, auto: true } : { v: imp, auto: false }; };
            if (!list.length) { document.getElementById('roster-table-body-skaters').innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-400 italic">Aucun joueur importé pour cette saison (Admin → Import FFHG → « Effectif »).</td></tr>'; return; }
            document.getElementById('roster-table-body-skaters').innerHTML = list.map(p => { const G = statOf(p, 'g'), A = statOf(p, 'a'); const cell = (x) => x.auto ? `<span title="Depuis les matchs archivés (auto)">${x.v} 🎬</span>` : x.v; return `<tr class="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer player-row" data-id="${p.id}"><td class="p-3 text-lynx-red font-bold">${p.number||'#'}</td><td class="p-3 font-bold">${playerPhotoOf(p.name) ? `<img src="${playerPhotoOf(p.name)}" alt="" class="w-7 h-7 rounded-full object-cover inline-block align-middle mr-1 border border-gray-300 dark:border-gray-600">` : ''}${p.name}${leagueBadgeOf(p.name)}</td><td class="p-3 text-xs uppercase text-gray-500 hidden md:table-cell">${p.position.substring(0,3)}</td><td class="p-3 text-center text-gray-500">${cell(G)}</td><td class="p-3 text-center text-gray-500">${cell(A)}</td><td class="p-3 font-black text-center">${G.v + A.v}</td><td class="p-3 text-center text-xs text-red-400 font-bold">${p.penalties||0}</td></tr>`; }).join('');

            document.querySelectorAll('.player-row').forEach(r => r.onclick = () => {
                const p = list.find(x=>x.id===r.dataset.id);
                openPlayerModal(p, true);
            });
        }

        function renderLeagueLeaders() { 
            const body = document.getElementById('league-leaders-body'); 
            const sorted = [...leaguePlayers].filter(p => p.season === activeSeason); 
            sorted.sort((a,b) => (Number(b[leagueSort])||0) - (Number(a[leagueSort])||0)); 
            
            body.innerHTML = sorted.slice(0,10).map((p, i) => { 
                const isValence = normalize(p.team).includes('valence'); 
                const rowClass = isValence ? 'bg-red-100 dark:bg-red-900/40 text-lynx-red font-bold border-l-4 border-lynx-red' : 'hover:bg-gray-50 dark:hover:bg-gray-800'; 
                // Using dataset index since these don't have IDs
                return `<tr class="border-b dark:border-gray-700 cursor-pointer league-player-row ${rowClass}" data-idx="${i}"><td class="p-3 font-bold ${isValence ? 'text-lynx-red' : 'text-gray-500'}">${i+1}</td><td class="p-3 font-bold">${p.name}</td><td class="p-3 text-xs flex items-center gap-2"><img src="${getLogo(p.team)}" class="w-4 h-4 object-contain"> ${p.team}</td><td class="p-3 text-center font-black bg-gray-100 dark:bg-gray-700/50 rounded">${p.pts}</td><td class="p-3 text-center hidden md:table-cell ${leagueSort==='goals'?'font-bold text-black dark:text-white':'text-gray-600 dark:text-gray-400'}">${p.goals}</td><td class="p-3 text-center hidden md:table-cell ${leagueSort==='assists'?'font-bold text-black dark:text-white':'text-gray-600 dark:text-gray-400'}">${p.assists}</td><td class="p-3 text-center text-xs text-gray-400">${p.mj}</td></tr>`; 
            }).join('');
            
            document.querySelectorAll('.league-player-row').forEach(r => r.onclick = () => {
                const p = sorted[r.dataset.idx];
                openPlayerModal(p, false);
            });
        }
        
        // ==================== v2.17 : FICHES JOUEUR ENRICHIES ====================
        // Stats dérivées des rapports live archivés : buts/assists suivis, forme, série de points, MVP.
        // Zéro saisie : tout vient des matchs déjà suivis en direct. Cache 3 min.
        let _pstatsCache = { t: 0, v: null };
        const cleanPName = (s) => String(s || '').replace(/^assist\.?\s*/i, '').replace(/^N°\s*\d+\s*/i, '').split('(')[0].trim();
        async function livePlayerStats() {
            if (_pstatsCache.v && Date.now() - _pstatsCache.t < 3 * 60 * 1000) return _pstatsCache.v;
            // v2.22 : filtre par saison (comme les stats gardiens et les spécial teams) — les rapports des
            // saisons passées ne doivent pas gonfler la forme, les totaux 🎬 ni les Leaders de la saison en cours.
            const reps = (await dbFetchCol('live-reports')).map(d => d.data).filter(r => r && Array.isArray(r.events) && (!r.season || String(r.season) === String(activeSeason))).sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
            const byName = new Map();
            const ensure = (nm, team) => { const k = normalize(nm); if (!k) return null; if (!byName.has(k)) byName.set(k, { name: nm, teams: new Set(), g: 0, a: 0, mvp: 0, perGame: new Map() }); const r = byName.get(k); if (team) r.teams.add(team); return r; };
            const addPt = (nm, team, gi, kind) => { const r = ensure(nm, team); if (!r) return; const cur = r.perGame.get(gi) || { p: 0 }; if (kind === 'g') r.g++; else r.a++; r.perGame.set(gi, { p: cur.p + 1 }); };
            reps.forEach((rep, gi) => {
                const hT = rep.homeTeam || '', aT = rep.awayTeam || '';
                (rep.events || []).forEach(e => {
                    if (!e || e.ty !== 'BUT' || !e.who) return;
                    const team = e.side === 'H' ? hT : (e.side === 'A' ? aT : '');
                    addPt(cleanPName(String(e.who).split('(')[0]), team, gi, 'g');
                    const m = String(e.who).match(/\(([^)]*)\)/);
                    if (m) m[1].split(',').forEach(part => addPt(cleanPName(part), team, gi, 'a'));
                });
                (Array.isArray(rep.mvps) ? rep.mvps : []).forEach(mv => { const mp = String(mv).match(/\(([^)]*)\)/); const r = ensure(cleanPName(String(mv).split('(')[0]), mp ? mp[1] : ''); if (r) r.mvp++; });
            });
            byName.forEach(r => {
                const myTeams = [...r.teams].map(t => normalize(t)).filter(Boolean);
                const tIdx = [];
                reps.forEach((rep, i) => { const hN = normalize(rep.homeTeam), aN = normalize(rep.awayTeam); if (myTeams.some(t => t === hN || t === aN)) tIdx.push(i); });
                let streak = 0;
                for (let j = tIdx.length - 1; j >= 0; j--) { const gg = r.perGame.get(tIdx[j]); if (gg && gg.p > 0) streak++; else break; }
                let f3 = 0, f5 = 0;
                for (let j = Math.max(0, tIdx.length - 3); j < tIdx.length; j++) f3 += (r.perGame.get(tIdx[j]) || { p: 0 }).p;
                for (let j = Math.max(0, tIdx.length - 5); j < tIdx.length; j++) f5 += (r.perGame.get(tIdx[j]) || { p: 0 }).p;
                r.streak = streak; r.f3 = f3; r.f5 = f5; r.games = tIdx.length;
            });
            const out = { reps: reps.length, byName };
            _pstatsCache = { t: Date.now(), v: out };
            return out;
        }
        // v2.22 : stats GARDIENS automatiques — depuis les rapports archivés (le flux référence le gardien
        // qui encaisse chaque but, et le rapport stocke les gardiens alignés). Zéro saisie, zéro invention :
        // un gardien n'apparaît que s'il est réellement référencé ou aligné dans un rapport.


async function liveGoalieStats() {
    const reps = (await dbFetchCol('live-reports')).map(d => d.data)
        .filter(r => r && Array.isArray(r.events) && (!r.season || String(r.season) === String(activeSeason)))
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const byName = new Map();
    const ensure = (nm) => { const k = normalize(nm); if (!k) return null; if (!byName.has(k)) byName.set(k, { name: nm, mje: 0, v: 0, dprl: 0, d: 0, blan: 0, bc: 0, shots: 0 }); return byName.get(k); };
    // CORRECTION v2.22 : Initialiser tous les gardiens des effectifs pour la saison active
    (roster || []).filter(p => p.isGoalie && p.season === activeSeason).forEach(g => ensure(g.name));
            reps.forEach(rep => {
                const gh = Number(rep.scoreHome) || 0, gaT = Number(rep.scoreAway) || 0;
                // gardien qui encaisse = gardien de l'équipe EN FACE du buteur (side = équipe qui marque)
                const conceded = { H: [], A: [] };
                (rep.events || []).forEach(e => { if (e && e.ty === 'BUT' && e.gkA) conceded[e.side === 'A' ? 'H' : 'A'].push(e.gkA); });
                const noSub = !(rep.events || []).some(e => e && e.ty === 'REMPLACANT');
                [['H', Array.isArray(rep.gksH) ? rep.gksH : [], Number(rep.shotsA) || 0, gh, gaT, conceded.H],
                 ['A', Array.isArray(rep.gksA) ? rep.gksA : [], Number(rep.shotsH) || 0, gaT, gh, conceded.A]].forEach(([, dressed, sa, my, opp, cgo]) => {
                    const seen = new Map();
                    [...(dressed || []), ...cgo].forEach(nm => { const k = normalize(nm); if (k && !seen.has(k)) seen.set(k, nm); });
                    seen.forEach(nm => { const g = ensure(nm); if (g) g.mje++; });
                    const uniqC = [...new Set(cgo.map(normalize))];
                    const single = dressed.length === 1 ? dressed[0] : (dressed.length === 0 && uniqC.length === 1 ? cgo[0] : null);
                    if (single) {
                        const g = ensure(single); if (!g) return;
                        g.bc += opp; g.shots += sa;
                        if (opp === 0 && noSub) g.blan++;
                        if (my > opp) g.v++; else if (my < opp) { if (rep.isProl) g.dprl++; else g.d++; }
                    } else {
                        cgo.forEach(nm => { const g = ensure(nm); if (g) g.bc++; }); // gardiens multiples : seuls les buts explicitement référencés
                    }
                });
            });
            return byName;
        }
        // Badge de rang ligue (🥇🥈🥉 top 3, 🦁 meilleur Lynx, rang gris sinon) — à côté des noms
        function leagueBadgeOf(name) {
            try {
                const key = normalize(name);
                const list = (leaguePlayers || []).filter(x => x.season === activeSeason).sort((a, b) => (Number(b.pts) || 0) - (Number(a.pts) || 0));
                const i = list.findIndex(x => normalize(x.name) === key);
                if (i < 0 || i > 9) return '';
                const bestL = list.findIndex(x => normalize(String(x.team || '')).includes('valence'));
                const ico = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i === bestL ? '🦁' : '');
                return ` <span class="text-[10px] font-black ${ico ? 'text-amber-500' : 'text-gray-400'}" title="${i + 1}e pointeur de la ligue">${ico || (i + 1) + 'e'}</span>`;
            } catch (e) { return ''; }
        }
        // Section « stats détaillées » de la fiche joueur (rang ligue, stats suivies, forme, MVP, saisons en base, gardiens)
        async function fillPlayerExtra(p, isLynx) {
            const el = document.getElementById('pm-extra');
            if (!el) return;
            try {
                const key = normalize(p.name);
                const amLynx = isLynx || normalize(String(p.team || '')).includes('valence'); // joueur Lynx cliqué depuis le top ligue → fiche complète aussi
                const seasonList = (leaguePlayers || []).filter(x => x.season === activeSeason).sort((a, b) => (Number(b.pts) || 0) - (Number(a.pts) || 0));
                const rank = seasonList.findIndex(x => normalize(x.name) === key);
                const lynxBest = seasonList.findIndex(x => normalize(String(x.team || '')).includes('valence'));
                let st = null;
                try { st = await livePlayerStats(); } catch (e) {}
                const rec = st ? st.byName.get(key) : null;
                if (p.isGoalie) {
                    const kv = (l, v) => `<div class="text-center bg-gray-50 dark:bg-gray-800 rounded-lg p-2"><div class="text-[9px] uppercase font-bold text-gray-400">${l}</div><div class="font-black text-sm">${v}</div></div>`;
                    // v2.22 : stats auto depuis les rapports archivés (le flux référence le gardien qui encaisse)
                    let gkAuto = null;
                    try { gkAuto = (await liveGoalieStats()).get(normalize(p.name)) || null; } catch (e) {}
                    let gkAutoHtml = '';
                    if (gkAuto && (gkAuto.mje || gkAuto.bc)) {
                        const pctA = gkAuto.shots > 0 ? (Math.round((gkAuto.shots - gkAuto.bc) / gkAuto.shots * 1000) / 10).toString().replace('.', ',') + ' %' : null;
                        gkAutoHtml = `<div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-sm space-y-1 mt-2"><div class="text-[10px] uppercase font-bold text-gray-400">🎬 Depuis les matchs archivés (calculé automatiquement)</div><div>MJ <strong>${gkAuto.mje}</strong> · BC <strong>${gkAuto.bc}</strong>${pctA ? ` · % arrêts ≈ <strong>${pctA}</strong>` : ''}${gkAuto.blan ? ` · <strong>${gkAuto.blan}</strong> blanchissage(s)` : ''}</div><div class="text-gray-500">Bilan : <strong>${gkAuto.v} V</strong> · ${gkAuto.dprl} D-PR · ${gkAuto.d} D</div></div>`;
                    }
                    el.innerHTML = `<div class="grid grid-cols-4 gap-2">${kv('MJE', p.mje || 0)}${kv('V', p.v || 0)}${kv('D-PR', p.dprl || 0)}${kv('D', p.d || 0)}${kv('Blanchissages', p.blan || 0)}${kv('BC', p.bc || 0)}${kv('Moyenne buts', (typeof p.moy === 'number' && isFinite(p.moy)) ? p.moy.toFixed(2).replace('.', ',') : '-')}${kv('% arrêts', (typeof p.pct === 'number' && isFinite(p.pct)) ? p.pct.toFixed(2).replace('.', ',') + '%' : '-')}</div>` + gkAutoHtml + (rec && rec.mvp ? `<p class="text-sm text-gray-500">⭐ Joueur du match : <strong>${rec.mvp}</strong> fois (matchs suivis)</p>` : '');
                    return;
                }
                const bits = [];
                if (rank >= 0) bits.push(`<div class="text-center text-sm font-bold ${rank < 3 || rank === lynxBest ? 'text-amber-500' : 'text-gray-500'}">${rank === 0 ? '🥇 ' : rank === 1 ? '🥈 ' : rank === 2 ? '🥉 ' : ''}${rank + 1}e pointeur de la ligue${rank === lynxBest ? ' — 🦁 meilleur Lynx' : ''} (${seasonList[rank].pts} pts)</div>`);
                if (rec && (rec.g || rec.a || rec.mvp)) bits.push(`<div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-sm space-y-1"><div class="text-[10px] uppercase font-bold text-gray-400">Matchs suivis en direct</div><div>Buts <strong>${rec.g}</strong> · Assists <strong>${rec.a}</strong> — <strong>${rec.g + rec.a} pts</strong> en ${rec.games} match(s)</div><div class="text-gray-500">Forme : ${rec.f3} pt(s) sur les 3 derniers · ${rec.f5} sur les 5 derniers${rec.streak ? ` · série de <strong>${rec.streak}</strong> match(s) avec point` : ''}${rec.mvp ? ` · ⭐ joueur du match : <strong>${rec.mvp}</strong> fois` : ''}</div></div>`);
                const seasonsOf = (amLynx ? roster : []).filter(x => normalize(x.name) === key && x.season).sort((a, b) => String(b.season).localeCompare(String(a.season)));
                if (seasonsOf.length) {
                    const teamGames = (sn) => allMatches.filter(m => m.season === sn && /valence/i.test(`${m.homeTeam || ''}${m.awayTeam || ''}`) && isMatchFinished(m)).length;
                    const rows = seasonsOf.map(x => { const pts2 = (Number(x.goals) || 0) + (Number(x.assists) || 0); const mj = teamGames(x.season); return { season: x.season, pts: pts2, pm: mj ? Math.round(pts2 / mj * 100) / 100 : null }; });
                    let wSum = 0, sc = 0;
                    rows.forEach((r2, idx) => { const w = Math.pow(0.8, idx); if (r2.pm != null) { wSum += w; sc += w * r2.pm; } });
                    const best = rows.reduce((mx, r2) => Math.max(mx, r2.pts), 0);
                    const isRookie = rows.length === 1 && String(rows[0].season) === String(activeSeason);
                    bits.push(`<div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-sm space-y-1"><div class="text-[10px] uppercase font-bold text-gray-400">Saisons en base${isRookie ? ' — 🆕 première saison en base' : ''}</div>${rows.map(r2 => `<div class="flex justify-between"><span>${r2.season}</span><span><strong>${r2.pts} pts</strong>${r2.pm != null ? ` <span class="text-gray-400">(${String(r2.pm).replace('.', ',')}/match)</span>` : ''}</span></div>`).join('')}${wSum ? `<div class="pt-1 border-t dark:border-gray-700">Score global pondéré (pts/match, saisons récentes majorées) : <strong>${(Math.round(sc / wSum * 100) / 100).toString().replace('.', ',')}</strong>${best ? ` · meilleure saison : <strong>${best} pts</strong>` : ''}</div>` : ''}</div>`);
                } else if (!amLynx) {
                    bits.push(`<p class="text-[11px] text-gray-400 italic">Joueur adverse — stats uniquement sur les matchs suivis en direct (pas de stats de saison en base, aucune invention).</p>`);
                }
                el.innerHTML = bits.join('');
            } catch (e) { console.warn('fillPlayerExtra', e); el.innerHTML = ''; }
        }

        function openPlayerModal(p, isLynx) {
            document.getElementById('pm-name').textContent = p.name; 
            document.getElementById('pm-team-badge').textContent = isLynx ? 'Valence (Lynx)' : p.team;
            const pmPh = playerPhotoOf(p.name);
            const pmAv = document.getElementById('pm-avatar-placeholder');
            if (pmAv) { if (pmPh) { pmAv.innerHTML = '<img src="' + pmPh + '" alt="" class="w-full h-full object-cover rounded-full">'; pmAv.style.overflow = 'hidden'; } else { pmAv.textContent = isLynx ? (p.number || '#') : p.name.charAt(0); } }
            
            const isGk = !!p.isGoalie; // v2.17 : les fiches gardiens ouvrent la même modale (grille/radar masqués, bloc dédié dans pm-extra)
            const pmGrid = document.getElementById('pm-stats-grid');
            if (pmGrid) pmGrid.style.display = isGk ? 'none' : '';
            document.getElementById('pm-goals').textContent = p.goals || 0; 
            document.getElementById('pm-assists').textContent = p.assists; 
            document.getElementById('pm-points').textContent = (p.goals||0)+(p.assists||0); 
            if(p.pts) document.getElementById('pm-points').textContent = p.pts; // Override if present
            document.getElementById('pm-pen').textContent = (p.penalties || '0') + 'm'; 
            
            // Generate Single Radar
            const stats = {
                goals: p.goals || 0,
                assists: p.assists || 0,
                pts: (p.goals||0) + (p.assists||0),
                mj: p.mj || 14,
                ratio: ((p.goals||0) + (p.assists||0)) / (p.mj || 1)
            };
            if(p.pts) stats.pts = p.pts;

            const maxValues = {
                goals: 25,
                assists: 30,
                pts: 50,
                mj: 26,
                ratio: 2.5
            };
            
            document.getElementById('pm-radar-chart').innerHTML = isGk ? '' : generateRadarChart(p, null, stats, null, maxValues);
            const pmRadBox = document.getElementById('pm-radar-chart').parentElement;
            if (pmRadBox) pmRadBox.style.display = isGk ? 'none' : '';
            const pmEx = document.getElementById('pm-extra');
            if (pmEx) pmEx.innerHTML = '';
            try { fillPlayerExtra(p, isLynx); } catch (e) {}

            toggleModal('player-modal', true); 
        }

        // v2.22 : top buteur/pointeur en AUTO — si les matchs archivés donnent plus que l'import, le chiffre auto gagne (🎬)
        async function renderLeaders(list) {
            let auto = null;
            try { auto = (await livePlayerStats()).byName; } catch (e) {}
            const merged = list.map(p => { const r = auto && auto.get(normalize(p.name)); const g = Math.max(Number(p.goals) || 0, (r && r.g) || 0); const a = Math.max(Number(p.assists) || 0, (r && r.a) || 0); return Object.assign({}, p, { goals: g, assists: a, gAuto: (r && r.g || 0) > (Number(p.goals) || 0), aAuto: (r && r.a || 0) > (Number(p.assists) || 0) }); });
            const topPointer = [...merged].sort((a,b)=>((b.goals||0)+(b.assists||0))-((a.goals||0)+(a.assists||0)))[0];
            const topScorer = [...merged].sort((a,b)=>(b.goals||0)-(a.goals||0))[0];
            const topPen = [...list].sort((a,b)=>(b.penalties||0)-(a.penalties||0))[0];
            let html = '';
            const card = (icon, title, name, val, colorClass) => `<div class="flex flex-col items-center p-4 border rounded ${colorClass} text-center shadow-sm"><div class="text-3xl mb-1">${icon}</div><div class="text-[10px] uppercase font-bold opacity-70">${title}</div><div class="font-bold text-base truncate w-full">${name}</div><div class="font-black text-xl">${val}</div></div>`;
            if(topScorer) html += card('🥅', 'Top Buteur', topScorer.name, (topScorer.goals||0) + (topScorer.gAuto ? ' 🎬' : ''), 'bg-blue-50 dark:bg-blue-900/20 border-blue-200');
            if(topPointer) html += card('👑', 'Top Pointeur', topPointer.name, ((topPointer.goals||0)+(topPointer.assists||0)) + ((topPointer.gAuto || topPointer.aAuto) ? ' 🎬' : ''), 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200');
            if(topPen) html += card('🤬', 'Bad Boy', topPen.name, (topPen.penalties||0)+' min', 'bg-red-50 dark:bg-red-900/20 border-red-200');
            document.getElementById('player-leaders-list').innerHTML = html;
        }

        function renderUsefulLinks() { 
            const container = document.getElementById('useful-links-container'); 
            const listAdmin = document.getElementById('admin-links-list'); 
            if(!usefulLinks || usefulLinks.length === 0) { 
                container.innerHTML = `<div class="col-span-3 text-center text-xs text-gray-400 italic">Aucun lien configuré</div>`; 
                listAdmin.innerHTML = `<div class="text-xs text-gray-400 italic">Aucun lien</div>`; 
                return; 
            } 
            container.innerHTML = usefulLinks.map(l => {
                let domain = ""; try { domain = new URL(l.url).hostname; } catch(e){}
                const favicon = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
                return `<a href="${l.url}" data-url="${xmlEsc(l.url)}" data-name="${xmlEsc(l.name)}" class="p-3 bg-gray-100 dark:bg-gray-800 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition text-center truncate flex items-center justify-center gap-2 border border-transparent hover:border-blue-200">${favicon ? `<img src="${favicon}" class="w-4 h-4 rounded-sm">` : ''}<span class="truncate">${l.name}</span></a>`;
            }).join('');
            container.querySelectorAll('a[data-url]').forEach(a => { a.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); try { openLinkSheet(a.dataset.url, a.dataset.name); } catch (err) { window.open(a.dataset.url, '_blank'); } }); }); // v2.22 : demi-fenêtre en bas (Ctrl/maj-clic = nouvel onglet)
            listAdmin.innerHTML = usefulLinks.map((l, i) => `<div class="flex justify-between items-center bg-white dark:bg-gray-700 p-2 rounded text-sm shadow-sm"><div class="truncate flex-1"><span class="font-bold">${l.name}</span> <span class="text-xs text-gray-400 mx-1">${l.url}</span></div><button class="text-red-500 hover:text-red-700 ml-2 delete-link-btn" data-idx="${i}"><i class="fa-solid fa-trash"></i></button></div>`).join(''); 
            document.querySelectorAll('.delete-link-btn').forEach(b => { b.onclick = () => { appConfirm('Supprimer ce lien ?', async () => { const newLinks = [...usefulLinks]; newLinks.splice(b.dataset.idx, 1); await setDoc(doc(db, `${basePath}/settings/general`), { links: newLinks }, {merge:true}); }); }; }); 
        }
