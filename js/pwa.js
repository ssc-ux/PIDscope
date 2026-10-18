// Enregistre le service worker (sw.js, à la racine du site) pour l'usage hors ligne et l'installation (PWA).
// Chemin résolu depuis ce module : fonctionne aussi sous un sous-dossier (GitHub Pages /PIDscope/).
if ('serviceWorker' in navigator && window.isSecureContext) {
  const url = new URL('../sw.js', import.meta.url);
  const scope = new URL('../', import.meta.url);
  const enregistrer = () => navigator.serviceWorker.register(url, { scope: scope.pathname }).catch((e) => {
    console.warn('PIDscope : service worker non enregistré', e);
  });
  if (document.readyState === 'complete') enregistrer();
  else window.addEventListener('load', enregistrer, { once: true });
}
