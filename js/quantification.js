// Quantification semi-automatique des lésions de PID : verre dépoli, fibrose, condensation.
// Classification de chaque cellule du masque pulmonaire (demi-résolution) dans une fenêtre d'environ 6 mm :
// condensation = majorité de pixels denses ; fibrose = réseau de structures fines (réticulations, parois de rayon de miel) ;
// verre dépoli = parenchyme non dense plus dense que la normale. Méthode simple, explicite et non validée cliniquement :
// la carte proposée doit être vérifiée et corrigée par l'utilisateur.

import { analyserDensite } from './densitometrie.js';

export const CLASSES = {
  HORS: 0,
  NORMAL: 1,
  VERRE_DEPOLI: 2,
  FIBROSE: 3,
  CONDENSATION: 4,
};

// Seuils (UH) et paramètres, exposés pour être affichés et testés.
export const PARAMETRES = {
  fenetreMm: 6, // côté de la fenêtre d'analyse locale
  seuilDense: -300, // au-dessus : vaisseau, paroi, condensation
  fractionCondensation: 0.6, // part de pixels denses pour parler de condensation
  surfaceMinCondensationMm2: 100, // en dessous : structure vasculaire, pas une condensation
  moyenneVerreDepoli: -700, // parenchyme non dense plus dense que ce seuil : verre dépoli
  largeurMaxFineMm: 2.5, // largeur maximale d'une « structure fine » (ouverture morphologique)
  topHatMin: 110, // contraste (UH) d'une structure fine (image lissée) par rapport à son voisinage
  longueurMinFineMm: 3, // une structure fine doit être un trait continu (le bruit donne des pixels isolés)
  fenetreFibroseMm: 10, // fenêtre plus large : un vaisseau isolé y pèse peu, un réseau de lignes beaucoup
  fractionStructuresFines: 0.25, // réseau de lignes fines (réticulations, parois de rayon de miel) : fibrose
  surfaceMinLesionMm2: 15, // îlots plus petits ignorés (bruit)
};

// Images intégrales (somme sur un rectangle en O(1)).
function integrale(w, h, valeur) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let ligne = 0;
    for (let x = 0; x < w; x++) {
      ligne += valeur(y * w + x);
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + ligne;
    }
  }
  return I;
}
const rectangle = (I, w, x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];

// Filtres minimum et maximum 3×3 (érosion et dilatation en niveaux de gris).
function filtre3(a, w, h, f) {
  const t = new Int16Array(a.length), s = new Int16Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      t[i] = f(f(a[i], x > 0 ? a[i - 1] : a[i]), x < w - 1 ? a[i + 1] : a[i]);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      s[i] = f(f(t[i], y > 0 ? t[i - w] : t[i]), y < h - 1 ? t[i + w] : t[i]);
    }
  return s;
}
function lisser(a, w, h) {
  const t = new Int16Array(a.length), s = new Int16Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      t[i] = (2 * a[i] + (x > 0 ? a[i - 1] : a[i]) + (x < w - 1 ? a[i + 1] : a[i])) >> 2;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      s[i] = (2 * t[i] + (y > 0 ? t[i - w] : t[i]) + (y < h - 1 ? t[i + w] : t[i])) >> 2;
    }
  return s;
}
const mini3 = (a, w, h) => filtre3(a, w, h, Math.min);
const maxi3 = (a, w, h) => filtre3(a, w, h, Math.max);

// Garde les composantes (8-connexité) d'au moins `min` pixels dans un masque binaire (modifié sur place).
function garderComposantes(m, w, h, min) {
  const vu = new Uint8Array(m.length);
  const pile = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || vu[i]) continue;
    const comp = [];
    vu[i] = 1;
    pile.push(i);
    while (pile.length) {
      const j = pile.pop();
      comp.push(j);
      const x = j % w, y = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (m[k] && !vu[k]) { vu[k] = 1; pile.push(k); }
        }
    }
    if (comp.length < min) for (const j of comp) m[j] = 0;
  }
}

// Supprime les composantes (4-connexité) d'une classe dont la surface est inférieure à min cellules : elles deviennent `remplacement`.
function filtrerPetites(classes, w2, h2, classe, min, remplacement) {
  const vu = new Uint8Array(classes.length);
  const pile = [];
  for (let i = 0; i < classes.length; i++) {
    if (classes[i] !== classe || vu[i]) continue;
    const comp = [];
    vu[i] = 1;
    pile.push(i);
    while (pile.length) {
      const j = pile.pop();
      comp.push(j);
      const x = j % w2;
      for (const k of [x > 0 ? j - 1 : -1, x < w2 - 1 ? j + 1 : -1, j - w2, j + w2]) {
        if (k >= 0 && k < classes.length && !vu[k] && classes[k] === classe) { vu[k] = 1; pile.push(k); }
      }
    }
    if (comp.length < min) for (const j of comp) classes[j] = remplacement;
  }
}

// hu : Int16Array (largeur × hauteur, UH) ; poumon : Uint8Array demi-résolution (≠ 0 = poumon) ; pixelMm : taille du pixel.
// Retourne un Uint8Array demi-résolution de CLASSES.
export function classerCoupe(hu, largeur, hauteur, poumon, pixelMm, p = PARAMETRES) {
  const w2 = largeur >> 1, h2 = hauteur >> 1;
  const classes = new Uint8Array(w2 * h2);
  if (!poumon.some((v) => v)) return classes;

  // Pixels denses, dilatés d'un pixel pour écarter l'effet de volume partiel autour des vaisseaux.
  const dense = new Uint8Array(largeur * hauteur);
  for (let i = 0; i < dense.length; i++) dense[i] = hu[i] > p.seuilDense ? 1 : 0;
  const denseDilate = new Uint8Array(dense.length);
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      const i = y * largeur + x;
      denseDilate[i] = dense[i] || (x > 0 && dense[i - 1]) || (x < largeur - 1 && dense[i + 1]) || (y > 0 && dense[i - largeur]) || (y < hauteur - 1 && dense[i + largeur]) ? 1 : 0;
    }
  // Structures fines brillantes (top-hat blanc) : réticulations et parois kystiques ; les vaisseaux plus larges que
  // largeurMaxFineMm sont conservés par l'ouverture et n'y apparaissent que par leurs bords.
  // Seuls les traits continus d'au moins longueurMinFineMm sont retenus : le bruit donne des pixels isolés.
  // Lissage préalable (2 passes binomiales 3×3) : le bruit des coupes fines basse dose mimerait des lignes.
  const lisse = lisser(lisser(hu, largeur, hauteur), largeur, hauteur);
  let ouverture = lisse;
  const passes = Math.max(1, Math.round(p.largeurMaxFineMm / pixelMm / 2)); // n passes 3×3 = élément (2n+1)²
  for (let k = 0; k < passes; k++) ouverture = mini3(ouverture, largeur, hauteur);
  for (let k = 0; k < passes; k++) ouverture = maxi3(ouverture, largeur, hauteur);
  const fin = new Uint8Array(hu.length);
  for (let i = 0; i < fin.length; i++) fin[i] = lisse[i] - ouverture[i] >= p.topHatMin ? 1 : 0;
  garderComposantes(fin, largeur, hauteur, Math.max(3, Math.round(p.longueurMinFineMm / pixelMm)));
  const Ifin = integrale(largeur, hauteur, (i) => fin[i]);
  const In = integrale(largeur, hauteur, (i) => (denseDilate[i] ? 0 : 1));
  const Is = integrale(largeur, hauteur, (i) => (denseDilate[i] ? 0 : hu[i]));
  const Idense = integrale(largeur, hauteur, (i) => dense[i]);

  const r = Math.max(2, Math.round(p.fenetreMm / pixelMm / 2));
  const rf = Math.max(2, Math.round(p.fenetreFibroseMm / pixelMm / 2));
  for (let y2 = 0; y2 < h2; y2++)
    for (let x2 = 0; x2 < w2; x2++) {
      const j = y2 * w2 + x2;
      if (!poumon[j]) continue;
      const cx = 2 * x2 + 1, cy = 2 * y2 + 1;
      const x0 = Math.max(0, cx - r), x1 = Math.min(largeur, cx + r + 1);
      const y0 = Math.max(0, cy - r), y1 = Math.min(hauteur, cy + r + 1);
      const total = (x1 - x0) * (y1 - y0);
      const fDense = rectangle(Idense, largeur, x0, y0, x1, y1) / total;
      const fx0 = Math.max(0, cx - rf), fx1 = Math.min(largeur, cx + rf + 1);
      const fy0 = Math.max(0, cy - rf), fy1 = Math.min(hauteur, cy + rf + 1);
      const fFin = rectangle(Ifin, largeur, fx0, fy0, fx1, fy1) / ((fx1 - fx0) * (fy1 - fy0));
      const n = rectangle(In, largeur, x0, y0, x1, y1);
      let c = CLASSES.NORMAL;
      if (fDense >= p.fractionCondensation) c = CLASSES.CONDENSATION;
      else if (fFin >= p.fractionStructuresFines) c = CLASSES.FIBROSE;
      else if (n >= 4 && rectangle(Is, largeur, x0, y0, x1, y1) / n >= p.moyenneVerreDepoli) c = CLASSES.VERRE_DEPOLI;
      classes[j] = c;
    }

  const cellule = (2 * pixelMm) ** 2; // mm² par cellule de demi-résolution
  filtrerPetites(classes, w2, h2, CLASSES.CONDENSATION, Math.ceil(p.surfaceMinCondensationMm2 / cellule), CLASSES.NORMAL);
  for (const k of [CLASSES.VERRE_DEPOLI, CLASSES.FIBROSE])
    filtrerPetites(classes, w2, h2, k, Math.ceil(p.surfaceMinLesionMm2 / cellule), CLASSES.NORMAL);
  return classes;
}

// Pourcentages de chaque lésion dans le poumon d'une ou plusieurs coupes.
export function proportions(listeClasses) {
  const n = [0, 0, 0, 0, 0];
  for (const classes of listeClasses) for (const c of classes) n[c]++;
  const poumon = n[1] + n[2] + n[3] + n[4];
  const pct = (k) => (poumon ? (100 * n[k]) / poumon : 0);
  return {
    cellules: poumon,
    verreDepoli: pct(CLASSES.VERRE_DEPOLI),
    fibrose: pct(CLASSES.FIBROSE),
    condensation: pct(CLASSES.CONDENSATION),
  };
}

// Analyse complète d'une pile en UH : segmentation (densitometrie.js) puis classification de chaque coupe.
// progression(fraction) : avancement entre 0 et 1.
// options.masques : masques pulmonaires déjà calculés (lungmask) ; sinon segmentation par seuillage.
export async function quantifierVolume(pile, geometrie, progression = () => {}, options = {}) {
  const densite = await analyserDensite(pile, geometrie, (n, total) => progression((2 * n) / (3 * total)), options);
  const pixelMm = geometrie.espacementPixel?.[1] || 1;
  const classes = [];
  for (let k = 0; k < pile.nombre; k++) {
    const c = await pile.coupe(k);
    classes.push(classerCoupe(c.donnees, c.largeur, c.hauteur, densite.masques[k], pixelMm));
    progression(2 / 3 + (k + 1) / (3 * pile.nombre));
    if (k % 8 === 0) await new Promise((ok) => setTimeout(ok));
  }
  return { densite, classes, largeurMasque: densite.largeurMasque, hauteurMasque: densite.hauteurMasque, volume: proportions(classes) };
}
