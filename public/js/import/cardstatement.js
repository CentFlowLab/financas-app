// Importar extratos — extratos de CARTÃO DE CRÉDITO (texto com posições). Funções puras, sem DOM.
// Deteta o tipo de documento por palavras-chave, lê o «Resumo da conta» (saldo em dívida anterior − créditos + débitos = saldo em dívida atual),
// os dados do cartão (nº mascarado, IBAN, limite de crédito, TAN, montante mínimo, data limite) e valida os movimentos lidos contra o resumo.
// Convenção da aplicação: dívida do cartão = saldo NEGATIVO; débitos (compras, comissões, juros) baixam o saldo, créditos (pagamentos, estornos) sobem-no.
import { norm } from '../util.js';
import { parseAmount, findIban } from './parse.js';
import { datesIn } from './tokens.js';

// ---------- deteção ----------
const SIGNALS = [
  ['cartao', /\bcartao de credito\b|\bcredit card\b/],
  ['limite', /\blimite de credito\b|\bcredit limit\b/],
  ['divida', /\bsaldo em divida\b|\bamount owed\b|\bstatement balance\b/],
  ['tan', /\btan\b\s*:?\s*\d/],
  ['minimo', /\bmontante minimo a pagar\b|\bminimo a pagar\b|\bminimum payment\b|\bpagamento minimo\b/],
];
// -> { isCard, hits: [...] }. Um cartão precisa de pelo menos 2 sinais diferentes (um «Cartão de crédito» solto não chega).
export function detectCard(lines) {
  const txt = norm(lines.map((l) => l.text).join('\n'));
  const hits = SIGNALS.filter(([, re]) => re.test(txt)).map(([k]) => k);
  const isCard = hits.length >= 2 && (hits.includes('divida') || hits.includes('limite') || hits.length >= 3);
  return { isCard, hits };
}

// ---------- dados do cartão ----------
const MASKED = /(?<![\d\w])(\d{4})[ \-]?([\dXx*•]{4})[ \-]?([\dXx*•]{4})[ \-]?(\d{4})(?![\d\w])/;
export const cardKeyOf = (masked) => 'cartao:' + String(masked).replace(/[^0-9A-Za-z*•]/g, '').replace(/[*•x]/g, 'X').toUpperCase();
const cents = (s) => { const v = parseAmount(s, 'comma'); return Number.isNaN(v) ? null : Math.abs(v); };
const amtRe = /(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?![\d,])/;
const isoIn = (t) => { const d = datesIn(t); return d.length ? d[0].iso : null; };

// Resumo «A − B + C = D» numa linha com 4 valores: saldo anterior − créditos + débitos = saldo atual (confirmado aritmeticamente)
function findSummary(lines) {
  for (const L of lines.slice(0, 120)) {
    const A = (L._a || []).filter((a) => a.t === 'amt');
    if (A.length !== 4) continue;
    const v = A.map((a) => cents(a.s)); if (v.some((x) => x == null)) continue;
    if (v[0] - v[1] + v[2] === v[3]) return { anterior: v[0], creditos: v[1], debitos: v[2], atual: v[3], fonte: 'resumo' };
  }
  // alternativa: valores com rótulo na mesma linha
  const get = (re) => { for (const L of lines.slice(0, 150)) { const n = norm(L.text); const m = n.match(re); if (m) { const a = (L.text.match(new RegExp(amtRe.source, 'g')) || []).pop(); const v = a ? cents(a) : null; if (v != null) return v; } } return null; };
  const anterior = get(/saldo em divida (?:a data do extrato )?anterior/), atual = get(/saldo em divida (?:a data do extrato )?atual/);
  const creditos = get(/^\s*(?:total de )?creditos\b/), debitos = get(/^\s*(?:total de )?debitos\b/);
  if (anterior != null && atual != null) return { anterior, creditos, debitos, atual, fonte: 'rotulos' };
  return null;
}

// -> { resumo, numero, chave, contrato, iban, limite, tan, minimo, dataLimite, extratoNo, emissaoAnterior, emissaoAtual, moeda }
export function parseCardInfo(lines) {
  const head = lines.slice(0, 160);
  const out = { resumo: findSummary(lines), numero: null, chave: null, contrato: null, iban: null, limite: null, tan: null, minimo: null, dataLimite: null, extratoNo: null, emissaoAnterior: null, emissaoAtual: null, moeda: 'EUR' };
  const pick = (re) => { for (const l of head) { const m = l.text.match(re); if (m) return m; } return null; };
  // número do cartão (mascarado): preferir linhas com «contrato» / «cartão»
  const cardLines = [...head.filter((l) => /contrato|cart[ãa]o|card/i.test(l.text)), ...head];
  for (const l of cardLines) { const m = l.text.match(MASKED); if (m && (/[Xx*•]/.test(m[2] + m[3]) || /contrato|cart[ãa]o|card/i.test(l.text)) && !/\biban\b/i.test(l.text.slice(0, m.index))) { out.numero = m.slice(1, 5).join(' ').toUpperCase().replace(/[*•]/g, 'X'); break; } }
  if (out.numero) out.chave = cardKeyOf(out.numero);
  const ctr = pick(/identifica[çc][ãa]o do contrato\s*:?\s*([\dXx*•][\dXx*• -]{6,22}[\dXx*•])/i); if (ctr) out.contrato = ctr[1].trim();
  out.iban = findIban(head.map((l) => l.text).join('\n'));
  const lim = pick(/limite de cr[ée]dito\s*:?\s*(\d[\d.]*,\d{2})/i); if (lim) out.limite = cents(lim[1]);
  const tan = pick(/\bTAN\b\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/i); if (tan) out.tan = parseFloat(tan[1].replace(',', '.'));
  const ex = pick(/extrato\s+n[ºo°.]?\s*(\d{1,3}\s*\/\s*\d{4}|\d+)/i); if (ex) out.extratoNo = ex[1].replace(/\s/g, '');
  const em1 = pick(/emiss[ãa]o do extrato anterior\s*:?\s*(\d{4}-\d{2}-\d{2})/i); if (em1) out.emissaoAnterior = em1[1];
  const em2 = pick(/emiss[ãa]o do extrato atual\s*:?\s*(\d{4}-\d{2}-\d{2})/i); if (em2) out.emissaoAtual = em2[1];
  const moe = pick(/moeda do extrato\s*:?\s*([A-Z]{3})/i); if (moe) out.moeda = moe[1].toUpperCase();
  // montante mínimo e data limite: na mesma linha ou nas 2 seguintes
  head.forEach((l, i) => {
    const n = norm(l.text);
    const near = (k) => [l.text, head[i + 1]?.text || '', head[i + 2]?.text || ''].slice(0, k).join(' ');
    if (out.minimo == null && /minimo a pagar|valor a partir de/.test(n)) { const m = near(3).match(amtRe); if (m) out.minimo = cents(m[1]); }
    if (!out.dataLimite && /data limite/.test(n)) out.dataLimite = isoIn(near(3));
  });
  return out;
}

// ---------- validação contra o resumo ----------
const eurTxt = (c) => (c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
// rows: movimentos já com sinal (débito < 0). -> { ok, debitos, creditos, nDeb, nCre, diffDeb, diffCre, diffSaldo, avisos[] }
export function validateCard(rows, info) {
  const deb = rows.filter((r) => r.valor < 0), cre = rows.filter((r) => r.valor > 0);
  const debitos = deb.reduce((a, r) => a - r.valor, 0), creditos = cre.reduce((a, r) => a + r.valor, 0);
  const rs = info?.resumo;
  const res = { debitos, creditos, nDeb: deb.length, nCre: cre.length, resumo: rs || null, diffDeb: null, diffCre: null, diffSaldo: null, ok: null, avisos: [] };
  if (!rs) { res.avisos.push('Não encontrei o «Resumo da conta» (saldo em dívida anterior, créditos, débitos e saldo atual): não consigo validar os totais.'); return res; }
  if (rs.debitos != null) { res.diffDeb = debitos - rs.debitos; if (res.diffDeb) res.avisos.push(`A soma dos débitos lidos (${eurTxt(debitos)}) não coincide com o total de débitos do resumo (${eurTxt(rs.debitos)}): diferença de ${eurTxt(Math.abs(res.diffDeb))}.`); }
  if (rs.creditos != null) { res.diffCre = creditos - rs.creditos; if (res.diffCre) res.avisos.push(`A soma dos créditos lidos (${eurTxt(creditos)}) não coincide com o total de créditos do resumo (${eurTxt(rs.creditos)}): diferença de ${eurTxt(Math.abs(res.diffCre))}.`); }
  res.diffSaldo = (-rs.anterior + creditos - debitos) - (-rs.atual); // dívida inicial + débitos − créditos deve dar a dívida atual
  if (res.diffSaldo) res.avisos.push(`Saldo em dívida anterior (${eurTxt(rs.anterior)}) + débitos − créditos lidos não dá o saldo em dívida atual (${eurTxt(rs.atual)}): diferença de ${eurTxt(Math.abs(res.diffSaldo))}.`);
  res.ok = !res.diffDeb && !res.diffCre && !res.diffSaldo;
  return res;
}
