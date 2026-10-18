// Valores por omissão: categorias, contas e tipos
export const ACCOUNT_TYPES = [
  { v: 'ordem', t: 'Conta à ordem', i: '🏦' },
  { v: 'poupanca', t: 'Conta poupança', i: '🐖' },
  { v: 'dinheiro', t: 'Dinheiro', i: '💶' },
  { v: 'cartao', t: 'Cartão de crédito', i: '💳' },
  { v: 'investimento', t: 'Investimentos', i: '📈' },
  { v: 'outra', t: 'Outra', i: '👛' },
];
export const accountTypeInfo = (v) => ACCOUNT_TYPES.find((t) => t.v === v) || ACCOUNT_TYPES[5];

export const FALLBACK_OUT = 'cat-outros-saida';
export const FALLBACK_IN = 'cat-outros-entrada';
export const CAT_FUEL = 'cat-combustivel';
export const CAT_DEBT = 'cat-dividas';
export const CAT_FEES = 'cat-comissoes'; // comissões e juros (cartões/contas)
export const CAT_TRANSF = 'cat-transferencias'; // transferências (saídas), p.ex. MB Way
export const CAT_TRANSF_IN = 'cat-transferencias-in'; // transferências (entradas)

export const DEFAULT_CATEGORIES = [
  ['cat-supermercado', 'Supermercado', '🛒', 'saida'],
  ['cat-restaurantes', 'Restaurantes', '🍽️', 'saida'],
  [CAT_FUEL, 'Combustível', '⛽', 'saida'],
  ['cat-transportes', 'Transportes', '🚌', 'saida'],
  ['cat-casa', 'Casa', '🏠', 'saida'],
  ['cat-contas-casa', 'Água, luz e gás', '💡', 'saida'],
  ['cat-comunicacoes', 'Comunicações', '📱', 'saida'],
  ['cat-saude', 'Saúde', '💊', 'saida'],
  ['cat-lazer', 'Lazer', '🎬', 'saida'],
  ['cat-vestuario', 'Vestuário', '👕', 'saida'],
  ['cat-educacao', 'Educação', '🎓', 'saida'],
  ['cat-seguros', 'Seguros', '🛡️', 'saida'],
  ['cat-impostos', 'Impostos e taxas', '🏛️', 'saida'],
  ['cat-prendas', 'Prendas', '🎁', 'saida'],
  [CAT_DEBT, 'Dívidas', '💳', 'saida'],
  [CAT_FEES, 'Comissões e juros', '🏦', 'saida'],
  [CAT_TRANSF, 'Transferências', '🔁', 'saida'],
  [FALLBACK_OUT, 'Outros', '📦', 'saida'],
  ['cat-salario', 'Salário', '💼', 'entrada'],
  ['cat-subsidios', 'Subsídios', '🏖️', 'entrada'],
  ['cat-extra', 'Rendimentos extra', '💶', 'entrada'],
  ['cat-reembolsos', 'Reembolsos', '↩️', 'entrada'],
  [CAT_TRANSF_IN, 'Transferências', '🔁', 'entrada'],
  [FALLBACK_IN, 'Outros', '➕', 'entrada'],
].map(([id, nome, icone, tipo]) => ({ id, nome, icone, tipo }));

export const DEFAULT_ACCOUNTS = () => [
  { id: 'acc-ordem', nome: 'Conta à ordem', tipo: 'ordem', saldoInicial: 0, arquivada: false },
  { id: 'acc-dinheiro', nome: 'Dinheiro', tipo: 'dinheiro', saldoInicial: 0, arquivada: false },
];

export const PALETTE = ['#2f9e8f', '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899', '#f97316', '#3b82f6', '#14b8a6', '#eab308', '#8b5cf6', '#64748b'];
export const FUEL_TYPES = ['Gasolina 95', 'Gasolina 98', 'Gasóleo', 'Gasóleo colorido', 'GPL', 'Elétrico', 'Híbrido', 'Outro'];
export const DEFAULT_SETTINGS = () => ({ tema: 'auto', extraDivida: 0, alertaGarantiaDias: 60, ia: { url: 'https://api.openai.com/v1', modelo: 'gpt-4o-mini', chave: '' }, importLayouts: {} });
