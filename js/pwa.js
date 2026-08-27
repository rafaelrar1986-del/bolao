(function () {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw-v4.js").then((registration) => {
      return registration.update();
    }).catch((error) => {
      console.warn("Falha ao registrar PWA:", error);
    });
  });
})();
