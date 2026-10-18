"""Convertit une série de scanner (dossier DICOM, fichier NRRD ou NIfTI) en pile d'images pour un cas PIDscope.

    python3 outils/creer_cas.py <source> data/cas/<id> [--pas 2] [--debut 0.1 --fin 0.95] [--vignette 0.6]

- Coupes axiales ordonnées de l'apex vers les bases, convention radiologique
  (droite du patient à gauche de l'image, face antérieure en haut).
- Deux fenêtres exportées en WebP : poumon (L -600 / W 1500) et médiastin (L 40 / W 350).
- Affiche les champs « serie » à reporter dans cas.json.
Dépendances : pip install numpy pillow pydicom pynrrd nibabel
"""
import argparse, json, os, sys
from pathlib import Path
import numpy as np
from PIL import Image

FENETRES = {'poumon': (-600, 1500), 'mediastin': (40, 350)}


def lire_nrrd(chemin):
    import nrrd
    vol, h = nrrd.read(str(chemin))
    if h.get('space') not in ('left-posterior-superior', 'LPS'):
        sys.exit(f"Espace NRRD non pris en charge : {h.get('space')}")
    dirs = np.array(h['space directions'], dtype=float)
    if np.count_nonzero(np.abs(dirs) > 1e-6) != 3:
        sys.exit('Volume oblique : non pris en charge.')
    # Ramène les axes à (x : vers la gauche du patient, y : vers l'arrière, z : vers le haut).
    axes = [int(np.argmax(np.abs(dirs[i]))) for i in range(3)]
    vol = np.transpose(vol, np.argsort(axes))
    dirs = dirs[np.argsort(axes)]
    for i in range(3):
        if dirs[i][i] < 0:
            vol = np.flip(vol, axis=i)
    pixel = abs(dirs[0][0]), abs(dirs[1][1])
    pas = abs(dirs[2][2])
    # Coupes [z][ligne = y][colonne = x], de l'apex (z max) vers les bases.
    coupes = np.transpose(vol, (2, 1, 0))[::-1]
    return (coupes.astype(np.int16) if UH else coupes), pixel, pas


UH = True  # False pour lire une carte d'étiquettes


def lire_nifti(chemin):
    import nibabel as nib
    img = nib.as_closest_canonical(nib.load(str(chemin)))  # axes RAS+ : x vers la droite, y vers l'avant, z vers le haut
    vol = np.asarray(img.dataobj, dtype=np.float32)  # pente et ordonnée NIfTI appliquées
    if vol.ndim != 3:
        sys.exit(f'Volume NIfTI de dimension {vol.ndim} : non pris en charge.')
    if UH and vol.min() > -1:  # valeurs brutes sans recalibrage (air ≈ 0, aux arrondis près) : conversion en UH
        print('Valeurs brutes détectées : UH = valeur - 1024', file=sys.stderr)
        vol -= 1024
    zx, zy, zz = (float(v) for v in img.header.get_zooms()[:3])
    # Affichage radiologique : colonnes de la droite vers la gauche du patient, lignes de l'avant vers l'arrière,
    # coupes de l'apex vers les bases.
    coupes = np.transpose(vol[::-1, ::-1, ::-1], (2, 1, 0))
    if not UH:
        return coupes.astype(np.uint8), (zx, zy), zz
    return np.clip(np.round(coupes), -32768, 32767).astype(np.int16), (zx, zy), zz


def lire_dicom(dossier):
    import pydicom
    ds = []
    for f in sorted(Path(dossier).rglob('*')):
        if f.is_file():
            try:
                d = pydicom.dcmread(f)
                if 'PixelData' in d and d.get('ImagePositionPatient'):
                    ds.append(d)
            except Exception:
                pass
    if not ds:
        sys.exit('Aucune image DICOM trouvée.')
    iop = np.array(ds[0].ImageOrientationPatient, dtype=float)
    if not np.allclose(np.abs(iop), [1, 0, 0, 0, 1, 0], atol=1e-3):
        sys.exit(f'Orientation non axiale standard : {iop}')
    normale = np.cross(iop[:3], iop[3:])
    ds.sort(key=lambda d: -float(np.dot(np.array(d.ImagePositionPatient, dtype=float), normale)))
    coupes = []
    for d in ds:
        a = d.pixel_array.astype(np.float64) * float(d.get('RescaleSlope', 1)) + float(d.get('RescaleIntercept', 0))
        if iop[0] < 0:
            a = a[:, ::-1]
        if iop[4] < 0:
            a = a[::-1, :]
        coupes.append(np.clip(np.round(a), -32768, 32767).astype(np.int16))
    z = [float(np.dot(np.array(d.ImagePositionPatient, dtype=float), normale)) for d in ds]
    pas = float(np.median(-np.diff(z))) if len(z) > 1 else float(ds[0].get('SliceThickness', 1))
    pixel = tuple(float(v) for v in ds[0].PixelSpacing)[::-1]  # (colonne, ligne)
    return np.stack(coupes), pixel, pas


def fenetrer(a, centre, largeur):
    return (np.clip((a.astype(np.float32) - (centre - largeur / 2)) / largeur, 0, 1) * 255).round().astype(np.uint8)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('source')
    p.add_argument('sortie')
    p.add_argument('--pas', type=int, default=1, help='garder une coupe sur N')
    p.add_argument('--debut', type=float, default=0.0, help='fraction de la série où commencer (0 = première coupe)')
    p.add_argument('--fin', type=float, default=1.0)
    p.add_argument('--vignette', type=float, default=0.55, help='position de la coupe vignette (fraction)')
    p.add_argument('--qualite', type=int, default=85)
    p.add_argument('--lisser-mediastin', action='store_true', help='lissage gaussien (1 pixel) de la fenêtre médiastinale : moins de bruit, fichiers 4 fois plus légers')
    p.add_argument('--etiquettes', help="carte d'étiquettes d'experts (NRRD/NIfTI) alignée sur le volume, exportée à demi-résolution")
    a = p.parse_args()

    src = Path(a.source)
    lecteur = {'.nrrd': lire_nrrd, '.nii': lire_nifti, '.gz': lire_nifti}.get(src.suffix, lire_dicom)
    coupes, (px, py), pas = lecteur(src)
    n = len(coupes)
    coupes = coupes[int(n * a.debut):int(np.ceil(n * a.fin)):a.pas]
    pas *= a.pas
    sortie = Path(a.sortie)
    h, w = coupes[0].shape
    # Pixels carrés à l'export (le visualiseur affiche l'image telle quelle).
    taille = (min(512, round(w * px / min(px, py))), min(512, round(h * py / min(px, py))))
    for nom, (c, l) in FENETRES.items():
        (sortie / nom).mkdir(parents=True, exist_ok=True)
        for i, s in enumerate(coupes):
            im = Image.fromarray(fenetrer(s, c, l))
            if im.size != taille:
                im = im.resize(taille, Image.LANCZOS)
            if nom == 'mediastin' and a.lisser_mediastin:
                from PIL import ImageFilter
                im.filter(ImageFilter.GaussianBlur(1.0)).save(sortie / nom / f'{i + 1:04d}.webp', quality=60, method=6)
                continue
            im.save(sortie / nom / f'{i + 1:04d}.webp', quality=a.qualite, method=6)
    if a.etiquettes:
        global UH
        UH = False
        e = Path(a.etiquettes)
        lab, _, _ = {'.nrrd': lire_nrrd, '.nii': lire_nifti, '.gz': lire_nifti}[e.suffix](e)
        lab = lab[int(n * a.debut):int(np.ceil(n * a.fin)):a.pas]
        if lab.shape != coupes.shape:
            sys.exit(f'Étiquettes {lab.shape} et volume {coupes.shape} de tailles différentes.')
        (sortie / 'experts').mkdir(exist_ok=True)
        demi = (taille[0] // 2, taille[1] // 2)
        for i, s_ in enumerate(lab):
            Image.fromarray(s_.astype(np.uint8)).resize(demi, Image.NEAREST).save(sortie / 'experts' / f'{i + 1:04d}.png', optimize=True)
    v = Image.fromarray(fenetrer(coupes[int(len(coupes) * a.vignette)], *FENETRES['poumon']))
    v.resize((480, round(480 * taille[1] / taille[0])), Image.LANCZOS).save(sortie / 'vignette.webp', quality=80)
    poids = sum(f.stat().st_size for f in sortie.rglob('*.webp')) / 1e6
    print(json.dumps({'serie': {
        'nombre': len(coupes), 'chiffres': 4, 'espacement_mm': round(pas, 3),
        'pixel_mm': round(min(px, py), 3),
        'fenetres': {'poumon': 'poumon/{n}.webp', 'mediastin': 'mediastin/{n}.webp'},
    }}, ensure_ascii=False, indent=2))
    print(f'{len(coupes)} coupes, {poids:.1f} Mo', file=sys.stderr)


if __name__ == '__main__':
    main()
