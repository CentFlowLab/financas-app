// Importar extratos — PDF (ciente de secções). Funções puras, sem DOM.
// Um extrato PDF pode ser «consolidado»: páginas de avisos, resumo de contas, o detalhe da conta à ordem (tabela com
// cabeçalhos repetidos em cada página), secções de crédito/empréstimo, etc. Só as tabelas de movimentos de contas
// (ordem, poupança, …) viram movimentos; os créditos são devolvidos como sugestões de dívidas; o resto é ignorado.
import { norm } from '../util.js';
import { parseAmount, parseDate, findIban, detectBank, guessAccountType, validateChain, hclean } from './parse.js';

const firstCell = (l) => (l.cells && l.cells[0] ? l.cells[0].s : l.text).trim();
const D_FULL = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2} (?:de )?[A-Za-zçÇ]{3,9}\\.? (?:de )?\\d{2,4})';
const D_SHORT = '\\d{1,2}[-/.]\\d{1,2}(?![-/.\\d])'; // «dd-mm» sem ano (o ano vem do período do extrato)
const rowDateRe = (short) => { const t = short ? `(?:${D_FULL}|${D_SHORT})` : D_FULL; return new RegExp(`^\\s*(${t})(?:\\s+(${t}))?(?=\\s|$)\\s*(.*)$`, 'i'); };
const AMT = /(?<![\d.,])[-+−]?\(?\d{1,3}(?:[. \u00a0]\d{3})*[,.]\d{2}\)?-?(?:\s?(?:€|EUR))?(?:\s?(?:CR|DB|C|D))?(?![\d,.])/g;
const AMT_FULL = /^[-+−]?\(?\d{1,3}(?:[. \u00a0]\d{3})*[,.]\d{2}\)?-?(?:\s?(?:€|EUR))?(?:\s?(?:CR|DB|C|D))?$/;
const DATE_CELL = /^(?:\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?|\d{4}-\d{2}-\d{2})$/;
const lastAmt = (text) => { const m = [...text.matchAll(AMT)]; return m.length ? parseAmount(m[m.length - 1][0], 'comma') : NaN; };
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
const validDay = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'à']);
const title = (s) => String(s).toLowerCase().split(/\s+/).map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
const sentence = (s) => { const t = String(s).toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

// ---------- ruído: cabeçalhos/rodapés de página, «Continua» ----------
function lineKind(l) {
  const T = l.text;
  if (/^EXTRATO\s+N[ºo°.]?\s*\d+/i.test(T) && /P[ÁA]GINA\s+\d+\s*[/de]+\s*\d+/i.test(T)) return 'header';
  if (/\bCapital Social\b/i.test(T) && /C\.?R\.?C\.?|NIPC|Sede Social/i.test(T)) return 'footer';
  if (/^P[áa]gina\s+\d+\s*(?:\/|de)\s*\d+\s*$/i.test(T)) return 'footer';
  if (/^(Continua|Continua[çc][ãa]o)\s*$/i.test(T)) return 'cont';
  return '';
}

// ---------- período, IBAN, nome do produto ----------
function findPeriod(text) {
  const D = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4})';
  const m = text.match(new RegExp(`PER[ÍI]ODO\\s*(?:DE|:)?\\s*${D}\\s*(?:A|AT[ÉE]|-|–|/)\\s*${D}`, 'i'));
  if (!m) return null;
  const ini = parseDate(m[1]), fim = parseDate(m[2]);
  return ini && fim ? { ini, fim } : null;
}
function extractMeta(lines, fileName) {
  const head = lines.filter((l) => lineKind(l) === 'header');
  let period = null, acctNo = null, extratoNo = null;
  for (const l of head) {
    period ||= findPeriod(l.text);
    const a = l.text.match(/CONTA\s+N[ºo°.]*\s*:?\s*(\d[\d.\- ]{6,22}\d)/i); if (a && !acctNo) acctNo = a[1].replace(/\D/g, '');
    const e = l.text.match(/EXTRATO\s+N[ºo°.]?\s*(\d+)/i); if (e && !extratoNo) extratoNo = e[1];
  }
  if (!period) for (const l of lines.slice(0, 80)) { period = findPeriod(l.text); if (period) break; }
  const text80 = lines.slice(0, 80).map((l) => l.text).join('\n');
  const iban = findIban(text80);
  let produto = '';
  const iNib = lines.findIndex((l, i) => i < 80 && /^(N\.?\s?I\.?\s?B\.?\s*:|IBAN\s*:)/i.test(firstCell(l)));
  for (let k = iNib - 1; iNib > 0 && k >= Math.max(0, iNib - 2); k--) {
    const t = firstCell(lines[k]);
    if (/^[A-ZÀ-ÝÇ][A-ZÀ-ÝÇ0-9 .&-]{3,48}$/.test(t) && !/EXTRATO|BANCO|N\.?I\.?B/.test(t)) { produto = t; break; }
  }
  const all = lines.map((l) => l.text).join('\n');
  return { iban, acctNo, period, extratoNo, produto: produto ? title(produto) : '', bank: detectBank(all.slice(0, 4000) + ' ' + fileName), title: '' };
}

// ---------- secções ----------
const H_CONTA = /^Detalhe de Movimentos d[aeo]s?\s+(.+)$/i; // «…da Conta à Ordem»
const H_LOAN_START = /^Conta Empr[ée]stimo\s*$/i;
const H_LOAN = /^(?:Empr[ée]stimo|Cr[ée]dito|Financiamento)\s+(.+?)\s+N[úu]mero:?\s*(\d[\d.\- ]*\d)/i;
const digits = (s) => String(s || '').replace(/\D/g, '');

function splitSections(body) {
  const secs = [], orphans = []; let cur = null;
  const open = (tipo, extra = {}) => { cur = { tipo, lines: [], tab: false, ...extra }; secs.push(cur); return cur; };
  for (const l of body) {
    const t = firstCell(l); let m;
    if (/^Resumo das Contas/i.test(t)) { open('resumo'); continue; }
    if ((m = t.match(H_CONTA)) && !/^\s*$/.test(m[1])) {
      if (cur && cur.tipo === 'conta' && cur.tab && norm(cur.titulo) === norm(m[1])) continue; // título repetido numa nova página
      open('conta', { titulo: m[1].trim(), tab: true }); continue;
    }
    if (H_LOAN_START.test(t)) { open('emprestimo', { pend: true }); continue; }
    if ((m = t.match(H_LOAN))) {
      const num = digits(m[2]);
      if (cur && cur.tipo === 'emprestimo' && (cur.pend || cur.numero === num)) { cur.pend = false; cur.produto = m[1].trim(); cur.numero = num; cur.numeroTxt = m[2].trim(); }
      else open('emprestimo', { produto: m[1].trim(), numero: num, numeroTxt: m[2].trim() });
      cur.lines.push(l); continue;
    }
    (cur ? cur.lines : orphans).push(l);
  }
  return { secs, orphans };
}

// ---------- datas «dd-mm» sem ano ----------
function resolveDate(tok, period, order = 'dmy') {
  const s = tok.trim();
  const sm = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (!sm) return parseDate(s, order);
  const d = order === 'mdy' ? +sm[2] : +sm[1], mo = order === 'mdy' ? +sm[1] : +sm[2];
  if (!period) return null;
  const ys = [...new Set([+period.ini.slice(0, 4), +period.fim.slice(0, 4)])];
  let best = null, bd = Infinity;
  for (const y of ys) {
    if (!validDay(y, mo, d)) continue;
    const iso = ymd(y, mo, d);
    const dist = iso < period.ini ? (new Date(period.ini) - new Date(iso)) : iso > period.fim ? (new Date(iso) - new Date(period.fim)) : 0;
    if (dist < bd) { bd = dist; best = iso; }
  }
  return best;
}

// ---------- tabela de movimentos de uma conta ----------
function findAnchors(l) {
  const cs = (l.cells || []).map((c) => ({ ...c, n: hclean(c.s) }));
  const d = cs.find((c) => /^(debito|debit)\b/.test(c.n)), c = cs.find((x) => /^(credito|credit)\b/.test(x.n));
  const v = [...cs].reverse().find((x) => /^(valor|montante|importe|quantia|amount)$/.test(x.n));
  const s = cs.find((x) => /^saldo\b|^balance\b/.test(x.n));
  const mid = (x) => (x ? (x.x + x.x2) / 2 : null);
  if (d && c) return { debito: mid(d), credito: mid(c), saldo: mid(s) };
  if (v && s) return { valor: mid(v), saldo: mid(s) };
  return null;
}
const explicitSign = (s) => /^[-+−(]/.test(s.trim()) || /[-)]\s*(?:€|EUR)?$/.test(s.trim()) || /(?:CR|DB|C|D)$/i.test(s.trim());

function parseTable(sec, ctx) {
  const rowRe = rowDateRe(!!ctx.period);
  let anchors = null, tab = !!(sec.tab || sec.implicit), last = null;
  let opening = null, final = null, disp = null;
  const raw = [], allAmts = []; let ignoradas = 0;
  for (const l of sec.lines) {
    const T = l.text;
    if (!anchors && tab) anchors = findAnchors(l);
    if (tab && /^Saldo\s+(?:inicial|anterior|transportado)\b/i.test(T) && opening == null) { const v = lastAmt(T); if (!Number.isNaN(v)) { opening = v; last = null; continue; } }
    if (/^Saldo\s+(?:contabil[ií]stico\s+final|final)\b/i.test(T) && final == null) { const v = lastAmt(T); if (!Number.isNaN(v)) { final = v; tab = false; last = null; continue; } }
    if (/^Saldo\s+dispon[ií]vel\s+final\b/i.test(T)) { const v = lastAmt(T); if (!Number.isNaN(v)) disp = v; continue; }
    if (!tab) continue;
    const m = T.match(rowRe);
    if (!m) {
      if (last && !last.cont && l.text.length <= 60 && !/saldo|p[aá]gina|total|extrato|iban|nib|d[ée]bito|cr[ée]dito|descritivo/i.test(T) && !(T.match(AMT) || []).length && !DATE_CELL.test(firstCell(l))
        && (last.descX == null || !l.cells?.[0] || Math.abs(l.cells[0].x - last.descX) <= 8)) { last.desc += ' ' + T.trim(); last.cont = true; }
      continue;
    }
    const rest = m[3];
    const ms = [...rest.matchAll(AMT)];
    const tail = [];
    for (let i = ms.length - 1; i >= 0; i--) {
      const after = rest.slice(ms[i].index + ms[i][0].length, i === ms.length - 1 ? undefined : ms[i + 1].index);
      if (/^\s*$/.test(after)) tail.unshift(ms[i]); else break;
    }
    if (!tail.length) { last = null; ignoradas++; continue; }
    const desc = rest.slice(0, tail[0].index).replace(/\s+/g, ' ').replace(/\s+(?:EUR|EURO)$/i, '').trim();
    const cells = l.cells || [];
    const tcells = []; for (let i = cells.length - 1; i >= 0 && AMT_FULL.test(cells[i].s.trim()); i--) tcells.unshift(cells[i]);
    const xs = tcells.length === tail.length ? tcells.map((c) => (c.x + c.x2) / 2) : null;
    const items = tail.map((t, i) => ({ s: t[0], x: xs ? xs[i] : null }));
    const dc = cells.find((c) => !DATE_CELL.test(c.s.trim()));
    raw.push({ tok: m[1], desc, items, cont: false, descX: dc ? dc.x : null, page: l.page });
    last = raw[raw.length - 1];
    for (const it of items) allAmts.push(it.s);
  }
  const style = 'comma';
  const rows = []; let unsigned = 0;
  for (const r of raw) {
    const data = resolveDate(r.tok, ctx.period);
    if (!data) continue;
    const nums = r.items.map((it) => ({ ...it, v: parseAmount(it.s, style) })).filter((it) => !Number.isNaN(it.v));
    if (!nums.length) continue;
    let valor = null, saldo = null, certo = false;
    if (anchors && nums.every((n) => n.x != null)) {
      const cand = ['debito', 'credito', 'valor', 'saldo'].filter((k) => anchors[k] != null);
      const near = (x) => cand.slice().sort((a, b) => Math.abs(anchors[a] - x) - Math.abs(anchors[b] - x))[0];
      let d = 0, c = 0, v = 0, has = false;
      for (const n of nums) { const k = near(n.x); if (k === 'saldo') saldo = n.v; else if (k === 'debito') { d += Math.abs(n.v); has = true; } else if (k === 'credito') { c += Math.abs(n.v); has = true; } else { v += n.v; has = true; } }
      if (has) { valor = c - d + v; certo = true; }
    }
    if (valor == null) {
      if (nums.length >= 2) { saldo = nums[nums.length - 1].v; const a = nums[nums.length - 2]; valor = a.v; certo = explicitSign(a.s); } else { valor = nums[0].v; certo = explicitSign(nums[0].s); }
    }
    if (valor === 0) continue;
    rows.push({ data, desc: r.desc, valor, saldo, contaKey: '', contaLabel: '', semSinal: !certo, pagina: r.page });
    if (!certo) unsigned++;
  }
  const chain = validateChain(rows, opening);
  const warnings = [];
  const still = rows.filter((r) => r.semSinal).length;
  if (still) warnings.push(`Em ${still} linha(s) não foi possível determinar se é entrada ou saída (assumida saída) — confirme na revisão.`);
  for (const r of rows) if (r.semSinal) r.valor = -Math.abs(r.valor);
  if (chain.fixed) warnings.push(`Corrigi o sinal (entrada/saída) de ${chain.fixed} movimento${chain.fixed === 1 ? '' : 's'} com base na coluna de saldos do extrato.`);
  if (chain.inferidos) warnings.push(`O sinal de ${chain.inferidos} movimento${chain.inferidos === 1 ? '' : 's'} foi deduzido pela coluna de saldos.`);
  if (chain.broken) warnings.push(`${chain.broken} movimento${chain.broken === 1 ? '' : 's'} não bate${chain.broken === 1 ? '' : 'm'} certo com a coluna de saldos do extrato (pode faltar uma linha ou um valor foi mal lido).`);
  const soma = rows.reduce((a, r) => a + r.valor, 0);
  return { rows, opening, final, disp, anchors, chain, soma, ignoradas, warnings };
}

// ---------- créditos / empréstimos ----------
const pctNum = (s) => { const m = String(s || '').match(/(\d+(?:[.,]\d+)?)\s*%/); return m ? parseFloat(m[1].replace(',', '.')) : null; };
function parseLoan(sec, ctx) {
  const kv = {}; let tab = false, opening = null, final = null, amort = 0, nPrest = 0, nReemb = 0, prox = null, afterProx = false;
  for (const l of sec.lines) {
    const t = firstCell(l);
    for (const c of l.cells || []) {
      const m = c.s.trim().match(/^(Tx\.? Juro Aplicada|Capital Concedido|Capital Vincendo|Capital Vencido Pago|Capital Vencido N[ãa]o Pago|Prazo|Data Formaliza[çc][ãa]o)\s*:\s*(.+)$/i);
      if (m) kv[norm(m[1]).replace(/[^a-z ]/g, '').trim()] = m[2].trim();
    }
    if (/^Detalhe de Movimentos\s*$/i.test(t)) { tab = true; afterProx = false; continue; }
    if (/^Pr[óo]xima Presta[çc][ãa]o/i.test(t)) { tab = false; afterProx = true; continue; }
    if (/^(Reembolso antecipado|Detalhe da Presta)/i.test(t)) { tab = false; continue; }
    if (afterProx && !prox) {
      const m = l.text.match(/^\s*(\d{4}-\d{2}-\d{2})\s+(\d+)\s/);
      if (m) { const cs = (l.cells || []).filter((c) => AMT_FULL.test(c.s.trim())); const tot = cs.length ? parseAmount(cs[cs.length - 1].s, 'comma') : NaN; prox = { data: m[1], numero: +m[2], tan: pctNum(l.text), prestacao: Number.isNaN(tot) ? null : tot }; }
      continue;
    }
    if (!tab) continue;
    const m = l.text.match(rowDateRe(false));
    if (!m) continue;
    const rest = m[3], v = lastAmt(rest);
    if (/^Saldo\s+Inicial/i.test(rest)) { if (!Number.isNaN(v)) opening = v; continue; }
    if (/^Saldo\s+Final/i.test(rest)) { if (!Number.isNaN(v)) final = v; tab = false; continue; }
    if (/^PRESTA[ÇC][ÃA]O/i.test(rest)) nPrest++;
    const amts = (l.cells || []).filter((c) => AMT_FULL.test(c.s.trim()));
    if (/^(CAPITAL|REEMBOLSO ANTECIPADO)\b/i.test(rest) && amts.length >= 2) { if (/^REEMBOLSO/i.test(rest)) nReemb++; const a = parseAmount(amts[0].s, 'comma'); if (!Number.isNaN(a)) amort += Math.abs(a); }
  }
  const money = (k) => { const v = kv[k] != null ? parseAmount(kv[k], 'comma') : NaN; return Number.isNaN(v) ? null : Math.abs(v); };
  const vinc = money('capital vincendo');
  const saldoFinal = final != null ? Math.abs(final) : vinc;
  if (saldoFinal == null) return null;
  const concedido = money('capital concedido');
  const prazo = kv.prazo ? parseInt(kv.prazo, 10) || null : null;
  const taxa = pctNum(kv['tx juro aplicada']) ?? prox?.tan ?? null;
  const total = Math.max(concedido ?? 0, opening != null ? Math.abs(opening) : 0, saldoFinal);
  const produto = sentence(sec.produto || 'Crédito');
  return {
    ref: sec.numero, numero: sec.numeroTxt, produto, saldoInicial: opening != null ? Math.abs(opening) : null, saldoAtual: saldoFinal, total,
    totalEstimado: concedido == null, taxa, prazoMeses: prazo, prestacao: prox?.prestacao ?? null, proxima: prox, amortizado: opening != null && final != null ? Math.abs(opening) - Math.abs(final) : amort,
    nPrestacoes: nPrest, nReembolsos: nReemb, periodo: ctx.period,
  };
}

// ---------- resumo das contas (verificação cruzada) ----------
function parseResumo(sec) {
  let prev = '', dep = null, resp = null;
  for (const l of sec.lines) {
    const isTotal = /^TOTAL\b/i.test(firstCell(l)) || /^\s*TOTAL\s+-?\d/i.test(l.text);
    if (isTotal) { const v = lastAmt(l.text); if (!Number.isNaN(v)) { if (/DEP[ÓO]SITOS?/i.test(prev) && dep == null) dep = v; else if (/RESPONSABILIDADES|CR[ÉE]DITO|EMPR[ÉE]STIMO/i.test(prev) && resp == null) resp = v; } continue; }
    if (!Number.isNaN(lastAmt(l.text))) prev = l.text;
  }
  return { depositos: dep, responsabilidades: resp };
}

// ---------- entrada principal ----------
export function parseStatementLines(lines, fileName = '') {
  const meta = extractMeta(lines, fileName);
  const body = lines.filter((l) => !lineKind(l));
  const { secs, orphans } = splitSections(body);
  const ctx = { period: meta.period };
  const warnings = [];
  const contas = secs.filter((s) => s.tipo === 'conta');
  if (!contas.length) { // PDF «simples»: toda a página é uma tabela (sem secções reconhecidas)
    const lines2 = [...orphans, ...secs.filter((s) => s.tipo === 'resumo').flatMap((s) => s.lines)];
    contas.push({ tipo: 'conta', titulo: '', implicit: true, tab: true, lines: lines2 });
  }
  const rows = [], accounts = {}, secoes = [];
  let anchors = false;
  for (const s of contas) {
    const t = parseTable(s, ctx);
    anchors ||= !!t.anchors;
    const own = digits((s.lines.slice(0, 4).map((l) => l.text).join(' ').match(/\b\d{4}\.\d{11}\b/) || [''])[0]);
    const main = !own || (meta.acctNo && (meta.acctNo === own || meta.acctNo.endsWith(own) || own.endsWith(meta.acctNo)));
    const key = main ? (meta.iban || '') : 'conta:' + own;
    const tipo = guessAccountType(s.titulo || '');
    const nome = main ? (meta.produto || (s.titulo && !/ordem/i.test(s.titulo) ? s.titulo : '')) : title(s.titulo || '');
    for (const r of t.rows) { r.contaKey = key; r.contaLabel = key.startsWith('conta:') ? (nome || 'Conta ' + own) : ''; rows.push(r); }
    const prevA = accounts[key];
    const periodo = ctx.period || (t.rows.length ? { ini: t.rows.map((r) => r.data).sort()[0], fim: t.rows.map((r) => r.data).sort().pop() } : null);
    if (prevA && t.rows.length === 0) continue; // título repetido sem movimentos
    accounts[key] = {
      key, iban: key === meta.iban ? meta.iban : null, acctNo: main ? meta.acctNo : own, label: nome, nome: nome || null, tipo,
      opening: t.opening, final: t.final, disp: t.disp, periodo, chain: t.chain, soma: t.soma,
      ledger: t.final != null && t.opening == null ? { valor: t.final, data: periodo?.fim || null } : null,
    };
    if (t.opening != null && t.final != null) {
      const diff = t.final - (t.opening + t.soma);
      accounts[key].diffExtrato = diff;
      if (diff !== 0) warnings.push(`A soma dos movimentos lidos não fecha com os saldos do extrato (diferença ${(diff / 100).toFixed(2).replace('.', ',')} €).`);
    }
    for (const w of t.warnings) warnings.push(w);
    secoes.push({ tipo: 'conta', titulo: s.titulo || meta.produto || 'Movimentos', n: t.rows.length, key });
  }
  const debts = [];
  for (const s of secs.filter((x) => x.tipo === 'emprestimo')) {
    const d = parseLoan(s, ctx); if (!d) continue;
    debts.push(d); secoes.push({ tipo: 'emprestimo', titulo: `${d.produto} …${digits(d.numero).slice(-4)}`, n: 0 });
  }
  const resumoSec = secs.find((s) => s.tipo === 'resumo');
  const resumo = resumoSec ? parseResumo(resumoSec) : null;
  if (resumo) {
    const dep = Object.values(accounts).reduce((a, x) => a + (x.final ?? 0), 0);
    if (resumo.depositos != null && Object.values(accounts).some((x) => x.final != null) && dep !== resumo.depositos) warnings.push('O «Resumo das Contas» indica um total de depósitos diferente da soma dos saldos finais das contas lidas — pode haver contas no extrato que não foram reconhecidas.');
    const resp = debts.reduce((a, d) => a + d.saldoAtual, 0);
    if (resumo.responsabilidades != null && debts.length && Math.abs(resumo.responsabilidades) !== resp) warnings.push('A soma dos créditos detetados não coincide com as «Responsabilidades» do Resumo das Contas — confirme os valores das dívidas.');
  }
  const primeira = Object.values(accounts)[0];
  const moedas = contas.map((s) => s.lines.slice(0, 3).map((l) => l.text).join(' ').match(/Moeda:\s*([A-Z]{3})/)?.[1]).filter((m) => m && m !== 'EUR');
  if (moedas.length) warnings.push(`Uma secção está em ${moedas[0]} (não EUR): confirme os valores.`);
  return {
    rows, meta: { iban: meta.iban, acctNo: meta.acctNo, bank: meta.bank, title: meta.produto }, warnings, ignored: [], anchors,
    accounts, debts, secoes, resumo, periodo: meta.period, extratoNo: meta.extratoNo, consolidado: secs.length > 0,
    chain: primeira?.chain || null,
  };
}
