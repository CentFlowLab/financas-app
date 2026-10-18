// Importar extratos — interpretação opcional com IA (API compatível com OpenAI configurada em Definições).
// Só corre por ação explícita do utilizador, com confirmação de privacidade. O resultado passa pelas MESMAS validações do leitor normal
// (cadeia de saldos, totais) e pelo ecrã de revisão. Funções puras, exceto aiRequest (rede).
import { parseAmount, parseDate, validateChain, findIban } from './parse.js';

export const AI_MAX_CHARS = 28000;

// Reduz identificadores: IBAN/NIB/cartões ficam só com os 4 últimos dígitos (a IA não precisa deles para ler movimentos)
export function maskIds(text) {
  return String(text)
    .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, (m) => 'IBAN…' + m.replace(/\s/g, '').slice(-4))
    .replace(/\b\d(?:[ -]?\d){12,24}\b/g, (m) => '…' + m.replace(/\D/g, '').slice(-4));
}

// Texto a enviar: uma linha por linha do PDF, células separadas por « | » (preserva a noção de colunas)
export function statementText(lines, maxChars = AI_MAX_CHARS) {
  const out = []; let page = null, n = 0, cut = false;
  for (const L of lines) {
    if (L.page !== page) { page = L.page; out.push(`--- página ${page} ---`); }
    const t = maskIds((L.cells?.length > 1 ? L.cells.map((c) => c.s.trim()).join(' | ') : L.text).trim());
    if (!t) continue;
    n += t.length + 1; if (n > maxChars) { cut = true; break; }
    out.push(t);
  }
  return { text: out.join('\n'), truncado: cut };
}

const SYSTEM = `You are a precise bank-statement parser. You receive the text extracted from a bank/credit-card statement (any bank, any language, columns separated by " | ", identifiers partially masked). Return ONLY one JSON object, no prose, no markdown, with this shape:
{"accounts":[{"title":string,"type":"checking"|"savings"|"card"|"other","iban_last4":string|null,"currency":string,"opening_balance":number|null,"closing_balance":number|null,"movements":[{"date":"YYYY-MM-DD","description":string,"amount":number,"balance":number|null}]}]}
Rules: one entry in "accounts" per account/card section that has a transaction table (ignore loans, summaries, advertising, legal text). Include EVERY transaction, in the order of the statement, never invent rows. "amount" is signed from the account holder's point of view: money out (purchases, fees, debits, withdrawals) negative, money in (salary, deposits, refunds, payments received) positive; for credit cards, purchases are negative and payments to the card positive. Use the printed running balance in "balance" when the statement has one, else null. Resolve dates to full ISO using the statement period/year. Merge multi-line descriptions. Skip repeated headers/footers and balance-only lines. Numbers are plain JSON numbers (dot decimal).`;

export function buildMessages(text, { fileName = '', nota = '' } = {}) {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `File: ${fileName || 'statement'}${nota ? '\n' + nota : ''}\n\nSTATEMENT TEXT:\n${text}` },
  ];
}

export function endpoint(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) throw new Error('Falta o endereço da API em Definições.');
  return /\/chat\/completions$/.test(u) ? u : u + '/chat/completions';
}

export async function aiRequest({ lines, fileName, ia, signal, fetchImpl = fetch }) {
  if (!ia?.chave) throw new Error('Configure uma chave de API em Definições → Assistente IA.');
  const { text, truncado } = statementText(lines);
  const body = { model: ia.modelo || 'gpt-4o-mini', messages: buildMessages(text, { fileName, nota: truncado ? 'NOTE: the text was truncated.' : '' }), temperature: 0, response_format: { type: 'json_object' } };
  let r;
  try { r = await fetchImpl(endpoint(ia.url), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ia.chave }, body: JSON.stringify(body), signal }); }
  catch (e) { if (e.name === 'AbortError') throw new Error('Pedido cancelado.'); throw new Error('Não consegui contactar o serviço de IA (' + (e.message || 'rede') + '). Verifique a ligação e o endereço em Definições.'); }
  if (r.status === 401 || r.status === 403) throw new Error('O serviço de IA recusou a chave de API (' + r.status + '). Verifique-a em Definições.');
  if (r.status === 429) throw new Error('O serviço de IA indicou limite de pedidos/créditos (429). Tente mais tarde.');
  if (!r.ok) throw new Error('O serviço de IA respondeu com o erro ' + r.status + '.');
  let j;
  try { j = await r.json(); } catch { throw new Error('A resposta do serviço de IA não é JSON válido.'); }
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('O serviço de IA devolveu uma resposta vazia.');
  return { content, truncado };
}

// Extrai o objeto JSON da resposta (tolera ```json … ``` e texto à volta)
export function extractJson(content) {
  let t = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* tenta recortar */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* falha abaixo */ } }
  throw new Error('A IA não devolveu JSON válido. Tente novamente ou ajuste a leitura manualmente.');
}

const toCents = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  const n = parseAmount(String(v)); return Number.isFinite(n) ? n : null;
};
const isoOf = (v) => {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + 'T12:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null; }
  return parseDate(s, 'dmy') || null;
};
const TYPE = { checking: 'ordem', savings: 'poupanca', card: 'cartao', other: 'ordem' };

// JSON da IA -> mesmo formato do leitor de PDF (rows, accounts, warnings, confianca…), já validado.
// base: leitura local (para reaproveitar a chave/IBAN das contas) — opcional.
export function aiToParsed(json, { base = null, truncado = false } = {}) {
  const arr = Array.isArray(json?.accounts) ? json.accounts : Array.isArray(json?.movements) ? [{ movements: json.movements, ...json }] : null;
  if (!arr) throw new Error('A resposta da IA não tem o formato esperado (contas e movimentos).');
  const rows = [], accounts = {}, warnings = [], secoes = []; let invalid = 0, reconN = 0, reconBad = 0, ck = 0, ok = 0;
  const baseAcc = Object.entries(base?.accounts || {});
  arr.forEach((a, idx) => {
    const mv = Array.isArray(a?.movements) ? a.movements : [];
    const rs = [];
    for (const m of mv) {
      const data = isoOf(m?.date), valor = toCents(m?.amount);
      if (!data || valor == null || valor === 0) { invalid++; continue; }
      rs.push({ data, desc: String(m.description || '').replace(/\s+/g, ' ').trim().slice(0, 140), valor, saldo: toCents(m.balance), contaKey: '', contaLabel: '', semSinal: false, ia: true });
    }
    if (!rs.length) return;
    const last4 = String(a.iban_last4 || '').replace(/\W/g, '').slice(-4);
    const match = last4 ? baseAcc.find(([k]) => k.replace(/\W/g, '').endsWith(last4)) : (arr.length === 1 && baseAcc.length === 1 ? baseAcc[0] : null);
    const key = match ? match[0] : (arr.length === 1 && base?.meta?.iban ? base.meta.iban : (last4 ? 'ia:' + last4 : arr.length === 1 ? '' : 'ia:' + (idx + 1)));
    const tipo = TYPE[a.type] || 'ordem';
    const opening = toCents(a.opening_balance), final = toCents(a.closing_balance);
    const chain = validateChain(rs, opening);
    for (const r of rs) { r.contaKey = key; r.contaLabel = key.startsWith('ia:') ? String(a.title || 'Conta ' + (idx + 1)).slice(0, 60) : ''; }
    const soma = rs.reduce((x, r) => x + r.valor, 0);
    const acc = { key, iban: /^[A-Z]{2}\d{2}/.test(key) ? key : null, acctNo: null, label: a.title || null, nome: a.title && String(a.title).length <= 60 ? String(a.title) : null, tipo, opening, final, periodo: base?.periodo || null, chain, soma, ledger: null, secId: idx };
    if (opening != null && final != null) { acc.diffExtrato = final - (opening + soma); reconN++; if (acc.diffExtrato !== 0) { reconBad++; warnings.push(`${a.title || 'Conta ' + (idx + 1)}: a soma dos movimentos devolvidos pela IA não fecha com os saldos indicados (diferença ${(acc.diffExtrato / 100).toFixed(2).replace('.', ',')} €).`); } }
    if (chain.broken) warnings.push(`${chain.broken} movimento(s) da IA não batem certo com a coluna de saldos.`);
    if (chain.fixed) warnings.push(`Corrigi o sinal de ${chain.fixed} movimento(s) da IA com base na coluna de saldos.`);
    ck += chain.checked || 0; ok += (chain.ok || 0) + (chain.fixed || 0);
    if (accounts[key]) { accounts[key].soma += soma; } else accounts[key] = acc;
    rows.push(...rs); secoes.push({ tipo: 'conta', titulo: a.title || 'Movimentos', n: rs.length, key, tipoConta: tipo });
  });
  if (!rows.length) throw new Error('A IA não devolveu nenhum movimento válido. Experimente «Ajustar leitura do PDF».');
  if (invalid) warnings.push(`${invalid} linha(s) devolvida(s) pela IA foram ignoradas por terem data ou valor inválidos.`);
  if (truncado) warnings.push('O extrato era grande e o texto enviado à IA foi truncado: podem faltar movimentos no fim.');
  warnings.unshift('Movimentos interpretados por IA: reveja todos os valores e sinais antes de importar.');
  const motivos = ['Interpretado por IA (melhor esforço).']; let pts = 45;
  if (ck >= 3 && ok / ck >= 0.95) { pts += 30; motivos.push('A coluna de saldos confirma os valores.'); } else if (ck >= 3 && ok / ck < 0.8) { pts -= 25; motivos.push('A coluna de saldos não bate certo em várias linhas.'); }
  if (reconN) { if (reconBad) { pts -= 30; motivos.push('A soma não fecha com os saldos indicados.'); } else { pts += 20; motivos.push('A soma fecha com o saldo inicial e final.'); } }
  const nivel = pts >= 70 ? 'media' : pts >= 45 ? 'media' : 'baixa'; // IA nunca passa de «média»: exige revisão
  return {
    rows, meta: base?.meta || { iban: findIban(JSON.stringify(json)) || null, acctNo: null, bank: null, title: null }, warnings, ignored: [], accounts, debts: base?.debts || [], secoes, resumo: null,
    periodo: base?.periodo || null, consolidado: secoes.length > 1, chain: Object.values(accounts)[0]?.chain || null,
    confianca: { nivel, pontos: pts, motivos }, metodo: 'ia', ia: true, bestEffort: true, nIgnoradas: invalid,
  };
}
