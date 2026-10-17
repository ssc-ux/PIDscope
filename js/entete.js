// En-tête et pied de page communs.

const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="#000" stroke="#fff" stroke-width="2"/>
<path d="M18 11c-4 1-8 8-8 15 0 3 2 4 4 3l4-2zM22 11c4 1 8 8 8 15 0 3-2 4-4 3l-4-2z" fill="#fff"/><path d="M20 7v9" stroke="#fff" stroke-width="2"/></svg>`;

const PAGES = [
  ['index.html', 'Atlas'],
  ['fiches.html', 'Fiches'],
  ['methode.html', 'Méthode'],
  ['scanner.html', 'Mon scanner'],
];

const page = document.body.dataset.page;
const entete = document.querySelector('header.entete');
if (entete) {
  entete.innerHTML = `
    <a class="marque" href="./">${LOGO}PIDscope <span class="pastille">Médecine interne</span></a>
    <nav>${PAGES.map(([href, nom]) => `<a href="${href}"${href === page ? ' aria-current="page"' : ''}>${nom}</a>`).join('')}</nav>`;
}
const pied = document.querySelector('footer.pied');
if (pied) {
  pied.innerHTML = `Outil pédagogique : ne constitue pas une aide au diagnostic · <a href="references.html">Références</a> ·
    <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.fr">CC BY-NC-SA 4.0</a> · images : voir la source de chaque cas`;
}
