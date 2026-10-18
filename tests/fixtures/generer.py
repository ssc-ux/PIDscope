"""Génère de petits fichiers DICOM synthétiques avec pydicom (bibliothèque indépendante de celle du site).
Usage : python3 tests/fixtures/generer.py   (pip install pydicom numpy python-gdcm)

Valeur attendue en UH : -1000 + 100 * k + c, où k est le rang de la coupe depuis l'apex (0 = la plus haute)
et c la colonne. Les fichiers sont écrits dans le désordre pour vérifier le tri.
Les UID sont dérivés des noms (generate_uid(entropy_srcs=…)) : deux exécutions produisent les mêmes fichiers.
"""
from pathlib import Path
import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import (ExplicitVRBigEndian, ExplicitVRLittleEndian, ImplicitVRLittleEndian, JPEG2000Lossless,
                         JPEGBaseline8Bit, RLELossless, generate_uid as _uid)
from pydicom.encaps import encapsulate

ICI = Path(__file__).parent
N, TAILLE = 5, 8
_compteur = [0]


def generate_uid():
    _compteur[0] += 1
    return _uid(entropy_srcs=['PIDscope', str(_compteur[0])])


def base(serie_uid, ts, z, instance, description):
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ts
    ds = Dataset()
    ds.file_meta = meta
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.Modality = 'CT'
    ds.SeriesInstanceUID = serie_uid
    ds.SeriesDescription = description
    ds.SeriesNumber = 2
    ds.StudyDate = '20240115'
    ds.InstanceNumber = instance
    ds.ImagePositionPatient = [-100, -100, z]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.PixelSpacing = [0.7, 0.7]
    ds.SliceThickness = 1.25
    ds.Rows = ds.Columns = TAILLE
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated = 16
    return ds


def uh(k):
    return -1000 + 100 * k + np.tile(np.arange(TAILLE), (TAILLE, 1))


def ecrire(ds, nom, implicite=False, little_endian=True):
    ds.save_as(ICI / nom, enforce_file_format=True, implicit_vr=implicite, little_endian=little_endian)


# Série A : explicit VR, non signé 12 bits, intercept -1024 (cas le plus courant).
uid = generate_uid()
for k in [3, 0, 4, 1, 2]:
    z = 50 - 2.5 * k  # z décroît de l'apex vers les bases
    ds = base(uid, ExplicitVRLittleEndian, z, instance=10 - k, description='Thorax A')  # instance inversée exprès
    ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 12, 11, 0
    ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
    ds.WindowCenter, ds.WindowWidth = -600, 1500
    ds.PixelData = (uh(k) + 1024).astype('<u2').tobytes()
    ecrire(ds, f'a_{k}.dcm')

# Série B : implicit VR, signé 16 bits, pente 2 et intercept -100.
uid = generate_uid()
for k in range(N):
    ds = base(uid, ImplicitVRLittleEndian, 20 - 1.0 * k, instance=k + 1, description='Thorax B')
    ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 15, 1
    ds.RescaleIntercept, ds.RescaleSlope = -100, 2
    ds.PixelData = ((uh(k) + 100) // 2).astype('<i2').tobytes()
    ecrire(ds, f'b_{k}.dcm', implicite=True)

# Série C : JPEG 2000 (non pris en charge) → doit être refusée proprement.
ds = base(generate_uid(), JPEG2000Lossless, 0, instance=1, description='Compressee')
ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 12, 11, 0
ds.PixelData = encapsulate([b'\xff\x4f\xff\xd9'])
ecrire(ds, 'c_compresse.dcm')

# Séries D (RLE Lossless, encodée par pydicom) et E (JPEG Lossless SV1, encodée par GDCM) : mêmes UH que la série A.
import gdcm
for nom, desc in (('d', 'Thorax RLE'), ('e', 'Thorax JPEG')):
    uid = generate_uid()
    for k in range(N):
        ds = base(uid, ExplicitVRLittleEndian, 50 - 2.5 * k, instance=k + 1, description=desc)
        ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 12, 11, 0
        ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
        ds.PixelData = (uh(k) + 1024).astype('<u2').tobytes()
        if nom == 'd':
            ds.compress(RLELossless, encoding_plugin='pydicom')
            ecrire(ds, f'{nom}_{k}.dcm')
        else:
            ecrire(ds, f'{nom}_{k}.dcm')
            r = gdcm.ImageReader(); r.SetFileName(str(ICI / f'{nom}_{k}.dcm')); assert r.Read()
            c = gdcm.ImageChangeTransferSyntax()
            c.SetTransferSyntax(gdcm.TransferSyntax(gdcm.TransferSyntax.JPEGLosslessProcess14_1))
            c.SetInput(r.GetImage()); assert c.Change()
            w = gdcm.ImageWriter(); w.SetFileName(str(ICI / f'{nom}_{k}.dcm')); w.SetFile(r.GetFile()); w.SetImage(c.GetOutput()); assert w.Write()

# Série F : Explicit VR Big Endian (syntaxe retirée mais encore rencontrée), signé 16 bits, sans intercept.
uid = generate_uid()
for k in range(3):
    ds = base(uid, ExplicitVRBigEndian, 50 - 2.5 * k, instance=k + 1, description='Thorax BE')
    ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 15, 1
    ds.RescaleIntercept, ds.RescaleSlope = 0, 1
    ds.PixelData = uh(k).astype('>i2').tobytes()
    ecrire(ds, f'f_{k}.dcm', little_endian=False)

# Série G : ni position ni orientation, ni Rescale, ni BitsStored ; tri par numéro d'instance, pas déclaré 3 mm.
uid = generate_uid()
for k in [2, 0, 1]:
    ds = base(uid, ExplicitVRLittleEndian, 0, instance=k + 1, description='Sans position')
    del ds.ImagePositionPatient, ds.ImageOrientationPatient
    ds.SpacingBetweenSlices = 3
    ds.HighBit, ds.PixelRepresentation = 15, 1
    ds.PixelData = uh(k).astype('<i2').tobytes()
    ecrire(ds, f'g_{k}.dcm')

# Série H : doublon (même SOP Instance UID), un fichier tronqué, épaisseurs incohérentes (1,25 et 2,5 mm).
uid = generate_uid()
for k in range(5):
    ds = base(uid, ExplicitVRLittleEndian, 50 - 2.5 * k, instance=k + 1, description='Thorax H')
    ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 12, 11, 0
    ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
    if k == 3:
        ds.SliceThickness = 2.5
    ds.PixelData = (uh(k) + 1024).astype('<u2').tobytes()
    ecrire(ds, f'h_{k}.dcm')
    if k == 1:
        ecrire(ds, 'h_1_copie.dcm')
b = (ICI / 'h_4.dcm').read_bytes()
(ICI / 'h_4.dcm').write_bytes(b[:-20])  # copie interrompue : 20 octets de pixels manquants

# I : jeu de données brut sans préambule ni « DICM » (anciens exports), implicit VR little endian.
ds = base(generate_uid(), ImplicitVRLittleEndian, 0, instance=1, description='Sans preambule')
ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 12, 11, 0
ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
ds.PixelData = (uh(0) + 1024).astype('<u2').tobytes()
del ds.file_meta
ds.preamble = None
ds.save_as(ICI / 'i_brut.dcm', enforce_file_format=False, implicit_vr=True, little_endian=True)

# J : JPEG Baseline (avec perte) et K : couleur RGB → refusés avec un message explicite.
ds = base(generate_uid(), JPEGBaseline8Bit, 0, instance=1, description='JPEG perte')
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
ds.PixelData = encapsulate([b'\xff\xd8\xff\xd9'])
ecrire(ds, 'j_jpeg_perte.dcm')
ds = base(generate_uid(), ExplicitVRLittleEndian, 0, instance=1, description='Couleur')
ds.SamplesPerPixel, ds.PhotometricInterpretation, ds.PlanarConfiguration = 3, 'RGB', 0
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
ds.PixelData = bytes(TAILLE * TAILLE * 3)
ecrire(ds, 'k_couleur.dcm')

# M : 12 bits stockés alignés à gauche (High Bit 15) ; N : IRM 8 bits sans Rescale.
ds = base(generate_uid(), ExplicitVRLittleEndian, 0, instance=1, description='Bit haut')
ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 12, 15, 0
ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
ds.PixelData = ((uh(0) + 1024) << 4).astype('<u2').tobytes()
ecrire(ds, 'm_bit_haut.dcm')
ds = base(generate_uid(), ExplicitVRLittleEndian, 0, instance=1, description='Huit bits')
ds.Modality = 'MR'
ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 8, 8, 7, 0
ds.PixelData = (np.tile(np.arange(TAILLE), (TAILLE, 1)) + 200).astype('u1').tobytes()
ecrire(ds, 'n_huit_bits.dcm')

(ICI / 'pas_dicom.txt').write_text('ceci n’est pas un DICOM\n')
(ICI / 'vide.dcm').write_bytes(b'')
# Binaire quelconque commençant comme un jeu de données brut (groupe 0008) : ne doit pas être pris pour un DICOM.
(ICI / 'faux_brut.bin').write_bytes(bytes([0x08, 0x00, 0x05, 0x00]) + bytes((i * 37 + 11) % 256 for i in range(300)))
print('ok')
