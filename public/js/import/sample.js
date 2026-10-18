// Extrato de exemplo (CSV gerado, dados FICTÍCIOS) para experimentar a importação sem um ficheiro real.
import { toISO } from '../util.js';

const fmt = (c) => (c < 0 ? '-' : '') + Math.abs(c / 100).toFixed(2).replace('.', ',').replace(/(\d)(?=(\d{3})+,)/g, '$1.');
const ddmmyyyy = (iso) => iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4);

export const SAMPLE_IBAN_1 = 'PT50999900000000000000001';
export const SAMPLE_IBAN_2 = 'PT50999900000000000000002';

// refDate: data de referência (por omissão hoje). Devolve { nome, texto }
export function sampleCSV(refDate = new Date()) {
  const day = (ago) => { const d = new Date(refDate); d.setDate(d.getDate() - ago); return toISO(d); };
  // [dias atrás, conta(1|2), descrição, valor em cêntimos]
  const tx = [
    [58, 1, 'ORDENADO EMPRESA EXEMPLO LDA', 145000], [57, 1, 'COMPRA CONTINENTE MODELO LISBOA', -6732], [55, 1, 'PAGAMENTO EDP COMERCIAL', -5840], [54, 1, 'DD VODAFONE PORTUGAL', -3999],
    [52, 1, 'COMPRA GALP POSTO A5', -5210], [50, 1, 'COMPRA NETFLIX.COM', -1199], [49, 1, 'COMPRA FARMACIA CENTRAL', -1485], [47, 1, 'TRANSFERENCIA PARA POUPANCA', -30000], [47, 2, 'TRANSFERENCIA DA CONTA ORDEM', 30000],
    [45, 1, 'COMPRA PINGO DOCE ALGES', -4318], [42, 1, 'VIA VERDE PORTAGENS', -1260], [40, 1, 'COMPRA RESTAURANTE O TACHO', -2450], [38, 1, 'MB WAY JOAO SILVA', -2000], [35, 1, 'COMISSAO MANUTENCAO CONTA', -450],
    [28, 1, 'ORDENADO EMPRESA EXEMPLO LDA', 145000], [27, 1, 'COMPRA LIDL AGRADECE', -3876], [25, 1, 'COMPRA SPOTIFY AB', -799], [22, 1, 'UBER *TRIP LISBOA', -740], [20, 1, 'PAGAMENTO MEO SERVICOS', -3299],
    [18, 1, 'COMPRA CONTINENTE MODELO LISBOA', -7125], [15, 1, 'TRANSFERENCIA PARA POUPANCA', -20000], [15, 2, 'TRANSFERENCIA DA CONTA ORDEM', 20000], [14, 2, 'JUROS CREDORES', 312],
    [12, 1, 'COMPRA REPSOL ESTACAO', -4890], [9, 1, 'COMPRA PADARIA CENTRAL', -380], [6, 1, 'IMPOSTO DE SELO', -18], [3, 1, 'COMPRA PINGO DOCE ALGES', -2954], [1, 1, 'REEMBOLSO COMPRA CONTINENTE', 1250],
  ].sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const open = { 1: 120000, 2: 250000 };
  const bal = { ...open };
  const lines = [
    'EXTRATO DE EXEMPLO - DADOS FICTÍCIOS (gerado pela aplicação Finanças);;;;;',
    'Banco Exemplo, S.A.;;;;;',
    `Período;${ddmmyyyy(day(58))} a ${ddmmyyyy(day(0))};;;;`,
    ';;;;;',
    'Conta;Data mov.;Data valor;Descrição;Montante;Saldo contabilístico',
  ];
  for (const [ago, c, desc, v] of tx) {
    bal[c] += v;
    lines.push([c === 1 ? SAMPLE_IBAN_1 : SAMPLE_IBAN_2, ddmmyyyy(day(ago)), ddmmyyyy(day(ago)), desc, fmt(v), fmt(bal[c])].join(';'));
  }
  lines.push(';;;;;', 'Total de movimentos;' + tx.length + ';;;;');
  return { nome: 'extrato-exemplo.csv', texto: lines.join('\r\n') + '\r\n', saldos: bal, aberturas: open, n: tx.length };
}
