// Importar extratos — carregamento (lazy, local) das bibliotecas SheetJS (Excel) e pdf.js (PDF). Offline: ficheiros em vendor/ pré-guardados no service worker.
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

// PDF -> linhas de texto com posições (agrupadas por coordenada vertical; células separadas por espaços largos)
export async function pdfLines(bytes) {
  const pdfjs = await import(/* @vite-ignore */ here('../../vendor/pdfjs/pdf.min.mjs')).catch(() => { throw new Error('Não foi possível carregar o leitor de PDF (sem ligação e ainda não guardado offline?).'); });
  pdfjs.GlobalWorkerOptions.workerSrc = here('../../vendor/pdfjs/pdf.worker.min.mjs');
  let doc;
  try { doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise; }
  catch (e) { throw new Error(/password/i.test(e?.message || e?.name || '') ? 'Este PDF está protegido por palavra-passe.' : 'Não foi possível ler este PDF.'); }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // texto rodado (margens verticais, marcas de água) é ignorado: mistura-se com as linhas da tabela e engole datas
    const items = tc.items.filter((i) => i.str && i.str.trim() !== '' && !(Math.abs(i.transform[1]) > Math.abs(i.transform[0]) * 0.5 || Math.abs(i.transform[2]) > Math.abs(i.transform[3]) * 0.5)).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.height) || Math.abs(i.transform[3]) || 10 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const groups = [];
    for (const it of items) {
      const g = groups.find((x) => Math.abs(x.y - it.y) <= Math.max(2, it.h * 0.4));
      if (g) g.items.push(it); else groups.push({ y: it.y, items: [it] });
    }
    groups.sort((a, b) => b.y - a.y);
    for (const g of groups) {
      g.items.sort((a, b) => a.x - b.x);
      const cells = [];
      for (const it of g.items) {
        const last = cells[cells.length - 1];
        const gap = last ? it.x - last.x2 : Infinity;
        if (last && gap < it.h * 0.15) { last.s += it.s; last.x2 = it.x + it.w; }
        else if (last && gap < it.h * 0.8) { last.s += ' ' + it.s; last.x2 = it.x + it.w; }
        else cells.push({ s: it.s, x: it.x, x2: it.x + it.w });
      }
      lines.push({ cells, text: cells.map((c) => c.s.trim()).join('  '), page: p });
    }
  }
  await doc.destroy?.();
  return lines;
}
