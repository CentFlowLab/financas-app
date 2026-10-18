// Importar extratos — carregamento (lazy, local) das bibliotecas SheetJS (Excel) e pdf.js (PDF). Offline: ficheiros em vendor/ pré-guardados no service worker.
import { linesFromItems } from './layout.js';
import { recognizeWords } from '../ocr.js';
import { prepareForOCR, loadBitmap } from '../image.js';
const here = (p) => new URL(p, import.meta.url).href;

let xlsxP;
export function loadXLSX() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return (xlsxP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = here('../../vendor/xlsx/xlsx.full.min.js');
    s.onload = () => (globalThis.XLSX ? res(globalThis.XLSX) : rej(new Error('Não foi possível carregar o leitor de Excel.')));
    s.onerror = () => { xlsxP = null; rej(new Error('Não foi possível carregar o leitor de Excel (sem ligação e ainda não guardado offline?).')); };
    document.head.appendChild(s);
  }));
}

export async function readWorkbook(bytes) {
  const X = await loadXLSX();
  try { return X.read(bytes, { type: 'array', cellDates: false }); } catch { throw new Error('Não foi possível ler este ficheiro Excel. Está protegido por palavra-passe ou danificado?'); }
}
const p2 = (n) => String(n).padStart(2, '0');
// Folha -> matriz de células (texto ou número); datas Excel convertidas para AAAA-MM-DD
export async function sheetRows(wb, index = 0) {
  const X = await loadXLSX();
  const ws = wb.Sheets[wb.SheetNames[index]];
  if (!ws || !ws['!ref']) return [];
  const rg = X.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const row = [];
    for (let c = rg.s.c; c <= rg.e.c; c++) {
      const cell = ws[X.utils.encode_cell({ r, c })];
      let v = '';
      if (cell) {
        if (cell.t === 'n' && cell.z && X.SSF.is_date(cell.z)) { const d = X.SSF.parse_date_code(cell.v); v = d ? `${d.y}-${p2(d.m)}-${p2(d.d)}` : String(cell.w ?? cell.v); }
        else if (cell.t === 'n') v = cell.v;
        else if (cell.t === 'd') v = cell.v.toISOString().slice(0, 10);
        else v = String(cell.w ?? cell.v ?? '').trim();
      }
      row.push(v);
    }
    if (row.some((x) => x !== '')) rows.push(row);
  }
  return rows;
}

// ---------- PDF ----------
async function openPdf(bytes) {
  const pdfjs = await import(/* @vite-ignore */ here('../../vendor/pdfjs/pdf.min.mjs')).catch(() => { throw new Error('Não foi possível carregar o leitor de PDF (sem ligação e ainda não guardado offline?).'); });
  pdfjs.GlobalWorkerOptions.workerSrc = here('../../vendor/pdfjs/pdf.worker.min.mjs');
  try { return await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise; }
  catch (e) { throw new Error(/password/i.test(e?.message || e?.name || '') ? 'Este PDF está protegido por palavra-passe.' : 'Não foi possível ler este PDF.'); }
}
// Itens de texto de uma página, na orientação dominante (texto rodado — margens verticais, marcas de água — é ignorado:
// mistura-se com as linhas da tabela e engole datas). Coordenadas: origem em baixo à esquerda (como no PDF).
const dirOf = (t) => { const a = Math.atan2(t[1], t[0]) * 180 / Math.PI; return Math.round(((a % 360) + 360) % 360 / 90) % 4; };
function pageItems(tc, dom) {
  return tc.items.filter((i) => i.str && i.str.trim() !== '' && dirOf(i.transform) === dom).map((i) => {
    const [e, f] = [i.transform[4], i.transform[5]];
    const [x, y] = dom === 0 ? [e, f] : dom === 1 ? [f, -e] : dom === 2 ? [-e, -f] : [-f, e];
    return { s: i.str, x, y, w: i.width, h: Math.abs(i.height) || Math.abs(i.transform[3]) || 10 };
  });
}
// orientação dominante do documento (só se o texto noutra direção for >3× o horizontal, o documento está rodado)
function dominantDir(tcs) {
  const w = [0, 0, 0, 0];
  for (const tc of tcs) for (const i of tc.items) if (i.str && i.str.trim()) w[dirOf(i.transform)] += i.str.length;
  const mx = Math.max(...w); return mx > w[0] * 3 && mx > 40 ? w.indexOf(mx) : 0;
}
// PDF -> linhas de texto com posições (agrupadas por coordenada vertical; células separadas por espaços largos).
// A matriz devolvida traz .numPages e .chars (nº de carateres de texto) para decidir se é preciso OCR.
export async function pdfLines(bytes) {
  const doc = await openPdf(bytes);
  const lines = []; let chars = 0; const pages = [];
  for (let p = 1; p <= doc.numPages; p++) { const page = await doc.getPage(p); pages.push({ page, tc: await page.getTextContent() }); }
  const dom = dominantDir(pages.map((x) => x.tc));
  pages.forEach(({ page, tc }, k) => {
    const vp = page.getViewport({ scale: 1 });
    const items = pageItems(tc, dom); chars += items.reduce((a, i) => a + i.s.length, 0);
    lines.push(...linesFromItems(items, k + 1, dom % 2 ? vp.height : vp.width, dom % 2 ? vp.width : vp.height));
  });
  await doc.destroy?.();
  lines.numPages = doc.numPages; lines.chars = chars;
  return lines;
}
// Páginas de um PDF digitalizado -> imagens (canvas -> Blob PNG), para OCR. máx. páginas limitado.
export async function renderPdfPages(bytes, { max = 12, width = 2000, onProgress = () => {} } = {}) {
  const doc = await openPdf(bytes);
  const out = [];
  const n = Math.min(doc.numPages, max);
  for (let p = 1; p <= n; p++) {
    onProgress(p, n);
    const page = await doc.getPage(p);
    const v1 = page.getViewport({ scale: 1 }); const scale = Math.min(4, Math.max(1.5, width / v1.width));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push({ blob: await new Promise((res) => c.toBlob(res, 'image/png')), w: c.width, h: c.height, page: p });
  }
  const total = doc.numPages;
  await doc.destroy?.();
  out.total = total;
  return out;
}

// ---------- OCR (digitalizações e fotos) ----------
// images: [{ blob, w, h, page }] -> linhas (mesma estrutura do PDF de texto), com a página normalizada para 595 pt de largura
export async function ocrLines(images, onProgress = () => {}) {
  const lines = [];
  for (let k = 0; k < images.length; k++) {
    const im = images[k]; const tag = images.length > 1 ? ` (página ${k + 1} de ${images.length})` : '';
    const words = await recognizeWords(im.blob, (p, st) => onProgress(`${st}${tag}`, (k + p) / images.length));
    const f = 595 / im.w;
    const items = words.filter((w) => w.conf >= 20 && String(w.text).trim()).map((w) => ({ s: w.text, x: w.x0 * f, y: (im.h - w.y1) * f, w: (w.x1 - w.x0) * f, h: Math.max(3, w.y1 - w.y0) * f }));
    lines.push(...linesFromItems(items, im.page ?? k + 1, 595, im.h * f));
  }
  lines.ocr = true; lines.chars = lines.reduce((a, l) => a + l.text.length, 0);
  return lines;
}
// Foto/captura de ecrã -> imagem preparada para OCR (cinzentos + contraste, ampliada se pequena)
export async function imageForOcr(file) {
  const blob = await prepareForOCR(file);
  const bmp = await loadBitmap(blob);
  return [{ blob, w: bmp.width, h: bmp.height, page: 1 }];
}
