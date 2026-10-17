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
