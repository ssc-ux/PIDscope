// Archive ZIP minimale (méthode « stockée », sans compression : les images WebP/JPEG sont déjà compressées).

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(octets) {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// fichiers : [{ nom, donnees: Uint8Array }] → Uint8Array de l'archive.
export function creerZip(fichiers) {
  const encodeur = new TextEncoder();
  const locaux = [], centraux = [];
  let decalage = 0;
  for (const f of fichiers) {
    const nom = encodeur.encode(f.nom);
    const crc = crc32(f.donnees);
    const entete = new DataView(new ArrayBuffer(30));
    entete.setUint32(0, 0x04034b50, true);
    entete.setUint16(4, 20, true);
    entete.setUint16(6, 0x0800, true); // noms en UTF-8
    entete.setUint32(14, crc, true);
    entete.setUint32(18, f.donnees.length, true);
    entete.setUint32(22, f.donnees.length, true);
    entete.setUint16(26, nom.length, true);
    locaux.push(new Uint8Array(entete.buffer), nom, f.donnees);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, f.donnees.length, true);
    central.setUint32(24, f.donnees.length, true);
    central.setUint16(28, nom.length, true);
    central.setUint32(42, decalage, true);
    centraux.push(new Uint8Array(central.buffer), nom);
    decalage += 30 + nom.length + f.donnees.length;
  }
  const tailleCentral = centraux.reduce((t, b) => t + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, fichiers.length, true);
  fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCentral, true);
  fin.setUint32(16, decalage, true);
  const morceaux = [...locaux, ...centraux, new Uint8Array(fin.buffer)];
  const sortie = new Uint8Array(morceaux.reduce((t, b) => t + b.length, 0));
  let o = 0;
  for (const m of morceaux) { sortie.set(m, o); o += m.length; }
  return sortie;
}
