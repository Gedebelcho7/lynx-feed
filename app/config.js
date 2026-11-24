const apiKey = "AQ.Ab8RN6JmT9XueElXAFk0Q0lIMp2RnCN04wVKbxQsapGyBV9yuw";
        // Clé Mistral de SECOURS (optionnelle) : si Gemini est à court de quota,
        // l'IA bascule automatiquement ici. Clé gratuite sur console.mistral.ai
        // (compte gratuit, sans carte bancaire). Laisser vide pour ignorer.
        const mistralApiKey = "mstrl_6FBnN20cCLITDZS79b5ntGc3bkgAvMU0_37OSA3";
        // Publication du flux RSS en ligne depuis l'app (code 100 % local) :
        // 1) crée un mini-dépôt GitHub public "lynx-feed" (juste un README) et active Pages dessus
        // 2) génère un token GitHub "fine-grained" (Settings → Developer settings → Fine-grained tokens) :
        //    accès au SEUL dépôt lynx-feed, permission "Contents: Read and write"
        // 3) remplis ci-dessous : "ton-pseudo/lynx-feed" + le token
        // Laisse vide pour ne rien publier en ligne. Le token reste dans ce fichier local :
        // ne le mets PAS dans une app hébergée publiquement (et révoque-le si besoin).
        const ghRssRepo = "";
        const ghRssToken = "";
        // Config Firebase dédiée Lynx Data Hub (données synchronisées depuis n'importe où)
        const firebaseConfig = {
            apiKey: "AIzaSyAESkXTPEvXGWK5LTd55_XTHWwexTHvtG4",
            authDomain: "lnx-data.firebaseapp.com",
            projectId: "lnx-data",
            storageBucket: "lnx-data.firebasestorage.app",
            messagingSenderId: "268495651240",
            appId: "1:268495651240:web:6f5bad67a7c7a38ef79d9d"
        };
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const basePath = `/artifacts/${appId}/public/data`;
        const APP_VERSION = "2.22"; // version du site — incrémenter à chaque déploiement (Admin → Diagnostic la compare à la version de l'action GitHub)

        // ===== WEB PUSH (notifications même site fermé, nécessite hébergement HTTPS + sw.js) =====
        const VAPID_PUBLIC_KEY = "BFxrHv11rQ5N21z-SP-QDKnXCSFrXsEy4ovLUmE9TO-fzanQFdOsUl4iGPkylKZ55YvlnQevC2RJe5o82ZScnFg";
        const urlB64ToU8 = (b64) => { const p = '='.repeat((4 - b64.length % 4) % 4); const s = (b64 + p).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(s); const arr = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i); return arr; };