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
  assert.equal(lireEntete(lire('vide.dcm')), null);
  assert.equal(lireEntete(lire('faux_brut.bin')), null, 'binaire commençant par 0008 : pas un DICOM brut');
  assert.equal(lireEntete(new ArrayBuffer(0)), null);
  assert.equal(lireEntete(undefined), null);
});

test('les séries sont regroupées et les formats non pris en charge mis en dernier', () => {
  assert.deepEqual(series.map((s) => s.description), [
    'Thorax A', 'Thorax B', 'Thorax RLE', 'Thorax JPEG', 'Thorax H', 'Thorax BE', 'Sans position',
    'Sans preambule', 'Bit haut', 'Huit bits', 'Compressee', 'JPEG perte', 'Couleur',
  ]);
  for (const d of ['Thorax A', 'Thorax B', 'Thorax RLE', 'Thorax JPEG', 'Thorax H', 'Thorax BE', 'Sans position', 'Sans preambule', 'Bit haut', 'Huit bits'])
    assert.equal(serie(d).nonSupporte, null, d);
});

test('formats refusés : message clair en français, nommant le format', () => {
  assert.match(serie('Compressee').nonSupporte, /non pris en charge \(JPEG 2000 sans perte, 1\.2\.840\.10008\.1\.2\.4\.90\).*non compressé/);
  assert.match(serie('JPEG perte').nonSupporte, /JPEG Baseline, avec perte/);
  assert.match(serie('Couleur').nonSupporte, /Image couleur \(RGB\)/);
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

// --- Cas limites ajoutés -------------------------------------------------------------------------

const uhAttendu = (k, i) => -1000 + 100 * k + (i % 8);
const verifierUH = (s) => s.coupes.forEach((c, k) => {
  const d = pixels(c);
  for (let i = 0; i < d.length; i++) assert.equal(d[i], uhAttendu(k, i), `${c.source}[${i}]`);
});

test('Explicit VR Big Endian : octets permutés, UH exactes (signé 16 bits)', () => {
  const s = serie('Thorax BE');
  assert.equal(s.coupes[0].entete.grosBoutiste, true);
  assert.deepEqual(s.coupes.map((c) => c.source), ['f_0.dcm', 'f_1.dcm', 'f_2.dcm']);
  verifierUH(s);
});

test('sans position ni Rescale ni BitsStored : tri par instance, pas déclaré, alertes', () => {
  const s = serie('Sans position');
  assert.deepEqual(s.coupes.map((c) => c.source), ['g_0.dcm', 'g_1.dcm', 'g_2.dcm']);
  assert.equal(s.espacementCoupes, 3, 'SpacingBetweenSlices utilisé à défaut de positions');
  assert.equal(s.coupes[0].z, null);
  assert.match(s.alertes.join(), /numéro d’instance/);
  assert.match(s.alertes.join(), /Rescale\) absentes/);
  const m = s.coupes[0].entete;
  assert.equal(m.pente, 1);
  assert.equal(m.ordonnee, 0);
  assert.equal(m.recalibrageAbsent, true);
  assert.equal(m.bitsStockes, 16);
  verifierUH(s);
});

test('série avec doublon, fichier tronqué et épaisseurs incohérentes', () => {
  const s = serie('Thorax H');
  assert.deepEqual(s.coupes.map((c) => c.source), ['h_0.dcm', 'h_1.dcm', 'h_2.dcm', 'h_3.dcm', 'h_4.dcm']);
  assert.match(s.alertes.join(), /1 fichier\(s\) en double ignoré/);
  assert.match(s.alertes.join(), /Épaisseurs de coupe différentes dans la série \(1,25 \/ 2,5 mm\)/);
  assert.equal(s.epaisseur, 1.25, 'épaisseur majoritaire');
  assert.equal(s.espacementCoupes, 2.5);
  // L'en-tête seul ne permet pas de voir la troncature (lecture partielle) : le décodage la signale.
  assert.throws(() => pixels(s.coupes[4]), /Données de pixels incomplètes : 108 octets lus, 128 attendus/);
});

test('fichier sans préambule « DICM » : lu comme implicit VR little endian', () => {
  const s = serie('Sans preambule');
  assert.equal(s.coupes[0].entete.transferSyntax, '1.2.840.10008.1.2');
  verifierUH(s);
});

test('bits stockés alignés à gauche (High Bit 15, Bits Stored 12)', () => {
  const s = serie('Bit haut');
  assert.equal(s.coupes[0].entete.bitHaut, 15);
  verifierUH(s);
});

test('IRM 8 bits sans Rescale : non calibrée, pas d’alerte UH', () => {
  const s = serie('Huit bits');
  assert.equal(s.calibre, false);
  assert.deepEqual(s.alertes, []);
  const d = pixels(s.coupes[0]);
  for (let i = 0; i < d.length; i++) assert.equal(d[i], 200 + (i % 8));
});

// --- decoderPixels sur des données synthétiques ---

const meta = (x = {}) => ({ lignes: 1, colonnes: 4, bitsAlloues: 16, bitsStockes: 16, signe: false, pente: 1, ordonnee: 0, ...x });

test('decoderPixels : données incomplètes → erreur claire, jamais de RangeError', () => {
  assert.throws(() => decoderPixels(meta(), new ArrayBuffer(7)), /Données de pixels incomplètes : 7 octets lus, 8 attendus/);
  assert.throws(() => decoderPixels(meta({ colonnes: 0 }), new ArrayBuffer(8)), /Dimensions/);
  assert.throws(() => decoderPixels(meta({ bitsAlloues: 32 }), new ArrayBuffer(16)), /32 bits/);
});

test('decoderPixels : 8 bits signé, pente nulle ignorée, typed array accepté', () => {
  const d = decoderPixels(meta({ bitsAlloues: 8, bitsStockes: 8, signe: true, pente: 0, ordonnee: 10 }), new Uint8Array([0, 127, 128, 255]));
  assert.deepEqual([...d], [10, 137, -118, 9]);
});

test('decoderPixels : big endian, bit haut, bits stockés > bits alloués, saturation Int16', () => {
  const be = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80, 0x00, 0x7f, 0xff]);
  assert.deepEqual([...decoderPixels(meta({ signe: true, grosBoutiste: true }), be)], [-2, 1, -32768, 32767]);
  const haut = new Uint16Array([0x0010, 0xfff0, 0x8000, 0x000f]); // 12 bits en position 15..4
  assert.deepEqual([...decoderPixels(meta({ bitsStockes: 12, bitHaut: 15 }), haut)], [1, 4095, 2048, 0]);
  assert.deepEqual([...decoderPixels(meta({ bitsStockes: 20 }), new Uint16Array([1, 2, 3, 65535]))], [1, 2, 3, 32767]);
  assert.deepEqual([...decoderPixels(meta({ pente: 1e6 }), new Uint16Array([1, 0, 0, 0]))], [32767, 0, 0, 0]);
});

test('données compressées corrompues ou tronquées : erreurs explicites', () => {
  const rle = serie('Thorax RLE').coupes[0];
  const jpeg = serie('Thorax JPEG').coupes[0];
  const brut = (e) => lire(e.source).slice(e.entete.pixelOffset);
  // Fichier tronqué au milieu d'un fragment.
  assert.throws(() => decoderPixels(rle.entete, brut(rle).slice(0, 40)), /tronquées/);
  // Aucun fragment après la table d'offsets.
  assert.throws(() => decoderPixels(rle.entete, new Uint32Array([0xe000fffe, 0, 0xe0ddfffe, 0]).buffer), /Aucune image/);
  // RLE : table des segments incohérente.
  const r = new Uint8Array(brut(rle));
  const debutFragment = 16 + new DataView(r.buffer).getUint32(4, true); // table d'offsets (8 + longueur) puis en-tête d'item (8)
  new DataView(r.buffer).setUint32(debutFragment + 4, 0xffff, true);
  assert.throws(() => decoderPixels(rle.entete, r.buffer), /RLE : table des segments invalide/);
  // JPEG : dimensions différentes de l'en-tête DICOM.
  assert.throws(() => decoderPixels({ ...jpeg.entete, colonnes: 4, lignes: 16 }, brut(jpeg)), /JPEG Lossless : image de 8 × 8 pixels, 4 × 16/);
  // JPEG : flux illisible.
  const j = new Uint8Array(brut(jpeg));
  j.fill(0x11, 24, 40);
  assert.throws(() => decoderPixels(jpeg.entete, j.buffer), /JPEG/);
});

// --- construireSeries sur des en-têtes synthétiques ---

const entete = (x = {}) => ({
  serieUID: '1.2.3', serieDescription: 'S', serieNumero: 1, modalite: 'CT', typeImage: 'ORIGINAL\\PRIMARY\\AXIAL',
  lignes: 8, colonnes: 8, orientation: [1, 0, 0, 0, 1, 0], espacementPixel: [0.7, 0.7], epaisseur: 1, position: null,
  numeroInstance: null, nonSupporte: null, recalibrageAbsent: false, ...x,
});
const a = (source, x) => ({ entete: entete(x), source });

test('séries sans UID séparées par numéro ; entrées invalides ignorées', () => {
  const s = construireSeries([
    a('1', { serieUID: 'inconnue', serieNumero: 3, position: [0, 0, 0] }),
    a('2', { serieUID: 'inconnue', serieNumero: 4, position: [0, 0, 0] }),
    a('3', { serieUID: 'inconnue', serieNumero: 3, position: [0, 0, 1] }),
    { entete: null, source: 'x' },
  ]);
  assert.deepEqual(s.map((x) => [x.numero, x.coupes.map((c) => c.source)]), [[3, ['3', '1']], [4, ['2']]]);
});

test('tri : z puis instance à égalité ; repérage écarté ; doublons et espacement irrégulier signalés', () => {
  const s = construireSeries([
    a('bas', { position: [0, 0, -10], numeroInstance: 3 }),
    a('haut-b', { position: [0, 0, 0], numeroInstance: 2 }),
    a('haut-a', { position: [0, 0, 0], numeroInstance: 1 }),
    a('milieu', { position: [0, 0, -9], numeroInstance: 4 }),
    a('scout', { lignes: 512, position: [0, 0, 5] }),
  ])[0];
  assert.deepEqual(s.coupes.map((c) => c.source), ['haut-a', 'haut-b', 'milieu', 'bas']);
  assert.match(s.alertes.join(), /1 image\(s\) de géométrie différente/);
  assert.match(s.alertes.join(), /même position/);
  const t = construireSeries([0, -2, -4, -4.5, -6.5].map((z, i) => a(`${i}`, { position: [0, 0, z] })))[0];
  assert.equal(t.espacementCoupes, 2);
  assert.match(t.alertes.join(), /Espacement irrégulier entre les coupes/);
});

test('orientation absente mais positions présentes : coupes supposées axiales', () => {
  const s = construireSeries([a('b', { orientation: null, position: [0, 0, -5] }), a('h', { orientation: null, position: [0, 0, 5] })])[0];
  assert.deepEqual(s.coupes.map((c) => c.source), ['h', 'b']);
  assert.equal(s.espacementCoupes, 10);
  assert.match(s.alertes.join(), /supposées axiales/);
});

test('ni position ni numéro : ordre naturel des noms de fichiers, alerte', () => {
  const s = construireSeries(['IM10', 'IM9', 'IM100'].map((n) => a(n)))[0];
  assert.deepEqual(s.coupes.map((c) => c.source), ['IM9', 'IM10', 'IM100']);
  assert.match(s.alertes.join(), /ordre selon le nom des fichiers/);
});

test('images illisibles : écartées si d’autres sont lisibles, sinon série refusée', () => {
  const mixte = construireSeries([
    a('ok1', { position: [0, 0, 0] }), a('ok2', { position: [0, 0, -1] }),
    a('ko', { position: [0, 0, -2], nonSupporte: 'Fichier incomplet.' }),
  ])[0];
  assert.equal(mixte.nonSupporte, null);
  assert.deepEqual(mixte.coupes.map((c) => c.source), ['ok1', 'ok2']);
  assert.match(mixte.alertes.join(), /1 image\(s\) illisible\(s\) écartée\(s\) : Fichier incomplet/);
  const refusee = construireSeries([a('k1', { nonSupporte: 'Format refusé.' }), a('k2', { nonSupporte: 'Format refusé.' })])[0];
  assert.equal(refusee.nonSupporte, 'Format refusé.');
  assert.equal(refusee.coupes.length, 2);
});
