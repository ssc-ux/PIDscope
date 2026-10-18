// Visualiseur de coupes : défilement (molette, glisser, clavier, curseur), zoom, déplacement, fenêtrage,
// calque optionnel (masque pulmonaire et zones de haute atténuation).

export const FENETRES = {
  poumon: { nom: 'Poumon', largeur: 1500, centre: -600 },
  mediastin: { nom: 'Médiastin', largeur: 350, centre: 40 },
};

const limiter = (v, min, max) => Math.min(max, Math.max(min, v));
// Palette par défaut d'un calque : valeur → [r, g, b, opacité].
const PALETTE_DEFAUT = { 1: [94, 214, 160, 0.18], 2: [255, 138, 61, 0.55] };

// Table de correspondance UH (Int16, décalées de 32768) → niveau de gris pour une fenêtre donnée.
export function lutFenetre(largeur, centre, inverse = false) {
  const bas = centre - largeur / 2;
  const lut = new Uint8ClampedArray(65536);
  for (let v = -32768; v < 32768; v++) {
    const g = ((v - bas) / largeur) * 255;
    lut[v + 32768] = inverse ? 255 - g : g;
  }
  return lut;
}

// Déplacement vertical d'un évènement « wheel » ramené en pixels (lignes : 16 px, pages : hauteurPage).
export function deltaMolette({ deltaY, deltaMode }, hauteurPage = 800) {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * hauteurPage : deltaY;
}

// Action associée à une touche (null si la touche n'est pas gérée ou combinée à Ctrl/Alt/Méta,
// pour laisser passer les raccourcis du navigateur comme Alt+← « page précédente »).
const PAS_CLAVIER = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, PageUp: -10, PageDown: 10 };
export function actionClavier({ key, ctrlKey, altKey, metaKey }) {
  if (ctrlKey || altKey || metaKey) return null;
  if (PAS_CLAVIER[key]) return { type: 'pas', valeur: PAS_CLAVIER[key] };
  if (key === 'Home') return { type: 'debut' };
  if (key === 'End') return { type: 'fin' };
  if (key === '+' || key === '=') return { type: 'zoom', facteur: 1.25 };
  if (key === '-' || key === '_') return { type: 'zoom', facteur: 0.8 };
  if (key === '0') return { type: 'reinit' };
  return null;
}

export class Visualiseur {
  constructor(conteneur, { surChangement = () => {} } = {}) {
    this.surChangement = surChangement;
    this.pile = null;
    this.index = 0;
    this.fenetre = { ...FENETRES.poumon };
    this.vue = { zoom: 1, dx: 0, dy: 0 };
    this.calque = null; // { largeur, hauteur, masques: Uint8Array[] (demi-résolution), palette }
    this.calqueVisible = false;
    this.pinceau = null; // { valeur, rayonMm } : le glisser peint le calque au lieu de faire défiler
    this.surPeinture = () => {};
    this.erreur = null;
    this.indexImage = -1; // coupe réellement affichée (this.index peut être en cours de chargement)
    this.jeton = 0; // numéro de la dernière demande de chargement : les réponses plus anciennes sont ignorées
    this.trame = 0;
    this.lut = null;
    // Tous les écouteurs sont rattachés à ce signal : detruire() les retire d'un coup.
    this.abandon = new AbortController();
    const signal = this.abandon.signal;

    conteneur.classList.add('visualiseur');
    conteneur.innerHTML = `
      <div class="vis-zone" tabindex="0" aria-label="Image de scanner : molette, glisser ou flèches pour faire défiler les coupes ; + et − pour zoomer, 0 pour réinitialiser">
        <canvas></canvas>
        <div class="vis-info vis-haut"></div>
        <div class="vis-info vis-bas"></div>
        <div class="vis-outils">
          ${Object.entries(FENETRES).map(([k, f]) => `<button type="button" data-fenetre="${k}">${f.nom}</button>`).join('')}
          <button type="button" class="vis-calque" hidden aria-pressed="false">Masque</button>
          <button type="button" class="vis-reinit" title="Réinitialiser (double-clic)">⟲</button>
        </div>
        <div class="vis-vide">Aucune série chargée</div>
      </div>
      <div class="vis-commandes">
        <button type="button" class="vis-prec" aria-label="Coupe précédente">▲</button>
        <input type="range" min="0" max="0" value="0" aria-label="Numéro de coupe">
        <button type="button" class="vis-suiv" aria-label="Coupe suivante">▼</button>
      </div>`;
    this.zone = conteneur.querySelector('.vis-zone');
    this.canvas = conteneur.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.infoHaut = conteneur.querySelector('.vis-haut');
    this.infoBas = conteneur.querySelector('.vis-bas');
    this.vide = conteneur.querySelector('.vis-vide');
    this.curseur = conteneur.querySelector('input[type=range]');
    this.outils = conteneur.querySelector('.vis-outils');
    this.boutonCalque = conteneur.querySelector('.vis-calque');
    this.horsEcran = document.createElement('canvas');
    this.image = null;

    this.curseur.addEventListener('input', () => this.allerA(+this.curseur.value), { signal });
    conteneur.querySelector('.vis-prec').addEventListener('click', () => this.allerA(this.index - 1), { signal });
    conteneur.querySelector('.vis-suiv').addEventListener('click', () => this.allerA(this.index + 1), { signal });
    conteneur.querySelector('.vis-reinit').addEventListener('click', () => this.reinitialiser(), { signal });
    this.boutonCalque.addEventListener('click', () => this.afficherCalque(!this.calqueVisible), { signal });
    this.outils.addEventListener('click', (e) => {
      const k = e.target.closest?.('[data-fenetre]')?.dataset.fenetre;
      if (k) this.choisirFenetre(k);
    }, { signal });
    // Les boutons ne doivent pas déclencher le défilement de l'image.
    this.outils.addEventListener('pointerdown', (e) => e.stopPropagation(), { signal });
    this.outils.addEventListener('dblclick', (e) => e.stopPropagation(), { signal });
    this.brancherInteractions(signal);
    // Redessin regroupé à la trame suivante : un redimensionnement continu ne redessine qu'une fois par image.
    this.observateur = new ResizeObserver(() => this.planifierDessin());
    this.observateur.observe(this.zone);
    this.surveillerResolution();
  }

  // Un changement de devicePixelRatio (zoom du navigateur, autre écran) ne déclenche pas toujours le ResizeObserver.
  surveillerResolution() {
    if (typeof matchMedia !== 'function' || this.abandon.signal.aborted) return;
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener?.('change', () => { this.planifierDessin(); this.surveillerResolution(); }, { once: true, signal: this.abandon.signal });
  }

  // Retire les écouteurs et l'observateur (à appeler si le conteneur est retiré de la page).
  detruire() {
    this.abandon.abort();
    this.observateur.disconnect();
    if (this.trame) cancelAnimationFrame(this.trame);
    this.trame = 0;
    this.jeton++;
  }

  // Demande un redessin à la prochaine trame (plusieurs demandes dans la même trame n'en font qu'un).
  planifierDessin() {
    if (this.trame || this.abandon.signal.aborted) return;
    this.trame = requestAnimationFrame(() => { this.trame = 0; this.dessiner(); });
  }

  definirPile(pile, { index } = {}) {
    this.pile = pile;
    this.image = null;
    this.indexImage = -1;
    this.erreur = null;
    this.jeton++; // invalide un chargement en cours sur la série précédente
    this.cacheImage = null;
    this.calque = null;
    this.calqueVisible = false;
    this.boutonCalque.hidden = true;
    this.curseur.max = Math.max(0, pile.nombre - 1);
    // Boutons de fenêtre : fenêtrage réel (UH) ou variantes pré-calculées (images publiées).
    const fenetrable = pile.calibre || pile.variantes?.length > 1;
    this.outils.querySelectorAll('[data-fenetre]').forEach((b) => { b.hidden = !fenetrable || (!pile.calibre && !pile.variantes.includes(b.dataset.fenetre)); });
    this.fenetre = { ...FENETRES.poumon };
    this.marquerFenetre(pile.calibre || pile.variantes ? 'poumon' : null);
    this.vue = { zoom: 1, dx: 0, dy: 0 };
    this.vide.hidden = true;
    this.index = -1;
    this.allerA(index ?? Math.floor(pile.nombre / 2), { silencieux: true });
    this.dessiner(); // efface aussitôt l'image de la série précédente
  }

  definirCalque(calque) {
    this.calque = calque;
    this.boutonCalque.hidden = !calque;
    this.afficherCalque(!!calque);
  }

  afficherCalque(oui) {
    this.calqueVisible = oui && !!this.calque;
    this.boutonCalque.setAttribute('aria-pressed', String(this.calqueVisible));
    this.cacheImage = null;
    this.planifierDessin();
  }

  marquerFenetre(k) {
    this.outils.querySelectorAll('[data-fenetre]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fenetre === k)));
  }

  choisirFenetre(k) {
    if (!this.pile) return;
    this.marquerFenetre(k);
    if (this.pile.calibre) this.definirFenetre(FENETRES[k]);
    else if (this.pile.variantes?.includes(k)) {
      this.pile.choisirVariante(k);
      this.charger();
    }
  }

  allerA(i, { silencieux = false } = {}) {
    if (!this.pile) return;
    i = limiter(Math.round(i), 0, this.pile.nombre - 1);
    if (i === this.index) return;
    const delta = i - this.index;
    this.index = i;
    this.curseur.value = i;
    this.charger(Math.sign(delta));
    if (!silencieux) this.surChangement(this, delta);
  }

  // direction : sens du dernier déplacement (-1, 0, 1), pour précharger en priorité les coupes à venir.
  async charger(direction = 0) {
    const jeton = ++this.jeton;
    const i = this.index;
    const pile = this.pile;
    if (!pile || i < 0) return;
    let c = null;
    let erreur = null;
    try {
      c = await pile.coupe(i);
    } catch (e) {
      erreur = e?.message || String(e);
    }
    // Une demande plus récente (autre coupe, autre variante de fenêtre, autre série) l'emporte.
    if (jeton !== this.jeton) return;
    this.image = c;
    this.indexImage = c ? i : -1;
    this.cacheImage = null;
    this.erreur = erreur;
    this.planifierDessin();
    if (!c) return;
    // Précharge les voisines pour un défilement fluide, d'abord dans le sens du défilement.
    const ecarts = direction ? [1, 2, 3, 4, -1].map((d) => d * direction) : [1, -1, 2, -2, 3];
    for (const d of ecarts) {
      const j = i + d;
      if (j >= 0 && j < pile.nombre) Promise.resolve().then(() => pile.coupe(j)).catch(() => {});
    }
  }

  definirFenetre(f) {
    this.fenetre = { largeur: Math.max(1, f.largeur), centre: f.centre };
    this.cacheImage = null;
    this.planifierDessin();
  }

  reinitialiser() {
    this.vue = { zoom: 1, dx: 0, dy: 0 };
    if (this.pile?.calibre) { this.fenetre = { ...FENETRES.poumon }; this.marquerFenetre('poumon'); }
    this.cacheImage = null;
    this.planifierDessin();
  }

  // Convertit la coupe courante en image affichable (fenêtrage pour les UH, calque éventuel).
  imageAffichable() {
    const c = this.image;
    // Le masque suit la coupe affichée, pas celle en cours de chargement.
    const masque = this.calqueVisible && this.calque?.masques[this.indexImage];
    if (c.type === 'image' && !masque) return c.image;
    if (this.cacheImage) return this.cacheImage;
    // Réaffecter width/height réinitialise le canevas : seulement si la taille change.
    if (this.horsEcran.width !== c.largeur) this.horsEcran.width = c.largeur;
    if (this.horsEcran.height !== c.hauteur) this.horsEcran.height = c.hauteur;
    const hctx = this.horsEcran.getContext('2d', { willReadFrequently: true });
    let img;
    if (c.type === 'uh') {
      // La table ne dépend que de la fenêtre : elle est réutilisée d'une coupe à l'autre.
      const { largeur: L, centre: C } = this.fenetre;
      const cle = `${L}|${C}|${!!c.inverse}`;
      if (this.lut?.cle !== cle) this.lut = { cle, table: lutFenetre(L, C, !!c.inverse) };
      const lut = this.lut.table;
      img = this.imageDonnees?.width === c.largeur && this.imageDonnees.height === c.hauteur
        ? this.imageDonnees
        : (this.imageDonnees = hctx.createImageData(c.largeur, c.hauteur));
      const px = img.data;
      const d = c.donnees;
      for (let i = 0, j = 0; i < d.length; i++, j += 4) {
        px[j] = px[j + 1] = px[j + 2] = lut[d[i] + 32768];
        px[j + 3] = 255;
      }
    } else {
      hctx.clearRect(0, 0, c.largeur, c.hauteur); // le canevas n'est plus réinitialisé à chaque coupe
      hctx.drawImage(c.image, 0, 0);
      img = hctx.getImageData(0, 0, c.largeur, c.hauteur);
    }
    if (masque) {
      // Le masque est à demi-résolution : un pixel du masque couvre 2×2 pixels de l'image.
      const { largeur: mw } = this.calque;
      const palette = this.calque.palette || PALETTE_DEFAUT;
      const px = img.data;
      for (let y = 0; y < c.hauteur; y++)
        for (let x = 0; x < c.largeur; x++) {
          const m = masque[(y >> 1) * mw + (x >> 1)];
          if (!m || !palette[m]) continue;
          const [r, g, b, a] = palette[m];
          const j = (y * c.largeur + x) * 4;
          px[j] = px[j] * (1 - a) + r * a;
          px[j + 1] = px[j + 1] * (1 - a) + g * a;
          px[j + 2] = px[j + 2] * (1 - a) + b * a;
        }
    }
    hctx.putImageData(img, 0, 0);
    return (this.cacheImage = this.horsEcran);
  }

  dessiner() {
    if (this.trame) { cancelAnimationFrame(this.trame); this.trame = 0; }
    // Le canevas occupe la zone sans sa bordure : clientWidth/clientHeight, pas getBoundingClientRect.
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(this.zone.clientWidth * dpr));
    const H = Math.max(1, Math.round(this.zone.clientHeight * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!this.pile) return;

    if (this.image) {
      const c = this.image;
      // Respecte la taille réelle des pixels (mm) quand elle est connue.
      const [sy, sx] = this.pile.espacementPixel || [1, 1];
      const largeurMm = c.largeur * sx;
      const hauteurMm = c.hauteur * sy;
      const echelle = Math.min(W / largeurMm, H / hauteurMm) * this.vue.zoom;
      const w = largeurMm * echelle;
      const h = hauteurMm * echelle;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      this.rectImage = { x: (W - w) / 2 + this.vue.dx * dpr, y: (H - h) / 2 + this.vue.dy * dpr, w, h, dpr };
      ctx.drawImage(this.imageAffichable(), this.rectImage.x, this.rectImage.y, w, h);
    }

    const p = this.pile;
    const lignes = [`${p.unite || 'Coupe'} ${this.index + 1} / ${p.nombre}`];
    const leg = this.index >= 0 ? p.legende(this.index) : '';
    if (leg) lignes.push(leg);
    this.infoHaut.textContent = lignes.join('\n');
    this.infoBas.textContent = this.erreur
      ? `⚠ ${this.erreur}`
      : p.calibre
        ? `F ${Math.round(this.fenetre.largeur)} / ${Math.round(this.fenetre.centre)} UH`
        : p.mention || 'Image non calibrée (pas d’UH)';
  }

  brancherInteractions(signal) {
    const z = this.zone;
    const options = { signal };
    let cumul = 0;
    z.addEventListener('wheel', (e) => {
      if (!this.pile) return;
      e.preventDefault();
      const dy = deltaMolette(e, z.clientHeight);
      if (e.ctrlKey) { // pincement sur pavé tactile ou Ctrl + molette (borné : un cran de souris ≈ ×1,6)
        this.zoomer(Math.exp(-limiter(dy, -50, 50) * 0.01), e.clientX, e.clientY);
        return;
      }
      if (Math.abs(dy) >= 50) { // cran de molette : une coupe
        cumul = 0;
        this.allerA(this.index + Math.sign(dy));
      } else { // pavé tactile : défilement progressif
        if (Math.sign(dy) !== Math.sign(cumul)) cumul = 0; // changement de sens : pas de reliquat
        cumul += dy;
        const pas = Math.trunc(cumul / 25);
        if (pas) { cumul -= pas * 25; this.allerA(this.index + pas); }
      }
    }, { passive: false, signal });

    const pointeurs = new Map();
    let geste = null;
    let tap = null; // dernier tap tactile bref { t, x, y }, pour le double-tap
    let tapPossible = false;
    z.addEventListener('contextmenu', (e) => e.preventDefault(), options);
    z.addEventListener('dblclick', () => this.reinitialiser(), options);
    z.addEventListener('pointerdown', (e) => {
      if (!this.pile) return;
      z.focus({ preventScroll: true });
      try { z.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointeurs.size === 2) {
        tapPossible = false;
        const r = z.getBoundingClientRect();
        geste = {
          type: 'pincer', ...this.mesurePincement(pointeurs), zoom: this.vue.zoom, dx: this.vue.dx, dy: this.vue.dy,
          cx: r.left + z.clientLeft + z.clientWidth / 2, cy: r.top + z.clientTop + z.clientHeight / 2,
        };
      } else if (pointeurs.size === 1) {
        if (e.pointerType === 'touch') {
          // Double-tap : deux taps brefs et proches (deux glissers rapides ne réinitialisent pas la vue).
          if (tap && e.timeStamp - tap.t < 300 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 30) {
            this.reinitialiser();
            tap = null;
          }
          tapPossible = true;
        }
        const type = this.pinceau && e.button === 0 && !e.shiftKey ? 'peindre'
          : e.button === 2 && this.pile.calibre ? 'fenetre'
          : e.button === 1 || e.shiftKey ? 'deplacer'
          : 'defiler';
        geste = { type, x: e.clientX, y: e.clientY, t: e.timeStamp, index: this.index, fenetre: { ...this.fenetre }, dx: this.vue.dx, dy: this.vue.dy };
        if (type === 'peindre') this.peindre(e.clientX, e.clientY);
      }
    }, options);
    z.addEventListener('pointermove', (e) => {
      if (!pointeurs.has(e.pointerId)) return;
      // Position toujours à jour, même sans geste en cours : un pincement repris ensuite part du bon point.
      pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!geste) return;
      if (geste.type === 'pincer') {
        if (pointeurs.size !== 2) return;
        const m = this.mesurePincement(pointeurs);
        const zoom = limiter(geste.zoom * m.distance / geste.distance, 0.5, 10);
        // Le point de l'image sous les doigts au départ suit le milieu des doigts.
        const k = zoom / geste.zoom;
        this.vue.zoom = zoom;
        this.vue.dx = m.x - geste.cx - (geste.x - geste.cx - geste.dx) * k;
        this.vue.dy = m.y - geste.cy - (geste.y - geste.cy - geste.dy) * k;
        this.planifierDessin();
        return;
      }
      const dx = e.clientX - geste.x;
      const dy = e.clientY - geste.y;
      if (tapPossible && Math.hypot(dx, dy) > 10) tapPossible = false;
      if (geste.type === 'peindre') {
        this.peindre(e.clientX, e.clientY);
      } else if (geste.type === 'defiler') {
        // Une hauteur d'image parcourt environ toute la série (2 à 12 px par coupe).
        const pxParCoupe = limiter(z.clientHeight / this.pile.nombre, 2, 12);
        this.allerA(geste.index + dy / pxParCoupe);
      } else if (geste.type === 'fenetre') {
        this.marquerFenetre(null);
        this.definirFenetre({ largeur: geste.fenetre.largeur + dx * 4, centre: geste.fenetre.centre + dy * 2 });
      } else if (geste.type === 'deplacer') {
        this.vue.dx = geste.dx + dx;
        this.vue.dy = geste.dy + dy;
        this.planifierDessin();
      }
    }, options);
    const fin = (e) => {
      if (!pointeurs.delete(e.pointerId)) return; // déjà traité (pointerup puis lostpointercapture)
      if (e.type === 'pointerup' && e.pointerType === 'touch' && tapPossible && geste && e.timeStamp - geste.t < 250) {
        tap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      }
      tapPossible = false;
      // Après un pincement, le doigt restant ne doit pas faire défiler brutalement.
      geste = null;
    };
    z.addEventListener('pointerup', fin, options);
    z.addEventListener('pointercancel', fin, options);
    // Capture perdue sans pointerup (élément masqué, alerte…) : sans cela le pointeur resterait « enfoncé ».
    z.addEventListener('lostpointercapture', fin, options);

    z.addEventListener('keydown', (e) => {
      if (!this.pile) return;
      const a = actionClavier(e);
      if (!a) return;
      if (a.type === 'pas') this.allerA(this.index + a.valeur);
      else if (a.type === 'debut') this.allerA(0);
      else if (a.type === 'fin') this.allerA(this.pile.nombre - 1);
      else if (a.type === 'zoom') {
        const r = z.getBoundingClientRect();
        this.zoomer(a.facteur, r.left + z.clientLeft + z.clientWidth / 2, r.top + z.clientTop + z.clientHeight / 2);
      } else if (a.type === 'reinit') this.reinitialiser();
      e.preventDefault();
    }, options);
  }

  definirPinceau(pinceau) {
    this.pinceau = pinceau;
    this.zone.style.cursor = pinceau ? 'crosshair' : '';
  }

  // Peint un disque du calque (coupe affichée) sous le pointeur.
  peindre(clientX, clientY) {
    const masque = this.calque?.masques[this.indexImage];
    if (!this.pinceau || !masque || !this.image || !this.rectImage) return;
    const z = this.zone.getBoundingClientRect();
    const { x, y, w, h, dpr } = this.rectImage;
    const ix = (((clientX - z.left - this.zone.clientLeft) * dpr - x) / w) * this.image.largeur;
    const iy = (((clientY - z.top - this.zone.clientTop) * dpr - y) / h) * this.image.hauteur;
    const { largeur: mw, hauteur: mh } = this.calque;
    const pixelMm = this.pile.pixelMm || this.pile.espacementPixel?.[1] || 1;
    const r = Math.max(0.5, this.pinceau.rayonMm / (2 * pixelMm));
    const cx = ix / 2, cy = iy / 2;
    for (let my = Math.floor(cy - r); my <= Math.ceil(cy + r); my++)
      for (let mx = Math.floor(cx - r); mx <= Math.ceil(cx + r); mx++)
        if (mx >= 0 && my >= 0 && mx < mw && my < mh && (mx - cx) ** 2 + (my - cy) ** 2 <= r * r) masque[my * mw + mx] = this.pinceau.valeur;
    this.cacheImage = null;
    this.planifierDessin();
    this.surPeinture(this.indexImage);
  }

  mesurePincement(pointeurs) {
    const [a, b] = [...pointeurs.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  zoomer(facteur, cx, cy) {
    const z = this.zone;
    const r = z.getBoundingClientRect();
    const ancien = this.vue.zoom;
    const nouveau = limiter(ancien * facteur, 0.5, 10);
    // Garde le point sous le curseur immobile (repère : centre du canevas, bordure exclue).
    const px = cx - r.left - z.clientLeft - z.clientWidth / 2;
    const py = cy - r.top - z.clientTop - z.clientHeight / 2;
    this.vue.dx = px - (px - this.vue.dx) * (nouveau / ancien);
    this.vue.dy = py - (py - this.vue.dy) * (nouveau / ancien);
    this.vue.zoom = nouveau;
    this.planifierDessin();
  }
}
