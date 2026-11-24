// ==================== SÉCURITÉ ADMIN (protection légère par mot de passe) ====================
        let adminPassHash = "";
        const adminHash = (s) => { let h = 5381; const str = String(s); for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return 'a' + h.toString(36); };
        // v2.17 : toute modification ou suppression de données (scores, résultats, actus, presse) est
        // réservée à l'Admin déverrouillé — verrou réel seulement si un mot de passe Admin est défini.
        const adminCanEdit = () => (!adminPassHash || adminUnlocked());
        function adminUnlocked() { try { return localStorage.getItem('lynx_admin_unlocked') === '1'; } catch (e) { return false; } }
        function tryOpenAdmin() {
            if (!adminPassHash || adminUnlocked()) { toggleModal('admin-modal', true); return; }
            const inp = document.getElementById('admin-pass-input'); if (inp) inp.value = '';
            const errEl = document.getElementById('admin-lock-error'); if (errEl) errEl.classList.add('hidden');
            toggleModal('admin-lock-modal', true);
            if (inp) setTimeout(() => inp.focus(), 100);
        }
        function updateAdminPassStatus() {
            const el = document.getElementById('admin-pass-status');
            if (el) el.textContent = adminPassHash ? '🔒 Protection ACTIVE — mot de passe demandé à l\'ouverture sur les nouveaux appareils.' : 'Aucune protection : l\'Admin est accessible librement.';
        }
        function wireAdminSecurity() {
            const btnUnlock = document.getElementById('btn-admin-unlock');
            const inpPass = document.getElementById('admin-pass-input');
            const tryUnlock = () => {
                const errEl = document.getElementById('admin-lock-error');
                if (adminHash(inpPass.value || '') === adminPassHash) {
                    try { localStorage.setItem('lynx_admin_unlocked', '1'); } catch (e) { /* mode privé */ }
                    toggleModal('admin-lock-modal', false); toggleModal('admin-modal', true);
                } else { if (errEl) errEl.classList.remove('hidden'); inpPass.value = ''; inpPass.focus(); }
            };
            if (btnUnlock) btnUnlock.onclick = tryUnlock;
            if (inpPass) inpPass.onkeydown = (e) => { if (e.key === 'Enter') tryUnlock(); };
            const closeLock = document.getElementById('close-admin-lock-modal');
            if (closeLock) closeLock.onclick = () => toggleModal('admin-lock-modal', false);
            const btnSave = document.getElementById('btn-save-admin-pass');
            if (btnSave) btnSave.onclick = async () => {
                const v = (document.getElementById('admin-pass-new').value || '').trim();
                if (v.length < 4) { appAlert('Choisis un mot de passe d\'au moins 4 caractères.'); return; }
                adminPassHash = adminHash(v);
                try { await setDoc(doc(db, `${basePath}/settings/general`), { adminPassHash }, { merge: true }); } catch (e) { appAlert('Enregistrement impossible : ' + String(e).slice(0, 120)); return; }
                try { localStorage.setItem('lynx_admin_unlocked', '1'); } catch (e) { /* mode privé */ }
                document.getElementById('admin-pass-new').value = '';
                updateAdminPassStatus();
                appAlert('Mot de passe admin défini ! 🔒\n\nIl sera demandé à l\'ouverture de l\'Admin sur les autres appareils. Tu pourras le changer ou le retirer ici à tout moment.');
            };
            const btnRemove = document.getElementById('btn-remove-admin-pass');
            if (btnRemove) btnRemove.onclick = async () => {
                adminPassHash = '';
                try { await setDoc(doc(db, `${basePath}/settings/general`), { adminPassHash: '' }, { merge: true }); } catch (e) { /* on continue */ }
                try { localStorage.removeItem('lynx_admin_unlocked'); } catch (e) { /* mode privé */ }
                document.getElementById('admin-pass-new').value = '';
                updateAdminPassStatus();
                appAlert('Protection retirée : l\'Admin s\'ouvre désormais sans mot de passe.');
            };
        }