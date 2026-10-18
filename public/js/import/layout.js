// Importar extratos — leitor de tabelas genérico (independente do banco/layout) para linhas de texto com posições (PDF, OCR).
// Pipeline: linhas -> átomos (datas, valores, texto) -> ruído (cabeçalhos/rodapés repetidos) -> deteção de cabeçalhos de tabela (PT/EN/ES)
//   -> secções (várias contas/cartões num PDF) -> colunas por posição horizontal -> linhas de movimentos (descrições em várias linhas,
//   data de movimento/valor, ano deduzido do período) -> sinais (colunas, marcas, palavras-chave) -> cadeia de saldos.
// Funções puras, sem DOM. Os «hints» de bancos específicos (pdfstatement.js) são apenas reforços opcionais.
import { norm } from '../util.js';
import { parseAmount, hclean, validateChain } from './parse.js';
import { atomize, dateISO, dateParts, orderOf, amtInfo, keywordSign } from './tokens.js';

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const ngap = (a, b) => Math.max(0, Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2));
const mid = (c) => (c.x1 + c.x2) / 2;

// ---------- itens de texto (x, y, largura, altura) -> linhas com células ----------
// Origem em baixo à esquerda (y cresce para cima). Usado para PDF (pdf.js) e para OCR (palavras com caixa).
export function linesFromItems(items, page, pw, ph) {
  const its = items.filter((i) => String(i.s).trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const hs = its.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b); const hm = hs.length ? hs[Math.floor(hs.length / 2)] : 10;
  const groups = [];
  for (const it of its) {
    const g = groups.find((x) => Math.abs(x.y - it.y) <= Math.max(2, Math.min(it.h, hm * 1.4) * 0.4));
    if (g) { g.items.push(it); g.y = (g.y * (g.items.length - 1) + it.y) / g.items.length; } else groups.push({ y: it.y, items: [it] });
  }
  groups.sort((a, b) => b.y - a.y);
  return groups.map((g) => {
    g.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of g.items) {
      const h = Math.min(it.h || 10, hm * 1.4);
      const last = cells[cells.length - 1], gap = last ? it.x - last.x2 : Infinity;
      if (last && gap < h * 0.15) { last.s += it.s; last.x2 = it.x + it.w; }
      else if (last && gap < h * 0.8) { last.s += ' ' + it.s; last.x2 = it.x + it.w; }
      else cells.push({ s: it.s, x: it.x, x2: it.x + it.w });
    }
    return { cells, text: cells.map((c) => c.s.trim()).join('  '), page, y: g.y, h: Math.max(...g.items.map((i) => i.h || 10)), pw, ph };
  });
}

// ---------- preparação das linhas ----------
// opts.dotDates: tratar «17.08» como data dd.mm mesmo em linhas com poucas células (opção do ajuste manual). Sem opts, mantém a última leitura.
export function prepare(lines, opts = {}) {
  let pw = 0;
  for (const L of lines) { if (L.pw) pw = Math.max(pw, L.pw); for (const c of L.cells || []) pw = Math.max(pw, c.x2 || 0); }
  lines.forEach((L, i) => {
    if (opts.dotDates !== undefined && L._a && !!L._dd !== !!opts.dotDates) L._a = null;
    if (!L._a) {
      L._dd = !!opts.dotDates;
      L._a = atomize(L, { dotDates: !!opts.dotDates }); L.i = i;
      const a = L._a;
      L.isRow = a.length >= 2 && a[0].t === 'date' && a.some((x) => x.t === 'amt');
      L.txt = a.filter((x) => x.t === 'txt').map((x) => x.s).join(' ');
      L.nAmt = a.filter((x) => x.t === 'amt').length;
      L.plain = norm(L.text || '').replace(/\s+/g, ' ');
    }
  });
  return { pw: pw || 600 };
}

// ---------- cabeçalhos de tabela ----------
const TOK = {
  date: /^(data|date|fecha|datum|dt)$/,
  desc: /^(descri\w*|descritivo|descripcion|description|detalhes?|details?|detail|concepto|historico|narrativa|narrative|memo|texto|payee|beneficiario|merchant|referencia|reference|transaction|transacao|operacao|lancamento|movimentos?|concept)$/,
  debit: /^(debito|debitos|debit|debits|saidas?|retirad[oa]s?|levantamentos?|withdrawals?|outgoing|gastos|despesas|debe|cargos?|saida)$/,
  credit: /^(credito|creditos|credit|credits|entradas?|deposit(?:o|ado)s?|incoming|haber|abonos?|receitas|ingresos)$/,
  balance: /^(saldo|saldos|balance|saldo)$/,
  amount: /^(montante|valor|importe|amount|quantia|importancia|total)$/,
  cur: /^(moeda|currency|divisa)$/,
};
const MOD = new Set(['mov', 'movim', 'movimento', 'movimentos', 'op', 'operacao', 'contabilistico', 'contabilistica', 'contab', 'disponivel', 'available', 'ledger', 'running', 'final', 'inicial', 'booking', 'transaction', 'posted', 'efetiva', 'do', 'da', 'de', 'dos', 'das', 'em', 'of', 'the', 'eur', 'euro', 'euros', '(eur)']);
function tokRole(w) { for (const [k, re] of Object.entries(TOK)) if (re.test(w)) return k; return null; }
// Divide o texto de uma célula de cabeçalho em segmentos com papel (ex.: «Valor Descritivo do Movimento» -> «Valor» + «Descritivo do Movimento»)
function splitHeaderCell(c) {
  const s = String(c.s); const W = Math.max(0.1, c.x2 - c.x);
  const words = [...s.matchAll(/[^\s/|]+/g)].map((m) => ({ w: hclean(m[0]).replace(/\s+/g, ''), idx: m.index, end: m.index + m[0].length })).filter((w) => w.w);
  const segs = [];
  for (let k = 0; k < words.length; k++) {
    const { w, idx, end } = words[k];
    let r = tokRole(w);
    const prev = segs[segs.length - 1];
    if ((w === 'money' || w === 'paid') && words[k + 1]) { const nx = words[k + 1].w; if (nx === 'out') r = 'debit'; else if (nx === 'in') r = 'credit'; }
    if ((w === 'out' || w === 'in') && prev && /^(money|paid)/.test(prev.words.at(-1) || '')) { prev.end = end; prev.words.push(w); continue; }
    const attach = prev && ((r === 'amount' && (w === 'valor' || w === 'value') && prev.role === 'date') || (w === 'valor' && prev.role === 'date') || ((w === 'movimento' || w === 'movimentos' || w === 'mov') && (prev.role === 'date' || prev.role === 'desc')) || (r === 'balance' && prev.role === 'balance') || (r === 'debit' && prev.role === 'debit' && false));
    if (attach) { prev.end = end; prev.words.push(w); if (prev.role === 'date' && (w === 'valor' || w === 'value')) prev.role = 'dateValue'; continue; }
    if (r && !(r === 'desc' && prev && prev.role === 'desc' && (w === 'movimento' || w === 'movimentos'))) { segs.push({ role: r, start: idx, end, words: [w] }); continue; }
    if (prev) { prev.end = end; prev.words.push(w); continue; }
    segs.push({ role: null, start: idx, end, words: [w] });
  }
  return segs.map((g) => ({ label: s.slice(g.start, g.end).trim(), role: g.role, x: c.x + (g.start / s.length) * W, x2: c.x + (g.end / s.length) * W }));
}
const NUMROLE = new Set(['amount', 'debit', 'credit', 'balance']);
function mergeStacked(cellsA, cellsB) { // cabeçalho de duas linhas («Data» por cima de «Mov»)
  const out = cellsA.map((c) => ({ ...c })); const used = new Set();
  for (const b of cellsB) {
    let best = -1, bd = 1e9;
    out.forEach((a, i) => { if (used.has(i)) return; const g = ngap({ x1: a.x, x2: a.x2 }, { x1: b.x, x2: b.x2 }); const d = g > 0 ? g + 50 : Math.abs((a.x + a.x2) / 2 - (b.x + b.x2) / 2); if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < 28) { const a = out[best]; used.add(best); a.s = a.s.trim() + ' ' + b.s.trim(); a.x = Math.min(a.x, b.x); a.x2 = Math.max(a.x2, b.x2); } else out.push({ ...b });
  }
  return out.sort((p, q) => p.x - q.x);
}
function headerFrom(cells) {
  const cols = cells.flatMap((c) => splitHeaderCell(c)).filter((g) => g.label);
  const roles = new Set(cols.map((c) => c.role).filter((r) => r && r !== 'cur'));
  const hasNum = [...roles].some((r) => NUMROLE.has(r));
  const ok = roles.size >= 3 && hasNum && (roles.has('date') || roles.has('dateValue') || roles.has('desc')) && (roles.has('date') || roles.has('dateValue'));
  if (!ok) return null;
  return { cols: cols.map((c) => ({ ...c, x1: c.x })), roles, score: roles.size };
}
// Procura cabeçalhos: Map(índice da 1.ª linha -> { i0, i1, cols, sig })
export function findHeaders(lines) {
  const out = new Map();
  const cellsOf = (L) => (L.cells && L.cells.length ? L.cells : []).filter((c) => String(c.s).trim());
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.isRow || L.nAmt >= 1 || !L.cells?.length) continue;
    let best = headerFrom(cellsOf(L)); let i1 = i;
    const N = lines[i + 1];
    if (N && !N.isRow && N.nAmt === 0 && N.page === L.page && N.cells?.length && (!L.y || !N.y || L.y - N.y < Math.max(26, (L.h || 9) * 3))) {
      const two = headerFrom(mergeStacked(cellsOf(L), cellsOf(N)));
      if (two && (!best || two.score > best.score)) { best = two; i1 = i + 1; }
    }
    if (best) { best.cols.sort((a, b) => a.x1 - b.x1); out.set(i, { i0: i, i1, cols: best.cols, sig: best.cols.map((c) => c.role || '-').join('>'), labels: best.cols.map((c) => hclean(c.label)).join('|') }); i = i1; }
  }
  return out;
}

// ---------- ruído: rodapés, «Continua», cabeçalhos de página repetidos ----------
const NOISE_RE = [/^(p[áa]gina|page|pag\.?|p[áa]g\.?)\s*\d+(\s*(\/|de|of|-)\s*\d+)?\s*$/i, /^\d+\s*(\/|de|of)\s*\d+$/, /^[(\[]?(continua|continua[çc][ãa]o|continued|cont\.)\b/i, /^(a transportar|transporte)\b/i,
  /\b(capital social|nipc|sede social|registered office|authorised by|regulated by|sociedade an[óo]nima|c\.?r\.?c\.?\s+\w+)\b/i];
export function markNoise(lines, hdrLines) {
  const noise = new Array(lines.length).fill(false);
  const pages = new Set(lines.map((l) => l.page)); const np = pages.size;
  const sig = (L) => L.plain.replace(/\d/g, '9').replace(/[^a-z9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const seen = new Map();
  lines.forEach((L, i) => { if (L.isRow || hdrLines.has(i) || L._a[0]?.t === 'date') return; const s = sig(L); if (s.length < 6) return; if (!seen.has(s)) seen.set(s, new Set()); seen.get(s).add(L.page); });
  const need = Math.max(2, Math.ceil(np * 0.6));
  lines.forEach((L, i) => {
    if (hdrLines.has(i) || L.isRow) return;
    const t = L.text.trim();
    if (NOISE_RE.some((re) => re.test(t))) { if (!(L.nAmt && /^saldo/i.test(t))) noise[i] = true; return; }
    if (np >= 2 && L.nAmt === 0 && !isBalanceText(L.txt) && L._a[0]?.t !== 'date') { const s = sig(L); if (s.length >= 6 && (seen.get(s)?.size || 0) >= need) noise[i] = true; }
  });
  return noise;
}

// ---------- saldos inicial/final ----------
const OPEN_RE = /^(saldo\s+(inicial|anterior|transitado|do dia anterior|de abertura|abertura|a transitar)|opening balance|balance (brought forward|b\/f|forward)|previous balance|saldo previo)\b/;
const CLOSE_RE = /^(saldo\s+(contabil\w*\s+)?final|saldo contabil\w*|closing balance|novo saldo|ending balance|saldo (atual|actual)|balance (carried forward|c\/f)|saldo em \d)/;
const DISP_RE = /^saldo\s+dispon\w*/;
const CARRY_RE = /^((saldo\s+)?(transportado|a transportar|transporte)|carried forward)/;
const isBalanceText = (t) => { const n = norm(t); return OPEN_RE.test(n) || CLOSE_RE.test(n) || DISP_RE.test(n) || CARRY_RE.test(n); };
export function balanceLine(L) {
  if (!L.nAmt) return null;
  const n = norm(L.txt).replace(/\s+/g, ' ');
  if (!n || !/saldo|balance|transport|carried/.test(n)) return null;
  const amts = L._a.filter((a) => a.t === 'amt'); const v = parseAmount(amts[amts.length - 1].s, null);
  if (Number.isNaN(v)) return null;
  if (OPEN_RE.test(n)) return { kind: 'open', v };
  if (DISP_RE.test(n)) return { kind: 'disp', v };
  if (CARRY_RE.test(n)) return { kind: 'carry', v };
  if (CLOSE_RE.test(n)) return { kind: 'close', v };
  return null;
}
const ACCT_HEAD = /^(detalhe de movimentos|movimentos d[aeo]s?\b|extrato (d[aeo]|de)s?\b|conta\b|cart[ãa]o\b|poupan[çc]a\b|account\b|credit card|debit card|savings|current account|checking|statement|transactions?\b|activity)/i;
export const isHeading = (L) => !L.nAmt && L._a[0]?.t !== 'date' && L.text.length >= 4 && L.text.length <= 100 && (L.cells?.length || 1) <= 3 && ACCT_HEAD.test(L.text.trim());

// ---------- agrupamento por sobreposição de intervalos horizontais ----------
function clusterIntervals(atoms, margin = 1) {
  const s = atoms.map((a) => ({ a, x1: a.x - margin, x2: a.x2 + margin })).sort((p, q) => p.x1 - q.x1);
  const cl = [];
  for (const it of s) { const c = cl[cl.length - 1]; if (c && it.x1 <= c.x2) { c.items.push(it.a); c.x2 = Math.max(c.x2, it.x2); } else cl.push({ items: [it.a], x1: it.x1, x2: it.x2 }); }
  return cl.map((c) => {
    const L = c.items.map((a) => a.x), R = c.items.map((a) => a.x2), C = c.items.map((a) => (a.x + a.x2) / 2);
    const sp = (v) => { const m = med(v); return v.reduce((t, x) => t + Math.abs(x - m), 0) / v.length; };
    const sc = [['R', sp(R) - 0.01], ['L', sp(L)], ['C', sp(C)]].sort((a, b) => a[1] - b[1])[0][0];
    const anchor = med(sc === 'R' ? R : sc === 'L' ? L : C);
    return { n: c.items.length, x1: Math.min(...L), x2: Math.max(...R), align: sc, anchor, items: c.items };
  });
}
// ligação de colunas do cabeçalho (numéricas) a clusters de valores (ordem esquerda -> direita preservada)
function matchCols(hcols, clusters) {
  const nh = hcols.length, nc = clusters.length, SKIP = 45;
  const cost = (h, c) => { const g = ngap(h, c); return g * 1.5 + Math.abs(mid(h) - mid(c)) * 0.25; };
  const dp = Array.from({ length: nh + 1 }, () => new Array(nc + 1).fill(Infinity)); const bk = Array.from({ length: nh + 1 }, () => new Array(nc + 1).fill(null));
  dp[0][0] = 0;
  for (let i = 0; i <= nh; i++) for (let j = 0; j <= nc; j++) {
    const cur = dp[i][j]; if (cur === Infinity) continue;
    if (i < nh && cur + SKIP < dp[i + 1][j]) { dp[i + 1][j] = cur + SKIP; bk[i + 1][j] = ['h', i, j]; }
    if (j < nc && cur + SKIP < dp[i][j + 1]) { dp[i][j + 1] = cur + SKIP; bk[i][j + 1] = ['c', i, j]; }
    if (i < nh && j < nc) { const k = cost(hcols[i], clusters[j]); if (k <= 90 && cur + k < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = cur + k; bk[i + 1][j + 1] = ['m', i, j]; } }
  }
  const map = new Array(nc).fill(null); let i = nh, j = nc;
  while (i > 0 || j > 0) { const b = bk[i][j]; if (!b) break; if (b[0] === 'm') map[b[2]] = hcols[b[1]]; i = b[1]; j = b[2]; }
  return map;
}

// ---------- secções (tabelas) ----------
// Títulos de blocos que NÃO são movimentos (terminam a tabela em curso): detalhe dos pagamentos, informações de pagamento, mensagens, avisos legais
const STOP_RE = /^(detalhe d[aeo]s? pagamentos?|informa[çc][õo]es? de pagamento|mensagens?\s*$|informa[çc][õo]es? (importantes?|legais)|condi[çc][õo]es (gerais|de utiliza)|payment (details|information)|important information|legal (information|notice)|aviso legal)/i;
// Percorre as linhas e devolve as tabelas encontradas: { hdr, items, opening, final, disp, pre, closed }
export function scanSections(lines, { hdrAt, noise, region = null, implicit = false }) {
  const secs = []; let cur = null, pre = [], pendOpen = null;
  const newSec = (hdr) => { cur = { hdr, items: [], opening: pendOpen, final: null, disp: null, pre: pre.slice(), closed: false, hdrCount: 1 }; pendOpen = null; secs.push(cur); pre = []; return cur; };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (noise[i]) continue;
    if (region && region[i] !== 'free') { if (cur) cur.closed = true; continue; }
    const h = !implicit ? hdrAt.get(i) : null;
    if (h) {
      const contHeading = pre.some(isHeading);
      if (cur && !cur.closed && cur.hdr && cur.hdr.sig === h.sig && !contHeading) cur.hdrCount++;
      else { if (cur) cur.closed = true; newSec(h); }
      pre = []; i = h.i1; continue;
    }
    if (STOP_RE.test(L.text.trim()) && !L.isRow) { if (cur) cur.closed = true; pre = []; continue; } // fim da tabela de movimentos (pagamentos, mensagens, avisos…)
    const bl = balanceLine(L);
    if (bl) {
      const open = cur && !cur.closed;
      if (bl.kind === 'open') { if (open && !cur.items.some((x) => x.k === 'row') && cur.opening == null) cur.opening = bl.v; else if (!open) pendOpen = bl.v; }
      else if (bl.kind === 'close') { if (open) { if (cur.final == null) cur.final = bl.v; cur.closed = true; } else if (secs.length && secs.at(-1).final == null) secs.at(-1).final = bl.v; }
      else if (bl.kind === 'disp') { const t = open ? cur : secs.at(-1); if (t && t.disp == null) t.disp = bl.v; }
      continue;
    }
    if (!(cur && !cur.closed)) {
      if (implicit && L.isRow) { if (cur) cur.closed = true; newSec(null); cur.items.push({ k: 'row', L }); pre = []; continue; }
      pre.push(L); continue;
    }
    if (L.isRow) { cur.items.push({ k: 'row', L }); pre = []; continue; }
    if (/^(total|totais|subtotal)\b/i.test(L.txt.trim()) && !L.isRow) { cur.closed = true; continue; }
    if (L.nAmt && !L.isRow) { cur.items.push({ k: 'other', L }); continue; }
    cur.items.push({ k: 'text', L }); pre.push(L);
  }
  return secs;
}

// ---------- colunas ----------
const NUMR = (r) => r === 'debit' || r === 'credit' || r === 'amount' || r === 'balance';
export function resolveColumns(sec, pw) {
  const rows = sec.items.filter((it) => it.k === 'row').map((it) => it.L);
  const nR = rows.length; if (!nR) return null;
  const hdr = sec.hdr; const hcols = hdr ? hdr.cols.map((c) => ({ ...c, x1: c.x, x2: c.x2, used: false })) : [];
  // datas
  let dcl = clusterIntervals(rows.flatMap((L) => L._a.filter((a) => a.t === 'date')), 1);
  if (dcl.length > 2) dcl = dcl.filter((c) => c.n >= nR * 0.3).slice(0, 2);
  const dcols = dcl.map((c) => ({ kind: 'date', role: 'date', x1: c.x1 - 2, x2: c.x2 + 2, label: '' }));
  dcols.forEach((d) => {
    let best = null, bg = 1e9;
    for (const h of hcols) { if (!(h.role === 'date' || h.role === 'dateValue' || h.role === 'amount')) continue; const g = ngap(h, d); if (g < bg) { bg = g; best = h; } }
    if (best && bg <= 30) { best.used = true; d.label = best.label; d.hrole = best.role === 'amount' ? 'dateValue' : best.role; }
  });
  if (dcols.length === 2) { const [a, b] = dcols; if (a.hrole === 'dateValue' && b.hrole !== 'dateValue') { a.role = 'dateValue'; b.role = 'date'; } else { a.role = 'date'; b.role = 'dateValue'; } }
  // valores
  let ncl = clusterIntervals(rows.flatMap((L) => L._a.filter((a) => a.t === 'amt')), 1);
  if (ncl.length > 1 && nR >= 8) ncl = ncl.filter((c) => c.n >= Math.max(2, Math.ceil(nR * 0.04)));
  const hnum = hcols.filter((h) => NUMROLE.has(h.role) && !h.used);
  const mapped = hdr ? matchCols(hnum, ncl) : ncl.map(() => null);
  const ncols = ncl.map((c, k) => ({ kind: 'num', role: mapped[k]?.role || null, label: mapped[k]?.label || '', x1: c.x1 - 2, x2: c.x2 + 2, align: c.align, anchor: c.anchor, n: c.n }));
  const unk = ncols.filter((c) => !c.role);
  if (unk.length) {
    const has = (r) => ncols.some((c) => c.role === r);
    if (unk.length === ncols.length) {
      const both = rows.filter((L) => L.nAmt >= 2).length / nR, k = ncols.length;
      const set = k === 1 ? ['amount'] : k === 2 ? (both >= 0.5 ? ['amount', 'balance'] : ['debit', 'credit']) : k === 3 ? ['debit', 'credit', 'balance'] : ['debit', 'credit', ...Array(k - 3).fill('ignore'), 'balance'];
      ncols.forEach((c, i) => (c.role = set[i]));
    } else for (const c of unk) {
      if (!has('balance') && c === ncols[ncols.length - 1] && ncols.length >= 2) c.role = 'balance';
      else if (!has('amount') && !has('debit') && !has('credit')) c.role = 'amount';
      else c.role = 'ignore';
    }
  }
  const first = Math.min(...ncols.map((c) => c.x1), 1e9);
  const dRight = dcols.length ? Math.max(...dcols.map((d) => d.x2)) : 0;
  const lefts = rows.map((L) => L._a.find((a) => a.t === 'txt' && a.x2 > dRight - 1)?.x).filter((v) => v != null);
  const dx1 = lefts.length ? med(lefts) - 2 : dRight;
  const desc = { kind: 'desc', role: 'desc', x1: dx1, x2: first - 1, label: hcols.find((h) => h.role === 'desc')?.label || '' };
  return { dates: dcols, nums: ncols, desc, pw };
}

// colunas definidas pelo utilizador/layout guardado (frações da largura da página) -> colunas absolutas
export function colsFromLayout(layout, pw) {
  const cs = (layout.cols || []).map((c) => ({ role: c.role, x1: c.x1 * pw, x2: c.x2 * pw, label: c.label || '' }));
  const dates = cs.filter((c) => c.role === 'date' || c.role === 'dateValue').map((c) => ({ kind: 'date', ...c, align: 'L' }));
  const nums = cs.filter((c) => NUMR(c.role)).map((c) => ({ kind: 'num', ...c, anchor: (c.x1 + c.x2) / 2 }));
  const d = cs.find((c) => c.role === 'desc');
  const first = nums.length ? Math.min(...nums.map((c) => c.x1)) : pw;
  const dRight = dates.length ? Math.max(...dates.map((c) => c.x2)) : 0;
  return { dates, nums, desc: { kind: 'desc', role: 'desc', x1: d ? d.x1 : dRight, x2: d ? d.x2 : first - 1, label: d?.label || '' }, pw };
}
export function layoutFromCols(cols, pw) {
  const f = (c) => ({ role: c.role, x1: +(c.x1 / pw).toFixed(4), x2: +(c.x2 / pw).toFixed(4), label: c.label || '' });
  return [...cols.dates.map(f), cols.desc ? f(cols.desc) : null, ...cols.nums.map(f)].filter(Boolean).sort((a, b) => a.x1 - b.x1);
}

// ---------- construção das linhas de movimentos ----------
const nearestNum = (a, nums) => { let best = null, bd = 1e9; for (const c of nums) { const g = ngap({ x1: a.x, x2: a.x2 }, c); const d = g * 3 + Math.abs((c.align === 'R' ? a.x2 : c.align === 'L' ? a.x : (a.x + a.x2) / 2) - (c.anchor ?? mid(c))) * 0.2; if (d < bd) { bd = d; best = c; } } return bd < 100 ? best : null; };
const nearestDate = (a, dates) => { let best = null, bd = 1e9; for (const c of dates) { const d = ngap({ x1: a.x, x2: a.x2 }, c) * 2 + Math.abs(mid(c) - (a.x + a.x2) / 2) * 0.2; if (d < bd) { bd = d; best = c; } } return best; };

export function buildRaw(sec, cols, ctx = {}) {
  const raw = []; let last = null, cont = 0, ignoradas = 0, lastRowLine = null; const pitch = [];
  const rowsL = sec.items.filter((it) => it.k === 'row').map((it) => it.L);
  for (let k = 1; k < rowsL.length; k++) if (rowsL[k].y != null && rowsL[k - 1].y != null && rowsL[k].page === rowsL[k - 1].page) { const g = rowsL[k - 1].y - rowsL[k].y; if (g > 1) pitch.push(g); }
  const p0 = pitch.length ? Math.min(...pitch) : null;
  const skip = ctx.skip || null;
  const numLeft = cols.nums.length ? Math.min(...cols.nums.map((c) => c.x1)) : 1e9;
  for (const it of sec.items) {
    const L = it.L;
    if (skip && skip.has(L.sig)) continue;
    if (it.k === 'row') {
      cont = 0;
      const A = L._a; const dateAtoms = A.filter((a) => a.t === 'date');
      let tokMov = null, tokVal = null;
      for (const d of dateAtoms) {
        const c = cols.dates.length ? nearestDate(d, cols.dates) : null;
        if (c && c.role === 'dateValue') tokVal ||= d.tok; else tokMov ||= d.tok;
      }
      tokMov ||= tokVal;
      let deb = null, cre = null, amt = null, saldo = null, amtS = null, orig = null;
      for (const a of A.filter((x) => x.t === 'amt')) {
        const c = nearestNum(a, cols.nums); if (!c) continue;
        const info = amtInfo(a.s); if (Number.isNaN(info.v)) continue;
        if (c.role === 'ignore') { orig ||= a.s; continue; } // valor na moeda original («100,00EUR», «,30EUR»): informativo
        if (c.role === 'debit') deb = (deb || 0) + Math.abs(info.v);
        else if (c.role === 'credit') cre = (cre || 0) + Math.abs(info.v);
        else if (c.role === 'amount') { if (!amt) { amt = info; amtS = a.s; } }
        else if (c.role === 'balance') saldo = info.v;
      }
      let desc = A.filter((a) => a.t === 'txt' && (a.x + a.x2) / 2 < numLeft - 1).map((a) => a.s).join(' ').replace(/\s+/g, ' ').trim();
      let pais = null;
      if (orig) { const mp = desc.match(/\s([A-Z]{3})$/); if (mp) { pais = mp[1]; desc = desc.slice(0, -4).trim(); } } // código do país antes do valor original
      if (deb == null && cre == null && !amt) { if (saldo != null && !desc) continue; ignoradas++; last = null; continue; }
      last = { tokMov, tokVal, desc, deb, cre, amt, saldo, orig, pais, page: L.page, y: L.y, h: L.h };
      raw.push(last); lastRowLine = L;
    } else if (it.k === 'text' && last && cont < 4 && L.page === last.page) {
      const A = L._a, t0 = A.find((a) => a.t === 'txt');
      if (!t0 || A.some((a) => a.t === 'date' || a.t === 'amt') || A.filter((a) => a.t === 'txt').length > 3 || L.txt.length > 90) continue;
      if (isHeading(L) || isBalanceText(L.txt) || /^(total|continua)/i.test(L.txt)) continue;
      const aligned = Math.abs(t0.x - cols.desc.x1 - 2) <= 14 || (t0.x >= cols.desc.x1 - 2 && t0.x <= cols.desc.x1 + 30);
      const near = L.y == null || last.y == null || (last.y - L.y) <= Math.max((p0 || 0) * 1.3, (L.h || 9) * 1.9);
      if (aligned && near) { last.desc = (last.desc + ' ' + L.txt).replace(/\s+/g, ' ').trim(); cont++; last.y = L.y ?? last.y; }
    } else if (it.k === 'other' && last && ctx.inheritDate !== false && L.page === last.page) {
      // linha sem data mas com valor numa coluna de movimento: herda a data da anterior (vários movimentos no mesmo dia)
      const A = L._a; let deb = null, cre = null, amt = null, saldo = null;
      for (const a of A.filter((x) => x.t === 'amt')) { const c = nearestNum(a, cols.nums); if (!c) continue; const info = amtInfo(a.s); if (Number.isNaN(info.v)) continue; if (c.role === 'debit') deb = Math.abs(info.v); else if (c.role === 'credit') cre = Math.abs(info.v); else if (c.role === 'amount') amt = info; else if (c.role === 'balance') saldo = info.v; }
      const desc = A.filter((a) => a.t === 'txt' && (a.x + a.x2) / 2 < numLeft - 1).map((a) => a.s).join(' ').trim();
      if ((deb != null || cre != null || amt) && desc && !isBalanceText(desc)) { last = { tokMov: last.tokMov, tokVal: last.tokVal, desc, deb, cre, amt, saldo, page: L.page, y: L.y, h: L.h, herdada: true }; raw.push(last); cont = 0; }
    }
  }
  void lastRowLine;
  return { raw, ignoradas };
}

// ---------- ano das datas sem ano ----------
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function makeYearOf({ period = null, yearHint = null, months = [], today = new Date() } = {}) {
  if (period) {
    const ys = [...new Set([+period.ini.slice(0, 4) - 1, +period.ini.slice(0, 4), +period.fim.slice(0, 4)])]; // inclui o ano anterior: movimentos de dezembro num extrato que começa em janeiro
    return (m, d) => {
      let best = null, bd = Infinity;
      for (const y of ys) {
        const t = new Date(Date.UTC(y, m - 1, d)); if (t.getUTCMonth() !== m - 1) continue;
        const iso = t.toISOString().slice(0, 10);
        const dist = iso < period.ini ? (new Date(period.ini) - t) : iso > period.fim ? (t - new Date(period.fim)) : 0;
        if (dist < bd) { bd = dist; best = y; }
      }
      return best;
    };
  }
  if (yearHint) { const wrap = months.some((x) => x >= 10) && months.some((x) => x <= 3); return (m) => (wrap && m >= 10 ? yearHint - 1 : yearHint); }
  const cy = today.getUTCFullYear();
  return (m, d) => { const iso = `${cy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return iso > addDays(today.toISOString().slice(0, 10), 31) ? cy - 1 : cy; };
}

// ---------- sinais e conclusão de uma secção ----------
export function finalizeRows(raw, { order = 'dmy', yearOf, tipo = 'ordem', opening = null, useValueDate = false, invert = false, decimal = null } = {}) {
  const rows = []; let dropped = 0;
  const hasSplit = raw.some((r) => r.deb != null || r.cre != null);
  const amts = raw.filter((r) => r.amt);
  const anyNeg = amts.some((r) => r.amt.neg), anyPos = amts.some((r) => r.amt.pos), hasBal = raw.some((r) => r.saldo != null);
  const card = tipo === 'cartao';
  for (const r of raw) {
    const tok = useValueDate ? (r.tokVal || r.tokMov) : r.tokMov;
    const data = tok ? dateISO(tok, order, yearOf) : null;
    if (!data) { dropped++; continue; }
    let valor, certo = true, nota = '';
    if (hasSplit && (r.deb != null || r.cre != null)) valor = (r.cre || 0) - (r.deb || 0);
    else if (r.amt) {
      valor = r.amt.v;
      if (!r.amt.neg && !r.amt.pos && valor > 0) { // sem marca de sinal
        if (anyNeg) { /* a tabela marca os negativos: sem marca = positivo */ }
        else if (anyPos) valor = -valor; // só os créditos vêm marcados (CR/+): o resto são débitos
        else if (!hasBal) { const k = keywordSign(r.desc, { card }); if (k > 0) { /* entrada */ } else if (k < 0) valor = -valor; else { valor = -valor; certo = false; nota = 'palavras'; } }
      }
    } else continue;
    if (invert) valor = -valor;
    if (valor === 0) continue;
    const mo = r.orig && (r.orig.match(/(USD|GBP|CHF|JPY|BRL|\$|£)\s*$|^\s*(USD|GBP|CHF|JPY|BRL|\$|£)/i) || [])[0];
    rows.push({ data, desc: mo ? `${r.desc} (${r.orig.replace(/\s+/g, ' ').trim()})` : r.desc, valor, saldo: r.saldo, contaKey: '', contaLabel: '', semSinal: !certo, pagina: r.page, herdada: r.herdada || undefined, orig: r.orig || undefined, pais: r.pais || undefined, _tok: tok });
  }
  void decimal; void opening;
  return { rows, dropped, anyNeg, hasBal };
}

// ---------- análise de todo o documento ----------
// Devolve as secções (tabelas) lidas. ctx: { period, yearHint, region, implicit, layout, order, today }
export function extractSections(lines, ctx = {}) {
  const { pw } = prepare(lines);
  const hdrAt = findHeaders(lines);
  const hdrLines = new Set(); for (const h of hdrAt.values()) for (let k = h.i0; k <= h.i1; k++) hdrLines.add(k);
  const noise = markNoise(lines, hdrLines);
  const region = ctx.region || null;
  let secs;
  if (ctx.layout) { // layout manual/guardado: uma só tabela com todas as linhas
    const items = []; const skip = new Set(ctx.layout.skip || []);
    lines.forEach((L, i) => { if (noise[i] && !ctx.layout.keepNoise) return; if (region && region[i] !== 'free') return; L.sig = L.sig || sigOf(L); if (skip.has(L.sig)) return; if (L.isRow) items.push({ k: 'row', L }); else if (balanceLine(L)) { /* tratado abaixo */ } else if (L.nAmt) items.push({ k: 'other', L }); else items.push({ k: 'text', L }); });
    const sec = { hdr: null, items, opening: null, final: null, disp: null, pre: [], closed: true, hdrCount: 0 };
    lines.forEach((L, i) => { if (noise[i] || (region && region[i] !== 'free')) return; const bl = balanceLine(L); if (!bl) return; if (bl.kind === 'open' && sec.opening == null) sec.opening = bl.v; else if (bl.kind === 'close' && sec.final == null) sec.final = bl.v; else if (bl.kind === 'disp' && sec.disp == null) sec.disp = bl.v; });
    secs = [sec];
  } else {
    secs = scanSections(lines, { hdrAt, noise, region, implicit: !!ctx.implicit });
  }
  const out = [];
  const allToks = [];
  for (const sec of secs) {
    const cols = ctx.layout ? colsFromLayout(ctx.layout, pw) : resolveColumns(sec, pw);
    if (!cols) { out.push({ ...sec, cols: null, raw: [], ignoradas: 0 }); continue; }
    const { raw, ignoradas } = buildRaw(sec, cols, { skip: null, inheritDate: true });
    for (const r of raw) if (r.tokMov) allToks.push(r.tokMov);
    out.push({ ...sec, cols, raw, ignoradas });
  }
  const order = ctx.layout?.dateFmt && ctx.layout.dateFmt !== 'auto' ? ctx.layout.dateFmt : orderOf(allToks);
  return { sections: out, order, noise, hdrAt, pw };
}
export const sigOf = (L) => norm(L.text || '').replace(/\d/g, '9').replace(/\s+/g, ' ').trim().slice(0, 80);

// Cadeia de saldos + conclusão de uma secção já com datas resolvidas
export function concludeSection(sec, { order, yearOf, tipo, layout = null }) {
  const useValueDate = !!layout?.useValueDate;
  const fin = finalizeRows(sec.raw, { order, yearOf, tipo, useValueDate, invert: !!layout?.invert });
  const rows = fin.rows;
  const warnings = [];
  const chain = validateChain(rows, sec.opening);
  for (const r of rows) if (r.semSinal) r.valor = -Math.abs(r.valor);
  const still = rows.filter((r) => r.semSinal).length;
  if (still) warnings.push(`Em ${still} linha(s) não foi possível determinar se é entrada ou saída (assumida saída) — confirme na revisão (marcadas «sinal incerto»).`);
  if (chain.fixed) warnings.push(`Corrigi o sinal (entrada/saída) de ${chain.fixed} movimento${chain.fixed === 1 ? '' : 's'} com base na coluna de saldos do extrato.`);
  if (chain.inferidos) warnings.push(`O sinal de ${chain.inferidos} movimento${chain.inferidos === 1 ? '' : 's'} foi deduzido pela coluna de saldos.`);
  if (chain.broken) warnings.push(`${chain.broken} movimento${chain.broken === 1 ? '' : 's'} não bate${chain.broken === 1 ? '' : 'm'} certo com a coluna de saldos do extrato (pode faltar uma linha ou um valor foi mal lido).`);
  const soma = rows.reduce((a, r) => a + r.valor, 0);
  return { rows, chain, soma, warnings, dropped: fin.dropped, anyNeg: fin.anyNeg, hasBal: fin.hasBal };
}
