const CACHE_NAME = "bolao-k-bwalya-refactor-full-v7";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles4.css?v=1.43",
  "./js/app4.js?v=1.12",
  "./js/api.js",
  "./js/auth.js",
  "./js/auth-tabs.js",
  "./js/config.js",
  "./js/ui.js",
  "./js/matches4.js",
  "./js/matches/matchesRules.js",
  "./js/matches/matchesVisuals.js",
  "./js/matches/matchesUtilsState.js",
  "./js/matches/matchesScoring.js",
  "./js/matches/matchesBetting.js",
  "./js/matches/matchesProgress.js",
  "./js/matches/matchesDraft.js",
  "./js/matches/matchesSettings.js",
  "./js/matches/matchesGroupPrediction.js",
  "./js/matches/matchesGroupsRenderer.js",
  "./js/matches/matchesKnockoutRenderer.js",
  "./js/matches/matchesPodiumExtras.js",
  "./js/matches/matchesModal.js",
  "./js/matches/matchesController.js",
  "./js/matches/matchesUtils.js",
  "./js/matches/matchesConfrontation.js",
  "./js/ranking2.js?v=1.09",
  "./js/newsTicker.js",
  "./js/newsWall.js",
  "./js/myBets1.js",
  "./js/allBets.js",
  "./js/admin.js",
  "./js/adminBindings.js",
  "./js/admin/adminRuntime.js",
  "./js/admin/adminConstants.js",
  "./js/admin/adminUtils.js",
  "./js/admin/adminPhaseVisibility.js",
  "./js/admin/settings.js",
  "./js/admin/championship.js",
  "./js/admin/locks.js",
  "./js/admin/matches.js",
  "./js/admin/users.js",
  "./js/admin/robot.js",
  "./js/stats.js",
  "./js/profile.js",
  "./js/userProfile.js",
  "./js/classf.js",
  "./js/flags.js",
  "./js/LeagueSelection.js",
  "./js/components/duelRenderer.js",
  "./js/components/userScoreCard.js",
  "./js/pwa.js",
  "./img/card_grupos.webp",
  "./img/Stadium.jpg",
  "./img/ac_bg.webp",
  "./img/ac_header.webp",
  "./img/loginbg.webp",
  "./public/assets/qrcode.png",
  "./public/flags/eng.svg",
  "./public/flags/sco.svg",
  "./public/icons/icon-192.png",
  "./public/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
