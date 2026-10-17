// Page « Cas » : liste filtrable, ou visualisation d'un cas (?id=…). Format des données : data/cas/LISEZMOI.md

import { PileUrls } from './piles.js';
import { Visualiseur } from './visualiseur.js';
import { rendreTexte } from './texte.js';

const $ = (s) => document.querySelector(s);
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function lireJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Impossible de charger ${url} (${r.status})`);
  return r.json();
}

const badgeStatut = (c) => c.statut === 'relu'
  ? `<span class="badge relu">Relu${c.relecture?.date ? ` le ${echapper(new Date(c.relecture.date).toLocaleDateString('fr-FR'))}` : ''}</span>`
  : '<span class="badge brouillon">Brouillon, non relu</span>';

async function afficherListe() {
  $('#liste').hidden = false;
  const cas = await lireJson('data/cas/index.json');
  const valeurs = (cle) => [...new Set(cas.flatMap((c) => c[cle] || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  for (const [select, cle] of [['#filtre-maladie', 'maladies'], ['#filtre-pattern', 'patterns']]) {
    for (const v of valeurs(cle)) $(select).append(new Option(v, v));
    $(select).addEventListener('change', rendre);
  }
  function rendre() {
    const m = $('#filtre-maladie').value;
    const p = $('#filtre-pattern').value;
    const visibles = cas.filter((c) => (!m || c.maladies?.includes(m)) && (!p || c.patterns?.includes(p)));
    $('#cartes').innerHTML = visibles.map((c) => `
      <a class="carte" href="cas.html?id=${encodeURIComponent(c.id)}">
        <h2>${echapper(c.titre)}</h2>
        <p>${echapper([...(c.maladies || []), ...(c.patterns || [])].join(' · '))}</p>
        <p>${badgeStatut(c)}</p>
      </a>`).join('');
    $('#etat-liste').textContent = !cas.length
      ? 'Aucun cas publié pour l’instant : la bibliothèque est en cours de constitution.'
      : !visibles.length ? 'Aucun cas ne correspond à ces filtres.' : '';
  }
  rendre();
}

async function afficherCas(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Identifiant de cas invalide.');
  const base = `data/cas/${id}/`;
  const c = await lireJson(`${base}cas.json`);
  document.title = `${c.titre} · PIDscope`;
  $('#cas').hidden = false;

  const s = c.serie;
  const premier = s.premier ?? 1;
  const urls = Array.from({ length: s.nombre }, (_, i) => base + s.modele.replace('{n}', String(premier + i).padStart(s.chiffres || 1, '0')));
  const vis = new Visualiseur($('#cas .vis'));
  vis.definirPile(new PileUrls(urls, { espacementCoupes: s.espacement_mm ?? null, mention: s.fenetre ? `Fenêtre ${s.fenetre}` : '' }));

  const src = c.source || {};
  $('#panneau').innerHTML = `
    <h2>${echapper(c.titre)}</h2>
    <p>${[...(c.maladies || []), ...(c.patterns || [])].map((t) => `<span class="badge">${echapper(t)}</span>`).join(' ')} ${badgeStatut(c)}</p>
    <div class="texte">${rendreTexte(c.texte || '')}</div>
    <div class="source">
      Source : ${/^https?:\/\//.test(src.url || '') ? `<a href="${echapper(src.url)}" target="_blank" rel="noopener">${echapper(src.nom || src.url)}</a>` : echapper(src.nom || 'non précisée')}
      ${src.auteur ? ` · ${echapper(src.auteur)}` : ''}${src.licence ? ` · ${echapper(src.licence)}` : ''}
    </div>`;
  $('#panneau').addEventListener('click', (e) => {
    const n = e.target.closest('.lien-coupe')?.dataset.coupe;
    if (n) {
      vis.allerA(+n - 1);
      vis.zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

const id = new URLSearchParams(location.search).get('id');
(id ? afficherCas(id) : afficherListe()).catch((e) => {
  $('#erreur').hidden = false;
  $('#erreur').textContent = e.message;
});
