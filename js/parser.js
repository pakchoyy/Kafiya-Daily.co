// Perapi chat WhatsApp -> {name, phone, address}. Aturan sederhana, jalan offline.

const PHONE_RE = /(?:\+?62|0)\s*8[\d\s.\-]{7,14}\d/;
const ADDR_KW = /\b(jl|jln|jalan|gg|gang|rt|rw|no|desa|ds|kel|kelurahan|kec|kecamatan|kab|kabupaten|kota|blok|perum|perumahan|komp|kompleks|dusun|dsn|kp|kampung|prov|provinsi)\b/i;
const WA_PREFIX = /^\[?\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},?\s+\d{1,2}[.:]\d{2}(?:[.:]\d{2})?\]?\s*(?:-\s*)?[^:]{1,40}:\s*/;
const LBL = {
  name: /^(?:(?:nama(?:\s+penerima)?|penerima|atas\s*nama)\s*[:=\-]|(?:a\/n|a\.n\.?|an\.)\s*[:=\-]?)\s*/i,
  phone: /^(?:no\.?\s*(?:hp|telp?|tlp|wa|whatsapp)|hp|telp?|tlp|wa|whatsapp|nomor(?:\s+(?:hp|telepon|wa))?|kontak)\s*[:=\-]\s*/i,
  addr: /^(?:alamat(?:\s+lengkap|\s+pengiriman)?|almt)\s*[:=\-]\s*/i,
};

export function normalizePhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('62')) d = '0' + d.slice(2);
  else if (d.startsWith('8')) d = '0' + d;
  return d;
}

function titleCase(s) {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s.'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

export function parseChat(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n')
    .map((l) => l.replace(WA_PREFIX, '').trim()).filter(Boolean);

  let name = '', phone = '', cur = null;
  const addr = [], loose = [];

  for (const l of lines) {
    let m;
    if ((m = l.match(LBL.name))) { name = l.slice(m[0].length).trim(); cur = null; continue; }
    if ((m = l.match(LBL.phone))) {
      const v = l.slice(m[0].length);
      const p = v.match(PHONE_RE);
      phone = normalizePhone(p ? p[0] : v);
      cur = null; continue;
    }
    if ((m = l.match(LBL.addr))) { addr.push(l.slice(m[0].length).trim()); cur = 'addr'; continue; }
    (cur === 'addr' ? addr : loose).push(l);
  }

  // baris tanpa label: cari HP, pisahkan teks sebelum/sesudahnya
  const rest = [];
  for (const l of loose) {
    const p = !phone && l.match(PHONE_RE);
    if (p) {
      phone = normalizePhone(p[0]);
      const before = l.slice(0, p.index).replace(/[,;:\-\s]+$/, '').trim();
      const after = l.slice(p.index + p[0].length).replace(/^[,;:\-\s]+/, '').trim();
      if (before) rest.push(before);
      if (after) rest.push(after);
    } else rest.push(l);
  }

  if (!name) {
    const i = rest.findIndex((l) => l.length <= 40 && !/\d/.test(l) && !ADDR_KW.test(l));
    if (i >= 0) name = rest.splice(i, 1)[0];
    else if (rest.length > 1) name = rest.shift();
  }

  const address = [...rest, ...addr].join(', ')
    .replace(/\s+/g, ' ').replace(/(,\s*)+/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();

  return { name: titleCase(name.replace(/\s+/g, ' ').trim()), phone, address };
}

// Bersihkan teks hasil OCR screenshot WhatsApp: jam, centang, dan baris tombol aplikasi.
export function cleanOcr(raw) {
  return String(raw || '').split(/\r?\n/)
    .map((l) => l.replace(/[|]/g, ' ').replace(/\s+\d{1,2}[.:]\d{2}\s*[✓√vV/\\]*\s*$/, '').trim())
    .filter((l) => l && !/^\d{1,2}[.:]\d{2}$/.test(l) && !/^(ketik pesan|pesan|hari ini|kemarin|online|mengetik)/i.test(l))
    .join('\n');
}

// Screenshot chat berisi banyak obrolan lain. Ambil hanya yang jelas: nama berlabel (Nama:, an., a/n),
// nomor HP, dan baris yang memang tampak alamat (RT/RW, desa, kec, kab, jl, kode pos, ...).
const ADDR_LINE = new RegExp(ADDR_KW.source + '|\\b\\d{5}\\b|\\brt\\s*\\d|\\brw\\s*\\d', 'i');
const CHATTER = /\b(mba|mbak|kak|ya|ok|oke+|siap|makasih|terima\s*kasih|ongki?r?|total|transfer|kembalian|pcs|rb|ribu)\b/i;

export function parseChatOcr(raw) {
  const lines = cleanOcr(raw).split('\n');
  let name = '', phone = '';
  const addr = [];
  for (const l of lines) {
    let m;
    if (!name && (m = l.match(LBL.name))) { name = l.slice(m[0].length).trim(); continue; }
    const p = l.match(PHONE_RE);
    if (p && !phone) phone = normalizePhone(p[0]);
    if ((m = l.match(LBL.addr))) { addr.push(l.slice(m[0].length).trim()); continue; }
    if (ADDR_LINE.test(l) && !CHATTER.test(l)) addr.push(p ? l.replace(p[0], '').trim() : l);
  }
  if (!name && !addr.length) return parseChat(cleanOcr(raw));
  const address = addr.join(', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').replace(/(,\s*)+/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
  return { name: titleCase(name.replace(/\s+/g, ' ').trim()), phone, address };
}

// Ambil kandidat no. resi dari teks OCR: kode huruf/angka 10–25 karakter yang mengandung angka.
// Awalan resi yang dikenal (SPX/Shopee, J&T, JNE, SiCepat, Wahana, ...). Kalau ada yang cocok, hanya itu yang diambil
// supaya no. pesanan / no. HP di label tidak ikut.
const RESI_PREFIX = /^(SPXID|SPX|JX|JP|JT|JD|TKP|IDE|IDS|CM|JNE|SCP|WHN|NLI|LXAD|GK|ID)/;
// OCR sering salah baca angka sebagai huruf; betulkan bagian tengah resi berawalan SPXID.
export const isKnownResi = (t) => RESI_PREFIX.test(t) && t !== 'ID';
const fixDigits = (s) => s.replace(/^(SPXID)([A-Z0-9]+?)([A-Z]?)$/, (_, a, mid, end) => a + mid.replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8').replace(/G/g, '6') + end);
export function extractResi(raw) {
  const all = [];
  for (const m of String(raw || '').toUpperCase().matchAll(/\b[A-Z0-9]{10,25}\b/g)) {
    const t = fixDigits(m[0]);
    // buang no. HP dan no. pesanan Shopee (diawali tanggal yymmdd)
    if (/\d{5}/.test(t) && !/^(0|62)8\d{8,12}$/.test(t) && !/^\d{6}[A-Z0-9]{7,10}$/.test(t) && !all.includes(t)) all.push(t);
  }
  const known = all.filter((t) => RESI_PREFIX.test(t));
  return known.length ? known : all;
}

// Daftar resi Shopee: satu per baris, huruf besar, tanpa spasi.
export function parseResiList(raw) {
  const seen = new Set();
  return String(raw || '').split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, '').toUpperCase()).filter(Boolean)
    .map((resi) => {
      const dup = seen.has(resi);
      seen.add(resi);
      return { resi, dup, odd: !/^[A-Z0-9-]{8,25}$/.test(resi) };
    });
}
