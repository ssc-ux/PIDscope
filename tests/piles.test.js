import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { analyserFichiers, PileDicom, PileFichiersImage, pileUHDepuisFenetrePoumon } from '../js/piles.js';

globalThis.dicomParser = createRequire(import.meta.url)('../vendor/dicomParser.min.js');

const dossier = new URL('./fixtures/', import.meta.url);
const fichier = (nom, type = '') => new File([readFileSync(new URL(nom, dossier))], nom, { type });
const fixtures = readdirSync(dossier).filter((f) => f !== 'generer.py').map((n) => fichier(n));
const uhAttendu = (k, i) => -1000 + 100 * k + (i % 8);

// Bitmap factice : compte les fermetures.
const bitmaps = [];
globalThis.createImageBitmap = async (source) => {
  const b = { width: 2, height: 1, source, ferme: false, close() { this.ferme = true; } };
  bitmaps.push(b);
  return b;
};

test('analyserFichiers : séries, images, fichiers ignorés et progression', async () => {
  const etapes = [];
  const illisible = { name: 'verrouille.dcm', type: '', size: 10, slice() { return { arrayBuffer: () => Promise.reject(new Error('NotReadableError')) }; } };
  const tous = [...fixtures, new File([], 'photo.png', { type: 'image/png' }), illisible];
  const r = await analyserFichiers(tous, (n, total) => etapes.push([n, total]));
  assert.equal(etapes.length, tous.length);
  assert.deepEqual(etapes.at(-1), [tous.length, tous.length]);
  assert.deepEqual(r.images.map((f) => f.name), ['photo.png']);
  assert.equal(r.ignores, 4, 'pas_dicom.txt, vide.dcm, faux_brut.bin et le fichier inaccessible');
  assert.equal(r.series.length, 13);
});

test('analyserFichiers : fichier tronqué écarté de sa série avec une alerte', async () => {
  const { series } = await analyserFichiers(fixtures.filter((f) => f.name.startsWith('h_')));
  const [h] = series;
  assert.equal(h.nonSupporte, null);
  assert.deepEqual(h.coupes.map((c) => c.source.name), ['h_0.dcm', 'h_1.dcm', 'h_2.dcm', 'h_3.dcm']);
  assert.match(h.alertes.join(' '), /1 image\(s\) illisible\(s\) écartée\(s\) : Fichier incomplet/);
  assert.match(h.alertes.join(' '), /en double/);
});

test('analyserFichiers : liste vide ou itérable', async () => {
  assert.deepEqual(await analyserFichiers([]), { series: [], images: [], ignores: 0 });
  const r = await analyserFichiers(new Set([fichier('a_0.dcm')]));
  assert.equal(r.series.length, 1);
});

test('PileDicom : UH exactes, légende, index hors limites', async () => {
  const { series } = await analyserFichiers(fixtures.filter((f) => /^[ae]_/.test(f.name)));
  for (const s of series) {
    const pile = new PileDicom(s);
    assert.equal(pile.nombre, 5);
    assert.equal(pile.legende(0), 'z = 50.0 mm');
    for (let k = 0; k < pile.nombre; k++) {
      const c = await pile.coupe(k);
      assert.equal(c.type, 'uh');
      assert.equal(c.largeur, 8);
      for (let i = 0; i < c.donnees.length; i++) assert.equal(c.donnees[i], uhAttendu(k, i));
    }
    assert.equal(pile.coupe(2), pile.coupe(2), 'coupe mise en cache');
    await assert.rejects(pile.coupe(5), /Coupe 5 inexistante \(série de 5 coupe\(s\)\)/);
    await assert.rejects(pile.coupe(-1), RangeError);
  }
});

test('PileDicom : série refusée ou vide → erreur claire', async () => {
  const { series } = await analyserFichiers([fichier('c_compresse.dcm')]);
  assert.throws(() => new PileDicom(series[0]), /JPEG 2000/);
  assert.throws(() => new PileDicom({ coupes: [] }), /Série DICOM vide/);
});

test('PileDicom : coupe illisible → message avec numéro et nom du fichier, nouvel essai possible', async () => {
  const { series } = await analyserFichiers([fichier('a_0.dcm'), fichier('a_1.dcm')]);
  const pile = new PileDicom(series[0]);
  const vrai = pile.serie.coupes[1].source;
  let essais = 0;
  pile.serie.coupes[1].source = {
    name: 'a_1.dcm',
    slice: (...a) => (++essais === 1 ? new Blob([new Uint8Array(10)]) : vrai.slice(...a)),
  };
  await assert.rejects(pile.coupe(1), /Coupe 2 \/ 2 illisible \(a_1\.dcm\) : Données de pixels incomplètes/);
  await new Promise((r) => setTimeout(r, 0));
  const c = await pile.coupe(1); // l'échec n'est pas resté en cache
  assert.equal(c.donnees[0], uhAttendu(1, 0));
});

test('PileFichiersImage : tri naturel, bitmaps évincés du cache fermés', async () => {
  bitmaps.length = 0;
  const noms = Array.from({ length: 130 }, (_, i) => `img${i}.png`);
  const pile = new PileFichiersImage([...noms].reverse().map((n) => new File([], n, { type: 'image/png' })));
  assert.deepEqual(pile.sources.slice(0, 3).map((f) => f.name), ['img0.png', 'img1.png', 'img2.png']);
  const premiere = await pile.coupe(0);
  assert.equal(premiere.type, 'image');
  for (let i = 1; i < 130; i++) await pile.coupe(i);
  await new Promise((r) => setTimeout(r, 0));
  // 130 coupes pour 128 places : les 2 plus anciennes sont fermées, les autres intactes.
  assert.deepEqual(bitmaps.filter((b) => b.ferme).map((b) => b.source.name), ['img0.png', 'img1.png']);
  assert.equal(pile.cache.m.size, 128);
  const rechargee = await pile.coupe(0);
  assert.notEqual(rechargee, premiere);
  assert.equal(rechargee.image.ferme, false);
});

test('pileUHDepuisFenetrePoumon : bitmap fermé après lecture des pixels', async () => {
  bitmaps.length = 0;
  const ancien = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage() {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255].slice(0, w * h * 4)) }),
      }),
    }),
  };
  try {
    const pile = { urlsParFenetre: { poumon: ['u0', 'u1'] }, pixelMm: 0.7, espacementCoupes: 5, charger: (u) => createImageBitmap(u) };
    const uh = pileUHDepuisFenetrePoumon(pile);
    const c = await uh.coupe(1);
    assert.deepEqual([...c.donnees], [-1350, 150]);
    assert.equal(bitmaps.length, 1);
    assert.equal(bitmaps[0].ferme, true);
  } finally {
    globalThis.document = ancien;
  }
});
