// Accueil : atlas des cas sous forme de cartes, filtrables par catégorie.

const $ = (s) => document.querySelector(s);
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const OUTILS = [
  { href: 'scanner.html', titre: 'Mon scanner', description: 'Ouvrir un scanner DICOM ou des images, comparer deux examens et mesurer l’étendue. Rien n’est envoyé.', icone: '🔒', etiquette: 'OUTIL', categorie: 'Outils' },
  { href: 'fiches.html', titre: 'Fiches de sémiologie', description: 'Lésions élémentaires, patterns de PID et orientation selon la connectivite, avec leurs références.', icone: '📖', etiquette: 'FICHES', categorie: 'Outils' },
];

const carte = (c) => `
  <a class="carte" href="${c.href}">
    <div class="carte-image">
      ${c.vignette ? `<img src="${c.vignette}" alt="" loading="lazy">` : `<span class="icone" aria-hidden="true">${c.icone}</span>`}
      <span class="etiquette">${echapper(c.etiquette)}</span>
      ${c.statut ? `<span class="statut ${c.statut === 'relu' ? 'relu' : ''}">${c.statut === 'relu' ? 'RELU' : 'BROUILLON'}</span>` : ''}
    </div>
    <div class="carte-texte"><h2>${echapper(c.titre)}</h2><p>${echapper(c.description)}</p></div>
  </a>`;

async function demarrer() {
  const r = await fetch('data/cas/index.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Impossible de charger la liste des cas.');
  const cas = (await r.json()).map((c) => ({
    ...c,
    href: `voir.html?id=${encodeURIComponent(c.id)}`,
    vignette: `data/cas/${encodeURIComponent(c.id)}/vignette.webp`,
    etiquette: c.etiquette || 'TDM',
  }));
  const tout = [...cas, ...OUTILS];
  const categories = ['Tout', ...new Set(tout.map((c) => c.categorie))];
  let choix = 'Tout';
  const rendre = () => {
    $('#filtres').innerHTML = categories.map((c) => `<button type="button" aria-pressed="${c === choix}" data-cat="${echapper(c)}">${echapper(c)}</button>`).join('');
    $('#cartes').innerHTML = tout.filter((c) => choix === 'Tout' || c.categorie === choix).map(carte).join('');
  };
  $('#filtres').addEventListener('click', (e) => {
    if (e.target.dataset.cat) { choix = e.target.dataset.cat; rendre(); }
  });
  rendre();
}

demarrer().catch((e) => { $('#erreur').hidden = false; $('#erreur').textContent = e.message; });
