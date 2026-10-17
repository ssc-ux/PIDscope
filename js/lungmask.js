// Segmentation pulmonaire par le réseau lungmask R231 (Hofmanninger et al., Eur Radiol Exp 2020 ; licence Apache 2.0),
// converti en ONNX (demi-précision) et exécuté dans le navigateur. Le prétraitement reproduit celui du paquet Python
// lungmask (utils.preprocess / simple_bodymask / crop_and_resize, interpolations de scipy.ndimage.zoom).

export const MODELE_URL = 'modeles/lungmask_r231_fp16.onnx';
const TAILLE = 256;

// scipy.ndimage.zoom (grid_mode = False) : la sortie o correspond à l'entrée o × (n_entrée − 1) / (n_sortie − 1).
function zoomPlusProche(src, sh, sw, dh, dw) {
  const out = new Uint8Array(dh * dw);
  const fy = dh > 1 ? (sh - 1) / (dh - 1) : 0, fx = dw > 1 ? (sw - 1) / (dw - 1) : 0;
  for (let y = 0; y < dh; y++) {
    const yy = Math.min(sh - 1, Math.round(y * fy));
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[yy * sw + Math.min(sw - 1, Math.round(x * fx))];
  }
  return out;
}

function zoomBilineaire(src, sh, sw, dh, dw) {
  const out = new Float32Array(dh * dw);
  const fy = dh > 1 ? (sh - 1) / (dh - 1) : 0, fx = dw > 1 ? (sw - 1) / (dw - 1) : 0;
  for (let y = 0; y < dh; y++) {
    const sy = y * fy, y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), ty = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = x * fx, x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), tx = sx - x0;
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

// Morphologie binaire (élément en croix 3×3, comme scipy.ndimage par défaut ; hors image = 0).
function morpho(m, h, w, dilater) {
  const s = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = [m[i], x > 0 ? m[i - 1] : 0, x < w - 1 ? m[i + 1] : 0, y > 0 ? m[i - w] : 0, y < h - 1 ? m[i + w] : 0];
      s[i] = dilater ? (v.some((k) => k) ? 1 : 0) : (v.every((k) => k) ? 1 : 0);
    }
  return s;
}

// Composantes connexes ; retourne les étiquettes (Int32Array) et les tailles.
function etiqueter(m, h, w, huit) {
  const lab = new Int32Array(m.length);
  const tailles = [0];
  const pile = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || lab[i]) continue;
    const e = tailles.length;
    let n = 0;
    lab[i] = e;
    pile.push(i);
    while (pile.length) {
      const j = pile.pop();
      n++;
      const x = j % w, y = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!huit && dx && dy)) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (m[k] && !lab[k]) { lab[k] = e; pile.push(k); }
        }
    }
    tailles.push(n);
  }
  return { lab, tailles };
}

// Comble les trous : fond non relié au bord (connexité 8 pour le fond, comme structure = ones((3,3))).
function comblerTrous(m, h, w) {
  const fond = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) fond[i] = m[i] ? 0 : 1;
  const { lab } = etiqueter(fond, h, w, true);
  const exterieur = new Set();
  for (let x = 0; x < w; x++) { exterieur.add(lab[x]); exterieur.add(lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { exterieur.add(lab[y * w]); exterieur.add(lab[y * w + w - 1]); }
  const s = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) s[i] = m[i] || !exterieur.has(lab[i]) ? 1 : 0;
  return s;
}

// lungmask simple_bodymask + boîte englobante (lignes y0..y1, colonnes x0..x1 exclues).
function boiteCorps(hu, h, w) {
  let m = zoomPlusProche(Uint8Array.from(hu, (v) => (v > -500 ? 1 : 0)), h, w, 128, 128);
  m = morpho(morpho(m, 128, 128, true), 128, 128, false); // fermeture
  m = comblerTrous(m, 128, 128);
  m = morpho(morpho(m, 128, 128, false), 128, 128, false); // érosion × 2
  const { lab, tailles } = etiqueter(m, 128, 128, false);
  if (tailles.length > 1) {
    const max = tailles.indexOf(Math.max(...tailles.slice(1)));
    for (let i = 0; i < m.length; i++) m[i] = lab[i] === max ? 1 : 0;
    m = morpho(morpho(m, 128, 128, true), 128, 128, true); // dilatation × 2
  }
  const corps = zoomPlusProche(m, 128, 128, h, w);
  let y0 = h, y1 = 0, x0 = w, x1 = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (corps[y * w + x]) { y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); }
  return y1 > y0 ? { y0, y1, x0, x1 } : { y0: 0, y1: h, x0: 0, x1: w };
}

// Entrée du réseau : UH bornées à [-1024 ; 600], recadrées sur le corps, 256 × 256, normalisées sur [0 ; 1].
export function pretraiter(hu, largeur, hauteur) {
  const borne = Float32Array.from(hu, (v) => (v < -1024 ? -1024 : v > 600 ? 600 : v));
  const boite = boiteCorps(borne, hauteur, largeur);
  const bh = boite.y1 - boite.y0, bw = boite.x1 - boite.x0;
  const crop = new Float32Array(bh * bw);
  for (let y = 0; y < bh; y++) crop.set(borne.subarray((boite.y0 + y) * largeur + boite.x0, (boite.y0 + y) * largeur + boite.x1), y * bw);
  const entree = zoomBilineaire(crop, bh, bw, TAILLE, TAILLE);
  for (let i = 0; i < entree.length; i++) entree[i] = (Math.min(600, entree[i]) + 1024) / 1624;
  return { entree, boite };
}

// Argmax des 3 classes (fond, poumon droit, poumon gauche), replacé dans l'image d'origine (plus proche voisin).
export function remettreEnPlace(logits, boite, largeur, hauteur) {
  const n = TAILLE * TAILLE;
  const etiquettes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0, v = logits[i];
    if (logits[n + i] > v) { c = 1; v = logits[n + i]; }
    if (logits[2 * n + i] > v) c = 2;
    etiquettes[i] = c;
  }
  const bh = boite.y1 - boite.y0, bw = boite.x1 - boite.x0;
  const z = zoomPlusProche(etiquettes, TAILLE, TAILLE, bh, bw);
  const masque = new Uint8Array(largeur * hauteur);
  for (let y = 0; y < bh; y++) masque.set(z.subarray(y * bw, (y + 1) * bw), (boite.y0 + y) * largeur + boite.x0);
  return masque;
}

// Masque pulmonaire binaire à demi-résolution (≥ 2 pixels sur 4 de poumon), format des autres modules.
export function demiResolution(masque, largeur, hauteur) {
  const w2 = largeur >> 1, h2 = hauteur >> 1;
  const m = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * largeur + 2 * x;
      m[y * w2 + x] = (masque[i] > 0) + (masque[i + 1] > 0) + (masque[i + largeur] > 0) + (masque[i + largeur + 1] > 0) >= 2 ? 1 : 0;
    }
  return m;
}

// Segmente toutes les coupes d'une pile. `executer(entree Float32Array) → logits Float32Array` est fourni par
// l'appelant (onnxruntime-web dans le navigateur, onnxruntime-node dans les tests).
export async function segmenterPile(pile, executer, progression = () => {}) {
  const masques = [];
  for (let k = 0; k < pile.nombre; k++) {
    const c = await pile.coupe(k);
    const { entree, boite } = pretraiter(c.donnees, c.largeur, c.hauteur);
    const logits = await executer(entree);
    masques.push(demiResolution(remettreEnPlace(logits, boite, c.largeur, c.hauteur), c.largeur, c.hauteur));
    progression((k + 1) / pile.nombre);
  }
  return masques;
}

// ── Chargement dans le navigateur ──────────────────────────────────────────
// onnxruntime-web (MIT) depuis le CDN jsDelivr ; WebGPU (carte graphique) si disponible, sinon WebAssembly (processeur).
const ORT_VERSION = '1.22.0';
const ORT_DIST = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export const MODELES = { webgpu: 'modeles/lungmask_r231_fp16.onnx', wasm: 'modeles/lungmask_r231_int8.onnx' };

async function telecharger(url, progression) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Modèle introuvable (${r.status})`);
  const total = +r.headers.get('content-length') || 0;
  const lecteur = r.body.getReader();
  const morceaux = [];
  let recu = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
    recu += value.length;
    if (total) progression(recu / total);
  }
  const octets = new Uint8Array(recu);
  let o = 0;
  for (const m of morceaux) { octets.set(m, o); o += m.length; }
  return octets;
}

let chargement = null;
// Retourne { fournisseur: 'webgpu' | 'wasm', executer(entree) → logits }.
export function chargerModele(progression = () => {}) {
  if (!chargement) {
    chargement = (async () => {
      const ort = await import(`${ORT_DIST}ort.webgpu.min.mjs`);
      ort.env.wasm.wasmPaths = ORT_DIST;
      const adaptateur = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
      const fournisseur = adaptateur ? 'webgpu' : 'wasm';
      const octets = await telecharger(MODELES[fournisseur], progression);
      const session = await ort.InferenceSession.create(octets, { executionProviders: [fournisseur] });
      const executer = async (entree) => (await session.run({ image: new ort.Tensor('float32', entree, [1, 1, TAILLE, TAILLE]) })).logits.data;
      return { fournisseur, executer };
    })();
    chargement.catch(() => { chargement = null; });
  }
  return chargement;
}
