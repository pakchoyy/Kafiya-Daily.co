// OCR di HP pakai Tesseract.js (gratis, tanpa API key; gambar tidak dikirim ke server).
// Pustaka dan data bahasa (~5 MB) diunduh sekali saat pertama dipakai, lalu di-cache.
const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading;

function loadLib() {
  if (window.Tesseract) return Promise.resolve();
  loading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SRC; s.onload = res;
    s.onerror = () => { loading = null; rej(new Error('Gagal memuat OCR. Perlu internet saat pertama kali.')); };
    document.head.append(s);
  });
  return loading;
}

export async function readImage(file, onProgress) {
  await loadLib();
  const { data } = await window.Tesseract.recognize(file, 'ind+eng', {
    logger: (m) => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100)),
  });
  return data.text;
}
