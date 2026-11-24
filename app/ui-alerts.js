// ===== UI : modales applicatives (confirm / alerte) + bandeau hors-ligne =====
        // Extrait du monolithe d'origine (3 blocs voisins). En-tête unique ajouté, contenu intact.
        // --- CUSTOM MODALS FOR IFRAME COMPATIBILITY ---
        const appConfirm = (msg, onConfirm) => {
            try { if (typeof liveAnimQ !== 'undefined' && liveAnimQ) { liveAnimQ.length = 0; const tk = document.getElementById('live-takeover'); if (tk && tk.style.display !== 'none' && typeof liveTakeoverHide === 'function') liveTakeoverHide(true); } } catch (e) {} // v2.22 : idem alerte
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[10050] flex items-center justify-center p-4';
            overlay.innerHTML = `
                <div class="bg-white dark:bg-dark-card p-6 rounded-2xl max-w-sm w-full shadow-2xl border border-lynx-red text-center animate-fade-in transform scale-100">
                    <i class="fa-solid fa-triangle-exclamation text-4xl text-lynx-red mb-4"></i>
                    <p class="font-bold text-lg mb-6">${msg}</p>
                    <div class="flex gap-3">
                        <button id="cf-cancel" class="flex-1 py-3 rounded-xl border border-gray-300 dark:border-gray-600 font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition">Annuler</button>
                        <button id="cf-ok" class="flex-1 py-3 rounded-xl bg-lynx-red text-white font-bold hover:bg-red-700 transition shadow-lg">Confirmer</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#cf-cancel').onclick = () => overlay.remove();
            overlay.querySelector('#cf-ok').onclick = () => { overlay.remove(); onConfirm(); };
        };

        const appAlert = (msg) => {
            // v2.22 : purger les animations live et passer AU-DESSUS du takeover plein écran (z 10001) —
            // pendant le rattrapage d'un vieux match, l'animation recouvrait l'alerte et le bouton OK était inclicable
            try { if (typeof liveAnimQ !== 'undefined' && liveAnimQ) { liveAnimQ.length = 0; const tk = document.getElementById('live-takeover'); if (tk && tk.style.display !== 'none' && typeof liveTakeoverHide === 'function') liveTakeoverHide(true); } } catch (e) {}
            // v2.22 : un SEUL message à la fois — deux alertes empilées partageaient le même id de bouton,
            // celui du dessus n'avait aucun gestionnaire et le OK était inclicable (fin de match).
            try { document.querySelectorAll('.app-alert-overlay').forEach(o => o.remove()); } catch (e) {}
            const overlay = document.createElement('div');
            overlay.className = 'app-alert-overlay fixed inset-0 bg-black/80 backdrop-blur-sm z-[10050] flex items-center justify-center p-4';
            overlay.innerHTML = `
                <div class="bg-white dark:bg-dark-card p-6 rounded-2xl max-w-sm w-full shadow-2xl border border-blue-500 text-center animate-fade-in">
                    <i class="fa-solid fa-info-circle text-4xl text-blue-500 mb-4"></i>
                    <p class="font-bold text-lg mb-6" style="white-space:pre-line">${msg}</p>
                    <button class="al-ok w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 transition text-white font-bold shadow-lg">OK</button>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('.al-ok').onclick = () => overlay.remove();
        };


        // --- v2.18 : bandeau hors-ligne discret (appareil sans réseau, ou base injoignable au chargement) ---
        const setOfflineBanner = (off, msg) => {
            let b = document.getElementById('offline-banner');
            if (!b) { b = document.createElement('div'); b.id = 'offline-banner'; b.className = 'fixed bottom-0 inset-x-0 z-[10002] hidden'; b.innerHTML = '<div class="bg-gray-900/95 text-white text-center text-xs font-bold py-2 px-3 shadow-2xl"></div>'; document.body.appendChild(b); }
            if (b.firstElementChild) b.firstElementChild.textContent = msg || '📴 Hors-ligne — les données affichées peuvent être anciennes ; tout reprendra tout seul à la reconnexion';
            b.classList.toggle('hidden', !off);
        };
        window.addEventListener('online', () => setOfflineBanner(false));
        window.addEventListener('offline', () => setOfflineBanner(true));
        setOfflineBanner(!navigator.onLine);
        setTimeout(() => { try { if (HAS_FB && fbLoadFailed && navigator.onLine) setOfflineBanner(true, '⚠️ La base de données reste injoignable — vérifie ta connexion puis recharge la page'); } catch (e) {} }, 5000);