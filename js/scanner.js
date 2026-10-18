// Page « Mon scanner » : ouverture locale de DICOM ou d'images, comparaison de deux examens.

import { analyserFichiers, PileDicom, PileFichiersImage } from './piles.js';
import { Visualiseur } from './visualiseur.js';
import { creerPanneauEtendue } from './etendue.js';

const $ = (s) => document.querySelector(s);
const etat = $('#etat');
const listeSeries = $('#series');
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

async function traiter(fichiers) {
  fichiers = [...fichiers];
  if (!fichiers.length) return;
  listeSeries.innerHTML = '';
  let resultat;
  try {
    resultat = await analyserFichiers(fichiers, (n, total) => afficherEtat(`Lecture des fichiers… ${n} / ${total}`));
  } catch (e) {
    afficherEtat(`Erreur de lecture : ${e.message}`, true);
    return;
  }
  const { series, images, ignores } = resultat;
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
  const resume = [`${series.length} série(s) DICOM`, images.length && `${images.length} image(s)`, ignores && `${ignores} fichier(s) ignoré(s)`].filter(Boolean).join(', ');
  if (!choix.length) {
    afficherEtat(`Aucune image lisible trouvée (${fichiers.length} fichier(s) lus).`, true);
    return;
  }
  if (choix.length === 1 && ouvrables.length === 1) {
    afficherEtat(resume);
    ouvrables[0].ouvrir();
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
      c.ouvrir();
    });
    li.append(b);
    listeSeries.append(li);
  }
}

function ouvrir(pile, titre) {
  const i = cible;
  const ecran = ecrans[i];
  obtenirVisualiseur(i);
  ecran.querySelector('.ecran-titre').textContent = (i === 1 ? 'Examen 2 · ' : visualiseurs[1] ? 'Examen 1 · ' : '') + titre;
  ecran.hidden = false;
  visualiseurs[i].definirPile(pile);
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

for (const id of ['#choix-dossier', '#choix-fichiers']) {
  $(id).addEventListener('change', (e) => { traiter(e.target.files); e.target.value = ''; });
}

// Glisser-déposer, y compris de dossiers entiers.
const chargeur = $('#chargeur');
async function lireEntree(entree) {
  if (entree.isFile) return [await new Promise((ok, ko) => entree.file(ok, ko))];
  const lecteur = entree.createReader();
  const enfants = [];
  for (;;) { // readEntries renvoie les entrées par paquets
    const lot = await new Promise((ok, ko) => lecteur.readEntries(ok, ko));
    if (!lot.length) break;
    enfants.push(...lot);
  }
  return (await Promise.all(enfants.map(lireEntree))).flat();
}
chargeur.addEventListener('dragover', (e) => { e.preventDefault(); chargeur.classList.add('survol'); });
chargeur.addEventListener('dragleave', () => chargeur.classList.remove('survol'));
chargeur.addEventListener('drop', async (e) => {
  e.preventDefault();
  chargeur.classList.remove('survol');
  const entrees = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  traiter(entrees.length ? (await Promise.all(entrees.map(lireEntree))).flat() : e.dataTransfer.files);
});

