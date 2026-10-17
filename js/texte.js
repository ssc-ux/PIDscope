// Mise en forme minimale des textes de cas, sans HTML brut (tout est échappé).
//   ## Titre · - élément de liste · **gras** · [coupe 120] → bouton qui affiche la coupe 120 (numérotation à partir de 1)

const echapper = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const enLigne = (s) => echapper(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\[coupes? (\d+)\]/g, '<button type="button" class="lien-coupe" data-coupe="$1">coupe $1</button>');

export function rendreTexte(texte) {
  const blocs = [];
  for (const bloc of String(texte).replace(/\r/g, '').split(/\n\s*\n/)) {
    const lignes = bloc.split('\n').filter((l) => l.trim());
    if (!lignes.length) continue;
    if (lignes.every((l) => /^\s*- /.test(l))) {
      blocs.push(`<ul>${lignes.map((l) => `<li>${enLigne(l.replace(/^\s*- /, ''))}</li>`).join('')}</ul>`);
    } else if (lignes.length === 1 && /^## /.test(lignes[0])) {
      blocs.push(`<h3>${enLigne(lignes[0].slice(3))}</h3>`);
    } else {
      blocs.push(`<p>${lignes.map(enLigne).join('<br>')}</p>`);
    }
  }
  return blocs.join('\n');
}
