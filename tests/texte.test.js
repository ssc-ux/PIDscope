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

