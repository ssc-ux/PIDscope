// Accueil : atlas des cas sous forme de cartes, filtrables par catégorie.

const $ = (s) => document.querySelector(s);
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const OUTILS = [
  { href: 'scanner.html', titre: 'Mon scanner', description: 'Ouvrir un scanner DICOM ou des images, comparer deux examens et mesurer l’étendue. Rien n’est envoyé.', icone: '🔒', etiquette: 'OUTIL', categorie: 'Outils' },
  { href: 'fiches.html', titre: 'Fiches de sémiologie', description: 'Lésions élémentaires, patterns de PID et orientation selon la connectivite, avec leurs références.', icone: '📖', etiquette: 'FICHES', categorie: 'Outils' },
];

const carte = (c) => `
  <a class="carte" href="${echapper(c.href)}">
    <div class="carte-image">
      ${c.vignette ? `<img src="${echapper(c.vignette)}" alt="" loading="lazy">` : `<span class="icone" aria-hidden="true">${c.icone}</span>`}
      <span class="etiquette">${echapper(c.etiquette)}</span>
      ${c.statut ? `<span class="statut ${c.statut === 'relu' ? 'relu' : ''}">${c.statut === 'relu' ? 'RELU' : 'BROUILLON'}</span>` : ''}
    </div>
    <div class="carte-texte"><h2>${echapper(c.titre)}</h2><p>${echapper(c.description)}</p></div>
  </a>`;

// Charge un JSON en traduisant les erreurs réseau et de format en messages lisibles.
async function chargerJson(url, messageErreur) {
  let r;
  try { r = await fetch(url, { cache: 'no-cache' }); } catch { throw new Error(`${messageErreur} Vérifiez la connexion.`); }
  if (!r.ok) throw new Error(`${messageErreur} (HTTP ${r.status})`);
  try { return await r.json(); } catch { throw new Error(`${messageErreur} (fichier mal formé)`); }
}

async function demarrer() {
  $('#cartes').innerHTML = '<p class="etat" role="status">Chargement des cas…</p>';
  const liste = await chargerJson('data/cas/index.json', 'Impossible de charger la liste des cas.');
  if (!Array.isArray(liste)) throw new Error('Impossible de charger la liste des cas (format inattendu).');
  const cas = liste.filter((c) => /^[a-z0-9-]+$/.test(c?.id || '')).map((c) => ({
    ...c,
    href: `voir.html?id=${encodeURIComponent(c.id)}`,
    vignette: `data/cas/${encodeURIComponent(c.id)}/vignette.webp`,
    etiquette: c.etiquette || 'TDM',
    categorie: c.categorie || 'Autres',
  }));
  // Les cas de connectivite sont regroupés par maladie pour le filtre.
  const GROUPES = { 'Sclérodermie systémique': 'Sclérodermie', 'Syndrome des antisynthétases': 'Myosites', 'Dermatomyosite anti-MDA5': 'Myosites',
    'Myopathies inflammatoires': 'Myosites', 'Polyarthrite rhumatoïde': 'Polyarthrite rhumatoïde', 'Syndrome de Sjögren': 'Sjögren' };
  for (const c of cas) if (c.categorie === 'Connectivités') c.categorie = GROUPES[c.maladies?.[0]] || 'Autres connectivites';
  const tout = [...cas, ...OUTILS];
  const categories = ['Tout', ...new Set(tout.map((c) => c.categorie))];
  let choix = 'Tout';
  const rendre = () => {
    $('#filtres').innerHTML = categories.map((c) => `<button type="button" aria-pressed="${c === choix}" data-cat="${echapper(c)}">${echapper(c)}</button>`).join('');
    $('#cartes').innerHTML = tout.filter((c) => choix === 'Tout' || c.categorie === choix).map(carte).join('');
  };
  $('#filtres').addEventListener('click', (e) => {
    const cat = e.target.closest('button[data-cat]')?.dataset.cat;
    if (cat) { choix = cat; rendre(); }
  });
  // Vignette absente : on retire l'image cassée plutôt que d'afficher l'icône du navigateur.
  $('#cartes').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  rendre();
}

demarrer().catch((e) => {
  $('#cartes').innerHTML = '';
  $('#erreur').hidden = false;
  $('#erreur').textContent = e.message;
});
