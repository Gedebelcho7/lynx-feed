// ===== CHARGEMENT CONDITIONNEL : Firebase OU mode local (localStorage) =====
        // (extrait tel quel du monolithe ; le « await » de plus haut niveau est déplacé dans une IIFE, voir commentaire plus bas)
        let db, auth, doc, setDoc, deleteDoc, onSnapshot, collection, addDoc, getDoc, getDocs, onAuthStateChanged, signInAnonymously, signInWithCustomToken;
        const HAS_FB = !!(firebaseConfig && (firebaseConfig.apiKey || firebaseConfig.projectId));
        let fbLoadFailed = false;
        // ⚠️ Petit ajustement obligatoire lors de la sortie du monolithe : le module d'origine utilisait un « await »
        // de plus haut niveau pour attendre le SDK Firebase. Un script classique n'a pas d'attente de plus haut
        // niveau, donc tout le bloc ci-dessous est enveloppé dans une IIFE asynchrone. La promesse est exposée via
        // window.__firebaseReady : le module de démarrage (16-boot.js) attendra cette promesse avant de lancer bootApp.
        window.__firebaseReady = (async () => {
        if (HAS_FB) {
            try {
                const [A, Au, Fs] = await Promise.all([
                    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"),
                    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"),
                    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js")
                ]);
                const fbApp = A.initializeApp(firebaseConfig);
                db = Fs.getFirestore(fbApp);
                auth = Au.getAuth(fbApp);
                doc = Fs.doc; setDoc = Fs.setDoc; deleteDoc = Fs.deleteDoc;
                onSnapshot = Fs.onSnapshot; collection = Fs.collection; addDoc = Fs.addDoc;
                getDoc = Fs.getDoc; getDocs = Fs.getDocs;
                onAuthStateChanged = Au.onAuthStateChanged; signInAnonymously = Au.signInAnonymously; signInWithCustomToken = Au.signInWithCustomToken;
            } catch (e) {
                console.error("Chargement Firebase impossible :", e);
                fbLoadFailed = true;
            }
        }
        if (!HAS_FB || fbLoadFailed) {
            // Mode autonome : persistance locale (l'app reste utilisable sans config Firebase)
            const LSKEY = 'lynxHubData_v1';
            const store = { data: {}, subs: {} };
            try { store.data = JSON.parse(localStorage.getItem(LSKEY) || '{}'); } catch (e) { store.data = {}; }
            const persist = () => { try { localStorage.setItem(LSKEY, JSON.stringify(store.data)); } catch (e) {} };
            const mkRef = (p, kind) => ({ __path: p, __kind: kind });
            const baseOf = (p) => p.split('/').slice(0, -1).join('/');
            const emitCol = (base) => {
                persist();
                const entries = Object.entries(store.data).filter(([k]) => k.startsWith(base + '/'));
                const snap = { docs: entries.map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })) };
                (store.subs[base] || []).forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } });
            };
            const emitDoc = (p) => {
                persist();
                const snap = { exists: () => store.data[p] !== undefined, data: () => store.data[p] || {} };
                (store.subs[p] || []).forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } });
            };
            db = { local: true };
            doc = (_db, p) => mkRef(p, 'doc');
            collection = (_db, p) => mkRef(p, 'col');
            setDoc = async (ref, data, opts) => {
                const p = ref.__path;
                if (opts && opts.merge && store.data[p]) store.data[p] = { ...store.data[p], ...data };
                else store.data[p] = { ...data };
                emitCol(baseOf(p)); emitDoc(p);
            };
            deleteDoc = async (ref) => { const p = ref.__path; delete store.data[p]; emitCol(baseOf(p)); };
            getDoc = async (ref) => { const v = store.data[ref.__path]; return { exists: () => v !== undefined, data: () => v || {} }; };
            getDocs = async (ref) => {
                const entries = Object.entries(store.data).filter(([k]) => k.startsWith(ref.__path + '/'));
                const snap = { docs: entries.map(([k, v]) => ({ id: k.split('/').pop(), data: () => v })), empty: !entries.length, forEach: (cb) => snap.docs.forEach(cb) };
                return snap;
            };
            addDoc = async (colRef, data) => {
                const id = 'loc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                store.data[colRef.__path + '/' + id] = data;
                emitCol(colRef.__path);
                return id;
            };
            onSnapshot = (ref, cb) => { if (ref.__kind === 'doc') { (store.subs[ref.__path] = store.subs[ref.__path] || []).push(cb); emitDoc(ref.__path); } else { (store.subs[ref.__path] = store.subs[ref.__path] || []).push(cb); emitCol(ref.__path); } };
            auth = { local: true };
            signInAnonymously = async () => ({}); signInWithCustomToken = async () => ({});
            onAuthStateChanged = (_a, cb) => { setTimeout(() => cb({ uid: 'local' }), 0); };
            const setLocalStatus = () => { const sm = document.getElementById('status-mode'); if (sm) { sm.textContent = 'MODE LOCAL'; sm.className = 'font-bold text-orange-500'; } };
            if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', setLocalStatus); else setLocalStatus();
        }

        })();