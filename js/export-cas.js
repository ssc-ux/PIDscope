// Création d'un cas d'atlas à partir d'un scanner DICOM, anonymisé par construction : seules les images
// (fenêtres poumon et médiastin) sont exportées ; aucune métadonnée DICOM (nom, dates, identifiants) n'est conservée.

import { creerZip } from './zip.js';
import { FENETRES } from './visualiseur.js';

const versBlob = (canvas, type, qualite) => new Promise((ok) => canvas.toBlob(ok, type, qualite));

export const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'cas';

// pile : PileDicom ; infos : { titre, maladie, patterns: [], texte } ; retourne { zip: Uint8Array, nom }.
export async function exporterCas(pile, infos, progression = () => {}) {
  const [sy, sx] = pile.espacementPixel || [1, 1];
  const pas = pile.espacementCoupes && pile.espacementCoupes < 1 ? 2 : 1; // coupes ≥ 1 mm environ
  const indices = Array.from({ length: Math.ceil(pile.nombre / pas) }, (_, i) => i * pas);
  const brut = document.createElement('canvas');
  const sortie = document.createElement('canvas');
  const fichiers = [];
  let extension = 'webp', type = 'image/webp', taille = null;
  for (let n = 0; n < indices.length; n++) {
    const c = await pile.coupe(indices[n]);
    if (!taille) {
      // Pixels carrés, 512 pixels au plus.
      const l = c.largeur * sx, h = c.hauteur * sy, e = 512 / Math.max(l, h);
      taille = { l: Math.round(l * e), h: Math.round(h * e), pixelMm: Math.max(l, h) / 512 };
      sortie.width = taille.l; sortie.height = taille.h;
      brut.width = c.largeur; brut.height = c.hauteur;
    }
    for (const [nom, f] of Object.entries(FENETRES)) {
      const ctx = brut.getContext('2d');
      const img = ctx.createImageData(c.largeur, c.hauteur);
      const bas = f.centre - f.largeur / 2;
      for (let i = 0, j = 0; i < c.donnees.length; i++, j += 4) {
        let g = ((c.donnees[i] - bas) / f.largeur) * 255;
        if (c.inverse) g = 255 - g;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = g < 0 ? 0 : g > 255 ? 255 : g;
        img.data[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const sctx = sortie.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(brut, 0, 0, taille.l, taille.h);
      let blob = await versBlob(sortie, type, 0.85);
      if (blob.type !== type) { type = 'image/jpeg'; extension = 'jpg'; blob = await versBlob(sortie, type, 0.9); } // navigateurs sans WebP
      fichiers.push({ nom: `${nom}/${String(n + 1).padStart(4, '0')}.${extension}`, donnees: new Uint8Array(await blob.arrayBuffer()) });
      if (nom === 'poumon' && n === Math.floor(indices.length * 0.55)) fichiers.push({ nom: 'vignette.' + extension, donnees: fichiers.at(-1).donnees });
    }
    progression((n + 1) / indices.length);
  }
  const id = slug(infos.titre);
  const cas = {
    id, titre: infos.titre, description: infos.patterns.join(', ') || infos.maladie, categorie: 'Connectivités',
    maladies: [infos.maladie], patterns: infos.patterns, statut: 'brouillon', relecture: { par: '', date: '' },
    source: { nom: 'Cas du service, anonymisé', licence: 'CC BY-NC-SA 4.0', modifications: 'Export PIDscope : images seules (fenêtres poumon et médiastin), sans aucune métadonnée DICOM.' },
    serie: {
      nombre: indices.length, chiffres: 4, espacement_mm: pile.espacementCoupes ? +(pile.espacementCoupes * pas).toFixed(3) : null,
      pixel_mm: +taille.pixelMm.toFixed(3), fenetres: { poumon: `poumon/{n}.${extension}`, mediastin: `mediastin/{n}.${extension}` },
    },
    texte: infos.texte,
  };
  fichiers.push({ nom: 'cas.json', donnees: new TextEncoder().encode(JSON.stringify(cas, null, 2)) });
  return { zip: creerZip(fichiers.map((f) => ({ ...f, nom: `${id}/${f.nom}` }))), nom: `${id}.zip` };
}
