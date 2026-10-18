// Importar extratos — extratos em PDF/imagem (texto com posições). Funções puras, sem DOM.
// Pipeline genérico (layout.js): cabeçalhos de tabela PT/EN/ES, colunas por posição, secções (várias contas/cartões), datas/valores/sinais,
// cadeia de saldos. Os «hints» de bancos específicos (ex.: secções «Empréstimo … Número:» do Santander) são reforços opcionais: créditos
// viram sugestões de dívidas e «Resumo das Contas» serve de verificação cruzada.
import { norm } from '../util.js';
import { parseAmount, parseDate, findIban, detectBank, guessAccountType, hclean } from './parse.js';
import { MONTHS } from './parse.js';
import { datesIn, isAmt } from './tokens.js';
import { detectCard, parseCardInfo, validateCard } from './cardstatement.js';
import { extractSections, concludeSection, makeYearOf, isHeading, layoutFromCols, colsFromLayout, prepare, sigOf, findHeaders } from './layout.js';

const firstCell = (l) => (l.cells && l.cells[0] ? l.cells[0].s : l.text).trim();
const D_FULL = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2} (?:de )?[A-Za-zçÇ]{3,9}\\.? (?:de )?\\d{2,4})';
const rowDateRe = (short) => { const t = short ? `(?:${D_FULL}|\\d{1,2}[-/.]\\d{1,2}(?![-/.\\d]))` : D_FULL; return new RegExp(`^\\s*(${t})(?:\\s+(${t}))?(?=\\s|$)\\s*(.*)$`, 'i'); };
const AMT = /(?<![\d.,])[-+−]?\(?\d{1,3}(?:[. \u00a0]\d{3})*[,.]\d{2}\)?-?(?:\s?(?:€|EUR))?(?:\s?(?:CR|DB|C|D))?(?![\d,.])/g;
const AMT_FULL = /^[-+−]?\(?\d{1,3}(?:[. \u00a0]\d{3})*[,.]\d{2}\)?-?(?:\s?(?:€|EUR))?(?:\s?(?:CR|DB|C|D))?$/;
const lastAmt = (text) => { const m = [...text.matchAll(AMT)]; return m.length ? parseAmount(m[m.length - 1][0], 'comma') : NaN; };
const SMALL = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'à']);
const title = (s) => String(s).toLowerCase().split(/\s+/).map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
const sentence = (s) => { const t = String(s).toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
const digits = (s) => String(s || '').replace(/\D/g, '');
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const MONRE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

// ---------- período, IBAN, nome do produto ----------
function findPeriod(lines) {
  let best = null, bs = -1;
  lines.slice(0, 140).forEach((l, i) => {
    const ds = datesIn(l.text); if (ds.length < 2) return;
    const between = l.text.slice(ds[0].idx + ds[0].len, ds[1].idx).trim();
    if (!/^(a|at[ée]|to|until|-|–|—|\/|e|and|al|a)$/i.test(between)) return;
    if (ds[0].iso > ds[1].iso) return;
    const sc = (/per[ií]odo|period|from|desde/i.test(l.text) ? 3 : 0) + (/extrato|statement|movimentos/i.test(l.text) ? 1 : 0) + (i < 12 ? 1 : 0) - (l.text.length > 110 ? 3 : 0);
    if (sc > bs) { bs = sc; best = { ini: ds[0].iso, fim: ds[1].iso }; }
  });
  if (best && bs >= 0) return best;
  const re = new RegExp(`(?:extrato|statement|per[ií]odo|period|movimentos|mes|month)[^\\n]{0,40}?\\b(${MONRE})[a-z]*\\.?\\s+(?:de\\s+)?(20\\d{2})\\b`, 'i');
  for (const l of lines.slice(0, 60)) {
    const m = norm(l.text).match(re); if (!m || !MONTHS[m[1]]) continue;
    const y = +m[2], mo = MONTHS[m[1]], last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { ini: `${y}-${String(mo).padStart(2, '0')}-01`, fim: `${y}-${String(mo).padStart(2, '0')}-${last}`, mes: true };
  }
  return null;
}
function yearHintOf(lines, fileName) {
  const cnt = new Map();
  for (const l of lines.slice(0, 80)) for (const m of l.text.matchAll(/(?<![\d.,])(20\d{2})(?![\d])/g)) cnt.set(+m[1], (cnt.get(+m[1]) || 0) + 1);
  const best = [...cnt].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  if (best) return best[0];
  const f = String(fileName).match(/(?<!\d)(20\d{2})(?!\d)/); return f ? +f[1] : null;
}
function extractMeta(lines, fileName) {
  const head = lines.slice(0, 90);
  let acctNo = null, extratoNo = null;
  for (const l of head) {
    const a = l.text.match(/(?:\bconta|\baccount)\s*(?:n[ºo°.]*|number|no\.?)\s*:?\s*(\d[\d.\- ]{6,22}\d)/i); if (a && !acctNo) acctNo = a[1].replace(/\D/g, '');
    const e = l.text.match(/EXTRATO\s+N[ºo°.]?\s*(\d+)/i); if (e && !extratoNo) extratoNo = e[1];
  }
  const period = findPeriod(lines);
  const iban = findIban(head.map((l) => l.text).join('\n'));
  let produto = '';
  const iNib = lines.findIndex((l, i) => i < 90 && /^(N\.?\s?I\.?\s?B\.?\s*:|IBAN\s*:)/i.test(firstCell(l)));
  for (let k = iNib - 1; iNib > 0 && k >= Math.max(0, iNib - 2); k--) {
    const t = firstCell(lines[k]);
    if (/^[A-ZÀ-ÝÇ][A-ZÀ-ÝÇ0-9 .&-]{3,48}$/.test(t) && !/EXTRATO|BANCO|N\.?I\.?B/.test(t)) { produto = t; break; }
  }
  const all = lines.map((l) => l.text).join('\n');
  return { iban, acctNo, period, extratoNo, produto: produto ? title(produto) : '', bank: detectBank(all.slice(0, 4000) + ' ' + fileName), yearHint: yearHintOf(lines, fileName) };
}

// ---------- regiões: resumo de contas e secções de crédito/empréstimo (hints opcionais) ----------
const H_LOAN_START = /^Conta Empr[ée]stimo\s*$/i;
const H_LOAN = /^(?:Empr[ée]stimo|Cr[ée]dito|Financiamento)\s+(.+?)\s+N[úu]mero:?\s*(\d[\d.\- ]*\d)/i;
const H_RESUMO = /^(Resumo das Contas|Resumo de Contas|Account summary|Summary of accounts)/i;
const H_BACK = /^(detalhe de movimentos d[aeo]s?\s+\S+|conta (à|a) ordem\b|conta poupan|cart[ãa]o\b|poupan[çc]a\b|account (activity|statement)|current account|savings account)/i;
function classify(lines, hdrAt) {
  const region = new Array(lines.length).fill('free'); const loans = []; const resumoLines = [];
  let cur = null; // 'resumo' | loan object
  lines.forEach((l, i) => {
    const t = firstCell(l); let m;
    if (H_RESUMO.test(t)) { cur = 'resumo'; }
    else if (H_LOAN_START.test(t)) { cur = { pend: true, lines: [] }; loans.push(cur); }
    else if ((m = t.match(H_LOAN))) {
      const num = digits(m[2]);
      if (cur && cur !== 'resumo' && (cur.pend || cur.numero === num)) { cur.pend = false; cur.produto = m[1].trim(); cur.numero = num; cur.numeroTxt = m[2].trim(); }
      else { cur = { produto: m[1].trim(), numero: num, numeroTxt: m[2].trim(), lines: [] }; loans.push(cur); }
    } else if (cur && H_BACK.test(t) && !l.nAmt && [...Array(9).keys()].some((k) => hdrAt.has(i + k))) cur = null;
    if (cur === 'resumo') { region[i] = 'resumo'; resumoLines.push(l); }
    else if (cur) { region[i] = 'loan'; cur.lines.push(l); }
  });
  return { region, loans: loans.filter((x) => !x.pend), resumoLines };
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
function parseResumo(lines) {
  let prev = '', dep = null, resp = null;
  for (const l of lines) {
    const isTotal = /^TOTAL\b/i.test(firstCell(l)) || /^\s*TOTAL\s+-?\d/i.test(l.text);
    if (isTotal) { const v = lastAmt(l.text); if (!Number.isNaN(v)) { if (/DEP[ÓO]SITOS?/i.test(prev) && dep == null) dep = v; else if (/RESPONSABILIDADES|CR[ÉE]DITO|EMPR[ÉE]STIMO/i.test(prev) && resp == null) resp = v; } continue; }
    if (!Number.isNaN(lastAmt(l.text))) prev = l.text;
  }
  return { depositos: dep, responsabilidades: resp };
}

// ---------- identidade e título de uma tabela (linhas antes do cabeçalho) ----------
const GENERIC_TITLE = /^(extrato|movimentos|statement|account (activity|statement)|transactions?|detalhe de movimentos)\b/i;
function sectionInfo(sec) {
  const pre = sec.pre.slice(-12);
  const head = [...pre].reverse().find((l) => isHeading(l) && !/\d{4}|\*{2}/.test(l.text));
  let titulo = head ? head.text.trim().replace(/^detalhe de movimentos\s+d[aeo]s?\s+/i, '').replace(/\s{2,}.*$/, '') : '';
  if (GENERIC_TITLE.test(titulo) || /\d{6,}|\biban\b|\bPT\d{2}\b/i.test(titulo)) titulo = '';
  const txt = pre.map((l) => l.text).join('\n');
  const iban = findIban(txt);
  const a = txt.match(/\b(\d{4}\.\d{11})\b/) || txt.match(/(?:\bconta|\baccount)\s*(?:n[ºo°.]*|number|no\.?)\s*:?\s*(\d[\d.\- ]{6,22}\d)/i);
  const card = (txt.match(/(?:cart[ãa]o|card)[^\n\d]{0,30}(?:[\d*•xX.\-\s]{0,24}?)(\d{4})\b/i) || txt.match(/\*{2,}\s?(\d{4})\b/) || [])[1] || null;
  return { titulo, iban, acctNo: a ? digits(a[1]) : null, card, ctx: pre.filter((l) => isHeading(l)).map((l) => l.text).join(' ') };
}

// ---------- confiança ----------
function confidence({ metodo, nRows, chains, recon, semSinal, dropped, ocr }) {
  const motivos = []; let pts = metodo === 'cabecalho' ? 55 : metodo === 'heuristica' ? 45 : 50;
  if (!nRows) return { nivel: 'baixa', pontos: 0, motivos: ['Não encontrei movimentos.'] };
  if (metodo === 'heuristica') motivos.push('Não encontrei um cabeçalho de tabela; usei linhas com data e valor.');
  const ck = chains.reduce((a, c) => a + c.checked, 0), ok = chains.reduce((a, c) => a + c.ok + c.fixed, 0);
  if (ck >= 3) { const r = ok / ck; if (r >= 0.95) { pts += 30; motivos.push('A coluna de saldos confirma os valores.'); } else if (r >= 0.8) pts += 12; else { pts -= 25; motivos.push('A coluna de saldos não bate certo em várias linhas.'); } }
  if (recon.n) { if (recon.bad) { pts -= 30; motivos.push('A soma dos movimentos não fecha com os saldos do extrato.'); } else { pts += 25; motivos.push('A soma fecha com o saldo inicial e final do extrato.'); } }
  const ss = semSinal / nRows; if (ss > 0.5) { pts -= 35; motivos.push('Não consegui perceber o sinal (entrada/saída) da maioria das linhas.'); } else if (ss > 0.25) pts -= 12; else if (semSinal) pts -= 2;
  if (dropped / (nRows + dropped) > 0.15) { pts -= 20; motivos.push('Várias linhas ficaram sem data válida.'); }
  if (nRows < 3) pts -= 15;
  let nivel = pts >= 70 ? 'alta' : pts >= 45 ? 'media' : 'baixa';
  if (ocr && nivel === 'alta') { nivel = 'media'; motivos.push('Texto lido por OCR (reconhecimento ótico): melhor esforço.'); }
  return { nivel, pontos: pts, motivos };
}

// ---------- impressões digitais (layout memorizado) ----------
const MASK = new RegExp(`\\b(${MONRE})[a-z]*\\b`, 'g');
function fingerprints(lines, meta, hdrs, ocr) {
  const fps = []; const pfx = (meta.iban || '').slice(0, 8);
  const h = hdrs[0];
  if (h) { const k = hash(h.labels + (ocr ? '|ocr' : '')); if (pfx) fps.push(`h:${k}|${pfx}`); fps.push(`h:${k}`); }
  const top = lines.filter((l) => l.page === (lines[0]?.page ?? 1)).slice(0, 4).map((l) => norm(l.text).replace(MASK, 'M').replace(/\d/g, '9').replace(/\s+/g, ' ').slice(0, 60)).join('~');
  fps.push(`t:${hash(top + (meta.bank?.id || '') + (ocr ? '|ocr' : ''))}`);
  return fps;
}

// ---------- entrada principal ----------
// opts: { layout (manual), layouts (memorizados: { fp: layout }), implicit, ocr, today }
export function parseStatementLines(lines, fileName = '', opts = {}) {
  prepare(lines, { dotDates: !!opts.layout?.dotDates });
  const meta = extractMeta(lines, fileName);
  const hdrAt0 = findHeaders(lines);
  const { region, loans, resumoLines } = classify(lines, hdrAt0);
  const warnings = [];
  const period = meta.period;
  const run = (o) => extractSections(lines, { region, ...o });
  let layout = opts.layout || null, usadoGuardado = null;
  const hdrs0 = [...hdrAt0.values()];
  const fps0 = fingerprints(lines, meta, hdrs0, !!opts.ocr);
  if (!layout && opts.layouts) { const k = fps0.find((f) => opts.layouts[f]); if (k) { layout = opts.layouts[k]; usadoGuardado = k; } }
  let metodo = layout ? (opts.layout ? 'manual' : 'guardado') : 'cabecalho';
  let ex = run({ layout });
  let withRows = ex.sections.filter((s) => s.raw.length);
  if (!layout && withRows.reduce((a, x) => a + x.raw.length, 0) < 3) { // cabeçalho não reconhecido (ou quase sem linhas): tentar linhas com data + valor
    const ex2 = run({ implicit: true }); const w2 = ex2.sections.filter((s) => s.raw.length);
    if (w2.reduce((a, x) => a + x.raw.length, 0) > withRows.reduce((a, x) => a + x.raw.length, 0)) { ex = ex2; withRows = w2; metodo = 'heuristica'; }
  }
  const yearOf = makeYearOf({ period, today: opts.today });
  // extrato de cartão de crédito (palavras-chave + resumo da conta): uma só conta de cartão, dívida = saldo negativo
  const cardDet = detectCard(lines);
  const cinfo = cardDet.isCard ? parseCardInfo(lines) : null;
  const cardMode = !!cinfo && (!layout?.tipo || layout.tipo === 'cartao');
  const cardKey = cardMode ? (cinfo.chave || (cinfo.iban ? 'cartao-iban:' + cinfo.iban : 'cartao:extrato')) : null;
  const cardNome = cardMode ? `${meta.bank?.nome ? meta.bank.nome + ' — ' : ''}Cartão de crédito${cinfo.numero ? ' …' + cinfo.numero.slice(-4) : ''}` : '';

  // identidade de cada secção
  const infos = withRows.map((s) => ({ sec: s, ...sectionInfo(s) }));
  const matches = (i) => (i.iban && meta.iban && i.iban === meta.iban) || (i.acctNo && meta.acctNo && (meta.acctNo.endsWith(i.acctNo) || i.acctNo.endsWith(meta.acctNo)));
  let mainIdx = infos.length === 1 ? 0 : infos.findIndex(matches);
  if (mainIdx < 0 && infos.length > 1) { const free = infos.filter((i) => !i.iban && !i.acctNo && !i.card); if (free.length === 1) mainIdx = infos.indexOf(free[0]); }
  const rows = [], accounts = {}, secoes = [], chains = [];
  let semSinalTot = 0, dropped = 0, reconN = 0, reconBad = 0;
  // ordem de datas e ano: dependem de todos os tokens
  const order = ex.order;
  infos.forEach((info, idx) => {
    const s = info.sec;
    const tipo = layout?.tipo || (cardMode ? 'cartao' : guessAccountType(info.ctx));
    const monthsOf = s.raw.map((r) => r.tokMov).filter(Boolean).map((t) => (order === 'mdy' && (t.kind === 'num' || t.kind === 'short') ? +t.g[0] : t.kind === 'iso' ? +t.g[1] : t.kind === 'mond' ? MONTHS[t.g[0]] : t.kind === 'dmon' ? MONTHS[t.g[1]] : +t.g[1]));
    const yo = period ? yearOf : makeYearOf({ yearHint: meta.yearHint, months: monthsOf, today: opts.today });
    const t = concludeSection(s, { order, yearOf: yo, tipo, layout });
    dropped += t.dropped;
    if (!t.rows.length) return;
    const main = idx === mainIdx || (infos.length === 1);
    const key = cardMode ? cardKey : main ? (meta.iban || (info.iban && !meta.iban ? info.iban : '')) : (info.iban || (info.acctNo && 'conta:' + info.acctNo) || (info.card && 'cartao:' + info.card) || 'sec:' + (norm(info.titulo).replace(/[^a-z0-9]+/g, '-') || String(idx + 1)));
    const nome = cardMode ? cardNome : main ? (meta.produto || (info.titulo && !/ordem/i.test(info.titulo) ? title(info.titulo) : '')) : title(info.titulo || '');
    const label = cardMode ? cardNome : key.startsWith('conta:') || key.startsWith('cartao:') || key.startsWith('sec:') ? (nome || (key.startsWith('cartao:') ? 'Cartão …' + info.card : 'Conta ' + (info.acctNo || ''))) : '';
    for (const r of t.rows) { r.contaKey = key; r.contaLabel = label; r.secId = idx; rows.push(r); }
    semSinalTot += t.rows.filter((r) => r.semSinal).length;
    let opening = s.opening, final = s.final;
    const soma = t.soma;
    if (tipo === 'cartao' && opening != null && final != null && final - (opening + soma) !== 0 && -final - (-opening + soma) === 0) { opening = -opening; final = -final; } // saldos «em dívida» no cartão
    const periodo = period || { ini: t.rows.map((r) => r.data).sort()[0], fim: t.rows.map((r) => r.data).sort().pop() };
    const prevA = accounts[key];
    const acc = {
      key, iban: key === meta.iban ? meta.iban : (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(key) ? key : null), acctNo: main ? meta.acctNo : info.acctNo, label: nome, nome: nome || null, tipo,
      opening, final, disp: s.disp, periodo, chain: t.chain, soma, ledger: final != null && opening == null ? { valor: final, data: periodo?.fim || null } : null, secId: idx,
    };
    if (prevA) { // mesma conta noutra tabela: juntar
      prevA.soma += soma; if (prevA.opening == null) prevA.opening = opening; if (final != null) prevA.final = final; if (prevA.opening != null && prevA.final != null) prevA.diffExtrato = prevA.final - (prevA.opening + prevA.soma);
    } else accounts[key] = acc;
    const A = accounts[key];
    if (A.opening != null && A.final != null && !prevA) {
      const diff = A.final - (A.opening + A.soma); A.diffExtrato = diff; reconN++;
      if (diff !== 0) { reconBad++; warnings.push(`A soma dos movimentos lidos não fecha com os saldos do extrato (diferença ${(diff / 100).toFixed(2).replace('.', ',')} €).`); }
    }
    chains.push({ checked: t.chain.checked || 0, ok: t.chain.ok || 0, fixed: t.chain.fixed || 0 });
    for (const w of t.warnings) warnings.push(w);
    secoes.push({ tipo: 'conta', titulo: info.titulo || nome || meta.produto || 'Movimentos', n: t.rows.length, key, tipoConta: tipo });
  });

  // cartão: saldos a partir do «Resumo da conta» (dívida anterior/atual como saldos negativos) e validação dos totais
  let cartao = null;
  const CA = cardMode ? accounts[cardKey] : null;
  if (CA) {
    const val = validateCard(rows.filter((r) => r.contaKey === cardKey), cinfo);
    const rs = cinfo.resumo;
    if (rs) {
      CA.opening = -rs.anterior; CA.final = -rs.atual;
      CA.diffExtrato = CA.final - (CA.opening + CA.soma); reconN++;
      if (CA.diffExtrato !== 0) reconBad++;
    }
    for (const w of val.avisos) warnings.push(w);
    CA.cartao = { numero: cinfo.numero, contrato: cinfo.contrato, iban: cinfo.iban, limite: cinfo.limite, tan: cinfo.tan, minimo: cinfo.minimo, dataLimite: cinfo.dataLimite, extratoNo: cinfo.extratoNo, emissaoAnterior: cinfo.emissaoAnterior, emissaoAtual: cinfo.emissaoAtual };
    CA.nome = cardNome; CA.label = cardNome;
    cartao = { ...CA.cartao, key: cardKey, validacao: val };
    CA.chavesExtra = [cinfo.contrato && digits(cinfo.contrato) !== digits(cinfo.numero) ? 'contrato:' + digits(cinfo.contrato) : null, cinfo.iban ? 'cartao-iban:' + cinfo.iban : null].filter(Boolean);
  }
  const debts = [];
  for (const L of loans) {
    const d = parseLoan({ lines: L.lines, produto: L.produto, numero: L.numero, numeroTxt: L.numeroTxt }, { period }); if (!d) continue;
    debts.push(d); secoes.push({ tipo: 'emprestimo', titulo: `${d.produto} …${digits(d.numero).slice(-4)}`, n: 0 });
  }
  const resumo = resumoLines.length ? parseResumo(resumoLines) : null;
  if (resumo) {
    const dep = Object.values(accounts).reduce((a, x) => a + (x.final ?? 0), 0);
    if (resumo.depositos != null && Object.values(accounts).some((x) => x.final != null) && dep !== resumo.depositos) warnings.push('O «Resumo das Contas» indica um total de depósitos diferente da soma dos saldos finais das contas lidas — pode haver contas no extrato que não foram reconhecidas.');
    const resp = debts.reduce((a, d) => a + d.saldoAtual, 0);
    if (resumo.responsabilidades != null && debts.length && Math.abs(resumo.responsabilidades) !== resp) warnings.push('A soma dos créditos detetados não coincide com as «Responsabilidades» do Resumo das Contas — confirme os valores das dívidas.');
  }
  const primeira = Object.values(accounts)[0];
  const moedas = [...new Set(lines.map((l) => (l.text.match(/Moeda:\s*([A-Z]{3})/) || [])[1]).filter((m) => m && m !== 'EUR'))];
  if (moedas.length) warnings.push(`Uma secção está em ${moedas[0]} (não EUR): confirme os valores.`);
  const txtDoc = lines.slice(0, 200).map((l) => l.text).join(' ');
  if (!moedas.length && /\b(USD|GBP|CHF)\b|\$\s?\d|£\s?\d/.test(txtDoc) && !/\bEUR\b|€/.test(txtDoc)) warnings.push('O extrato parece estar noutra moeda que não EUR: confirme os valores.');
  const conf = confidence({ metodo, nRows: rows.length, chains, recon: { n: reconN, bad: reconBad }, semSinal: semSinalTot, dropped, ocr: !!opts.ocr });
  const first = withRows[0];
  const layoutOut = first?.cols ? { v: 1, cols: layoutFromCols(first.cols, ex.pw), dateFmt: layout?.dateFmt || 'auto', useValueDate: !!layout?.useValueDate, invert: !!layout?.invert, dotDates: !!layout?.dotDates, skip: layout?.skip || [] } : null;
  return {
    rows, meta: { iban: meta.iban, acctNo: meta.acctNo, bank: meta.bank, title: meta.produto }, warnings, ignored: [], anchors: !!(first?.hdr), accounts, debts, secoes, resumo,
    periodo: period, extratoNo: cartao?.extratoNo || meta.extratoNo, cartao, consolidado: secoes.length > 1 || debts.length > 0 || !!resumo, chain: primeira?.chain || null,
    confianca: conf, metodo, usadoGuardado, layout: layoutOut, fingerprints: fps0, ordemDatas: order, ocr: !!opts.ocr, nIgnoradas: dropped,
  };
}

// ---------- apoio ao passo «Ajustar leitura do PDF» ----------
// Quantas linhas parecem movimentos (data no início + valor) e se há cabeçalho de tabela: distingue «extrato difícil» de «não é um extrato».
export function surveyLines(lines) {
  prepare(lines);
  // «soltas»: linhas com algo parecido com uma data (17.08, 17/08, 2026-08-17…) E um valor (12,50 / ,30EUR) em qualquer posição — sinal de que há movimentos mesmo sem leitura automática
  const soltas = lines.filter((l) => /(?:^|\s)(?:\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{4}-\d{2}-\d{2})(?:\s|$)/.test(l.text) && /(?:^|\s)[-+]?(?:\d[\d.]*)?[.,]\d{2}(?:\s?(?:€|EUR))?(?:\s|$)/.test(l.text)).length;
  return { linhas: lines.length, candidatas: lines.filter((l) => l.isRow).length, cabecalhos: findHeaders(lines).size, soltas, chars: lines.reduce((a, l) => a + l.text.length, 0) };
}
// Layout inicial para ajustar à mão: o detetado, ou colunas deduzidas das linhas com data+valor
export function defaultLayout(lines, parsed = null, opts = {}) {
  if (parsed?.layout?.cols?.length && !opts.dotDates) return JSON.parse(JSON.stringify(parsed.layout));
  const { pw } = prepare(lines, opts.dotDates !== undefined ? { dotDates: !!opts.dotDates } : {});
  const ex = extractSections(lines, { implicit: true });
  const sec = ex.sections.find((x) => x.cols);
  if (!sec) return null;
  return { v: 1, cols: layoutFromCols(sec.cols, pw), dateFmt: opts.dateFmt || 'auto', useValueDate: false, invert: !!opts.invert, dotDates: !!opts.dotDates, skip: [] };
}
// Texto extraído, linha a linha (células separadas por « │ »), para o utilizador ver o que foi lido quando a leitura automática não encontra movimentos
export function textPreview(lines, max = 220) {
  return lines.slice(0, max).map((l, i) => ({ i, page: l.page, text: (l.cells?.length ? l.cells.map((c) => String(c.s).trim()).filter(Boolean).join(' │ ') : l.text).slice(0, 240) }));
}
// Pré-visualização: linhas a partir de ~4 antes da primeira linha de movimento, com as células distribuídas pelas colunas do layout
export function previewLines(lines, layout, max = 80) {
  const { pw } = prepare(lines);
  const cols = (layout?.cols || []).map((c) => ({ ...c, x1: c.x1 * pw, x2: c.x2 * pw }));
  const first = lines.findIndex((l) => l.isRow);
  const start = Math.max(0, first < 0 ? 0 : first - 4);
  const skip = new Set(layout?.skip || []);
  const out = [];
  for (let i = start; i < lines.length && out.length < max; i++) {
    const L = lines[i]; L.sig = L.sig || sigOf(L);
    const cells = cols.map(() => '');
    if (L.isRow || L.nAmt) {
      for (const c of L.cells || [{ s: L.text, x1: 0, x2: pw }]) {
        let bi = -1, bd = 1e9; const mx = (c.x1 + c.x2) / 2;
        cols.forEach((k, j) => { const d = mx >= k.x1 && mx <= k.x2 ? 0 : Math.min(Math.abs(mx - k.x1), Math.abs(mx - k.x2)); if (d < bd) { bd = d; bi = j; } });
        if (bi >= 0) cells[bi] = (cells[bi] ? cells[bi] + ' ' : '') + c.s.trim();
      }
    }
    out.push({ i, page: L.page, sig: L.sig, text: L.text, isRow: !!L.isRow, cells: L.isRow || L.nAmt ? cells : null, skip: skip.has(L.sig) });
  }
  return out;
}
