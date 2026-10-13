// Barcode Code 128 (set B) tanpa pustaka: teks -> deret lebar batang/spasi.
const P = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
export const PATTERNS = P;

// Kembalikan string lebar modul, mis. "2112..."; null kalau ada karakter di luar ASCII 32–126.
export function code128(text) {
  const vals = [104];
  for (const ch of String(text)) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) return null;
    vals.push(c - 32);
  }
  const check = vals.reduce((s, v, i) => s + v * (i || 1), 0) % 103;
  return [...vals, check, 106].map((v) => P[v]).join('');
}

// Batang hitam sebagai daftar [x, lebar] dalam satuan modul, plus total lebar.
export function bars(text) {
  const w = code128(text);
  if (!w) return null;
  const out = []; let x = 0;
  [...w].forEach((d, i) => { const n = Number(d); if (i % 2 === 0) out.push([x, n]); x += n; });
  return { bars: out, width: x };
}

export function barcodeSVG(text) {
  const b = bars(text);
  if (!b) return '';
  return `<svg class="lb-bar" viewBox="0 0 ${b.width} 10" preserveAspectRatio="none">${b.bars.map(([x, w]) => `<rect x="${x}" y="0" width="${w}" height="10"/>`).join('')}</svg>`;
}

export function drawBarcode(ctx, text, x, y, w, h) {
  const b = bars(text);
  if (!b) return;
  const k = w / b.width;
  for (const [bx, bw] of b.bars) ctx.fillRect(x + bx * k, y, bw * k, h);
}
