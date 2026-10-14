/*
 * Service worker for the daily reminder.
 *
 * Plain JavaScript, served as-is from `public/`, because a service worker cannot
 * be bundled — the browser loads this file directly and its scope is the
 * directory it sits in.
 *
 * It does one thing: show whatever the server pushed, in Arabic and right to
 * left, and open the game when tapped.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push with no readable payload still deserves *something* visible.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "جرادل", {
      body: payload.body || "",
      // Same tag for a re-sent reminder on the same day, so it replaces the
      // earlier notification instead of stacking a second one.
      tag: payload.tag,
      data: { url: payload.url || "/" },
      icon: "/apple-touch-icon.png",
      dir: "rtl",
      lang: "ar",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // If the game is already open somewhere, go there rather than opening a
      // second copy of it.
      for (const window of windows) {
        if (window.url.startsWith(self.location.origin)) {
          return window.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
