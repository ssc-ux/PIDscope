# Format des cas

Chaque cas est un dossier `data/cas/<id>/` (id : minuscules, chiffres, tirets) contenant :

- `cas.json` (décrit ci-dessous)
- `images/0001.webp`, `0002.webp`… : la série complète, **de l'apex vers les bases**, déjà fenêtrée.

Le cas doit aussi être ajouté à `data/cas/index.json` (id, titre, maladies, patterns, statut).

```json
{
  "id": "ssc-pins-01",
  "titre": "Sclérodermie systémique : PINS fibrosante",
  "maladies": ["Sclérodermie systémique"],
  "patterns": ["PINS"],
  "statut": "brouillon",
  "relecture": { "par": "", "date": "" },
  "source": { "nom": "Radiopaedia", "url": "https://…", "auteur": "…", "licence": "CC BY-NC-SA 3.0" },
  "serie": { "nombre": 250, "modele": "images/{n}.webp", "chiffres": 4, "espacement_mm": 1.25, "fenetre": "parenchymateuse" },
  "texte": "## Sémiologie\n\n- **Verre dépoli** sous-pleural postérieur [coupe 180]\n- Respect sous-pleural [coupe 195]"
}
```

- `statut` : `brouillon` tant que le cas n'a pas été relu, puis `relu` avec `relecture.par` et `relecture.date` (AAAA-MM-JJ).
- `texte` : `## titre`, `- liste`, `**gras**`, `[coupe N]` (bouton qui affiche la coupe N, numérotée à partir de 1). Le HTML est échappé.
- Seules des images sous licence compatible avec CC BY-NC-SA, source et auteur cités. **Jamais d'images de patients.**
