// ===== CALENDRIER GLOBAL COMPLET : filtres, rendu, modale séries, bracket, titres, extrêmes =====
        let calFilters = { ta: '', tb: '', when: 'all', scope: 'all' };
        // v2.22 : sMatches est LOCAL à la fonction de rendu — les filtres doivent passer par la globale allMatches
        const calSeasonMs = () => (allMatches || []).filter(m => m.season === activeSeason);
        function fillCalTeams() {
            const a = document.getElementById('cal-team-a'), b = document.getElementById('cal-team-b');
            if (!a || !b) return;
            const teams = [...new Set(calSeasonMs().flatMap(m => [m.homeTeam, m.awayTeam]).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'fr'));
            const cur = { a: a.value, b: b.value };
            const opts = (sel) => '<option value="">Toutes les équipes</option>' + teams.map(t => `<option value="${xmlEsc(t)}"${t === sel ? ' selected' : ''}>${xmlEsc(t)}</option>`).join('');
            a.innerHTML = opts(cur.a); b.innerHTML = opts(cur.b);
        }
        function initCalSearch() {
            const a = document.getElementById('cal-team-a'), b = document.getElementById('cal-team-b'), w = document.getElementById('cal-when'), s = document.getElementById('cal-scope'), r = document.getElementById('cal-search-reset');
            if (!a || a.dataset.wired) return; a.dataset.wired = '1';
            if (a) a.onchange = () => { calFilters.ta = a.value; try { renderFullCal(calSeasonMs()); } catch (e) {} };
            if (b) b.onchange = () => { calFilters.tb = b.value; try { renderFullCal(calSeasonMs()); } catch (e) {} };
            if (w) w.onchange = () => { calFilters.when = w.value; try { renderFullCal(calSeasonMs()); } catch (e) {} };
            if (s) s.onchange = () => { calFilters.scope = s.value; try { renderFullCal(calSeasonMs()); } catch (e) {} };
            if (r) r.onclick = () => { calFilters = { ta: '', tb: '', when: 'all', scope: 'all' }; if (a) a.value = ''; if (b) b.value = ''; if (w) w.value = 'all'; if (s) s.value = 'all'; try { renderFullCal(calSeasonMs()); } catch (e) {} };
            // v2.22 : bouton « Prochaine journée » — défile jusqu'au match à venir marqué dans la liste
            const jf = document.getElementById('btn-jump-next-full');
            if (jf) jf.onclick = () => scrollSectionToNextMatch('full-calendar');
        }

        function renderFullCal(list) {
             try { fillCalTeams(); } catch (e) {} // v2.22 : listes d'équipes des menus déroulants toujours à jour
             const playoffs = list.filter(m => m.type === 'Playoff' || m.type === 'Playoffs' || (m.type && m.type !== 'Saison' && !/maintien/i.test(m.type))).sort((a,b)=>new Date(a.date)-new Date(b.date));
             const regular = list.filter(m => !m.type || m.type === 'Saison').sort((a,b)=>new Date(a.date)-new Date(b.date));
             
             renderMaintien(list);
             
             const plContainer = document.getElementById('playoffs-container');
             const plContent = document.getElementById('playoffs-content');
             
             if (playoffs.length > 0) {
                 plContainer.classList.remove('hidden');
                 
                 // Group by Phase
                 const phases = {};
                 playoffs.forEach(m => {
                     let phaseName = m.type || 'Playoffs';
                     if (!phases[phaseName]) phases[phaseName] = [];
                     phases[phaseName].push(m);
                 });

                 const getPhaseWeight = (p) => {
                     const n = normalize(p);
                     if(n.includes('finale') || n.includes('final')) return 100;
                     if(n.includes('demi') || n.includes('1/2')) return 50;
                     if(n.includes('quart') || n.includes('1/4')) return 25;
                     if(n.includes('huit') || n.includes('1/8')) return 12;
                     return 0;
                 };

                 const sortedKeys = Object.keys(phases).sort((a,b) => getPhaseWeight(a) - getPhaseWeight(b));

                 plContent.innerHTML = sortedKeys.map(phaseKey => {
                     // GROUP BY SERIES (Team A vs Team B)
                     const seriesMap = {};
                     phases[phaseKey].forEach(m => {
                         const pairKey = [m.homeTeam, m.awayTeam].sort().join('_');
                         if(!seriesMap[pairKey]) seriesMap[pairKey] = { teams: [m.homeTeam, m.awayTeam], matches: [] };
                         seriesMap[pairKey].matches.push(m);
                     });
                     
                     const seriesHTML = Object.values(seriesMap).map(s => {
                         const teamA = s.teams[0];
                         const teamB = s.teams[1];
                         
                         // Calculate Series Score
                         let winsA = 0, winsB = 0;
                         let hasWinner = false;
                         let winnerTeam = "";
                         
                         s.matches.forEach(m => {
                             if(isMatchFinished(m)) {
                                 const sHome = m.scoreHome; const sAway = m.scoreAway;
                                 if((m.homeTeam === teamA && sHome > sAway) || (m.homeTeam === teamB && sAway > sHome)) winsA++;
                                 else winsB++;
                             }
                         });
                         
                         // Check status
                         const matchesPlayed = s.matches.filter(isMatchFinished).length;
                         const nextMatch = s.matches.find(m => !isMatchFinished(m));
                         const statusClass = nextMatch && new Date(nextMatch.date).toDateString() === new Date().toDateString() ? 'live' : (matchesPlayed === s.matches.length ? 'finished' : '');
                         const statusText = statusClass === 'live' ? 'En Direct' : (matchesPlayed === s.matches.length ? 'Terminé' : `${winsA}-${winsB}`);
                         
                         // Determine winner highlighting
                         const wA = winsA > winsB;
                         const wB = winsB > winsA;
                         
                         if(phaseKey.toLowerCase().includes('final') && matchesPlayed === s.matches.length && (winsA >= 3 || winsB >= 3 || matchesPlayed > 0)) {
                             // Champion Logic
                             if(winsA > winsB) { hasWinner = true; winnerTeam = teamA; }
                             else if(winsB > winsA) { hasWinner = true; winnerTeam = teamB; }
                         }

                         // Store data for click handler
                         const seriesData = encodeURIComponent(JSON.stringify(s.matches));
                         
                         return `
                         <div class="series-card open-series-modal" data-series="${seriesData}" data-phase="${phaseKey}">
                             <div class="series-status ${statusClass}">${statusText}</div>
                             <div class="series-content">
                                 <div class="series-team ${wA ? 'winner' : (matchesPlayed > 0 && !wA && winsA < winsB ? 'loser' : '')}">
                                     <div class="flex items-center gap-2">
                                         <img src="${getLogo(teamA)}" class="w-6 h-6 object-contain">
                                         <span class="text-xs font-bold truncate max-w-[100px]">${teamA}</span>
                                     </div>
                                     <div class="series-score ${wA ? 'text-green-600 bg-green-50' : 'text-gray-400'}">${winsA}</div>
                                 </div>
                                 <div class="series-team ${wB ? 'winner' : (matchesPlayed > 0 && !wB && winsB < winsA ? 'loser' : '')}">
                                     <div class="flex items-center gap-2">
                                         <img src="${getLogo(teamB)}" class="w-6 h-6 object-contain">
                                         <span class="text-xs font-bold truncate max-w-[100px]">${teamB}</span>
                                     </div>
                                     <div class="series-score ${wB ? 'text-green-600 bg-green-50' : 'text-gray-400'}">${winsB}</div>
                                 </div>
                             </div>
                             ${hasWinner ? `<div class="absolute inset-0 pointer-events-none champion-trigger" data-team="${winnerTeam}"></div>` : ''}
                         </div>`;
                     }).join('');

                     return `
                        <div class="bracket-round">
                            <div class="bracket-round-title">${phaseKey}</div>
                            ${seriesHTML}
                        </div>
                     `;
                 }).join('');
                 
                 // Trigger Confetti if Champion found
                 const winnerEl = plContent.querySelector('.champion-trigger');
                 if(winnerEl) {
                     setTimeout(() => {
                         confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                     }, 1000);
                 }
                 
                 // Attach Event Listeners
                 document.querySelectorAll('.open-series-modal').forEach(b => {
                     b.onclick = () => openSeriesModal(JSON.parse(decodeURIComponent(b.dataset.series)), b.dataset.phase);
                 });

             } else {
                 // v2.17 : aucun match de phase finale importé → PROJECTION de l'arbre d'après le classement
                 const projHtml = buildPlayoffProjection();
                 if (projHtml) { plContainer.classList.remove('hidden'); plContent.innerHTML = projHtml; }
                 else plContainer.classList.add('hidden');
             }

             const el = document.getElementById('full-matches-list');
             const cf = calFilters, nowMs = Date.now();
             const fRegular = regular.filter(m => {
                 if (cf.scope === 'lynx' && !(normalize(m.homeTeam || '').includes('valence') || normalize(m.awayTeam || '').includes('valence'))) return false;
                 if (cf.when === 'upcoming' && (isMatchFinished(m) || (new Date(m.date).getTime() || 0) + 3 * 3600e3 < nowMs)) return false;
                 if (cf.when === 'played' && !isMatchFinished(m)) return false;
                 const h = normalize(m.homeTeam || ''), aw = normalize(m.awayTeam || '');
                 if (cf.ta && h !== normalize(cf.ta) && aw !== normalize(cf.ta)) return false;
                 if (cf.tb && h !== normalize(cf.tb) && aw !== normalize(cf.tb)) return false;
                 if (cf.ta && cf.tb && !((h === normalize(cf.ta) && aw === normalize(cf.tb)) || (h === normalize(cf.tb) && aw === normalize(cf.ta)))) return false;
                 return true;
             });
             if(!fRegular.length) { el.innerHTML = '<div class="p-4 italic text-gray-500">Aucun match ne correspond à cette recherche.</div>'; }
             else { const rIdx = firstReturnIdx(fRegular); el.innerHTML = fRegular.map((m, i) => (i === rIdx ? retourMarkerHtml : '') + generateMatchRow(m, false)).join(''); }
             markNextMatchRow(el, fRegular);
             
             if(window.attachQuickScoreEvents) window.attachQuickScoreEvents();
        }

        // --- NEW: SERIES MODAL LOGIC ---
        function openSeriesModal(matches, phase) {
            const m = matches[0];
            const tA = m.homeTeam;
            const tB = m.awayTeam;
            
            // Calculate Score
            let wA = 0, wB = 0;
            matches.forEach(match => {
                if(isMatchFinished(match)) {
                    if((match.homeTeam === tA && match.scoreHome > match.scoreAway) || (match.homeTeam === tB && match.scoreAway > match.scoreHome)) wA++;
                    else wB++;
                }
            });
            
            document.getElementById('sm-phase').textContent = phase;
            document.getElementById('sm-team-a').textContent = tA;
            document.getElementById('sm-logo-a').src = getLogo(tA);
            document.getElementById('sm-team-b').textContent = tB;
            document.getElementById('sm-logo-b').src = getLogo(tB);
            document.getElementById('sm-series-score').textContent = `${wA} - ${wB}`;
            
            // Probabilité de victoire : le VRAI moteur du site (Poisson + forme), plus le factice ratio de points.
            // Terrain neutre : moyenne des deux orientations domicile/extérieur, pas de facteur fatigue.
            const poulesSm = seasonHasPoules(activeSeason);
            const gSm = poulesSm ? (m.poule || 'B').toUpperCase() : '';
            const playedPoolSm = allMatches.filter(x => x.season === activeSeason && (!x.type || x.type === 'Saison') && (!poulesSm || (x.poule || 'B').toUpperCase() === gSm) && isMatchFinished(x));
            let pctA = 50;
            if (playedPoolSm.length >= 3) {
                const modelSm = buildPoolModel(playedPoolSm);
                const p1 = predictMatch(modelSm, tA, tB, null);
                const p2 = predictMatch(modelSm, tB, tA, null);
                pctA = Math.max(2, Math.min(98, Math.round(((p1.pHomeWin + p2.pAwayWin) / 2) * 100)));
            }
            
            document.getElementById('sm-prob-bar').style.width = `${pctA}%`;
            const pctEl = document.getElementById('sm-prob-pct');
            if (pctEl) pctEl.textContent = `${pctA} % — ${100 - pctA} %`;
            
            // Render Matches List inside Modal
            const list = document.getElementById('sm-matches-list');
            list.innerHTML = matches.sort((a,b) => new Date(a.date) - new Date(b.date)).map((match, i) => {
                const isDone = isMatchFinished(match);
                const score = isDone ? `${match.scoreHome}-${match.scoreAway} ${match.isProl ? '(PR)' : ''}` : 'VS';
                return `
                <div class="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                    <div class="text-xs text-gray-500 font-bold w-16">Match ${i+1}<br>${new Date(match.date).toLocaleDateString('fr-FR', {day:'numeric', month:'short'})}</div>
                    <div class="flex-1 flex justify-center items-center gap-2 font-black text-lg">
                        <span class="${match.homeTeam === tA ? '' : 'text-gray-400 text-sm'}">${match.homeTeam === tA ? match.homeTeam : match.awayTeam}</span>
                        <span class="bg-white dark:bg-gray-900 px-3 py-1 rounded shadow-inner text-sm min-w-[60px] text-center">${match.homeTeam === tA ? score : (isDone ? `${match.scoreAway}-${match.scoreHome} ${match.isProl ? '(PR)' : ''}` : 'VS')}</span>
                        <span class="${match.awayTeam === tB ? '' : 'text-gray-400 text-sm'}">${match.homeTeam === tA ? match.awayTeam : match.homeTeam}</span>
                    </div>
                    <button class="bg-lynx-red text-white p-1.5 rounded hover:bg-red-700 text-xs quick-score-trigger" data-id="${match.id}" data-home="${match.homeTeam}" data-away="${match.awayTeam}"><i class="fa-solid fa-pen"></i></button>
                </div>`;
            }).join('');
            
            toggleModal('series-modal', true);
            if(window.attachQuickScoreEvents) window.attachQuickScoreEvents();
        }

        // --- NEW BRACKET MATCH CARD GENERATOR ---
        function generateBracketMatch(m) {
            // ... (Replaced by the new Series Logic inside renderFullCal, this function is kept as fallback or deprecated)
            return ''; 
        }

                // --- NEW: RENDER TITLES WIDGET ---
        function renderTitles() {
            const container = document.getElementById('home-titles-container');
            if (!container) return;
            container.classList.remove('hidden');
            const el = document.getElementById('home-titles');
            if (!el) return;
            try {
                const season = activeSeason;
                const titles = [];
                const ranking = [...(mainRanking || [])].filter(t => t.season === season);
                const lynx = ranking.find(t => normalize(t.team).includes('valence'));
                if (lynx && ranking.length) {
                    const sorted = [...ranking].sort((a, b) => (b.pts || 0) - (a.pts || 0));
                    const lynxIdx = sorted.findIndex(t => normalize(t.team).includes('valence'));
                    if (lynxIdx >= 0) {
                        if (lynxIdx === 0) titles.push('🥇 Champion de la poule');
                        else if (lynxIdx === 1) titles.push('🥈 Vice-champion de la poule');
                        else if (lynxIdx === 2) titles.push('🥉 3ème de la poule');
                    }
                    if (lynx.bp > 0 && sorted.every(t => (t.bp || 0) <= lynx.bp)) titles.push('🎯 Meilleure attaque');
                    if (lynx.bc >= 0 && sorted.every(t => (t.bc || 999) >= lynx.bc)) titles.push('🛡️ Meilleure défense');
                }
                el.innerHTML = titles.length ? titles.map(t => `<div class="text-center p-2">${t}</div>`).join('') : '<div class="text-center p-2 text-gray-400">Aucun titre encore</div>';
            } catch (e) { el.innerHTML = '<div class="text-center p-2 text-gray-400">Chargement...</div>'; }
        }

        // --- NEW: RENDER HOME EXTREMES WIDGET ---
        function renderHomeExtremes(list) {
            const container = document.getElementById('home-extremes-container');
            if(!list || list.length === 0) { container.classList.add('hidden'); return; }
            container.classList.remove('hidden');

            // Sort Helpers
            const getBestAttack = (l) => [...l].sort((a,b) => (b.bp||0) - (a.bp||0))[0];
            const getWorstAttack = (l) => [...l].sort((a,b) => (a.bp||0) - (b.bp||0))[0];
            const getBestDefense = (l) => [...l].sort((a,b) => (a.bc||0) - (b.bc||0))[0]; // Low BC is good
            const getWorstDefense = (l) => [...l].sort((a,b) => (b.bc||0) - (a.bc||0))[0]; // High BC is bad

            const ba = getBestAttack(list);
            const wa = getWorstAttack(list);
            const bd = getBestDefense(list);
            const wd = getWorstDefense(list);

            const renderItem = (id, team, val, suffix) => {
                if(team) {
                    document.getElementById(id).textContent = team.team;
                    document.getElementById(id + '-val').textContent = val + suffix;
                } else {
                    document.getElementById(id).textContent = '-';
                    document.getElementById(id + '-val').textContent = '-';
                }
            };

            renderItem('home-best-attack', ba, ba?.bp || 0, ' buts');
            renderItem('home-worst-attack', wa, wa?.bp || 0, ' buts');
            renderItem('home-best-defense', bd, bd?.bc || 0, ' buts');
            renderItem('home-worst-defense', wd, wd?.bc || 0, ' buts');
        }
