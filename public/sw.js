/*
 * Service worker for the daily notification.
 *
 * Plain JavaScript served as-is from `public/`: the browser loads this file
 * directly, and its scope is the directory it sits in, so it has to live at the
 * root. It is only registered once a player asks for the notification.
 *
 * It does three things: show what the server pushed, open the game when the
 * notification is tapped, and hand the server a new subscription when the
 * browser replaces the old one by itself.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Unreadable payload: browsers still require something visible.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "جرادل", {
      body: payload.body || "",
      // The same tag replaces, rather than stacks, a repeat for the same day.
      tag: payload.tag || "jradil",
      data: { url: payload.url || "/" },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      lang: "ar",
      dir: "rtl",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Only ever this site, whatever the payload claims.
  let target = new URL("/", self.location.origin);
  try {
    const url = new URL(event.notification.data?.url || "/", self.location.origin);
    if (url.origin === self.location.origin) target = url;
  } catch {
    // Keep the home page.
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // A game already open somewhere is reused rather than opened twice.
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow(target.href);
    }),
  );
});

/*
 * Some browsers (Firefox, mostly) rotate a subscription without asking. The
 * player still wants the notification, so subscribe again with the same key and
 * tell the server; the old endpoint is pruned on the next send when it answers
 * 410.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options?.applicationServerKey;

  event.waitUntil(
    (async () => {
      const subscription =
        event.newSubscription ||
        (key
          ? await self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: key,
            })
          : null);
      if (!subscription) return;

      await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
