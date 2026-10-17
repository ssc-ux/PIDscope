# Format des cas

Chaque cas est un dossier `data/cas/<id>/` (id : minuscules, chiffres, tirets) contenant :

- `cas.json` (décrit ci-dessous) ;
- `poumon/0001.webp`, `mediastin/0001.webp`… : la série complète **de l'apex vers les bases**, une pile par fenêtre ;
- `vignette.webp` : l'image de la carte d'accueil.

Les images et les champs `serie` sont produits par `outils/creer_cas.py` à partir d'un dossier DICOM ou d'un fichier NRRD :

```sh
pip install numpy pillow pydicom pynrrd pylibjpeg pylibjpeg-libjpeg
python3 outils/creer_cas.py <dossier DICOM | volume.nrrd> data/cas/<id> [--pas 2] [--debut 0.05 --fin 0.7] [--vignette 0.5]
```

Le cas doit aussi être ajouté à `data/cas/index.json` (id, titre, description, categorie, maladies, patterns, statut).

```json
{
  "id": "ssc-pins-01",
  "titre": "Sclérodermie systémique : PINS fibrosante",
  "description": "Phrase affichée sur la carte d'accueil.",
  "categorie": "Connectivites",
  "maladies": ["Sclérodermie systémique"],
  "patterns": ["PINS"],
  "statut": "brouillon",
  "relecture": { "par": "", "date": "" },
  "source": { "nom": "…", "url": "https://…", "auteur": "…", "licence": "CC BY-NC-SA 4.0", "modifications": "…" },
  "serie": { "nombre": 250, "chiffres": 4, "espacement_mm": 1.25, "coupe_initiale": 120,
             "fenetres": { "poumon": "poumon/{n}.webp", "mediastin": "mediastin/{n}.webp" } },
  "niveaux_goh": [30, 55, 90, 105, 120],
  "liens": [{ "titre": "Article Radiopaedia", "url": "https://radiopaedia.org/articles/…" }],
  "texte": "## Sémiologie\n- **Verre dépoli** sous-pleural postérieur [coupe 180]\n- Respect sous-pleural [coupe 195]"
}
```

- `statut` : `brouillon` tant que le cas n'a pas été relu, puis `relu` avec `relecture.par` et `relecture.date` (AAAA-MM-JJ).
- `pixel_mm` (dans `serie`) : taille du pixel des images exportées, nécessaire à la quantification.
- `niveaux_goh` (facultatif) : les 5 coupes proposées pour le score de Goh (numérotées à partir de 1).
- `texte` : `## titre`, `- liste`, `**gras**`, `[coupe N]` (bouton qui affiche la coupe N). Le HTML est échappé.
- Uniquement des images publiées sous licence ouverte, source et auteur cités. **Jamais d'images de patients du service.**
