import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classerCoupe, proportions, quantifierVolume, CLASSES, PARAMETRES } from '../js/quantification.js';

// Coupe synthétique 128 × 128, pixels de 0,7 mm, entièrement « poumon » (masque demi-résolution plein),
// découpée en 4 quadrants : normal, verre dépoli, réticulations, condensation. Bruit gaussien de 30 UH.
const W = 128, PX = 0.7;
let graine = 7;
const alea = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
const bruit = () => 30 * Math.sqrt(-2 * Math.log(alea() + 1e-12)) * Math.cos(2 * Math.PI * alea());
function coupe() {
  const hu = new Int16Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      let v;
      if (x < 64 && y < 64) v = (x - 20) ** 2 + (y - 30) ** 2 < 4 ? 40 : -850; // normal + un petit vaisseau
      else if (x >= 64 && y < 64) v = -550; // verre dépoli
      else if (x < 64) v = x % 5 === 0 || y % 5 === 0 ? -100 : -700; // réseau de lignes (≈ 3,5 mm)
      else v = 30; // condensation
      hu[y * W + x] = Math.round(v + bruit());
    }
  return hu;
}
const masque = new Uint8Array((W / 2) * (W / 2)).fill(1);
const classes = classerCoupe(coupe(), W, W, masque, PX);
const quadrant = (qx, qy) => {
  const n = [0, 0, 0, 0, 0];
  // Centre du quadrant seulement (les fenêtres d'analyse débordent sur les quadrants voisins près des limites).
  for (let y = qy * 32 + 10; y < qy * 32 + 22; y++) for (let x = qx * 32 + 10; x < qx * 32 + 22; x++) n[classes[y * 64 + x]]++;
  return n.indexOf(Math.max(...n));
};

test('quantification : chaque quadrant reçoit la bonne classe', () => {
  assert.equal(quadrant(0, 0), CLASSES.NORMAL);
  assert.equal(quadrant(1, 0), CLASSES.VERRE_DEPOLI);
  assert.equal(quadrant(0, 1), CLASSES.FIBROSE);
  assert.equal(quadrant(1, 1), CLASSES.CONDENSATION);
});

test('quantification : un petit vaisseau isolé n’est pas une condensation', () => {
  for (let y = 12; y < 18; y++) for (let x = 7; x < 13; x++) assert.notEqual(classes[y * 64 + x], CLASSES.CONDENSATION);
});

test('quantification : hors du masque pulmonaire, rien n’est compté', () => {
  const vide = classerCoupe(coupe(), W, W, new Uint8Array(64 * 64), PX);
  assert.ok(vide.every((c) => c === CLASSES.HORS));
  assert.equal(proportions([vide]).cellules, 0);
});

test('proportions : pourcentages par rapport au poumon', () => {
  const c = Uint8Array.from([0, 1, 1, 2, 3, 4, 4, 4]);
  assert.deepEqual(proportions([c]), { cellules: 7, verreDepoli: 100 / 7, fibrose: 100 / 7, condensation: 300 / 7 });
});

test('proportions : plusieurs coupes cumulées, coupes absentes (null) ignorées', () => {
  const a = Uint8Array.from([1, 1, 2, 0]), b = Uint8Array.from([3, 4, 0, 0]);
  assert.deepEqual(proportions([a, null, b]), { cellules: 5, verreDepoli: 20, fibrose: 20, condensation: 20 });
  assert.deepEqual(proportions([]), { cellules: 0, verreDepoli: 0, fibrose: 0, condensation: 0 });
});

test('quantification : parenchyme homogène sans bruit → normal ou verre dépoli partout', () => {
  const T = 64, m = new Uint8Array((T / 2) * (T / 2)).fill(1);
  for (const [uh, classe] of [[-850, CLASSES.NORMAL], [-550, CLASSES.VERRE_DEPOLI], [PARAMETRES.moyenneVerreDepoli, CLASSES.VERRE_DEPOLI]]) {
    const c = classerCoupe(new Int16Array(T * T).fill(uh), T, T, m, 1);
    assert.ok(c.every((v) => v === classe), `${uh} UH`);
  }
});

test('quantification : surface minimale de condensation exprimée en mm²', () => {
  // Pixels de 1 mm : un bloc dense de 6 × 6 mm (36 mm² < 100 mm²) n'est pas une condensation, un bloc de 24 × 24 mm l'est.
  const T = 96, m = new Uint8Array((T / 2) * (T / 2)).fill(1);
  const bloc = (cote) => {
    const hu = new Int16Array(T * T).fill(-850);
    for (let y = 30; y < 30 + cote; y++) for (let x = 30; x < 30 + cote; x++) hu[y * T + x] = 30;
    return classerCoupe(hu, T, T, m, 1);
  };
  assert.ok(!bloc(6).includes(CLASSES.CONDENSATION));
  const grand = bloc(24);
  assert.equal(grand[(42 >> 1) * (T / 2) + (42 >> 1)], CLASSES.CONDENSATION);
});

test('quantifierVolume : une classification par coupe, progression de 0 à 1', async () => {
  const T = 64, N = 4;
  const d = new Int16Array(T * T).fill(-1000);
  for (let y = 2; y < T - 2; y++) for (let x = 2; x < T - 2; x++) d[y * T + x] = 40;
  for (let y = 10; y < 50; y++) for (let x = 4; x < 22; x++) d[y * T + x] = -850;
  for (let y = 10; y < 50; y++) for (let x = 42; x < 60; x++) d[y * T + x] = -550;
  const pile = { nombre: N, coupe: async () => ({ donnees: d, largeur: T, hauteur: T }) };
  const f = [];
  const r = await quantifierVolume(pile, { espacementPixel: [1, 1], espacementCoupes: 1, epaisseur: 1 }, (x) => f.push(x));
  assert.equal(r.classes.length, N);
  assert.equal(r.densite.voxels, 2 * 40 * 18 * N);
  assert.ok(f.every((x, i) => x >= 0 && x <= 1 && (i === 0 || x >= f[i - 1] - 1e-12)));
  assert.ok(Math.abs(f.at(-1) - 1) < 1e-12);
  // Un poumon normal, l'autre en verre dépoli : ≈ 50 % de verre dépoli.
  assert.ok(Math.abs(r.volume.verreDepoli - 50) < 10, String(r.volume.verreDepoli));
  assert.equal(r.volume.condensation, 0);
});
