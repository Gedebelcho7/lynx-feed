// Service Worker Lynx — notifications push (à la racine du site, à côté de index.html)
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || '🏒 Lynx de Valence';
  const options = {
    body: data.body || 'Nouvelle actualité des Lynx !',
    tag: data.tag || 'lynx',
    icon: 'logo-512.png',
    badge: 'logo-512.png',
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  const norm = (u) => String(u || '').split('#')[0].replace(/\/+$/, '');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const app = list.find((c) => 'focus' in c);
      if (app) {
        return app.focus().then(() => {
          // déjà sur la bonne page (accueil, buts, rappels) : on reste dessus, pas de rechargement
          if (!url || url === './' || norm(url) === norm(app.url)) return null;
          // lien du site (article, ancre) : on y navigue dans la fenêtre ouverte
          if ('navigate' in app) { try { const sameOrigin = new URL(url, app.url).origin === new URL(app.url).origin; if (sameOrigin) return app.navigate(url).catch(() => {}); } catch (e) {} }
          // lien externe (presse, billetterie, page actus) : nouvel onglet
          try { return self.clients.openWindow(url).catch(() => {}); } catch (e) {}
          return null;
        });
      }
      return self.clients.openWindow(url);
    })
  );
});