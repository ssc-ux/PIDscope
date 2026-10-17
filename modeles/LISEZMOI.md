# Modèles

## lungmask R231 (segmentation des poumons)

- Origine : Hofmanninger J et al., *Automatic lung segmentation in routine imaging is primarily a data diversity problem, not a methodology problem*, Eur Radiol Exp 2020;4:50, doi:10.1186/s41747-020-00173-2.
- Poids : `unet_r231-d5d2fc3d.pth`, https://github.com/JoHof/lungmask (licence Apache 2.0, voir `LICENSE-lungmask.txt`).
- Conversion (lungmask 0.2.21, PyTorch 2.14, ONNX opset 17) :
  - `lungmask_r231_fp16.onnx` (58 Mo) : demi-précision, entrées/sorties en float32 ; utilisé avec WebGPU.
  - `lungmask_r231_int8.onnx` (29 Mo) : quantification statique int8 (QDQ, par canal), calibrée sur 39 coupes de 3 scanners ; utilisé sur processeur (WebAssembly).
- Entrée `image` [n, 1, 256, 256] (UH bornées à [-1024 ; 600], recadrées sur le corps, normalisées (x + 1024) / 1624) ; sortie `logits` [n, 3, 256, 256] (fond, poumon droit, poumon gauche).
- Vérification (masques du navigateur, `js/lungmask.js` + onnxruntime-web, comparés au paquet Python officiel, 1 coupe sur 4 de 3 scanners réels) :

| Modèle | Normal | COVID diffus | COVID périphérique | Temps (processeur, 1 fil) |
|---|---|---|---|---|
| fp16 | Dice 1,0000 | 0,9994 | 0,9986 | 4,3 s/coupe |
| int8 | Dice 0,9984 | 0,9909 | 0,9936 | 2,5 s/coupe |

Modifications : conversion de format et quantification uniquement ; architecture et poids d'origine.
