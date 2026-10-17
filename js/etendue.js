// Panneau « Étendue » : scores visuels (Goh, Warrick, Kazerooni) et densitométrie automatique (DICOM).

import { goh, NIVEAUX_GOH, warrick, LESIONS_WARRICK, CLASSES_SEGMENTS, kazerooni, LOBES, GRADES_VERRE_DEPOLI, GRADES_FIBROSE, REFERENCES } from './scores.js';
import { analyserDensite, HAA_MIN, HAA_MAX } from './densitometrie.js';

const options = (libelles) => libelles.map((l, i) => `<option value="${i}">${l}</option>`).join('');
const fmt = (v, d = 1) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

// conteneur : élément du DOM ; visualiseur() : visualiseur actif ; reperesGoh : coupes proposées (numérotées à partir de 1)
export function creerPanneauEtendue(conteneur, visualiseur, { reperesGoh = null } = {}) {
  conteneur.innerHTML = `
    <div class="onglets" role="tablist">
      <button type="button" data-onglet="goh" aria-pressed="true">Goh</button>
      <button type="button" data-onglet="warrick">Warrick</button>
      <button type="button" data-onglet="kazerooni">Kazerooni</button>
      <button type="button" data-onglet="densite">Densitométrie</button>
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
    <section data-panneau="densite" class="score" hidden>
      <div data-densite-indispo><p class="note" style="margin-top:0">Disponible uniquement pour un scanner DICOM ouvert dans « Mon scanner » (valeurs en UH). Les images exportées (JPEG, cas publiés) ne contiennent pas de densités.</p></div>
      <div data-densite-dispo hidden>
        <p class="note" style="margin-top:0">Segmentation automatique des poumons, puis mesure du pourcentage de zones de haute atténuation (HAA : ${HAA_MIN} à ${HAA_MAX} UH, verre dépoli et réticulations).</p>
        <button type="button" class="bouton-principal" data-lancer>Lancer l’analyse</button>
        <progress hidden max="1" value="0"></progress>
        <div data-resultat-densite></div>
      </div>
      <p class="note">Limites : segmentation par seuillage à -300 UH : les condensations denses peuvent être exclues ; la trachée, les grosses bronches et un éventuel pneumomédiastin sont inclus. Un poumon normal contient aussi des HAA (parois vasculaires et bronchiques : 6 % sur le scanner normal de l’atlas) ; volume médian de HAA dans la cohorte MESA : 119 cm³. Vérifiez toujours le masque coupe par coupe. Valeurs dépendantes de l’inspiration, du filtre et de la dose ; à comparer seulement entre examens comparables.<br>${REFERENCES.haa}</p>
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

  // Densitométrie
  const majDisponibilite = () => {
    const ok = !!visualiseur()?.pile?.calibre;
    $('[data-densite-dispo]').hidden = !ok;
    $('[data-densite-indispo]').hidden = ok;
  };
  $('[data-lancer]').addEventListener('click', async () => {
    const vis = visualiseur();
    const pile = vis.pile;
    const barre = $('progress');
    const bouton = $('[data-lancer]');
    barre.hidden = false;
    bouton.disabled = true;
    $('[data-resultat-densite]').textContent = '';
    try {
      const r = await analyserDensite(pile, {
        espacementPixel: pile.espacementPixel,
        espacementCoupes: pile.espacementCoupes,
        epaisseur: pile.serie?.epaisseur,
      }, (n, total) => { barre.value = n / total; });
      if (vis.pile !== pile) return; // une autre série a été ouverte entre-temps
      vis.definirCalque({ largeur: r.largeurMasque, hauteur: r.hauteurMasque, masques: r.masques });
      $('[data-resultat-densite]').innerHTML = `
        <div class="resultat">HAA : <strong>${fmt(r.haaPourcent)} %</strong> du poumon${r.haaMl != null ? ` (${fmt(r.haaMl, 0)} mL)` : ''}<br>
        Volume pulmonaire : ${r.volumeMl != null ? `${fmt(r.volumeMl / 1000, 2)} L` : 'non calculé (coupes non contiguës)'}<br>
        Densité moyenne : ${fmt(r.densiteMoyenne, 0)} UH</div>
        <canvas class="histo" width="720" height="260" aria-label="Histogramme des densités pulmonaires"></canvas>
        <div class="legende-calque"><span class="p">Poumon segmenté</span><span class="h">HAA</span></div>`;
      dessinerHistogramme($('.histo'), r.histogramme);
    } catch (e) {
      $('[data-resultat-densite]').innerHTML = `<p class="etat erreur">Analyse impossible : ${e.message}</p>`;
    } finally {
      barre.hidden = true;
      bouton.disabled = false;
    }
  });

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
