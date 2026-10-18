// Motor de OCR (tesseract.js, carregado só quando é preciso e servido localmente → funciona offline)
let worker = null, handler = () => {};
const abs = (p) => new URL(p, document.baseURI).href;

async function loadScript() {
  if (window.Tesseract) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/tesseract/tesseract.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Não foi possível carregar o motor de leitura (OCR).'));
    document.head.appendChild(s);
  });
}
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
async function getWorker() {
  if (worker) return worker;
  await loadScript();
  worker = await withTimeout(window.Tesseract.createWorker('por', 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract/'),
    langPath: abs('vendor/tesseract/lang'),
    gzip: true,
    logger: (m) => handler(m),
  }), 90000, 'O motor de leitura demorou demasiado a arrancar.').catch((e) => { worker = null; throw e; });
  return worker;
}
// onProgress(0..1, estado)
export async function recognize(blob, onProgress = () => {}) {
  handler = (m) => { if (m.status === 'recognizing text') onProgress(m.progress, 'A ler o texto…'); else onProgress(0, 'A preparar o motor de leitura…'); };
  onProgress(0, 'A preparar o motor de leitura…');
  const w = await getWorker();
  const { data } = await withTimeout(w.recognize(blob), 180000, 'A leitura demorou demasiado.');
  return data.text || '';
}
export const warmup = () => getWorker();
