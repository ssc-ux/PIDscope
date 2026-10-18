// Scores visuels d'étendue de la PID. Chaque fonction applique la définition de l'article original (voir REFERENCES).

export const REFERENCES = {
  goh: 'Goh NSL et al. Interstitial lung disease in systemic sclerosis: a simple staging system. Am J Respir Crit Care Med 2008;177:1248-54. doi:10.1164/rccm.200706-877OC',
  warrick: 'Warrick JH et al. High resolution computed tomography in early scleroderma lung disease. J Rheumatol 1991;18:1520-8. PMID 1765976',
  kazerooni: 'Kazerooni EA et al. Thin-section CT obtained at 10-mm increments versus limited three-level thin-section CT for idiopathic pulmonary fibrosis: correlation with pathologic scoring. AJR 1997;169:977-83. doi:10.2214/ajr.169.4.9308447',
  best: 'Best AC et al. Quantitative CT indexes in idiopathic pulmonary fibrosis: relationship with physiologic impairment. Radiology 2003;228:407-14. doi:10.1148/radiol.2282020274',
  camiciottoli: 'Camiciottoli G et al. Lung CT densitometry in systemic sclerosis: correlation with lung function, exercise testing, and quality of life. Chest 2007;131:672-81. doi:10.1378/chest.06-1401',
  haa2016: 'Podolanczuk AJ et al. High attenuation areas on chest computed tomography in community-dwelling adults: the MESA study. Eur Respir J 2016;48:1442-52. doi:10.1183/13993003.00129-2016',
  lungmask: 'Hofmanninger J et al. Automatic lung segmentation in routine imaging is primarily a data diversity problem, not a methodology problem. Eur Radiol Exp 2020;4:50. doi:10.1186/s41747-020-00173-2',
  haa: 'Lederer DJ et al. Cigarette smoking is associated with subclinical parenchymal lung disease: the MESA-Lung study. Am J Respir Crit Care Med 2009;180:407-14. doi:10.1164/rccm.200812-1966OC',
};

// ── Goh 2008 ────────────────────────────────────────────────────────────────
// Étendue estimée à 5 % près sur 5 niveaux ; étendue totale = moyenne des 5 niveaux.
export const NIVEAUX_GOH = [
  'Origine des gros vaisseaux',
  'Carène',
  'Confluence des veines pulmonaires',
  'À mi-distance entre le niveau 3 et le niveau 5',
  'Juste au-dessus de la coupole diaphragmatique droite',
];

// pourcentages : 5 valeurs (0–100). cvf : CVF en % de la théorique, ou null.
// < 10 % : atteinte minime → limitée ; > 30 % : atteinte sévère → étendue ;
// 10–30 % (bornes incluses) : indéterminée → CVF ≥ 70 % limitée, < 70 % étendue (algorithme de Goh 2008).
export function goh(pourcentages, cvf = null) {
  if (!Array.isArray(pourcentages) || pourcentages.length !== 5 || pourcentages.some((p) => !Number.isFinite(p) || p < 0 || p > 100))
    throw new RangeError('Goh : 5 pourcentages entre 0 et 100 sont attendus.');
  const etendue = pourcentages.reduce((a, b) => a + b, 0) / 5;
  if (etendue < 10) return { etendue, scanner: 'minime', stade: 'limitée' };
  if (etendue > 30) return { etendue, scanner: 'sévère', stade: 'étendue' };
  if (cvf == null || !Number.isFinite(cvf)) return { etendue, scanner: 'indéterminée', stade: null };
  return { etendue, scanner: 'indéterminée', stade: cvf >= 70 ? 'limitée' : 'étendue' };
}

// ── Warrick 1991 ────────────────────────────────────────────────────────────
// Sévérité : somme des points des lésions présentes (0–15).
// Étendue : pour chaque lésion, nombre de segments atteints : 1–3 → 1, 4–9 → 2, > 9 → 3 (0–15).
// Score total = sévérité + étendue (0–30).
export const LESIONS_WARRICK = [
  { nom: 'Verre dépoli', points: 1 },
  { nom: 'Irrégularité des contours pleuraux', points: 2 },
  { nom: 'Lignes septales ou sous-pleurales', points: 3 },
  { nom: 'Rayon de miel', points: 4 },
  { nom: 'Kystes sous-pleuraux', points: 5 },
];
export const CLASSES_SEGMENTS = ['Absent', '1 à 3 segments', '4 à 9 segments', 'Plus de 9 segments'];

// classes : pour chaque lésion, 0 (absente) à 3 (> 9 segments), dans l'ordre de LESIONS_WARRICK.
export function warrick(classes) {
  if (!Array.isArray(classes) || classes.length !== 5 || classes.some((c) => ![0, 1, 2, 3].includes(c)))
    throw new RangeError('Warrick : 5 classes entre 0 et 3 sont attendues.');
  const severite = classes.reduce((s, c, i) => s + (c > 0 ? LESIONS_WARRICK[i].points : 0), 0);
  const etendue = classes.reduce((s, c) => s + c, 0);
  return { severite, etendue, total: severite + etendue };
}

// ── Kazerooni 1997 ──────────────────────────────────────────────────────────
// Chaque lobe est coté de 0 à 5 pour le verre dépoli et pour la fibrose.
export const LOBES = ['Lobe supérieur droit', 'Lobe moyen', 'Lobe inférieur droit', 'Lobe supérieur gauche (avec lingula)', 'Lobe inférieur gauche'];
export const GRADES_VERRE_DEPOLI = ['0 : absent', '1 : < 5 % du lobe', '2 : 5 à 25 %', '3 : 26 à 50 %', '4 : 51 à 75 %', '5 : > 75 %'];
export const GRADES_FIBROSE = [
  '0 : absente',
  '1 : épaississement septal, sans rayon de miel',
  '2 : rayon de miel ≤ 25 % du lobe',
  '3 : rayon de miel 26 à 50 %',
  '4 : rayon de miel 51 à 75 %',
  '5 : rayon de miel > 75 %',
];

// verreDepoli, fibrose : 5 grades (0–5), un par lobe. Retourne les moyennes (0–5) et les sommes (0–25).
export function kazerooni(verreDepoli, fibrose) {
  for (const v of [verreDepoli, fibrose])
    if (!Array.isArray(v) || v.length !== 5 || v.some((g) => !Number.isInteger(g) || g < 0 || g > 5))
      throw new RangeError('Kazerooni : 5 grades entiers entre 0 et 5 sont attendus.');
  const somme = (v) => v.reduce((a, b) => a + b, 0);
  return {
    verreDepoli: { moyenne: somme(verreDepoli) / 5, somme: somme(verreDepoli) },
    fibrose: { moyenne: somme(fibrose) / 5, somme: somme(fibrose) },
  };
}
