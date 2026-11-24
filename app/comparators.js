// ===== COMPARATEURS : évolution des équipes, radar duel, duel de joueurs =====
        let evoTracked = null; // v2.18 : équipes suivies dans le graphique d'évolution (mémo entre rendus)
        function renderEvolutionChart(matches, teams, forecast) {
             const container = document.getElementById('evolution-chart-container');
             if(!container) return;
             const done = matches.filter(m => isMatchFinished(m)).sort((a,b) => new Date(a.date) - new Date(b.date));
             if(!done.length || !teams.length) { container.innerHTML = '<div class="text-center p-4 text-gray-400">Pas assez de données</div>'; return; }

             const keyOf = (t) => normalize(t);
             // FIX BUG : appariement des équipes insensible à la casse/accents (les noms CSV != noms matchs ne s'additionnaient plus)
             const sorted = [...teams].sort((a,b) => (b.pts||0) - (a.pts||0));
             // v2.18 : équipes affichées mémorisées — pastilles cliquables pour choisir qui suivre
             const valT = sorted.find(t => normalize(t.team).includes('valence'));
             if (!Array.isArray(evoTracked) || !evoTracked.length) {
                 evoTracked = sorted.slice(0,5).map(t => t.team);
                 if(valT && !evoTracked.some(t => keyOf(t) === keyOf(valT.team))) evoTracked.push(valT.team);
             }
             evoTracked = evoTracked.filter(t => sorted.some(x => keyOf(x.team) === keyOf(t)));
             if (!evoTracked.length) evoTracked = sorted.slice(0,5).map(t => t.team);
             const tracked = evoTracked;

             const series = {};
             tracked.forEach(t => { series[keyOf(t)] = { team: t, pts: 0, data: [] }; });

             const dates = [...new Set(done.map(m => new Date(m.date).setHours(0,0,0,0)))].sort((a,b)=>a-b);
             dates.forEach(d => {
                 const dayMatches = done.filter(m => new Date(m.date).setHours(0,0,0,0) === d);
                 dayMatches.forEach(m => {
                     const process = (team, score, oppScore) => {
                        const s = series[keyOf(team)];
                        if(s) s.pts += matchPoints(score, oppScore, m.isProl);
                     };
                     process(m.homeTeam, m.scoreHome, m.scoreAway);
                     process(m.awayTeam, m.scoreAway, m.scoreHome);
                 });
                 Object.values(series).forEach(s => s.data.push({ date: d, pts: s.pts }));
             });

             // PROJECTIONS : continuation en pointillés match par match, selon le calendrier réel des matchs restants
             // (chaque point = la date d'un match restant, + les points attendus du modèle Poisson pour CE match)
             const projSteps = {};
             if (forecast && forecast.groups) {
                 Object.values(forecast.groups).forEach(gr => {
                     (gr.preds || []).forEach(p => {
                         if (!p.match || !p.ePts) return;
                         const dd = new Date(p.match.date); if (isNaN(dd)) return;
                         const dt = dd.setHours(0, 0, 0, 0);
                         const kh = normalize(p.match.homeTeam), ka = normalize(p.match.awayTeam);
                         if (series[kh]) { if (!projSteps[kh]) projSteps[kh] = {}; projSteps[kh][dt] = (projSteps[kh][dt] || 0) + p.ePts[0]; }
                         if (series[ka]) { if (!projSteps[ka]) projSteps[ka] = {}; projSteps[ka][dt] = (projSteps[ka][dt] || 0) + p.ePts[1]; }
                     });
                 });
             }
             const futureDates = [...new Set(Object.values(projSteps).flatMap(st => Object.keys(st).map(Number)))].sort((a, b) => a - b);
             const projTotals = {};
             Object.entries(projSteps).forEach(([k, st]) => { projTotals[k] = (series[k] ? series[k].pts : 0) + Object.values(st).reduce((x, y) => x + y, 0); });
             const units = Math.max(dates.length - 1 + futureDates.length, 1);
             const width = 900; const height = 380; const pad = 42;
             const xStep = (width - 2*pad) / units;
             const allMax = [...Object.values(series).map(s => s.pts), ...Object.values(projTotals)];
             const maxPts = Math.max(10, ...allMax);
             const yScale = (height - 2*pad) / maxPts;

             const colors = ['#D90429', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#6B7280'];
             let svg = `<svg width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;
             [0, 0.25, 0.5, 0.75, 1].forEach(p => {
                 const y = height - pad - (p * maxPts * yScale);
                 svg += `<line x1="${pad}" y1="${y}" x2="${width-pad}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4" /><text x="${pad-6}" y="${y+4}" font-size="11" text-anchor="end" fill="gray">${Math.round(p*maxPts)}</text>`;
             });

             let cIdx = 0; let endLabels = [];
             Object.entries(series).forEach(([k, data]) => {
                 const ptsData = data.data;
                 const isVal = normalize(data.team).includes('valence');
                 const color = isVal ? '#D90429' : colors[(cIdx++)%colors.length];
                 const strokeWidth = isVal ? 4 : 2;

                 let pathD = '';
                 ptsData.forEach((pt, i) => {
                     const x = pad + (i * xStep);
                     const y = height - pad - (pt.pts * yScale);
                     pathD += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
                 });
                 svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />`;

                 const lastPt = ptsData[ptsData.length - 1];
                 const lx = pad + (ptsData.length - 1) * xStep;
                 const ly = height - pad - (lastPt.pts * yScale);
                 svg += `<circle cx="${lx}" cy="${ly}" r="3" fill="${color}" stroke="white"><title>${data.team}: ${lastPt.pts}pts (${new Date(lastPt.date).toLocaleDateString()})</title></circle>`;

                 const stepsByDate = projSteps[k];
                 let ex = lx, ey = ly, label = data.team;
                 if (stepsByDate) {
                     let cum = lastPt.pts, started = false, projD = '';
                     futureDates.forEach((fd, j) => {
                         const add = stepsByDate[fd] || 0;
                         if (add > 0) {
                             cum += add;
                             const x = pad + (dates.length + j) * xStep;
                             const y = height - pad - (cum * yScale);
                             projD += (started ? 'L ' : `M ${lx} ${ly} L `) + `${x} ${y} `;
                             started = true; ex = x; ey = y;
                         }
                     });
                     if (started) {
                         svg += `<path d="${projD}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="5 4" opacity="0.5" />`;
                         svg += `<circle cx="${ex}" cy="${ey}" r="3.5" fill="none" stroke="${color}" stroke-dasharray="2 2"><title>${data.team}: projeté ${Math.round(cum)}pts en fin de saison</title></circle>`;
                         label = `${data.team} ${Math.round(cum)}p`;
                     }
                 }
                 endLabels.push({ label: label.length > 22 ? label.slice(0, 21) + '…' : label, color, ex, ey });
             });
             // v2.18 : anti-chevauchement des étiquettes finales (espacées d'au moins 16 px)
             endLabels.sort((a, b) => a.ey - b.ey);
             for (let i = 1; i < endLabels.length; i++) { if (endLabels[i].ey - endLabels[i - 1].ey < 16) endLabels[i].ey = endLabels[i - 1].ey + 16; }
             endLabels.forEach(l2 => { if (l2.ey > height - 10) l2.ey = height - 10; });
             endLabels.forEach(l2 => { svg += `<text x="${Math.min(l2.ex + 6, width - 155)}" y="${Math.max(l2.ey - 5, 14)}" font-size="11" fill="${l2.color}" font-weight="bold">${xmlEsc(l2.label)}</text>`; });

             // v2.18 : repère « dernier match joué » + dates sur l'axe
             if (dates.length) {
                 const nowX = pad + (dates.length - 1) * xStep;
                 svg += `<line x1="${nowX}" y1="${pad - 12}" x2="${nowX}" y2="${height - pad}" stroke="#9ca3af" stroke-dasharray="3 3" /><text x="${nowX + 4}" y="${pad - 2}" font-size="10" fill="#9ca3af">auj.</text>`;
             }
             [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])].forEach(i => {
                 if (dates[i] == null) return;
                 svg += `<text x="${pad + i * xStep}" y="${height - pad + 16}" font-size="10" text-anchor="middle" fill="gray">${new Date(dates[i]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</text>`;
             });
             svg += `</svg>`;
             // v2.18 : pastilles d'équipes cliquables + légende + vue agrandie zoomable
             const chipsRow = sorted.map(t => {
                 const on = tracked.some(x => keyOf(x) === keyOf(t.team));
                 const isV = normalize(t.team).includes('valence');
                 return `<button class="evo-chip px-2 py-0.5 rounded-full text-[10px] font-bold border transition whitespace-nowrap ${on ? 'bg-lynx-red text-white border-lynx-red' : 'bg-white dark:bg-gray-700 text-gray-400 border-gray-300 dark:border-gray-600 hover:text-lynx-red'}" data-team="${xmlEsc(t.team)}">${xmlEsc(t.team)}${isV ? ' 🦁' : ''}</button>`;
             }).join('');
             container.innerHTML = `<div class="flex items-center justify-between gap-2 mb-2 flex-wrap"><div class="flex flex-wrap gap-1 max-w-[85%]">${chipsRow}</div><button id="evo-zoom-btn" class="shrink-0 px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-[11px] font-bold text-gray-500 hover:text-lynx-red hover:border-lynx-red transition">🔍 Agrandir</button></div><p class="text-[10px] text-gray-400 mb-1">Trait plein = points réels · pointillés = projection du modèle · survole les points pour le détail</p><div class="w-full overflow-x-auto">${svg}</div>`;
             container.querySelectorAll('.evo-chip').forEach(btn => btn.onclick = () => {
                 const tm = btn.dataset.team;
                 const i2 = evoTracked.findIndex(x => keyOf(x) === keyOf(tm));
                 if (i2 >= 0) { if (evoTracked.length > 1) evoTracked.splice(i2, 1); } else evoTracked.push(tm);
                 renderEvolutionChart(matches, teams, forecast);
             });
             const zoomBtn = document.getElementById('evo-zoom-btn');
             if (zoomBtn) zoomBtn.onclick = () => {
                 const ov = document.createElement('div');
                 ov.className = 'fixed inset-0 z-[9999] bg-black/90 flex flex-col';
                 const big = svg.replace('width="100%"', 'width="1400"');
                 ov.innerHTML = `<div class="flex items-center justify-between gap-2 p-3 bg-black/80 text-white"><span class="text-sm font-bold">📈 Évolution des points</span><span class="flex gap-2"><button class="evo-z px-3 py-1 rounded-lg bg-white/10 font-bold text-sm" data-z="in">➕</button><button class="evo-z px-3 py-1 rounded-lg bg-white/10 font-bold text-sm" data-z="out">➖</button><button class="evo-z px-3 py-1 rounded-lg bg-white/10 font-bold text-sm" data-z="reset">↺</button><button class="evo-close px-3 py-1 rounded-lg bg-lynx-red font-bold text-sm">✕ Fermer</button></span></div><div class="evo-canvas flex-1 overflow-auto p-2">${big}</div>`;
                 document.body.appendChild(ov);
                 let wCur = 1400;
                 const cv = ov.querySelector('.evo-canvas');
                 const applyW = () => { const sv = cv && cv.querySelector('svg'); if (sv) { sv.setAttribute('width', wCur); sv.setAttribute('height', Math.round(wCur * height / width)); } };
                 ov.querySelectorAll('.evo-z').forEach(b => b.onclick = () => { if (b.dataset.z === 'in') wCur = Math.min(3600, wCur + 400); else if (b.dataset.z === 'out') wCur = Math.max(700, wCur - 400); else wCur = 1400; applyW(); });
                 const cBtn = ov.querySelector('.evo-close'); if (cBtn) cBtn.onclick = () => ov.remove();
                 ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
             };
        }

        // --- NEW: RADAR CHART GENERATOR ---
        function generateRadarChart(p1, p2, p1Stats, p2Stats, maxValues) {
             const size = 260;
             const center = size / 2;
             const radius = size * 0.35;
             const axes = ['Buts', 'Assists', 'Pts', 'Ratio', 'MJ'];
             const keys = ['goals', 'assists', 'pts', 'ratio', 'mj'];
             
             // Points Calculation
             const getPoints = (stats) => {
                 return keys.map((key, i) => {
                     const angle = (Math.PI * 2 * i) / keys.length - Math.PI / 2;
                     const val = stats[key] || 0;
                     const max = maxValues[key] || 1;
                     const normalized = Math.min(val / max, 1);
                     const x = center + radius * normalized * Math.cos(angle);
                     const y = center + radius * normalized * Math.sin(angle);
                     return `${x},${y}`;
                 }).join(' ');
             };
             
             const points1 = getPoints(p1Stats);
             
             let svg = `<svg width="100%" height="100%" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" class="font-sans">
                 <!-- Background Web -->
                 ${[0.2, 0.4, 0.6, 0.8, 1].map(level => {
                     const pts = keys.map((_, i) => {
                         const angle = (Math.PI * 2 * i) / keys.length - Math.PI / 2;
                         const x = center + radius * level * Math.cos(angle);
                         const y = center + radius * level * Math.sin(angle);
                         return `${x},${y}`;
                     }).join(' ');
                     return `<polygon points="${pts}" fill="none" stroke="#e5e7eb" stroke-width="1" />`;
                 }).join('')}
                 
                 <!-- Axes -->
                 ${keys.map((key, i) => {
                     const angle = (Math.PI * 2 * i) / keys.length - Math.PI / 2;
                     const x = center + radius * Math.cos(angle);
                     const y = center + radius * Math.sin(angle);
                     // Label Position (pushed out slightly)
                     const lx = center + (radius + 20) * Math.cos(angle);
                     const ly = center + (radius + 20) * Math.sin(angle);
                     return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#d1d5db" stroke-width="1" />
                             <text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="bold" fill="#6b7280">${axes[i]}</text>`;
                 }).join('')}
                 
                 <!-- Player 1 Data -->
                 <polygon points="${points1}" fill="${p2 ? '#3B82F6' : '#D90429'}" stroke="${p2 ? '#2563EB' : '#991B1B'}" class="radar-poly" />
             `;
             
             // If P2 exists (Comparator Mode), render second poly
             if(p2 && p2Stats) {
                 const points2 = getPoints(p2Stats);
                 svg += `<polygon points="${points2}" fill="#EF4444" stroke="#DC2626" class="radar-poly" />`;
             }
             
             svg += `</svg>`;
             
             svg += `</svg>`; return svg;
        }

        function updatePlayerComparatorSelects() {
            // 1. Joueurs des Lynx
            const lynxPlayers = roster.filter(p => p.season === activeSeason).map(p => ({...p, team: 'Valence (Lynx)', type:'lynx'}));
            
            // 2. Joueurs de la ligue (sans limite de nombre)
            const sortedLeague = leaguePlayers.filter(p => p.season === activeSeason);
            
            // 3. Filtrer les doublons (si un joueur Lynx est aussi dans le top Ligue)
            const uniqueLeague = sortedLeague.filter(tp => !lynxPlayers.some(lp => normalize(lp.name) === normalize(tp.name)));
            const formattedLeague = uniqueLeague.map(p => ({...p, type:'top'}));
            
            // 4. Combiner et trier par ordre alphabétique
            const allPlayers = [...lynxPlayers, ...formattedLeague].sort((a,b) => a.name.localeCompare(b.name));
            
            const options = `<option value="">Choisir un joueur...</option>` + allPlayers.map(p => `<option value="${p.type}_${p.name}">${p.name} (${p.team})</option>`).join('');
            
            const s1 = document.getElementById('pcomp-p1'); 
            const s2 = document.getElementById('pcomp-p2');
            
            // Sauvegarder les valeurs actuelles
            const val1 = s1.value;
            const val2 = s2.value;
            
            // Mettre à jour le HTML
            s1.innerHTML = options;
            s2.innerHTML = options;
            
            // Restaurer les valeurs si elles existent toujours
            if(val1 && s1.querySelector(`option[value="${val1}"]`)) s1.value = val1;
            if(val2 && s2.querySelector(`option[value="${val2}"]`)) s2.value = val2;
        }

        function runPlayerComparison() {
            const val1 = document.getElementById('pcomp-p1').value;
            const val2 = document.getElementById('pcomp-p2').value;
            if(!val1 || !val2) return;
            
            const [type1, name1] = val1.split('_');
            const [type2, name2] = val2.split('_');
            
            const getPData = (t, n) => {
                const list = t === 'lynx' ? roster : leaguePlayers;
                return list.find(p => p.season === activeSeason && p.name === n);
            };
            
            const p1 = getPData(type1, name1);
            const p2 = getPData(type2, name2);
            
            if(!p1 || !p2) return;
            
            document.getElementById('player-comparison-results').classList.remove('hidden');
            
            // Prepare stats for Radar
            const p1Stats = {
                goals: p1.goals || 0,
                assists: p1.assists || 0,
                pts: (p1.goals||0) + (p1.assists||0), 
                mj: p1.mj || (roster.mj ? roster.mj : 14),
                ratio: ((p1.goals||0) + (p1.assists||0)) / (p1.mj || 1)
            };
            if(p1.pts && p1.type !== 'lynx') p1Stats.pts = p1.pts;
            else p1Stats.pts = (p1.goals||0) + (p1.assists||0);

            const p2Stats = {
                goals: p2.goals || 0,
                assists: p2.assists || 0,
                pts: (p2.goals||0) + (p2.assists||0),
                mj: p2.mj || 14,
                ratio: ((p2.goals||0) + (p2.assists||0)) / (p2.mj || 1)
            };
            if(p2.pts && p2.type !== 'lynx') p2Stats.pts = p2.pts;
            else p2Stats.pts = (p2.goals||0) + (p2.assists||0);

            const maxValues = {
                goals: Math.max(p1Stats.goals, p2Stats.goals, 10),
                assists: Math.max(p1Stats.assists, p2Stats.assists, 10),
                pts: Math.max(p1Stats.pts, p2Stats.pts, 20),
                mj: Math.max(p1Stats.mj, p2Stats.mj, 18),
                ratio: Math.max(p1Stats.ratio, p2Stats.ratio, 2.0)
            };

            // Render Radar
            document.getElementById('radar-chart-container').innerHTML = generateRadarChart(p1, p2, p1Stats, p2Stats, maxValues);
            
            // Render Table
            const row = (label, v1, v2, unit='') => `
                <div class="flex justify-between items-center border-b dark:border-gray-700 py-2">
                     <span class="font-black text-lg ${v1>v2?'text-blue-500':''}">${v1}${unit}</span>
                     <span class="text-xs font-bold uppercase text-gray-400">${label}</span>
                     <span class="font-black text-lg ${v2>v1?'text-red-500':''}">${v2}${unit}</span>
                </div>`;
                
            document.getElementById('pcomp-stats-container').innerHTML = `
                <div class="flex justify-between items-center mb-4">
                    <div class="text-center w-1/3">
                        <div class="font-black text-blue-600 truncate">${p1.name}</div>
                        <div class="text-xs text-gray-500">${p1.team || 'Valence'}</div>
                    </div>
                    <div class="text-xs font-bold bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">STATS</div>
                    <div class="text-center w-1/3">
                        <div class="font-black text-red-600 truncate">${p2.name}</div>
                        <div class="text-xs text-gray-500">${p2.team || 'Valence'}</div>
                    </div>
                </div>
                ${row('Points', p1Stats.pts, p2Stats.pts)}
                ${row('Buts', p1Stats.goals, p2Stats.goals)}
                ${row('Assists', p1Stats.assists, p2Stats.assists)}
                ${row('Ratio (Pts/M)', p1Stats.ratio.toFixed(2), p2Stats.ratio.toFixed(2))}
                ${row('Matchs Joués', p1Stats.mj, p2Stats.mj)}
            `;
        }