// Densitométrie pulmonaire automatique sur une série DICOM calibrée en UH.
// 1. Segmentation des poumons (à demi-résolution) : parenchyme < -200 UH (seuil de Best 2003) non relié au bord de l'image,
//    plus grandes composantes 3D (exclut l'air digestif), comblement des trous (vaisseaux) et fermeture morphologique.
// 2. Mesures à pleine résolution dans ce masque : volume, % de zones de haute atténuation (HAA, -600 à -250 UH,
//    définition MESA), et indices d'histogramme de Best 2003 (densité moyenne, asymétrie, kurtosis des voxels ≤ -200 UH).

export const SEUIL_AIR = -200;
export const HAA_MIN = -600;
export const HAA_MAX = -250;
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
function morpho(m, w, h, dilater, carre) {
  const s = new Uint8Array(m.length);
  const cible = dilater ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = m[i];
      if (v !== cible) {
        const voisins = [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w];
        if (carre) voisins.push(x > 0 && y > 0 && i - w - 1, x < w - 1 && y > 0 && i - w + 1, x > 0 && y < h - 1 && i + w - 1, x < w - 1 && y < h - 1 && i + w + 1);
        for (const j of voisins) {
          // Hors image : considéré comme vide (0).
          const vj = j === false ? 0 : m[j];
          if (vj === cible) { v = cible; break; }
        }
      }
      s[i] = v;
    }
  }
  return s;
}

// Fermeture (dilatation puis érosion) de rayon r pixels, élément proche d'un octogone.
function fermeture(m, w, h, r) {
  let s = m;
  for (let k = 0; k < r; k++) s = morpho(s, w, h, true, k % 2 === 1);
  for (let k = 0; k < r; k++) s = morpho(s, w, h, false, k % 2 === 1);
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

// pile : { nombre, async coupe(i) → { donnees: Int16Array (UH), largeur, hauteur } }
// geometrie : { espacementPixel: [ligne, colonne] mm, espacementCoupes mm, epaisseur mm }
export async function analyserDensite(pile, geometrie, progression = () => {}) {
  const n = pile.nombre;
  let w = 0, h = 0, w2 = 0, h2 = 0;
  const air = [];

  // Étape 1 : air interne par coupe (demi-résolution).
  for (let k = 0; k < n; k++) {
    const c = await pile.coupe(k);
    if (!w) { w = c.largeur; h = c.hauteur; w2 = w >> 1; h2 = h >> 1; }
    const r = reduire(c.donnees, w, h);
    const m = new Uint8Array(w2 * h2);
    for (let i = 0; i < m.length; i++) m[i] = r[i] < SEUIL_AIR ? 1 : 0;
    marquerDepuisBord(m, w2, h2);
    for (let i = 0; i < m.length; i++) m[i] = m[i] === 1 ? 1 : 0;
    air.push(m);
    progression(k + 1, n * 2, 'Segmentation');
    if (k % 8 === 0) await new Promise((ok) => setTimeout(ok));
  }

  // Étape 2 : composantes 3D (6-connexité) ; on garde celles ≥ 20 % de la plus grande (les deux poumons).
  const plan = w2 * h2;
  const etiquettes = new Int32Array(n * plan);
  const tailles = [0];
  const file = new Int32Array(n * plan);
  for (let k = 0; k < n; k++)
    for (let i = 0; i < plan; i++) {
      if (!air[k][i] || etiquettes[k * plan + i]) continue;
      const e = tailles.length;
      let debut = 0, fin = 0, taille = 0;
      file[fin++] = k * plan + i;
      etiquettes[k * plan + i] = e;
      while (debut < fin) {
        const v = file[debut++];
        taille++;
        const kk = (v / plan) | 0;
        const ii = v - kk * plan;
        const x = ii % w2;
        const voisins = [];
        if (x > 0) voisins.push(v - 1);
        if (x < w2 - 1) voisins.push(v + 1);
        if (ii >= w2) voisins.push(v - w2);
        if (ii < plan - w2) voisins.push(v + w2);
        if (kk > 0) voisins.push(v - plan);
        if (kk < n - 1) voisins.push(v + plan);
        for (const u of voisins) {
          const ku = (u / plan) | 0;
          if (!etiquettes[u] && air[ku][u - ku * plan]) { etiquettes[u] = e; file[fin++] = u; }
        }
      }
      tailles.push(taille);
    }
  const plusGrande = Math.max(0, ...tailles);
  const garder = tailles.map((t) => t > 0 && t >= 0.2 * plusGrande);

  // Étape 3 : masque final par coupe + mesures à pleine résolution.
  const [sy, sx] = geometrie.espacementPixel || [1, 1];
  const rayon = Math.max(1, Math.round(5 / (2 * sx))); // fermeture d'environ 5 mm
  const contigu = geometrie.espacementCoupes && geometrie.epaisseur ? geometrie.espacementCoupes <= geometrie.epaisseur * 1.5 : !!geometrie.espacementCoupes;
  const volumeVoxel = sx * sy * (geometrie.espacementCoupes || 0) / 1000; // mL
  const histogramme = new Array((HISTO_MAX - HISTO_MIN) / HISTO_PAS).fill(0);
  const masques = [];
  let total = 0, haa = 0, sommeUH = 0;
  // Moments de l'histogramme (valeurs centrées sur -700 UH pour limiter les erreurs d'arrondi).
  let mn = 0, m1 = 0, m2 = 0, m3 = 0, m4 = 0;
  for (let k = 0; k < n; k++) {
    let m = new Uint8Array(plan);
    for (let i = 0; i < plan; i++) m[i] = garder[etiquettes[k * plan + i]] ? 1 : 0;
    m = comblerTrous(fermeture(m, w2, h2, rayon), w2, h2);
    const c = await pile.coupe(k);
    const d = c.donnees;
    const calque = new Uint8Array(plan); // 0 : hors poumon, 1 : poumon, 2 : contient des HAA (affichage)
    for (let y = 0; y < h2 * 2; y++)
      for (let x = 0; x < w2 * 2; x++) {
        const j = (y >> 1) * w2 + (x >> 1);
        if (!m[j]) continue;
        const v = d[y * w + x];
        total++;
        sommeUH += v;
        if (v >= HAA_MIN && v <= HAA_MAX) { haa++; calque[j] = 2; } else if (!calque[j]) calque[j] = 1;
        if (v >= HISTO_MIN && v < HISTO_MAX) histogramme[Math.floor((v - HISTO_MIN) / HISTO_PAS)]++;
        if (v >= HISTO_BEST_MIN && v <= HISTO_BEST_MAX) {
          const t = v + 700;
          mn++; m1 += t; m2 += t * t; m3 += t * t * t; m4 += t * t * t * t;
        }
      }
    masques.push(calque);
    progression(n + k + 1, n * 2, 'Mesures');
    if (k % 8 === 0) await new Promise((ok) => setTimeout(ok));
  }

  return {
    largeurMasque: w2,
    hauteurMasque: h2,
    masques,
    voxels: total,
    volumeMl: contigu ? total * volumeVoxel : null, // volume non calculable si coupes non contiguës
    densiteMoyenne: total ? sommeUH / total : null,
    haaPourcent: total ? (100 * haa) / total : null,
    haaMl: contigu ? haa * volumeVoxel : null,
    histogramme: { min: HISTO_MIN, pas: HISTO_PAS, valeurs: histogramme },
    indices: indicesHistogramme(mn, m1, m2, m3, m4),
  };
}

// Densité moyenne (MLA), asymétrie et kurtosis en excès (loi normale = 0) à partir des moments bruts centrés sur -700 UH.
function indicesHistogramme(n, s1, s2, s3, s4) {
  if (n < 2) return null;
  const m = s1 / n;
  const v = s2 / n - m * m;
  const m3 = s3 / n - 3 * m * (s2 / n) + 2 * m ** 3;
  const m4 = s4 / n - 4 * m * (s3 / n) + 6 * m * m * (s2 / n) - 3 * m ** 4;
  return {
    mla: m - 700,
    asymetrie: v > 0 ? m3 / v ** 1.5 : 0,
    kurtosis: v > 0 ? m4 / (v * v) - 3 : 0,
  };
}
