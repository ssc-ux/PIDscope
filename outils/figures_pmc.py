"""Recherche de figures de scanner de PID de connectivite dans les articles en libre accès de PubMed Central.

    python3 outils/figures_pmc.py <dossier_sortie> [« Maladie A,Maladie B »]

1. Recherche des figures par maladie : Open-i (NLM), https://openi.nlm.nih.gov/services
2. Licence, DOI et auteurs de chaque article : Europe PMC, https://europepmc.org/RestfulWebService
3. Figure en pleine résolution : PMC Open Access sur AWS (dépôt ouvert officiel de la NLM), s3://pmc-oa-opendata
Seules les licences permettant la réutilisation non commerciale sont retenues ; les licences « ND » sont signalées
(figure à afficher sans modification). Produit candidats.json et une planche de vignettes par maladie pour le tri manuel.
"""
import html, io, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

RECHERCHES = {
    'Sclérodermie systémique': ['systemic sclerosis interstitial lung disease HRCT', 'scleroderma nonspecific interstitial pneumonia computed tomography'],
    'Polyarthrite rhumatoïde': ['rheumatoid arthritis interstitial lung disease HRCT', 'rheumatoid arthritis usual interstitial pneumonia CT'],
    'Syndrome des antisynthétases': ['antisynthetase syndrome interstitial lung disease CT', 'anti-Jo-1 interstitial lung disease computed tomography'],
    'Dermatomyosite anti-MDA5': ['anti-MDA5 dermatomyositis interstitial lung disease CT', 'clinically amyopathic dermatomyositis rapidly progressive interstitial lung disease CT'],
    'Myopathies inflammatoires': ['dermatomyositis interstitial lung disease CT', 'polymyositis interstitial lung disease HRCT',
                                  'idiopathic inflammatory myopathy interstitial lung disease computed tomography', 'anti-PL-7 anti-PL-12 interstitial lung disease CT'],
    'Syndrome de Sjögren': ['Sjogren syndrome lymphocytic interstitial pneumonia CT', 'Sjogren syndrome interstitial lung disease cysts computed tomography'],
    'Lupus systémique': ['systemic lupus erythematosus interstitial lung disease CT', 'acute lupus pneumonitis computed tomography'],
    'Connectivite mixte': ['mixed connective tissue disease interstitial lung disease CT'],
    'Vascularite à ANCA': ['microscopic polyangiitis interstitial lung disease CT', 'MPO-ANCA interstitial lung disease computed tomography'],
    'IPAF': ['interstitial pneumonia with autoimmune features CT'],
    'Sarcoïdose': ['pulmonary sarcoidosis HRCT perilymphatic nodules', 'fibrotic pulmonary sarcoidosis computed tomography'],
}
LICENCES = {'cc by', 'cc by-sa', 'cc0', 'cc by-nc', 'cc by-nc-sa', 'cc by-nc-nd', 'cc by-nd'}
SCANNER = re.compile(r'\b(HRCT|CT|computed tomograph|tomodensit)', re.I)
PID = re.compile(r'ground[- ]glass|reticul|honeycomb|consolidat|interstitial|fibros|traction|cyst|NSIP|UIP|organi[sz]ing|nodul|crazy', re.I)
EXCLURE = re.compile(r'\bPET\b|ultraso|MRI|magnetic|histolog|biopsy specimen|Kaplan|survival|flow ?chart|algorithm|forest plot|ROC curve|echocardiog', re.I)


def lire_json(url, essais=3):
    for i in range(essais):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'PIDscope (enseignement)'}), timeout=60) as r:
                return json.load(r)
        except Exception:
            time.sleep(2 * (i + 1))
    return None


def texte(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s or ''))).strip()


def metadonnees(pmcid, cache={}):
    if pmcid not in cache:
        q = urllib.parse.quote(f'PMCID:{pmcid}')
        d = lire_json(f'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query={q}&resultType=core&format=json')
        r = (d or {}).get('resultList', {}).get('result', [])
        cache[pmcid] = r[0] if r else {}
        time.sleep(0.25)
    return cache[pmcid]


def fichier_s3(pmcid, base):
    with urllib.request.urlopen(f'https://pmc-oa-opendata.s3.amazonaws.com/?list-type=2&prefix={pmcid}.', timeout=60) as r:
        cles = re.findall(r'<Key>([^<]+)</Key>', r.read().decode())
    images = [c for c in cles if c.split('/')[-1].rsplit('.', 1)[0] == base and re.search(r'\.(jpe?g|png|tiff?)$', c, re.I)]
    return f'https://pmc-oa-opendata.s3.amazonaws.com/{images[0]}' if images else None


def main():
    sortie = Path(sys.argv[1])
    if len(sys.argv) > 2:  # restreindre à certaines maladies : « Maladie A,Maladie B »
        for m in set(RECHERCHES) - set(sys.argv[2].split(',')):
            del RECHERCHES[m]
    (sortie / 'vignettes').mkdir(parents=True, exist_ok=True)
    candidats, vus = [], set()
    for maladie, requetes in RECHERCHES.items():
        for req in requetes:
            d = lire_json('https://openi.nlm.nih.gov/api/search?' + urllib.parse.urlencode({'query': req, 'coll': 'pmc', 'm': 1, 'n': 40}))
            time.sleep(0.5)
            for x in (d or {}).get('list', []):
                legende = texte((x.get('image') or {}).get('caption') if isinstance(x.get('image'), dict) else '')
                cle = x.get('imgLarge')
                if not cle or cle in vus or not SCANNER.search(legende) or not PID.search(legende) or EXCLURE.search(legende):
                    continue
                vus.add(cle)
                pmcid = x.get('uid')
                m = metadonnees(pmcid)
                licence = (m.get('license') or '').lower()
                if licence not in LICENCES:
                    continue
                base = cle.split('/')[-1].split('_', 1)[1].rsplit('.', 1)[0]
                candidats.append({
                    'id': f'{len(candidats) + 1:03d}', 'maladie': maladie, 'requete': req, 'pmcid': pmcid,
                    'legende': legende, 'titre': texte(m.get('title') or x.get('title')), 'auteurs': m.get('authorString', ''),
                    'revue': m.get('journalInfo', {}).get('journal', {}).get('title', x.get('journal_title', '')),
                    'annee': m.get('pubYear', ''), 'doi': m.get('doi', ''), 'licence': licence, 'type': x.get('articleType', ''),
                    'figure_base': base, 'vignette': 'https://openi.nlm.nih.gov' + x.get('imgGrid150', cle),
                })
                print(len(candidats), maladie, licence, pmcid, legende[:80], flush=True)
    # Vignettes et planches de tri, une par maladie.
    from PIL import Image, ImageDraw
    for maladie in RECHERCHES:
        liste = [c for c in candidats if c['maladie'] == maladie]
        if not liste:
            continue
        cols, T = 6, 200
        planche = Image.new('RGB', (cols * T, ((len(liste) + cols - 1) // cols) * T))
        dessin = ImageDraw.Draw(planche)
        for k, c in enumerate(liste):
            try:
                with urllib.request.urlopen(c['vignette'], timeout=60) as r:
                    im = Image.open(io.BytesIO(r.read())).convert('RGB')
                im.thumbnail((T, T))
                planche.paste(im, ((k % cols) * T, (k // cols) * T))
            except Exception:
                pass
            dessin.rectangle([(k % cols) * T, (k // cols) * T, (k % cols) * T + 34, (k // cols) * T + 14], fill=(0, 0, 0))
            dessin.text(((k % cols) * T + 2, (k // cols) * T + 1), c['id'], fill=(255, 255, 0))
            time.sleep(0.2)
        planche.save(sortie / f"planche_{re.sub(r'[^a-z]+', '_', maladie.lower())}.png")
    (sortie / 'candidats.json').write_text(json.dumps(candidats, ensure_ascii=False, indent=1))
    print(len(candidats), 'candidats')


if __name__ == '__main__':
    main()
