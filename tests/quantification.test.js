import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classerCoupe, proportions, CLASSES } from '../js/quantification.js';

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
