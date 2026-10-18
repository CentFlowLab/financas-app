// Importar extratos — «átomos» de uma linha de texto: datas (vários formatos PT/EN/ES), valores e texto, com posição horizontal.
// Funções puras (sem DOM). Usadas pelo leitor de PDF/imagem genérico (layout.js).
import { norm } from '../util.js';
import { parseAmount, MONTHS } from './parse.js';

// ---------- datas ----------
const MONRE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DATE_RES = [
  ['iso', /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/],
  ['num', /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/],
  ['dmon', new RegExp(`^(\\d{1,2})(?:st|nd|rd|th|o|º)?[ \\-/.]*(?:de )?(${MONRE})\\.?(?:[ \\-/.,]*(?:de )?(\\d{4}|\\d{2}))?(?![a-z\\d])`)],
  ['mond', new RegExp(`^(${MONRE})\\.?[ ]+(\\d{1,2})(?:st|nd|rd|th)?(?:,?[ ]+(\\d{4}))?(?!\\d)`)],
  ['short', /^(\d{1,2})[-/](\d{1,2})(?![-/.]\d|\d|,\d)/],
  ['shortdot', /^(\d{1,2})\.(\d{1,2})(?![-/.]\d|\d|,\d)/],
];
// Data no início de «str» (aceita espaços iniciais). -> { kind, g, len, raw } | null. dotShort: aceitar «dd.mm» (ambíguo com valores 12.50)
export function dateAt(str, { dotShort = false } = {}) {
  const lead = str.length - str.trimStart().length;
  const t = str.slice(lead);
  let n = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (n.length !== t.length) n = t.toLowerCase();
  for (const [kind, re] of DATE_RES) {
    if (kind === 'shortdot' && !dotShort) continue;
    const m = n.match(re);
    if (!m) continue;
    if (kind === 'dmon' || kind === 'mond') { const mo = kind === 'dmon' ? m[2] : m[1]; if (!MONTHS[mo]) continue; }
    return { kind: kind === 'shortdot' ? 'short' : kind, g: m.slice(1), len: lead + m[0].length, raw: t.slice(0, m[0].length) };
  }
  return null;
}
const p2 = (n) => String(n).padStart(2, '0');
const validDay = (y, m, d) => { if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return false; const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const y4 = (s) => { let y = +s; if (s.length === 2) y += y < 70 ? 2000 : 1900; return y; };
// Componentes (d, m, y|null) de um token; order 'dmy' | 'mdy'
export function dateParts(tok, order = 'dmy') {
  const g = tok.g;
  switch (tok.kind) {
    case 'iso': return { y: +g[0], m: +g[1], d: +g[2] };
    case 'num': return order === 'mdy' ? { y: y4(g[2]), m: +g[0], d: +g[1] } : { y: y4(g[2]), m: +g[1], d: +g[0] };
    case 'short': return order === 'mdy' ? { y: null, m: +g[0], d: +g[1] } : { y: null, m: +g[1], d: +g[0] };
    case 'dmon': return { y: g[2] ? y4(g[2]) : null, m: MONTHS[g[1]], d: +g[0] };
    case 'mond': return { y: g[2] ? +g[2] : null, m: MONTHS[g[0]], d: +g[1] };
    default: return null;
  }
}
// -> AAAA-MM-DD ou null. yearOf(m, d) devolve o ano de datas sem ano.
export function dateISO(tok, order = 'dmy', yearOf = null) {
  const p = dateParts(tok, order); if (!p) return null;
  const y = p.y ?? (yearOf ? yearOf(p.m, p.d) : null);
  return y && validDay(y, p.m, p.d) ? `${y}-${p2(p.m)}-${p2(p.d)}` : null;
}
// Ordem dia/mês deduzida de vários tokens numéricos (um número > 12 na 1.ª posição → dmy; na 2.ª → mdy)
export function orderOf(toks) {
  let dmy = 0, mdy = 0;
  for (const t of toks) { if (t.kind !== 'num' && t.kind !== 'short') continue; if (+t.g[0] > 12) dmy++; else if (+t.g[1] > 12) mdy++; }
  return mdy > dmy ? 'mdy' : 'dmy';
}
// Todas as datas completas (com ano) numa linha de texto: [{ iso, idx, len }]
export function datesIn(text, order = 'dmy') {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (i && /[\w]/.test(text[i - 1])) continue;
    const d = dateAt(text.slice(i));
    if (!d || d.len > 24) continue;
    const p = dateParts(d, order);
    if (p && p.y) { const iso = dateISO(d, order); if (iso) { out.push({ iso, idx: i, len: d.len }); i += d.len - 1; } }
  }
  return out;
}

// ---------- valores ----------
const CUR = '(?:€|EUR|EURO|USD|GBP|\\$|£)';
const AMT_BODY = `[-+−–]?\\(?${CUR}?\\s?[-+−–]?\\d+(?:[.,\\u00a0\\u202f' ]\\d{3})*[.,]\\d{2}\\)?[-+−–]?(?:\\s?${CUR})?(?:\\s?(?:CR|DB|DR|C|D))?`;
export const AMT_FULL = new RegExp(`^${AMT_BODY}$`, 'i');
const AMT_END = new RegExp(`(?:^|\\s)(${AMT_BODY})\\s*$`, 'i');
const CUR_ONLY = new RegExp(`^${CUR}$`, 'i');
export const isAmt = (s) => AMT_FULL.test(String(s).trim());
export function amtInfo(s) {
  const t = String(s).trim();
  const v = parseAmount(t, null);
  const neg = Number.isNaN(v) ? false : (v < 0 || /(?:DB|DR|D)\s*$/i.test(t) && !/\d[.,]\d{2}\s*(?:CR|C)$/i.test(t));
  const pos = /^\+|\+$|\+\s*(?:€|EUR)|(?:CR|C)\s*$/i.test(t.replace(/\s*(?:€|EUR)\s*$/i, ''));
  return { v, neg, pos: pos && !neg };
}

// ---------- linha -> átomos ----------
// atom: { t: 'date'|'amt'|'txt'|'cur', s, x, x2, tok? }
export function atomize(line) {
  const cells = (line.cells && line.cells.length ? line.cells : [{ s: line.text || '', x: 0, x2: 100 }]).filter((c) => String(c.s).trim() !== '');
  const out = [];
  const nCells = cells.length;
  cells.forEach((c, ci) => {
    const s = String(c.s).replace(/\u00a0/g, ' ').trim(); if (!s) return;
    const W = Math.max(0.1, c.x2 - c.x), pos = (i) => c.x + (i / s.length) * W;
    if (CUR_ONLY.test(s)) { out.push({ t: 'cur', s, x: c.x, x2: c.x2 }); return; }
    if (isAmt(s)) { out.push({ t: 'amt', s, x: c.x, x2: c.x2 }); return; }
    let rest = s, off = 0;
    const nDates = () => out.filter((a) => a.t === 'date').length;
    if (ci <= 1 && nDates() < 2) {
      const dot = nCells >= 3 || s.length > 6;
      let d = dateAt(rest, { dotShort: dot });
      while (d && nDates() < 2) {
        const after = rest.slice(d.len);
        if (after && !/^[\s]/.test(after)) break;
        out.push({ t: 'date', s: rest.slice(0, d.len).trim(), tok: d, x: pos(off), x2: pos(off + d.len) });
        const skip = after.length - after.trimStart().length;
        off += d.len + skip; rest = after.trimStart();
        d = rest ? dateAt(rest, { dotShort: dot }) : null;
      }
    }
    if (ci === nCells - 1 && rest) { // valores no fim de uma célula-linha («… 12,50  100,00»)
      const tail = [];
      for (let k = 0; k < 4 && rest; k++) {
        const m = rest.match(AMT_END); if (!m) break;
        const a = m[1].trim(), idx = rest.lastIndexOf(a);
        tail.unshift({ s: a, x: pos(off + idx), x2: pos(off + idx + a.length) });
        rest = rest.slice(0, idx).trimEnd();
      }
      for (const a of tail) out.push({ t: 'amt', s: a.s, x: a.x, x2: a.x2 });
    }
    if (rest) out.push({ t: 'txt', s: rest.replace(/\s+/g, ' '), x: pos(off), x2: pos(off + rest.length) });
    else if (!out.length) out.push({ t: 'txt', s: '', x: c.x, x2: c.x2 });
  });
  const res = out.filter((a) => a.s !== '');
  res.sort((a, b) => a.x - b.x);
  // «DB»/«CR» solto à direita de um valor -> sufixo do valor
  for (let i = 0; i < res.length - 1; i++) if (res[i].t === 'amt' && res[i + 1].t === 'txt' && /^(?:CR|DB|DR|C|D)$/i.test(res[i + 1].s) && !/(?:CR|DB|DR|C|D)$/i.test(res[i].s)) { res[i].s += ' ' + res[i + 1].s; res[i].x2 = res[i + 1].x2; res.splice(i + 1, 1); }
  return res;
}

// ---------- sinal por palavras-chave ----------
const STRONG_IN = /\b(recebid[oa]s?|received|ordenado|salario|salary|vencimento|remuneracao|pensao|subsidio|reembolso|estorno|devolucao|refund|juros credor(?:es)?|jur\.? cred|deposito|dep\.? notas|dep\.? numerario|trf\.? ?cred|trf cred|cashback|incoming|payment from|transfer from|interest paid|rendimento|dividendo|premio|abono|credito de)\b/;
const OUT_RE = /\b(compra|compras|pagamento|pagamentos|pag|pagto|levantamento|lev|debito|debit|dd|comissao|comissoes|imposto|selo|taxa|encargos?|juros devedores|jur\.? dev|transferencia (enviada|emitida|para|a favor)|trf (enviada|emitida|para)|trf\.? ?imed\.? ?p|enviad[oa]s?|emitid[oa]|envio|purchase|payment|withdrawal|atm|fee|charge|sent to|paid to|card payment|subscription|subscricao|mensalidade|renda|prestacao|seguro|multa|portagens?|via verde|ordem permanente|manutencao|anuidade|cheque|debito direto)\b/;
const WEAK_IN = /\b(credito|credit|transferencia recebida|de [a-z]{3,} [a-z]{3,})\b/;
export function keywordSign(desc, { card = false } = {}) {
  const n = norm(desc).replace(/[*.\/_-]+/g, ' ');
  if (!n) return 0;
  if (card && /\b(pagamento|payment)\b/.test(n) && !/\b(compra|servicos?|purchase|loja|online)\b/.test(n)) return 1;
  if (STRONG_IN.test(n)) return 1;
  if (OUT_RE.test(n)) return -1;
  if (WEAK_IN.test(n) && !/\b(cartao de credito|credit card)\b/.test(n)) return 1;
  return 0;
}
