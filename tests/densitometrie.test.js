import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyserDensite } from '../js/densitometrie.js';

// Fantôme 96 × 96 × 10 coupes, pixels de 1 mm, coupes de 2 mm :
// air extérieur, corps à 40 UH, deux poumons rectangulaires à -850 UH,
// un vaisseau (40 UH) et un bloc de HAA (-400 UH) dans le poumon gauche, une bulle digestive isolée.
const W = 96, H = 96, N = 10;
const rect = (d, x0, x1, y0, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[y * W + x] = v; };
function coupe() {
  const d = new Int16Array(W * H).fill(-1000);
  rect(d, 2, 90, 4, 90, 40);
  rect(d, 8, 28, 12, 48, -850);
  rect(d, 50, 70, 12, 48, -850);
  rect(d, 20, 22, 18, 20, 40); // vaisseau
  rect(d, 12, 20, 24, 32, -400); // haute atténuation
  rect(d, 30, 40, 60, 66, -1000); // air digestif
  return { donnees: d, largeur: W, hauteur: H };
}
const pile = { nombre: N, coupe: async () => coupe() };

test('densitométrie : poumons segmentés, air digestif exclu, HAA exact', async () => {
  const r = await analyserDensite(pile, { espacementPixel: [1, 1], espacementCoupes: 2, epaisseur: 2 });
  const voxelsPoumon = 2 * 20 * 36 * N;
  assert.equal(r.voxels, voxelsPoumon);
  assert.equal(r.haaPourcent, (100 * 8 * 8 * N) / voxelsPoumon);
  assert.equal(r.volumeMl, (voxelsPoumon * 2) / 1000);
  assert.equal(r.haaMl, (8 * 8 * N * 2) / 1000);
  const attendu = (-850 * (voxelsPoumon - 640 - 40) + -400 * 640 + 40 * 40) / voxelsPoumon;
  assert.ok(Math.abs(r.densiteMoyenne - attendu) < 1e-9);
  assert.equal(r.masques.length, N);
  // Indices de Best 2003 sur les voxels ≤ -200 UH (le vaisseau à 40 UH est exclu) : loi à deux valeurs.
  const a = voxelsPoumon - 640 - 40, b = 640, p = b / (a + b);
  const proche = (x, y) => assert.ok(Math.abs(x - y) < 1e-6, `${x} ≠ ${y}`);
  // Bandes LCTA : -850 → aéré, -400 → collabé (borne basse incluse), 40 → vaisseaux.
  proche(r.bandes.aere, (100 * a) / voxelsPoumon);
  proche(r.bandes.collabe, (100 * b) / voxelsPoumon);
  proche(r.bandes.vaisseaux, (100 * 40) / voxelsPoumon);
  proche(r.bandes.infiltre, 0);
  proche(r.indices.mla, (-850 * a - 400 * b) / (a + b));
  proche(r.indices.asymetrie, (1 - 2 * p) / Math.sqrt(p * (1 - p)));
  proche(r.indices.kurtosis, (1 - 6 * p * (1 - p)) / (p * (1 - p)));
});

test('densitométrie : coupes non contiguës → pas de volume', async () => {
  const r = await analyserDensite(pile, { espacementPixel: [1, 1], espacementCoupes: 10, epaisseur: 1 });
  assert.equal(r.volumeMl, null);
  assert.equal(r.haaMl, null);
  assert.ok(r.haaPourcent > 0);
});

test('densitométrie : des centaines de milliers de petites bulles d’air ne font pas planter le calcul', async () => {
  // Corps à 40 UH criblé de bulles d'air isolées (une cellule de demi-résolution sur deux) : ≈ 250 000 composantes.
  const T = 512, N = 16;
  // Motif décalé d'une coupe à l'autre : les bulles ne se touchent pas non plus en 3D.
  const coupe = (k) => {
    const d = new Int16Array(T * T).fill(-1000);
    for (let y = 4; y < T - 4; y++) for (let x = 4; x < T - 4; x++) d[y * T + x] = ((x >> 1) % 2 === k % 2 && (y >> 1) % 2 === 0) ? -1000 : 40;
    return { donnees: d, largeur: T, hauteur: T };
  };
  const r = await analyserDensite({ nombre: N, coupe: async (k) => coupe(k) }, { espacementPixel: [1, 1], espacementCoupes: 1, epaisseur: 1 });
  assert.ok(r.masques.length === N);
});

// Masque demi-résolution plein (tout est « poumon ») : mesures directes sur des valeurs choisies.
const piletest = (valeurs, T = 16, N = 1) => ({
  nombre: N,
  coupe: async (k) => {
    const d = new Int16Array(T * T);
    for (let i = 0; i < d.length; i++) d[i] = valeurs[(k * T * T + i) % valeurs.length];
    return { donnees: d, largeur: T, hauteur: T };
  },
});
const plein = (T = 16, N = 1) => Array.from({ length: N }, () => new Uint8Array((T / 2) * (T / 2)).fill(1));

test('densitométrie : bornes des seuils HAA (incluses), des bandes [min ; max[ et de l’histogramme', async () => {
  // 16 valeurs, chacune sur 16 voxels.
  const v = [-1051, -1050, -950, -751, -750, -601, -600, -400, -250, -249, -200, -199, -1, 0, 2999, 3000];
  const r = await analyserDensite(piletest(v), { espacementPixel: [1, 1] }, () => {}, { masques: plein() });
  assert.equal(r.voxels, 256);
  assert.equal(r.haaPourcent, (100 * 3) / 16); // -600, -400, -250
  assert.equal(r.bandes.emphyseme, (100 * 1) / 16); // -1050
  assert.equal(r.bandes.aere, (100 * 2) / 16); // -950, -751
  assert.equal(r.bandes.infiltre, (100 * 3) / 16); // -750, -601, -600
  assert.equal(r.bandes.collabe, (100 * 6) / 16); // -400 … -1
  assert.equal(r.bandes.vaisseaux, (100 * 2) / 16); // 0, 2999 (3000 hors bande)
  const h = r.histogramme.valeurs;
  assert.equal(h.length, 100);
  assert.equal(h.reduce((a, b) => a + b, 0), 16 * 11); // de -1000 à -1 inclus
  assert.equal(h[0], 0); // -1000 absent
  assert.equal(h[Math.floor((-950 + 1000) / 10)], 16);
  assert.equal(h[99], 16); // -1
  // Indices de Best : voxels de -1024 à -200 UH inclus (-1051 et -199 exclus).
  const best = v.filter((x) => x >= -1024 && x <= -200);
  const m = best.reduce((a, b) => a + b, 0) / best.length;
  assert.ok(Math.abs(r.indices.mla - m) < 1e-9);
});

test('densitométrie : asymétrie et kurtosis exactes sur une loi uniforme discrète', async () => {
  // Uniforme sur -1000…-201 (800 valeurs) : asymétrie 0, kurtosis en excès -6(n²+1)/(5(n²-1)).
  const v = Array.from({ length: 800 }, (_, i) => -1000 + i);
  const r = await analyserDensite(piletest(v, 40, 2), { espacementPixel: [1, 1] }, () => {}, { masques: plein(40, 2) });
  const n = 800;
  assert.ok(Math.abs(r.indices.mla - -600.5) < 1e-9);
  assert.ok(Math.abs(r.indices.asymetrie) < 1e-12);
  assert.ok(Math.abs(r.indices.kurtosis - (-6 * (n * n + 1)) / (5 * (n * n - 1))) < 1e-12);
});

test('densitométrie : moments précis sur une distribution étroite et un grand nombre de voxels', async () => {
  // 4 millions de voxels à -950 ou -948 UH (moitié-moitié) : asymétrie 0, kurtosis en excès -2.
  const r = await analyserDensite(piletest([-950, -948], 512, 16), { espacementPixel: [1, 1] }, () => {}, { masques: plein(512, 16) });
  assert.equal(r.voxels, 512 * 512 * 16);
  assert.equal(r.indices.mla, -949);
  assert.ok(Math.abs(r.indices.asymetrie) < 1e-9);
  assert.ok(Math.abs(r.indices.kurtosis + 2) < 1e-9, String(r.indices.kurtosis));
});

test('densitométrie : volume avec pixels anisotropes ; taille de pixel inconnue → pas de volume', async () => {
  const geo = { espacementPixel: [0.5, 0.8], espacementCoupes: 1.25, epaisseur: 1.25 };
  const r = await analyserDensite(pile, geo);
  assert.ok(Math.abs(r.volumeMl - (r.voxels * 0.5 * 0.8 * 1.25) / 1000) < 1e-9);
  for (const espacementPixel of [null, [], [0, 0.7], [NaN, NaN]]) {
    const s = await analyserDensite(pile, { espacementPixel, espacementCoupes: 2, epaisseur: 2 });
    assert.equal(s.volumeMl, null);
    assert.equal(s.haaMl, null);
    assert.ok(s.haaPourcent > 0);
  }
  // Épaisseur inconnue : coupes supposées contiguës ; espacement inconnu : pas de volume.
  assert.ok((await analyserDensite(pile, { espacementPixel: [1, 1], espacementCoupes: 2 })).volumeMl > 0);
  assert.equal((await analyserDensite(pile, { espacementPixel: [1, 1], espacementCoupes: null, epaisseur: 2 })).volumeMl, null);
});

test('densitométrie : aucun poumon segmenté → valeurs nulles, jamais NaN', async () => {
  const corps = { nombre: 3, coupe: async () => ({ donnees: new Int16Array(64 * 64).fill(40), largeur: 64, hauteur: 64 }) };
  const r = await analyserDensite(corps, { espacementPixel: [1, 1], espacementCoupes: 1, epaisseur: 1 });
  assert.equal(r.voxels, 0);
  assert.equal(r.volumeMl, 0);
  assert.equal(r.densiteMoyenne, null);
  assert.equal(r.haaPourcent, null);
  assert.equal(r.indices, null);
  assert.ok(Object.values(r.bandes).every((b) => b === 0));
  // Pile vide.
  const vide = await analyserDensite({ nombre: 0, coupe: async () => null }, { espacementPixel: [1, 1] });
  assert.equal(vide.voxels, 0);
  assert.equal(vide.masques.length, 0);
});

test('densitométrie : progression croissante jusqu’à 100 %', async () => {
  const f = [];
  await analyserDensite(pile, { espacementPixel: [1, 1], espacementCoupes: 2, epaisseur: 2 }, (k, t) => f.push(k / t));
  assert.ok(f.every((x, i) => x > 0 && x <= 1 && (i === 0 || x >= f[i - 1])));
  assert.equal(f.at(-1), 1);
});

test('densitométrie : un poumon proche du bord de l’image n’est pas rogné par la fermeture', async () => {
  // Corps à 1 pixel du bord, poumon à 4 pixels (2 cellules de demi-résolution, < rayon de fermeture de 3 cellules).
  const T = 64;
  const d = new Int16Array(T * T).fill(-1000);
  for (let y = 2; y < T - 2; y++) for (let x = 2; x < T - 2; x++) d[y * T + x] = 40;
  for (let y = 4; y < 40; y++) for (let x = 4; x < 22; x++) d[y * T + x] = -850;
  const r = await analyserDensite({ nombre: 2, coupe: async () => ({ donnees: d, largeur: T, hauteur: T }) }, { espacementPixel: [1, 1], espacementCoupes: 1, epaisseur: 1 });
  assert.equal(r.voxels, 2 * 36 * 18);
});
