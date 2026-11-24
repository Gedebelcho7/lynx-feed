// ===== RAPPORTS LIVE ARCHIVÉS : indicateur sur les lignes de calendrier + rejeu en un clic =====
        let _liveReportIds = new Set();
        let _repIdByMatch = {}; // v2.22-b : clé « ffhg-<n°> » ou « équipes|jour » → id du rapport archivé (les rapports sont stockés sous des ids horodatés, PAS l'id du calendrier)
        function repArchived(m) { try { return !!((m && m.id && _liveReportIds.has(m.id)) || repForMatch(m)); } catch (e) { return false; } }
        const repKey = (a, b, d) => normalize(a) + '|' + normalize(b) + '|' + String(d || '').slice(0, 10);
        function repForMatch(m) {
            try {
                if (!m) return '';
                if (m.ffhgId && _repIdByMatch['ffhg-' + m.ffhgId]) return _repIdByMatch['ffhg-' + m.ffhgId];
                const k1 = repKey(m.homeTeam, m.awayTeam, m.date), k2 = repKey(m.awayTeam, m.homeTeam, m.date);
                return _repIdByMatch[k1] || _repIdByMatch[k2] || '';
            } catch (e) { return ''; }
        }
        async function loadLiveReportIds() {
            let rows = [];
            try { rows = await dbFetchCol('live-reports'); } catch (e) {}
            _liveReportIds = new Set(rows.map(d => d.id));
            _repIdByMatch = {};
            rows.forEach(d => {
                const r = d.data || {};
                const h = r.homeTeam || '', a = r.awayTeam || '';
                if (r.ffhgId) _repIdByMatch['ffhg-' + r.ffhgId] = d.id;
                // v2.24 : inclure TOUS les rapports dans la map, y compris ceux avec Domicile/Visiteur
                // Cela permet de les retrouver pour la reparation automatique
                if (r.date) {
                    const day = String(r.date).slice(0, 10);
                    // Clé avec les vrais noms si disponibles et valides
                    if (h && a && normalize(h) !== 'domicile' && normalize(h) !== 'visiteur' && normalize(a) !== 'domicile' && normalize(a) !== 'visiteur') {
                        _repIdByMatch[repKey(h, a, day)] = d.id;
                        _repIdByMatch[repKey(a, h, day)] = d.id;
                    }
                    // Clé avec l'ID du rapport pour les cas ou les noms sont manquants
                    _repIdByMatch['repid-' + d.id] = d.id;
                }
            });
            try { scheduleUI(); } catch (e) {} // re-rendu pour poser les badges 🎬
        }
        document.addEventListener('click', async (ev) => {
            const b = ev.target && ev.target.closest ? ev.target.closest('.rep-replay-btn') : null;
            if (!b) return;
            ev.preventDefault(); ev.stopPropagation(); // ne déclenche pas la saisie de score de la ligne
            const id = b.dataset.rep || '';
            let reps = window._liveReplayReps || [];
            if (!reps.length || !reps.some(r => r._id === id)) {
                try { reps = (await dbFetchCol('live-reports')).map(d => ({ ...d.data, _id: d.id }))
                    .filter(r => r && Array.isArray(r.events) && r.events.length && (!r.season || String(r.season) === String(activeSeason)))
                    .sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0));
                    window._liveReplayReps = reps; } catch (e) { reps = []; }
            }
            const idx = reps.findIndex(r => r._id === id);
            if (idx < 0) { appAlert('Déroulé introuvable en base.'); return; }
            // v2.24 : réparation auto élargie d'un rapport incomplet (noms « Domicile/Visiteur », score vide 0-0, ou ffhgId manquant)
            // On cherche le match par : 1) ffhgId, 2) repForMatch, 3) équipes+date (dans les deux sens), 4) date seule
            const rp = reps[idx];
            // v2.24 : vérification plus large des rapports fantômes (Domicile/Visiteur dans n'importe quelle position, ou noms vides)
            const isGhostReport = !rp || !rp.homeTeam || !rp.awayTeam || 
                normalize(rp.homeTeam) === 'domicile' || normalize(rp.awayTeam) === 'domicile' ||
                normalize(rp.homeTeam) === 'visiteur' || normalize(rp.awayTeam) === 'visiteur' ||
                (Number(rp.scoreHome) === 0 && Number(rp.scoreAway) === 0 && (!rp.events || rp.events.length === 0));
            if (isGhostReport) {
                let mm = (allMatches || []).find(m => m && repForMatch(m) === rp._id);
                if (!mm && rp.ffhgId) mm = (allMatches || []).find(m => m && String(m.ffhgId) === String(rp.ffhgId));
                if (!mm && rp.date) {
                    const rpDate = new Date(rp.date).toLocaleDateString('fr-FR');
                    mm = (allMatches || []).find(m => m && new Date(m.date).toLocaleDateString('fr-FR') === rpDate &&
                        ((normalize(m.homeTeam) === normalize(rp.homeTeam || '') && normalize(m.awayTeam) === normalize(rp.awayTeam || '')) ||
                         (normalize(m.homeTeam) === normalize(rp.awayTeam || '') && normalize(m.awayTeam) === normalize(rp.homeTeam || ''))));
                }
                if (!mm && rp.date) {
                    const rpDate = new Date(rp.date).toLocaleDateString('fr-FR');
                    mm = (allMatches || []).find(m => m && new Date(m.date).toLocaleDateString('fr-FR') === rpDate);
                }
                if (!mm && rp.events && rp.events.length > 0) {
                    // v2.24 : si on a des événements mais pas de match trouvé, essayer de trouver par les noms dans les événements
                    const homeNamesInEvents = new Set();
                    const awayNamesInEvents = new Set();
                    rp.events.forEach(e => {
                        if (e.team && normalize(e.team).length > 0) {
                            if (e.side === 'H' || e.teamId === rp.homeId) homeNamesInEvents.add(normalize(e.team));
                            else if (e.side === 'A' || e.teamId === rp.awayId) awayNamesInEvents.add(normalize(e.team));
                        }
                    });
                    if (homeNamesInEvents.size > 0 || awayNamesInEvents.size > 0) {
                        mm = (allMatches || []).find(m => 
                            (homeNamesInEvents.has(normalize(m.homeTeam)) && awayNamesInEvents.has(normalize(m.awayTeam))) ||
                            (homeNamesInEvents.has(normalize(m.awayTeam)) && awayNamesInEvents.has(normalize(m.homeTeam)))
                        );
                    }
                }
                if (mm) {
                    try {
                        await setDoc(doc(db, basePath + '/live-reports/' + rp._id), { 
                            homeTeam: mm.homeTeam, 
                            awayTeam: mm.awayTeam, 
                            scoreHome: Number(mm.scoreHome) || 0, 
                            scoreAway: Number(mm.scoreAway) || 0, 
                            date: mm.date || rp.date || '', 
                            season: mm.season || activeSeason, 
                            ffhgId: mm.ffhgId || rp.ffhgId || '',
                            homeId: mm.homeId,
                            awayId: mm.awayId
                        }, { merge: true });
                        // v2.24 : mettre à jour le rapport localement AVANT de continuer
                        rp.homeTeam = mm.homeTeam;
                        rp.awayTeam = mm.awayTeam;
                        rp.scoreHome = Number(mm.scoreHome) || 0;
                        rp.scoreAway = Number(mm.scoreAway) || 0;
                        rp.date = mm.date || rp.date || '';
                        rp.ffhgId = mm.ffhgId || rp.ffhgId || '';
                        rp.homeId = mm.homeId;
                        rp.awayId = mm.awayId;
                        reps[idx] = rp;
                        window._liveReplayReps = reps;
                        try { loadLiveReportIds(); } catch (e) {}
                    } catch (e) { console.warn('Erreur réparation rapport:', e); }
                } else if (isGhostReport) {
                    // v2.24 : si on ne trouve toujours pas de match et que c'est un rapport fantôme, afficher un message
                    appAlert('Rapport incomplet : impossible de trouver le match correspondant. Les données peuvent être manquantes.');
                }
            }
            const t = document.querySelector('.main-nav-tab[data-content="live-match"]');
            if (t) t.click(); else { const sel2 = document.getElementById('mobile-nav-select'); if (sel2) { sel2.value = 'live-match'; sel2.dispatchEvent(new Event('change')); } }
            setTimeout(() => {
                const sel3 = document.getElementById('live-replay-select');
                if (sel3) sel3.value = String(idx);
                const rb = document.getElementById('live-replay-btn');
                if (rb) rb.click();
                else appAlert("Ouvre l'onglet Direct → « Revivre un match » pour rejouer ce déroulé.");
            }, 300);
        });

        // --- v2.22 : liens utiles ouverts dans une demi-fenêtre en bas, étirable (iframe) ---
        function openLinkSheet(url, name) {
            let sh = document.getElementById('link-sheet');
            if (!sh) {
                const st = document.createElement('style'); st.id = 'lynx-sheet-style';
                st.textContent = '#link-sheet{position:fixed;left:0;right:0;bottom:0;z-index:90;display:none;flex-direction:column;background:#fff;border-top:3px solid #D90429;box-shadow:0 -12px 32px rgba(0,0,0,.3);height:55vh;min-height:180px;max-height:92vh;border-radius:16px 16px 0 0;overflow:hidden}#link-sheet.open{display:flex}#link-sheet-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:800;cursor:ns-resize;user-select:none;touch-action:none}#link-sheet-frame{flex:1;width:100%;border:0;background:#fff}.dark #link-sheet{background:#111827}.dark #link-sheet-bar{background:#1f2937;color:#e5e7eb}';
                document.head.appendChild(st);
                sh = document.createElement('div'); sh.id = 'link-sheet';
                sh.innerHTML = '<div id="link-sheet-bar"><span class="mr-1">⇕</span><span id="link-sheet-title" class="flex-1 truncate"></span><a id="link-sheet-newtab" href="#" target="_blank" rel="noopener" class="text-lynx-red underline font-bold whitespace-nowrap">Le site refuse l\'affichage intégré ? Ouvrir dans un onglet ↗</a><button id="link-sheet-close" class="ml-2 w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 font-black shrink-0" title="Fermer">✕</button></div><iframe id="link-sheet-frame" referrerpolicy="no-referrer"></iframe>';
                document.body.appendChild(sh);
                const bar = sh.querySelector('#link-sheet-bar');
                let y0 = 0, h0 = 0, dragging = false;
                bar.addEventListener('pointerdown', (e) => { if (e.target.closest('a,button')) return; dragging = true; y0 = e.clientY; h0 = sh.getBoundingClientRect().height; try { bar.setPointerCapture(e.pointerId); } catch (err) {} });
                bar.addEventListener('pointermove', (e) => { if (!dragging) return; const nh = Math.max(180, Math.min(window.innerHeight * 0.92, h0 + (y0 - e.clientY))); sh.style.height = nh + 'px'; });
                bar.addEventListener('pointerup', () => { dragging = false; });
                sh.querySelector('#link-sheet-close').onclick = () => { sh.classList.remove('open'); sh.querySelector('#link-sheet-frame').src = 'about:blank'; };
            }
            let dom = ''; try { dom = new URL(url).hostname; } catch (e) {}
            sh.querySelector('#link-sheet-title').textContent = (name || 'Lien') + (dom ? ' — ' + dom : '');
            sh.querySelector('#link-sheet-newtab').href = url;
            sh.querySelector('#link-sheet-frame').src = url;
            sh.classList.add('open');
        }