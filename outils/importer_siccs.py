"""Import du jeu de données SICCS (PID de sclérodermie, Harvard Dataverse, doi:10.7910/DVN/3HNP33, licence CC0 1.0).

    python3 outils/importer_siccs.py <dossier_siccs>   (fichiers N.nii et N.nrrd téléchargés depuis Dataverse)

Pour chaque patient : conversion du scanner (outils/creer_cas.py, coupes de ~2 mm au moins), export de la segmentation
des experts (1 poumon normal, 2 fibrose établie, 3 fibrose fine / verre dépoli) et calcul de leur étendue.
Référence : Vahdani AM et al. Reumatismo 2026;78:1920, doi:10.4081/reumatismo.2026.1920.
"""
import json, math, subprocess, sys
from pathlib import Path
import nibabel as nib, nrrd, numpy as np

source = Path(sys.argv[1])
choix = {int(x) for x in sys.argv[2].split(',')} if len(sys.argv) > 2 else None  # (ré)importer seulement ces patients
racine = Path(__file__).resolve().parent.parent
cas_dir = racine / 'data' / 'cas'
index = json.loads((cas_dir / 'index.json').read_text())
index = [c for c in index if not (c['id'].startswith('siccs-') and (choix is None or int(c['id'][6:]) in choix))]
nouveaux = []
for n in sorted(int(p.stem) for p in source.glob('*.nii')):
    if choix is not None and n not in choix:
        continue
    img = nib.load(str(source / f'{n}.nii'))
    nz = img.shape[2]
    zz = float(img.header.get_zooms()[2])
    lab, h = nrrd.read(str(source / f'{n}.nrrd'))
    # Noms des segments (variables d'un fichier à l'autre) : 2 = fibrose établie, 3 = fibrose fine / verre dépoli.
    noms = {h[k.replace('_Name', '_LabelValue')]: h[k].lower() for k in h if k.startswith('Segment') and k.endswith('_Name')}
    if noms and not ('fibrosis' in noms.get('2', '') and ('fine' in noms.get('3', '') or 'ggo' in noms.get('3', ''))):
        print(n, 'étiquettes inattendues', noms); continue
    poumon = int((lab > 0).sum())
    fib = 100 * int((lab == 2).sum()) / poumon
    vd = 100 * int((lab == 3).sum()) / poumon
    sequentiel = nz * zz < 150  # couverture < 15 cm : HRCT séquentielle à coupes espacées
    pas = 1 if sequentiel or zz >= 2 else max(1, round(2 / zz))
    ident = f'siccs-{n:02d}'
    sortie = cas_dir / ident
    if sortie.exists():
        import shutil; shutil.rmtree(sortie)
    res = subprocess.run([sys.executable, str(racine / 'outils' / 'creer_cas.py'), str(source / f'{n}.nii'), str(sortie),
                          '--pas', str(pas), '--qualite', '80', '--lisser-mediastin', '--etiquettes', str(source / f'{n}.nrrd')], capture_output=True, text=True)
    if res.returncode:
        print(n, 'échec', res.stderr[-300:]); continue
    serie = json.loads(res.stdout)['serie']
    serie['espacement_mm'] = None if sequentiel else serie['espacement_mm']
    total = fib + vd
    acquisition = (f"HRCT séquentielle : {nz} coupes fines espacées" if sequentiel
                   else f"Acquisition volumique : coupes de {zz:g} mm, affichées toutes les {zz * pas:g} mm ({serie['nombre']} coupes)")
    cas = {
        'id': ident,
        'titre': f'Sclérodermie : PID, patient {n} (série complète)',
        'description': f'Série complète · lésions sur {total:.0f} % du poumon selon les experts',
        'categorie': 'Connectivités', 'maladies': ['Sclérodermie systémique'],
        'patterns': [p for p, v in (('Fibrose établie', fib), ('Fibrose fine / verre dépoli', vd)) if v >= 1] or ['Atteinte minime'],
        'statut': 'brouillon', 'relecture': {'par': '', 'date': ''}, 'etiquette': 'TDM · SÉRIE',
        'source': {
            'nom': 'SICCS : SSc-ILD chest CT segmentation (Harvard Dataverse)', 'url': 'https://doi.org/10.7910/DVN/3HNP33',
            'auteur': 'Vahdani AM et al., Reumatismo 2026;78:1920 (doi:10.4081/reumatismo.2026.1920)', 'licence': 'CC0 1.0',
            'modifications': 'Volume NIfTI converti en images WebP (fenêtres poumon et médiastin)' + (f', une coupe sur {pas}' if pas > 1 else '') + ' ; fenêtre médiastinale lissée (filtre gaussien de 1 pixel) pour réduire le bruit ; segmentation des experts exportée à demi-résolution.',
        },
        'serie': serie,
        'experts': {
            'modele': 'experts/{n}.png',
            'etendue': {'fibrose': round(fib, 1), 'verre_depoli': round(vd, 1)},
            'source': 'Segmentation de la cohorte SICCS par deux experts (fibrose établie, fibrose fine / verre dépoli).',
        },
        'texte': (
            "## Le cas\n"
            "PID d'un patient atteint de sclérodermie systémique (critères ACR/EULAR 2013), cohorte SICCS (Téhéran, scanners de pratique courante, appareils variés).\n"
            f"{acquisition}.\n\n"
            "## Exercice\n"
            "- Faites défiler toute la série : décrivez les lésions élémentaires (verre dépoli, réticulations, bronchectasies de traction, rayon de miel) et leur distribution.\n"
            "- Cherchez les signes associés : œsophage dilaté (fenêtre médiastin), respect sous-pleural.\n"
            "- Cotez l'étendue (onglet **Étendue**, score de Goh), puis comparez avec la **lecture des experts** (bouton ci-dessus).\n\n"
            "## Lecture des experts\n"
            f"Fibrose établie : **{fib:.1f} %** du poumon ; fibrose fine / verre dépoli : **{vd:.1f} %** ; total : **{total:.1f} %**. "
            "Ces pourcentages sont volumiques : ils ne remplacent pas le score de Goh, estimé visuellement sur 5 niveaux."
        ),
    }
    (sortie / 'cas.json').write_text(json.dumps(cas, ensure_ascii=False, indent=2))
    nouveaux.append({k: cas[k] for k in ('id', 'titre', 'description', 'categorie', 'maladies', 'patterns', 'statut', 'etiquette')})
    print(ident, serie['nombre'], 'coupes', f'fib {fib:.1f} % vd {vd:.1f} %', 'séquentiel' if sequentiel else f'pas {pas}', flush=True)
tous = sorted(nouveaux + [c for c in index if c['id'].startswith('siccs-')], key=lambda c: c['id'])
(cas_dir / 'index.json').write_text(json.dumps(tous + [c for c in index if not c['id'].startswith('siccs-')], ensure_ascii=False, indent=2))
print(len(nouveaux), 'cas SICCS importés')
