// Page « Mon scanner » : ouverture locale de DICOM ou d'images, comparaison de deux examens.

import { analyserFichiers, PileDicom, PileFichiersImage } from './piles.js';
import { Visualiseur } from './visualiseur.js';
import { creerPanneauEtendue } from './etendue.js';

const $ = (s) => document.querySelector(s);
const etat = $('#etat');
const listeSeries = $('#series');
const chargeur = $('#chargeur');
const ecrans = [...document.querySelectorAll('.ecran')];
const visualiseurs = [null, null];
const positionSynchro = [null, null]; // position fractionnaire pour la synchronisation
let cible = 0; // écran qui recevra la prochaine série ouverte
let actif = 0; // examen auquel s'appliquent les mesures d'étendue
const panneau = creerPanneauEtendue($('#etendue'), () => visualiseurs[actif]);

function activer(i) {
  actif = i;
  $('#etendue-cible').textContent = visualiseurs[1] && !ecrans[1].hidden ? `examen ${i + 1}` : '';
  panneau.majDisponibilite();
}

const formaterDate = (d) => (/^\d{8}$/.test(d) ? `${d.slice(6)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : '');
const mm = (v) => (v ? `${+v.toFixed(2)} mm` : null);

function afficherEtat(texte, erreur = false) {
  etat.textContent = texte;
  etat.classList.toggle('erreur', erreur);
}

// Message en français pour une erreur quelconque (le lecteur DICOM lève parfois de simples chaînes).
function messageErreur(e) {
  const brut = typeof e === 'string' ? e : e?.message || '';
  switch (e?.name) {
    case 'AbortError': return 'opération annulée.';
    case 'NotReadableError':
    case 'NotFoundError': return 'un fichier n’a pas pu être lu (déplacé, supprimé ou support débranché ?). Réessayez.';
    case 'SecurityError':
    case 'NotAllowedError': return 'le navigateur a refusé l’accès aux fichiers.';
    case 'EncodingError': return 'image illisible ou format non pris en charge.';
  }
  if (e instanceof RangeError || /out of memory|allocation failed/i.test(brut)) {
    return 'mémoire insuffisante : ouvrez une seule série à la fois ou fermez d’autres onglets.';
  }
  return brut || 'erreur inconnue.';
}
const erreurAnnulation = () => new DOMException('Lecture annulée.', 'AbortError');

// ── Progression, annulation, boutons occupés ──────────────────────────────
// scanner.html ne prévoit ni barre de progression ni bouton d'annulation : ils sont créés ici, sous #etat.
const zoneProgression = document.createElement('div');
zoneProgression.style.cssText = 'display:none;gap:.5rem;align-items:center;margin:.25rem 0';
const barre = document.createElement('progress');
barre.max = 1;
barre.setAttribute('aria-label', 'Progression de la lecture des fichiers');
const boutonAnnuler = document.createElement('button');
boutonAnnuler.type = 'button';
boutonAnnuler.textContent = 'Annuler';
zoneProgression.append(barre, boutonAnnuler);
etat.after(zoneProgression);

const CHOIX = ['#choix-dossier', '#choix-fichiers'].map((id) => $(id));
const BOUTONS_OCCUPES = ['#ajouter-comparaison', '#fermer-comparaison'].map((id) => $(id));
let tache = null; // AbortController de la lecture en cours (une seule à la fois)

function majProgression(fraction) {
  if (fraction == null) barre.removeAttribute('value'); // durée inconnue : barre animée
  else barre.value = fraction;
}
// Mise à jour limitée à 10 par seconde : #etat est une zone role="status" lue par les lecteurs d'écran.
let dernierAffichage = 0;
function signaler(texte, fraction) {
  const t = performance.now();
  if (t - dernierAffichage < 100) return;
  dernierAffichage = t;
  afficherEtat(texte);
  majProgression(fraction);
}

function occuper(occupe) {
  for (const input of CHOIX) {
    input.disabled = occupe;
    const label = input.closest('label');
    if (!label) continue;
    label.toggleAttribute('aria-disabled', occupe);
    label.style.opacity = occupe ? '.5' : '';
    label.style.pointerEvents = occupe ? 'none' : '';
  }
  for (const b of BOUTONS_OCCUPES) b.disabled = occupe;
  chargeur.setAttribute('aria-busy', String(occupe));
  zoneProgression.style.display = occupe ? 'flex' : 'none';
  if (occupe) majProgression(null);
}

boutonAnnuler.addEventListener('click', () => tache?.abort());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tache) tache.abort(); });

// Lance une lecture. `obtenirFichiers(signal)` fournit la liste des fichiers (sélection ou exploration de dossiers).
async function traiter(obtenirFichiers) {
  if (tache) {
    afficherEtat('Une lecture est déjà en cours : attendez la fin ou annulez-la.', true);
    return;
  }
  const ctrl = new AbortController();
  tache = ctrl;
  occuper(true);
  try {
    await lire(await obtenirFichiers(ctrl.signal), ctrl.signal);
  } catch (e) {
    if (e?.name === 'AbortError') afficherEtat('Lecture annulée.');
    else {
      console.error(e);
      afficherEtat(`Erreur de lecture : ${messageErreur(e)}`, true);
    }
  } finally {
    tache = null;
    occuper(false);
  }
}

async function lire({ fichiers, illisibles = 0 }, signal) {
  listeSeries.innerHTML = '';
  // Fichiers cachés (.DS_Store, ._* des supports formatés sur Mac…) : jamais des images, inutile de les lire.
  const visibles = fichiers.filter((f) => !f.name.startsWith('.'));
  const caches = fichiers.length - visibles.length;
  if (!visibles.length) {
    afficherEtat(fichiers.length ? 'Aucun fichier exploitable (uniquement des fichiers cachés).' : 'Aucun fichier trouvé.', true);
    return;
  }
  dernierAffichage = 0;
  const resultat = await analyserFichiers(visibles, (n, total) => {
    // analyserFichiers appelle la progression après chaque fichier : lever l'erreur ici interrompt la boucle.
    if (signal.aborted) throw erreurAnnulation();
    signaler(`Lecture des fichiers… ${n} / ${total}`, n / total);
  });
  if (signal.aborted) throw erreurAnnulation();
  const { series, images } = resultat;
  const ignores = resultat.ignores + caches;
  const choix = [];
  for (const s of series) {
    const details = [
      `${s.coupes.length} coupe(s)`,
      s.modalite,
      mm(s.epaisseur) && `épaisseur ${mm(s.epaisseur)}`,
      mm(s.espacementCoupes) && `pas ${mm(s.espacementCoupes)}`,
      s.noyau && `filtre ${s.noyau}`,
      formaterDate(s.dateExamen),
    ].filter(Boolean).join(' · ');
    choix.push({
      titre: s.description || `Série ${s.numero ?? ''}`.trim(),
      details,
      alertes: s.alertes,
      erreur: s.nonSupporte || (s.reperage ? 'Image de repérage' : null),
      bloquant: !!s.nonSupporte,
      ouvrir: () => ouvrir(new PileDicom(s), [s.description, details].filter(Boolean).join(' · ')),
    });
  }
  if (images.length) {
    choix.push({
      titre: 'Images JPEG/PNG',
      details: `${images.length} image(s), ordonnées par nom de fichier`,
      alertes: ['Pas de valeurs en UH : fenêtrage et mesures de densité impossibles.'],
      ouvrir: () => ouvrir(new PileFichiersImage(images), `${images.length} images`),
    });
  }

  const ouvrables = choix.filter((c) => !c.bloquant);
  const resume = [
    `${series.length} série(s) DICOM`,
    images.length && `${images.length} image(s)`,
    ignores && `${ignores} fichier(s) ignoré(s)`,
    illisibles && `${illisibles} élément(s) illisible(s)`,
  ].filter(Boolean).join(', ');
  if (!choix.length) {
    afficherEtat(`Aucune image lisible trouvée (${fichiers.length} fichier(s) lus${illisibles ? `, ${illisibles} élément(s) illisible(s)` : ''}). Vérifiez qu’il s’agit bien d’un dossier DICOM ou d’images JPEG/PNG.`, true);
    return;
  }
  if (choix.length === 1 && ouvrables.length === 1) {
    afficherEtat(resume);
    ouvrirChoix(ouvrables[0]);
    return;
  }
  afficherEtat(`${resume}. Choisissez la série à afficher :`);
  for (const c of choix) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.disabled = c.bloquant;
    b.innerHTML = '<strong></strong><small></small>';
    b.querySelector('strong').textContent = c.titre;
    b.querySelector('small').textContent = c.details;
    for (const [classe, texte] of [...(c.alertes || []).map((a) => ['alerte', a]), ...(c.erreur ? [['erreur', c.erreur]] : [])]) {
      const s = document.createElement('small');
      s.className = classe;
      s.textContent = `⚠ ${texte}`;
      b.append(s);
    }
    b.addEventListener('click', () => {
      listeSeries.querySelectorAll('button').forEach((x) => x.removeAttribute('aria-pressed'));
      b.setAttribute('aria-pressed', 'true');
      ouvrirChoix(c);
    });
    li.append(b);
    listeSeries.append(li);
  }
}

function ouvrirChoix(c) {
  try {
    c.ouvrir();
  } catch (e) {
    console.error(e);
    afficherEtat(`Impossible d’ouvrir cette série : ${messageErreur(e)}`, true);
  }
}

// Les images JPEG/PNG sont décodées en ImageBitmap (mémoire hors du tas JavaScript, parfois sur la carte graphique) :
// on les ferme dès que la pile n'est plus affichée, sans attendre le ramasse-miettes. Les piles DICOM n'ont que
// des tableaux ordinaires, libérés en vidant le cache.
function libererPile(pile) {
  const entrees = pile?.cache?.m;
  if (!(entrees instanceof Map)) return;
  for (const v of entrees.values()) Promise.resolve(v).then((c) => c?.image?.close?.(), () => {});
  entrees.clear();
}

function ouvrir(pile, titre) {
  const i = cible;
  const ecran = ecrans[i];
  obtenirVisualiseur(i);
  ecran.querySelector('.ecran-titre').textContent = (i === 1 ? 'Examen 2 · ' : visualiseurs[1] ? 'Examen 1 · ' : '') + titre;
  ecran.hidden = false;
  const ancienne = visualiseurs[i].pile;
  visualiseurs[i].definirPile(pile);
  if (ancienne && ancienne !== pile && !visualiseurs.some((v) => v?.pile === ancienne)) libererPile(ancienne);
  positionSynchro.fill(null);
  $('#barre-comparaison').hidden = false;
  $('#bloc-etendue').hidden = false;
  majComparaison();
  activer(i);
}

function obtenirVisualiseur(i) {
  if (!visualiseurs[i]) {
    visualiseurs[i] = new Visualiseur(ecrans[i].querySelector('.vis'), { surChangement: synchroniser });
    visualiseurs[i].zone.addEventListener('pointerdown', () => activer(i));
  }
  return visualiseurs[i];
}
obtenirVisualiseur(0);

function synchroniser(source, delta) {
  const i = visualiseurs.indexOf(source);
  const autre = visualiseurs[1 - i];
  positionSynchro[i] = null;
  if (!$('#synchro').checked || !autre?.pile || ecrans[1].hidden) return;
  // Le déplacement est converti en millimètres quand les deux séries indiquent leur pas de coupe.
  const a = source.pile.espacementCoupes;
  const b = autre.pile.espacementCoupes;
  const rapport = a && b ? a / b : 1;
  positionSynchro[1 - i] = (positionSynchro[1 - i] ?? autre.index) + delta * rapport;
  autre.allerA(positionSynchro[1 - i], { silencieux: true });
}

function majComparaison() {
  const double = !!visualiseurs[1] && !ecrans[1].hidden;
  $('#ecrans').classList.toggle('double', double);
  $('#option-synchro').hidden = !double;
  $('#fermer-comparaison').hidden = !double;
  $('#ajouter-comparaison').hidden = double;
  visualiseurs.forEach((v) => v?.dessiner());
}

$('#ajouter-comparaison').addEventListener('click', () => {
  cible = 1;
  listeSeries.innerHTML = '';
  afficherEtat('Choisissez maintenant le second examen à comparer.');
  $('#chargeur').scrollIntoView({ behavior: 'smooth' });
});
$('#fermer-comparaison').addEventListener('click', () => {
  ecrans[1].hidden = true;
  cible = 0;
  ecrans[0].querySelector('.ecran-titre').textContent = ecrans[0].querySelector('.ecran-titre').textContent.replace(/^Examen 1 · /, '');
  majComparaison();
  activer(0);
});
$('#synchro').addEventListener('change', () => positionSynchro.fill(null));

for (const input of CHOIX) {
  input.addEventListener('change', (e) => {
    const fichiers = [...e.target.files]; // copie avant la remise à zéro, qui vide la FileList
    e.target.value = '';
    if (fichiers.length) traiter(async () => ({ fichiers }));
  });
}

// Glisser-déposer, y compris de dossiers entiers.
// Exploration récursive ; un fichier ou sous-dossier illisible est compté puis ignoré au lieu de tout faire échouer.
async function lireEntree(entree, signal, bilan) {
  if (signal.aborted) throw erreurAnnulation();
  if (entree.isFile) {
    try {
      const f = await new Promise((ok, ko) => entree.file(ok, ko));
      bilan.fichiers++;
      signaler(`Exploration des dossiers… ${bilan.fichiers} fichier(s) trouvé(s)`, null);
      return [f];
    } catch {
      bilan.illisibles++;
      return [];
    }
  }
  if (!entree.isDirectory) return [];
  const lecteur = entree.createReader();
  const enfants = [];
  try {
    for (;;) { // readEntries renvoie les entrées par paquets
      const lot = await new Promise((ok, ko) => lecteur.readEntries(ok, ko));
      if (!lot.length) break;
      enfants.push(...lot);
      if (signal.aborted) throw erreurAnnulation();
    }
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    bilan.illisibles++;
  }
  return (await Promise.all(enfants.map((x) => lireEntree(x, signal, bilan)))).flat();
}

const contientFichiers = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
chargeur.addEventListener('dragover', (e) => {
  if (!contientFichiers(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = tache ? 'none' : 'copy';
  chargeur.classList.add('survol');
});
chargeur.addEventListener('dragleave', (e) => {
  if (!chargeur.contains(e.relatedTarget)) chargeur.classList.remove('survol'); // ignore le passage sur les éléments enfants
});
chargeur.addEventListener('drop', (e) => {
  e.preventDefault();
  chargeur.classList.remove('survol');
  if (tache) {
    afficherEtat('Une lecture est déjà en cours : attendez la fin ou annulez-la.', true);
    return;
  }
  // dataTransfer n'est lisible que pendant l'événement : tout est relevé avant la première attente.
  const entrees = [...e.dataTransfer.items].filter((it) => it.kind === 'file').map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  const fichiers = [...e.dataTransfer.files];
  if (!entrees.length && !fichiers.length) {
    afficherEtat('Rien à lire : déposez un dossier DICOM ou des fichiers.', true);
    return;
  }
  traiter(async (signal) => {
    if (!entrees.length) return { fichiers };
    const bilan = { fichiers: 0, illisibles: 0 };
    dernierAffichage = 0;
    signaler('Exploration des dossiers…', null);
    const trouves = (await Promise.all(entrees.map((x) => lireEntree(x, signal, bilan)))).flat();
    return { fichiers: trouves, illisibles: bilan.illisibles };
  });
});
// Un dépôt manqué à côté de la zone ouvrirait le fichier dans l'onglet et ferait perdre l'examen affiché.
window.addEventListener('dragover', (e) => {
  if (contientFichiers(e) && !chargeur.contains(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; }
});
window.addEventListener('drop', (e) => {
  if (contientFichiers(e) && !chargeur.contains(e.target)) e.preventDefault();
});
