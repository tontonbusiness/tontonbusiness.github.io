// Dream Chauffeur — réception des notifications (nouvelle course), même appli fermée.
// Ne met rien en cache : l'appli se charge toujours en ligne, comme avant.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { texte: e.data ? e.data.text() : "" }; }
  const titre = m.titre || "Nouvelle course";
  const options = {
    body: m.texte || "Ouvre Dream Chauffeur pour voir ton programme.",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: m.course ? "course-" + m.course : "dream-chauffeur",
    renotify: true,
    data: { course: m.course || null },
  };
  const taches = [self.registration.showNotification(titre, options)];
  if (m.badge && self.navigator && self.navigator.setAppBadge) taches.push(self.navigator.setAppBadge(m.badge).catch(() => {}));
  taches.push(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: "push" }))));
  e.waitUntil(Promise.all(taches));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const course = e.notification.data && e.notification.data.course;
  const cible = new URL("./" + (course ? "#course=" + course : ""), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) {
      if (c.url.startsWith(self.registration.scope)) { c.postMessage({ type: "ouvrir", course }); return c.focus(); }
    }
    return self.clients.openWindow(cible);
  }));
});
