import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { lireEntete, decoderPixels, construireSeries } from '../js/dicom.js';

globalThis.dicomParser = createRequire(import.meta.url)('../vendor/dicomParser.min.js');

const dossier = new URL('./fixtures/', import.meta.url);
const lire = (nom) => {
  const b = readFileSync(new URL(nom, dossier));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const fichiers = readdirSync(dossier).filter((f) => f !== 'generer.py');
const entrees = fichiers
  .map((nom) => ({ entete: lireEntete(lire(nom)), source: nom }))
  .filter((e) => e.entete);
const series = construireSeries(entrees);
const serie = (desc) => series.find((s) => s.description === desc);
const pixels = (e) => {
  const buf = lire(e.source);
  const { pixelOffset: o, pixelLongueur: l } = e.entete;
  return decoderPixels(e.entete, buf.slice(o, l == null ? undefined : o + l));
};

test('un fichier non DICOM est ignoré', () => {
  assert.equal(lireEntete(lire('pas_dicom.txt')), null);
});

test('les séries sont regroupées et les formats non pris en charge mis en dernier', () => {
  assert.deepEqual(series.map((s) => s.description), ['Thorax A', 'Thorax B', 'Thorax RLE', 'Thorax JPEG', 'Compressee']);
  assert.match(series[4].nonSupporte, /non pris en charge/);
  assert.equal(serie('Thorax RLE').nonSupporte, null);
  assert.equal(serie('Thorax JPEG').nonSupporte, null);
  assert.equal(serie('Thorax A').nonSupporte, null);
});

test('tri par position (apex en premier), pas le numéro d’instance ni l’ordre des fichiers', () => {
  const a = serie('Thorax A');
  assert.deepEqual(a.coupes.map((c) => c.source), ['a_0.dcm', 'a_1.dcm', 'a_2.dcm', 'a_3.dcm', 'a_4.dcm']);
  assert.equal(a.espacementCoupes, 2.5);
  assert.deepEqual(a.espacementPixel, [0.7, 0.7]);
  assert.equal(a.calibre, true);
  assert.deepEqual(a.alertes, []);
});

test('UH exactes : non signé 12 bits, intercept -1024 (explicit VR)', () => {
  serie('Thorax A').coupes.forEach((c, k) => {
    const d = pixels(c);
    for (let i = 0; i < d.length; i++) assert.equal(d[i], -1000 + 100 * k + (i % 8));
  });
});

for (const desc of ['Thorax RLE', 'Thorax JPEG']) {
  test(`UH exactes après décompression sans perte : ${desc}`, () => {
    serie(desc).coupes.forEach((c, k) => {
      const d = pixels(c);
      for (let i = 0; i < d.length; i++) assert.equal(d[i], -1000 + 100 * k + (i % 8));
    });
  });
}

test('UH exactes : signé 16 bits, pente 2, intercept -100 (implicit VR)', () => {
  const b = serie('Thorax B');
  assert.equal(b.espacementCoupes, 1);
  b.coupes.forEach((c, k) => {
    const d = pixels(c);
    for (let i = 0; i < d.length; i++) {
      const uh = -1000 + 100 * k + (i % 8);
      assert.equal(d[i], 2 * Math.floor((uh + 100) / 2) - 100);
    }
  });
});

test('signe et bits stockés : extension de signe sur 12 bits', () => {
  const m = { lignes: 1, colonnes: 3, bitsAlloues: 16, bitsStockes: 12, signe: true, pente: 1, ordonnee: 0 };
  // 0x0FFF = -1 sur 12 bits ; 0xF800 : bits hauts parasites ignorés → 0x800 = -2048 ; 0x07FF = 2047
  const d = decoderPixels(m, new Uint16Array([0x0fff, 0xf800, 0x07ff]).buffer);
  assert.deepEqual([...d], [-1, -2048, 2047]);
});

test('en-tête tronqué juste après Pixel Data : lecture identique', () => {
  const buf = lire('a_0.dcm');
  const complet = lireEntete(buf);
  const tronque = lireEntete(buf.slice(0, complet.pixelOffset));
  assert.equal(tronque.pixelOffset, complet.pixelOffset);
  assert.equal(tronque.pixelLongueur, complet.pixelLongueur);
});

test('coupes à positions irrégulières : alerte', () => {
  const a = serie('Thorax A');
  const sansUne = a.coupes.filter((c) => c.source !== 'a_2.dcm').map(({ entete, source }) => ({ entete, source }));
  assert.match(construireSeries(sansUne)[0].alertes.join(), /irrégulier/);
});
