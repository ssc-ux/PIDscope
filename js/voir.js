// Visualisation d'un cas publié (?id=…). Format des données : data/cas/LISEZMOI.md

import { PileUrls } from './piles.js';
import { Visualiseur } from './visualiseur.js';
import { rendreTexte } from './texte.js';
import { creerPanneauEtendue } from './etendue.js';

const $ = (s) => document.querySelector(s);
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const badgeStatut = (c) => c.statut === 'relu'
  ? `<span class="badge relu">Relu${c.relecture?.par ? ` par ${echapper(c.relecture.par)}` : ''}${c.relecture?.date ? ` le ${echapper(new Date(c.relecture.date).toLocaleDateString('fr-FR'))}` : ''}</span>`
  : '<span class="badge brouillon">Brouillon : non relu</span>';

const lien = (url, texte) => /^https?:\/\//.test(url || '') ? `<a href="${echapper(url)}" target="_blank" rel="noopener">${echapper(texte || url)}</a>` : echapper(texte || '');

async function afficher(id) {
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error('Cas introuvable.');
  const base = `data/cas/${id}/`;
  const r = await fetch(`${base}cas.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error('Cas introuvable.');
  const c = await r.json();
  document.title = `${c.titre} · PIDscope`;

  const s = c.serie;
  const urls = {};
  for (const [nom, modele] of Object.entries(s.fenetres))
    urls[nom] = Array.from({ length: s.nombre }, (_, i) => base + modele.replace('{n}', String(i + 1).padStart(s.chiffres || 4, '0')));
  const vis = new Visualiseur($('#vis'));
  const depart = +new URLSearchParams(location.search).get('coupe') || s.coupe_initiale;
  vis.definirPile(new PileUrls(urls, { espacementCoupes: s.espacement_mm ?? null }), { index: depart ? depart - 1 : undefined });

  const src = c.source || {};
  $('#lecture').innerHTML = `
    <h1>${echapper(c.titre)}</h1>
    <p>${[...(c.maladies || []), ...(c.patterns || [])].map((t) => `<span class="badge">${echapper(t)}</span>`).join(' ')} ${badgeStatut(c)}</p>
    <div class="texte">${rendreTexte(c.texte || '')}</div>
    ${c.liens?.length ? `<h2>Pour aller plus loin</h2><ul>${c.liens.map((l) => `<li>${lien(l.url, l.titre)}</li>`).join('')}</ul>` : ''}
    <div class="source">
      Images : ${lien(src.url, src.nom || 'source non précisée')}${src.auteur ? ` · ${echapper(src.auteur)}` : ''}${src.licence ? ` · licence ${echapper(src.licence)}` : ''}${src.modifications ? `<br>${echapper(src.modifications)}` : ''}
      ${s.espacement_mm ? `<br>Série : ${s.nombre} coupes, pas de ${String(s.espacement_mm).replace('.', ',')} mm.` : ''}
    </div>`;
  $('#lecture').addEventListener('click', (e) => {
    const n = e.target.closest('.lien-coupe')?.dataset.coupe;
    if (n) vis.allerA(+n - 1);
  });

  const panneau = creerPanneauEtendue($('#etendue'), () => vis, { reperesGoh: c.niveaux_goh });
  panneau.majDisponibilite();
  $('#onglets-cas').addEventListener('click', (e) => {
    const v = e.target.dataset?.vue;
    if (!v) return;
    $('#onglets-cas').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vue === v)));
    $('#lecture').hidden = v !== 'lecture';
    $('#etendue').hidden = v !== 'etendue';
  });
}

afficher(new URLSearchParams(location.search).get('id')).catch((e) => {
  $('#erreur').hidden = false;
  $('#erreur').textContent = e.message;
});
