// Importar extratos — análise (parsing) de ficheiros. Funções puras, sem DOM: descodificação, CSV, números e datas
// portugueses, deteção de cabeçalho/colunas, OFX, QIF e linhas de texto extraídas de PDF (melhor esforço).
import { norm } from '../util.js';

const cellStr = (c) => (c == null ? '' : String(c)).replace(/\u00a0|\u202f/g, ' ').trim();
export { cellStr };

// ---------- descodificação de texto ----------
export function decodeBytes(buf, force = 'auto') {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dec = (enc, fatal = false) => new TextDecoder(enc, { fatal }).decode(u8);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return { text: dec('utf-8').replace(/^\uFEFF/, ''), encoding: 'UTF-8' };
  if (u8[0] === 0xff && u8[1] === 0xfe) return { text: dec('utf-16le').replace(/^\uFEFF/, ''), encoding: 'UTF-16' };
  if (u8[0] === 0xfe && u8[1] === 0xff) return { text: dec('utf-16be').replace(/^\uFEFF/, ''), encoding: 'UTF-16' };
  if (force === 'utf-8') return { text: dec('utf-8'), encoding: 'UTF-8' };
  if (force === 'windows-1252') return { text: dec('windows-1252'), encoding: 'Windows-1252' };
  if (u8.length > 3 && u8[1] === 0 && u8[3] === 0 && u8[0] !== 0) return { text: dec('utf-16le'), encoding: 'UTF-16' };
  try { return { text: dec('utf-8', true), encoding: 'UTF-8' }; } catch { return { text: dec('windows-1252'), encoding: 'Windows-1252' }; }
}

// ---------- CSV ----------
export function countFields(line, d) {
  let n = 1, q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') i++; else if (q) q = false; else if (i === 0 || line[i - 1] === d) q = true; }
    else if (ch === d && !q) n++;
  }
  return n;
}
export function detectDelimiter(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 80);
  let best = ';', bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => countFields(l, d));
    const freq = new Map();
    for (const c of counts) if (c >= 2) freq.set(c, (freq.get(c) || 0) + 1);
    let c0 = 0, f0 = 0;
    for (const [c, f] of freq) if (f > f0 || (f === f0 && c > c0)) { c0 = c; f0 = f; }
    const score = f0 * 100 + c0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
export function parseCSV(text, delim = ';') {
  const rows = []; let row = [], f = '', q = false;
  const push = () => { row.push(f.trim()); f = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
    } else if (ch === '"' && f === '') q = true;
    else if (ch === delim) push();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; push(); if (row.some((c) => c !== '')) rows.push(row); row = []; }
    else f += ch;
  }
  if (f !== '' || row.length) { push(); if (row.some((c) => c !== '')) rows.push(row); }
  return rows;
}

// ---------- números (formato português e internacional) ----------
const CLEAN_CUR = /[€$£]|\b(?:EUR|USD|GBP)\b/gi;
export function detectDecimalStyle(samples) {
  let comma = 0, dot = 0;
  for (const v of samples) {
    if (typeof v === 'number') { if (!Number.isInteger(v)) dot++; continue; }
    const s = cellStr(v).replace(CLEAN_CUR, '').replace(/[\s']/g, '').replace(/^[-+(−–]+|[-+)]+$/g, '');
    const hc = s.includes(','), hd = s.includes('.');
    if (hc && hd) { if (s.lastIndexOf(',') > s.lastIndexOf('.')) comma++; else dot++; }
    else if (hc) { if (/,\d{1,2}$/.test(s) && s.split(',').length === 2) comma++; }
    else if (hd) { if (/\.\d{1,2}$/.test(s) && s.split('.').length === 2) dot++; }
  }
  return comma > dot ? 'comma' : dot > comma ? 'dot' : null;
}
// -> cêntimos (inteiro) ou NaN. style: 'comma' (1.234,56) | 'dot' (1,234.56) | null (automático)
export function parseAmount(v, style = null) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  let s = cellStr(v);
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  const mark = s.match(/(?<=[\d\s])\s*(DB|CR|D|C)\.?$/i);
  if (mark) { if (/^d/i.test(mark[1])) neg = true; s = s.slice(0, mark.index); }
  s = s.replace(CLEAN_CUR, '').replace(/[\s']/g, '');
  if (/[-−–]$/.test(s)) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/\+$/, '');
  if (/^[-−–]/.test(s)) { neg = true; s = s.slice(1); }
  s = s.replace(/^\+/, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
  const nc = (s.match(/,/g) || []).length, nd = (s.match(/\./g) || []).length;
  let dec = null;
  if (nc && nd) dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  else if (nc) dec = nc > 1 || style === 'dot' ? null : ',';
  else if (nd) {
    if (nd > 1 || style === 'comma') dec = null;
    else if (style === 'dot') dec = '.';
    else dec = /^\d{1,3}\.\d{3}$/.test(s) ? null : '.';
  }
  if (dec) { const i = s.lastIndexOf(dec); s = s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1).replace(/[.,]/g, ''); } else s = s.replace(/[.,]/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  const c = Math.round(n * 100 + 1e-9);
  return neg ? -c : c;
}

// ---------- datas ----------
const MONTHS = { jan: 1, janeiro: 1, fev: 2, feb: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, apr: 4, abril: 4, mai: 5, may: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, aug: 8, agosto: 8, set: 9, sep: 9, setembro: 9, out: 10, oct: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dec: 12, dezembro: 12 };
const p2 = (n) => String(n).padStart(2, '0');
function validISO(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${p2(m)}-${p2(d)}`;
}
export function excelSerialToISO(n) {
  const dt = new Date(Math.round((n - 25569) * 86400000));
  return validISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function detectDateOrder(samples) {
  let dmy = 0, mdy = 0;
  for (const v of samples) {
    const m = cellStr(v).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (!m) continue;
    if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}
export function parseDate(v, order = 'dmy') {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? excelSerialToISO(v) : null;
  const s = cellStr(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (m) return validISO(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/);
  if (m) {
    let y = +m[3]; if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    return order === 'mdy' ? validISO(y, +m[1], +m[2]) : validISO(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{0,6})(?:\[.*\])?$/);
  if (m) return validISO(+m[1], +m[2], +m[3]);
  m = norm(s).match(/^(\d{1,2})[ \-/.]*(?:de )?([a-z]{3,9})\.?[ \-/.,]*(?:de )?(\d{4}|\d{2})(?!\d)/);
  if (m && MONTHS[m[2]]) { let y = +m[3]; if (m[3].length === 2) y += 2000; return validISO(y, MONTHS[m[2]], +m[1]); }
  return null;
}

// ---------- IBAN / NIB / banco ----------
const mod97 = (digits) => { let r = 0; for (const ch of digits) r = (r * 10 + (ch.charCodeAt(0) - 48)) % 97; return r; };
export function nibToIban(nib) { const c = 98 - mod97(nib + '252900'); return 'PT' + p2(c) + nib; }
const ibanValid = (s) => { const t = s.slice(4) + s.slice(0, 4); return mod97(t.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55)) === 1; };
export function findIban(text) {
  const t = String(text || '');
  let m = t.match(/\bPT\d{2}(?:[ .-]?\d){21}\b/i);
  if (m) return m[0].replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  for (const g of t.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g)) {
    const c = g[0].replace(/ /g, '');
    if (c.length >= 15 && c.length <= 34 && ibanValid(c)) return c;
  }
  m = t.match(/(?<![\d])\d{4}[ .-]?\d{4}[ .-]?\d{11}[ .-]?\d{2}(?![\d])/);
  if (m) return nibToIban(m[0].replace(/\D/g, ''));
  return null;
}
// Chave estável de conta: IBAN (ou NIB convertido) em maiúsculas; senão texto normalizado
export function accountKey(s) {
  const raw = cellStr(s); if (!raw) return '';
  return findIban(raw) || norm(raw).replace(/\s+/g, ' ');
}
export const ibanPretty = (iban) => (iban || '').replace(/(.{4})/g, '$1 ').trim();

export const BANKS = [ // heurística por texto/nome do ficheiro — só para sugerir nomes; a leitura é sempre genérica
  { id: 'cgd', nome: 'CGD', re: /caixa geral|\bcgd\b|caixadirecta|caixa ?direta/ },
  { id: 'millennium', nome: 'Millennium bcp', re: /millennium|\bbcp\b/ },
  { id: 'novobanco', nome: 'Novo Banco', re: /novo ?banco/ },
  { id: 'santander', nome: 'Santander', re: /santander/ },
  { id: 'bpi', nome: 'BPI', re: /\bbpi\b/ },
  { id: 'activobank', nome: 'ActivoBank', re: /activo ?bank/ },
  { id: 'moey', nome: 'Moey!', re: /moey/ },
  { id: 'revolut', nome: 'Revolut', re: /revolut/ },
  { id: 'n26', nome: 'N26', re: /\bn26\b/ },
  { id: 'traderepublic', nome: 'Trade Republic', re: /trade ?republic/ },
  { id: 'wise', nome: 'Wise', re: /\bwise\b|transferwise/ },
  { id: 'montepio', nome: 'Montepio', re: /montepio/ },
];
export function detectBank(text, headerText = '') {
  const t = norm(text);
  for (const b of BANKS) if (b.re.test(t)) return b;
  const h = norm(headerText);
  if (/started date/.test(h) && /completed date/.test(h)) return BANKS.find((b) => b.id === 'revolut');
  if (/partner name/.test(h) && /booking date/.test(h)) return BANKS.find((b) => b.id === 'n26');
  if (/transferwise id|running balance/.test(h)) return BANKS.find((b) => b.id === 'wise');
  return null;
}
export function guessAccountType(text) {
  const t = norm(text);
  if (/cartao|credito|visa|mastercard|credit card|card/.test(t) && !/debito/.test(t)) return 'cartao';
  if (/poupanca|savings|aforro|deposito a prazo/.test(t)) return 'poupanca';
  return 'ordem';
}

// Metadados do cabeçalho do extrato (linhas antes da tabela): IBAN/NIB, nº de conta, banco
export function extractMeta(preRows, fileName = '', headerText = '') {
  const lines = preRows.map((r) => r.map(cellStr).filter(Boolean).join(' ')).filter(Boolean);
  const text = lines.join('\n');
  const meta = { iban: findIban(text), acctNo: null, bank: null, title: '' };
  const m = norm(text).match(/(?:numero da conta|n\.? ?conta|conta|account number|account)\s*[:;]?\s*(\d[\d .-]{5,24}\d)/);
  if (m) meta.acctNo = m[1].replace(/\D/g, '');
  meta.bank = detectBank(text + ' ' + fileName, headerText);
  meta.title = lines[0] || '';
  return meta;
}

// ---------- cabeçalhos e deteção automática de colunas ----------
export const hclean = (s) => norm(s).replace(/[._:;()[\]/€*#"-]/g, ' ').replace(/\s+/g, ' ').trim();
export function classifyHeader(h) {
  const n = hclean(cellStr(h));
  if (!n || n.length > 60) return null;
  if (/\bdata\b|\bdate\b|\bdatum\b|\bdatetime\b/.test(n) && !/nasc|venc|valid/.test(n)) {
    let p = 2;
    if (/\bvalor\b|\bvalue\b/.test(n)) p = 1;
    else if (/mov|operac|lancamento|contab|booking|completed|transaction|transacao|posted|registo|efet|efect/.test(n)) p = 3;
    else if (/start/.test(n)) p = 1.5;
    return { role: 'data', p };
  }
  if (/saldo|balance/.test(n)) return { role: 'saldo', p: /contab|running|ledger/.test(n) ? 3 : /dispon|avail/.test(n) ? 1 : 2 };
  if (/original|\borig\b|exchange|cambio/.test(n)) return null;
  if (/\bdebito\b|\bdebit\b|\bsaidas?\b|\bdespesas?\b|\blevantamentos?\b|withdraw|paid out|money out/.test(n)) return { role: 'debito', p: 2 };
  if (/\bcredito\b|\bcredit\b|\bentradas?\b|\bdepositos?\b|\breceitas?\b|paid in|money in/.test(n)) return { role: 'credito', p: 2 };
  if (/^fees?$|^comiss(ao|oes)$/.test(n)) return { role: 'fee', p: 2 };
  if (/currency|moeda|divisa/.test(n)) return { role: 'moeda', p: 2 };
  if (/^(state|status|estado|situacao)$/.test(n)) return { role: 'estado', p: 2 };
  if ((/iban|nib|conta|account/.test(n)) && /partner|benefici|destin|counter|contrap|origem|merchant/.test(n)) return null;
  if (/\biban\b|\bnib\b|\bconta\b|\baccount\b|n conta|numero (da )?conta/.test(n)) return { role: 'conta', p: /iban|nib/.test(n) ? 3 : 2 };
  if (/\bmontante\b|\bvalor\b|\bimporte\b|\bamount\b|\bquantia\b|\bimport\b/.test(n)) return { role: 'valor', p: 2 };
  if (/descri|designa|description/.test(n)) return { role: 'desc', p: 3 };
  if (/movimento|narrativa|\bmemo\b|detalhe|detail|historico/.test(n)) return { role: 'desc', p: 2.5 };
  if (/payee|merchant|partner name|\bname\b|\bnome\b|beneficiario/.test(n)) return { role: 'desc', p: 2 };
  if (/referencia|reference|texto|observa/.test(n)) return { role: 'desc', p: 1 };
  return null;
}

export function findHeader(rows) {
  let best = -1, bs = 0;
  const lim = Math.min(rows.length - 1, 80);
  for (let i = 0; i < lim; i++) {
    const cells = rows[i].map(cellStr).filter(Boolean);
    if (cells.length < 2) continue;
    if (cells.filter((c) => parseDate(c) || !Number.isNaN(parseAmount(c))).length > cells.length / 2) continue;
    const roles = new Set();
    for (const c of rows[i]) { const k = classifyHeader(c); if (k) roles.add(k.role); }
    if (roles.size < 2) continue;
    const score = roles.size + (roles.has('data') ? 2 : 0) + (roles.has('valor') || roles.has('debito') || roles.has('credito') ? 1 : 0);
    if (score > bs && (roles.has('data') || roles.size >= 3)) { best = i; bs = score; }
  }
  return best;
}

const sampleCol = (rows, i, n = 300) => rows.slice(0, n).map((r) => r[i]).filter((v) => cellStr(v) !== '');
const dateScore = (vals, order) => (vals.length ? vals.filter((v) => parseDate(v, order)).length / vals.length : 0);
const numScore = (vals, style) => (vals.length ? vals.filter((v) => !Number.isNaN(parseAmount(v, style))).length / vals.length : 0);

export const EMPTY_MAP = () => ({ headerRow: -1, data: -1, desc: -1, desc2: -1, modo: 'single', valor: -1, debito: -1, credito: -1, saldo: -1, conta: -1, fee: -1, moeda: -1, estado: -1, inverter: false, decimal: 'auto', dateOrder: 'auto' });

export function autoMap(rows, forcedHeader) {
  const map = EMPTY_MAP();
  const h = forcedHeader !== undefined ? forcedHeader : findHeader(rows);
  map.headerRow = h;
  const body = rows.slice(h + 1);
  const ncols = rows.reduce((a, r) => Math.max(a, r.length), 0);
  const cand = {};
  if (h >= 0) rows[h].forEach((c, i) => { const k = classifyHeader(c); if (k) (cand[k.role] ||= []).push({ i, p: k.p }); });
  const best = (role, ok = () => true) => (cand[role] || []).filter((c) => ok(c.i)).sort((a, b) => b.p - a.p || a.i - b.i)[0]?.i ?? -1;
  const cols = Array.from({ length: ncols }, (_, i) => sampleCol(body, i));
  const order = detectDateOrder(cols.flat());
  const style = detectDecimalStyle(cols.flatMap((c, i) => (cand.valor || cand.debito || cand.credito || cand.saldo || []).some((x) => x.i === i) ? c : []));
  const dScore = cols.map((c) => dateScore(c, order));
  const nScore = cols.map((c) => numScore(c, style));
  const used = new Set();
  const take = (role, ok) => { const i = best(role, (j) => !used.has(j) && (!ok || ok(j))); if (i >= 0) used.add(i); return i; };
  map.data = take('data', (j) => dScore[j] >= 0.5);
  if (map.data < 0) { let bi = -1, bs = 0.5; dScore.forEach((s, j) => { if (s > bs + 1e-9) { bs = s; bi = j; } }); if (bi >= 0) { map.data = bi; used.add(bi); } }
  map.valor = take('valor', (j) => nScore[j] >= 0.5);
  map.debito = take('debito', (j) => nScore[j] >= 0.3 || cols[j].length === 0);
  map.credito = take('credito', (j) => nScore[j] >= 0.3 || cols[j].length === 0);
  map.saldo = take('saldo', (j) => nScore[j] >= 0.5);
  map.desc = take('desc');
  map.conta = take('conta', (j) => new Set(cols[j]).size <= 25 && cols[j].length > 0);
  map.fee = take('fee', (j) => nScore[j] >= 0.3);
  map.moeda = take('moeda'); map.estado = take('estado');
  // 2.ª coluna de descrição (referência/beneficiário) quando existe e não é numérica
  const d2 = (cand.desc || []).filter((c) => !used.has(c.i) && /^(payment reference|referencia|reference|memo|payee|partner name)$/.test(hclean(rows[h][c.i])) && nScore[c.i] < 0.5).sort((a, b) => b.p - a.p)[0];
  if (d2 && map.desc >= 0) { map.desc2 = d2.i; used.add(d2.i); }
  if (h < 0) { // sem cabeçalho: deduzir pelo conteúdo
    const nums = cols.map((c, i) => ({ i, s: nScore[i], n: c.length })).filter((x) => !used.has(x.i) && x.s >= 0.7 && x.n >= Math.max(1, body.length * 0.3));
    const txt = cols.map((c, i) => ({ i, len: c.reduce((a, v) => a + cellStr(v).length, 0) / (c.length || 1), s: nScore[i], d: dScore[i] })).filter((x) => !used.has(x.i) && x.s < 0.3 && x.d < 0.3).sort((a, b) => b.len - a.len);
    if (txt[0]) map.desc = txt[0].i;
    if (nums.length >= 3 && nums[0].n < body.length * 0.8 && nums[1].n < body.length * 0.8) { map.debito = nums[0].i; map.credito = nums[1].i; map.saldo = nums[nums.length - 1].i; }
    else if (nums.length >= 2) { map.valor = nums[0].i; map.saldo = nums[nums.length - 1].i; }
    else if (nums.length === 1) map.valor = nums[0].i;
  }
  map.modo = map.debito >= 0 && map.credito >= 0 ? 'split' : map.valor >= 0 ? 'single' : map.debito >= 0 || map.credito >= 0 ? 'split' : 'single';
  return map;
}

const SKIP_STATE = /reverted|pending|declined|failed|cancel|pendente|recusad|rejeitad/i;
// Aplica o mapeamento às linhas da tabela -> movimentos normalizados
export function applyMapping(rows, map) {
  const body = rows.slice(map.headerRow + 1);
  const g = (r, i) => (i >= 0 ? r[i] : undefined);
  const vals = (i) => (i >= 0 ? body.map((r) => r[i]).filter((v) => cellStr(v) !== '') : []);
  const style = map.decimal === 'auto' ? detectDecimalStyle([...vals(map.valor), ...vals(map.debito), ...vals(map.credito), ...vals(map.saldo)]) : map.decimal;
  const order = map.dateOrder === 'auto' ? detectDateOrder(vals(map.data)) : map.dateOrder;
  const out = [], ignored = [];
  body.forEach((r, k) => {
    const line = map.headerRow + 2 + k;
    const data = map.data >= 0 ? parseDate(g(r, map.data), order) : null;
    if (!data) { if (r.some((c) => cellStr(c))) ignored.push({ line, motivo: 'sem data válida', cells: r }); return; }
    if (map.estado >= 0 && SKIP_STATE.test(cellStr(g(r, map.estado)))) { ignored.push({ line, motivo: 'estado: ' + cellStr(g(r, map.estado)), cells: r }); return; }
    let valor;
    if (map.modo === 'split') {
      const d = map.debito >= 0 ? parseAmount(g(r, map.debito), style) : NaN, c = map.credito >= 0 ? parseAmount(g(r, map.credito), style) : NaN;
      if (Number.isNaN(d) && Number.isNaN(c)) { ignored.push({ line, motivo: 'sem valor', cells: r }); return; }
      valor = (Number.isNaN(c) ? 0 : Math.abs(c)) - (Number.isNaN(d) ? 0 : Math.abs(d));
    } else {
      valor = map.valor >= 0 ? parseAmount(g(r, map.valor), style) : NaN;
      if (Number.isNaN(valor)) { ignored.push({ line, motivo: 'sem valor', cells: r }); return; }
    }
    if (map.fee >= 0) { const f = parseAmount(g(r, map.fee), style); if (!Number.isNaN(f)) valor -= Math.abs(f); }
    if (map.inverter) valor = -valor;
    if (valor === 0) { ignored.push({ line, motivo: 'valor zero', cells: r }); return; }
    const sd = map.saldo >= 0 ? parseAmount(g(r, map.saldo), style) : NaN;
    const d1 = cellStr(g(r, map.desc)).replace(/\s+/g, ' '), d2 = cellStr(g(r, map.desc2)).replace(/\s+/g, ' ');
    const desc = d1 && d2 && !d1.includes(d2) ? `${d1} · ${d2}` : d1 || d2;
    const contaTxt = cellStr(g(r, map.conta));
    out.push({ data, desc, valor, saldo: Number.isNaN(sd) ? null : sd, contaKey: accountKey(contaTxt), contaLabel: contaTxt, moeda: cellStr(g(r, map.moeda)).toUpperCase() || null, linha: line });
  });
  return { rows: out, ignored, style, order };
}

// Tabela -> ficheiro analisado (para CSV/Excel)
export function tableToParsed(rows, map, fileName, extra = {}) {
  const { rows: items, ignored } = applyMapping(rows, map);
  const pre = rows.slice(0, map.headerRow >= 0 ? map.headerRow : Math.min(rows.length, 15));
  const headerText = map.headerRow >= 0 ? rows[map.headerRow].join(' ') : '';
  const meta = extractMeta(pre, fileName, headerText);
  const warnings = [];
  const foreign = items.filter((r) => r.moeda && r.moeda !== 'EUR').length;
  if (foreign) warnings.push(`${foreign} linha(s) noutra moeda que não EUR — confirme os valores.`);
  return { rows: items, ignored, meta, warnings, ...extra };
}

// ---------- OFX ----------
const ofxTag = (b, n) => { const m = b.match(new RegExp('<' + n + '>\\s*([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
export function ofxCharset(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 600));
  if (/CHARSET:\s*1252|CHARSET:\s*ISO-8859-1|CHARSET:\s*8859-1/i.test(head)) return 'windows-1252';
  if (/ENCODING:\s*UTF-?8/i.test(head)) return 'utf-8';
  return 'auto';
}
const ofxAmt = (s) => { let t = s.replace(/\s/g, ''); if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.'); else t = t.replace(/,/g, ''); const n = parseFloat(t); return Number.isFinite(n) ? Math.round(n * 100 + (n < 0 ? -1e-9 : 1e-9)) : NaN; };
export function parseOFX(text) {
  const stm = [...text.matchAll(/<(STMTRS|CCSTMTRS)>([\s\S]*?)<\/\1>/gi)].map((m) => ({ kind: m[1].toUpperCase(), body: m[2] }));
  if (!stm.length && /<STMTTRN>/i.test(text)) stm.push({ kind: 'STMTRS', body: text });
  const rows = [], accounts = {}, warnings = [];
  stm.forEach((s, si) => {
    const acctId = ofxTag(s.body, 'ACCTID'), bankId = ofxTag(s.body, 'BANKID');
    const iban = findIban(acctId) || (/^\d{21}$/.test(acctId) ? nibToIban(acctId) : null) || findIban(s.body);
    const key = iban || norm(`${bankId} ${acctId}`) || `ofx-${si + 1}`;
    const lb = s.body.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|$)/i);
    const ledger = lb ? { valor: ofxAmt(ofxTag(lb[1], 'BALAMT')), data: parseDate(ofxTag(lb[1], 'DTASOF').slice(0, 8)) } : null;
    accounts[key] = { key, iban, acctNo: acctId || null, label: acctId, tipo: s.kind === 'CCSTMTRS' || /CREDITLINE|CREDIT/i.test(ofxTag(s.body, 'ACCTTYPE')) ? 'cartao' : /SAVINGS/i.test(ofxTag(s.body, 'ACCTTYPE')) ? 'poupanca' : 'ordem', ledger: ledger && !Number.isNaN(ledger.valor) ? ledger : null, moeda: ofxTag(s.body, 'CURDEF') };
    for (const t of s.body.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi)) {
      const b = t[1];
      const data = parseDate(ofxTag(b, 'DTPOSTED').slice(0, 8)), valor = ofxAmt(ofxTag(b, 'TRNAMT'));
      if (!data || Number.isNaN(valor) || valor === 0) { warnings.push('Transação OFX ignorada (data ou valor inválidos).'); continue; }
      const name = ofxTag(b, 'NAME'), memo = ofxTag(b, 'MEMO');
      const desc = (name && memo && !memo.toLowerCase().includes(name.toLowerCase()) ? `${name} · ${memo}` : name || memo).replace(/\s+/g, ' ');
      const fit = ofxTag(b, 'FITID');
      rows.push({ data, desc, valor, saldo: null, contaKey: key, contaLabel: acctId, extId: fit ? `${key}|${fit}` : null });
    }
  });
  const first = Object.values(accounts)[0];
  return { rows, accounts, meta: { iban: first?.iban || null, acctNo: first?.acctNo || null, bank: detectBank(text.slice(0, 2000)), title: '' }, warnings, ignored: [] };
}

// ---------- QIF ----------
export function parseQIF(text) {
  const lines = text.split(/\r\n|\n|\r/);
  const ents = []; let cur = {}, acct = '', section = '', accts = {};
  for (const ln of lines) {
    if (!ln) continue;
    const c = ln[0], v = ln.slice(1).trim();
    if (c === '!') { section = ln.slice(1).trim().toLowerCase(); continue; }
    if (section === 'account') { if (c === 'N') { acct = v; accts[v] = true; } if (c === '^') { /* fim de conta */ } continue; }
    if (c === '^') { if (cur.D && cur.T !== undefined) ents.push({ ...cur, acct }); cur = {}; continue; }
    if ('DTUPMNLC'.includes(c)) { if (c === 'U' && cur.T !== undefined) continue; cur[c === 'U' ? 'T' : c] = v; }
  }
  if (cur.D && cur.T !== undefined) ents.push({ ...cur, acct });
  const order = detectDateOrder(ents.map((e) => e.D.replace(/'/g, '/')));
  const style = detectDecimalStyle(ents.map((e) => e.T));
  const rows = [], warnings = [];
  for (const e of ents) {
    const data = parseDate(e.D.replace(/'/g, '/').replace(/\s/g, ''), order), valor = parseAmount(e.T, style);
    if (!data || Number.isNaN(valor) || valor === 0) { warnings.push('Entrada QIF ignorada (data ou valor inválidos).'); continue; }
    const desc = [e.P, e.M].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ').replace(/\s+/g, ' ');
    rows.push({ data, desc, valor, saldo: null, contaKey: e.acct ? norm(e.acct) : '', contaLabel: e.acct || '' });
  }
  return { rows, meta: { iban: null, acctNo: null, bank: null, title: '' }, warnings, ignored: [] };
}

// ---------- cadeia de saldos: valida (e corrige o sinal de) movimentos usando a coluna «Saldo» ----------
// rows em ordem do ficheiro; opening = saldo antes do 1.º movimento cronológico (ex.: «Saldo Inicial»), se conhecido.
// Regra: saldo(n) = saldo(n-1) + valor(n). Se |diferença| = |valor| mas o sinal é o contrário, o sinal é corrigido.
export function validateChain(rows, opening = null) {
  const n = rows.length;
  const run = (asc, apply) => {
    let ok = 0, fixed = 0, broken = 0, checked = 0;
    let prev = opening;
    for (let k = 0; k < n; k++) {
      const r = rows[asc ? k : n - 1 - k];
      if (r.saldo == null) { prev = prev == null ? null : prev + r.valor; continue; }
      if (prev != null) {
        const exp = r.saldo - prev; checked++;
        if (exp === r.valor) { ok++; if (apply) { r.semSinal = false; r.cadeia = 'ok'; } }
        else if (exp !== 0 && Math.abs(exp) === Math.abs(r.valor)) { fixed++; if (apply) { if (!r.semSinal) r.sinalCorrigido = true; r.valor = exp; r.semSinal = false; r.cadeia = 'ok'; } }
        else { broken++; if (apply) r.cadeia = 'quebrada'; }
      }
      prev = r.saldo;
    }
    return { ok, fixed, broken, checked };
  };
  if (!rows.some((r) => r.saldo != null)) return { asc: true, ok: 0, fixed: 0, broken: 0, checked: 0, inferidos: 0 };
  const a = run(true, false), d = run(false, false);
  const sa = a.ok + a.fixed, sd = d.ok + d.fixed;
  let asc = sa >= sd;
  if (sa === sd && n > 1) asc = rows[0].data <= rows[n - 1].data;
  const before = rows.filter((r) => r.semSinal).length;
  const res = run(asc, true);
  return { asc, ...res, inferidos: before - rows.filter((r) => r.semSinal).length };
}

// ---------- saldos: abertura e final a partir da coluna de saldo ----------
export function balanceInfo(rows, ledger = null) {
  const sum = (a) => a.reduce((x, r) => x + r.valor, 0);
  if (ledger && ledger.valor != null) return { final: ledger.valor, opening: ledger.valor - sum(rows), asc: true, fonte: 'ledger' };
  const withBal = rows.filter((r) => r.saldo != null);
  if (!withBal.length) return null;
  const idx = rows.map((r, i) => (r.saldo != null ? i : -1)).filter((i) => i >= 0);
  const score = (asc) => { let ok = 0; for (let k = 1; k < idx.length; k++) { const a = rows[idx[k - 1]], b = rows[idx[k]]; if (asc ? b.saldo - a.saldo === b.valor : a.saldo - b.saldo === a.valor) ok++; } return ok; };
  let asc = score(true) >= score(false);
  if (score(true) === score(false)) asc = rows[0].data <= rows[rows.length - 1].data;
  const chrono = asc ? rows : [...rows].reverse();
  const k = chrono.findIndex((r) => r.saldo != null), l = chrono.length - 1 - [...chrono].reverse().findIndex((r) => r.saldo != null);
  const opening = chrono[k].saldo - sum(chrono.slice(0, k + 1));
  const final = chrono[l].saldo + sum(chrono.slice(l + 1));
  return { final, opening, asc, fonte: 'saldo' };
}
