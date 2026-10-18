// Importar extratos — categorização automática (regras em português + aprendizagem a partir das correções do utilizador)
import { S } from '../db.js';
import { norm, uid } from '../util.js';
import { FALLBACK_IN, FALLBACK_OUT, CAT_FUEL, CAT_DEBT } from '../defaults.js';

const NOS = /(?<!\b(?:para|de|a|em|por|entre|connosco|ver|dar) )(?<![a-z0-9])nos(?![a-z0-9])/;
// [categoria, [palavras-chave]] — texto normalizado (sem acentos, minúsculas); "*" = qualquer terminação; ordem = prioridade
const OUT = [
  ['cat-restaurantes', ['uber eats', 'ubereats', 'bolt food', 'glovo', 'mcdonald*', 'burger king', 'kfc', 'telepizza', 'pizza hut', 'starbucks', 'restaurante*', 'pastelaria*', 'cafe*', 'cafetaria', 'snack bar', 'tasca', 'churrasqueira', 'padaria*', 'sushi', 'take away', 'takeaway', 'vitaminas', 'five guys', 'dominos']],
  ['cat-contas-casa', ['galp energia', 'galp power', 'galp luz', 'edp comercial', 'edp', 'endesa', 'iberdrola', 'goldenergy', 'ycell', 'epal', 'smas', 'aguas de*', 'eletricidade', 'gas natural', 'agua e saneamento']],
  [CAT_FUEL, ['galp', 'repsol', 'bp', 'prio', 'cepsa', 'moeve', 'shell', 'combustivel*', 'gasoleo', 'gasolina', 'posto de abastecimento', 'posto']],
  ['cat-transportes', ['via verde', 'viaverde', 'brisa', 'uber', 'bolt', 'cabify', 'free now', 'freenow', 'cp comboios', 'comboios de portugal', 'cp', 'metro*', 'carris', 'navegante', 'andante', 'transtejo', 'soflusa', 'tap', 'ryanair', 'easyjet', 'flixbus', 'emel', 'parque*', 'estacionamento', 'parking', 'taxi*', 'portagens*', 'oficina*', 'norauto', 'midas']],
  ['cat-comunicacoes', ['vodafone', 'meo', 'nos comunicacoes', 'nos sgps', 'nos telecom', NOS, 'nowo', 'digi', 'altice', 'ctt', 'telecomunicacoes', 'internet', 'telemovel', 'zon', 'lycamobile', 'wtf']],
  ['cat-saude', ['farmacia*', 'parafarmacia', 'hospital*', 'clinica*', 'cuf', 'lusiadas', 'luz saude', 'dentista', 'medic*', 'consulta*', 'otica*', 'optica*', 'fisioterapia', 'saude', 'analises', 'wells', 'medicamentos']],
  ['cat-lazer', ['netflix', 'spotify', 'hbo', 'disney*', 'youtube', 'amazon prime', 'prime video', 'apple.com', 'apple com bill', 'google play', 'cinema*', 'uci cinemas', 'cinemas nos', 'ticketline', 'bol.pt', 'steam*', 'playstation', 'xbox', 'nintendo', 'ginasio*', 'fitness*', 'holmes place', 'solinca', 'livraria*', 'fnac', 'bertrand', 'worten kids', 'bilhete*', 'dazn', 'twitch']],
  ['cat-vestuario', ['zara', 'h&m', 'h m ', 'primark', 'decathlon', 'pull bear', 'bershka', 'stradivarius', 'mango', 'sport zone', 'sportzone', 'salsa', 'lefties', 'cortefiel', 'sapataria*', 'calcado', 'tezenis', 'bonprix', 'shein', 'zalando']],
  ['cat-casa', ['ikea', 'leroy merlin', 'aki', 'worten', 'conforama', 'jysk', 'maxmat', 'bricomarche', 'renda', 'condominio', 'ferragens', 'eletrodomesticos', 'el corte ingles', 'mudum', 'tiger']],
  ['cat-seguros', ['fidelidade', 'tranquilidade', 'ageas', 'allianz', 'mapfre', 'zurich', 'generali', 'seguro*', 'liberty', 'medis', 'multicare', 'una seguros']],
  ['cat-impostos', ['autoridade tributaria', 'financas', 'portal das financas', 'iuc', 'imi', 'irs', 'irc', 'imposto*', 'seguranca social', 'tsu', 'comissao', 'comissoes', 'manutencao de conta', 'manutencao conta', 'taxa*', 'iva', 'selo', 'juros devedores', 'anuidade', 'custos de conta', 'portagem em atraso', 'coima*', 'multa*']],
  ['cat-educacao', ['escola*', 'universidade*', 'propinas', 'colegio*', 'creche', 'infantario', 'udemy', 'coursera', 'faculdade', 'instituto*', 'explicacoes', 'ensino', 'mensalidade escolar', 'papelaria*']],
  [CAT_DEBT, ['prestacao*', 'credito habitacao', 'credito pessoal', 'emprestimo*', 'leasing', 'cofidis', 'cetelem', 'financiamento', 'amortizacao*', 'credito automovel', 'credito conso']],
  ['cat-prendas', ['prenda*', 'florista*', 'flores', 'presente']],
  ['cat-supermercado', ['continente', 'pingo doce', 'lidl', 'aldi', 'minipreco', 'mini preco', 'auchan', 'intermarche', 'mercadona', 'e leclerc', 'leclerc', 'apolonia', 'spar', 'meu super', 'supermercado*', 'hipermercado*', 'mercearia*', 'talho', 'peixaria', 'frutaria', 'minimercado', 'amanhecer', 'recheio', 'makro', 'jumbo', 'froiz', 'celeiro']],
];
const IN = [
  ['cat-salario', ['ordenado', 'salario*', 'vencimento*', 'remuneracao', 'remuneracoes', 'processamento de vencimento', 'proc vencimento', 'pagamento de ordenado', 'folha de pagamento']],
  ['cat-subsidios', ['subsidio*', 'sub ferias', 'sub natal', 'subs alimentacao', 'abono', 'rsi', 'pensao', 'reforma']],
  ['cat-reembolsos', ['reembolso*', 'estorno*', 'devolucao', 'devolucoes', 'cashback', 'anulacao', 'reversao', 'restituicao', 'reembolso irs']],
  ['cat-extra', ['juros', 'dividendo*', 'rendimento*', 'renda recebida', 'venda', 'olx', 'vinted', 'freelance', 'recibo verde', 'honorarios']],
];

const compile = (kw) => {
  if (kw instanceof RegExp) return kw;
  const body = kw.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9]*');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
};
const BUILTIN_OUT = OUT.map(([c, ks]) => [c, ks.map((k) => ({ k, re: compile(k) }))]);
const BUILTIN_IN = IN.map(([c, ks]) => [c, ks.map((k) => ({ k, re: compile(k) }))]);

const exists = (id) => S.categories.some((c) => c.id === id);
const pick = (id, tipo) => (exists(id) ? id : (tipo === 'entrada' ? FALLBACK_IN : FALLBACK_OUT));

// Palavras sem valor para identificar um comerciante ("compra", "pagamento", cidades…)
const GENERIC = new Set(['compra', 'compras', 'pagamento', 'pagamentos', 'pag', 'pgto', 'transf', 'transferencia', 'transferencias', 'trf', 'mb', 'way', 'mbway', 'cartao', 'debito', 'credito', 'levantamento', 'servicos', 'servico', 'ref', 'referencia', 'de', 'da', 'do', 'das', 'dos', 'em', 'para', 'por', 'com', 'sa', 'lda', 'unipessoal', 'pt', 'portugal', 'lisboa', 'porto', 'eur', 'the', 'and', 'tpa', 'pos', 'purchase', 'payment', 'card', 'nr', 'num', 'ordem', 'dep', 'deposito', 'movimento', 'op', 'operacao', 'iban', 'nib', 'recebida', 'recebido', 'enviada', 'enviado', 'ao', 'aos', 'na', 'no', 'nas', 'nos', 'ate', 'sem', 'por', 'via', 'dd', 'sepa', 'compra', 'comp', 'transacao']);
export function learnTokens(desc) {
  return norm(desc).replace(/[^a-z0-9& ]+/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !/\d{3,}/.test(t) && !GENERIC.has(t));
}
export function learnKey(desc) {
  const t = learnTokens(desc);
  if (t.length) return t.slice(0, 2).join(' ');
  return norm(desc).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter((x) => x.length >= 3).slice(0, 3).join(' ');
}

function builtin(desc, tipo) {
  const n = ' ' + norm(desc).replace(/[^a-z0-9.&]+/g, ' ') + ' ';
  const t = n.trim();
  const scan = (list) => { for (const [c, ks] of list) for (const { re } of ks) if (re.test(t)) return c; return null; };
  if (tipo === 'entrada') {
    const c = scan(BUILTIN_IN);
    if (c) return c;
    if (scan(BUILTIN_OUT)) return 'cat-reembolsos'; // dinheiro devolvido por um comerciante
    return null;
  }
  return scan(BUILTIN_OUT);
}

// -> { id, fonte: 'aprendida' | 'regra' | 'padrao' }
export function categorize(desc, tipo) {
  const toks = new Set(learnTokens(desc));
  let bestRule = null;
  for (const r of S.catRules || []) {
    if (r.tipo !== tipo || !exists(r.categoriaId)) continue;
    const rt = r.chave.split(' ').filter(Boolean);
    if (!rt.length || !rt.every((x) => toks.has(x))) continue;
    if (!bestRule || rt.length > bestRule.n || (rt.length === bestRule.n && (r.atualizadoEm || '') > (bestRule.r.atualizadoEm || ''))) bestRule = { r, n: rt.length };
  }
  if (bestRule) return { id: bestRule.r.categoriaId, fonte: 'aprendida' };
  const b = builtin(desc, tipo);
  if (b && exists(b)) return { id: b, fonte: 'regra' };
  return { id: pick(null, tipo), fonte: 'padrao' };
}

// Guarda correções do utilizador: descrição -> categoria (persistido em S.catRules; o chamador faz save)
export function learn(desc, tipo, categoriaId) {
  const chave = learnKey(desc);
  if (!chave) return false;
  S.catRules ||= [];
  const ex = S.catRules.find((r) => r.chave === chave && r.tipo === tipo);
  const agora = new Date().toISOString();
  if (ex) { ex.categoriaId = categoriaId; ex.atualizadoEm = agora; ex.n = (ex.n || 1) + 1; } else S.catRules.push({ id: uid(), chave, tipo, categoriaId, n: 1, atualizadoEm: agora });
  return true;
}
