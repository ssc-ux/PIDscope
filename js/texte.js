// Mise en forme minimale des textes de cas, sans HTML brut (tout est échappé).
//   ## Titre (ligne seule) · - élément de liste · **gras** · [coupe 120] → bouton qui affiche la coupe 120 (numérotation à partir de 1)

const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Le gras est appliqué après échappement : son contenu ne peut donc pas contenir de HTML.
// [coupe 0] n'a pas de sens (numérotation à partir de 1) : il reste du texte.
const enLigne = (s) => echapper(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\[(coupes?) ([1-9]\d*)\]/g, '<button type="button" class="lien-coupe" data-coupe="$2">$1 $2</button>');

export function rendreTexte(texte) {
  if (texte == null) return '';
  const blocs = [];
  let liste = [];
  let paragraphe = [];
  const vider = () => {
    if (liste.length) blocs.push(`<ul>${liste.map((l) => `<li>${enLigne(l)}</li>`).join('')}</ul>`);
    if (paragraphe.length) blocs.push(`<p>${paragraphe.map(enLigne).join('<br>')}</p>`);
    liste = [];
    paragraphe = [];
  };
  for (const ligne of String(texte).replace(/\r/g, '').split('\n')) {
    const l = ligne.trim();
    if (!l) vider();
    else if (l.startsWith('## ')) { vider(); blocs.push(`<h3>${enLigne(l.slice(3).trim())}</h3>`); }
    else if (l.startsWith('- ')) { if (paragraphe.length) vider(); liste.push(l.slice(2).trim()); }
    else { if (liste.length) vider(); paragraphe.push(l); }
  }
  vider();
  return blocs.join('\n');
}
