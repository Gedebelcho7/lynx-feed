// ===== ACTUS (UI + brouillons IA), CARTE BOT ACCUEIL, CHAMPION, COMPARISON ÉQUIPES, MORALE, MAGIC NUMBER, UPDATEUI, GARDIENS, LIGNE DE MATCH =====
        let newsFilter = 'all', newsShowAll = false; // filtre d'affichage des actus (persiste entre les rendus)
        let newsTagFilter = null; // v2.19 : filtre par hashtag (clic sur une pastille #), null = pas de filtre
        let newsReadFilter = null; // v2.17 : filtre de lecture — all / unread / read ; null = automatique : « Non lus » par défaut s'il y en a, sinon « Tous » (demande du 07/11)
        let editingNewsId = null; // v2.17 : article en cours de modification (modale dédiée)
        let pendingDraft = null, draftCapture = null; // v2.22 : brouillon d'article — générer → corriger → publier (ou jeter)
        function openDraftModal(draft) {
            pendingDraft = draft;
            editingNewsId = null;
            document.getElementById('news-edit-title').value = (draft.payload && draft.payload.title) || '';
            document.getElementById('news-edit-content').value = (draft.payload && draft.payload.content) || '';
            const tgEl = document.getElementById('news-edit-tags'); if (tgEl) tgEl.value = '';
            const dtEl = document.getElementById('news-edit-date'); if (dtEl) dtEl.value = new Date().toISOString().slice(0, 10);
            const btn = document.getElementById('news-edit-save'); if (btn) btn.textContent = '✅ Publier';
            toggleModal('news-edit-modal', true);
            verifyDraftFacts();
            appAlert('📝 Brouillon prêt : corrige ce que tu veux (titre, contenu, date, hashtags), puis « ✅ Publier ». Ferme la fenêtre pour jeter le brouillon sans rien publier.');
        }
        // v2.22 : vérification des faits du brouillon — chaque phrase est comparée aux données fournies à l'IA
        // ✅ vert = appuyée sur les données du site · 📰 bleu = écho presse (doit être sourcé) · ⚠️ orange = quelque chose
        // (chiffre ou nom propre) n'apparaît NULLE PART dans les données du site → possible invention, à vérifier avant publication.
        function verifyDraftFacts() {
            const el = document.getElementById('news-verify-panel');
            if (!el) return;
            if (!pendingDraft) { el.innerHTML = ''; return; }
            try {
                const txt = (document.getElementById('news-edit-content').value || '') + '\n' + (document.getElementById('news-edit-title').value || '');
                const src = normalize(String(pendingDraft.sources || ''));
                const known = new Set();
                try { (allMatches || []).forEach(m => [m.homeTeam, m.awayTeam].forEach(x => { if (x) normalize(String(x)).split(/\s+/).forEach(w => { if (w.length > 3) known.add(w); }); })); } catch (e) {}
                try { [...(leaguePlayers || []), ...(roster || [])].forEach(p => { if (p && p.name) normalize(String(p.name)).split(/\s+/).forEach(w => { if (w.length > 3) known.add(w); }); }); } catch (e) {}
                const srcWords = new Set(src.split(/[^a-zà-ÿ0-9]+/).filter(w => w.length > 2));
                const sents = txt.split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 3 && !/^[#>*\-|]/.test(s));
                const rows = sents.map(s => {
                    const press = /selon |d'après /i.test(s);
                    const bad = [];
                    (s.match(/\d[\d\s.,']*/g) || []).forEach(n => { const nn = n.replace(/[\s.,']+$/, '').trim(); if (nn && !src.includes(normalize(nn))) bad.push(nn); });
                    s.split(/\s+/).forEach((w, i) => {
                        const clean = w.replace(/[^A-ZÀ-Ýa-zà-ÿ'-]/g, '');
                        if (i === 0 || clean.length < 4) return;
                        if (!/^[A-ZÀ-Ý][a-zà-ÿ]{3,}(-[A-ZÀ-Ý][a-zà-ÿ]{3,})?$/.test(clean)) return;
                        const nc = normalize(clean);
                        if (!srcWords.has(nc) && !known.has(nc)) bad.push(clean);
                    });
                    return { s, press, bad: [...new Set(bad)].slice(0, 4) };
                });
                const nBad = rows.filter(r => r.bad.length).length, nPress = rows.filter(r => r.press && !r.bad.length).length, nOk = rows.length - nBad - nPress;
                const chip = (cls, lbl, n) => n ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}">${lbl} ${n}</span>` : '';
                const line = (r) => r.bad.length
                    ? `<div class="flex gap-2 py-1"><span class="mt-1 w-2 h-2 rounded-full bg-orange-500 flex-shrink-0"></span><div><span class="text-orange-600 dark:text-orange-400 font-bold">⚠️ À vérifier</span> — <span class="text-gray-600 dark:text-gray-300">${xmlEsc(r.s.slice(0, 160))}${r.s.length > 160 ? '…' : ''}</span><div class="text-[10px] text-orange-500 mt-0.5">absent des données du site : ${r.bad.map(x => xmlEsc(x)).join(' · ')}</div></div></div>`
                    : r.press
                        ? `<div class="flex gap-2 py-1"><span class="mt-1 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></span><div class="text-gray-500 dark:text-gray-400"><span class="font-bold text-blue-600 dark:text-blue-400">📰 Presse (vérifie la source citée)</span> — ${xmlEsc(r.s.slice(0, 140))}${r.s.length > 140 ? '…' : ''}</div></div>`
                        : `<div class="flex gap-2 py-1"><span class="mt-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span><div class="text-gray-500 dark:text-gray-400"><span class="font-bold text-green-600 dark:text-green-400">✅ Données du site</span> — ${xmlEsc(r.s.slice(0, 140))}${r.s.length > 140 ? '…' : ''}</div></div>`;
                el.innerHTML = rows.length ? `<div class="p-2 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700"><div class="flex flex-wrap gap-2 items-center mb-1">${chip('bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', '✅ site', nOk)}${chip('bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', '📰 presse', nPress)}${chip('bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', '⚠️ à vérifier', nBad)}<span class="text-[10px] text-gray-400">comparaison phrase par phrase avec les données fournies à l'IA</span></div><div class="max-h-40 overflow-y-auto">${rows.map(line).join('')}</div></div>` : '';
            } catch (e) { el.innerHTML = ''; }
        }
        function editNews(id) {
            const n = (newsList || []).find(x => x.id === id);
            if (!n) return;
            editingNewsId = id;
            document.getElementById('news-edit-title').value = n.title || '';
            document.getElementById('news-edit-content').value = n.content || '';
            const tgEl = document.getElementById('news-edit-tags'); if (tgEl) tgEl.value = Array.isArray(n.tags) ? n.tags.join(' ') : (n.tags || '');
            const dtEl = document.getElementById('news-edit-date'); if (dtEl) dtEl.value = n.date ? new Date(n.date).toISOString().slice(0, 10) : ''; // v2.21
            pendingDraft = null; // v2.22 : mode édition simple
            const sb = document.getElementById('news-edit-save'); if (sb) sb.textContent = 'Enregistrer';
            toggleModal('news-edit-modal', true);
        }
        // Lu / non-lu des actus (par appareil, localStorage) — v2.17 : tout article non ouvert est « non lu » par défaut
        let readSetCache = null;
        const readSet = () => { if (!readSetCache) { try { readSetCache = new Set(JSON.parse(localStorage.getItem('lynx_read') || '[]')); } catch (e) { readSetCache = new Set(); } } return readSetCache; };
        const readSetPersist = (s) => { try { localStorage.setItem('lynx_read', JSON.stringify([...s].slice(-800))); } catch (e) {} };
        // v2.17 : par défaut, TOUT article non ouvert est « non lu » (plus d'ancienneté maximale de 60 jours
        // qui marquait les vieux articles comme lus d'office) — un article ne devient lu qu'en l'ouvrant
        // ou via les boutons « tout marquer lu ».
        const isItemUnread = (id) => { try { return !readSet().has(id); } catch (e) { return true; } };
        const markItemRead = (id) => { const s = readSet(); s.add(id); readSetPersist(s); updateUnreadBadges(); };
        const markAllNewsRead = () => { const s = readSet(); (newsList || []).forEach(n => s.add(n.id)); readSetPersist(s); updateUnreadBadges(); renderNews(); };
        const markAllRssRead = () => { const s = readSet(); (rssItems || []).forEach(i => s.add(i.id)); readSetPersist(s); updateUnreadBadges(); renderRssSection(); };
        function updateUnreadBadges() {
            try {
                const total = (newsList || []).filter(n => isItemUnread(n.id, n.date)).length + (rssItems || []).filter(i => i.title && isItemUnread(i.id, i.pubDate || i.fetchedAt)).length;
                const el = document.getElementById('actus-unread-badge');
                if (el) { el.classList.toggle('hidden', total === 0); el.textContent = total > 99 ? '99+' : String(total); }
            } catch (e) {}
        }
        function renderNews() {
            const container = document.getElementById('news-list-content'); 
            if(!newsList || newsList.length === 0) { container.innerHTML = `<div class="text-center text-sm text-gray-400 italic p-4">Aucune actualité.</div>`; return; } 
            const sorted = [...newsList].sort((a,b) => new Date(b.date) - new Date(a.date));
            const defs = [['all', '📰 Tout'], ['preview', '🔮 Pronostics'], ['result', '📊 Résultats'], ['month', '📅 Récaps']];
            const adm = (!adminPassHash || adminUnlocked()); // v2.17 : boutons modifier/supprimer visibles seulement admin déverrouillé
            const byKind = newsFilter === 'all' ? sorted : sorted.filter(n => (n.kind || '') === newsFilter);
            const unreadCount = sorted.filter(n => isItemUnread(n.id, n.date)).length;
            const readFilter = newsReadFilter || (unreadCount > 0 ? 'unread' : 'all'); // v2.17 : par défaut « Non lus » s'il y en a, sinon « Tous »
            const byTag = newsTagFilter ? byKind.filter(n => newsTagsOf(n).some(t => t.toLowerCase() === newsTagFilter.toLowerCase())) : byKind; // v2.19 : filtre par hashtag
            const filtered = byTag.filter(n => readFilter === 'all' ? true : (readFilter === 'unread' ? isItemUnread(n.id, n.date) : !isItemUnread(n.id, n.date)));
            const limited = (newsShowAll || newsFilter !== 'all') ? filtered : filtered.slice(0, 12);
            const chips = `<div class="flex flex-wrap gap-2 mb-3 items-center">` + defs.map(d => `<button class="news-filter-chip px-3 py-1.5 rounded-full text-xs font-bold transition ${newsFilter === d[0] ? 'bg-lynx-red text-white shadow' : 'bg-white dark:bg-gray-700 text-gray-500 hover:text-lynx-red'}" data-f="${d[0]}">${d[1]}</button>`).join('') + (unreadCount ? `<button id="news-mark-all" class="ml-auto px-3 py-1.5 rounded-full text-xs font-bold bg-white dark:bg-gray-700 text-gray-500 hover:text-lynx-red"><i class="fa-solid fa-check-double mr-1"></i>Tout marquer lu (${unreadCount})</button>` : '') + `</div>`;
            const readChips = `<div class="flex flex-wrap gap-2 mb-3 items-center"><span class="text-[10px] font-bold uppercase text-gray-400 mr-1"><i class="fa-solid fa-eye mr-1"></i>Lecture :</span>` + [['all', `Tous (${sorted.length})`], ['unread', `● Non lus (${unreadCount})`], ['read', `✓ Lus (${sorted.length - unreadCount})`]].map(d => `<button class="news-read-chip px-3 py-1 rounded-full text-xs font-bold transition ${readFilter === d[0] ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow' : 'bg-white dark:bg-gray-700 text-gray-500 hover:text-lynx-red'}" data-f="${d[0]}">${d[1]}</button>`).join('') + `</div>`;
            // v2.19 : rangée de hashtags cliquables — un clic filtre les actus sur ce sujet, un 2ᵉ clic retire le filtre
            const allTags = [...new Set(sorted.flatMap(n => newsTagsOf(n)))].slice(0, 14);
            const tagChips = (allTags.length > 1 || newsTagFilter) ? `<div class="flex items-center gap-2 mb-3 overflow-x-auto"><span class="text-[10px] font-bold text-gray-400 shrink-0"><i class="fa-solid fa-hashtag"></i></span><div class="flex gap-1.5 flex-nowrap">` + allTags.map(t => `<button class="news-tag-chip px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap transition ${newsTagFilter && newsTagFilter.toLowerCase() === t.toLowerCase() ? 'bg-lynx-red text-white shadow' : 'bg-white dark:bg-gray-700 text-gray-500 hover:text-lynx-red'}" data-tag="${xmlEsc(t)}">${xmlEsc(t)}</button>`).join('') + `</div></div>` : '';
            const latest = limited[0] || null; const others = latest ? limited.slice(1) : [];
            let html = chips + readChips + tagChips + (latest ? `<div class="news-card-featured open-news-modal" data-id="${latest.id}"><div class="absolute top-0 right-0 p-2 pointer-events-none"><i class="fa-solid fa-bullhorn text-4xl opacity-30"></i></div><div class="text-[10px] uppercase font-bold opacity-80 mb-1">${isItemUnread(latest.id, latest.date) ? '<span class="text-lynx-red">● Non lu · </span>' : '<span class="opacity-50">✓ Lu · </span>'}${latest.kind === 'preview' ? '🔮 AVANT-MATCH · ' : latest.kind === 'result' ? '📊 RÉSUMÉ · ' : latest.kind === 'month' ? '📅 RÉCAP · ' : latest.kind === 'poule' ? '🏆 PANORAMA · ' : latest.kind === 'stats' ? '📈 STATS · ' : '📰 '}${new Date(latest.date).toLocaleDateString()}</div><h3 class="text-xl font-black mb-2 leading-tight">${latest.title}</h3><p class="text-sm opacity-90 line-clamp-2">${latest.content.substring(0, 100)}...</p><div class="mt-3 pt-2 border-t border-white/25 flex items-center gap-3"><span class="text-xs font-bold uppercase tracking-widest flex items-center gap-1">Lire plus <i class="fa-solid fa-arrow-right"></i></span><span class="flex-1"></span><button class="share-news-btn text-white/80 hover:text-white font-bold text-xs" data-id="${latest.id}" title="Partager / publier sur les réseaux (tu choisis le réseau, rien n'est envoyé tout seul)"><i class="fa-solid fa-share-nodes"></i></button>${adm ? `<button class="edit-news-btn text-white/80 hover:text-white font-bold text-xs" data-id="${latest.id}" title="Modifier"><i class="fa-solid fa-pen"></i></button><button class="del-news-btn text-white/80 hover:text-white font-bold text-xs" data-id="${latest.id}" title="Supprimer"><i class="fa-solid fa-trash"></i></button>` : ''}</div></div>` : '');
            if(others.length > 0) { html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">`; html += others.map(n => `<div class="news-card-normal open-news-modal" data-id="${n.id}"><div class="text-[10px] text-gray-400 font-bold">${isItemUnread(n.id, n.date) ? '<span class="text-lynx-red">●</span>' : '<span class="opacity-50">✓</span>'} ${n.kind === 'preview' ? '🔮 ' : n.kind === 'result' ? '📊 ' : n.kind === 'month' ? '📅 ' : n.kind === 'poule' ? '🏆 ' : n.kind === 'stats' ? '📈 ' : ''}${new Date(n.date).toLocaleDateString()}</div><h4 class="font-bold text-sm line-clamp-1">${n.title}</h4><div class="flex items-center gap-2 mt-1 text-[10px]"><button class="share-news-btn text-gray-400 hover:text-lynx-red font-bold" data-id="${n.id}" title="Partager / publier (tu choisis le réseau, rien n'est envoyé tout seul)">🔗</button>${adm ? `<button class="edit-news-btn text-gray-400 hover:text-blue-500 font-bold" data-id="${n.id}" title="Modifier">✏️</button><button class="del-news-btn text-gray-400 hover:text-red-500 font-bold" data-id="${n.id}" title="Supprimer">🗑️</button>` : ''}</div></div>`).join(''); html += `</div>`; } 
            if(newsFilter === 'all' && filtered.length > 12 && !newsShowAll) html += `<button id="news-show-all" class="w-full py-2 mt-2 text-xs font-bold text-gray-400 hover:text-lynx-red transition"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Afficher les ${filtered.length} articles — historique complet</button>`;
            container.innerHTML = html;
            document.querySelectorAll('.news-filter-chip').forEach(b => { b.onclick = () => { newsFilter = b.dataset.f; renderNews(); }; });
            const bShowAll = document.getElementById('news-show-all'); if (bShowAll) bShowAll.onclick = () => { newsShowAll = true; renderNews(); };
            const bNewsMarkAll = document.getElementById('news-mark-all'); if (bNewsMarkAll) bNewsMarkAll.onclick = () => markAllNewsRead();
            document.querySelectorAll('.news-read-chip').forEach(b => { b.onclick = () => { newsReadFilter = b.dataset.f; renderNews(); }; });
            document.querySelectorAll('.news-tag-chip').forEach(b => { b.onclick = (e) => { e.stopPropagation(); const t = b.dataset.tag; newsTagFilter = (newsTagFilter && newsTagFilter.toLowerCase() === t.toLowerCase()) ? null : t; renderNews(); }; });
            document.querySelectorAll('.edit-news-btn').forEach(b => b.onclick = (e) => { e.stopPropagation(); editNews(b.dataset.id); });
            document.querySelectorAll('.del-news-btn').forEach(b => b.onclick = (e) => { e.stopPropagation(); appConfirm('Supprimer cet article ?', async () => { try { await deleteDoc(doc(db, `${basePath}/news/${b.dataset.id}`)); } catch (err) {} }); });
            updateUnreadBadges();
            document.querySelectorAll('.open-news-modal').forEach(b => { b.onclick = () => { const n = newsList.find(x => x.id === b.dataset.id); if(n) { markItemRead(n.id); renderNews(); document.getElementById('news-modal-content').innerHTML = `<div class="flex items-center justify-between gap-2 mb-2"><div class="text-gray-500 text-sm font-bold">${new Date(n.date).toLocaleDateString('fr-FR', {weekday:'long', year:'numeric', month:'long', day:'numeric'})}</div><button id="news-share-btn" class="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-lynx-red hover:border-lynx-red transition whitespace-nowrap" title="Partager cet article (lien vers la page actus publique)">🔗 Partager</button></div><h2 class="text-2xl md:text-3xl font-black mb-4 text-lynx-red leading-tight border-b pb-4 dark:border-gray-700">${n.title}</h2><div class="flex flex-wrap gap-1 mb-6">${newsTagsOf(n).map(t => `<button class="news-tag-chip text-[10px] font-bold bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full px-2 py-0.5 hover:text-lynx-red" data-tag="${xmlEsc(t)}">${xmlEsc(t)}</button>`).join('')}</div><div class="article-body text-base leading-relaxed">${marked.parse(n.content)}</div>`; const sb = document.getElementById('news-share-btn'); if (sb) sb.onclick = (ev) => { ev.stopPropagation(); shareNewsItem(n); }; document.querySelectorAll('#news-modal-content .news-tag-chip').forEach(b => { b.onclick = (ev) => { ev.stopPropagation(); const t = b.dataset.tag; newsTagFilter = (newsTagFilter && newsTagFilter.toLowerCase() === t.toLowerCase()) ? null : t; toggleModal('news-modal', false); renderNews(); }; }); toggleModal('news-modal', true); } }; });
            // v2.18 : partage depuis les cartes de la liste — feuille de partage native, l'utilisateur choisit le réseau
            document.querySelectorAll('.share-news-btn').forEach(b => { b.onclick = (ev) => { ev.stopPropagation(); const n2 = newsList.find(x => x.id === b.dataset.id); if (n2) shareNewsItem(n2); }; }); 
        }

        function renderAdminNews() { 
            document.getElementById('admin-news-list').innerHTML = newsList.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(n => `<div class="bg-white dark:bg-gray-700 p-3 rounded flex justify-between items-center shadow-sm"><div><div class="font-bold text-sm">${n.title}</div><div class="text-xs text-gray-500">${new Date(n.date).toLocaleDateString()}</div></div><button class="delete-news-btn text-red-500 hover:bg-red-50 p-2 rounded" data-id="${n.id}"><i class="fa-solid fa-trash"></i></button></div>`).join(''); 
            document.querySelectorAll('.delete-news-btn').forEach(b => b.onclick = () => { appConfirm('Supprimer cette actualité ?', async () => { await deleteDoc(doc(db, `${basePath}/news/${b.dataset.id}`)); }); }); 
        }
        
        // --- NEW: Render Bot History in Admin ---
        function renderAdminBotHistory() {
            const container = document.getElementById('admin-bot-preds-list');
            if(!botHistory.length) { container.innerHTML = '<div class="text-center text-xs italic text-gray-400">Aucun historique.</div>'; return; }
            
            container.innerHTML = botHistory.map(h => `
                <div class="flex justify-between items-start border-b dark:border-gray-700 pb-2 mb-2 last:mb-0 last:border-0">
                    <div class="text-xs">
                        <div class="font-bold text-gray-500">${new Date(h.date).toLocaleDateString()}</div>
                        <div class="line-clamp-2">${h.analysis || h.content}</div>
                    </div>
                    <button class="delete-bot-hist-btn text-red-400 hover:text-red-600 ml-2" data-id="${h.id}"><i class="fa-solid fa-trash"></i></button>
                </div>
            `).join('');
            
            document.querySelectorAll('.delete-bot-hist-btn').forEach(b => {
                b.onclick = () => {
                    appConfirm("Supprimer cette entrée de la mémoire du bot ?", async () => {
                        await deleteDoc(doc(db, `${basePath}/bot-history/${b.dataset.id}`));
                    });
                };
            });
        }
        
        // --- NEW: Render Bot Prediction on Home (Structured) ---
        function renderHomeBotCard() {
            const card = document.getElementById('home-bot-card');
            if(!botHistory.length) { card.classList.add('hidden'); return; }
            
            const latest = botHistory[0]; // Sorted by listener
            if(!latest) { card.classList.add('hidden'); return; }
            
            card.classList.remove('hidden');
            
            // Format Date
            document.getElementById('home-bot-date').textContent = new Date(latest.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
            
            // Handle Structure (Backward Compatibility)
            if(latest.matchId && latest.homeTeam) {
                // Structured Data Mode
                document.getElementById('home-bot-team-h').textContent = latest.homeTeam;
                document.getElementById('home-bot-img-h').src = getLogo(latest.homeTeam);
                
                document.getElementById('home-bot-team-a').textContent = latest.awayTeam;
                document.getElementById('home-bot-img-a').src = getLogo(latest.awayTeam);
                
                document.getElementById('home-bot-score').textContent = `${latest.predScoreHome} - ${latest.predScoreAway}`;
                
                // Confidence Bar
                const conf = latest.confidence || 50;
                const bar = document.getElementById('home-bot-confidence-bar');
                bar.style.width = `${conf}%`;
                bar.className = `h-full ${conf > 75 ? 'bg-green-500' : (conf > 40 ? 'bg-yellow-500' : 'bg-red-500')}`;
                
                // Key Player
                const playerContainer = document.getElementById('home-bot-key-player-container');
                if(latest.keyPlayer && latest.keyPlayer.trim() !== '') {
                    playerContainer.classList.remove('hidden');
                    document.getElementById('home-bot-key-player').textContent = latest.keyPlayer;
                } else {
                    playerContainer.classList.add('hidden');
                }
                
                // Analysis Text with Markdown
                document.getElementById('home-bot-analysis').innerHTML = marked.parse(latest.analysis || "");
                
                // CLICK HANDLER FOR FULL MODAL
                card.onclick = () => {
                    document.getElementById('bpm-team-h').textContent = latest.homeTeam;
                    document.getElementById('bpm-logo-h').src = getLogo(latest.homeTeam);
                    document.getElementById('bpm-team-a').textContent = latest.awayTeam;
                    document.getElementById('bpm-logo-a').src = getLogo(latest.awayTeam);
                    document.getElementById('bpm-score').textContent = `${latest.predScoreHome} - ${latest.predScoreAway}`;
                    document.getElementById('bpm-content').innerHTML = marked.parse(latest.analysis || "");
                    
                    const barModal = document.getElementById('bpm-confidence');
                    barModal.style.width = `${conf}%`;
                    barModal.className = `h-full ${conf > 75 ? 'bg-green-500' : (conf > 40 ? 'bg-yellow-500' : 'bg-red-500')}`;
                    
                    toggleModal('bot-prediction-modal', true);
                };
                
            } else {
                // Fallback for Old Text-Only Data
                document.getElementById('home-bot-team-h').textContent = "?";
                document.getElementById('home-bot-img-h').src = "";
                document.getElementById('home-bot-team-a').textContent = "?";
                document.getElementById('home-bot-img-a').src = "";
                document.getElementById('home-bot-score').textContent = "? - ?";
                document.getElementById('home-bot-analysis').textContent = `"${latest.content}"`;
                document.getElementById('home-bot-confidence-bar').style.width = "0%";
                document.getElementById('home-bot-key-player-container').classList.add('hidden');
            }
        }
        

        function renderAdminContext() { 
            document.getElementById('admin-context-list').innerHTML = knowledgeBase.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(n => `<div class="bg-white dark:bg-gray-700 p-3 rounded flex justify-between items-center shadow-sm border-l-4 border-purple-500"><div class="truncate pr-2"><div class="font-bold text-sm truncate">${n.title}</div><div class="text-[10px] text-gray-500 line-clamp-1">${n.content}</div></div><button class="delete-context-btn text-red-500 hover:bg-red-50 p-2 rounded" data-id="${n.id}"><i class="fa-solid fa-trash"></i></button></div>`).join(''); 
            document.querySelectorAll('.delete-context-btn').forEach(b => b.onclick = () => { appConfirm('Supprimer ce contexte ?', async () => { await deleteDoc(doc(db, `${basePath}/context/${b.dataset.id}`)); }); }); 
        }

        function renderChampionBanner() { 
            const banner = document.getElementById('champion-banner'); 
            const finale = allMatches.find(m => m.season === activeSeason && m.type && (normalize(m.type) === 'finale' || normalize(m.type).includes('final')) && isMatchFinished(m)); 
            if (finale) { 
                const winner = finale.scoreHome > finale.scoreAway ? finale.homeTeam : finale.awayTeam; 
                document.getElementById('champion-name').textContent = winner; 
                banner.classList.remove('hidden'); 
            } else { 
                banner.classList.add('hidden'); 
            } 
        }

        // v2.18 : saison en cours calculée depuis la date du jour (à partir de juillet → nouvelle saison) —
        // l'app ne doit jamais retomber par défaut sur une saison passée.
        function currentSeasonNow() {
            const d = new Date();
            const y = d.getFullYear();
            return d.getMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
        }
        function updateSeasonSelector() {
            const seasons = [...new Set([...allMatches.map(m=>m.season), ...rankingA.map(r=>r.season), ...rankingB.map(r=>r.season), ...leaguePlayers.map(p=>p.season)])].filter(Boolean).sort().reverse();
            const sel = document.getElementById('season-selector');
            if(seasons.length > 0) { 
                // v2.18 : par défaut la saison EN COURS si elle existe dans les données, sinon la plus récente —
                // jamais un repli sur une saison passée qui déclenchait les articles auto de l'an dernier.
                if(!activeSeason || !seasons.includes(activeSeason)) { const nowS = currentSeasonNow(); activeSeason = seasons.includes(nowS) ? nowS : seasons[0]; }
                sel.innerHTML = seasons.map(s => `<option value="${s}" ${s === activeSeason ? 'selected' : ''}>${s}</option>`).join(''); 
                sel.value = activeSeason; 
            } else { 
                if(!activeSeason) activeSeason = currentSeasonNow(); // v2.18 : saison du jour au lieu du « 2025-2026 » en dur
                sel.innerHTML = `<option value="${activeSeason}">${activeSeason}</option>`; 
            }
        }

        function updateComparatorSelects() {
            const teams = [...new Set(allMatches.map(m => m.homeTeam).concat(allMatches.map(m => m.awayTeam)))].sort();
            if(teams.length > 0) {
                const opts = teams.map(t => `<option value="${t}">${t}</option>`).join('');
                const sa = document.getElementById('comp-team-a'); const sb = document.getElementById('comp-team-b');
                if(sa.options.length !== teams.length) { 
                    const oldA = sa.value; const oldB = sb.value;
                    sa.innerHTML = opts; sb.innerHTML = opts; 
                    if(oldA && teams.includes(oldA)) sa.value = oldA; if(oldB && teams.includes(oldB)) sb.value = oldB; else sb.value = teams[1] || teams[0]; 
                }
            }
            runComparison();
        }

        function runComparison() {
            const tA = document.getElementById('comp-team-a').value; const tB = document.getElementById('comp-team-b').value;
            const period = document.getElementById('comp-period').value;
            if(!tA || !tB) return;
            
            const scopeMatches = period === 'all' ? allMatches : allMatches.filter(m => m.season === activeSeason);
            const finishedScope = scopeMatches.filter(m => isMatchFinished(m));
            
            const getStats = (team) => {
                const ms = finishedScope.filter(m => m.homeTeam === team || m.awayTeam === team);
                let pts=0, gf=0, ga=0, mj=0, wins=0;
                ms.forEach(m => { 
                    mj++; const s = m.homeTeam===team?m.scoreHome:m.scoreAway; const o = m.homeTeam===team?m.scoreAway:m.scoreHome; 
                    gf+=s; ga+=o; 
                    if(s>o) { wins++; pts+= (m.isProl ? 2 : 3); } 
                    else if(s===o) pts+=1; 
                    else if(m.isProl) pts+=1;
                });
                return { team, pts, mj, bp: gf, bc: ga, wins, avgGF: mj?gf/mj:0, avgGA: mj?ga/mj:0, winPct: mj?(wins/mj)*100:0 };
            };
            
            const sA = getStats(tA); const sB = getStats(tB);

            // H2H
            const h2hMatches = finishedScope.filter(m => (m.homeTeam === tA && m.awayTeam === tB) || (m.homeTeam === tB && m.awayTeam === tA));
            let wA=0, wB=0, dr=0; h2hMatches.forEach(m => { const scA = m.homeTeam === tA ? m.scoreHome : m.scoreAway; const scB = m.homeTeam === tA ? m.scoreAway : m.scoreHome; if(scA > scB) wA++; else if(scB > scA) wB++; else dr++; });
            const totH2H = wA + wB + dr;

            document.getElementById('comparison-results').classList.remove('hidden');
            document.getElementById('comp-logo-a').src = getLogo(tA); document.getElementById('comp-name-a').textContent = tA;
            document.getElementById('comp-logo-b').src = getLogo(tB); document.getElementById('comp-name-b').textContent = tB;
            
            document.getElementById('comp-h2h-a').textContent = wA; document.getElementById('comp-h2h-b').textContent = wB; document.getElementById('comp-h2h-draw').textContent = dr;
            document.getElementById('h2h-bar-a').style.width = totH2H ? (wA/totH2H)*100 + '%' : '50%'; 
            document.getElementById('h2h-bar-b').style.width = totH2H ? (wB/totH2H)*100 + '%' : '50%';
            
            // Stats Details Construction (simplified to fit logic)
            let detailsHtml = '';
            
            const createBar = (label, vA, vB, max, colorClass='bg-blue-500') => `
                <div class="mb-4">
                    <div class="flex justify-between text-xs font-bold mb-1">
                        <span class="${vA>vB?'text-blue-600':''}">${vA}</span>
                        <span class="text-gray-400 uppercase">${label}</span>
                        <span class="${vB>vA?'text-red-600':''}">${vB}</span>
                    </div>
                    <div class="comp-bar-container">
                        <div class="comp-bar-l ${colorClass}" style="width:${(vA/max)*100}%"></div>
                        <div class="comp-bar-r ${colorClass}" style="width:${(vB/max)*100}%"></div>
                    </div>
                </div>`;

            const maxGF = Math.max(sA.avgGF, sB.avgGF, 1);
            detailsHtml += createBar('Buts Marqués / M', sA.avgGF.toFixed(2), sB.avgGF.toFixed(2), maxGF, 'bg-green-500');
            
            const maxGA = Math.max(sA.avgGA, sB.avgGA, 1);
            detailsHtml += createBar('Buts Encaissés / M', sA.avgGA.toFixed(2), sB.avgGA.toFixed(2), maxGA, 'bg-orange-500');
            
            const maxWin = Math.max(sA.winPct, sB.winPct, 1);
            detailsHtml += createBar('% Victoire', Math.round(sA.winPct)+'%', Math.round(sB.winPct)+'%', maxWin, 'bg-purple-500');

            // Rank logic (if season)
            if(period === 'season') {
                const liveB = computeLiveRanking(activeSeason, 'B', rankingB.filter(r=>r.season === activeSeason));
                const liveA = computeLiveRanking(activeSeason, 'A', rankingA.filter(r=>r.season === activeSeason));
                const allLive = [...liveB, ...liveA];
                
                const getRank = (team) => {
                    const t = allLive.find(x => normalize(x.team) === normalize(team));
                    if(!t) return { rank: '-', pts: '-' };
                    const list = t.poule === 'A' ? liveA : liveB;
                    const sorted = sortRankFFHG(list, activeSeason);
                    const idx = sorted.findIndex(x => x.team === t.team) + 1;
                    return { rank: `${idx}e${seasonHasPoules(activeSeason) ? ' (' + t.poule + ')' : ''}`, pts: `${t.pts} pts` };
                };
                
                const rA = getRank(tA); const rB = getRank(tB);
                document.getElementById('comp-rank-a').textContent = rA.rank; 
                document.getElementById('comp-rank-b').textContent = rB.rank; 
            } else {
                document.getElementById('comp-rank-a').textContent = '-'; 
                document.getElementById('comp-rank-b').textContent = '-'; 
            }

            document.getElementById('comp-details-container').innerHTML = `<h4 class="font-bold uppercase text-xs tracking-widest mb-4 border-b pb-2 dark:border-gray-700">Statistiques Moyennes</h4>` + detailsHtml + `<div id="comp-common-opponents" class="space-y-2 mt-6 pt-4 border-t dark:border-gray-700"></div>` + '<div id="comp-live-stats" class="mt-6 pt-4 border-t dark:border-gray-700"></div>';

            renderCommonOpponents(tA, tB, finishedScope);
            try { renderCompLiveStats(tA, tB); } catch (e) {} // v2.22 : stats live comparées (déroulés archivés)
        }

        function renderCommonOpponents(tA, tB, matches) {
            const getOpps = (team) => {
                const m = matches.filter(x => x.homeTeam === team || x.awayTeam === team);
                const opps = new Set();
                m.forEach(x => opps.add(x.homeTeam === team ? x.awayTeam : x.homeTeam));
                return [...opps];
            };
            
            const oppsA = getOpps(tA);
            const oppsB = getOpps(tB);
            const common = oppsA.filter(o => oppsB.includes(o)).sort();
            
            const container = document.getElementById('comp-common-opponents');
            
            if(common.length === 0) {
                container.innerHTML = '<div class="text-center text-gray-400 italic text-xs">Aucun adversaire commun trouvé sur la période.</div>';
                return;
            }
            
            const getResult = (team, opp) => {
                const match = matches.filter(m => (m.homeTeam === team && m.awayTeam === opp) || (m.homeTeam === opp && m.awayTeam === team))
                                     .sort((a,b) => new Date(b.date) - new Date(a.date))[0]; 
                if(!match) return { pts: 0, text: '-', diff: -99 };
                const s = match.homeTeam === team ? match.scoreHome : match.scoreAway;
                const o = match.homeTeam === team ? match.scoreAway : match.scoreHome;
                let pts = 0;
                if(s > o) pts = match.isProl ? 2 : 3; else if(s === o) pts = 1; else if(match.isProl) pts = 1;
                return { pts, text: `${s}-${o}`, diff: s-o };
            };
            
            let html = `<h4 class="font-bold uppercase text-xs tracking-widest mb-2 text-purple-600 dark:text-purple-400">Duel Indirect (Adversaires Communs)</h4>`;
            
            common.forEach(opp => {
                const rA = getResult(tA, opp);
                const rB = getResult(tB, opp);
                const advA = rA.pts > rB.pts || (rA.pts === rB.pts && rA.diff > rB.diff);
                const advB = rB.pts > rA.pts || (rB.pts === rA.pts && rB.diff > rA.diff);
                
                const bgA = advA ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 font-bold' : 'text-gray-500';
                const bgB = advB ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 font-bold' : 'text-gray-500';

                html += `<div class="grid grid-cols-3 gap-2 items-center text-xs py-1 border-b dark:border-gray-700 last:border-0">
                    <div class="text-right ${bgA} px-1 rounded">${rA.text}</div>
                    <div class="text-center flex items-center justify-center gap-1 opacity-70"><img src="${getLogo(opp)}" class="w-4 h-4 object-contain" title="${opp}"></div>
                    <div class="text-left ${bgB} px-1 rounded">${rB.text}</div>
                </div>`;
            });
            container.innerHTML = html;
        }

        // v2.17 : Face-à-Face « joueurs clés » — meilleur pointeur et gardien n°1 de chaque équipe côte à côte,
        // + « qui nous fait mal » (buteurs adverses contre Valence, issus des matchs suivis en direct). Zéro invention.
        async function renderH2HKeys(tA, tB) {
            const host = document.getElementById('h2h-keys');
            if (!host) return;
            try {
                let st = null;
                try { st = await livePlayerStats(); } catch (e) {}
                const side = (team) => {
                    const out = { name: '', pts: '', sub: '', badge: '', gkTxt: '' };
                    const lp = (leaguePlayers || []).filter(x => x.season === activeSeason && normalize(String(x.team || '')) === normalize(team));
                    const byPts = [...lp].sort((a, b) => (Number(b.pts) || 0) - (Number(a.pts) || 0));
                    if (byPts.length) {
                        out.name = byPts[0].name; out.pts = (Number(byPts[0].pts) || 0) + ' pts';
                        out.sub = `${byPts[0].goals} B + ${byPts[0].assists} A` + (byPts[0].mj ? ` · ${(Number(byPts[0].pts) / Number(byPts[0].mj)).toFixed(2).replace('.', ',')}/match` : '');
                        out.badge = leagueBadgeOf(byPts[0].name);
                    } else if (st) {
                        const cand = [...st.byName.values()].filter(r => [...r.teams].some(x => normalize(x) === normalize(team))).sort((a, b) => (b.g + b.a) - (a.g + a.a));
                        if (cand.length) { out.name = cand[0].name; out.pts = (cand[0].g + cand[0].a) + ' pts'; out.sub = `sur ${cand[0].games} match(s) suivi(s)`; }
                    }
                    let gk = (leagueGoalies || []).filter(x => x.season === activeSeason && normalize(String(x.team || '')) === normalize(team)).sort((a, b) => (Number(b.pct) || 0) - (Number(a.pct) || 0))[0] || null;
                    if (!gk && normalize(team).includes('valence')) gk = [...(goalies || [])].filter(x => x.season === activeSeason).sort((a, b) => (Number(b.pct) || 0) - (Number(a.pct) || 0))[0] || null;
                    if (gk) out.gkTxt = `🧤 ${gk.name} — ${(typeof gk.pct === 'number' && isFinite(gk.pct)) ? gk.pct.toFixed(2).replace('.', ',') + "% d'arrêts" : '?'}${gk.blan ? ` · ${gk.blan} blanchissage(s)` : ''}`;
                    return out;
                };
                const sA = side(tA), sB = side(tB);
                const cell = (team, s) => `<div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3"><div class="text-[10px] uppercase font-bold text-gray-400 mb-2">${team}</div>${s.name ? `<div class="font-black">${s.name}${s.badge}</div><div class="text-sm">${s.pts} <span class="text-gray-400">${s.sub}</span></div>` : '<div class="text-xs text-gray-400 italic">Aucun pointeur connu en base pour cette équipe</div>'}${s.gkTxt ? `<div class="text-xs mt-2">${s.gkTxt}</div>` : ''}</div>`;
                let html = `<div class="mt-6"><h4 class="font-bold uppercase text-xs tracking-widest text-gray-500 mb-3 border-b pb-2 dark:border-gray-700">⚔️ Joueurs clés</h4><div class="grid grid-cols-1 md:grid-cols-2 gap-3">${cell(tA, sA)}${cell(tB, sB)}</div>`;
                if (st && st.reps) {
                    const hurt = [...st.byName.values()].filter(r => ![...r.teams].some(x => normalize(x).includes('valence')) && r.g > 0).sort((a, b) => b.g - a.g || b.a - a.a).slice(0, 5);
                    if (hurt.length) html += `<div class="mt-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-3"><div class="text-[10px] uppercase font-bold text-gray-400 mb-2">😈 Qui nous fait mal — buteurs adverses contre Valence (${st.reps} match(s) suivi(s) en direct)</div>${hurt.map(r => `<div class="text-sm py-0.5 flex justify-between items-center"><span class="cursor-pointer font-semibold hurt-player underline decoration-dotted" data-name="${r.name}" data-team="${[...r.teams][0] || ''}">${r.name} <span class="text-xs text-gray-400">${[...r.teams][0] || ''}</span></span><strong>${r.g} but(s)${r.a ? ` · ${r.a} assist(s)` : ''}</strong></div>`).join('')}</div>`;
                }
                // v2.18 : scouting auto — effectifs adverses récoltés sur les matchs suivis en direct (collection « scout »)
                const scCell = (team) => {
                    const sc = scoutDocs[normalize(team)];
                    if (!sc) return '';
                    const sk = Object.values(sc.skaters || {}).filter(x => x && x.name);
                    const gks = Object.values(sc.goalies || {}).filter(x => x && x.name);
                    if (!sk.length && !gks.length) return '';
                    const maxSeen = sk.length ? Math.max(...sk.map(x => Number(x.seen) || 0)) : 0;
                    const top = [...sk].sort((a, b) => (Number(b.g) || 0) - (Number(a.g) || 0)).slice(0, 3).filter(x => Number(x.g) > 0);
                    const gkTxt = gks.slice(0, 2).map(g2 => `🧤 ${xmlEsc(g2.name)}${g2.shots > 0 ? ' — ' + Math.round(100 * (g2.saves || 0) / g2.shots) + ' % d\'arrêts (' + g2.shots + ' tirs reçus)' : ''}`).join('<br>');
                    return `<div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3"><div class="text-[10px] uppercase font-bold text-gray-400 mb-2">${xmlEsc(team)} — vu en direct</div>` +
                        `<div class="text-xs font-semibold">${sk.length} joueur(s) aligné(s) repéré(s)${maxSeen ? ' sur ' + maxSeen + ' match(s) suivi(s)' : ''}${sc.updatedAt ? ' · dernier le ' + new Date(sc.updatedAt).toLocaleDateString('fr-FR') : ''}</div>` +
                        (top.length ? `<div class="text-xs mt-1">🎯 Buteurs repérés : ${top.map(x => xmlEsc(x.name) + ' (' + x.g + ')').join(', ')}</div>` : '') +
                        (gkTxt ? `<div class="text-xs mt-1">${gkTxt}</div>` : '') + `</div>`;
                };
                const sc1 = scCell(tA), sc2 = scCell(tB);
                if (sc1 || sc2) html += `<div class="mt-3"><div class="text-[10px] uppercase font-bold text-gray-400 mb-2">🔎 Scouting auto (effectifs repérés sur les matchs suivis en direct)</div><div class="grid grid-cols-1 md:grid-cols-2 gap-3">${sc1}${sc2}</div></div>`;
                html += '</div>';
                host.innerHTML = html;
                host.querySelectorAll('.hurt-player').forEach(n => n.onclick = () => { try { openPlayerModal({ name: n.dataset.name || '', team: n.dataset.team || '' }, false); } catch (e) {} });
            } catch (e) { console.warn('renderH2HKeys', e); host.innerHTML = ''; }
        }

        function getComparisonHTML(tA, tB, filterType = 'season') {
             const scopeMatches = filterType === 'all' ? allMatches : allMatches.filter(m => m.season === activeSeason);
             const finishedScope = scopeMatches.filter(m => isMatchFinished(m));
             const h2hMatches = finishedScope.filter(m => (m.homeTeam === tA && m.awayTeam === tB) || (m.homeTeam === tB && m.awayTeam === tA));
             
             let wA=0, wB=0, dr=0; 
             h2hMatches.forEach(m => { const scA = m.homeTeam === tA ? m.scoreHome : m.scoreAway; const scB = m.homeTeam === tA ? m.scoreAway : m.scoreHome; if(scA > scB) wA++; else if(scB > scA) wB++; else dr++; });
             
             const htmlHeader = `
                <div class="grid grid-cols-3 gap-2 items-center mb-6">
                     <div class="flex flex-col items-center"><img src="${getLogo(tA)}" class="w-16 h-16 md:w-20 md:h-20 object-contain"><h3 class="font-black text-center text-sm md:text-lg">${tA}</h3></div>
                     <div class="flex flex-col items-center"><div class="text-2xl md:text-3xl font-black text-gray-400">VS</div><div class="text-[10px] uppercase font-bold text-gray-500 mt-1">H2H (${filterType === 'all' ? 'Total' : 'Saison'}): <span class="text-blue-500">${wA}</span> - <span class="text-gray-400">${dr}</span> - <span class="text-red-500">${wB}</span></div></div>
                     <div class="flex flex-col items-center"><img src="${getLogo(tB)}" class="w-16 h-16 md:w-20 md:h-20 object-contain"><h3 class="font-black text-center text-sm md:text-lg">${tB}</h3></div>
                </div>`;
            
             const htmlHistory = `
                <div class="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border dark:border-gray-700">
                    <h4 class="font-bold text-center mb-2 uppercase text-xs tracking-widest text-gray-500">Historique Complet (${filterType === 'all' ? 'Global' : 'Saison'})</h4>
                    <div class="space-y-1 max-h-60 overflow-y-auto text-xs">
                        ${h2hMatches.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(m => {
                            const w = (m.homeTeam === tA && m.scoreHome > m.scoreAway) || (m.homeTeam === tB && m.scoreAway > m.scoreHome);
                            return `<div class="flex justify-between p-2 rounded ${w?'bg-blue-50 dark:bg-blue-900/20':'bg-red-50 dark:bg-red-900/20'} border-b dark:border-gray-700"><span class="text-gray-500">${new Date(m.date).toLocaleDateString()}</span><span class="font-bold text-gray-800 dark:text-gray-200">${m.scoreHome}-${m.scoreAway}</span></div>`;
                        }).join('') || '<div class="text-center italic text-gray-400">Aucun match</div>'}
                    </div>
                </div>`;
                
             return htmlHeader + htmlHistory;
        }

        // --- GLOSSARY RENDERER (NEW: Uses Firestore Data) ---
        function renderGlossary(filter = 'all', search = '') {
            const grid = document.getElementById('glossary-grid');
            if(!grid) return;
            
            // Merge defaults with DB items
            const fullGlossary = [...glossaryData, ...dbGlossary];
            
            // Deduplicate by term name (prefer DB version if duplicate)
            const uniqueGlossary = [];
            const map = new Map();
            // Process DB first so they are in map
            dbGlossary.forEach(item => map.set(normalize(item.term), item));
            // Process defaults, only add if not present
            glossaryData.forEach(item => {
                if(!map.has(normalize(item.term))) map.set(normalize(item.term), item);
            });
            
            const finalList = Array.from(map.values()).sort((a,b) => a.term.localeCompare(b.term));

            const filtered = finalList.filter(item => {
                const matchesFilter = filter === 'all' || item.type === filter;
                const matchesSearch = item.term.toLowerCase().includes(search.toLowerCase()) || item.def.toLowerCase().includes(search.toLowerCase());
                return matchesFilter && matchesSearch;
            });

            if(filtered.length === 0) {
                grid.innerHTML = `<div class="col-span-full text-center text-gray-400 italic py-8">Aucun terme trouvé.</div>`;
                return;
            }

            const getTypeColor = (t) => {
                if(t === 'regle') return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
                if(t === 'penalite') return 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400';
                if(t === 'stat') return 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400';
                if(t === 'geste') return 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400';
                return 'bg-gray-100 text-gray-600';
            };

            grid.innerHTML = filtered.map(item => `
                <div class="glossary-card group relative flex flex-col h-full overflow-hidden">
                    ${item.imageUrl ? 
                        `<div class="w-full h-32 mb-3 bg-white rounded-lg flex items-center justify-center relative border border-gray-100 dark:border-gray-700">
                            <img src="${item.imageUrl}" class="h-full object-contain" alt="${item.term}">
                            ${item.type === 'geste' && item.movement ? 
                                `<div class="absolute inset-0 bg-black/90 flex items-center justify-center p-4 text-white text-xs text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none group-active:opacity-100 select-none">
                                    ${item.movement}
                                 </div>` 
                            : ''}
                         </div>` 
                        : 
                        `<div class="flex justify-between items-start mb-2">
                            <div class="glossary-icon ${getTypeColor(item.type)}">${item.icon}</div>
                        </div>`
                    }
                    <div class="mb-1">
                        <span class="text-[10px] uppercase font-bold px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">${item.type}</span>
                    </div>
                    <h4 class="font-bold text-lg mb-2 group-hover:text-lynx-red transition-colors">${item.term}</h4>
                    <p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-4">${item.def.replace('**Mouvement:**', '').substring(0, 150)}${item.def.length>150?'...':''}</p>
                </div>
            `).join('');
        }
        
        // --- NEW: Render Admin Glossary List ---
        function renderAdminGlossaryList() {
             const list = document.getElementById('admin-glossary-list');
             if(!dbGlossary.length) { list.innerHTML = '<div class="text-xs text-gray-400 italic">Aucun terme personnalisé ajouté.</div>'; return; }
             
             list.innerHTML = dbGlossary.map(item => `
                <div class="flex justify-between items-center bg-white dark:bg-gray-700 p-2 rounded text-sm shadow-sm border-l-4 ${item.type === 'penalite' ? 'border-red-500' : (item.type === 'regle' ? 'border-blue-500' : 'border-yellow-500')}">
                    <div class="truncate flex-1">
                        <span class="font-bold">${item.term}</span> <span class="text-xs text-gray-400 ml-1">(${item.type})</span>
                        <div class="text-[10px] text-gray-500 truncate">${item.def}</div>
                    </div>
                    <button class="delete-glossary-btn text-red-500 hover:text-red-700 ml-2" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button>
                </div>
             `).join('');
             
             document.querySelectorAll('.delete-glossary-btn').forEach(b => {
                 b.onclick = () => {
                     appConfirm('Supprimer ce terme ?', async () => {
                         await deleteDoc(doc(db, `${basePath}/glossary/${b.dataset.id}`));
                     });
                 };
             });
        }

        // --- NEW FEATURE: ANALYSE DE SENTIMENT ---
        function renderMorale(matches) {
            const container = document.getElementById('morale-container');
            if(!container) return;
            const valMatches = matches.filter(m => (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence')) && isMatchFinished(m)).sort((a,b) => new Date(a.date) - new Date(b.date)).slice(-5);
            
            if(valMatches.length === 0) { container.innerHTML = ''; return; }
            
            let score = 50;
            let goalsDiff = 0;
            valMatches.forEach(m => {
                const isHome = normalize(m.homeTeam).includes('valence');
                const scored = isHome ? m.scoreHome : m.scoreAway;
                const conceded = isHome ? m.scoreAway : m.scoreHome;
                goalsDiff += (scored - conceded);
                if(scored > conceded) score += m.isProl ? 8 : 15;
                else if(scored < conceded) score -= m.isProl ? 5 : 15;
            });
            score += (goalsDiff * 1.5); // Bonus/Malus goal diff
            score = Math.max(0, Math.min(100, score)); // Clamp 0-100
            
            let text = "Neutre", icon = "😐", colorBg = "bg-gray-500", colorBorder = "border-gray-500";
            if(score >= 80) { text = "En Feu"; icon = "🔥"; colorBg = "bg-red-500"; colorBorder = "border-red-500"; }
            else if(score >= 60) { text = "En Confiance"; icon = "💪"; colorBg = "bg-green-500"; colorBorder = "border-green-500"; }
            else if(score <= 20) { text = "En Crise"; icon = "🥶"; colorBg = "bg-blue-600"; colorBorder = "border-blue-600"; }
            else if(score <= 40) { text = "Dans le Dur"; icon = "🌧️"; colorBg = "bg-orange-500"; colorBorder = "border-orange-500"; }
            
            container.innerHTML = `
                <div class="flex items-center justify-between p-4 bg-white/70 dark:bg-dark-card/70 backdrop-blur-lg rounded-xl shadow-xl border-l-4 ${colorBorder}">
                    <div>
                        <div class="text-[10px] uppercase font-bold text-gray-500">Météo de l'Équipe</div>
                        <div class="font-black text-xl md:text-2xl flex items-center gap-2">${icon} ${text}</div>
                    </div>
                    <div class="w-1/2">
                        <div class="flex justify-between text-[10px] font-bold mb-1"><span>Moral</span><span>${Math.round(score)}%</span></div>
                        <div class="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner">
                            <div class="h-full transition-all duration-1000 ${colorBg}" style="width: ${score}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }

        // --- NEW FEATURE: MAGIC NUMBER ---
        function renderMagicNumber(ranking, spots) {
            const container = document.getElementById('magic-number-container');
            if(!container || ranking.length === 0) return;
            
            const valence = ranking.find(t => normalize(t.team).includes('valence'));
            if(!valence) { container.classList.add('hidden'); return; }
            
            const totalTeams = ranking.length;
            const expectedTotalGames = (totalTeams - 1) * 2; // Matchs aller/retour
            
            const playoffSpot = (typeof spots === 'number' && spots > 0) ? spots : (getFormat(activeSeason).playoffSpots || 8); // Top N playoffs
            if(totalTeams <= playoffSpot) { container.classList.add('hidden'); return; }
            
            const sortedRank = [...ranking].sort((a,b) => b.pts - a.pts);
            const cutoffTeam = sortedRank[playoffSpot]; // première équipe hors zone playoffs (la 13e en D1 2026-2027)
            
            if(!cutoffTeam) return;
            
            const maxPointsCutoff = cutoffTeam.pts + ((expectedTotalGames - cutoffTeam.mj) * 3);
            const magicNumber = maxPointsCutoff - valence.pts + 1;
            
            container.classList.remove('hidden');
            // --- Zone de maintien : points nécessaires pour être sûr de rester ---
            const mtSpots = getFormat(activeSeason).maintienSpots || 0;
            let maintienContent = '';
            let mtSpotsRel = 0;
            if (mtSpots > 0 && totalTeams > mtSpots) {
                const firstReleg = sortedRank[totalTeams - mtSpots]; // première équipe reléguable
                mtSpotsRel = mtSpots;
                if (firstReleg) {
                    const safeNum = firstReleg.pts + ((expectedTotalGames - firstReleg.mj) * 3) - valence.pts + 1;
                    maintienContent = safeNum <= 0
                        ? `<div class="text-green-500 font-black flex flex-col items-center gap-1 text-center text-sm border-t border-gray-200 dark:border-gray-700 pt-2 w-full"><i class="fa-solid fa-shield-halved"></i><span>Maintien Assuré !</span></div>`
                        : `<div class="text-center border-t border-gray-200 dark:border-gray-700 pt-2 w-full"><div class="text-2xl font-black text-red-500">${safeNum}</div><div class="text-[10px] uppercase font-bold text-gray-500 mt-1">pts pour être sûr de rester (hors poule de maintien)</div></div>`;
                }
            }
            let content = '';
            if(magicNumber <= 0) {
                content = `<div class="text-green-500 font-black flex flex-col items-center gap-1 text-center"><i class="fa-solid fa-check-circle text-2xl"></i><span>Playoffs Assurés !</span></div>`;
            } else {
                content = `
                    <div class="text-center">
                        <div class="text-4xl font-black text-lynx-red drop-shadow-sm">${magicNumber}</div>
                        <div class="text-[10px] uppercase font-bold text-gray-500 mt-1">Pts manquants pour les playoffs</div>
                    </div>
                `;
            }
            
            container.innerHTML = `
                <div class="bg-white/70 dark:bg-dark-card/70 p-4 rounded-xl shadow-xl flex flex-col items-center justify-center border-t-4 border-yellow-500 h-full">
                    <h3 class="text-sm font-bold uppercase tracking-widest text-gray-500 mb-1 w-full text-center border-b pb-2 dark:border-gray-700"><i class="fa-solid fa-calculator text-yellow-500 mr-1"></i> Magic Number</h3>
                    <div class="flex-1 flex items-center justify-center w-full my-2 flex-col gap-3">
                        ${content}
                        ${maintienContent}
                    </div>
                    <p class="text-[9px] text-gray-400 font-bold uppercase text-center w-full">Objectif: Top ${playoffSpot} (${seasonHasPoules(activeSeason) ? 'Poule' : 'Championnat'})${mtSpots > 0 ? ' &bull; Finir devant les ' + mtSpotsRel + ' dernières' : ''}</p>
                </div>
            `;
        }

        // --- NEW FEATURE: GRAPHIQUE PERFORMANCE ---
        function renderPerformanceChart(matches) {
            const container = document.getElementById('performance-chart-container');
            if(!container) return;
            
            const valMatches = matches.filter(m => (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence')) && isMatchFinished(m)).sort((a,b) => new Date(a.date) - new Date(b.date)).slice(-10);
            
            if(valMatches.length === 0) { container.innerHTML = '<div class="text-center text-xs text-gray-400 p-4">Pas assez de données pour le graphique.</div>'; return; }
            
            const width = 500; const height = 160; const pad = 20;
            const xStep = (width - 2*pad) / Math.max(valMatches.length, 1);
            
            const maxGoals = Math.max(...valMatches.map(m => Math.max(m.scoreHome, m.scoreAway)), 5);
            const yScale = (height - 2*pad) / maxGoals;
            
            let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
                 <!-- Lignes de Grille -->
                 ${[0, 0.5, 1].map(p => {
                     const y = height - pad - (p * maxGoals * yScale);
                     return `<line x1="${pad}" y1="${y}" x2="${width-pad}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4" />
                             <text x="${pad-5}" y="${y+4}" font-size="10" text-anchor="end" fill="gray">${Math.round(p*maxGoals)}</text>`;
                 }).join('')}
            `;
            
            valMatches.forEach((m, i) => {
                const isHome = normalize(m.homeTeam).includes('valence');
                const bp = isHome ? m.scoreHome : m.scoreAway;
                const bc = isHome ? m.scoreAway : m.scoreHome;
                
                const x = pad + (i * xStep) + (xStep/2);
                const hBp = bp * yScale;
                const hBc = bc * yScale;
                
                // Dessin des barres
                const barW = 12;
                svg += `
                    <rect x="${x - barW - 1}" y="${height - pad - hBp}" width="${barW}" height="${hBp}" fill="#22C55E" rx="2">
                        <title>${new Date(m.date).toLocaleDateString()}: Buts Pour (${bp})</title>
                    </rect>
                    <rect x="${x + 1}" y="${height - pad - hBc}" width="${barW}" height="${hBc}" fill="#EF4444" rx="2">
                         <title>${new Date(m.date).toLocaleDateString()}: Buts Contre (${bc})</title>
                    </rect>
                    <text x="${x}" y="${height - pad + 15}" font-size="9" font-weight="bold" text-anchor="middle" fill="gray">M${i+1}</text>
                `;
            });
            
            // Légende
            svg += `
                <rect x="${width-180}" y="5" width="10" height="10" fill="#22C55E" rx="2" />
                <text x="${width-165}" y="14" font-size="10" fill="gray" font-weight="bold">Buts Pour (BP)</text>
                <rect x="${width-80}" y="5" width="10" height="10" fill="#EF4444" rx="2" />
                <text x="${width-65}" y="14" font-size="10" fill="gray" font-weight="bold">Buts Contre (BC)</text>
            </svg>`;
            
            container.innerHTML = svg;
        }

        function updateUI() {
            updateSeasonSelector();
            const fmt = getFormat(activeSeason);
            const hasPoules = seasonHasPoules(activeSeason);
            const sMatches = allMatches.filter(m => m.season === activeSeason);
            const lynxMatches = sMatches.filter(m => normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence')).sort((a,b)=>new Date(a.date)-new Date(b.date));
            const done = lynxMatches.filter(m => isMatchFinished(m));
            const next = lynxMatches.filter(m => !isMatchFinished(m) && new Date(m.date) >= new Date(new Date().setHours(0,0,0,0)));
            const lastFinishedAny = sMatches.filter(m => isMatchFinished(m) && (normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence'))).sort((a,b)=>new Date(b.date)-new Date(a.date))[0];

            let computedRankingA, computedRankingB;
            if (hasPoules) {
                // D2 : classements distincts par poule
                computedRankingB = computeLiveRanking(activeSeason, 'B', rankingB.filter(r => r.season === activeSeason));
                computedRankingA = computeLiveRanking(activeSeason, 'A', rankingA.filter(r => r.season === activeSeason));
            } else {
                // D1 : classement unique — UNE SEULE requête (sinon chaque équipe serait comptée/doublée)
                computedRankingA = computeLiveRanking(activeSeason, 'A', [...rankingA, ...rankingB].filter(r => r.season === activeSeason));
                computedRankingB = [];
            }
            // Classement principal : Poule B si poules (D2), sinon classement général (D1)
            const mainRanking = hasPoules ? computedRankingB : computedRankingA;

            // Titres dynamiques
            const homeRankTitle = document.getElementById('home-ranking-title');
            if(homeRankTitle) homeRankTitle.innerHTML = hasPoules ? '<i class="fa-solid fa-list-ol mr-2 text-lynx-red"></i> Classement B' : '<i class="fa-solid fa-list-ol mr-2 text-lynx-red"></i> Classement ' + (fmt.division || 'D1');
            const homeExtTitle = document.getElementById('home-extremes-title');
            if(homeExtTitle) homeExtTitle.textContent = hasPoules ? 'Les Extrêmes (Poule B)' : 'Les Extrêmes (Championnat)';

            renderMatchCard(lastFinishedAny, 'latest-result-content', true);
            enrichLatestResult(lastFinishedAny); // v2.19 : verdict + tiers + buteurs + joueur du match si le match a été suivi en direct
            // v2.18 : jauge bookmakers — cotes saisies en Admin (probabilité implicite, marge du bookmaker retirée) vs probabilité du modèle
            oddsNextHtmlForCard = '';
            try {
                if (oddsNext && next.length && Number(oddsNext.cH) > 1 && Number(oddsNext.cN) > 1 && Number(oddsNext.cA) > 1) {
                    const m0 = next[0];
                    const poulesOd = seasonHasPoules(activeSeason);
                    const gOd = poulesOd ? (m0.poule || 'B').toUpperCase() : '';
                    const playedOd = sMatches.filter(x => (!x.type || x.type === 'Saison') && (!poulesOd || (x.poule || 'B').toUpperCase() === gOd) && isMatchFinished(x));
                    const impH = 1 / Number(oddsNext.cH), impN = 1 / Number(oddsNext.cN), impA = 1 / Number(oddsNext.cA);
                    const impTot = impH + impN + impA;
                    const bookH = Math.round(100 * impH / impTot), bookN = Math.round(100 * impN / impTot), bookA = 100 - bookH - bookN;
                    let modH = null, modN = null, modA = null;
                    if (playedOd.length >= 3) { const modelOd = buildPoolModel(playedOd); const pOd = predictMatch(modelOd, m0.homeTeam, m0.awayTeam, new Date(m0.date).getTime()); modH = Math.round(pOd.pHomeWin * 100); modN = Math.round(pOd.pT * 100); modA = Math.round(pOd.pAwayWin * 100); }
                    const modTxt = (b, m) => m !== null ? ` (modèle : ${m} %${Math.abs(m - b) >= 10 ? (m > b ? ' — le modèle est plus confiant' : ' — le modèle est plus prudent') : ''})` : '';
                    oddsNextHtmlForCard = `<div class="mt-1 text-[10px] font-bold text-gray-500 dark:text-gray-300 leading-relaxed" title="Probabilité implicite des cotes (marge du bookmaker retirée) comparée à la probabilité calculée par le modèle du site — ce n'est pas un second pronostic">💸 Bookmakers : ${xmlEsc(m0.homeTeam)} ${bookH} %${modTxt(bookH, modH)} · nul ${bookN} %${modTxt(bookN, modN)} · ${xmlEsc(m0.awayTeam)} ${bookA} %${modTxt(bookA, modA)}</div>`;
                }
            } catch (e) {}
            renderMatchCard(next.length ? next[0] : null, 'upcoming-match-content', false, mainRanking);
            try { renderGoalsMarket(next.length ? next[0] : null); } catch (e) {} // v2.21 : buts attendus / +5,5 / les deux marquent
            // v2.18 : pronostic buteur — calcule le buteur pressenti puis re-rend la carte du prochain match
            refreshScorerPick(activeSeason).then((pick) => { if (pick) { renderMatchCard(next.length ? next[0] : null, 'upcoming-match-content', false, mainRanking); try { renderGoalsMarket(next.length ? next[0] : null); } catch (e) {} } }).catch(() => {});
            
            // --- NEW: Update Ask Bot Button ---
            const btnAsk = document.getElementById('btn-ask-bot-h2h');
            if(btnAsk) {
                if(next.length > 0) {
                    btnAsk.classList.remove('hidden');
                    btnAsk.onclick = () => {
                        toggleModal('bot-modal', true);
                        const match = next[0];
                        const query = `Fais-moi une analyse détaillée du face-à-face pour le match ${match.homeTeam} contre ${match.awayTeam}.`;
                        const input = document.getElementById('user-input');
                        input.value = query;
                        // Trigger submit programmatically
                        document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true }));
                    };
                } else {
                    btnAsk.classList.add('hidden');
                }
            }
            // ----------------------------------

            renderRanking(mainRanking, 'ranking-table-body-home', -5); // v2.20 : fenêtre de 5 équipes autour des Lynx (positions réelles)
            renderHomeExtremes(mainRanking);
            try { renderTitles(); } catch (e) {}
            renderForm(done);
            renderHomeRivals(mainRanking);
            renderHomeScenarios(mainRanking, sMatches); // v2.21 : scénarios des concurrents
            try { renderLiveSeasonStats(); } catch (e) {} // v2.22 : stats live de saison + points mérités + fiche adverse
            try { renderHomeQuiz(); } catch (e) {} // v2.22-b : quiz du jour
            try { renderHomeDna(); } catch (e) {} // v2.22-b : ADN offensif
            try { renderExtremesLive(); } catch (e) {}
try { document.getElementById('home-titles').innerHTML = document.getElementById('league-extremes-body') ? document.getElementById('league-extremes-body').innerHTML : '<div class="text-center p-2">Chargement...</div>'; } catch(e) {} // v2.22-b : titres de la saison
            try { renderAllTeams(); } catch (e) {} // v2.22-b : tableau toutes les équipes
            window.__homeCtx = { ranking: mainRanking, sm: sMatches }; setTimeout(() => { try { renderLiveStandings(mainRanking, sMatches); } catch (e) {} }, 900); // v2.21 : classement vivant
            renderSeriesRecords(sMatches, mainRanking);
            setTimeout(() => { try { updateHomeForecast(); } catch (e) {} }, 400); // v2.21 : proba playoffs + courbe de fiabilité (après peinture, moteur en cache)
            renderMatchDay(next, sMatches, mainRanking);
            renderLynxCal(lynxMatches);
            renderFullCal(sMatches); 
            renderRankingGlobal(computedRankingA, computedRankingB);
            
            // NEW CALLS
            renderMorale(sMatches);
            renderMagicNumber(mainRanking, fmt.playoffSpots);
            renderPerformanceChart(sMatches);

            // Render Evolution Chart (+ projections prévisionnelles)
            let forecast = null;
            try { forecast = getForecast(activeSeason); } catch(e) { console.warn('Forecast indisponible', e); }
            renderEvolutionChart(sMatches.filter(m=>isMatchFinished(m)), [...computedRankingA, ...computedRankingB], forecast);
            renderForecasts(forecast);

            const sRoster = roster.filter(p=>p.season===activeSeason).sort((a,b)=>((b.goals||0)+(b.assists||0))-((a.goals||0)+(a.assists||0)));
            renderRoster(sRoster);
            renderGoalies(goalies.filter(g=>g.season===activeSeason));
            renderLeaders(sRoster);
            // updateStatsUI(); REMOVED
            updateComparatorSelects();
            updatePlayerComparatorSelects(); 
            renderLeagueLeaders();
            renderLeagueGoalies();
            renderUsefulLinks();
            renderNews(); 
            renderAdminNews(); 
            renderAdminContext();
            renderAdminBotHistory(); 
            renderHomeBotCard(); // UPDATED FUNCTION CALL
            renderChampionBanner();
            renderGlossary(); // INITIAL RENDER
            renderAdminGlossaryList(); // NEW
            renderRssSection();
            renderRssAdmin();
            renderCharts();
            renderMaintien(sMatches);
            
            
            // Auto-set Comparator to next match
            if(next.length && document.getElementById('comp-team-a').value === '') {
                setTimeout(() => {
                    document.getElementById('comp-team-a').value = next[0].homeTeam;
                    document.getElementById('comp-team-b').value = next[0].awayTeam;
                    runComparison();
                }, 500);
            }
            
            const dzSeasonDisplay = document.getElementById('danger-zone-season-display');
            if(dzSeasonDisplay) dzSeasonDisplay.textContent = activeSeason;

            const bg = document.getElementById('dynamic-background');
            if(bg) {
                if(next.length) { bg.style.backgroundImage = `url('${getLogo(next[0].homeTeam)}'), url('${getLogo(next[0].awayTeam)}')`; bg.className = "fixed inset-0 transition-all duration-1000 ease-in-out split-bg"; } 
                else { bg.style.backgroundImage = `url('${getLogo("Valence")}')`; bg.className = "fixed inset-0 transition-all duration-1000 ease-in-out single-bg"; }
            }
            
            // Admin Settings Fill
            document.getElementById('bot-tone').value = botSettings.tone || 'fan';
            document.getElementById('bot-persona').value = botSettings.persona || '';

            // Admin Format de saison Fill
            const fmtDisp = document.getElementById('fmt-season-display');
            if(fmtDisp) fmtDisp.textContent = `${activeSeason} : ${hasPoules ? 'D2 (poules A/B)' : (fmt.division || 'D1') + ' (poule unique de 16)'} — Playoffs : top ${fmt.playoffSpots || 8}${(fmt.maintienSpots || 0) > 0 ? ' — Zone de maintien : ' + (fmt.maintienSpots) + ' dernières places' : ' — aucun maintien'}`;
            const fmtDatesEl = document.getElementById('fmt-season-dates');
            if(fmtDatesEl) fmtDatesEl.textContent = fmt.dates ? `Saison régulière : ${fmtPhaseShort(fmt.dates.regular)} · Playoffs : ${fmtPhaseShort(fmt.dates.playoffs)} · Maintien : ${fmtPhaseShort(fmt.dates.maintien)}` : 'Dates des phases : inconnues — colle le règlement FFHG ci-dessous pour les enregistrer.';
            const fmtSel = document.getElementById('season-format-select');
            if(fmtSel) fmtSel.value = seasonFormats[activeSeason] ? seasonFormats[activeSeason].division : 'auto';
            const fmtSpots = document.getElementById('season-playoff-spots');
            if(fmtSpots) fmtSpots.value = String(fmt.playoffSpots || 8);
            const fmtMt = document.getElementById('season-maintien-spots');
            if(fmtMt) fmtMt.value = String(fmt.maintienSpots || 0);
        }

        // --- NEW: Goalies Logic ---
        // v2.22 : si aucun gardien n'est importé (CSV vide pour la saison), la feuille se remplit en AUTO
        // depuis les matchs archivés (flux FFHG) ; si un import existe, il reste la source affichée.
        async function renderGoalies(list) {
            const body = document.getElementById('roster-table-body-goalies');
            if (!list.length) {
                let auto = [];
                try { auto = [...(await liveGoalieStats()).values()].filter(g => g && g.mje > 0).sort((a, b) => b.mje - a.mje); } catch (e) {}
                if (!auto.length) { body.innerHTML = '<tr><td colspan="13" class="p-4 text-center text-gray-400 italic">Aucun gardien importé pour cette saison (Admin → Import FFHG → « Stats gardiens »). Les stats auto apparaîtront dès qu\'un match est archivé.</td></tr>'; return; }
                body.innerHTML = '<tr class="text-xs text-gray-400 uppercase"><td colspan="13" class="p-2 pl-3">🎬 Depuis les matchs archivés (auto)</td></tr>' + auto.map(g => `
                <tr class="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer goalie-row" data-name="${g.name}">
                    <td class="p-3 font-bold">#</td>
                    <td class="p-3 font-bold sticky left-0 bg-white dark:bg-dark-card z-10 shadow-sm md:shadow-none">${playerPhotoOf(g.name) ? `<img src="${playerPhotoOf(g.name)}" alt="" class="w-7 h-7 rounded-full object-cover inline-block align-middle mr-1 border border-gray-300 dark:border-gray-600">` : ''}${g.name}</td>
                    <td class="p-3 text-center text-gray-500">${g.mje}</td>
                    <td class="p-3 text-center text-gray-500">${g.mje}</td>
                    <td class="p-3 text-center text-xs font-mono">${g.mje * 60}</td>
                    <td class="p-3 text-center font-bold text-green-600">${g.v}</td>
                    <td class="p-3 text-center text-orange-500">${g.dprl}</td>
                    <td class="p-3 text-center text-red-500">${g.d}</td>
                    <td class="p-3 text-center font-bold text-blue-500">${g.blan}</td>
                    <td class="p-3 text-center text-gray-500">${g.bc}</td>
                    <td class="p-3 text-center font-bold">${g.mje ? (g.bc / g.mje).toFixed(2).replace('.', ',') : '-'}</td>
                    <td class="p-3 text-center text-gray-500">${g.shots - g.bc}</td>
                    <td class="p-3 text-center font-black">${g.shots ? (100 * (g.shots - g.bc) / g.shots).toFixed(2).replace('.', ',') : '-'}%</td>
                </tr>`).join('');
                document.querySelectorAll('.goalie-row').forEach(r => r.onclick = () => { const g = auto.find(x => x.name === r.dataset.name); if (g) { g.isGoalie = true; openPlayerModal(Object.assign({ goals: 0, assists: 0, penalties: 0 }, g), true); } });
                return;
            }
            document.getElementById('roster-table-body-goalies').innerHTML = list.map(g => `
                <tr class="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer goalie-row" data-id="${g.id||''}">
                    <td class="p-3 font-bold">${g.number||'#'}</td>
                    <td class="p-3 font-bold sticky left-0 bg-white dark:bg-dark-card z-10 shadow-sm md:shadow-none">${playerPhotoOf(g.name) ? `<img src="${playerPhotoOf(g.name)}" alt="" class="w-7 h-7 rounded-full object-cover inline-block align-middle mr-1 border border-gray-300 dark:border-gray-600">` : ''}${g.name}</td>
                    <td class="p-3 text-center text-gray-500">${g.mj||0}</td>
                    <td class="p-3 text-center text-gray-500">${g.mje||0}</td>
                    <td class="p-3 text-center text-xs font-mono">${g.min||'-'}</td>
                    <td class="p-3 text-center font-bold text-green-600">${g.v||0}</td>
                    <td class="p-3 text-center text-orange-500">${g.dprl||0}</td>
                    <td class="p-3 text-center text-red-500">${g.d||0}</td>
                    <td class="p-3 text-center font-bold text-blue-500">${g.blan||0}</td>
                    <td class="p-3 text-center text-gray-500">${g.bc||0}</td>
                    <td class="p-3 text-center font-bold">${(typeof g.moy === 'number' && isFinite(g.moy)) ? g.moy.toFixed(2).replace('.', ',') : '-'}</td>
                    <td class="p-3 text-center text-gray-500">${g.arr||0}</td>
                    <td class="p-3 text-center font-black">${(typeof g.pct === 'number' && isFinite(g.pct)) ? g.pct.toFixed(2).replace('.', ',') : '-'}%</td>
                </tr>`).join('');
            // v2.17 : fiche gardien au clic (même modale que les joueurs, bloc stats gardien dédié)
            document.querySelectorAll('.goalie-row').forEach(r => r.onclick = () => {
                const g = list.find(x => String(x.id||'') === String(r.dataset.id||''));
                if (g) { g.isGoalie = true; openPlayerModal(g, true); }
            });
        }
        
        // --- UPDATED MATCH ROW (With Note Icon) ---
        function generateMatchRow(m, isLynxView) {
            const isHome = normalize(m.homeTeam).includes('valence');
            const isLynxInvolved = normalize(m.homeTeam).includes('valence') || normalize(m.awayTeam).includes('valence');
            const d = new Date(m.date).toLocaleDateString('fr-FR', {day:'numeric', month:'short'});
            const dtm = new Date(m.date);
            const tTxt = (dtm.getHours() || dtm.getMinutes()) ? dtm.getHours() + 'h' + String(dtm.getMinutes()).padStart(2, '0') : '';
            const hasScore = isMatchFinished(m);
            const score = hasScore ? `${m.scoreHome}-${m.scoreAway}${m.isProl ? ' (Pr.)' : ''}` : 'vs';
            const isPO = m.type === 'Playoff' || m.type === 'Playoffs' || (m.type && m.type !== 'Saison');
            const phaseLabel = (isPO && m.type !== 'Playoff' && m.type !== 'Playoffs') ? m.type : 'Playoff';
            const noteIcon = m.note ? `<i class="fa-solid fa-triangle-exclamation text-orange-500 ml-1" title="${m.note}"></i>` : '';
            let predBadge = '';
            try {
                const pi = getMatchPredInfo(m);
                if (pi && pi.past) {
                    const cls = pi.exact ? 'text-green-500' : (pi.right ? 'text-orange-400' : 'text-red-400');
                    const lbl = pi.exact ? 'Score exact prédit avant le match !' : (pi.right ? 'Vainqueur correctement prédit avant le match' : 'Pronostic raté (prédit avant le match)');
                    predBadge = `<div class="w-14 flex flex-col items-center justify-center text-[10px] font-bold ${cls} leading-tight" title="Pronostic du modèle avant ce match : ${pi.s[0]}-${pi.s[1]}${pi.draw ? ' après prolongation' : ''} (${pi.pct} % estimé) — ${lbl}"><span>🔮</span><span>${pi.s[0]}-${pi.s[1]}${pi.draw ? ' ap' : ''}</span></div>`;
                } else if (pi) {
                    predBadge = `<div class="w-14 flex flex-col items-center justify-center text-[10px] font-bold text-gray-400 leading-tight" title="Pronostic du modèle : ${pi.s[0]}-${pi.s[1]}${pi.draw ? ' après prolongation — vainqueur probable : ' + xmlEsc(pi.w === 'H' ? m.homeTeam : m.awayTeam) : ''} — ${pi.pct} % pour le favori — fiabilité ${pi.fiab} %"><span>🔮</span><span>${pi.s[0]}-${pi.s[1]}${pi.draw ? ' ap' : ''}</span><span class="text-[9px]">${pi.fiab} %</span></div>`;
                }
            } catch (e) {}
            
            let rowClass = 'hover:bg-gray-50 dark:hover:bg-gray-800 border-l-4 border-transparent';
            if(isLynxInvolved) {
                 if(hasScore) {
                     const w = (isHome && m.scoreHome > m.scoreAway) || (!isHome && m.scoreAway > m.scoreHome);
                     rowClass = w ? 'border-l-4 border-green-500 bg-green-50/30 dark:bg-green-900/10' : 'border-l-4 border-red-500 bg-red-50/30 dark:bg-red-900/10';
                 } else { rowClass = 'border-l-4 border-lynx-red bg-red-50/10 dark:bg-red-900/5'; }
            } else if (hasScore) { rowClass = 'border-l-4 border-gray-300 dark:border-gray-600'; }
            // v2.22 : bouton Live seulement le JOUR du match — rouge avant le coup d'envoi, vert pendant la fenêtre
            // du match (coup d'envoi → +3h30), rien les autres jours. Horaire inconnu (import à minuit) = 20 h supposées.
            let liveJumpBtn = '';
            if (m.ffhgId && !hasScore) {
                const dK = new Date(m.date);
                if (!dK.getHours() && !dK.getMinutes()) dK.setHours(20, 0, 0, 0);
                const tK = dK.getTime();
                const nowD = new Date();
                const sameDay = dK.getFullYear() === nowD.getFullYear() && dK.getMonth() === nowD.getMonth() && dK.getDate() === nowD.getDate();
                const inWin = Date.now() >= tK && Date.now() < tK + 3.5 * 3600e3;
                if (sameDay) liveJumpBtn = `<button class="live-jump-btn shrink-0 ${inWin ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} text-white text-[10px] md:text-xs font-bold px-2 py-1.5 rounded-lg shadow transition" data-ffhg="${xmlEsc(m.ffhgId)}" data-h="${xmlEsc(m.homeTeam)}" data-a="${xmlEsc(m.awayTeam)}" title="${inWin ? 'Le match est (ou devrait être) en cours — ouvre le direct' : 'Match ce jour — ouvre le direct avec le n° déjà rempli'}">${inWin ? '🟢' : '🔴'} Live</button>`;
            }

            return `<div class="flex justify-between items-center p-3 md:p-3 rounded shadow-sm border border-gray-100 dark:border-gray-700 text-sm md:text-base ${rowClass} cursor-pointer quick-score-trigger transition-all mb-3 relative" data-id="${m.id}" data-home="${m.homeTeam}" data-away="${m.awayTeam}">
                <div class="w-14 text-gray-400 font-bold text-xs flex flex-col items-center leading-tight">${d}${tTxt ? `<span class="font-normal text-[10px]">${tTxt}</span>` : ''} ${noteIcon}</div>
                ${isPO ? `<div class="absolute top-0 right-0 px-2 py-0.5 bg-yellow-400 text-black text-[9px] font-bold rounded-bl uppercase tracking-tighter">${phaseLabel}</div>` : ''}
                <div class="flex-1 flex justify-center items-center gap-2 md:gap-4">
                     <div class="flex items-center justify-end flex-1 gap-2"><span class="font-bold hidden md:inline ${isLynxInvolved && isHome?'text-lynx-dark dark:text-white':''}">${m.homeTeam}</span><img src="${getLogo(m.homeTeam)}" class="w-8 h-8 object-contain"></div>
                     <div class="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded font-black min-w-[50px] text-center text-base">${score}</div>
                     <div class="flex items-center justify-start flex-1 gap-2"><img src="${getLogo(m.awayTeam)}" class="w-8 h-8 object-contain"><span class="font-bold hidden md:inline ${isLynxInvolved && !isHome?'text-lynx-dark dark:text-white':''}">${m.awayTeam}</span></div>
                </div>
                <div class="w-20 md:w-24 shrink-0 flex flex-col items-center justify-center gap-1">${predBadge}${liveJumpBtn}${(hasScore && repArchived(m)) ? `<button class="rep-replay-btn shrink-0 text-[10px] md:text-xs font-bold px-2 py-1 rounded-lg shadow bg-gray-900 hover:bg-black text-white transition" data-rep="${xmlEsc(repForMatch(m) || m.id)}" title="Déroulé archivé en base — rejouer le match (animations plein écran)">🎬 Revoir</button>` : ''}</div>
            </div>`;
        }