// Densitométrie pulmonaire automatique sur une série DICOM calibrée en UH.
// 1. Segmentation des poumons (à demi-résolution) : parenchyme < -200 UH (seuil de Best 2003) non relié au bord de l'image,
//    plus grandes composantes 3D (exclut l'air digestif), comblement des trous (vaisseaux) et fermeture morphologique.
// 2. Mesures à pleine résolution dans ce masque : volume, % de zones de haute atténuation (HAA, -600 à -250 UH,
//    définition MESA), et indices d'histogramme de Best 2003 (densité moyenne, asymétrie, kurtosis des voxels ≤ -200 UH).

export const SEUIL_AIR = -200;
export const HAA_MIN = -600;
export const HAA_MAX = -250;
// Bandes de densité de 3D Slicer Lung CT Analyzer (valeurs par défaut, LungCTAnalyzer.py, licence Apache 2.0).
export const BANDES_LCTA = [
  { cle: 'emphyseme', nom: 'Emphysème / bulles', min: -1050, max: -950 },
  { cle: 'aere', nom: 'Aéré', min: -950, max: -750 },
  { cle: 'infiltre', nom: 'Infiltré', min: -750, max: -400 },
  { cle: 'collabe', nom: 'Collabé', min: -400, max: 0 },
  { cle: 'vaisseaux', nom: 'Vaisseaux', min: 0, max: 3000 },
];
export const HISTO_BEST_MAX = -200; // borne haute de l'histogramme pulmonaire (Best 2003)
const HISTO_BEST_MIN = -1024;
const HISTO_MIN = -1000;
const HISTO_MAX = 0;
const HISTO_PAS = 10;

// Remplit (valeur 2) les pixels à 1 connectés au bord de l'image (4-connexité).
function marquerDepuisBord(m, w, h) {
  const pile = [];
  const pousser = (i) => { if (m[i] === 1) { m[i] = 2; pile.push(i); } };
  for (let x = 0; x < w; x++) { pousser(x); pousser((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { pousser(y * w); pousser(y * w + w - 1); }
  while (pile.length) {
    const i = pile.pop();
    const x = i % w;
    if (x > 0) pousser(i - 1);
    if (x < w - 1) pousser(i + 1);
    if (i >= w) pousser(i - w);
    if (i < w * (h - 1)) pousser(i + w);
  }
}

// Dilatation (dilater = true) ou érosion d'un masque binaire, élément structurant 3×3 en croix ou en carré.
// Hors image : considéré comme vide (0). Sans allocation par pixel (appelée des milliers de fois par examen).
function morpho(m, w, h, dilater, carre) {
  const s = new Uint8Array(m.length);
  const cible = dilater ? 1 : 0;
  for (let y = 0; y < h; y++) {
    const haut = y > 0, bas = y < h - 1;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = m[i];
      if (v === cible) { s[i] = v; continue; }
      const g = x > 0, d = x < w - 1;
      let touche = (g ? m[i - 1] : 0) === cible || (d ? m[i + 1] : 0) === cible || (haut ? m[i - w] : 0) === cible || (bas ? m[i + w] : 0) === cible;
      if (!touche && carre)
        touche = (g && haut ? m[i - w - 1] : 0) === cible || (d && haut ? m[i - w + 1] : 0) === cible ||
          (g && bas ? m[i + w - 1] : 0) === cible || (d && bas ? m[i + w + 1] : 0) === cible;
      s[i] = touche ? cible : v;
    }
  }
  return s;
}

// Fermeture (dilatation puis érosion) de rayon r pixels, élément proche d'un octogone.
// L'érosion traite l'extérieur de l'image comme vide : sans la réunion finale avec m, un poumon à moins de r pixels
// du bord de l'image serait rogné (la fermeture doit contenir le masque d'origine).
function fermeture(m, w, h, r) {
  let s = m;
  for (let k = 0; k < r; k++) s = morpho(s, w, h, true, k % 2 === 1);
  for (let k = 0; k < r; k++) s = morpho(s, w, h, false, k % 2 === 1);
  for (let i = 0; i < s.length; i++) s[i] |= m[i];
  return s;
}

// Comble les trous : tout ce qui n'est pas relié au bord par l'extérieur du masque devient masque.
function comblerTrous(m, w, h) {
  const ext = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) ext[i] = m[i] ? 0 : 1;
  marquerDepuisBord(ext, w, h);
  const s = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) s[i] = ext[i] === 2 ? 0 : 1;
  return s;
}

// Demi-résolution : moyenne de blocs 2×2.
function reduire(d, w, h) {
  const w2 = w >> 1;
  const h2 = h >> 1;
  const s = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      s[y * w2 + x] = (d[i] + d[i + 1] + d[i + w] + d[i + w + 1]) / 4;
    }
  return s;
}

// Espacement des pixels [ligne, colonne] en mm s'il est connu et valide, sinon null.
function espacementValide(geometrie) {
  const e = geometrie?.espacementPixel;
  if (!e || !e.length) return null;
  const sy = e[0], sx = e.length > 1 ? e[1] : e[0];
  return sy > 0 && sx > 0 && Number.isFinite(sy) && Number.isFinite(sx) ? [sy, sx] : null;
}

// pile : { nombre, async coupe(i) → { donnees: Int16Array (UH), largeur, hauteur } }
// geometrie : { espacementPixel: [ligne, colonne] mm, espacementCoupes mm, epaisseur mm }
// options.masques : masques pulmonaires demi-résolution déjà calculés (ex. lungmask), un par coupe ; sinon seuillage.
export async function analyserDensite(pile, geometrie, progression = () => {}, options = {}) {
  const n = pile.nombre;
  let w = 0, h = 0, w2 = 0, h2 = 0, plan = 0;
  if (options.masques) return mesurer(pile, geometrie, progression, options.masques);

  // Étape 1 : air interne par coupe (demi-résolution), dans un seul tableau n × plan.
  let air = null;
  for (let k = 0; k < n; k++) {
    const c = await pile.coupe(k);
    if (!w) { w = c.largeur; h = c.hauteur; w2 = w >> 1; h2 = h >> 1; plan = w2 * h2; air = new Uint8Array(n * plan); }
    const r = reduire(c.donnees, w, h);
    const m = air.subarray(k * plan, (k + 1) * plan);
    for (let i = 0; i < plan; i++) m[i] = r[i] < SEUIL_AIR ? 1 : 0;
    marquerDepuisBord(m, w2, h2);
    for (let i = 0; i < plan; i++) m[i] = m[i] === 1 ? 1 : 0;
    progression(k + 1, n * 2, 'Segmentation');
    if (k % 8 === 0) await new Promise((ok) => setTimeout(ok));
  }

  // Étape 2 : composantes 3D (6-connexité) ; on garde celles ≥ 20 % de la plus grande (les deux poumons).
  const etiquettes = new Int32Array(n * plan);
  const tailles = [0];
  const file = new Int32Array(n * plan);
  for (let depart = 0; depart < n * plan; depart++) {
    if (!air[depart] || etiquettes[depart]) continue;
    const e = tailles.length;
    let debut = 0, fin = 0;
    file[fin++] = depart;
    etiquettes[depart] = e;
    while (debut < fin) {
      const v = file[debut++];
      const kk = (v / plan) | 0;
      const ii = v - kk * plan;
      const x = ii % w2;
      let u;
      if (x > 0 && air[(u = v - 1)] && !etiquettes[u]) { etiquettes[u] = e; file[fin++] = u; }
      if (x < w2 - 1 && air[(u = v + 1)] && !etiquettes[u]) { etiquettes[u] = e; file[fin++] = u; }
      if (ii >= w2 && air[(u = v - w2)] && !etiquettes[u]) { etiquettes[u] = e; file[fin++] = u; }
      if (ii < plan - w2 && air[(u = v + w2)] && !etiquettes[u]) { etiquettes[u] = e; file[fin++] = u; }
      if (kk > 0 && air[(u = v - plan)] && !etiquettes[u]) { etiquettes[u] = e; file[fin++] = u; }
      if (kk < n - 1 && air[(u = v + plan)] && !etiquettes[u]) { etiquettes[u] = e; file[fin++] = u; }
    }
    tailles.push(fin);
  }
  const plusGrande = tailles.reduce((m, t) => (t > m ? t : m), 0); // pas de Math.max(...) : des centaines de milliers de composantes possibles
  const garder = tailles.map((t) => t > 0 && t >= 0.2 * plusGrande);

  // Étape 3 : masque final par coupe (fermeture, comblement des trous), puis mesures.
  const sxSeg = espacementValide(geometrie)?.[1] ?? 1;
  const rayon = Math.max(1, Math.round(5 / (2 * sxSeg))); // fermeture d'environ 5 mm
  const masquesSeuil = [];
  for (let k = 0; k < n; k++) {
    const m = new Uint8Array(plan);
    for (let i = 0; i < plan; i++) m[i] = garder[etiquettes[k * plan + i]] ? 1 : 0;
    masquesSeuil.push(comblerTrous(fermeture(m, w2, h2, rayon), w2, h2));
  }
  return mesurer(pile, geometrie, (k) => progression(n + k, 2 * n), masquesSeuil);
}

// Mesures à pleine résolution dans des masques pulmonaires demi-résolution (un par coupe).
// Chaque voxel pulmonaire est versé dans un histogramme au pas de 1 UH (valeurs Int16) : toutes les mesures
// (volume, HAA, bandes, moments de Best) en sont tirées exactement, sans erreur d'arrondi cumulée sur 10⁸ voxels.
async function mesurer(pile, geometrie, progression, masquesPoumon) {
  const n = pile.nombre;
  const espacement = espacementValide(geometrie);
  const ec = geometrie.espacementCoupes;
  const coupesOk = ec > 0 && Number.isFinite(ec);
  const contigu = coupesOk && (geometrie.epaisseur > 0 ? ec <= geometrie.epaisseur * 1.5 : true);
  // Volume non calculable si coupes non contiguës ou taille des pixels inconnue.
  const volumeVoxel = contigu && espacement ? (espacement[0] * espacement[1] * ec) / 1000 : null; // mL
  const DECALAGE = 32768;
  const compte = new Float64Array(65536); // compte[u + 32768] : voxels pulmonaires à u UH
  const masques = [];
  let w = 0, w2 = 0, h2 = 0, plan = 0;
  for (let k = 0; k < n; k++) {
    const c = await pile.coupe(k);
    const d = c.donnees;
    if (!w) { w = c.largeur; w2 = w >> 1; h2 = c.hauteur >> 1; plan = w2 * h2; }
    const m = masquesPoumon[k];
    const calque = new Uint8Array(plan); // 0 : hors poumon, 1 : poumon, 2 : contient des HAA (affichage)
    if (m)
      for (let y = 0; y < h2 * 2; y++)
        for (let x = 0; x < w2 * 2; x++) {
          const j = (y >> 1) * w2 + (x >> 1);
          if (!m[j]) continue;
          let b = d[y * w + x] + DECALAGE;
          if (!(b >= 0 && b <= 65535 && b === (b | 0))) {
            if (b !== b) continue; // NaN : voxel ignoré
            b = Math.min(65535, Math.max(0, Math.round(b)));
          }
          compte[b]++;
          const v = b - DECALAGE;
          if (v >= HAA_MIN && v <= HAA_MAX) calque[j] = 2;
          else if (!calque[j]) calque[j] = 1;
        }
    masques.push(calque);
    progression(k + 1, n);
    if (k % 8 === 0) await new Promise((ok) => setTimeout(ok));
  }

  // Sommes sur une plage [a ; b] d'UH (bornes incluses).
  const somme = (a, b, f = () => 1) => {
    let s = 0;
    for (let u = Math.max(a, -DECALAGE); u <= Math.min(b, 65535 - DECALAGE); u++) { const c = compte[u + DECALAGE]; if (c) s += c * f(u); }
    return s;
  };
  const total = somme(-DECALAGE, 65535 - DECALAGE);
  const sommeUH = somme(-DECALAGE, 65535 - DECALAGE, (u) => u);
  const haa = somme(HAA_MIN, HAA_MAX);
  const histogramme = Array.from({ length: (HISTO_MAX - HISTO_MIN) / HISTO_PAS }, (_, i) => somme(HISTO_MIN + i * HISTO_PAS, HISTO_MIN + (i + 1) * HISTO_PAS - 1));
  const bandes = BANDES_LCTA.map((b) => somme(b.min, b.max - 1)); // [min ; max[

  return {
    largeurMasque: w2,
    hauteurMasque: h2,
    masques,
    voxels: total,
    volumeMl: volumeVoxel != null ? total * volumeVoxel : null,
    densiteMoyenne: total ? sommeUH / total : null,
    haaPourcent: total ? (100 * haa) / total : null,
    haaMl: volumeVoxel != null ? haa * volumeVoxel : null,
    histogramme: { min: HISTO_MIN, pas: HISTO_PAS, valeurs: histogramme },
    indices: indicesHistogramme(somme),
    // % du poumon segmenté dans chaque bande (voxels hors bandes, < -1050 UH, non comptés).
    bandes: Object.fromEntries(BANDES_LCTA.map((b, i) => [b.cle, total ? (100 * bandes[i]) / total : 0])),
  };
}

// Densité moyenne (MLA), asymétrie et kurtosis en excès (loi normale = 0), moments de population des voxels
// de -1024 à -200 UH (Best 2003), calculés en deux passes (moyenne puis moments centrés) sur l'histogramme.
function indicesHistogramme(somme) {
  const n = somme(HISTO_BEST_MIN, HISTO_BEST_MAX);
  if (n < 2) return null;
  const m = somme(HISTO_BEST_MIN, HISTO_BEST_MAX, (u) => u) / n;
  const v = somme(HISTO_BEST_MIN, HISTO_BEST_MAX, (u) => (u - m) ** 2) / n;
  const m3 = somme(HISTO_BEST_MIN, HISTO_BEST_MAX, (u) => (u - m) ** 3) / n;
  const m4 = somme(HISTO_BEST_MIN, HISTO_BEST_MAX, (u) => (u - m) ** 4) / n;
  return {
    mla: m,
    asymetrie: v > 0 ? m3 / v ** 1.5 : 0,
    kurtosis: v > 0 ? m4 / (v * v) - 3 : 0,
  };
}
