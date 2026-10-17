import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goh, warrick, kazerooni } from '../js/scores.js';

test('Goh : moyenne des 5 niveaux et seuils 10 % / 30 % (Goh 2008)', () => {
  assert.deepEqual(goh([5, 5, 10, 10, 15]), { etendue: 9, scanner: 'minime', stade: 'limitée' });
  assert.deepEqual(goh([30, 35, 30, 30, 30]), { etendue: 31, scanner: 'sévère', stade: 'étendue' });
  assert.equal(goh([10, 10, 10, 10, 10]).scanner, 'indéterminée'); // 10 % inclus dans la zone indéterminée
  assert.equal(goh([30, 30, 30, 30, 30]).scanner, 'indéterminée'); // 30 % aussi
});

test('Goh : zone indéterminée tranchée par la CVF à 70 %', () => {
  assert.equal(goh([20, 20, 20, 20, 20]).stade, null);
  assert.equal(goh([20, 20, 20, 20, 20], 70).stade, 'limitée');
  assert.equal(goh([20, 20, 20, 20, 20], 69).stade, 'étendue');
});

test('Goh : entrées invalides refusées', () => {
  assert.throws(() => goh([10, 10, 10, 10]));
  assert.throws(() => goh([10, 10, 10, 10, 120]));
});

test('Warrick : sévérité, étendue et total (Warrick 1991)', () => {
  assert.deepEqual(warrick([0, 0, 0, 0, 0]), { severite: 0, etendue: 0, total: 0 });
  // Verre dépoli 4–9 segments (2), lignes 1–3 segments (1), rayon de miel > 9 segments (3)
  assert.deepEqual(warrick([2, 0, 1, 3, 0]), { severite: 1 + 3 + 4, etendue: 2 + 1 + 3, total: 14 });
  assert.deepEqual(warrick([3, 3, 3, 3, 3]), { severite: 15, etendue: 15, total: 30 });
  assert.throws(() => warrick([4, 0, 0, 0, 0]));
});

test('Kazerooni : moyennes et sommes par lobe (Kazerooni 1997)', () => {
  const r = kazerooni([0, 1, 2, 3, 4], [5, 0, 0, 0, 0]);
  assert.deepEqual(r, { verreDepoli: { moyenne: 2, somme: 10 }, fibrose: { moyenne: 1, somme: 5 } });
  assert.throws(() => kazerooni([0, 1, 2, 3, 6], [0, 0, 0, 0, 0]));
});
