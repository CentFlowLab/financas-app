// Interpreta o texto de um talão/fatura (saída do OCR) e extrai loja, data, total e artigos.
import { norm } from './util.js';

const cents = (s) => Math.round(parseFloat(String(s).replace(',', '.')) * 100);
const PRICE_G = /(?<![\d.,])(\d{1,5}[.,]\d{2})(?![\d])/g;
const SKIP = /\b(total|subtotal|iva|troco|numerario|multibanco|visa|mastercard|mb way|mbway|nif|contribuinte|desconto|entregue|pago|cartao|dinheiro|fatura|factura|original|obrigad|processado|resumo|incidencia|artigos|operacao|terminal|documento|tel|telefone|www|cliente|poupanca|pontos|cupao|cupon|vale|arredondamento|certificado|emitido)\b/;
const STORE_SKIP = /nif|contribuinte|tel\b|telefone|www|fatura|factura|rua |av\.|avenida|lda|s\.a|^\d|codigo postal|\d{4}-\d{3}/;

export function guessCategory(loja) {
  const n = norm(loja);
  if (/continente|pingo doce|lidl|aldi|minipreco|auchan|intermarche|mercadona|e\.?leclerc|supermercado|mini ?mercado|apolonia|meu super/.test(n)) return 'cat-supermercado';
  if (/galp|repsol|\bbp\b|prio|cepsa|oz energy|petrogal|combustiv|gasolin/.test(n)) return 'cat-combustivel';
  if (/farmacia|parafarmacia|clinica|hospital|dentista|optica/.test(n)) return 'cat-saude';
  if (/mc ?donald|burger|restaurante|cafe|pastelaria|pizz|sushi|tasca|snack|padaria|churrasqueira/.test(n)) return 'cat-restaurantes';
  if (/worten|fnac|radio popular|ikea|leroy|aki\b|conforama/.test(n)) return 'cat-casa';
  if (/zara|h&m|primark|sport zone|decathlon|pull ?& ?bear|bershka|c&a/.test(n)) return 'cat-vestuario';
  return 'cat-supermercado';
}

export function parseReceipt(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const full = lines.join('\n');

  // data
  let data = null;
  let m = full.match(/(?<!\d)(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?!\d)/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) data = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (!data) {
    m = full.match(/(?<!\d)(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?!\d)/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) data = `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  // loja
  let loja = '';
  for (const l of lines.slice(0, 8)) {
    const letters = (l.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (letters >= 3 && !STORE_SKIP.test(norm(l))) { loja = l.replace(/^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9.)]+$/g, '').slice(0, 50); break; }
  }

  // artigos
  const itens = [];
  let pending = null;
  const clean = (s) => s.replace(/^\d{6,}\s+/, '').replace(/\s+[A-E]\s*$/, '').replace(/[^A-Za-zÀ-ÿ0-9%.,&'/+\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const line of lines) {
    const n = norm(line);
    if (SKIP.test(n)) { pending = null; continue; }
    let q = line.match(/^(\d+(?:[.,]\d+)?)\s*(?:un|kg|l|lt)?\s*[xX*]\s*(\d{1,4}[.,]\d{2})\s+(\d{1,5}[.,]\d{2})/i);
    if (q && pending) { itens.push({ nome: pending, qtd: parseFloat(q[1].replace(',', '.')), preco: cents(q[2]), total: cents(q[3]) }); pending = null; continue; }
    const i = line.match(/^(.*?[A-Za-zÀ-ÿ].*?)\s+(?:(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d{1,4}[.,]\d{2})\s+)?(\d{1,5}[.,]\d{2})\s*[A-Za-z€]?$/);
    if (i) {
      const nome = clean(i[1]);
      if ((nome.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 2) {
        const total = cents(i[4]);
        const qtd = i[2] ? parseFloat(i[2].replace(',', '.')) : 1;
        const preco = i[3] ? cents(i[3]) : total;
        itens.push({ nome, qtd, preco, total });
      }
      pending = null; continue;
    }
    pending = /[A-Za-zÀ-ÿ]{3,}/.test(line) && !/\d[.,]\d{2}/.test(line) ? clean(line) : null;
    if (pending && pending.length < 3) pending = null;
  }

  // total
  let total = null; const cand = [];
  lines.forEach((line, idx) => {
    const n = norm(line);
    if (!/\btotal\b|a pagar|montante/.test(n) || /subtotal|iva|desconto|poupanca|artigos|entregue|troco/.test(n)) return;
    let prices = [...line.matchAll(PRICE_G)].map((x) => cents(x[1]));
    if (!prices.length && lines[idx + 1]) prices = [...lines[idx + 1].matchAll(PRICE_G)].map((x) => cents(x[1]));
    if (prices.length) cand.push({ v: prices[prices.length - 1], pagar: /pagar/.test(n) });
  });
  if (cand.length) total = (cand.find((c) => c.pagar) || cand.reduce((a, b) => (b.v > a.v ? b : a))).v;
  const somaItens = itens.reduce((a, i) => a + i.total, 0);
  if (total == null) {
    const all = [...full.matchAll(PRICE_G)].map((x) => cents(x[1]));
    total = somaItens || (all.length ? Math.max(...all) : null);
  }
  return { data, loja, total, itens, somaItens, categoriaId: guessCategory(loja) };
}
