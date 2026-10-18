// Piles de coupes affichables par le visualiseur. Une pile expose :
//   nombre, calibre (valeurs en UH ?), espacementPixel, espacementCoupes, legende(i), async coupe(i)
// coupe(i) renvoie { type: 'uh', largeur, hauteur, donnees: Int16Array } ou { type: 'image', largeur, hauteur, image }.

import { lireEntete, decoderPixels, construireSeries } from './dicom.js';

// Cache LRU de promesses. `liberer(valeur)` est appelé sur chaque entrée évincée (fermeture des ImageBitmap :
// leur mémoire, hors du tas JavaScript, n'est sinon rendue qu'au ramasse-miettes). La coupe affichée n'est jamais
// évincée en pratique : le visualiseur la redemande à chaque changement et ne précharge que 5 voisines.
class Cache {
  constructor(taille, liberer = null) { this.taille = taille; this.liberer = liberer; this.m = new Map(); }
  obtenir(cle, fabrique) {
    if (this.m.has(cle)) {
      const v = this.m.get(cle);
      this.m.delete(cle); this.m.set(cle, v); // plus récemment utilisé
      return v;
    }
    const v = fabrique();
    this.m.set(cle, v);
    if (this.m.size > this.taille) {
      const [ancienne, valeur] = this.m.entries().next().value;
      this.m.delete(ancienne);
      if (this.liberer) Promise.resolve(valeur).then(this.liberer, () => {});
    }
    // En cas d'échec, ne pas garder la promesse rejetée en cache (sauf si elle a déjà été remplacée).
    Promise.resolve(v).catch(() => { if (this.m.get(cle) === v) this.m.delete(cle); });
    return v;
  }
}

export class PileDicom {
  constructor(serie) {
    if (!serie?.coupes?.length) throw new Error('Série DICOM vide : aucune coupe à afficher.');
    if (serie.nonSupporte) throw new Error(serie.nonSupporte);
    this.serie = serie;
    this.nombre = serie.coupes.length;
    this.calibre = serie.calibre;
    this.espacementPixel = serie.espacementPixel;
    this.espacementCoupes = serie.espacementCoupes;
    const c = serie.coupes[0].entete;
    this.fenetreParDefaut = c.fenetreLargeur > 0 ? { largeur: c.fenetreLargeur, centre: c.fenetreCentre } : null;
    this.cache = new Cache(96);
  }
  legende(i) {
    const z = this.serie.coupes[i].z;
    return z == null ? '' : `z = ${z.toFixed(1)} mm`;
  }
  coupe(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.nombre)
      return Promise.reject(new RangeError(`Coupe ${i} inexistante (série de ${this.nombre} coupe(s)).`));
    return this.cache.obtenir(i, async () => {
      const { entete: m, source } = this.serie.coupes[i];
      try {
        const octets = await source.slice(m.pixelOffset, m.pixelLongueur == null ? undefined : m.pixelOffset + m.pixelLongueur).arrayBuffer();
        return { type: 'uh', largeur: m.colonnes, hauteur: m.lignes, donnees: decoderPixels(m, octets), inverse: m.photometrie === 'MONOCHROME1' };
      } catch (e) {
        const nom = source?.webkitRelativePath || source?.name;
        throw new Error(`Coupe ${i + 1} / ${this.nombre} illisible${nom ? ` (${nom})` : ''} : ${e?.message || e}`);
      }
    });
  }
}

class PileImages {
  constructor(sources) {
    this.sources = sources;
    this.nombre = sources.length;
    this.calibre = false;
    this.espacementPixel = null;
    this.espacementCoupes = null;
    this.cache = new Cache(128, (c) => c?.image?.close?.());
  }
  legende() { return ''; }
  coupe(i) {
    return this.cache.obtenir(i, async () => {
      const image = await this.charger(this.sources[i]);
      return { type: 'image', largeur: image.width, hauteur: image.height, image };
    });
  }
}

// Images JPEG/PNG choisies par l'utilisateur, ordonnées par nom de fichier.
export class PileFichiersImage extends PileImages {
  constructor(fichiers) {
    const tri = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
    super([...fichiers].sort((a, b) => tri.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name)));
  }
  charger(f) { return createImageBitmap(f); }
}

// Série publiée sur le site (cas) : une liste d'URL par fenêtre pré-calculée (« poumon », « mediastin »).
export class PileUrls extends PileImages {
  constructor(urlsParFenetre, { espacementCoupes = null, espacementPixel = null, pixelMm = null } = {}) {
    const variantes = Object.keys(urlsParFenetre);
    super(urlsParFenetre[variantes[0]]);
    this.urlsParFenetre = urlsParFenetre;
    this.variantes = variantes;
    this.variante = variantes[0];
    this.espacementCoupes = espacementCoupes;
    this.espacementPixel = espacementPixel;
    this.pixelMm = pixelMm; // taille du pixel des images exportées (mm)
  }
  get mention() { return `Fenêtre ${this.variante === 'mediastin' ? 'médiastinale' : 'pulmonaire'}`; }
  legende(i) { return this.espacementCoupes ? `${((i * this.espacementCoupes) / 10).toFixed(1)} cm sous la 1re coupe` : ''; }
  choisirVariante(v) {
    this.variante = v;
    this.sources = this.urlsParFenetre[v];
  }
  coupe(i) {
    const v = this.variante;
    return this.cache.obtenir(`${v}:${i}`, async () => {
      const image = await this.charger(this.urlsParFenetre[v][i]);
      return { type: 'image', largeur: image.width, hauteur: image.height, image };
    });
  }
  async charger(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Image introuvable : ${url}`);
    return createImageBitmap(await r.blob());
  }
}

// Valeurs en UH reconstituées à partir des images exportées en fenêtre pulmonaire (L -600 / W 1500) :
// approximation au pas de 6 UH, bornée à [-1350 ; +150] UH, altérée par la compression des images.
export function pileUHDepuisFenetrePoumon(pile) {
  const urls = pile.urlsParFenetre?.poumon;
  if (!urls) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    nombre: urls.length,
    espacementPixel: [pile.pixelMm, pile.pixelMm],
    espacementCoupes: pile.espacementCoupes,
    async coupe(i) {
      const image = await pile.charger(urls[i]);
      const { width, height } = image;
      let px;
      try {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0);
        px = ctx.getImageData(0, 0, width, height).data;
      } finally {
        image.close?.(); // bitmap local, jamais affiché : libéré tout de suite
      }
      const donnees = new Int16Array(width * height);
      for (let j = 0; j < donnees.length; j++) donnees[j] = Math.round((px[j * 4] / 255) * 1500 - 1350);
      return { type: 'uh', largeur: width, hauteur: height, donnees };
    },
  };
}

const estImage = (f) => /^image\/(jpeg|png|webp|bmp)$/.test(f.type) || /\.(jpe?g|png|webp|bmp)$/i.test(f.name);

const TAILLE_ENTETE = 256 * 1024;

// En-tête d'un fichier, ou null s'il n'est pas DICOM. Un fichier tronqué (copie interrompue) est signalé illisible.
async function enteteFichier(f) {
  let entete = lireEntete(await f.slice(0, TAILLE_ENTETE).arrayBuffer());
  if (entete === null && f.size > TAILLE_ENTETE) entete = lireEntete(await f.arrayBuffer()); // en-tête volumineux
  if (entete && !entete.nonSupporte) {
    const fin = entete.pixelLongueur == null ? entete.pixelOffset + 1 : entete.pixelOffset + entete.pixelLongueur;
    if (fin > f.size) entete.nonSupporte = `Fichier incomplet (${f.size} octets, ${fin} attendus) : copie interrompue ?`;
  }
  return entete;
}

// Lit des fichiers choisis par l'utilisateur. Seuls les en-têtes sont lus ici ; les pixels le sont à l'affichage.
// Retourne { series: [...], images: File[], ignores: nombre }. Un fichier illisible est ignoré sans interrompre la lecture.
export async function analyserFichiers(fichiers, progression = () => {}) {
  fichiers = [...(fichiers || [])];
  const entrees = [];
  const images = [];
  let ignores = 0;
  let fait = 0;
  for (const f of fichiers) {
    if (estImage(f)) images.push(f);
    else {
      let entete = null;
      try {
        entete = await enteteFichier(f);
      } catch (e) {
        entete = null; // fichier inaccessible (droits, supprimé entre-temps…)
      }
      if (entete) entrees.push({ entete, source: f });
      else ignores++;
    }
    progression(++fait, fichiers.length);
  }
  return { series: entrees.length ? construireSeries(entrees) : [], images, ignores };
}
