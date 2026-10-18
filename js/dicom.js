// Lecture DICOM : en-têtes, décodage des pixels en unités Hounsfield, regroupement en séries.
// Tout se fait localement dans le navigateur. Formats acceptés : non compressé (little ou big endian),
// JPEG Lossless et RLE Lossless (sans perte). Les autres sont refusés clairement plutôt qu'affichés faussement.

import { Decoder as DecodeurJpegLossless } from '../vendor/jpeg-lossless.mjs';

const dp = () => globalThis.dicomParser;

const IMPLICIT_LE = '1.2.840.10008.1.2';

export const TRANSFER_SYNTAXES_SUPPORTEES = {
  [IMPLICIT_LE]: { nom: 'Implicit VR Little Endian', compression: null },
  '1.2.840.10008.1.2.1': { nom: 'Explicit VR Little Endian', compression: null },
  '1.2.840.10008.1.2.2': { nom: 'Explicit VR Big Endian', compression: null, grosBoutiste: true },
  '1.2.840.10008.1.2.4.57': { nom: 'JPEG Lossless', compression: 'jpeg-lossless' },
  '1.2.840.10008.1.2.4.70': { nom: 'JPEG Lossless SV1', compression: 'jpeg-lossless' },
  '1.2.840.10008.1.2.5': { nom: 'RLE Lossless', compression: 'rle' },
};

// Syntaxes connues mais refusées : nom lisible pour le message d'erreur.
const TRANSFER_SYNTAXES_REFUSEES = {
  '1.2.840.10008.1.2.1.99': 'Deflate (compression zip)',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline, avec perte',
  '1.2.840.10008.1.2.4.51': 'JPEG Extended, avec perte',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS sans perte',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS quasi sans perte',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 sans perte',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.4.201': 'HTJ2K sans perte',
  '1.2.840.10008.1.2.4.202': 'HTJ2K sans perte (RPCL)',
  '1.2.840.10008.1.2.4.203': 'HTJ2K',
};

const CONSEIL_EXPORT = 'exportez la série en DICOM non compressé depuis la console ou le PACS.';

// Valeurs numériques d'un élément texte (DS, IS) : tolère les espaces et la virgule décimale.
const nombres = (ds, tag) => {
  const s = ds.string(tag);
  if (!s) return null;
  const v = s.split('\\').map((x) => (x.trim() === '' ? NaN : Number(x.trim().replace(',', '.'))));
  return v.every(Number.isFinite) ? v : null;
};
const nombre = (ds, tag, defaut = null) => {
  const v = nombres(ds, tag);
  return v ? v[0] : defaut;
};

// Fichier sans préambule « DICM » (anciens exports) : jeu de données brut, implicit VR little endian,
// reconnu seulement s'il commence par un élément des groupes 0002 ou 0008.
function analyser(octets) {
  try {
    return dp().parseDicom(octets, { untilTag: 'x7fe00010' });
  } catch (e) {
    const groupe = octets.length >= 8 ? octets[0] | (octets[1] << 8) : -1;
    if (groupe !== 0x0002 && groupe !== 0x0008) return null;
    try {
      return dp().parseDicom(octets, { untilTag: 'x7fe00010', TransferSyntaxUID: IMPLICIT_LE });
    } catch (e2) {
      return null;
    }
  }
}

// Analyse l'en-tête d'un fichier. `buffer` peut être tronqué après l'élément Pixel Data.
// Retourne null si ce n'est pas un DICOM, { nonSupporte: raison } si le format est refusé.
export function lireEntete(buffer) {
  if (!buffer || !(buffer.byteLength >= 8)) return null;
  const ds = analyser(new Uint8Array(buffer));
  if (!ds) return null;
  const pixel = ds.elements.x7fe00010;
  if (!pixel) return null; // DICOMDIR, rapport structuré…

  const ts = (ds.string('x00020010') || IMPLICIT_LE).replace(/\0/g, '').trim();
  const bitsAlloues = ds.uint16('x00280100');
  let bitsStockes = ds.uint16('x00280101');
  if (!bitsStockes || (bitsAlloues && bitsStockes > bitsAlloues)) bitsStockes = bitsAlloues;
  const bitHaut = ds.uint16('x00280102');
  const pente = nombre(ds, 'x00281053');
  const ordonnee = nombre(ds, 'x00281052');
  const m = {
    transferSyntax: ts,
    instanceUID: ds.string('x00080018') || null,
    serieUID: ds.string('x0020000e') || 'inconnue',
    serieDescription: ds.string('x0008103e') || '',
    serieNumero: nombre(ds, 'x00200011'),
    modalite: ds.string('x00080060') || '',
    typeImage: ds.string('x00080008') || '',
    dateExamen: ds.string('x00080020') || '',
    noyau: ds.string('x00181210') || '',
    lignes: ds.uint16('x00280010'),
    colonnes: ds.uint16('x00280011'),
    bitsAlloues,
    bitsStockes,
    // Bit de poids fort : n'est retenu que s'il est cohérent (sinon les données sont supposées alignées à droite).
    bitHaut: bitHaut != null && bitsStockes && bitHaut >= bitsStockes - 1 && bitHaut < bitsAlloues ? bitHaut : (bitsStockes ? bitsStockes - 1 : null),
    signe: ds.uint16('x00280103') === 1,
    echantillons: ds.uint16('x00280002') ?? 1,
    photometrie: (ds.string('x00280004') || 'MONOCHROME2').trim().toUpperCase(),
    images: nombre(ds, 'x00280008', 1),
    // Pente nulle ou absente : sans recalibrage, valeurs stockées supposées déjà physiques.
    pente: pente ? pente : 1,
    ordonnee: ordonnee ?? 0,
    recalibrageAbsent: !pente || ordonnee == null,
    espacementPixel: nombres(ds, 'x00280030') ?? nombres(ds, 'x00181164'), // [ligne (vertical), colonne (horizontal)] en mm
    epaisseur: nombre(ds, 'x00180050'),
    espacementEntreCoupes: nombre(ds, 'x00180088'),
    position: nombres(ds, 'x00200032'),
    orientation: nombres(ds, 'x00200037'),
    numeroInstance: nombre(ds, 'x00200013'),
    fenetreCentre: nombre(ds, 'x00281050'),
    fenetreLargeur: nombre(ds, 'x00281051'),
    pixelOffset: pixel.dataOffset,
    // Données encapsulées (compressées) : longueur indéfinie, lues jusqu'à la fin du fichier.
    pixelLongueur: pixel.hadUndefinedLength ? null : pixel.length,
    compression: TRANSFER_SYNTAXES_SUPPORTEES[ts]?.compression ?? null,
    grosBoutiste: !!TRANSFER_SYNTAXES_SUPPORTEES[ts]?.grosBoutiste,
  };
  if (m.espacementPixel && (m.espacementPixel.length !== 2 || m.espacementPixel.some((x) => !(x > 0)))) m.espacementPixel = null;
  if (m.position?.length !== 3) m.position = null;
  if (m.orientation?.length !== 6) m.orientation = null;
  if (!(m.epaisseur > 0)) m.epaisseur = null;
  if (!(m.espacementEntreCoupes > 0)) m.espacementEntreCoupes = null;
  m.nonSupporte = raisonNonSupporte(m, pixel);
  return m;
}

function raisonNonSupporte(m, pixel) {
  const ts = TRANSFER_SYNTAXES_SUPPORTEES[m.transferSyntax];
  if (!ts) {
    const nom = TRANSFER_SYNTAXES_REFUSEES[m.transferSyntax]
      || (/^1\.2\.840\.10008\.1\.2\.4\.1\d\d$/.test(m.transferSyntax) ? 'vidéo MPEG/HEVC' : 'syntaxe de transfert inconnue');
    return `Format DICOM non pris en charge (${nom}, ${m.transferSyntax}) : ${CONSEIL_EXPORT}`;
  }
  if (!!ts.compression !== !!pixel.hadUndefinedLength)
    return `Données de pixels incohérentes avec le format déclaré (${ts.nom}) : fichier probablement corrompu.`;
  if (m.echantillons !== 1 || !/^MONOCHROME[12]$/.test(m.photometrie))
    return `Image couleur (${m.photometrie}) : non prise en charge, seules les images en niveaux de gris le sont.`;
  if (m.images > 1) return 'DICOM multi-images (enhanced) : non pris en charge pour l’instant ; ' + CONSEIL_EXPORT;
  if (!m.bitsAlloues) return 'Nombre de bits par pixel (BitsAllocated) absent de l’en-tête.';
  if (m.bitsAlloues !== 8 && m.bitsAlloues !== 16) return `Images à ${m.bitsAlloues} bits par pixel : non prises en charge (8 ou 16 bits seulement).`;
  if (!m.lignes || !m.colonnes) return 'Dimensions de l’image (lignes, colonnes) absentes de l’en-tête.';
  const attendu = m.lignes * m.colonnes * (m.bitsAlloues / 8);
  if (!m.compression && m.pixelLongueur < attendu)
    return `Données de pixels incomplètes (${m.pixelLongueur} octets au lieu de ${attendu}).`;
  return null;
}

// Fragments d'une image encapsulée : items (FFFE,E000) après la table d'offsets, jusqu'au délimiteur (FFFE,E0DD).
function fragments(octets) {
  const v = new DataView(octets);
  const morceaux = [];
  let p = 0;
  let premier = true;
  while (p + 8 <= octets.byteLength) {
    const groupe = v.getUint16(p, true);
    const element = v.getUint16(p + 2, true);
    const longueur = v.getUint32(p + 4, true);
    p += 8;
    if (groupe !== 0xfffe || element === 0xe0dd) break;
    if (element !== 0xe000 || longueur === 0xffffffff) throw new Error('Données compressées invalides (structure des fragments).');
    if (p + longueur > octets.byteLength) throw new Error('Données compressées tronquées : fichier incomplet ?');
    if (!premier) morceaux.push(new Uint8Array(octets, p, longueur)); // le 1er item est la table d'offsets
    premier = false;
    p += longueur;
  }
  const total = morceaux.reduce((t, f) => t + f.length, 0);
  if (!total) throw new Error('Aucune image dans les données compressées : fichier incomplet ?');
  const flux = new Uint8Array(total);
  let o = 0;
  for (const f of morceaux) { flux.set(f, o); o += f.length; }
  return flux;
}

// RLE Lossless (DICOM PS3.5 annexe G) : un segment PackBits par octet de l'échantillon, octet de poids fort en premier.
function decoderRle(flux, m) {
  if (flux.byteLength < 64) throw new Error('RLE : en-tête absent ou tronqué.');
  const v = new DataView(flux.buffer, flux.byteOffset, flux.byteLength);
  const nbSegments = v.getUint32(0, true);
  const octetsParPixel = m.bitsAlloues / 8;
  if (nbSegments !== octetsParPixel) throw new Error(`RLE : ${nbSegments} segment(s) au lieu de ${octetsParPixel}.`);
  const n = m.lignes * m.colonnes;
  const sortie = new Uint8Array(n * octetsParPixel); // little endian
  for (let s = 0; s < nbSegments; s++) {
    const debut = v.getUint32(4 + 4 * s, true);
    const fin = s + 1 < nbSegments ? v.getUint32(8 + 4 * s, true) : flux.byteLength;
    if (debut < 64 || fin > flux.byteLength || debut > fin) throw new Error('RLE : table des segments invalide.');
    const decalage = octetsParPixel - 1 - s; // segment 0 = octet de poids fort
    let p = debut, i = 0;
    while (p < fin && i < n) {
      const c = (flux[p++] << 24) >> 24;
      if (c >= 0) { for (let k = 0; k <= c && i < n && p < fin; k++) sortie[(i++) * octetsParPixel + decalage] = flux[p++]; }
      else if (c !== -128 && p < fin) { const b = flux[p++]; for (let k = 0; k < 1 - c && i < n; k++) sortie[(i++) * octetsParPixel + decalage] = b; }
    }
    if (i < n) throw new Error(`RLE : segment ${s + 1} incomplet (${i} pixels sur ${n}).`);
  }
  return sortie.buffer;
}

function decoderJpegLossless(octets, m) {
  // Le décodeur s'arrête avant le dernier pixel quand sa lecture anticipée atteint le marqueur de fin (EOI) :
  // on insère quelques octets nuls avant EOI, jamais émis puisque le décodage s'arrête au nombre de pixels.
  const brutJpeg = fragments(octets);
  let fin = brutJpeg.length;
  while (fin > 1 && !(brutJpeg[fin - 2] === 0xff && brutJpeg[fin - 1] === 0xd9)) fin--;
  const utile = fin > 1 ? fin - 2 : brutJpeg.length;
  const flux = new Uint8Array(utile + 10);
  flux.set(brutJpeg.subarray(0, utile));
  flux[flux.length - 2] = 0xff;
  flux[flux.length - 1] = 0xd9;
  // Taille de sortie imposée par l'en-tête DICOM (une précision JPEG ≤ 8 bits dans un pixel de 16 bits reste sur 16 bits).
  const decodeur = new DecodeurJpegLossless(undefined, m.bitsAlloues / 8);
  let brut;
  try {
    brut = decodeur.decode(flux.buffer, flux.byteOffset, flux.byteLength);
  } catch (e) {
    throw new Error(`Décompression JPEG Lossless impossible (${e?.message || e}).`);
  }
  const { dimX, dimY } = decodeur.frame;
  if (decodeur.numComp !== 1) throw new Error('JPEG Lossless : image couleur, non prise en charge.');
  if (dimX !== m.colonnes || dimY !== m.lignes)
    throw new Error(`JPEG Lossless : image de ${dimX} × ${dimY} pixels, ${m.colonnes} × ${m.lignes} annoncés par l’en-tête.`);
  return brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength);
}

// Convertit les octets de Pixel Data en valeurs physiques (UH pour un scanner), arrondies en Int16.
export function decoderPixels(m, octets) {
  if (ArrayBuffer.isView(octets)) octets = octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength);
  if (!m.lignes || !m.colonnes) throw new Error('Dimensions de l’image absentes.');
  if (m.bitsAlloues !== 8 && m.bitsAlloues !== 16) throw new Error(`Images à ${m.bitsAlloues} bits par pixel : non prises en charge.`);
  const jpeg = m.compression === 'jpeg-lossless';
  if (jpeg) octets = decoderJpegLossless(octets, m);
  else if (m.compression === 'rle') octets = decoderRle(fragments(octets), m);

  const n = m.lignes * m.colonnes;
  const octetsParPixel = m.bitsAlloues / 8;
  if (octets.byteLength < n * octetsParPixel)
    throw new Error(`Données de pixels incomplètes : ${octets.byteLength} octets lus, ${n * octetsParPixel} attendus (fichier tronqué ?).`);
  let brut;
  if (m.bitsAlloues === 16) {
    const copie = octets.slice(0, n * 2);
    if (m.grosBoutiste && !m.compression) {
      const o = new Uint8Array(copie);
      for (let i = 0; i < o.length; i += 2) { const t = o[i]; o[i] = o[i + 1]; o[i + 1] = t; }
    }
    brut = new Uint16Array(copie);
  } else {
    brut = new Uint8Array(octets, 0, n);
  }
  const bits = Math.min(m.bitsStockes || m.bitsAlloues, m.bitsAlloues);
  // Données alignées sur le bit de poids fort (High Bit ≠ Bits Stored − 1) : décalage vers la droite.
  const decalage = !jpeg && m.bitHaut != null && m.bitHaut >= bits - 1 && m.bitHaut < m.bitsAlloues ? m.bitHaut - bits + 1 : 0;
  const masque = (2 ** bits) - 1;
  const bitSigne = 2 ** (bits - 1);
  const pente = Number.isFinite(m.pente) && m.pente !== 0 ? m.pente : 1;
  const ordonnee = Number.isFinite(m.ordonnee) ? m.ordonnee : 0;
  const sortie = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let v = (brut[i] >>> decalage) & masque;
    if (m.signe && v >= bitSigne) v -= 2 ** bits;
    const u = Math.round(v * pente + ordonnee);
    sortie[i] = u < -32768 ? -32768 : u > 32767 ? 32767 : u;
  }
  return sortie;
}

const produitVectoriel = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scalaire = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mediane = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const majoritaire = (v) => {
  const c = new Map();
  for (const x of v) c.set(x, (c.get(x) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
};
const nomSource = (e) => (typeof e.source === 'string' ? e.source : e.source?.webkitRelativePath || e.source?.name || '');
const triNoms = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const parInstance = (a, b) => ((a.entete.numeroInstance ?? Infinity) - (b.entete.numeroInstance ?? Infinity)) || triNoms.compare(nomSource(a), nomSource(b));
const mmTexte = (x) => `${+x.toFixed(2)}`.replace('.', ',');

// Clé de regroupement : l'UID de série, ou à défaut le numéro et la description (séries anonymisées sans UID).
const cleSerie = (m) => (m.serieUID && m.serieUID !== 'inconnue' ? m.serieUID : `inconnue|${m.serieNumero ?? ''}|${m.serieDescription}|${m.modalite}`);

// Regroupe des entrées { entete, source } en séries triées du haut (apex) vers le bas (bases).
export function construireSeries(entrees) {
  const groupes = new Map();
  for (const e of entrees) {
    if (!e?.entete) continue;
    const cle = cleSerie(e.entete);
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(e);
  }
  const series = [];
  for (const [uid, tous] of groupes) {
    const alertes = [];

    // Même fichier sélectionné deux fois (copie, dossiers en double) : même SOP Instance UID.
    const vus = new Set();
    const liste = tous.filter((e) => {
      const id = e.entete.instanceUID;
      if (!id) return true;
      if (vus.has(id)) return false;
      vus.add(id);
      return true;
    });
    if (liste.length < tous.length) alertes.push(`${tous.length - liste.length} fichier(s) en double ignoré(s).`);

    // Images illisibles (fichier tronqué…) au milieu d'images lisibles : écartées, la série reste utilisable.
    const lisibles = liste.filter((e) => !e.entete.nonSupporte);
    let coupes = lisibles.length ? lisibles : liste;
    if (lisibles.length && lisibles.length < liste.length) {
      const raison = liste.find((e) => e.entete.nonSupporte).entete.nonSupporte;
      alertes.push(`${liste.length - lisibles.length} image(s) illisible(s) écartée(s) : ${raison}`);
    }

    // Une série doit avoir une géométrie unique ; on écarte les images minoritaires (repérages…).
    const arrondi = (v) => (v || []).map((x) => x.toFixed(3)).join();
    const cle = (e) => [e.entete.lignes, e.entete.colonnes, arrondi(e.entete.orientation), arrondi(e.entete.espacementPixel)].join('|');
    const cleRetenue = majoritaire(coupes.map(cle));
    const avant = coupes.length;
    coupes = coupes.filter((e) => cle(e) === cleRetenue);
    if (coupes.length < avant) alertes.push(`${avant - coupes.length} image(s) de géométrie différente écartée(s).`);

    const ref = coupes[0].entete;
    let normale = ref.orientation ? produitVectoriel(ref.orientation.slice(0, 3), ref.orientation.slice(3)) : null;
    const positionsCompletes = coupes.every((e) => e.entete.position);
    if (!normale && positionsCompletes && coupes.length > 1) {
      normale = [0, 0, 1];
      alertes.push('Orientation des coupes absente : coupes supposées axiales.');
    }
    const avecPosition = !!normale && positionsCompletes;
    for (const e of coupes) e.z = avecPosition ? scalaire(e.entete.position, normale) : null;

    if (avecPosition) {
      coupes.sort((a, b) => (b.z - a.z) || parInstance(a, b)); // z patient croissant vers la tête : apex en premier
    } else {
      coupes.sort(parInstance);
      if (coupes.length > 1) {
        alertes.push(coupes.every((e) => e.entete.numeroInstance != null)
          ? 'Position des coupes absente : ordre selon le numéro d’instance.'
          : 'Position et numéro des coupes absents : ordre selon le nom des fichiers, à vérifier.');
      }
    }

    let espacementCoupes = null;
    if (avecPosition && coupes.length > 1) {
      const ecarts = coupes.slice(1).map((e, i) => coupes[i].z - e.z);
      espacementCoupes = mediane(ecarts);
      if (ecarts.some((d) => Math.abs(d) < 1e-3)) alertes.push('Plusieurs coupes à la même position (doublons ou reconstructions superposées ?).');
      if (espacementCoupes < 1e-3) espacementCoupes = null;
      else if (ecarts.some((d) => d > espacementCoupes * 1.5)) alertes.push('Espacement irrégulier : coupes manquantes possibles.');
      else if (ecarts.some((d) => d >= 1e-3 && d < espacementCoupes * 0.5)) alertes.push('Espacement irrégulier entre les coupes.');
    }
    if (espacementCoupes == null && !avecPosition) {
      const declares = coupes.map((e) => e.entete.espacementEntreCoupes).filter((x) => x > 0);
      if (declares.length) espacementCoupes = majoritaire(declares);
    }

    // Épaisseur : valeur majoritaire ; plusieurs épaisseurs dans une même série faussent les volumes.
    const epaisseurs = coupes.map((e) => e.entete.epaisseur).filter((x) => x > 0);
    const distinctes = [...new Set(epaisseurs.map((x) => +x.toFixed(2)))].sort((a, b) => a - b);
    const epaisseur = epaisseurs.length ? majoritaire(epaisseurs.map((x) => +x.toFixed(2))) : null;
    if (distinctes.length > 1) alertes.push(`Épaisseurs de coupe différentes dans la série (${distinctes.map(mmTexte).join(' / ')} mm) : mesures de volume approximatives.`);

    const calibre = ref.modalite === 'CT'; // valeurs en UH uniquement pour un scanner
    if (calibre && coupes.some((e) => e.entete.recalibrageAbsent) && !coupes[0].entete.nonSupporte)
      alertes.push('Pente/ordonnée de recalibrage (Rescale) absentes : valeurs supposées déjà en UH, à vérifier.');

    const nonSupportees = coupes.filter((e) => e.entete.nonSupporte);
    series.push({
      uid,
      description: ref.serieDescription,
      numero: ref.serieNumero,
      modalite: ref.modalite,
      noyau: ref.noyau,
      dateExamen: ref.dateExamen,
      epaisseur,
      espacementPixel: ref.espacementPixel,
      espacementCoupes,
      lignes: ref.lignes,
      colonnes: ref.colonnes,
      calibre,
      reperage: /LOCALIZER/i.test(ref.typeImage),
      coupes,
      alertes,
      nonSupporte: nonSupportees.length ? nonSupportees[0].entete.nonSupporte : null,
    });
  }
  // Séries les plus utiles d'abord : non supportées et repérages à la fin, puis par nombre de coupes.
  return series.sort((a, b) => (!!a.nonSupporte - !!b.nonSupporte) || (a.reperage - b.reperage) || (b.coupes.length - a.coupes.length));
}
