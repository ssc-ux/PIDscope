"""Génère de petits fichiers DICOM synthétiques avec pydicom (bibliothèque indépendante de celle du site).
Usage : python3 tests/fixtures/generer.py   (pip install pydicom numpy)

Valeur attendue en UH : -1000 + 100 * k + c, où k est le rang de la coupe depuis l'apex (0 = la plus haute)
et c la colonne. Les fichiers sont écrits dans le désordre pour vérifier le tri.
"""
from pathlib import Path
import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, ImplicitVRLittleEndian, JPEGLosslessSV1, generate_uid
from pydicom.encaps import encapsulate

ICI = Path(__file__).parent
N, TAILLE = 5, 8


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


def ecrire(ds, nom, implicite=False):
    ds.save_as(ICI / nom, enforce_file_format=True, implicit_vr=implicite, little_endian=True)


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

# Série C : compressée (JPEG lossless) → doit être refusée proprement.
ds = base(generate_uid(), JPEGLosslessSV1, 0, instance=1, description='Compressee')
ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 12, 11, 0
ds.PixelData = encapsulate([b'\xff\xd8\x00\x00\xff\xd9'])
ecrire(ds, 'c_compresse.dcm')

(ICI / 'pas_dicom.txt').write_text('ceci n’est pas un DICOM\n')
print('ok')
