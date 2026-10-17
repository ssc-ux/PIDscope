# PIDscope

Site pédagogique pour apprendre à lire le scanner thoracique des **pneumopathies interstitielles diffuses (PID) de médecine interne**, destiné aux internes de médecine interne.

- **Cas** : séries complètes publiques à faire défiler, avec leur description et leur source.
- **Mon scanner** : ouverture locale d’un DICOM ou d’images JPEG/PNG, et comparaison de deux examens avec défilement synchronisé. **Les images ne quittent jamais l’appareil.**

> Outil pédagogique : ce n’est pas une aide au diagnostic.

## Utilisation locale

```sh
npm run serve   # puis http://localhost:8080
npm test        # tests du lecteur DICOM et de la mise en forme des textes
```

Site statique sans étape de compilation (HTML, CSS, JavaScript), publié par GitHub Pages depuis la branche `main`.

## Lecteur DICOM

- Formats acceptés : DICOM non compressé little endian (implicit / explicit VR), 8 ou 16 bits, monochrome, une image par fichier.
- Les formats compressés, couleur ou multi-images sont **refusés avec un message explicite** plutôt qu’affichés de façon douteuse.
- Coupes triées selon leur position réelle (Image Position / Orientation Patient), de l’apex vers les bases ; alertes en cas d’espacement irrégulier ou de doublons.
- Valeurs converties en UH (Rescale Slope / Intercept) ; l’identité du patient n’est jamais affichée.
- Tests sur des fichiers générés par une bibliothèque indépendante (pydicom) : `tests/fixtures/generer.py`.

## Ajouter un cas

Voir [`data/cas/LISEZMOI.md`](data/cas/LISEZMOI.md).

## Licence

Contenu et code sous licence [CC BY-NC-SA 4.0](LICENSE.md). Bibliothèque incluse : [dicomParser](https://github.com/cornerstonejs/dicomParser) (MIT).
