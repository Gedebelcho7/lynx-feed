// ===== CARTES DE MATCH : absents, carte de match, dernier résultat enrichi, forme, calendrier Lynx, défilement vers le prochain match =====
        // --- RESTORED RENDER FUNCTIONS ---
        // v2.18 : ligne « absents » pour la carte du prochain match (déclarés en Admin, pris en compte par le modèle)
        function absencesForCard(m) {
            try {
                const ts = new Date(m.date).getTime();
                const h = absencesAt(m.homeTeam, ts), a = absencesAt(m.awayTeam, ts);
                const parts = [];
                if (h.length) parts.push(xmlEsc(m.homeTeam) + ' : ' + h.map(x => xmlEsc(x.name) + (String(x.pos) === 'G' ? ' (G)' : '')).join(', '));
                if (a.length) parts.push(xmlEsc(m.awayTeam) + ' : ' + a.map(x => xmlEsc(x.name) + (String(x.pos) === 'G' ? ' (G)' : '')).join(', '));
                return parts.length ? `<div class="mt-1 text-[11px] font-bold text-amber-600 dark:text-amber-400" title="Absents déclarés — le modèle ajuste le pronostic en conséquence (sans jamais toucher l'historique)">❌ Absents — ${parts.join(' · ')} <span class="text-gray-400">(pris en compte par le modèle)</span></div>` : '';
            } catch (e) { return ''; }
        }
        function renderMatchCard(m, id, isDone, rankingCtx=[]) { 
            const el = document.getElementById(id); 
            if(!el) return; 
            if(!m) { 
                el.innerHTML = '<p class="text-gray-500 italic text-center">Aucune donnée</p>'; 
                // Hide button if no match
                if(id === 'upcoming-match-content') {
                     const btn = document.getElementById('btn-ask-bot-h2h');
                     if(btn) btn.classList.add('hidden');
                }
                return; 
            } 
            const dtmCard = new Date(m.date); 
            const tTxtCard = (dtmCard.getHours() || dtmCard.getMinutes()) ? ' · ' + dtmCard.getHours() + 'h' + String(dtmCard.getMinutes()).padStart(2, '0') : ''; 
            const date = new Date(m.date).toLocaleDateString('fr-FR', {day:'numeric', month:'short'}) + tTxtCard; 
            const valid = isMatchFinished(m); 
            const w = valid && ((normalize(m.homeTeam).includes('valence') && m.scoreHome>m.scoreAway) || (!normalize(m.homeTeam).includes('valence') && m.scoreAway>m.scoreHome)); 
            const col = valid ? (w ? 'text-green-500' : 'text-red-500') : 'text-gray-900 dark:text-white'; 
            const displayScore = valid ? `${m.scoreHome}-${m.scoreAway}` : 'VS'; 
            let extraHtml = ''; 
            if(!isDone && rankingCtx.length > 0) { 
                const hTeam = rankingCtx.find(t => normalize(t.team) === normalize(m.homeTeam)); 
                const aTeam = rankingCtx.find(t => normalize(t.team) === normalize(m.awayTeam)); 
                if(hTeam && aTeam) { 
                    const hPts = hTeam.pts || 1; const aPts = aTeam.pts || 1; const total = hPts + aPts; const hPct = (hPts/total)*100; 
                    const dotsOf = (f) => String(f || '').split('').map(c => `<span class="form-dot ${c === 'V' || c === 'v' ? 'form-win' : (c === 'D' || c === 'd' ? 'form-loss' : 'form-draw')}" title="${c}"></span>`).join('') || '<span class="text-[10px] text-gray-400">—</span>';
                    extraHtml = `<div class="w-full mt-3 px-4"><div class="flex justify-between text-[10px] font-bold uppercase text-gray-500 mb-1"><span>Forme (5 derniers)</span></div><div class="flex justify-between items-center text-[11px] font-bold mb-2"><span class="flex items-center gap-1"><img src="${getLogo(m.homeTeam)}" class="w-4 h-4 object-contain">${dotsOf(hTeam.form)}</span><span class="flex items-center gap-1">${dotsOf(aTeam.form)}<img src="${getLogo(m.awayTeam)}" class="w-4 h-4 object-contain"></span></div><div class="flex justify-between text-[10px] font-bold uppercase text-gray-500 mb-1"><span>Force (Pts)</span></div><div class="flex h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"><div class="bg-lynx-red h-full" style="width: ${hPct}%"></div><div class="bg-blue-500 h-full" style="width: ${100-hPct}%"></div></div><div class="flex justify-between text-[10px] font-bold mt-1"><span>${hPts} pts</span><span>${aPts} pts</span></div></div>`; 
                } 
            } 
            el.innerHTML = `<div class="text-center w-full"><div class="text-xs text-gray-400 mb-2 font-bold">${date}</div><div class="flex justify-center items-center gap-4 mb-2"><img src="${getLogo(m.homeTeam)}" class="w-10 h-10 object-contain"><div class="text-2xl font-black ${col}">${displayScore}</div><img src="${getLogo(m.awayTeam)}" class="w-10 h-10 object-contain"></div>${!isDone ? `<button class="open-h2h btn-secondary text-[10px] py-1 px-2 rounded" data-home="${m.homeTeam}" data-away="${m.awayTeam}">Face-à-Face</button>` : ''}${extraHtml}${(!isDone && id === 'upcoming-match-content' && oddsNextHtmlForCard) ? oddsNextHtmlForCard : ''}${(!isDone && id === 'upcoming-match-content' && scorerPickCache) ? `<div class="mt-2 text-[11px] font-bold text-gray-500 dark:text-gray-300" title="Calculé depuis les buteurs des matchs suivis en direct (${scorerPickCache.src})">🎯 Buteur pressenti : <span class="text-lynx-red font-black">${xmlEsc(scorerPickCache.name)}</span>${scorerPickCache.pct ? ' — ' + scorerPickCache.pct + ' % des buts marqués' : ' — ' + scorerPickCache.goals + ' but(s) cette saison'}</div>` : ''}${(!isDone && id === 'upcoming-match-content') ? absencesForCard(m) : ''}</div>`; 
        }

        // v2.19 : enrichit la carte « Dernier Résultat » avec le relevé live du match (score par tiers, buts Lynx, joueur du match)
        async function enrichLatestResult(m) {
            const el = document.getElementById('latest-result-content');
            if (!el || !m || !isMatchFinished(m)) return;
            try {
                const reps = (await dbFetchCol('live-reports')).map(d => ({ ...d.data, _id: d.id }));
                const mKey = (a, b) => normalize(a) + '|' + normalize(b);
                let rep = reps.find(r => r._id === m.id);
                if (!rep) rep = reps.find(r => {
                    const rd = r.date ? new Date(r.date) : null; const md = new Date(m.date);
                    if (!rd || Math.abs(rd - md) > 36 * 36e5) return false;
                    return mKey(r.homeTeam, r.awayTeam) === mKey(m.homeTeam, m.awayTeam) || mKey(r.awayTeam, r.homeTeam) === mKey(m.homeTeam, m.awayTeam);
                });
                if (!rep) {
                    // pas de suivi en direct pour ce match : on affiche quand même le bilan de la saison (données réelles)
                    const fin = allMatches.filter(x => x.season === activeSeason && (!x.type || x.type === 'Saison') && isMatchFinished(x) && x.scoreHome != null && x.scoreAway != null);
                    let v = 0, nn = 0, dd = 0;
                    // v2.22 : ne compter que les matchs où Valence joue réellement (avant : chaque match sans Valence était compté comme une défaite)
                    fin.forEach(x => { const lv = normalize(x.homeTeam).includes('valence'); const av = normalize(x.awayTeam).includes('valence'); if (!lv && !av) return; const my = lv ? x.scoreHome : x.scoreAway, oo = lv ? x.scoreAway : x.scoreHome; if (my > oo) v++; else if (my < oo) dd++; else nn++; });
                    el.insertAdjacentHTML('beforeend', `<div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 w-full text-center"><span class="text-[11px] font-bold text-gray-600 dark:text-gray-300">Bilan de la saison : <span class="text-green-600">${v} V</span> · ${nn} N · <span class="text-red-500">${dd} D</span></span><div class="text-[10px] text-gray-400 italic mt-1">Tiers, buteurs et joueur du match s'affichent ici après un match suivi en direct.</div></div>`);
                    return;
                }
                const lynxHome = normalize(m.homeTeam).includes('valence');
                const my = lynxHome ? m.scoreHome : m.scoreAway, opp = lynxHome ? m.scoreAway : m.scoreHome;
                const verdict = my > opp ? { txt: 'VICTOIRE', cls: 'bg-green-500' } : (my < opp ? { txt: 'DÉFAITE', cls: 'bg-red-500' } : { txt: 'NUL', cls: 'bg-gray-500' });
                const perT = rep.perT || [];
                const perPair = (x) => { if (Array.isArray(x)) return [Number(x[0]) || 0, Number(x[1]) || 0]; const s = String(x || '').split('-'); return [Number(s[0]) || 0, Number(s[1]) || 0]; }; // v2.22 : accepte l'ancien format [1,0] et le nouveau « 1-0 »
                const tiers = perT.length ? `<div class="flex justify-center gap-2 mt-3 flex-wrap">` + [[0, 'T1'], [1, 'T2'], [2, 'T3']].map(p => `<span class="text-[10px] font-bold bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-1">${p[1]} <span class="text-lynx-red">${perPair(perT[p[0]])[0]}-${perPair(perT[p[0]])[1]}</span></span>`).join('') + (rep.isProl ? `<span class="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full px-2 py-1">prolong.</span>` : '') + `</div>` : '';
                const lynxSide = lynxHome ? 'H' : 'A';
                // v2.21 : timeline du match — frise des buts et pénalités depuis le rapport live
                let tl = '';
                try {


const evs = [...(rep.events || [])].filter(e => e && e.ty);
if (evs.length) {
    const minOf = (e) => { const timeStr = String(e.time || e.temps || ''); const match = timeStr.match(/(\d{1,2}):?(\d{2})?/); if (match) return Number(match[1]); const anyMatch = timeStr.match(/(\d+)/); return anyMatch ? Number(anyMatch[1]) : 0; };
    const maxMin = Math.max(60, ...evs.map(minOf).filter(m => m > 0)) + 1;
    const px = (min) => (Math.max(0, Math.min(1, min / maxMin)) * 100).toFixed(2);
    let inner = '';
    [[20, 'Fin T1'], [40, 'Fin T2'], [60, 'Fin T3']].forEach(t => { if (t[0] < maxMin) inner += `<div class=\"absolute top-0 bottom-0 w-px bg-gray-300 dark:bg-gray-600\" style=\"left:${px(t[0])}%\" title=\"${t[1]}\"></div>`; });
    const _lane = {}; // anti-superposition — deux points à la même minute ne s'écrasent plus
    evs.forEach(e => {
        const min = minOf(e);
        const who = String(e.who || '').split('(')[0].trim();
        const timeStr = xmlEsc(String(e.time || e.temps || ''));
        const _pos = px(min);
        const _laneId = (e.ty === 'BUT' || /TIR|SHOT/i.test(String(e.ty))) ? ((e.side === lynxSide) ? 'haut' : 'bas') : 'milieu';
        const _off = (_lane[_laneId + '@' + _pos] || 0) * 6; _lane[_laneId + '@' + _pos] = (_lane[_laneId + '@' + _pos] || 0) + 1;
        if (e.ty === 'BUT') {
            const mine = e.side === lynxSide;
            inner += `<div class=\"absolute -translate-x-1/2 ${mine ? 'top-0' : 'bottom-0'}\" style=\"left:calc(${_pos}% + ${_off}px)\" title=\"${mine ? 'But Lynx' : 'But adverse'} – ${xmlEsc(who)} (${timeStr})\"><div class=\"w-3 h-3 rounded-full ring-2 ring-white dark:ring-gray-900 ${mine ? 'bg-lynx-red' : 'bg-sky-700'}\"></div></div>`;
        } else if (/TIR|SHOT/i.test(String(e.ty))) {
            const mine = e.side === lynxSide;
            inner += `<div class=\"absolute -translate-x-1/2 ${mine ? 'top-0' : 'bottom-0'}\" style=\"left:calc(${_pos}% + ${_off}px);opacity:0.4\" title=\"${mine ? 'Tir Lynx' : 'Tir adverse'} – ${xmlEsc(who)} (${timeStr})\"><div class=\"w-2 h-2 rounded-full ${mine ? 'bg-lynx-red/60' : 'bg-sky-700/60'}\"></div></div>`;
        } else if (/PEN|PUN/i.test(String(e.ty))) {
            inner += `<div class=\"absolute -translate-x-1/2 top-1/2 -mt-1\" style=\"left:calc(${_pos}% + ${_off}px)\" title=\"Pénalité ${xmlEsc(who)} (${timeStr})\"><div class=\"w-2 h-2 rotate-45 bg-amber-500\"></div></div>`;
        }
    });




                        tl = `<div class="mt-3 relative h-12 w-full max-w-md mx-auto"><div class="absolute top-1/2 left-0 right-0 h-0.5 bg-gray-200 dark:bg-gray-700 -translate-y-1/2"></div>${inner}</div><div class="flex justify-between items-center text-[9px] text-gray-400 font-bold max-w-md mx-auto gap-2"><span>0'</span><span>🚨 Lynx (haut) · adversaire (bas) · ◆ pénalités · ● tirs</span><span>${maxMin - 1}'</span></div>`;
                    }
                } catch (e) {}
                const scorers = [...(rep.events || [])].filter(e => e && e.ty === 'BUT' && e.side === lynxSide && e.who).map(e => String(e.who).split('(')[0].trim() + (e.time ? ' (' + e.time + ')' : '') + (e.sit === 'SUP' ? ' SN' : e.sit === 'INF' ? ' IN' : '')).filter(Boolean);
                const scorersHtml = scorers.length ? `<div class="mt-2 text-[11px] text-gray-600 dark:text-gray-300 font-bold">🚨 Buts Lynx : ${scorers.map(xmlEsc).join(' · ')}</div>` : '';
                const mvp = (Array.isArray(rep.mvps) ? rep.mvps : []).filter(Boolean);
                const mvpHtml = mvp.length ? `<div class="mt-1 text-[11px] font-bold text-purple-500 dark:text-purple-300">⭐ Joueur du match : ${mvp.map(xmlEsc).join(' et ')}</div>` : '';
                el.insertAdjacentHTML('beforeend', `<div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 w-full text-center"><span class="inline-block text-[10px] font-black text-white px-3 py-1 rounded-full ${verdict.cls}">${verdict.txt}</span>${tl}${tiers}${scorersHtml}${mvpHtml}</div>`);
            } catch (e) { console.warn('enrichLatestResult', e); }
        }

        function renderForm(doneMatches) { 
            const el = document.getElementById('home-team-form'); 
            const advancedEl = document.getElementById('home-advanced-stats');
            
            if(!doneMatches.length) { 
                el.innerHTML = '<span class="text-xs text-gray-400">-</span>'; 
                if(advancedEl) advancedEl.innerHTML = '';
                return; 
            } 
            
            // 1. Render standard form dots
            let formHtml = doneMatches.slice(-5).map(m => { 
                const isVal = normalize(m.homeTeam).includes('valence'); 
                const s = isVal ? m.scoreHome : m.scoreAway; 
                const o = isVal ? m.scoreAway : m.scoreHome; 
                let cls = 'form-draw'; 
                if(s > o) cls = 'form-win'; else if (s < o) cls = 'form-loss'; 
                return `<span class="form-dot ${cls}" title="${m.homeTeam} vs ${m.awayTeam}: ${m.scoreHome}-${m.scoreAway}"></span>`; 
            }).join(''); 

            // 2. Calculate current streak
            let currentStreak = 0;
            let streakType = null; // 'W' or 'L'
            
            for(let i = doneMatches.length - 1; i >= 0; i--) {
                const m = doneMatches[i];
                const isVal = normalize(m.homeTeam).includes('valence');
                const s = isVal ? m.scoreHome : m.scoreAway; 
                const o = isVal ? m.scoreAway : m.scoreHome;
                const res = s > o ? 'W' : (s < o ? 'L' : 'D');
                
                if (res === 'D') break; // Nul annule la série
                
                if (streakType === null) {
                    streakType = res;
                    currentStreak = 1;
                } else if (streakType === res) {
                    currentStreak++;
                } else {
                    break;
                }
            }

            if (currentStreak > 1) {
                 const typeText = streakType === 'W' ? 'Victoires' : 'Défaites';
                 const typeColor = streakType === 'W' ? 'text-green-600 bg-green-100 border-green-200' : 'text-red-600 bg-red-100 border-red-200';
                 const icon = streakType === 'W' ? '🔥' : '🥶';
                 formHtml += `<span class="ml-3 text-[10px] font-black px-2 py-0.5 rounded border ${typeColor}">Série: ${currentStreak} ${typeText} ${icon}</span>`;
            }
            
            el.innerHTML = formHtml;

            // 3. Render Advanced Stats (Home/Away Breakdown)
            if(advancedEl) {
                let homeWins = 0, homeLosses = 0, awayWins = 0, awayLosses = 0;
                doneMatches.forEach(m => {
                     const isHome = normalize(m.homeTeam).includes('valence');
                     const s = isHome ? m.scoreHome : m.scoreAway; 
                     const o = isHome ? m.scoreAway : m.scoreHome;
                     if (s > o) {
                         if (isHome) homeWins++; else awayWins++;
                     } else if (s < o) {
                         if (isHome) homeLosses++; else awayLosses++;
                     }
                });

                advancedEl.innerHTML = `
                    <div class="flex justify-around mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                        <div class="text-center px-2">
                            <div class="text-[9px] uppercase font-bold text-gray-400 mb-0.5 flex items-center justify-center"><i class="fa-solid fa-house mr-1"></i>À Dom</div>
                            <div class="text-xs font-black bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded"><span class="text-green-500">${homeWins}V</span> - <span class="text-red-500">${homeLosses}D</span></div>
                        </div>
                        <div class="text-center px-2">
                            <div class="text-[9px] uppercase font-bold text-gray-400 mb-0.5 flex items-center justify-center"><i class="fa-solid fa-bus mr-1"></i>À L'Ext</div>
                            <div class="text-xs font-black bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded"><span class="text-green-500">${awayWins}V</span> - <span class="text-red-500">${awayLosses}D</span></div>
                        </div>
                    </div>
                `;
            }
        }

        // v2.17 : repère de mi-saison — la « phase retour » commence à la première seconde rencontre
        // entre deux mêmes équipes du calendrier (aller-retour simple) ; -1 si pas encore de retour.
        // Les matchs à venir comptent aussi : le repère reste stable du début à la fin de saison.
        function firstReturnIdx(ms) {
            const seen = new Set();
            for (let i = 0; i < ms.length; i++) {
                const k = [normalize(ms[i].homeTeam), normalize(ms[i].awayTeam)].sort().join('|');
                if (seen.has(k)) return i;
                seen.add(k);
            }
            return -1;
        }
        const retourMarkerHtml = `<div class="flex items-center gap-2 my-2"><div class="flex-1 border-t-2 border-dashed border-lynx-red/60"></div><span class="text-[10px] font-black uppercase tracking-widest text-lynx-red whitespace-nowrap">↩ Début de la phase retour</span><div class="flex-1 border-t-2 border-dashed border-lynx-red/60"></div></div>`;

        function renderLynxCal(list) {
            const el = document.getElementById('lynx-matches-list');
            const rIdx = firstReturnIdx(list);
            el.innerHTML = list.length ? list.map((m, i) => (i === rIdx ? retourMarkerHtml : '') + generateMatchRow(m, true)).join('') : "Empty";
            if(window.attachQuickScoreEvents) window.attachQuickScoreEvents();
            markNextMatchRow(el, list);
        }
        // v2.17 : marque le prochain match à venir d'une liste (l'onglet y défile automatiquement à l'ouverture)
        function markNextMatchRow(container, matches) {
            if (!container) return;
            container.querySelectorAll('[data-next-match]').forEach(r => r.removeAttribute('data-next-match'));
            const now = Date.now();
            const next = (matches || []).filter(m => m && !isMatchFinished(m) && (new Date(m.date).getTime() || 0) + 3 * 3600e3 > now).sort((a, b) => new Date(a.date) - new Date(b.date))[0];
            if (next && next.id) { const row = container.querySelector(`[data-id="${next.id}"]`); if (row) row.setAttribute('data-next-match', '1'); }
        }
        function scrollSectionToNextMatch(sectionId) {
            // v2.22 : le match cible se place SOUS les barres collantes (en-tête + filtres) au lieu de
            // disparaître dessous — et une 2e passe recale le défilement après le rendu/chargement des logos.
            try {
                const sec = document.getElementById(sectionId);
                const row = sec ? sec.querySelector('[data-next-match="1"]') : null;
                if (!row) return;
                const go = () => {
                    try {
                        const top = row.getBoundingClientRect().top + window.scrollY - 130;
                        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
                    } catch (e) { row.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
                };
                setTimeout(go, 150); setTimeout(go, 900);
            } catch (e) {}
        }