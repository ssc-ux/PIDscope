// Panneau « Étendue » : scores visuels (Goh, Warrick, Kazerooni) et quantification semi-automatique des lésions.

import { goh, NIVEAUX_GOH, warrick, LESIONS_WARRICK, CLASSES_SEGMENTS, kazerooni, LOBES, GRADES_VERRE_DEPOLI, GRADES_FIBROSE, REFERENCES } from './scores.js';
import { HAA_MIN, HAA_MAX, BANDES_LCTA } from './densitometrie.js';
import { quantifierVolume, proportions, CLASSES } from './quantification.js';
import { pileUHDepuisFenetrePoumon } from './piles.js';
import { chargerModele, segmenterPile } from './lungmask.js';

const PALETTE = {
  [CLASSES.NORMAL]: [94, 214, 160, 0.12],
  [CLASSES.VERRE_DEPOLI]: [245, 197, 66, 0.55],
  [CLASSES.FIBROSE]: [255, 90, 90, 0.6],
  [CLASSES.CONDENSATION]: [139, 123, 255, 0.6],
};
const PINCEAUX = [
  [CLASSES.VERRE_DEPOLI, 'Verre dépoli'],
  [CLASSES.FIBROSE, 'Fibrose'],
  [CLASSES.CONDENSATION, 'Condensation'],
  [CLASSES.NORMAL, 'Poumon normal'],
  [CLASSES.HORS, 'Hors poumon'],
];

const options = (libelles) => libelles.map((l, i) => `<option value="${i}">${l}</option>`).join('');
const fmt = (v, d = 1) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

// conteneur : élément du DOM ; visualiseur() : visualiseur actif ; reperesGoh : coupes proposées (numérotées à partir de 1)
export function creerPanneauEtendue(conteneur, visualiseur, { reperesGoh = null } = {}) {
  conteneur.innerHTML = `
    <div class="onglets" role="tablist">
      <button type="button" data-onglet="goh" aria-pressed="true">Goh</button>
      <button type="button" data-onglet="warrick">Warrick</button>
      <button type="button" data-onglet="kazerooni">Kazerooni</button>
      <button type="button" data-onglet="quantif">Quantification</button>
    </div>
    <section data-panneau="goh" class="score">
      <p class="note" style="margin-top:0">Estimez l’étendue de la PID (verre dépoli + réticulations), à 5 % près, sur 5 niveaux. Placez-vous sur chaque niveau puis cliquez 📍.</p>
      <table>${NIVEAUX_GOH.map((n, i) => `<tr><td><strong>${i + 1}.</strong> ${n}<br>
        <button type="button" class="lien-coupe" data-niveau="${i}" hidden></button></td>
        <td><button type="button" data-marquer="${i}" title="Associer la coupe affichée">📍</button>
        <select data-goh="${i}" aria-label="Étendue au niveau ${i + 1}">${Array.from({ length: 21 }, (_, k) => `<option value="${k * 5}">${k * 5} %</option>`).join('')}</select></td></tr>`).join('')}
      </table>
      <p data-cvf hidden style="margin:.8rem 0 0">CVF (% de la théorique) : <input type="number" min="10" max="150" step="1" data-goh-cvf></p>
      <div class="resultat" data-resultat-goh></div>
      <p class="note">Seuils : &lt; 10 % atteinte minime (limitée) ; &gt; 30 % sévère (étendue) ; 10–30 % indéterminée → CVF ≥ 70 % limitée, &lt; 70 % étendue. Validé dans la sclérodermie systémique.<br>${REFERENCES.goh}</p>
    </section>
    <section data-panneau="warrick" class="score" hidden>
      <table>${LESIONS_WARRICK.map((l, i) => `<tr><td>${l.nom} <span class="badge">${l.points} pt</span></td>
        <td><select data-warrick="${i}">${options(CLASSES_SEGMENTS)}</select></td></tr>`).join('')}</table>
      <div class="resultat" data-resultat-warrick></div>
      <p class="note">Sévérité = somme des points des lésions présentes (0–15). Étendue = pour chaque lésion, 1 à 3 segments : 1 ; 4 à 9 : 2 ; plus de 9 : 3 (0–15). Total 0–30.<br>${REFERENCES.warrick}</p>
    </section>
    <section data-panneau="kazerooni" class="score" hidden>
      <table><tr><td></td><td style="text-align:left">Verre dépoli · Fibrose</td></tr>
      ${LOBES.map((l, i) => `<tr><td>${l}</td><td><select data-kaz-vd="${i}" aria-label="Verre dépoli, ${l}">${options(GRADES_VERRE_DEPOLI)}</select><br>
        <select data-kaz-fib="${i}" aria-label="Fibrose, ${l}">${options(GRADES_FIBROSE)}</select></td></tr>`).join('')}</table>
      <div class="resultat" data-resultat-kaz></div>
      <p class="note">Chaque lobe est coté de 0 à 5 pour le verre dépoli et pour la fibrose ; résultat = moyenne des 5 lobes (0–5).<br>${REFERENCES.kazerooni}</p>
    </section>
    <section data-panneau="quantif" class="score" hidden>
      <div data-q-indispo><p class="note" style="margin-top:0">Disponible pour un scanner DICOM (« Mon scanner ») ou un cas de l’atlas. Les images JPEG/PNG ne contiennent pas de densités.</p></div>
      <div data-q-dispo hidden>
        <p class="note" style="margin-top:0">Mesures de densité publiées sur tout le poumon, et carte exploratoire des lésions à vérifier et corriger au pinceau sur les 5 niveaux de Goh.</p>
        <p class="note" data-q-approx hidden>⚠ Cas de l’atlas : densités reconstituées depuis les images exportées (précision ± 6 UH, compression) : résultats approximatifs.</p>
        <p style="margin:.4rem 0">Segmentation des poumons : <select data-q-segmentation>
          <option value="lungmask" selected>lungmask (IA, recommandé)</option>
          <option value="seuil">seuillage -200 UH (rapide)</option></select></p>
        <button type="button" class="bouton-principal" data-lancer>Analyser le scanner</button>
        <p class="note" data-q-etat></p>
        <progress hidden max="1" value="0"></progress>
        <div data-q-resultats hidden>
          <div class="legende-calque"><span class="vd">Verre dépoli</span><span class="fib">Fibrose</span><span class="cond">Condensation</span></div>
          <div class="resultat neutre" data-q-volume></div>
          <h3>Vérification sur les 5 niveaux</h3>
          <p class="note" style="margin-top:0">Cliquez sur un niveau, corrigez la carte avec le pinceau (glisser sur l’image ; molette pour changer de coupe), puis validez. Les niveaux se définissent dans l’onglet Goh (📍).</p>
          <table data-q-niveaux></table>
          <div data-q-outils hidden style="margin-top:.8rem">
            <p style="margin:0 0 .4rem"><strong>Pinceau</strong> · rayon <select data-q-rayon><option value="2">2 mm</option><option value="5" selected>5 mm</option><option value="10">10 mm</option></select></p>
            <div class="onglets" data-q-pinceaux>${PINCEAUX.map(([v, n]) => `<button type="button" data-valeur="${v}">${n}</button>`).join('')}</div>
            <button type="button" data-q-valider>✓ Valider ce niveau</button>
          </div>
          <div class="resultat" data-q-synthese></div>
          <button type="button" data-q-reporter hidden>Reporter dans le score de Goh</button>
        </div>
      </div>
      <p class="note"><strong>Segmentation</strong> : lungmask R231 (réseau U-Net, Hofmanninger 2020, Apache 2.0), exécuté dans le navigateur ; sans carte graphique (WebGPU), une coupe tous les 5 mm est analysée et le volume n’est pas calculé. Option : seuillage à -200 UH (Best 2003).<br>
      <strong>Mesures publiées</strong> : HAA = % de voxels entre ${HAA_MIN} et ${HAA_MAX} UH (MESA), densité moyenne (MLA), asymétrie et kurtosis (en excès, loi normale = 0) des voxels pulmonaires de -1024 à -200 UH. Indices corrélés aux EFR dans la FPI et dans la sclérodermie ; aucune valeur seuil diagnostique : à comparer entre examens comparables d’un même patient.<br>
      <strong>Carte des lésions</strong> : méthode PIDscope <strong>exploratoire, non validée</strong> (condensation = ≥ 60 % de pixels &gt; -300 UH dans une fenêtre de 6 mm ; fibrose = réseau de structures fines ; verre dépoli = parenchyme non dense ≥ -700 UH). Validée contre la segmentation d’experts de 39 PID de sclérodermie (SICCS) : lésions totales ρ = 0,54 et verre dépoli ρ = 0,64, mais <strong>fibrose non fiable</strong> (ρ = 0,21), sans gain après recalibrage sur une moitié des patients : ne pas s’en servir pour distinguer fibrose et verre dépoli (détails : page Méthode). Elle ne remplace ni la lecture visuelle ni les outils validés (CALIPER, QILD, DTA, non disponibles en libre accès).<br>
      <strong>Limites</strong> : outil pédagogique, pas un dispositif médical. Résultats dépendants du filtre de reconstruction, de l’épaisseur de coupe, de l’inspiration, de l’injection et du constructeur ; atélectasies déclives et bruit des basses doses ; les densités ne distinguent pas un verre dépoli inflammatoire d’une fibrose fine ; valeurs non interchangeables avec les logiciels commerciaux.<br>
      Bandes de densité : 3D Slicer Lung CT Analyzer (Bumm, licence Apache 2.0) : emphysème -1050/-950, aéré -950/-750, infiltré -750/-400, collabé -400/0, vaisseaux ≥ 0 UH ; descriptives, sans validation publiée dans les PID.<br>
      ${REFERENCES.lungmask}<br>${REFERENCES.best}<br>${REFERENCES.camiciottoli}<br>${REFERENCES.haa}<br>${REFERENCES.haa2016}</p>
    </section>`;

  const $ = (s) => conteneur.querySelector(s);
  const $$ = (s) => [...conteneur.querySelectorAll(s)];

  $('.onglets').addEventListener('click', (e) => {
    const o = e.target.dataset?.onglet;
    if (!o) return;
    $$('.onglets button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.onglet === o)));
    $$('[data-panneau]').forEach((p) => { p.hidden = p.dataset.panneau !== o; });
  });

  // Goh
  const niveaux = [null, null, null, null, null];
  const marquer = (i, index, propose = false) => {
    niveaux[i] = index;
    const b = $(`[data-niveau="${i}"]`);
    b.hidden = index == null;
    b.textContent = `coupe ${index + 1}${propose ? ' (repère proposé)' : ''}`;
  };
  if (reperesGoh) reperesGoh.forEach((c, i) => c && marquer(i, c - 1, true));
  conteneur.addEventListener('click', (e) => {
    const m = e.target.dataset?.marquer;
    if (m != null && visualiseur()?.pile) marquer(+m, visualiseur().index);
    const n = e.target.closest('[data-niveau]')?.dataset.niveau;
    if (n != null && niveaux[n] != null) visualiseur()?.allerA(niveaux[n]);
  });
  const majGoh = () => {
    const p = $$('[data-goh]').map((s) => +s.value);
    const cvfTexte = $('[data-goh-cvf]').value;
    const r = goh(p, cvfTexte === '' ? null : +cvfTexte);
    $('[data-cvf]').hidden = r.scanner !== 'indéterminée';
    $('[data-resultat-goh]').className = `resultat${r.stade ? '' : ' neutre'}`;
    $('[data-resultat-goh]').innerHTML = `Étendue moyenne : <strong>${fmt(r.etendue)} %</strong> (atteinte ${r.scanner})<br>
      ${r.stade ? `Stade : <strong>PID ${r.stade}</strong>` : 'Indéterminée : renseignez la CVF pour conclure.'}`;
  };
  $$('[data-goh], [data-goh-cvf]').forEach((el) => el.addEventListener('input', majGoh));
  majGoh();

  // Warrick
  const majWarrick = () => {
    const r = warrick($$('[data-warrick]').map((s) => +s.value));
    $('[data-resultat-warrick]').innerHTML = `Score total : <strong>${r.total} / 30</strong><br>Sévérité ${r.severite} / 15 · Étendue ${r.etendue} / 15`;
  };
  $$('[data-warrick]').forEach((s) => s.addEventListener('input', majWarrick));
  majWarrick();

  // Kazerooni
  const majKaz = () => {
    const r = kazerooni($$('[data-kaz-vd]').map((s) => +s.value), $$('[data-kaz-fib]').map((s) => +s.value));
    $('[data-resultat-kaz]').innerHTML = `Verre dépoli : <strong>${fmt(r.verreDepoli.moyenne)} / 5</strong> (somme ${r.verreDepoli.somme}/25)<br>
      Fibrose : <strong>${fmt(r.fibrose.moyenne)} / 5</strong> (somme ${r.fibrose.somme}/25)`;
  };
  $$('[data-kaz-vd], [data-kaz-fib]').forEach((s) => s.addEventListener('input', majKaz));
  majKaz();

  // Quantification semi-automatique
  let analyse = null; // { vis, pile, classes, valides: Set, niveauActif }
  const sourceUH = (vis) => (vis?.pile?.calibre ? vis.pile : vis?.pile?.urlsParFenetre ? pileUHDepuisFenetrePoumon(vis.pile) : null);
  const majDisponibilite = () => {
    const vis = visualiseur();
    const ok = !!sourceUH(vis) && (vis.pile.calibre || vis.pile.pixelMm);
    $('[data-q-dispo]').hidden = !ok;
    $('[data-q-indispo]').hidden = ok;
    $('[data-q-approx]').hidden = !ok || !!vis.pile.calibre;
    if (analyse && analyse.pile !== vis?.pile) { analyse = null; $('[data-q-resultats]').hidden = true; }
  };
  const pct = (v) => `${fmt(v)} %`;
  const majNiveaux = () => {
    if (!analyse) return;
    const lignes = NIVEAUX_GOH.map((nom, i) => {
      const k = niveaux[i];
      if (k == null) return `<tr><td>${i + 1}. ${nom}</td><td class="note">non défini</td></tr>`;
      if (!analyse.classes[k]) return `<tr><td>${i + 1}. coupe ${k + 1}</td><td class="note">non analysée : relancez l’analyse</td></tr>`;
      const p = proportions([analyse.classes[k]]);
      const ok = analyse.valides.has(i);
      return `<tr data-q-niveau="${i}"${analyse.niveauActif === i ? ' style="outline:1px solid var(--accent)"' : ''}><td><button type="button" class="lien-coupe" data-q-aller="${i}">${i + 1}. coupe ${k + 1}</button></td>
        <td>VD ${pct(p.verreDepoli)} · Fib ${pct(p.fibrose)} ${ok ? '✓' : '<span class="badge">auto</span>'}</td></tr>`;
    });
    $('[data-q-niveaux]').innerHTML = lignes.join('');
    const definis = niveaux.map((k, i) => [k, i]).filter(([k]) => k != null && analyse.classes[k]);
    if (definis.length === 5) {
      const parNiveau = definis.map(([k]) => proportions([analyse.classes[k]]));
      const moy = (cle) => parNiveau.reduce((t, p) => t + p[cle], 0) / 5;
      const total = moy('verreDepoli') + moy('fibrose');
      $('[data-q-synthese]').innerHTML = `Étendue PID sur les 5 niveaux (${analyse.valides.size}/5 validés) : <strong>${pct(total)}</strong><br>
        Verre dépoli ${pct(moy('verreDepoli'))} · fibrose ${pct(moy('fibrose'))} · condensation ${pct(moy('condensation'))} (non comptée)`;
      $('[data-q-reporter]').hidden = false;
    } else {
      $('[data-q-synthese]').innerHTML = 'Définissez les 5 niveaux dans l’onglet Goh pour obtenir l’étendue.';
      $('[data-q-reporter]').hidden = true;
    }
  };
  const choisirPinceau = (valeur) => {
    $$('[data-q-pinceaux] button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.valeur === valeur)));
    analyse?.vis.definirPinceau(valeur == null ? null : { valeur, rayonMm: +$('[data-q-rayon]').value });
  };
  $('[data-lancer]').addEventListener('click', async () => {
    const vis = visualiseur();
    const pile = vis.pile;
    const source = sourceUH(vis);
    const barre = $('progress');
    const bouton = $('[data-lancer]');
    barre.hidden = false;
    bouton.disabled = true;
    const etat = $('[data-q-etat]');
    try {
      const geometrie = {
        espacementPixel: pile.calibre ? pile.espacementPixel : [pile.pixelMm, pile.pixelMm],
        espacementCoupes: pile.espacementCoupes,
        epaisseur: pile.serie?.epaisseur ?? pile.espacementCoupes,
      };
      let indices = Array.from({ length: source.nombre }, (_, k) => k);
      let r;
      if ($('[data-q-segmentation]').value === 'lungmask') {
        etat.textContent = 'Téléchargement du modèle lungmask…';
        const modele = await chargerModele((f) => { barre.value = f; });
        if (modele.fournisseur === 'wasm') {
          // Sans carte graphique, une coupe tous les 5 mm (plus les niveaux de Goh) pour garder un temps raisonnable.
          const pas = Math.max(1, Math.round(5 / (geometrie.espacementCoupes || 5)));
          indices = [...new Set([...indices.filter((k) => k % pas === 0), ...niveaux.filter((k) => k != null)])].sort((a, b) => a - b);
          geometrie.espacementCoupes = (geometrie.espacementCoupes || 1) * pas; // échantillonnage : volume non calculé
        }
        const sous = { nombre: indices.length, coupe: (i) => source.coupe(indices[i]) };
        etat.textContent = `Segmentation lungmask (${modele.fournisseur === 'webgpu' ? 'carte graphique, toutes les coupes' : `processeur, ${indices.length} coupes`})…`;
        const masques = await segmenterPile(sous, modele.executer, (f) => { barre.value = f; });
        etat.textContent = 'Mesures…';
        r = await quantifierVolume(sous, geometrie, (f) => { barre.value = f; }, { masques });
        etat.textContent = `Segmentation : lungmask R231, ${modele.fournisseur === 'webgpu' ? 'toutes les coupes' : `${indices.length} coupes (1 tous les 5 mm + niveaux de Goh)`}.`;
      } else {
        r = await quantifierVolume(source, geometrie, (f) => { barre.value = f; });
        etat.textContent = 'Segmentation : seuillage à -200 UH (Best 2003), toutes les coupes.';
      }
      if (vis.pile !== pile) return; // une autre série a été ouverte entre-temps
      // Replace les résultats sur la numérotation complète (null : coupe non analysée).
      const classes = new Array(pile.nombre).fill(null);
      indices.forEach((k, i) => { classes[k] = r.classes[i]; });
      r.classes = classes;
      analyse = { vis, pile, classes: r.classes, valides: new Set(), niveauActif: null };
      vis.definirCalque({ largeur: r.largeurMasque, hauteur: r.hauteurMasque, masques: r.classes, palette: PALETTE });
      vis.surPeinture = (k) => { const i = niveaux.indexOf(k); if (i >= 0) analyse.valides.delete(i); majNiveaux(); };
      const v = r.volume, d = r.densite;
      const ind = d.indices;
      $('[data-q-volume]').innerHTML = `<strong>Mesures publiées</strong> (tout le poumon)<br>
        HAA ${pct(d.haaPourcent)}${d.haaMl != null ? ` (${fmt(d.haaMl, 0)} mL)` : ''}${d.volumeMl != null ? ` · volume pulmonaire ${fmt(d.volumeMl / 1000, 2)} L` : ''}<br>
        ${ind ? `MLA ${fmt(ind.mla, 0)} UH · asymétrie ${fmt(ind.asymetrie, 2)} · kurtosis ${fmt(ind.kurtosis, 2)}` : ''}<br>
        Bandes (Lung CT Analyzer) : ${BANDES_LCTA.map((b) => `${b.nom.toLowerCase()} ${pct(d.bandes[b.cle])}`).join(' · ')}<br>
        <strong>Carte exploratoire</strong> (non validée) : verre dépoli ${pct(v.verreDepoli)} · fibrose ${pct(v.fibrose)} · condensation ${pct(v.condensation)}`;
      $('[data-q-resultats]').hidden = false;
      majNiveaux();
    } catch (e) {
      $('[data-q-volume]').textContent = `Analyse impossible : ${e.message}`;
      $('[data-q-resultats]').hidden = false;
    } finally {
      barre.hidden = true;
      bouton.disabled = false;
    }
  });
  conteneur.addEventListener('click', (e) => {
    if (!analyse) return;
    const aller = e.target.closest('[data-q-aller]')?.dataset.qAller;
    if (aller != null) {
      analyse.niveauActif = +aller;
      analyse.vis.allerA(niveaux[+aller]);
      analyse.vis.afficherCalque(true);
      $('[data-q-outils]').hidden = false;
      majNiveaux();
    }
    const v = e.target.closest('[data-q-pinceaux] button')?.dataset.valeur;
    if (v != null) choisirPinceau(analyse.vis.pinceau?.valeur === +v ? null : +v);
  });
  $('[data-q-rayon]').addEventListener('change', () => analyse?.vis.pinceau && choisirPinceau(analyse.vis.pinceau.valeur));
  $('[data-q-valider]').addEventListener('click', () => {
    if (analyse?.niveauActif == null) return;
    analyse.valides.add(analyse.niveauActif);
    choisirPinceau(null);
    majNiveaux();
  });
  $('[data-q-reporter]').addEventListener('click', () => {
    niveaux.forEach((k, i) => {
      if (k == null || !analyse.classes[k]) return;
      const p = proportions([analyse.classes[k]]);
      $(`[data-goh="${i}"]`).value = String(Math.min(100, Math.round((p.verreDepoli + p.fibrose) / 5) * 5));
    });
    majGoh();
    $('[data-onglet="goh"]').click();
  });
  // Les niveaux (📍) changent dans l'onglet Goh : mettre à jour la vérification.
  conteneur.addEventListener('click', (e) => { if (e.target.dataset?.marquer != null) majNiveaux(); });

  return { majDisponibilite };
}

function dessinerHistogramme(canvas, { min, pas, valeurs }) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, bas = H - 34;
  const max = Math.max(...valeurs) || 1;
  const x = (uh) => ((uh - min) / (valeurs.length * pas)) * W;
  ctx.fillStyle = 'rgba(255,138,61,.14)';
  ctx.fillRect(x(HAA_MIN), 0, x(HAA_MAX) - x(HAA_MIN), bas);
  valeurs.forEach((v, i) => {
    const uh = min + i * pas;
    ctx.fillStyle = uh >= HAA_MIN && uh < HAA_MAX ? '#ff8a3d' : '#5ed6a0';
    const h = (v / max) * (bas - 8);
    ctx.fillRect(x(uh), bas - h, Math.max(1, x(uh + pas) - x(uh) - 1), h);
  });
  ctx.fillStyle = '#a1a1aa';
  ctx.font = '22px system-ui';
  ctx.textAlign = 'center';
  for (const uh of [-1000, -800, -600, -400, -250, 0]) ctx.fillText(String(uh), Math.min(W - 24, Math.max(24, x(uh))), H - 6);
}
