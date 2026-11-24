// ===== TAGS/PARTAGE DES ACTUS + PRONOSTIC BUTEUR + RECHERCHE UNIVERSELLE + DONNÉES DU LEXIQUE =====
        // --- v2.18 : partage d'un article — lien direct vers la page actus publique (copié si le partage natif est indisponible) ---
        // v2.19 : hashtags des articles — saisis en Admin (champ « Hashtags » de la modale Modifier, stockés dans n.tags),
        // sinon déduits automatiquement du type d'article. Servent au tri sur le site (chips cliquables) et au partage réseaux.
        function newsTagsOf(n) {
            let t = [];
            if (Array.isArray(n.tags)) t = n.tags.map(s => String(s || '').trim());
            else if (typeof n.tags === 'string') t = n.tags.split(/[,\s]+/).map(s => s.trim());
            t = t.filter(Boolean).map(s => s.startsWith('#') ? s : '#' + s);
            if (!t.length) {
                const k = (n && n.kind) || '';
                t = k === 'preview' ? ['#AvantMatch', '#Pronostic'] : k === 'result' ? ['#Résultat'] : k === 'month' ? ['#Récap'] : k === 'poule' ? ['#Panorama'] : k === 'stats' ? ['#Stats'] : ['#Actus'];
                if (k === 'result') { const ti = ((n && n.title) || '') + ' ' + String((n && n.content) || '').slice(0, 300); t.push(/victoire|s'impose|gagne/i.test(ti) ? '#Victoire' : (/défaite|s'incline|battu|corrige/i.test(ti) ? '#Défaite' : '#Match')); }
                t.push('#LynxDeValence');
            }
            return [...new Set(t)].slice(0, 5);
        }
        // v2.19 : texte de hashtags pour le partage = hashtags de l'article + hashtags par défaut (Admin → News), sans doublons
        const shareTextTags = (n) => { const base = String(shareTags || '').split(/\s+/).filter(Boolean); const all = n ? [...newsTagsOf(n), ...base] : base; return [...new Set(all)].join(' '); };
        async function shareNewsItem(n) {
            try {
                const pagesBase = String(rssPublicUrl || '').replace(/\/?feed\.xml\s*$/, '').replace(/\/?$/, '/');
                const base = (location.origin && location.origin.startsWith('http') ? location.origin + location.pathname : 'https://gedebelcho7.github.io/lynx-feed/app/');
                const url = pagesBase ? pagesBase + 'actus.html#lynx-' + String(n.id || hashId(n.title)) : base;
                // v2.18 : texte prêt à publier — titre + extrait propre (Markdown retiré), l'utilisateur choisit
                // le réseau dans la feuille de partage native et valide lui-même : aucun envoi automatique.
                const teaser = String(n.content || '').replace(/[#*`>_\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
                if (navigator.share) { await navigator.share({ title: n.title || 'Les Lynx de Valence', text: (n.title || '') + (teaser ? '\n\n' + teaser + '…' : '') + '\n\n' + shareTextTags(n), url }); return; }
                await navigator.clipboard.writeText((n.title || '') + '\n\n' + teaser + (teaser ? '…' : '') + '\n' + url + '\n\n' + shareTextTags(n));
                appAlert('🔗 Titre + extrait + lien copiés !\n\nColle-les où tu veux (réseaux, messageries…)');
            } catch (e) {
                if (e && e.name === 'AbortError') return;
                try { await navigator.clipboard.writeText(String((n && n.title) || '')); appAlert('Partage indisponible sur ce navigateur — le titre a été copié.'); } catch (e2) { appAlert('Partage indisponible sur ce navigateur.'); }
            }
        }
        // v2.19 : partage d'un article de presse d'un autre flux — le lien pointe vers L'ARTICLE D'ORIGINE
        // (jamais vers le site des Lynx), avec la source et les hashtags de partage. Ouvert à tous, pas seulement admin.
        async function shareRssItem(it) {
            try {
                const txt = (it.title || '') + '\n(' + (it.source || 'Presse') + ')';
                if (navigator.share) { await navigator.share({ title: it.title || '', text: txt + '\n\n' + shareTextTags(null), url: it.link || '' }); return; }
                await navigator.clipboard.writeText(txt + '\n\n' + shareTextTags(null) + '\n' + (it.link || ''));
                appAlert('🔗 Titre + source + hashtags + lien vers l\'article copiés !');
            } catch (e) {
                if (e && e.name === 'AbortError') return;
                try { await navigator.clipboard.writeText(String((it && it.title) || '') + '\n' + ((it && it.link) || '')); appAlert('Partage indisponible — titre + lien copiés.'); } catch (e2) { appAlert('Partage indisponible sur ce navigateur.'); }
            }
        }

        // --- v2.18 : pronostic buteur — le Lynx le plus susceptible de marquer, calculé depuis les rapports live (repli : stats de l'effectif) ---
        let scorerPickCache = null, scorerPickTs = 0;
        async function refreshScorerPick(season) {
            try {
                if (Date.now() - scorerPickTs < 10 * 60e3 && scorerPickCache !== null) return scorerPickCache;
                scorerPickTs = Date.now();
                const reps = (await dbFetchCol('live-reports')).map(d => d.data).filter(r => r && Array.isArray(r.events) && (!r.season || String(r.season) === String(season)));
                const goals = {}; let nb = 0;
                reps.forEach(r => {
                    const isH = normalize(r.homeTeam || '').includes('valence'), isA = normalize(r.awayTeam || '').includes('valence');
                    if (!isH && !isA) return;
                    nb++;
                    r.events.forEach(ev => {
                        if (!ev || ev.ty !== 'BUT' || !ev.who) return;
                        const isL = (ev.side === 'H' && isH) || (ev.side === 'A' && isA);
                        if (!isL) return;
                        const name = String(ev.who).replace(/\(assist[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
                        if (!name) return;
                        goals[name] = (goals[name] || 0) + 1;
                    });
                });
                const tot = Object.values(goals).reduce((s, v) => s + v, 0);
                const entries = Object.entries(goals).sort((x, y) => y[1] - x[1]);
                if (nb && entries.length) scorerPickCache = { name: entries[0][0], goals: entries[0][1], pct: Math.round(100 * entries[0][1] / tot), src: 'matchs suivis en direct' };
                else {
                    const rk = (roster || []).filter(p => p.season === season && Number(p.goals) > 0 && !p.isGoalie).sort((x, y) => Number(y.goals) - Number(x.goals));
                    scorerPickCache = rk.length ? { name: rk[0].name, goals: Number(rk[0].goals), pct: null, src: "stats de l'effectif" } : null;
                }
                return scorerPickCache;
            } catch (e) { return null; }
        }

        // --- v2.18 : recherche universelle — joueurs, équipes/matchs (Face-à-Face) et articles ---
        function runUniversalSearch(q) {
            const box = document.getElementById('search-results');
            if (!box) return;
            const val = normalize(String(q || '').trim());
            if (val.length < 2) { box.innerHTML = '<div class="text-center text-xs text-gray-400 italic p-4">Tape au moins 2 lettres : joueur, équipe, match ou article.</div>'; return; }
            const res = [];
            (roster || []).filter(p => p.season === activeSeason && normalize(p.name || '').includes(val)).forEach(p => res.push({ icon: '🏒', label: p.name, sub: (p.isGoalie ? 'Gardien — ' : '') + 'Effectif des Lynx', act: () => openPlayerModal(p, true) }));
            (leaguePlayers || []).filter(p => p.season === activeSeason && normalize(p.name || '').includes(val)).forEach(p => res.push({ icon: '🏒', label: p.name, sub: 'Joueur — ' + (p.team || '?'), act: () => openPlayerModal(p, false) }));
            (newsList || []).forEach(n => { if (normalize(n.title || '').includes(val) || normalize(n.content || '').includes(val)) res.push({ icon: '📰', label: n.title, sub: 'Article — ' + new Date(n.date).toLocaleDateString('fr-FR'), act: () => { markItemRead(n.id); document.getElementById('news-modal-content').innerHTML = `<div class="flex items-center justify-between gap-2 mb-2"><div class="text-gray-500 text-sm font-bold">${new Date(n.date).toLocaleDateString('fr-FR', {weekday:'long', year:'numeric', month:'long', day:'numeric'})}</div><button id="news-share-btn" class="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-lynx-red hover:border-lynx-red transition whitespace-nowrap" title="Partager cet article (lien vers la page actus publique)">🔗 Partager</button></div><h2 class="text-2xl md:text-3xl font-black mb-4 text-lynx-red leading-tight border-b pb-4 dark:border-gray-700">${n.title}</h2><div class="flex flex-wrap gap-1 mb-6">${newsTagsOf(n).map(t => `<button class="news-tag-chip text-[10px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full px-2 py-0.5 hover:text-lynx-red" data-tag="${xmlEsc(t)}">${xmlEsc(t)}</button>`).join('')}</div><div class="article-body text-base leading-relaxed">${marked.parse(n.content)}</div>`; const sb = document.getElementById('news-share-btn'); if (sb) sb.onclick = (ev) => { ev.stopPropagation(); shareNewsItem(n); }; document.querySelectorAll('#news-modal-content .news-tag-chip').forEach(b => { b.onclick = (ev) => { ev.stopPropagation(); const t = b.dataset.tag; newsTagFilter = (newsTagFilter && newsTagFilter.toLowerCase() === t.toLowerCase()) ? null : t; toggleModal('news-modal', false); renderNews(); }; }); toggleModal('news-modal', true); } }); });
            const seenPair = new Set();
            (allMatches || []).filter(m => m.season === activeSeason && (normalize(m.homeTeam || '').includes(val) || normalize(m.awayTeam || '').includes(val))).slice(0, 40).forEach(m => { const k = [normalize(m.homeTeam), normalize(m.awayTeam)].sort().join('|'); if (seenPair.has(k)) return; seenPair.add(k); res.push({ icon: '⚔️', label: m.homeTeam + ' - ' + m.awayTeam, sub: isMatchFinished(m) ? ('Match joué : ' + m.scoreHome + '-' + m.scoreAway + (m.isProl ? ' (ap)' : '')) : (new Date(m.date).toLocaleDateString('fr-FR') + ' · face-à-face'), act: () => { const tmp = document.createElement('button'); tmp.className = 'open-h2h'; tmp.dataset.home = m.homeTeam; tmp.dataset.away = m.awayTeam; document.body.appendChild(tmp); tmp.click(); tmp.remove(); } }); });
            if (!res.length) { box.innerHTML = '<div class="text-center text-xs text-gray-400 italic p-4">Aucun résultat pour « ' + xmlEsc(String(q).trim()) + ' ».</div>'; return; }
            box.innerHTML = '<div class="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-2">' + res.length + ' résultat(s)</div>' + res.slice(0, 30).map((r, i) => `<button class="search-result-btn w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition" data-i="${i}"><span class="text-lg shrink-0">${r.icon}</span><span class="min-w-0"><span class="block text-sm font-bold truncate">${xmlEsc(r.label)}</span><span class="block text-[11px] text-gray-400 truncate">${xmlEsc(r.sub)}</span></span></button>`).join('');
            box.querySelectorAll('.search-result-btn').forEach(b => { b.onclick = () => { const r = res[Number(b.dataset.i)]; if (!r) return; toggleModal('search-modal', false); setTimeout(() => { try { r.act(); } catch (e) {} }, 120); }; });
        }

        // --- GLOSSARY DATA (Now Mutable) ---
        let glossaryData = [
            { term: "Hors-Jeu (Offside)", type: "regle", icon: "🚩", def: "Un joueur attaquant entre dans la zone offensive (passe la ligne bleue adverse) avant le palet." },
            { term: "Dégagement Interdit (Icing)", type: "regle", icon: "🚫", def: "Un joueur tire le palet depuis sa moitié de terrain jusqu'à derrière la ligne de but adverse sans qu'il ne soit touché." },
            { term: "Supériorité Numérique (Powerplay)", type: "regle", icon: "⚡", def: "Situation où une équipe joue avec plus de joueurs (5 contre 4 ou 3) suite à une pénalité adverse." },
            { term: "Infériorité Numérique (Boxplay)", type: "regle", icon: "🛡️", def: "Situation défensive où une équipe doit résister avec un joueur de moins." },
            { term: "Blanchissage (Shutout)", type: "stat", icon: "🧱", def: "Lorsque le gardien termine le match sans avoir encaissé un seul but." },
            { term: "Cinglage (Slashing)", type: "penalite", icon: "🪓", def: "Pénalité : frapper l'adversaire ou sa crosse avec un coup de bâton violent." },
            { term: "Faire Trébucher (Tripping)", type: "penalite", icon: "🦶", def: "Pénalité : utiliser sa crosse ou son corps pour faire tomber un adversaire." },
            { term: "Charge incorrecte", type: "penalite", icon: "💥", def: "Pénalité : charger un adversaire de manière violente, en sautant ou par derrière." },
            { term: "Mise au jeu (Face-off)", type: "regle", icon: "🏒", def: "L'arbitre lâche le palet entre deux joueurs pour lancer ou reprendre le jeu." },
            { term: "Tiers-Temps", type: "regle", icon: "⏱️", def: "Un match est divisé en 3 périodes de 20 minutes effectives." },
            { term: "Zone Neutre", type: "regle", icon: "⚪", def: "La partie centrale de la patinoire, entre les deux lignes bleues." },
            { term: "Surnombre", type: "penalite", icon: "🔢", def: "Pénalité d'équipe lorsqu'il y a trop de joueurs sur la glace." },
            { term: "Cross-Checking", type: "penalite", icon: "❌", def: "Pénalité : frapper l'adversaire avec le manche de la crosse tenu à deux mains." },
            { term: "Assistance", type: "stat", icon: "👟", def: "Point attribué au(x) joueur(s) ayant fait la passe décisive avant un but (max 2 par but)." },
            { term: "Ligne Bleue", type: "regle", icon: "🔵", def: "Ligne délimitant la zone offensive/défensive de la zone neutre." },
            { term: "But Accordé", type: "geste", icon: "🙆‍♂️", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Ice_hockey_official_signal_goal_scored.svg/1200px-Ice_hockey_official_signal_goal_scored.svg.png", def: "L'arbitre pointe le filet après que le palet a franchi la ligne de but." }
        ];
