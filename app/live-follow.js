// ===== ÉQUIPE SUIVIE EN DIRECT + SAUT VERS UN MATCH LIVE =====
        // le calendrier (bouton « 🔴 Live »), le bandeau jour de match et l'onglet Direct partagent le même réglage.
        // Suivi d'une autre équipe possible (ex. Nantes - Caen) : sons, animations, notifs et punchline la prendront pour « nous ».
        let liveFollowTeam = '';
        try { liveFollowTeam = localStorage.getItem('lynx_live_team') || ''; } catch (e) {}
        function liveIsMyTeam(name) {
            const n = normalize(name || '');
            if (!n) return false;
            const t = normalize(liveFollowTeam || '');
            return t ? (n.includes(t) || t.includes(n)) : /valence/i.test(n);
        }
        function liveMyTeamLabel() { return (liveFollowTeam || '').trim() || 'Lynx'; }
        // v2.22 : « 🔴 Live » depuis le calendrier (ou le bandeau jour de match) → onglet Direct avec le n° du match
        // pré-rempli, et choix de l'équipe suivie EN UN CLIC sur l'une des deux équipes (par défaut : les Lynx de Valence).
        let liveJumpNum = '';
        function liveRenderTeamPick(homeTeam, awayTeam) {
            const box = document.getElementById('live-team-pick');
            if (!box) return;
            const btn = (name) => {
                const mine = liveIsMyTeam(name);
                return `<button class="live-team-pick-btn flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border-2 font-bold text-sm transition ${mine ? 'border-red-600 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'border-gray-200 dark:border-gray-600 hover:border-red-400'}" data-team="${xmlEsc(name)}"><img src="${getLogo(name)}" class="w-7 h-7 object-contain">${xmlEsc(name)}${mine ? ' ✓' : ''}</button>`;
            };
            box.innerHTML = '<div class="text-[10px] uppercase font-bold text-gray-400 mb-1 text-center">Qui suis-tu en direct ? Un clic sur une équipe (par défaut : les Lynx de Valence)</div><div class="flex gap-2">' + btn(homeTeam) + btn(awayTeam) + '</div>';
            box.style.display = '';
            box.querySelectorAll('.live-team-pick-btn').forEach(b => b.onclick = () => {
                const team = b.dataset.team || '';
                liveFollowTeam = /valence/i.test(normalize(team)) ? '' : team; // Valence = réglage par défaut (champ vide)
                try { localStorage.setItem('lynx_live_team', liveFollowTeam); } catch (e) {}
                const ti = document.getElementById('live-follow-team'); if (ti) ti.value = liveFollowTeam;
                liveRenderTeamPick(homeTeam, awayTeam); // déplace la marque ✓ sur l'équipe choisie
                const stl = document.getElementById('live-status-line');
                const m0 = (allMatches || []).find(x => String(x.ffhgId || '') === String(liveJumpNum));
                const kt = m0 ? new Date(m0.date).getTime() : NaN;
                if (isFinite(kt) && Date.now() >= kt - 3600e3) {
                    const sb = document.getElementById('live-btn-start');
                    if (sb && sb.style.display !== 'none') sb.click(); // match imminent ou en cours → surveillance lancée tout de suite
                } else if (stl) stl.textContent = '✅ Équipe suivie : ' + (liveFollowTeam || 'Lynx de Valence') + ' — n° ' + liveJumpNum + ' pré-rempli. La surveillance démarrera le jour J (ou clique « Démarrer la surveillance »).';
            });
        }
        function liveJumpToMatch(ffhgId, homeTeam, awayTeam) {
            liveJumpNum = String(ffhgId || '');
            if (!liveJumpNum) return;
            const li = document.getElementById('live-match-url');
            if (li) li.value = liveJumpNum;
            const ai = document.getElementById('admin-live-match-id');
            if (ai && !ai.value.trim()) ai.value = liveJumpNum;
            const t = document.querySelector('.main-nav-tab[data-content="live-match"]');
            if (t) t.click();
            else { const sel = document.getElementById('mobile-nav-select'); if (sel) { sel.value = 'live-match'; sel.dispatchEvent(new Event('change')); } }
            liveRenderTeamPick(homeTeam, awayTeam);
        }
        // Délégation en phase de capture : le clic sur « 🔴 Live » n'ouvre PAS la saisie de score de la ligne.
        document.addEventListener('click', (e) => {
            const b = e.target.closest('.live-jump-btn');
            if (!b) return;
            e.stopPropagation(); e.preventDefault();
            liveJumpToMatch(b.dataset.ffhg, b.dataset.h, b.dataset.a);
        }, true);