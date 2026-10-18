// Importar extratos — motor: leitura de ficheiros, contas, duplicados, transferências, gravação e anulação.
import { S, save } from '../db.js';
import { uid, norm } from '../util.js';
import { accountBalance } from '../model.js';
import { decodeBytes, detectDelimiter, parseCSV, autoMap, tableToParsed, parseOFX, ofxCharset, parseQIF, parseStatementLines, balanceInfo, ibanPretty, guessAccountType } from './parse.js';
import { readWorkbook, sheetRows, pdfLines } from './loaders.js';
import { categorize, learn } from './categorize.js';

export const FORMATOS = { csv: 'CSV', xlsx: 'Excel', ofx: 'OFX', qif: 'QIF', pdf: 'PDF' };
export const ACEITA = '.csv,.txt,.tsv,.xlsx,.xls,.ofx,.qfx,.qif,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
  if (head.startsWith('PK\x03\x04') || head.startsWith('\xd0\xcf\x11\xe0')) return 'xlsx';
  const txt = new TextDecoder('latin1').decode(bytes.slice(0, 3000));
  if (/OFXHEADER|<OFX>/i.test(txt)) return 'ofx';
  if (/^\s*!(Type|Account|Option)/im.test(txt)) return 'qif';
  if (['ofx', 'qfx'].includes(ext)) return 'ofx';
  if (ext === 'qif') return 'qif';
  if (['xlsx', 'xls', 'xlsm'].includes(ext)) return 'xlsx';
  if (ext === 'pdf') return 'pdf';
  return 'csv';
}

// Lê o ficheiro e prepara a análise. src.opts: { encoding, delim, sheet } (alteráveis no passo "Colunas")
export async function loadSource(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) throw new Error('O ficheiro está vazio.');
  const src = { name: file.name, size: bytes.length, bytes, hash: await sha256hex(bytes), format: sniff(bytes, file.name), opts: { encoding: 'auto', delim: 'auto', sheet: 0 } };
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
  } else if (src.format === 'pdf') {
    const lines = await pdfLines(src.bytes);
    if (!lines.length) { src.error = 'sem-texto'; throw new Error('Este PDF não tem texto selecionável (parece uma imagem digitalizada). Exporte o extrato em CSV, Excel ou OFX a partir do homebanking.'); }
    src.parsed = parseStatementLines(lines, src.name);
    src.parsed.bestEffort = true;
    if (!src.parsed.rows.length) throw new Error('Não consegui reconhecer movimentos neste PDF. Experimente exportar o extrato em CSV, Excel ou OFX.');
    src.parsed.warnings.unshift('Leitura de PDF em modo «melhor esforço»: os extratos de cada banco são diferentes. Reveja cuidadosamente todos os movimentos antes de importar.');
  }
  if (src.table && resetMap) src.map = autoMap(src.table.rows);
  return src;
}

export const isTable = (src) => !!src.table;
export const getParsed = (src) => (src.table ? tableToParsed(src.table.rows, src.map, src.name) : src.parsed);

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
    const nome = key && !iban && lbl ? lbl : last4 ? `${bank?.nome || 'Conta'} …${last4}` : bank ? bank.nome : stem(src.name);
    const matchKeys = [iban, acctNo ? 'conta:' + acctNo : null, key || null].filter(Boolean);
    if (!matchKeys.length) matchKeys.push('arq:' + norm(stem(src.name)));
    const tipo = am.tipo && am.tipo !== 'ordem' ? am.tipo : guessAccountType(`${nome} ${src.name} ${key ? '' : meta.title || ''}`);
    const bal = balanceInfo(rows, am.ledger);
    return { key, gi, label: iban ? ibanPretty(iban) : lbl || (acctNo ? 'Conta ' + acctNo : stem(src.name)), iban, acctNo, bank, matchKeys, rows, bal, choice: 'new', novo: { nome: uniqueAccountName(nome), tipo, saldoInicial: bal ? bal.opening : 0 } };
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
  const sess = { src, parsed, groups, rows, prev, bestEffort: !!parsed.bestEffort, warnings: parsed.warnings || [], ignored: parsed.ignored || [], revisto: !parsed.bestEffort };
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
export function reconcile(g) {
  if (!g.bal) return null;
  const soma = g.rows.filter((r) => r.checked).reduce((a, r) => a + r.valor, 0);
  const base = g.choice === 'new' ? g.novo.saldoInicial : accountBalance(S.accounts.find((a) => a.id === g.choice) || { saldoInicial: 0, id: '' });
  const calc = base + soma;
  return { final: g.bal.final, calculado: calc, diff: g.bal.final - calc, soma };
}

// ---------- gravar / anular ----------
// Aplica a importação ao estado (síncrono); o chamador atualiza o estado da interface e depois chama persist()
export const persist = () => save('accounts', 'movements', 'imports', 'catRules');
export function commit(sess) {
  const importId = uid();
  const now = Date.now();
  const contas = [], contaIds = [], grupos = [];
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
  const dups = sess.rows.filter((r) => r.dup && !r.checked).length;
  const rec = { id: importId, ficheiro: sess.src.name, formato: sess.src.format, hash: sess.src.hash, data: new Date().toISOString(), nMov: movIds.length, nLinhas: sess.rows.length, duplicados: dups, transferencias: nTransf, entradas, saidas, movIds, contaIds, contas, grupos, aprendidas };
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
  S.imports = S.imports.filter((i) => i.id !== id);
  return { movs, contas, mantidas };
}
