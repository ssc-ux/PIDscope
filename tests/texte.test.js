import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreTexte } from '../js/texte.js';

test('liens de coupe, gras, listes, titres', () => {
  const h = rendreTexte('## Signes\n\n- **Verre dépoli** [coupe 12]\n- Réticulations\n\nTexte\nsuite');
  assert.equal(h, '<h3>Signes</h3>\n<ul><li><strong>Verre dépoli</strong> <button type="button" class="lien-coupe" data-coupe="12">coupe 12</button></li><li>Réticulations</li></ul>\n<p>Texte<br>suite</p>');
});

test('titre suivi directement d’un paragraphe puis d’une liste', () => {
  assert.equal(rendreTexte('## Titre\nTexte\n- a\n- b'), '<h3>Titre</h3>\n<p>Texte</p>\n<ul><li>a</li><li>b</li></ul>');
});

test('le HTML est toujours échappé', () => {
  assert.equal(rendreTexte('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
});


import { readFileSync, readdirSync, existsSync } from 'node:fs';

test('texte absent → chaîne vide', () => {
  assert.equal(rendreTexte(null), '');
  assert.equal(rendreTexte(undefined), '');
  assert.equal(rendreTexte(''), '');
});

test('guillemets et apostrophes échappés (pas d’injection d’attribut)', () => {
  assert.equal(rendreTexte(`"a" 'b' & c`), '<p>&quot;a&quot; &#39;b&#39; &amp; c</p>');
  assert.equal(rendreTexte('[coupe 1" onclick="x]'), '<p>[coupe 1&quot; onclick=&quot;x]</p>');
});

test('le gras ne laisse pas passer de HTML', () => {
  assert.equal(rendreTexte('**<b>x</b>**'), '<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>');
  assert.equal(rendreTexte('## <script>alert(1)</script>'), '<h3>&lt;script&gt;alert(1)&lt;/script&gt;</h3>');
});

test('[coupe N] : numérotation à partir de 1, singulier et pluriel', () => {
  assert.equal(rendreTexte('[coupe 0]'), '<p>[coupe 0]</p>');
  assert.equal(rendreTexte('[coupes 3]'), '<p><button type="button" class="lien-coupe" data-coupe="3">coupes 3</button></p>');
  assert.equal(rendreTexte('[coupe 1] et [coupe 20]').match(/data-coupe/g).length, 2);
});

test('fins de ligne Windows et espaces superflus', () => {
  assert.equal(rendreTexte('##   Titre  \r\n-   a\r\n\r\nb'), '<h3>Titre</h3>\n<ul><li>a</li></ul>\n<p>b</p>');
});

test('textes des cas publiés : aucun HTML hors balises autorisées', () => {
  const dossier = new URL('../data/cas/', import.meta.url);
  const autorisees = /<\/?(h3|ul|li|p|br|strong)>|<button type="button" class="lien-coupe" data-coupe="\d+">|<\/button>/g;
  let n = 0;
  for (const id of readdirSync(dossier)) {
    const f = new URL(`${id}/cas.json`, dossier);
    if (!existsSync(f)) continue;
    const { texte } = JSON.parse(readFileSync(f, 'utf8'));
    assert.doesNotMatch(rendreTexte(texte).replace(autorisees, ''), /[<>]/, id);
    n++;
  }
  assert.ok(n > 0);
});
