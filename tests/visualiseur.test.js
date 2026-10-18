import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lutFenetre, deltaMolette, actionClavier, FENETRES } from '../js/visualiseur.js';

const gris = (lut, uh) => lut[uh + 32768];

test('LUT de fenêtre : bornes, centre et saturation', () => {
  const { largeur, centre } = FENETRES.poumon; // -1350 → 150 UH
  const lut = lutFenetre(largeur, centre);
  assert.equal(gris(lut, -1350), 0);
  assert.equal(gris(lut, -2000), 0);
  assert.equal(gris(lut, 150), 255);
  assert.equal(gris(lut, 3000), 255);
  assert.equal(gris(lut, centre), 128); // 127,5 arrondi
  assert.equal(gris(lut, -32768), 0);
  assert.equal(gris(lut, 32767), 255);
});

test('LUT de fenêtre inversée (MONOCHROME1)', () => {
  const lut = lutFenetre(350, 40, true);
  assert.equal(gris(lut, -500), 255);
  assert.equal(gris(lut, 500), 0);
});

test('molette : lignes et pages converties en pixels', () => {
  assert.equal(deltaMolette({ deltaY: 3, deltaMode: 0 }), 3);
  assert.equal(deltaMolette({ deltaY: 3, deltaMode: 1 }), 48);
  assert.equal(deltaMolette({ deltaY: -1, deltaMode: 2 }, 600), -600);
});

test('clavier : défilement, extrémités, zoom, réinitialisation', () => {
  assert.deepEqual(actionClavier({ key: 'ArrowDown' }), { type: 'pas', valeur: 1 });
  assert.deepEqual(actionClavier({ key: 'PageUp' }), { type: 'pas', valeur: -10 });
  assert.deepEqual(actionClavier({ key: 'Home' }), { type: 'debut' });
  assert.deepEqual(actionClavier({ key: 'End' }), { type: 'fin' });
  assert.equal(actionClavier({ key: '+' }).type, 'zoom');
  assert.ok(actionClavier({ key: '-' }).facteur < 1);
  assert.deepEqual(actionClavier({ key: '0' }), { type: 'reinit' });
  assert.equal(actionClavier({ key: 'a' }), null);
});

test('clavier : les raccourcis du navigateur ne sont pas interceptés', () => {
  assert.equal(actionClavier({ key: 'ArrowLeft', altKey: true }), null);
  assert.equal(actionClavier({ key: '+', ctrlKey: true }), null);
  assert.equal(actionClavier({ key: 'Home', metaKey: true }), null);
});
