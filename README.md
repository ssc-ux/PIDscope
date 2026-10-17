# PIDscope

Site pédagogique pour apprendre à lire le scanner thoracique des **pneumopathies interstitielles diffuses (PID) de médecine interne**, destiné aux internes de médecine interne.

- **Atlas** : de vrais scanners complets (bases ouvertes Zenodo et TCIA) à faire défiler, fenêtres poumon et médiastin, sémiologie reliée aux coupes.
- **Fiches** : lésions élémentaires, patterns de PID, orientation selon la connectivite, avec références.
- **Mon scanner** : ouverture locale d’un DICOM ou d’images JPEG/PNG, comparaison de deux examens avec défilement synchronisé. **Les images ne quittent jamais l’appareil.**
- **Étendue** : scores de Goh, Warrick et Kazerooni ; quantification : mesures de densité publiées (HAA selon MESA, indices d'histogramme selon Best 2003) et carte exploratoire verre dépoli / fibrose / condensation, corrigeable au pinceau sur les 5 niveaux de Goh.

> Outil pédagogique : ce n’est pas une aide au diagnostic.

## Utilisation locale

```sh
npm run serve   # puis http://localhost:8080
npm test        # tests du lecteur DICOM et de la mise en forme des textes
```

Site statique sans étape de compilation (HTML, CSS, JavaScript), publié par GitHub Pages depuis la branche `main`.

## Lecteur DICOM

- Formats acceptés : DICOM non compressé little endian, JPEG Lossless et RLE Lossless ; 8 ou 16 bits, monochrome, une image par fichier.
- JPEG avec perte, JPEG 2000, couleur et multi-images sont **refusés avec un message explicite** plutôt qu’affichés de façon douteuse.
- Décodage vérifié identique à pydicom sur 104 coupes réelles compressées (27 millions de pixels, aucune différence).
- Coupes triées selon leur position réelle (Image Position / Orientation Patient), de l’apex vers les bases ; alertes en cas d’espacement irrégulier ou de doublons.
- Valeurs converties en UH (Rescale Slope / Intercept) ; l’identité du patient n’est jamais affichée.
- Tests sur des fichiers générés par une bibliothèque indépendante (pydicom) : `tests/fixtures/generer.py`.

## Scores et densitométrie

Chaque score applique la définition de l’article original (Goh 2008, Warrick 1991, Kazerooni 1997, HAA selon MESA-Lung 2009) ; les calculs sont couverts par des tests (`tests/scores.test.js`, `tests/densitometrie.test.js`). La segmentation (seuil -200 UH, Best 2003) et la carte des lésions sont affichées et doivent être vérifiées. La carte des lésions est une méthode maison **exploratoire, non validée** : aucun outil validé de classification des lésions de PID n'est disponible en libre accès (audit : CALIPER, QILD, DTA, SOFIA sont fermés).

## Ajouter un cas

Voir [`data/cas/LISEZMOI.md`](data/cas/LISEZMOI.md) et `outils/creer_cas.py`.

## Licence

Contenu et code sous licence [CC BY-NC-SA 4.0](LICENSE.md). Segmentation des poumons : [lungmask R231](https://github.com/JoHof/lungmask) (Apache 2.0), converti en ONNX (`modeles/`, voir `modeles/LISEZMOI.md`) et exécuté par [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT). Méthode complète : page `methode.html`.

Bibliothèques incluses : [dicomParser](https://github.com/cornerstonejs/dicomParser) et [JPEGLosslessDecoderJS](https://github.com/rii-mango/JPEGLosslessDecoderJS) (MIT). Images : licence de leur source, indiquée sur chaque cas.
