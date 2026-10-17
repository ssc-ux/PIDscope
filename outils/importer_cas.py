"""Ajoute à l'atlas un cas exporté depuis « Mon scanner » (archive .zip anonymisée).

    python3 outils/importer_cas.py <archive.zip>

Vérifie que l'archive ne contient que des images et cas.json, puis l'extrait dans data/cas/ et met à jour l'index.
"""
import json, re, sys, zipfile
from pathlib import Path

archive = zipfile.ZipFile(sys.argv[1])
noms = archive.namelist()
racine = noms[0].split('/')[0]
autorises = re.compile(rf'^{re.escape(racine)}/((poumon|mediastin)/\d{{4}}\.(webp|jpg)|vignette\.(webp|jpg)|cas\.json)$')
intrus = [n for n in noms if not autorises.match(n)]
if intrus:
    sys.exit(f'Fichiers inattendus, import refusé : {intrus[:5]}')
cas = json.loads(archive.read(f'{racine}/cas.json'))
if not re.fullmatch(r'[a-z0-9-]+', cas['id']) or (Path('data/cas') / cas['id']).exists():
    sys.exit(f"Identifiant invalide ou déjà utilisé : {cas['id']}")
archive.extractall('data/cas')
if (Path('data/cas') / racine / 'vignette.jpg').exists():
    (Path('data/cas') / racine / 'vignette.jpg').rename(Path('data/cas') / racine / 'vignette.webp')  # l'accueil attend vignette.webp
index = json.loads(Path('data/cas/index.json').read_text())
index.insert(0, {k: cas.get(k) for k in ('id', 'titre', 'description', 'categorie', 'maladies', 'patterns', 'statut')})
Path('data/cas/index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2))
print(f"Cas {cas['id']} ajouté ({cas['serie']['nombre']} coupes), statut : {cas['statut']}")
