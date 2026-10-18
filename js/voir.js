// Visualisation d'un cas publié (?id=…). Format des données : data/cas/LISEZMOI.md

import { PileUrls } from './piles.js';
import { Visualiseur } from './visualiseur.js';
import { rendreTexte } from './texte.js';
import { creerPanneauEtendue } from './etendue.js';

const $ = (s) => document.querySelector(s);
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const dateFr = (d) => { const t = new Date(d); return d && !Number.isNaN(t.getTime()) ? t.toLocaleDateString('fr-FR') : ''; };
const badgeStatut = (c) => c.statut === 'relu'
  ? `<span class="badge relu">Relu${c.relecture?.par ? ` par ${echapper(c.relecture.par)}` : ''}${dateFr(c.relecture?.date) ? ` le ${echapper(dateFr(c.relecture.date))}` : ''}</span>`
  : '<span class="badge brouillon">Brouillon : non relu</span>';

// Nombre affiché à la française ; toute valeur non numérique du JSON est neutralisée.
const nombreFr = (v) => (v != null && v !== '' && Number.isFinite(+v) ? (+v).toLocaleString('fr-FR') : '?');

// Charge un JSON en traduisant les erreurs réseau et de format en messages lisibles.
async function chargerJson(url, messageErreur) {
  let r;
  try { r = await fetch(url, { cache: 'no-cache' }); } catch { throw new Error(`${messageErreur} Vérifiez la connexion.`); }
  if (!r.ok) throw new Error(r.status === 404 ? 'Cas introuvable.' : `${messageErreur} (HTTP ${r.status})`);
  try { return await r.json(); } catch { throw new Error(`${messageErreur} (fichier mal formé)`); }
}

const numero = (modele, i, chiffres) => modele.replace('{n}', String(i + 1).padStart(chiffres || 4, '0'));

const lien = (url, texte) => /^https?:\/\//.test(url || '') ? `<a href="${echapper(url)}" target="_blank" rel="noopener">${echapper(texte || url)}</a>` : echapper(texte || '');

async function afficher(id) {
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error('Cas introuvable.');
  const base = `data/cas/${id}/`;
  $('#lecture').innerHTML = '<p class="etat" role="status">Chargement du cas…</p>';
  const c = await chargerJson(`${base}cas.json`, 'Impossible de charger le cas.');
  const s = c?.serie;
  const serieValide = s && (Array.isArray(s.images) ? s.images.length > 0
    : Number.isInteger(s.nombre) && s.nombre > 0 && s.fenetres && Object.values(s.fenetres).length > 0
      && Object.values(s.fenetres).every((m) => typeof m === 'string'));
  if (!serieValide) throw new Error('Cas mal décrit : série d’images absente ou incomplète.');
  document.title = `${c.titre || 'Cas'} · PIDscope`;

  const urls = {};
  if (s.images) urls.poumon = s.images.map((f) => base + f); // figures publiées : liste explicite d'images
  else for (const [nom, modele] of Object.entries(s.fenetres))
    urls[nom] = Array.from({ length: s.nombre }, (_, i) => base + numero(modele, i, s.chiffres));
  const vis = new Visualiseur($('#vis'));
  const coupeUrl = +new URLSearchParams(location.search).get('coupe');
  const depart = Number.isInteger(coupeUrl) && coupeUrl > 0 ? coupeUrl : s.coupe_initiale;
  const pileCas = new PileUrls(urls, { espacementCoupes: s.espacement_mm ?? null, pixelMm: s.pixel_mm ?? null });
  if (s.images) Object.defineProperties(pileCas, { mention: { value: 'Figure publiée, reproduite sans modification' }, unite: { value: 'Figure' } });
  vis.definirPile(pileCas, { index: depart ? depart - 1 : s.images ? 0 : undefined });

  const src = c.source || {};
  $('#lecture').innerHTML = `
    <h1>${echapper(c.titre)}</h1>
    <p>${[...(c.maladies || []), ...(c.patterns || [])].map((t) => `<span class="badge">${echapper(t)}</span>`).join(' ')} ${badgeStatut(c)}</p>
    ${c.experts?.modele ? `<div class="score" style="margin:.8rem 0">
      <button type="button" id="experts">Afficher la lecture des experts</button>
      <div class="legende-calque"><span class="fib">Fibrose établie</span><span class="vd">Fibrose fine / verre dépoli</span></div>
      ${c.experts.etendue ? `<p class="note">Étendue mesurée sur la segmentation des experts : fibrose établie ${echapper(nombreFr(c.experts.etendue.fibrose))} %, fibrose fine / verre dépoli ${echapper(nombreFr(c.experts.etendue.verre_depoli))} % du poumon.</p>` : ''}
      <p class="note">${echapper(c.experts.source || '')}</p></div>` : ''}
    <div class="texte">${rendreTexte(c.texte || '')}</div>
    ${c.liens?.length ? `<h2>Pour aller plus loin</h2><ul>${c.liens.map((l) => `<li>${lien(l.url, l.titre)}</li>`).join('')}</ul>` : ''}
    <div class="source">
      Images : ${lien(src.url, src.nom || 'source non précisée')}${src.auteur ? ` · ${echapper(src.auteur)}` : ''}${src.licence ? ` · licence ${echapper(src.licence)}` : ''}${src.modifications ? `<br>${echapper(src.modifications)}` : ''}
      ${s.espacement_mm ? `<br>Série : ${echapper(nombreFr(s.nombre))} coupes, pas de ${echapper(nombreFr(s.espacement_mm))} mm.` : ''}
    </div>`;
  $('#lecture').addEventListener('click', (e) => {
    const n = e.target.closest?.('.lien-coupe')?.dataset.coupe;
    if (n) vis.allerA(+n - 1);
  });

  // Segmentation des experts (images PNG demi-résolution : 1 poumon normal, 2 fibrose établie, 3 fibrose fine / verre dépoli).
  const boutonExperts = $('#experts');
  if (boutonExperts) {
    let calque = null;
    boutonExperts.addEventListener('click', async () => {
      if (vis.calque && vis.calque === calque) {
        vis.afficherCalque(!vis.calqueVisible);
        boutonExperts.textContent = vis.calqueVisible ? 'Masquer la lecture des experts' : 'Afficher la lecture des experts';
        return;
      }
      boutonExperts.disabled = true;
      $('#erreur').hidden = true;
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const masques = [];
        let l = 0, h = 0;
        for (let i = 0; i < pileCas.nombre; i++) {
          boutonExperts.textContent = `Chargement… ${i + 1} / ${pileCas.nombre}`;
          const r = await fetch(base + numero(c.experts.modele, i, s.chiffres));
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const img = await createImageBitmap(await r.blob());
          l = canvas.width = img.width; h = canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          img.close?.();
          const px = ctx.getImageData(0, 0, l, h).data;
          masques.push(Uint8Array.from({ length: l * h }, (_, j) => px[j * 4]));
        }
        calque = { largeur: l, hauteur: h, masques, palette: { 1: [94, 214, 160, 0.08], 2: [255, 90, 90, 0.55], 3: [245, 197, 66, 0.5] } };
        vis.definirCalque(calque);
        boutonExperts.textContent = 'Masquer la lecture des experts';
      } catch {
        boutonExperts.textContent = 'Afficher la lecture des experts';
        $('#erreur').hidden = false;
        $('#erreur').textContent = 'Impossible de charger la lecture des experts. Réessayez plus tard.';
      } finally {
        boutonExperts.disabled = false;
      }
    });
  }

  const panneau = creerPanneauEtendue($('#etendue'), () => vis, { reperesGoh: c.niveaux_goh });
  panneau.majDisponibilite();
  $('#onglets-cas').addEventListener('click', (e) => {
    const v = e.target.closest?.('[data-vue]')?.dataset.vue;
    if (!v) return;
    $('#onglets-cas').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vue === v)));
    $('#lecture').hidden = v !== 'lecture';
    $('#etendue').hidden = v !== 'etendue';
  });
}

afficher(new URLSearchParams(location.search).get('id')).catch((e) => {
  $('#lecture').innerHTML = '';
  $('#erreur').hidden = false;
  $('#erreur').textContent = e.message;
});
