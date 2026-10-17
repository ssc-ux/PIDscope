// Lecture DICOM : en-têtes, décodage des pixels en unités Hounsfield, regroupement en séries.
// Tout se fait localement dans le navigateur. Seuls les formats non compressés little endian sont acceptés :
// mieux vaut refuser clairement un fichier que l'afficher faussement.

const dp = () => globalThis.dicomParser;

export const TRANSFER_SYNTAXES_SUPPORTEES = {
  '1.2.840.10008.1.2': 'Implicit VR Little Endian',
  '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
};

const nombres = (ds, tag) => {
  const s = ds.string(tag);
  if (!s) return null;
  const v = s.split('\\').map(Number);
  return v.every(Number.isFinite) ? v : null;
};
const nombre = (ds, tag, defaut = null) => {
  const v = nombres(ds, tag);
  return v ? v[0] : defaut;
};

// Analyse l'en-tête d'un fichier. `buffer` peut être tronqué après l'élément Pixel Data.
// Retourne null si ce n'est pas un DICOM, { nonSupporte: raison } si le format est refusé.
export function lireEntete(buffer) {
  let ds;
  try {
    ds = dp().parseDicom(new Uint8Array(buffer), { untilTag: 'x7fe00010' });
  } catch (e) {
    return null;
  }
  const pixel = ds.elements.x7fe00010;
  if (!pixel) return null; // DICOMDIR, rapport structuré…

  const ts = ds.string('x00020010');
  const m = {
    transferSyntax: ts,
    serieUID: ds.string('x0020000e') || 'inconnue',
    serieDescription: ds.string('x0008103e') || '',
    serieNumero: nombre(ds, 'x00200011'),
    modalite: ds.string('x00080060') || '',
    typeImage: ds.string('x00080008') || '',
    dateExamen: ds.string('x00080020') || '',
    noyau: ds.string('x00181210') || '',
    lignes: ds.uint16('x00280010'),
    colonnes: ds.uint16('x00280011'),
    bitsAlloues: ds.uint16('x00280100'),
    bitsStockes: ds.uint16('x00280101'),
    signe: ds.uint16('x00280103') === 1,
    echantillons: ds.uint16('x00280002') ?? 1,
    photometrie: (ds.string('x00280004') || 'MONOCHROME2').trim(),
    images: nombre(ds, 'x00280008', 1),
    pente: nombre(ds, 'x00281053', 1),
    ordonnee: nombre(ds, 'x00281052', 0),
    espacementPixel: nombres(ds, 'x00280030'), // [ligne (vertical), colonne (horizontal)] en mm
    epaisseur: nombre(ds, 'x00180050'),
    position: nombres(ds, 'x00200032'),
    orientation: nombres(ds, 'x00200037'),
    numeroInstance: nombre(ds, 'x00200013'),
    fenetreCentre: nombre(ds, 'x00281050'),
    fenetreLargeur: nombre(ds, 'x00281051'),
    pixelOffset: pixel.dataOffset,
    pixelLongueur: pixel.length,
  };
  m.nonSupporte = raisonNonSupporte(m, pixel);
  return m;
}

function raisonNonSupporte(m, pixel) {
  if (!TRANSFER_SYNTAXES_SUPPORTEES[m.transferSyntax] || pixel.encapsulatedPixelData || pixel.hadUndefinedLength)
    return 'DICOM compressé (' + (m.transferSyntax || '?') + ') : exportez la série en DICOM non compressé.';
  if (m.echantillons !== 1 || !/^MONOCHROME[12]$/.test(m.photometrie)) return 'Image couleur : non prise en charge.';
  if (m.images > 1) return 'DICOM multi-images (enhanced) : non pris en charge pour l’instant.';
  if (m.bitsAlloues !== 8 && m.bitsAlloues !== 16) return `${m.bitsAlloues} bits par pixel : non pris en charge.`;
  if (!m.lignes || !m.colonnes) return 'Dimensions de l’image absentes.';
  if (m.pixelLongueur < m.lignes * m.colonnes * (m.bitsAlloues / 8)) return 'Données de pixels incomplètes.';
  return null;
}

// Convertit les octets de Pixel Data en valeurs physiques (UH pour un scanner), arrondies en Int16.
export function decoderPixels(m, octets) {
  const n = m.lignes * m.colonnes;
  const brut = m.bitsAlloues === 16
    ? new Uint16Array(octets.slice(0, n * 2))
    : new Uint8Array(octets.slice(0, n));
  const bits = m.bitsStockes || m.bitsAlloues;
  const masque = bits >= 32 ? 0xffffffff : (2 ** bits) - 1;
  const bitSigne = 2 ** (bits - 1);
  const sortie = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let v = brut[i] & masque;
    if (m.signe && v >= bitSigne) v -= 2 ** bits;
    const u = Math.round(v * m.pente + m.ordonnee);
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

// Regroupe des entrées { entete, source } en séries triées du haut (apex) vers le bas (bases).
export function construireSeries(entrees) {
  const groupes = new Map();
  for (const e of entrees) {
    if (!groupes.has(e.entete.serieUID)) groupes.set(e.entete.serieUID, []);
    groupes.get(e.entete.serieUID).push(e);
  }
  const series = [];
  for (const [uid, liste] of groupes) {
    const alertes = [];
    // Une série doit avoir une géométrie unique ; on écarte les images minoritaires (repérages…).
    const cle = (e) => [e.entete.lignes, e.entete.colonnes, (e.entete.orientation || []).map((x) => x.toFixed(3)).join()].join('|');
    const cleRetenue = majoritaire(liste.map(cle));
    let coupes = liste.filter((e) => cle(e) === cleRetenue);
    if (coupes.length < liste.length) alertes.push(`${liste.length - coupes.length} image(s) de géométrie différente écartée(s).`);

    const ref = coupes[0].entete;
    const normale = ref.orientation?.length === 6 ? produitVectoriel(ref.orientation.slice(0, 3), ref.orientation.slice(3)) : null;
    const avecPosition = normale && coupes.every((e) => e.entete.position?.length === 3);
    for (const e of coupes) e.z = avecPosition ? scalaire(e.entete.position, normale) : null;

    if (avecPosition) {
      coupes.sort((a, b) => b.z - a.z); // z patient croissant vers la tête : apex en premier
    } else {
      coupes.sort((a, b) => (a.entete.numeroInstance ?? 0) - (b.entete.numeroInstance ?? 0));
      alertes.push('Position des coupes absente : ordre selon le numéro d’instance.');
    }

    let espacementCoupes = null;
    if (avecPosition && coupes.length > 1) {
      const ecarts = coupes.slice(1).map((e, i) => coupes[i].z - e.z);
      espacementCoupes = mediane(ecarts);
      if (ecarts.some((d) => Math.abs(d) < 1e-3)) alertes.push('Plusieurs coupes à la même position (doublons ?).');
      else if (ecarts.some((d) => d > espacementCoupes * 1.5)) alertes.push('Espacement irrégulier : coupes manquantes possibles.');
    }

    const nonSupportees = coupes.filter((e) => e.entete.nonSupporte);
    series.push({
      uid,
      description: ref.serieDescription,
      numero: ref.serieNumero,
      modalite: ref.modalite,
      noyau: ref.noyau,
      dateExamen: ref.dateExamen,
      epaisseur: ref.epaisseur,
      espacementPixel: ref.espacementPixel,
      espacementCoupes,
      lignes: ref.lignes,
      colonnes: ref.colonnes,
      calibre: ref.modalite === 'CT', // valeurs en UH uniquement pour un scanner
      reperage: /LOCALIZER/i.test(ref.typeImage),
      coupes,
      alertes,
      nonSupporte: nonSupportees.length ? nonSupportees[0].entete.nonSupporte : null,
    });
  }
  // Séries les plus utiles d'abord : non supportées et repérages à la fin, puis par nombre de coupes.
  return series.sort((a, b) => (!!a.nonSupporte - !!b.nonSupporte) || (a.reperage - b.reperage) || (b.coupes.length - a.coupes.length));
}
