import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerPanneauEtendue } from '../js/etendue.js';

// DOM minimal : un élément factice par sélecteur, 5 éléments pour les listes de scores.
function element(valeur = '') {
  const ecouteurs = {};
  return {
    hidden: false, disabled: false, value: valeur, textContent: '', innerHTML: '', className: '', dataset: {}, style: {},
    addEventListener(type, f) { (ecouteurs[type] ||= []).push(f); },
    setAttribute() {},
    click() {},
    async declencher(type, e = {}) { for (const f of ecouteurs[type] || []) await f({ target: { dataset: {}, closest: () => null }, ...e }); },
  };
}
function conteneurFactice(segmentation = 'seuil') {
  const elements = new Map();
  const listes = ['[data-goh]', '[data-warrick]', '[data-kaz-vd]', '[data-kaz-fib]'];
  const c = element();
  c.querySelector = (s) => {
    if (!elements.has(s)) elements.set(s, element(s === '[data-q-segmentation]' ? segmentation : s === '[data-goh-cvf]' ? '' : '0'));
    return elements.get(s);
  };
  c.querySelectorAll = (s) => (listes.includes(s) ? Array.from({ length: 5 }, () => element('0')) : []);
  return c;
}

// Fantôme 64 × 64 : deux poumons rectangulaires à -850 UH (dont un bloc HAA à -400 UH) dans un corps à 40 UH.
function pileCalibree({ T = 64, N = 4, poumons = true, espacementPixel = [1, 1] } = {}) {
  const d = new Int16Array(T * T).fill(-1000);
  for (let y = 2; y < T - 2; y++) for (let x = 2; x < T - 2; x++) d[y * T + x] = 40;
  if (poumons) {
    for (let y = 10; y < 50; y++) for (let x = 4; x < 22; x++) d[y * T + x] = -850;
    for (let y = 10; y < 50; y++) for (let x = 42; x < 60; x++) d[y * T + x] = -850;
    for (let y = 20; y < 30; y++) for (let x = 8; x < 16; x++) d[y * T + x] = -400;
  }
  return { calibre: true, nombre: N, espacementPixel, espacementCoupes: 1, serie: { epaisseur: 1 }, coupe: async () => ({ donnees: d, largeur: T, hauteur: T }) };
}
const visualiseurFactice = (pile) => ({ pile, index: 0, definirCalque() {}, allerA() {}, afficherCalque() {}, definirPinceau() {} });

async function analyser(pile) {
  const c = conteneurFactice();
  const vis = visualiseurFactice(pile);
  const panneau = creerPanneauEtendue(c, () => vis);
  panneau.majDisponibilite();
  await c.querySelector('[data-lancer]').declencher('click');
  return { c, texte: c.querySelector('[data-q-volume]').innerHTML || c.querySelector('[data-q-volume]').textContent };
}

test('étendue : analyse par seuillage affichée sans erreur, valeurs au format français', async () => {
  const { c, texte } = await analyser(pileCalibree());
  assert.doesNotMatch(texte, /Analyse impossible|NaN|undefined|null/);
  // HAA : 8 × 10 voxels sur 2 × 40 × 18 par coupe.
  assert.match(texte, new RegExp(`HAA ${((100 * 80) / 1440).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`));
  assert.match(texte, /volume pulmonaire 0,01 L/);
  assert.equal(c.querySelector('[data-q-resultats]').hidden, false);
  assert.equal(c.querySelector('[data-lancer]').disabled, false);
});

test('étendue : aucun poumon segmenté → tirets, pas « Analyse impossible »', async () => {
  const { texte } = await analyser(pileCalibree({ poumons: false }));
  assert.doesNotMatch(texte, /Analyse impossible|NaN|undefined/);
  assert.match(texte, /HAA —/);
  assert.doesNotMatch(texte, /MLA/);
});

test('étendue : taille de pixel inconnue → pas de volume affiché', async () => {
  const { texte } = await analyser(pileCalibree({ espacementPixel: null }));
  assert.doesNotMatch(texte, /Analyse impossible|volume pulmonaire|mL/);
  assert.match(texte, /HAA \d/);
});
