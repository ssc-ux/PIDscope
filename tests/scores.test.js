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

import { REFERENCES, NIVEAUX_GOH, LESIONS_WARRICK, CLASSES_SEGMENTS, LOBES, GRADES_VERRE_DEPOLI, GRADES_FIBROSE } from '../js/scores.js';

test('Goh : bornes exactes des seuils 10 % et 30 %', () => {
  assert.equal(goh([9, 9, 9, 9, 9]).scanner, 'minime');
  assert.equal(goh([10, 10, 10, 10, 5]).scanner, 'minime'); // 9 %
  assert.equal(goh([30, 30, 30, 30, 35]).scanner, 'sévère'); // 31 %
  assert.equal(goh([0, 0, 0, 0, 0]).etendue, 0);
  assert.deepEqual(goh([100, 100, 100, 100, 100]), { etendue: 100, scanner: 'sévère', stade: 'étendue' });
});

test('Goh : la CVF ne modifie pas les stades minime et sévère', () => {
  assert.equal(goh([5, 5, 5, 5, 5], 40).stade, 'limitée');
  assert.equal(goh([50, 50, 50, 50, 50], 110).stade, 'étendue');
});

test('Goh : CVF absente ou non numérique → stade non tranché', () => {
  assert.equal(goh([20, 20, 20, 20, 20], NaN).stade, null);
  assert.equal(goh([20, 20, 20, 20, 20], undefined).stade, null);
  assert.equal(goh([20, 20, 20, 20, 20], Infinity).stade, null);
});

test('Goh : entrées non conformes', () => {
  assert.throws(() => goh(null), RangeError);
  assert.throws(() => goh('12345'), RangeError);
  assert.throws(() => goh([10, 10, 10, 10, 10, 10]), RangeError);
  assert.throws(() => goh([10, 10, 10, 10, -5]), RangeError);
  assert.throws(() => goh([10, 10, 10, 10, NaN]), RangeError);
  assert.throws(() => goh([10, 10, 10, 10, '10']), RangeError);
});

test('Warrick : points de sévérité 1 à 5 selon la lésion (Warrick 1991)', () => {
  for (let i = 0; i < 5; i++) {
    const classes = [0, 0, 0, 0, 0];
    classes[i] = 1;
    assert.deepEqual(warrick(classes), { severite: i + 1, etendue: 1, total: i + 2 });
  }
  assert.deepEqual(LESIONS_WARRICK.map((l) => l.points), [1, 2, 3, 4, 5]);
});

test('Warrick : la sévérité ne dépend pas du nombre de segments', () => {
  assert.equal(warrick([1, 0, 0, 0, 0]).severite, warrick([3, 0, 0, 0, 0]).severite);
  assert.equal(warrick([0, 0, 0, 2, 0]).etendue, 2);
});

test('Warrick : entrées non conformes', () => {
  assert.throws(() => warrick([0, 0, 0, 0]), RangeError);
  assert.throws(() => warrick([0, 0, 0, 0, -1]), RangeError);
  assert.throws(() => warrick([0, 0, 0, 0, 1.5]), RangeError);
  assert.throws(() => warrick([0, 0, 0, 0, '1']), RangeError);
  assert.throws(() => warrick(undefined), RangeError);
});

test('Kazerooni : bornes 0 et 5 par lobe', () => {
  assert.deepEqual(kazerooni([0, 0, 0, 0, 0], [0, 0, 0, 0, 0]), { verreDepoli: { moyenne: 0, somme: 0 }, fibrose: { moyenne: 0, somme: 0 } });
  assert.deepEqual(kazerooni([5, 5, 5, 5, 5], [5, 5, 5, 5, 5]), { verreDepoli: { moyenne: 5, somme: 25 }, fibrose: { moyenne: 5, somme: 25 } });
});

test('Kazerooni : entrées non conformes', () => {
  assert.throws(() => kazerooni([0, 0, 0, 0], [0, 0, 0, 0, 0]), RangeError);
  assert.throws(() => kazerooni([0, 0, 0, 0, 0], [0, 0, 0, 0, 2.5]), RangeError);
  assert.throws(() => kazerooni([0, 0, 0, 0, 0], [0, 0, 0, 0, -1]), RangeError);
  assert.throws(() => kazerooni(null, [0, 0, 0, 0, 0]), RangeError);
});

test('Libellés cohérents avec les formules', () => {
  assert.equal(NIVEAUX_GOH.length, 5);
  assert.equal(CLASSES_SEGMENTS.length, 4); // classes 0 à 3
  assert.equal(LOBES.length, 5);
  assert.equal(GRADES_VERRE_DEPOLI.length, 6); // grades 0 à 5
  assert.equal(GRADES_FIBROSE.length, 6);
  for (const cle of ['goh', 'warrick', 'kazerooni']) assert.match(REFERENCES[cle], /\d{4}/);
});
