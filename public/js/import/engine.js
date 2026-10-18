// Importar extratos — motor: leitura de ficheiros, contas, duplicados, transferências, gravação e anulação.
import { S, save } from '../db.js';
import { uid, norm } from '../util.js';
import { accountBalance } from '../model.js';
import { hclean, decodeBytes, detectDelimiter, parseCSV, autoMap, tableToParsed, parseOFX, ofxCharset, parseQIF, balanceInfo, ibanPretty, guessAccountType } from './parse.js';
import { parseStatementLines, surveyLines } from './pdfstatement.js';
import { readWorkbook, sheetRows, pdfLines, renderPdfPages, ocrLines, imageForOcr } from './loaders.js';
import { aiRequest, extractJson, aiToParsed } from './ai.js';
import { categorize, learn } from './categorize.js';

export const FORMATOS = { csv: 'CSV', xlsx: 'Excel', ofx: 'OFX', qif: 'QIF', pdf: 'PDF', img: 'Imagem' };
export const ACEITA = '.csv,.txt,.tsv,.xlsx,.xls,.ofx,.qfx,.qif,.pdf,text/csv,application/pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function sha256hex(bytes) {
  try {
    if (globalThis.crypto?.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { /* contexto não seguro: usa alternativa */ }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) { h1 = Math.imul(h1 ^ bytes[i], 2654435761); h2 = Math.imul(h2 ^ bytes[i], 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'f' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0') + bytes.length.toString(16);
}

function sniff(bytes, name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const head = String.fromCharCode(...bytes.slice(0, 8));
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('\x89PNG') || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) || (head.startsWith('RIFF') && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')) return 'img';
  if (head.startsWith('PK\x03\x04') || head.startsWith('\xd0\xcf\x11\xe0')) return 'xlsx';
  const txt = new TextDecoder('latin1').decode(bytes.slice(0, 3000));
  if (/OFXHEADER|<OFX>/i.test(txt)) return 'ofx';
  if (/^\s*!(Type|Account|Option)/im.test(txt)) return 'qif';
  if (['ofx', 'qfx'].includes(ext)) return 'ofx';
  if (ext === 'qif') return 'qif';
  if (['xlsx', 'xls', 'xlsm'].includes(ext)) return 'xlsx';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'img';
  return 'csv';
}

// Lê o ficheiro e prepara a análise. src.opts: { encoding, delim, sheet } (alteráveis no passo "Colunas")
export async function loadSource(file, { onProgress } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) throw new Error('O ficheiro está vazio.');
  const src = { name: file.name, size: bytes.length, bytes, hash: await sha256hex(bytes), format: sniff(bytes, file.name), opts: { encoding: 'auto', delim: 'auto', sheet: 0 }, onProgress };
  await prepare(src, true);
  return src;
}

export async function prepare(src, resetMap = true) {
  src.error = null; src.parsed = null;
  if (src.format === 'csv') {
    const dec = decodeBytes(src.bytes, src.opts.encoding);
    src.encoding = dec.encoding;
    if (/[\u0000-\u0008]/.test(dec.text.slice(0, 2000))) throw new Error('Este ficheiro não parece ser de texto (CSV). Se for Excel ou PDF, use a extensão correta.');
    src.delim = src.opts.delim === 'auto' ? detectDelimiter(dec.text) : src.opts.delim;
    src.table = { rows: parseCSV(dec.text, src.delim) };
  } else if (src.format === 'xlsx') {
    src.wb ||= await readWorkbook(src.bytes);
    src.sheets = src.wb.SheetNames;
    src.table = { rows: await sheetRows(src.wb, Math.min(src.opts.sheet, src.sheets.length - 1)) };
  } else if (src.format === 'ofx') {
    const dec = decodeBytes(src.bytes, ofxCharset(src.bytes));
    src.encoding = dec.encoding;
    src.parsed = parseOFX(dec.text);
    if (!src.parsed.rows.length) throw new Error('Não foram encontradas transações neste ficheiro OFX.');
  } else if (src.format === 'qif') {
    const dec = decodeBytes(src.bytes, 'auto');
    src.encoding = dec.encoding;
    src.parsed = parseQIF(dec.text);
    if (!src.parsed.rows.length) throw new Error('Não foram encontradas transações neste ficheiro QIF.');
  } else if (src.format === 'pdf' || src.format === 'img') {
    await readVisual(src);
    analyseVisual(src);
  }
  if (src.table && resetMap) { src.map = autoMap(src.table.rows); src.autoMapJson = JSON.stringify(src.map); applySavedTable(src); }
  return src;
}

// ---------- PDF / imagem: leitura de texto (ou OCR) e análise ----------
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
async function readVisual(src) {
  if (src.lines) return;
  const prog = (m, f = 0) => src.onProgress?.(m, f);
  let lines;
  if (src.format === 'pdf') {
    prog('A ler o PDF…', 0);
    lines = await pdfLines(src.bytes);
    if ((lines.chars || 0) < 60) { // sem texto selecionável: digitalização -> OCR
      src.ocr = true;
      prog('Este PDF é uma imagem: a preparar o reconhecimento de texto (OCR)…', 0.05);
      const imgs = await renderPdfPages(src.bytes, { max: 12 });
      if (imgs.total > imgs.length) src.aviso = `Só foram lidas as primeiras ${imgs.length} de ${imgs.total} páginas (limite do OCR).`;
      lines = await ocrLines(imgs, prog);
    }
  } else {
    src.ocr = true;
    const sig = src.bytes[0] === 0x89 ? 'png' : src.bytes[0] === 0xff ? 'jpg' : 'webp';
    prog('A preparar a imagem…', 0.02);
    const imgs = await imageForOcr(new Blob([src.bytes], { type: MIME[sig] }));
    lines = await ocrLines(imgs, prog);
  }
  src.lines = lines;
}

export const parseVisual = (src, o = {}) => parseStatementLines(src.lines, src.name, { ocr: !!src.ocr, ...o });

export function analyseVisual(src) {
  const lines = src.lines;
  const sv = surveyLines(lines); src.survey = sv;
  let parsed = parseVisual(src, { layouts: src.semGuardado ? null : S.settings.importLayouts, layout: src.manual || null });
  src.guardadoFalhou = false;
  if (parsed.usadoGuardado && (!parsed.rows.length || parsed.confianca.nivel === 'baixa')) { // layout guardado já não serve: deteção automática
    const p2 = parseVisual(src);
    if (p2.rows.length >= parsed.rows.length) { parsed = p2; src.guardadoFalhou = true; parsed.warnings.unshift('O layout guardado deste banco não funcionou neste extrato; usei a deteção automática.'); }
  }
  src.parsed = parsed;
  if (!parsed.rows.length) {
    if (parsed.debts?.length) throw new Error('Este PDF só tem secções de crédito/empréstimo e nenhuma tabela de movimentos de uma conta. Para registar o crédito, crie a dívida em «Dívidas».');
    if (sv.candidatas < 2 && !sv.cabecalhos) {
      throw new Error(src.ocr
        ? 'Não consegui reconhecer um extrato nesta imagem (nem datas nem valores em tabela). Experimente uma foto mais nítida e direita, ou exporte o extrato em CSV, Excel ou OFX.'
        : 'Este PDF não parece ser um extrato bancário: não encontrei movimentos (datas com valores) nem cabeçalhos de tabela. Se for um extrato, exporte-o em CSV, Excel ou OFX no homebanking.');
    }
  }
  parsed.bestEffort = true;
  if (src.ocr) parsed.warnings.unshift('Texto lido por OCR (reconhecimento ótico de imagem) — melhor esforço: números e datas podem ter erros. Confirme todos os movimentos antes de importar.');
  else parsed.warnings.unshift('Leitura de PDF em modo «melhor esforço»: os extratos de cada banco são diferentes. Reveja cuidadosamente todos os movimentos antes de importar.');
  if (src.aviso) parsed.warnings.push(src.aviso);
  return parsed;
}

// Reanálise depois de o utilizador ajustar colunas/formatos à mão
export function applyManualLayout(src, layout) { src.manual = layout; src.excluded = new Set(); src.useAi = false; return analyseVisual(src); }

// ---------- interpretação com IA (opcional, pedida pelo utilizador) ----------
export const aiAvailable = () => !!S.settings.ia?.chave;
export const aiHost = () => { try { return new URL(S.settings.ia.url).host; } catch { return S.settings.ia?.url || 'o serviço configurado'; } };
export async function interpretWithAI(src, { signal } = {}) {
  const { content, truncado } = await aiRequest({ lines: src.lines, fileName: src.name, ia: S.settings.ia, signal });
  const parsed = aiToParsed(extractJson(content), { base: src.parsed, truncado });
  src.aiParsed = parsed; src.useAi = true; src.excluded = new Set();
  return parsed;
}

export const isTable = (src) => !!src.table;
export function getParsed(src) {
  if (src.table) return tableToParsed(src.table.rows, src.map, src.name);
  const base = src.useAi && src.aiParsed ? src.aiParsed : src.parsed;
  if (!src.excluded?.size) return base;
  return { ...base, rows: base.rows.filter((r) => !src.excluded.has(r.contaKey || '')), accounts: Object.fromEntries(Object.entries(base.accounts || {}).filter(([k]) => !src.excluded.has(k))) };
}

// ---------- layouts memorizados (PDF/imagem e CSV/Excel) ----------
const hashS = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const LAY = () => (S.settings.importLayouts ||= {});
export function listLayouts() {
  const seen = new Set(), out = [];
  for (const [k, v] of Object.entries(LAY())) { const id = (v.keys || [k]).join('|'); if (seen.has(id)) continue; seen.add(id); out.push({ id: k, nome: v.nome || 'Layout guardado', kind: v.kind || 'pdf', quando: v.quando || '' }); }
  return out;
}
export async function forgetLayout(id) {
  const v = LAY()[id]; if (!v) return;
  for (const k of v.keys || [id]) delete LAY()[k];
  await save('settings');
}
async function storeLayout(keys, entry) {
  keys = [...new Set(keys.filter(Boolean))]; if (!keys.length) return false;
  const e = { ...entry, keys, quando: new Date().toISOString().slice(0, 10) };
  for (const k of keys) LAY()[k] = e;
  const all = listLayouts().sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
  for (const old of all.slice(0, Math.max(0, all.length - 30))) { for (const k of LAY()[old.id]?.keys || [old.id]) delete LAY()[k]; }
  await save('settings');
  return true;
}
// PDF/imagem: guarda o layout ajustado pelo utilizador sob as impressões digitais do documento (cabeçalho + IBAN, cabeçalho, topo da página)
export async function rememberPdfLayout(src, layout) {
  const p = src.parsed; if (!p?.fingerprints?.length || !layout?.cols?.length) return false;
  const nome = (p.meta?.bank?.nome || '') + (p.meta?.iban ? ' …' + p.meta.iban.slice(-4) : '') || src.name;
  return storeLayout(p.fingerprints, { ...layout, kind: 'pdf', nome: (nome.trim() || src.name) + (src.ocr ? ' (OCR)' : '') });
}
// CSV/Excel: impressão digital = rótulos do cabeçalho + nº de colunas (ou padrão de tipos das colunas, sem cabeçalho)
export function tableFingerprint(src) {
  const rows = src.table?.rows || []; if (!rows.length || !src.map) return null;
  const nc = rows.reduce((a, r) => Math.max(a, r.length), 0), h = src.map.headerRow;
  if (h >= 0) return `c:${hashS(rows[h].map((c) => hclean(c)).join('|'))}:${nc}`;
  const kind = (v) => { const t = String(v ?? '').trim(); return !t ? '-' : /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(t) ? 'd' : /^[-+(]?[\d.,\s]+\)?$/.test(t) ? 'n' : 't'; };
  const r0 = rows.find((r) => r.some((c) => String(c ?? '').trim())) || [];
  return `c0:${nc}:${hashS(Array.from({ length: nc }, (_, i) => kind(r0[i])).join(''))}`;
}
function applySavedTable(src) {
  src.savedTable = null;
  const fp = tableFingerprint(src), e = fp && LAY()[fp];
  if (!e || e.kind !== 'tabela' || src.semGuardado) return;
  src.map = { ...src.map, ...e.map, headerRow: src.map.headerRow };
  src.savedTable = { fp, nome: e.nome };
}
export const mapChangedFromAuto = (src) => !!src.table && JSON.stringify(src.map) !== src.autoMapJson;
export async function rememberTableLayout(src) {
  const fp = tableFingerprint(src); if (!fp) return false;
  const { headerRow, ...map } = src.map;
  return storeLayout([fp], { kind: 'tabela', map, nome: `${FORMATOS[src.format] || 'Tabela'}: ${src.name.replace(/\.[^.]+$/, '').slice(0, 30)}` });
}

// ---------- contas ----------
const stem = (name) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Conta importada';
const isIbanKey = (k) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(k);
export const uniqueAccountName = (nome, ignoreId) => {
  let n = nome, i = 2;
  while (S.accounts.some((a) => a.id !== ignoreId && norm(a.nome) === norm(n))) n = `${nome} (${i++})`;
  return n;
};

function buildGroups(parsed, src) {
  const by = new Map();
  parsed.rows.forEach((r) => { const k = r.contaKey || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
  const meta = parsed.meta || {};
  return [...by].map(([key, rows], gi) => {
    const am = parsed.accounts?.[key] || {};
    const iban = am.iban || (isIbanKey(key) ? key : null) || (!key ? meta.iban : null) || null;
    const acctNo = am.acctNo || (!key ? meta.acctNo : null) || null;
    const bank = meta.bank;
    const lbl = rows.find((r) => r.contaLabel)?.contaLabel || '';
    const last4 = (iban || acctNo || '').slice(-4);
    const nome = am.nome || (key && !iban && lbl ? lbl : last4 ? `${bank?.nome || 'Conta'} …${last4}` : bank ? bank.nome : stem(src.name));
    const matchKeys = [iban, acctNo ? 'conta:' + acctNo : null, key || null].filter(Boolean);
    if (!matchKeys.length) matchKeys.push('arq:' + norm(stem(src.name)));
    const tipo = am.tipo && am.tipo !== 'ordem' ? am.tipo : guessAccountType(`${nome} ${src.name} ${key ? '' : meta.title || ''}`);
    // PDF/extrato com «Saldo Inicial» e «Saldo Final» explícitos: usam-se tal e qual (a diferença, se existir, fica visível)
    const per = am.periodo || parsed.periodo || null;
    const bal = am.opening != null && am.final != null
      ? { opening: am.opening, final: am.final, asc: true, fonte: 'extrato', explicito: true, inicio: per?.ini || null, fim: per?.fim || null }
      : (() => { const b = balanceInfo(rows, am.ledger); return b ? { ...b, inicio: per?.ini || null, fim: am.ledger?.data || per?.fim || null } : b; })();
    return { key, gi, diag: am.chain ? { quebradas: am.chain.broken, corrigidos: am.chain.fixed, diffExtrato: am.diffExtrato ?? 0 } : null, label: iban ? ibanPretty(iban) : lbl || (acctNo ? 'Conta ' + acctNo : stem(src.name)), iban, acctNo, bank, matchKeys, rows, bal, choice: 'new', novo: { nome: uniqueAccountName(nome), tipo, saldoInicial: bal ? bal.opening : 0 } };
  });
}

function matchExisting(g, prev) {
  for (const a of S.accounts) {
    if (a.arquivada) continue;
    if (g.iban && a.iban && a.iban.replace(/\s/g, '').toUpperCase() === g.iban) return a.id;
    if (a.chaves?.some((k) => g.matchKeys.includes(k))) return a.id;
  }
  const pg = prev?.grupos?.[g.gi];
  if (pg && S.accounts.some((a) => a.id === pg.contaId)) return pg.contaId;
  return null;
}

// Sessão de importação: grupos (contas), linhas, duplicados, transferências
export function buildSession(src) {
  const parsed = getParsed(src);
  const groups = buildGroups(parsed, src);
  const prev = S.imports.find((i) => i.hash === src.hash) || null;
  const rows = [];
  for (const g of groups) {
    g.rows = g.rows.map((r) => {
      const row = { id: rows.length, g, ...r, checked: true, dup: false, dupMotivo: '', cat: null, catFonte: '', catTouched: false, flipped: false, pairId: null, xfer: false, touched: false };
      rows.push(row);
      return row;
    });
    const m = matchExisting(g, prev);
    if (m) g.choice = m;
  }
  const debts = (parsed.debts || []).map((d, i) => {
    const existente = S.debts.find((x) => x.extRef && x.extRef === d.ref) || null;
    const credor = `${parsed.meta?.bank?.nome || 'Banco'} — ${d.produto} …${String(d.numero).replace(/\D/g, '').slice(-4)}`;
    return { ...d, id: i, credor, existente: existente ? existente.id : null, checked: false };
  });
  const sess = { src, parsed, groups, rows, prev, debts, bestEffort: !!parsed.bestEffort, warnings: parsed.warnings || [], ignored: parsed.ignored || [], revisto: !parsed.bestEffort };
  for (const r of rows) suggest(r);
  refresh(sess);
  return sess;
}

export const tipoOf = (r) => (r.valor >= 0 ? 'entrada' : 'saida');
export function suggest(r) {
  const c = categorize(r.desc, tipoOf(r));
  r.cat = c.id; r.catFonte = c.fonte; r.catTouched = false;
}
export const accountOfGroup = (g) => (g.choice === 'new' ? null : g.choice);

// ---------- duplicados ----------
const GEN = new Set(['compra', 'compras', 'pagamento', 'pag', 'transferencia', 'transf', 'mb', 'way', 'cartao', 'debito', 'credito', 'de', 'da', 'do', 'em', 'para', 'por']);
const toks = (s) => new Set(norm(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !GEN.has(t) && !/^\d+$/.test(t)));
export function descSimilar(a, b) {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return true; // sem texto para comparar: data+valor bastam
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size) >= 0.5;
}
export function signedFor(m, accId) {
  if (m.tipo === 'transferencia') return m.contaId === accId ? -m.valor : m.contaDestinoId === accId ? m.valor : null;
  if (m.contaId !== accId) return null;
  return m.tipo === 'entrada' ? m.valor : -m.valor;
}
export function markDuplicates(sess) {
  for (const g of sess.groups) {
    const acc = accountOfGroup(g);
    const pool = new Map(), ext = new Set();
    if (acc) for (const m of S.movements) {
      if (m.extId) ext.add(m.extId);
      const sv = signedFor(m, acc); if (sv == null) continue;
      const k = m.data + '|' + sv; if (!pool.has(k)) pool.set(k, []);
      pool.get(k).push({ m, used: false });
    }
    for (const r of g.rows) {
      r.dup = false; r.dupMotivo = '';
      if (acc) {
        if (r.extId && ext.has(r.extId)) { r.dup = true; r.dupMotivo = 'já importado (mesmo identificador)'; }
        else { const c = pool.get(r.data + '|' + r.valor)?.find((x) => !x.used && descSimilar(x.m.nota, r.desc)); if (c) { c.used = true; r.dup = true; r.dupMotivo = 'mesmo dia, valor e descrição semelhante a um movimento existente'; } }
      }
      if (!r.touched) r.checked = !r.dup;
    }
  }
}

// ---------- transferências entre contas (melhor esforço) ----------
const idOf = (g) => (g.choice === 'new' ? 'new:' + g.key + ':' + g.gi : g.choice);
const dayDiff = (a, b) => Math.abs(Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000));
export function detectTransfers(sess) {
  sess.rows.forEach((r) => { r.pairId = null; r.xfer = false; r.pairWith = null; });
  const free = (r) => !r.dup && !r.pairId;
  let n = 0;
  const outs = sess.rows.filter((r) => r.valor < 0 && free(r)).sort((a, b) => a.data.localeCompare(b.data));
  for (const o of outs) {
    let best = null, bd = 99;
    for (const i of sess.rows) {
      if (i.valor !== -o.valor || !free(i) || idOf(i.g) === idOf(o.g)) continue;
      const d = dayDiff(i.data, o.data);
      if (d <= 3 && d < bd) { best = i; bd = d; }
    }
    if (best) { o.pairId = best.pairId = ++n; o.xfer = best.xfer = true; o.pairWith = best; best.pairWith = o; o.checked = best.checked = o.checked && best.checked; }
  }
}
export function refresh(sess) { markDuplicates(sess); detectTransfers(sess); }

export function setPair(r, on) { r.xfer = on; if (r.pairWith) r.pairWith.xfer = on; }

// ---------- resumo e reconciliação ----------
export function summarize(sess) {
  let entradas = 0, saidas = 0, n = 0, nTransf = 0, dups = 0;
  const done = new Set();
  for (const r of sess.rows) {
    if (r.dup && !r.checked) dups++;
    if (!r.checked) continue;
    if (r.pairWith && r.xfer && r.pairWith.checked) { if (!done.has(r.pairId)) { done.add(r.pairId); nTransf++; n++; } continue; }
    n++;
    if (r.valor > 0) entradas += r.valor; else saidas += -r.valor;
  }
  const novas = sess.groups.filter((g) => g.choice === 'new' && g.rows.some((r) => r.checked));
  return { n, entradas, saidas, nTransf, dups, novas: novas.length, selecionadas: sess.rows.filter((r) => r.checked).length };
}
const addDay = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const accOf = (g) => (g.choice === 'new' ? null : S.accounts.find((a) => a.id === g.choice) || null);
// Reconciliação do saldo final do extrato com o saldo da conta após importar.
// Conta existente: usa o saldo da conta até ao fim do período do extrato (não conta movimentos posteriores).
export function reconcile(g) {
  if (!g.bal) return null;
  const marcados = g.rows.filter((r) => r.checked);
  const soma = marcados.reduce((a, r) => a + r.valor, 0);
  const acc = accOf(g);
  const base = !acc ? g.novo.saldoInicial : accountBalance(acc, g.bal.fim || undefined);
  const ajuste = acc && g.ajusteInicial ? g.ajusteInicial : 0;
  const calc = base + ajuste + soma;
  const desm = g.rows.filter((r) => !r.checked && !r.dup);
  const dups = g.rows.filter((r) => r.dup && !r.checked);
  return { final: g.bal.final, calculado: calc, diff: g.bal.final - calc, soma, base, desmarcadas: { n: desm.length, soma: desm.reduce((a, r) => a + r.valor, 0) }, duplicados: { n: dups.length, soma: dups.reduce((a, r) => a + r.valor, 0) }, existente: !!acc };
}
// Conta existente: o saldo inicial do extrato (ex.: «Saldo Inicial») deve igualar o saldo da conta na véspera do 1.º dia do extrato
export function openingCheck(g) {
  const acc = accOf(g);
  if (!acc || !g.bal?.explicito) return null;
  const inicio = g.bal.inicio || g.rows.map((r) => r.data).sort()[0];
  if (!inicio) return null;
  const ate = addDay(inicio, -1);
  const conta = accountBalance(acc, ate) + (g.ajusteInicial || 0);
  return { esperado: g.bal.opening, conta, diff: g.bal.opening - conta, ate, temMovimentosDepois: S.movements.some((m) => (m.contaId === acc.id || m.contaDestinoId === acc.id) && m.data > (g.bal.fim || inicio)) };
}
// Causas prováveis de uma diferença na reconciliação (ordenadas por probabilidade)
export function reconCauses(g, r = reconcile(g)) {
  if (!r || r.diff === 0) return [];
  const out = [];
  const eq = (v) => Math.abs(v) === Math.abs(r.diff);
  if (r.desmarcadas.n && (r.desmarcadas.soma === r.diff || eq(r.desmarcadas.soma))) out.push({ id: 'desmarcadas', n: r.desmarcadas.n, soma: r.desmarcadas.soma, exato: true });
  else if (r.desmarcadas.n) out.push({ id: 'desmarcadas', n: r.desmarcadas.n, soma: r.desmarcadas.soma });
  if (g.diag?.quebradas) out.push({ id: 'cadeia', n: g.diag.quebradas });
  if (g.diag?.diffExtrato) out.push({ id: 'leitura', diff: g.diag.diffExtrato });
  const oc = openingCheck(g);
  if (oc && oc.diff !== 0) out.push({ id: 'abertura', diff: oc.diff, ate: oc.ate, depois: oc.temMovimentosDepois });
  else if (r.existente && !out.length) out.push({ id: 'manual' });
  if (r.duplicados.n) out.push({ id: 'duplicados', n: r.duplicados.n, soma: r.duplicados.soma });
  if (!out.length) out.push({ id: 'desconhecida' });
  return out;
}

// ---------- gravar / anular ----------
// Aplica a importação ao estado (síncrono); o chamador atualiza o estado da interface e depois chama persist()
export const persist = () => save('accounts', 'movements', 'imports', 'catRules', 'debts');
export function commit(sess) {
  const importId = uid();
  const now = Date.now();
  const contas = [], contaIds = [], grupos = [], ajustes = [], dividaIds = [];
  const accOf = new Map();
  for (const g of sess.groups) {
    const used = g.rows.some((r) => r.checked);
    let id = g.choice;
    if (g.choice === 'new') {
      if (!used) { grupos.push({ key: g.key, contaId: null }); continue; }
      id = uid();
      S.accounts.push({ id, nome: uniqueAccountName(g.novo.nome.trim() || g.label), tipo: g.novo.tipo, saldoInicial: g.novo.saldoInicial || 0, limite: null, arquivada: false, iban: g.iban || '', chaves: [...g.matchKeys], importId });
      contaIds.push(id); contas.push({ id, nome: S.accounts[S.accounts.length - 1].nome, nova: true });
    } else {
      const a = S.accounts.find((x) => x.id === id);
      if (used && g.ajusteInicial) { ajustes.push({ contaId: id, de: a.saldoInicial || 0, delta: g.ajusteInicial }); a.saldoInicial = (a.saldoInicial || 0) + g.ajusteInicial; }
      a.chaves = [...new Set([...(a.chaves || []), ...g.matchKeys])];
      if (g.iban && !a.iban) a.iban = g.iban;
      if (used) contas.push({ id, nome: a.nome, nova: false });
    }
    accOf.set(g, id); grupos.push({ key: g.key, contaId: id });
  }
  const movIds = []; let entradas = 0, saidas = 0, nTransf = 0, aprendidas = 0;
  const done = new Set();
  let k = 0;
  const push = (m) => { const mov = { id: uid(), criadoEm: new Date(now + k++).toISOString(), importId, ...m }; S.movements.push(mov); movIds.push(mov.id); };
  for (const r of sess.rows) {
    if (!r.checked || done.has(r.id)) continue;
    const from = accOf.get(r.g);
    if (r.pairWith && r.xfer && r.pairWith.checked) {
      done.add(r.pairWith.id);
      const o = r.valor < 0 ? r : r.pairWith, i = o === r ? r.pairWith : r;
      push({ tipo: 'transferencia', valor: Math.abs(o.valor), data: o.data, contaId: accOf.get(o.g), contaDestinoId: accOf.get(i.g), categoriaId: null, nota: o.desc || i.desc, extId: o.extId || null });
      nTransf++;
      continue;
    }
    const tipo = tipoOf(r);
    push({ tipo, valor: Math.abs(r.valor), data: r.data, contaId: from, categoriaId: r.cat, nota: r.desc, extId: r.extId || null });
    if (tipo === 'entrada') entradas += r.valor; else saidas += -r.valor;
    if (r.catTouched && r.cat && learn(r.desc, tipo, r.cat)) aprendidas++;
  }
  for (const d of sess.debts || []) {
    if (!d.checked || d.existente) continue;
    const id = uid();
    S.debts.push({ id, credor: d.credor, total: d.total, saldoInicial: d.saldoAtual, taxa: d.taxa || 0, prestacao: d.prestacao || 0, criadoEm: new Date().toISOString(), extRef: d.ref, importId });
    dividaIds.push(id);
  }
  const dups = sess.rows.filter((r) => r.dup && !r.checked).length;
  const rec = { id: importId, ficheiro: sess.src.name, formato: sess.src.format, hash: sess.src.hash, data: new Date().toISOString(), nMov: movIds.length, nLinhas: sess.rows.length, duplicados: dups, transferencias: nTransf, entradas, saidas, movIds, contaIds, contas, grupos, aprendidas, ajustes, dividaIds, periodo: sess.parsed?.periodo || null };
  S.imports.push(rec);
  return rec;
}

export function undoImport(id) {
  const imp = S.imports.find((i) => i.id === id);
  if (!imp) return null;
  const before = S.movements.length;
  S.movements = S.movements.filter((m) => m.importId !== id);
  const movs = before - S.movements.length;
  let contas = 0; const mantidas = [];
  for (const cid of imp.contaIds || []) {
    const a = S.accounts.find((x) => x.id === cid); if (!a) continue;
    if (S.movements.some((m) => m.contaId === cid || m.contaDestinoId === cid)) mantidas.push(a.nome);
    else { S.accounts = S.accounts.filter((x) => x.id !== cid); contas++; }
  }
  for (const aj of imp.ajustes || []) { const a = S.accounts.find((x) => x.id === aj.contaId); if (a) a.saldoInicial = (a.saldoInicial || 0) - aj.delta; }
  let dividas = 0; const dividasMantidas = [];
  for (const did of imp.dividaIds || []) {
    const d = S.debts.find((x) => x.id === did); if (!d) continue;
    if (S.debtPayments.some((p) => p.debtId === did)) dividasMantidas.push(d.credor); else { S.debts = S.debts.filter((x) => x.id !== did); dividas++; }
  }
  S.imports = S.imports.filter((i) => i.id !== id);
  return { movs, contas, mantidas, dividas, dividasMantidas };
}
