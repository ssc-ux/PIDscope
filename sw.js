// Service worker PIDscope : usage hors ligne et installation (PWA).
// - Coquille (HTML/CSS/JS/vendor) pré-cachée, servie « réseau d'abord » (toujours à jour en ligne, disponible hors ligne).
// - data/cas/** : mis en cache à la demande. JSON (index, cas.json) réseau d'abord ; images en cache d'abord.
// - modeles/*.onnx et onnxruntime-web (jsDelivr, version figée) : cache d'abord, à la demande.
// Tous les chemins sont relatifs à l'emplacement de sw.js (compatible sous-dossier GitHub Pages).
// Incrémenter VERSION à chaque déploiement modifiant la coquille ; DONNEES/MODELES seulement si leur contenu change.

const VERSION = 'v1';
const PREFIXE = 'pidscope-';
const CACHE_COQUILLE = `${PREFIXE}coquille-${VERSION}`;
const CACHE_DONNEES = `${PREFIXE}donnees-v1`;
const CACHE_MODELES = `${PREFIXE}modeles-v1`;
const CACHES_ACTIFS = [CACHE_COQUILLE, CACHE_DONNEES, CACHE_MODELES];

const BASE = new URL('./', self.location).href;

const COQUILLE = [
  './',
  'index.html',
  'voir.html',
  'scanner.html',
  'fiches.html',
  'methode.html',
  'references.html',
  'manifest.webmanifest',
  'icones/icone.svg',
  'css/style.css',
  'js/pwa.js',
  'js/entete.js',
  'js/accueil.js',
  'js/voir.js',
  'js/scanner.js',
  'js/visualiseur.js',
  'js/piles.js',
  'js/dicom.js',
  'js/texte.js',
  'js/etendue.js',
  'js/scores.js',
  'js/densitometrie.js',
  'js/quantification.js',
  'js/lungmask.js',
  'vendor/dicomParser.min.js',
  'vendor/jpeg-lossless.mjs',
].map((c) => new URL(c, BASE).href);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_COQUILLE);
    // Un fichier manquant ne doit pas bloquer l'installation (addAll échouerait en bloc).
    await Promise.allSettled(COQUILLE.map(async (url) => {
      const r = await fetch(url, { cache: 'reload' });
      if (r.ok) await cache.put(url, r);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms
      .filter((n) => n.startsWith(PREFIXE) && !CACHES_ACTIFS.includes(n))
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const mettreEnCache = async (nom, requete, reponse) => {
  // Réponses complètes uniquement (pas de 206 partielles, pas d'erreurs).
  if (reponse && reponse.status === 200) {
    const cache = await caches.open(nom);
    await cache.put(requete, reponse.clone());
  }
  return reponse;
};

async function reseauDabord(nom, requete, options = {}) {
  try {
    return await mettreEnCache(nom, requete, await fetch(requete));
  } catch (err) {
    const enCache = await caches.match(requete, options);
    if (enCache) return enCache;
    if (requete.mode === 'navigate') {
      const accueil = await caches.match(new URL('index.html', BASE).href);
      if (accueil) return accueil;
    }
    throw err;
  }
}

async function cacheDabord(nom, requete) {
  const enCache = await caches.match(requete);
  if (enCache) return enCache;
  return mettreEnCache(nom, requete, await fetch(requete));
}

self.addEventListener('fetch', (e) => {
  const requete = e.request;
  if (requete.method !== 'GET' || requete.headers.has('range')) return;
  const url = new URL(requete.url);

  // onnxruntime-web depuis jsDelivr (URL versionnée → immuable).
  if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/onnxruntime-web@')) {
    e.respondWith(cacheDabord(CACHE_MODELES, requete));
    return;
  }
  if (!url.href.startsWith(BASE)) return;
  const chemin = url.pathname.slice(new URL(BASE).pathname.length);

  if (chemin.startsWith('modeles/') && chemin.endsWith('.onnx')) {
    e.respondWith(cacheDabord(CACHE_MODELES, requete));
  } else if (chemin.startsWith('data/cas/')) {
    e.respondWith(chemin.endsWith('.json')
      ? reseauDabord(CACHE_DONNEES, requete)
      : cacheDabord(CACHE_DONNEES, requete));
  } else if (requete.mode === 'navigate') {
    // voir.html?id=… : hors ligne, retomber sur voir.html sans la query.
    e.respondWith(reseauDabord(CACHE_COQUILLE, requete, { ignoreSearch: true }));
  } else {
    e.respondWith(reseauDabord(CACHE_COQUILLE, requete));
  }
});
