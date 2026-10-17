// Visualiseur de coupes : défilement (molette, glisser, clavier, curseur), zoom, déplacement, fenêtrage,
// calque optionnel (masque pulmonaire et zones de haute atténuation).

export const FENETRES = {
  poumon: { nom: 'Poumon', largeur: 1500, centre: -600 },
  mediastin: { nom: 'Médiastin', largeur: 350, centre: 40 },
};

const limiter = (v, min, max) => Math.min(max, Math.max(min, v));
const COULEUR_POUMON = [94, 214, 160];
const COULEUR_HAA = [255, 138, 61];

export class Visualiseur {
  constructor(conteneur, { surChangement = () => {} } = {}) {
    this.surChangement = surChangement;
    this.pile = null;
    this.index = 0;
    this.fenetre = { ...FENETRES.poumon };
    this.vue = { zoom: 1, dx: 0, dy: 0 };
    this.calque = null; // { largeur, hauteur, masques: Uint8Array[] }
    this.calqueVisible = false;

    conteneur.classList.add('visualiseur');
    conteneur.innerHTML = `
      <div class="vis-zone" tabindex="0" aria-label="Image de scanner : molette ou glisser pour faire défiler les coupes">
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

    this.curseur.addEventListener('input', () => this.allerA(+this.curseur.value));
    conteneur.querySelector('.vis-prec').addEventListener('click', () => this.allerA(this.index - 1));
    conteneur.querySelector('.vis-suiv').addEventListener('click', () => this.allerA(this.index + 1));
    conteneur.querySelector('.vis-reinit').addEventListener('click', () => this.reinitialiser());
    this.boutonCalque.addEventListener('click', () => this.afficherCalque(!this.calqueVisible));
    this.outils.addEventListener('click', (e) => {
      const k = e.target.dataset?.fenetre;
      if (k) this.choisirFenetre(k);
    });
    // Les boutons ne doivent pas déclencher le défilement de l'image.
    this.outils.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.outils.addEventListener('dblclick', (e) => e.stopPropagation());
    this.brancherInteractions();
    new ResizeObserver(() => this.dessiner()).observe(this.zone);
  }

  definirPile(pile, { index } = {}) {
    this.pile = pile;
    this.image = null;
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
    this.dessiner();
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
    this.charger();
    if (!silencieux) this.surChangement(this, delta);
  }

  async charger() {
    const i = this.index;
    const pile = this.pile;
    try {
      const c = await pile.coupe(i);
      if (i !== this.index || pile !== this.pile) return; // l'utilisateur a déjà défilé plus loin
      this.image = c;
      this.cacheImage = null;
      this.erreur = null;
    } catch (e) {
      if (i !== this.index) return;
      this.image = null;
      this.erreur = e.message;
    }
    this.dessiner();
    // Précharge les voisines pour un défilement fluide.
    for (const d of [1, -1, 2, -2, 3]) {
      const j = i + d;
      if (j >= 0 && j < pile.nombre) pile.coupe(j).catch(() => {});
    }
  }

  definirFenetre(f) {
    this.fenetre = { largeur: Math.max(1, f.largeur), centre: f.centre };
    this.cacheImage = null;
    this.dessiner();
  }

  reinitialiser() {
    this.vue = { zoom: 1, dx: 0, dy: 0 };
    if (this.pile?.calibre) { this.fenetre = { ...FENETRES.poumon }; this.marquerFenetre('poumon'); }
    this.cacheImage = null;
    this.dessiner();
  }

  // Convertit la coupe courante en image affichable (fenêtrage pour les UH, calque éventuel).
  imageAffichable() {
    const c = this.image;
    const masque = this.calqueVisible && this.calque?.masques[this.index];
    if (c.type === 'image' && !masque) return c.image;
    if (this.cacheImage) return this.cacheImage;
    this.horsEcran.width = c.largeur;
    this.horsEcran.height = c.hauteur;
    const hctx = this.horsEcran.getContext('2d', { willReadFrequently: true });
    let img;
    if (c.type === 'uh') {
      const { largeur: L, centre: C } = this.fenetre;
      const bas = C - L / 2;
      const lut = new Uint8ClampedArray(65536);
      for (let v = -32768; v < 32768; v++) {
        const g = ((v - bas) / L) * 255;
        lut[v + 32768] = c.inverse ? 255 - g : g;
      }
      img = hctx.createImageData(c.largeur, c.hauteur);
      const px = img.data;
      const d = c.donnees;
      for (let i = 0, j = 0; i < d.length; i++, j += 4) {
        px[j] = px[j + 1] = px[j + 2] = lut[d[i] + 32768];
        px[j + 3] = 255;
      }
    } else {
      hctx.drawImage(c.image, 0, 0);
      img = hctx.getImageData(0, 0, c.largeur, c.hauteur);
    }
    if (masque) {
      // Le masque est à demi-résolution : un pixel du masque couvre 2×2 pixels de l'image.
      const { largeur: mw } = this.calque;
      const px = img.data;
      for (let y = 0; y < c.hauteur; y++)
        for (let x = 0; x < c.largeur; x++) {
          const m = masque[(y >> 1) * mw + (x >> 1)];
          if (!m) continue;
          const [r, g, b] = m === 2 ? COULEUR_HAA : COULEUR_POUMON;
          const a = m === 2 ? 0.55 : 0.18;
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
    const r = this.zone.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
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
      ctx.drawImage(this.imageAffichable(), (W - w) / 2 + this.vue.dx * dpr, (H - h) / 2 + this.vue.dy * dpr, w, h);
    }

    const p = this.pile;
    const lignes = [`Coupe ${this.index + 1} / ${p.nombre}`];
    const leg = p.legende(this.index);
    if (leg) lignes.push(leg);
    this.infoHaut.textContent = lignes.join('\n');
    this.infoBas.textContent = this.erreur
      ? `⚠ ${this.erreur}`
      : p.calibre
        ? `F ${Math.round(this.fenetre.largeur)} / ${Math.round(this.fenetre.centre)} UH`
        : p.mention || 'Image non calibrée (pas d’UH)';
  }

  brancherInteractions() {
    const z = this.zone;
    let cumul = 0;
    z.addEventListener('wheel', (e) => {
      if (!this.pile) return;
      e.preventDefault();
      if (e.ctrlKey) { // pincement sur pavé tactile ou Ctrl + molette
        this.zoomer(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
        return;
      }
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (Math.abs(dy) >= 50) { // cran de molette : une coupe
        cumul = 0;
        this.allerA(this.index + Math.sign(dy));
      } else { // pavé tactile : défilement progressif
        cumul += dy;
        const pas = Math.trunc(cumul / 25);
        if (pas) { cumul -= pas * 25; this.allerA(this.index + pas); }
      }
    }, { passive: false });

    const pointeurs = new Map();
    let geste = null;
    z.addEventListener('contextmenu', (e) => e.preventDefault());
    z.addEventListener('dblclick', () => this.reinitialiser());
    z.addEventListener('pointerdown', (e) => {
      if (!this.pile) return;
      z.focus({ preventScroll: true });
      z.setPointerCapture(e.pointerId);
      pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointeurs.size === 2) geste = { type: 'pincer', ...this.mesurePincement(pointeurs), zoom: this.vue.zoom, dx: this.vue.dx, dy: this.vue.dy };
      else if (pointeurs.size === 1) {
        if (e.pointerType === 'touch') { // double-tap : réinitialiser
          if (e.timeStamp - (this.dernierTap || 0) < 300) this.reinitialiser();
          this.dernierTap = e.timeStamp;
        }
        const type = e.button === 2 && this.pile.calibre ? 'fenetre'
          : e.button === 1 || e.shiftKey ? 'deplacer'
          : 'defiler';
        geste = { type, x: e.clientX, y: e.clientY, index: this.index, fenetre: { ...this.fenetre }, dx: this.vue.dx, dy: this.vue.dy };
      }
    });
    z.addEventListener('pointermove', (e) => {
      if (!pointeurs.has(e.pointerId) || !geste) return;
      pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (geste.type === 'pincer' && pointeurs.size === 2) {
        const m = this.mesurePincement(pointeurs);
        this.vue.zoom = limiter(geste.zoom * m.distance / geste.distance, 0.5, 10);
        this.vue.dx = geste.dx + m.x - geste.x;
        this.vue.dy = geste.dy + m.y - geste.y;
        this.dessiner();
        return;
      }
      const dx = e.clientX - geste.x;
      const dy = e.clientY - geste.y;
      if (geste.type === 'defiler') {
        // Une hauteur d'image parcourt environ toute la série (2 à 12 px par coupe).
        const pxParCoupe = limiter(z.clientHeight / this.pile.nombre, 2, 12);
        this.allerA(geste.index + dy / pxParCoupe);
      } else if (geste.type === 'fenetre') {
        this.marquerFenetre(null);
        this.definirFenetre({ largeur: geste.fenetre.largeur + dx * 4, centre: geste.fenetre.centre + dy * 2 });
      } else if (geste.type === 'deplacer') {
        this.vue.dx = geste.dx + dx;
        this.vue.dy = geste.dy + dy;
        this.dessiner();
      }
    });
    const fin = (e) => {
      pointeurs.delete(e.pointerId);
      // Après un pincement, le doigt restant ne doit pas faire défiler brutalement.
      geste = null;
    };
    z.addEventListener('pointerup', fin);
    z.addEventListener('pointercancel', fin);

    z.addEventListener('keydown', (e) => {
      if (!this.pile) return;
      const pas = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, PageUp: -10, PageDown: 10 }[e.key];
      if (pas) this.allerA(this.index + pas);
      else if (e.key === 'Home') this.allerA(0);
      else if (e.key === 'End') this.allerA(this.pile.nombre - 1);
      else return;
      e.preventDefault();
    });
  }

  mesurePincement(pointeurs) {
    const [a, b] = [...pointeurs.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  zoomer(facteur, cx, cy) {
    const r = this.zone.getBoundingClientRect();
    const ancien = this.vue.zoom;
    const nouveau = limiter(ancien * facteur, 0.5, 10);
    // Garde le point sous le curseur immobile.
    const px = cx - r.left - r.width / 2;
    const py = cy - r.top - r.height / 2;
    this.vue.dx = px - (px - this.vue.dx) * (nouveau / ancien);
    this.vue.dy = py - (py - this.vue.dy) * (nouveau / ancien);
    this.vue.zoom = nouveau;
    this.dessiner();
  }
}
