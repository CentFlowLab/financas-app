// Fixtures PDF SINTÉTICAS (dados 100% fictícios) que imitam estilos de extratos de bancos diferentes.
// Geradas por programa com pdf-lib (devDependency) e, para os PDFs/imagens digitalizados, com o Chromium do Playwright.
// Cada fixture devolve também os valores esperados (guardados em expected.json → chave «gen»).
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const out = (n, data) => writeFileSync(join(dir, n), data);

// ---------- formatação de números ----------
const grp = (s, sep) => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
const pt = (c) => grp(Math.abs(c / 100).toFixed(2).split('.')[0], '.') + ',' + Math.abs(c / 100).toFixed(2).split('.')[1]; // 1.234,56 (sem sinal)
const en = (c) => grp(Math.abs(c / 100).toFixed(2).split('.')[0], ',') + '.' + Math.abs(c / 100).toFixed(2).split('.')[1]; // 1,234.56 (sem sinal)
const ptS = (c) => (c < 0 ? '-' : '') + pt(c);
const enS = (c) => (c < 0 ? '-' : '') + en(c);
const p2 = (n) => String(n).padStart(2, '0');
const [Y, MPT, MEN] = [2026, ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'], ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']];
const iso = (m, d) => `${Y}-${p2(m)}-${p2(d)}`;

// ---------- escritor de PDF ----------
async function newDoc() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); doc.setProducer('fixtures'); doc.setCreator('fixtures');
  const f = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) };
  return { doc, f };
}
class Pg {
  constructor(d) { this.d = d; this.p = d.doc.addPage([595, 842]); this.f = d.f; }
  T(x, y, s, size = 8.5, bold = false) { this.p.drawText(String(s), { x, y, size, font: bold ? this.f.b : this.f.r, color: rgb(0, 0, 0) }); }
  R(xr, y, s, size = 8.5, bold = false) { const w = (bold ? this.f.b : this.f.r).widthOfTextAtSize(String(s), size); this.T(xr - w, y, s, size, bold); }
  V(x, y, s, size = 6) { this.p.drawText(String(s), { x, y, size, font: this.f.r, rotate: degrees(90), color: rgb(0.4, 0.4, 0.4) }); } // texto vertical (margem)
}
const save = async (d) => Buffer.from(await d.doc.save());

// ---------- (a) colunas Débito / Crédito + Saldo, dd/mm/aaaa ----------
async function fxA() {
  const d = await newDoc(); const p = new Pg(d);
  const open = 154320;
  const tx = [[3, 2, 'ORDENADO EMPRESA ALFA LDA', 0, 185000], [3, 5, 'COMPRA CONTINENTE MODELO ALFA', 7432, 0], [3, 7, 'PAGAMENTO SERVICOS AGUAS', 2318, 0], [3, 8, 'TRF MB WAY DE FULANO TESTE', 0, 2500], [3, 10, 'LEVANTAMENTO ATM ALFA CENTRO', 4000, 0], [3, 11, 'COMPRA FARMACIA ALFA', 1895, 0], [3, 12, 'DD EDP COMERCIAL', 6540, 0], [3, 13, 'PAGAMENTO RENDA CASA', 85000, 0], [3, 16, 'JUROS CREDORES', 0, 112], [3, 18, 'COMPRA RESTAURANTE O ALFA', 3260, 0], [3, 20, 'REEMBOLSO FATURA TESTE', 0, 1590], [3, 23, 'COMISSAO MANUTENCAO CONTA', 450, 0], [3, 25, 'COMPRA LIVRARIA ALFA', 2490, 0], [3, 27, 'TRANSFERENCIA ENVIADA CICLANO', 15000, 0], [3, 30, 'COMPRA SUPERMERCADO ALFA', 12345, 0]];
  p.T(40, 800, 'BANCO ALFA, S.A.', 13, true); p.T(40, 784, 'Extrato de Conta à Ordem (documento fictício para testes)');
  p.T(40, 764, 'IBAN: PT50 9999 0001 0000 0000 0000 1'); p.T(40, 752, 'Período: 01/03/2026 a 31/03/2026');
  const y0 = 715; const hdr = (y) => { p.T(40, y, 'Data Mov.', 8, true); p.T(100, y, 'Data Valor', 8, true); p.T(160, y, 'Descrição', 8, true); p.R(408, y, 'Débito', 8, true); p.R(473, y, 'Crédito', 8, true); p.R(550, y, 'Saldo', 8, true); };
  hdr(y0); let y = y0 - 18; p.T(160, y, 'Saldo anterior'); p.R(550, y, pt(open)); y -= 14;
  let bal = open; let soma = 0;
  for (const [m, dd, desc, db, cr] of tx) { bal += cr - db; soma += cr - db; const ds = `${p2(dd)}/${p2(m)}/${Y}`; p.T(40, y, ds); p.T(100, y, ds); p.T(160, y, desc); if (db) p.R(408, y, pt(db)); if (cr) p.R(473, y, pt(cr)); p.R(550, y, (bal < 0 ? '-' : '') + pt(bal)); y -= 13; }
  y -= 6; p.T(160, y, 'Saldo final', 8, true); p.R(550, y, pt(bal), 8, true);
  p.T(40, 40, 'Página 1 de 1', 7);
  out('gen-a-debito-credito.pdf', await save(d));
  return { n: tx.length, opening: open, final: bal, soma, entradas: tx.filter((t) => t[4]).length, saidas: tx.filter((t) => t[3]).length, first: tx[0][2], firstDate: iso(3, 2), lastDate: iso(3, 30), lastValor: -12345, iban: 'PT50999900010000000000001' };
}

// ---------- (b) coluna única «Montante» com sinal, sem saldo; (b2) valores sem sinal com palavras-chave ----------
async function fxB() {
  const d = await newDoc(); const p = new Pg(d);
  const tx = [[1, 'ORDENADO EMPRESA BETA SA', 162000], [2, 'COMPRA GALP POSTO BETA', -5420], [4, 'PAGAMENTO SERVICOS MEO', -3999], [5, 'TRANSFERÊNCIA RECEBIDA CICLANO TESTE', 5000], [8, 'COMPRA PADARIA BETA', -285], [9, 'LEVANTAMENTO MULTIBANCO', -4000], [12, 'COMPRA ZARA ONLINE', -7990], [15, 'JUROS CREDORES', 87], [17, 'COMISSÃO DE CONTA', -520], [19, 'REEMBOLSO IRS', 24510], [22, 'COMPRA CAFE BETA', -165], [28, 'TRANSFERÊNCIA ENVIADA FULANO TESTE', -20000]];
  p.T(40, 800, 'BETA BANK', 13, true); p.T(40, 784, 'Movimentos da conta (documento fictício para testes)'); p.T(40, 764, 'IBAN PT50 9999 0002 0000 0000 0000 2'); p.T(40, 752, 'Movimentos de 01-04-2026 a 30-04-2026');
  p.T(60, 715, 'Data', 8, true); p.T(130, 715, 'Descrição', 8, true); p.R(520, 715, 'Montante (EUR)', 8, true);
  let y = 697; let soma = 0; for (const [dd, desc, v] of tx) { soma += v; p.T(60, y, `${p2(dd)}-04-${Y}`); p.T(130, y, desc); p.R(520, y, (v > 0 ? '+' : '') + ptS(v)); y -= 13; }
  out('gen-b-montante-com-sinal.pdf', await save(d));
  // b2: sem sinal e sem saldo (sinal por palavras-chave / posição)
  const d2 = await newDoc(); const q = new Pg(d2);
  const tx2 = [[1, 'ORDENADO EMPRESA BETA SA', 162000, 1], [3, 'COMPRA SUPERMERCADO BETA', 6789, -1], [4, 'PAGAMENTO SERVICOS EDP', 5120, -1], [7, 'TRANSFERENCIA RECEBIDA DE CICLANO', 3000, 1], [9, 'LEVANTAMENTO MULTIBANCO', 5000, -1], [11, 'JUROS CREDORES', 64, 1], [14, 'COMISSAO MANUTENCAO', 450, -1], [18, 'DEBITO DIRETO VODAFONE', 3499, -1], [21, 'MOVIMENTO DIVERSO 4471', 1234, 0], [24, 'REGULARIZACAO 889', 777, 0]];
  q.T(40, 800, 'GAMA BANK (fictício)', 13, true); q.T(40, 764, 'Extrato 04/2026'); q.T(40, 752, 'Período de 01-04-2026 a 30-04-2026');
  q.T(60, 715, 'Data', 8, true); q.T(130, 715, 'Descrição', 8, true); q.R(520, 715, 'Valor', 8, true);
  y = 697; for (const [dd, desc, v] of tx2) { q.T(60, y, `${p2(dd)}-04-${Y}`); q.T(130, y, desc); q.R(520, y, pt(v)); y -= 13; }
  out('gen-b2-sem-sinal.pdf', await save(d2));
  return { n: tx.length, soma, entradas: tx.filter((t) => t[2] > 0).length, saidas: tx.filter((t) => t[2] < 0).length, firstDate: iso(4, 1), lastDate: iso(4, 28), lastValor: -20000, first: tx[0][1],
    b2: { n: tx2.length, valores: tx2.map((t) => t[3] * t[2]), incertos: tx2.filter((t) => t[3] === 0).length, sinais: tx2.map((t) => t[3]) } };
}

// ---------- (c) datas dd-mm sem ano (ano só no cabeçalho), descrições em várias linhas, sinal final «12,50-», saldo, 2 páginas ----------
async function fxC() {
  const d = await newDoc();
  const open = 250000;
  const tx = [[3, 2, ['COMPRA LOJA DE ELETRODOMESTICOS', 'CENTRO COMERCIAL DELTA', 'REF 55123'], -34990], [3, 3, ['TRF CRED SEPA+ ORDENADO', 'EMPRESA DELTA LDA'], 148000], [3, 5, ['PAGAMENTO SERVICOS'], -2550], [3, 6, ['COMPRA SUPERMERCADO DELTA'], -6012], [3, 9, ['TRANSFERENCIA PARA POUPANCA', 'OBJETIVO FERIAS', 'ORDEM PERMANENTE'], -10000], [3, 10, ['COMPRA FARMACIA DELTA'], -1450], [3, 12, ['DEPOSITO NUMERARIO', 'AGENCIA DELTA CENTRO'], 20000], [3, 13, ['DD SEGURO AUTOMOVEL', 'APOLICE 0099-TESTE'], -4821], [3, 16, ['COMPRA ONLINE LIVRARIA'], -1890], [3, 18, ['TRF IMEDIATA DE FULANO TESTE'], 7500], [3, 20, ['COMPRA POSTO COMBUSTIVEL', 'A1 AREA DE SERVICO DELTA'], -6500], [3, 23, ['PAGAMENTO CARTAO DE CREDITO'], -15000], [3, 26, ['COMPRA CAFE DELTA'], -190], [3, 27, ['IMPOSTO DO SELO'], -32], [3, 30, ['TRF CRED SEPA+ SUBSIDIO', 'SEGURANCA SOCIAL'], 12000]];
  const IMP = 'CONTA DELTA — EXTRATO MARCO 2026 (fictício)';
  const pages = [tx.slice(0, 8), tx.slice(8)]; let bal = open; let soma = 0; const descs = [];
  pages.forEach((rows, pi) => {
    const p = new Pg(d);
    p.T(40, 806, 'DELTA BANK  |  ' + IMP, 8, true); p.R(555, 806, `Página ${pi + 1} de 2`, 8);
    if (pi === 0) { p.T(40, 786, 'IBAN PT50 9999 0003 0000 0000 0000 3'); p.T(40, 774, 'Extrato do período 01-03-2026 a 31-03-2026'); }
    let y = pi === 0 ? 740 : 770;
    p.T(40, y, 'Data', 8, true); p.T(95, y, 'Descritivo', 8, true); p.R(430, y, 'Valor', 8, true); p.R(550, y, 'Saldo', 8, true); y -= 16;
    if (pi === 0) { p.T(95, y, 'SALDO INICIAL'); p.R(550, y, pt(open)); y -= 16; }
    for (const [m, dd, lines, v] of rows) {
      bal += v; soma += v; descs.push(lines.join(' '));
      p.T(40, y, `${p2(dd)}-${p2(m)}`); p.T(95, y, lines[0]); p.R(430, y, v < 0 ? pt(v) + '-' : pt(v)); p.R(550, y, pt(bal));
      for (const extra of lines.slice(1)) { y -= 10; p.T(95, y, extra); }
      y -= 16;
    }
    if (pi === 1) { y -= 6; p.T(95, y, 'SALDO FINAL', 8, true); p.R(550, y, pt(bal), 8, true); }
    p.T(40, 40, 'DELTA BANK, S.A. — Capital Social 5.000.000 EUR — documento fictício', 6);
  });
  out('gen-c-ddmm-multilinha.pdf', await save(d));
  return { n: tx.length, opening: open, final: bal, soma, firstDate: iso(3, 2), lastDate: iso(3, 30), descs, entradas: tx.filter((t) => t[3] > 0).length, saidas: tx.filter((t) => t[3] < 0).length };
}

// ---------- (d) inglês: «Apr 12, 2026», valores «-1,234.56», saldo (estilo Revolut/Wise); (d2) «12 April 2026» com Incoming/Outgoing ----------
async function fxD() {
  const d = await newDoc(); const p = new Pg(d);
  const open = 312050;
  const tx = [[4, 1, 'Payment from Fulano Test', 125000], [4, 2, 'Coffee Shop Lisbon', -380], [4, 3, 'Transfer to Savings Pocket', -50000], [4, 5, 'Online Shop Ltd', -12999], [4, 8, 'Salary ACME Ltd', 245000], [4, 9, 'Rent April', -123456], [4, 12, 'Card Payment Supermarket', -8745], [4, 14, 'Refund Online Shop Ltd', 12999], [4, 18, 'ATM Withdrawal Lisbon', -6000], [4, 22, 'Subscription Music', -999], [4, 28, 'Interest Paid', 154]];
  p.T(40, 800, 'ACME MONEY (fictitious)', 13, true); p.T(40, 784, 'Account statement'); p.T(40, 770, 'EUR Account · IBAN PT50 9999 0004 0000 0000 0000 4'); p.T(40, 756, 'Apr 1, 2026 – Apr 30, 2026');
  p.T(40, 735, 'Opening balance', 8, true); p.R(550, 735, '€' + en(open)); 
  p.T(40, 700, 'Date', 8, true); p.T(120, 700, 'Description', 8, true); p.R(430, 700, 'Amount', 8, true); p.R(550, 700, 'Balance', 8, true);
  let y = 684, bal = open, soma = 0; for (const [m, dd, desc, v] of tx) { bal += v; soma += v; p.T(40, y, `${MEN[m - 1]} ${dd}, ${Y}`); p.T(120, y, desc); p.R(430, y, enS(v)); p.R(550, y, enS(bal)); y -= 13; }
  y -= 8; p.T(40, y, 'Closing balance', 8, true); p.R(550, y, '€' + en(bal), 8, true);
  out('gen-d-english-revolut.pdf', await save(d));
  // d2: Date | Description | Incoming | Outgoing | Balance, «12 April 2026»
  const d2 = await newDoc(); const q = new Pg(d2);
  const MFULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const tx2 = [[4, 2, 'Received from Ciclano Test', 90000, 0], [4, 4, 'Sent to Beltrano Test', 0, 30000], [4, 11, 'Card purchase Bookstore', 0, 4590], [4, 15, 'Conversion fee', 0, 120], [4, 20, 'Received from Fulano Test', 15000, 0]];
  q.T(40, 800, 'WISP PAYMENTS (fictitious)', 13, true); q.T(40, 784, 'Statement from 1 April 2026 to 30 April 2026'); q.T(40, 770, 'IBAN PT50 9999 0005 0000 0000 0000 5');
  q.T(40, 735, 'Date', 8, true); q.T(130, 735, 'Description', 8, true); q.R(380, 735, 'Incoming', 8, true); q.R(450, 735, 'Outgoing', 8, true); q.R(550, 735, 'Balance', 8, true);
  let y2 = 719, bal2 = 100000, soma2 = 0; q.T(130, y2, 'Opening balance'); q.R(550, y2, en(bal2)); y2 -= 13;
  for (const [m, dd, desc, i, o] of tx2) { bal2 += i - o; soma2 += i - o; q.T(40, y2, `${dd} ${MFULL[m - 1]} ${Y}`); q.T(130, y2, desc); if (i) q.R(380, y2, en(i)); if (o) q.R(450, y2, en(o)); q.R(550, y2, en(bal2)); y2 -= 13; }
  out('gen-d2-english-incoming-outgoing.pdf', await save(d2));
  return { n: tx.length, opening: open, final: bal, soma, firstDate: iso(4, 1), lastDate: iso(4, 28), entradas: tx.filter((t) => t[3] > 0).length, saidas: tx.filter((t) => t[3] < 0).length, rentValor: -123456, first: tx[0][2],
    d2: { n: tx2.length, soma: soma2, final: bal2, opening: 100000, firstDate: iso(4, 2), lastDate: iso(4, 20), valores: tx2.map((t) => t[3] - t[4]) } };
}

// ---------- (e) vários produtos num só PDF: conta à ordem + poupança + cartão ----------
async function fxE() {
  const d = await newDoc();
  const p = new Pg(d);
  p.T(40, 806, 'EPSILON BANK — Extrato combinado Março 2026 (fictício)', 10, true); p.T(40, 792, 'Período: 01-03-2026 a 31-03-2026');
  p.T(40, 770, 'Os seus produtos', 9, true);
  // 1) conta à ordem (Débito/Crédito/Saldo)
  p.T(40, 740, 'Conta à Ordem Epsilon', 9, true); p.T(40, 728, 'IBAN: PT50 9999 0006 0000 0000 0000 6');
  const ord = [[3, 2, 'ORDENADO EMPRESA EPSILON', 0, 150000], [3, 4, 'COMPRA SUPERMERCADO EPSILON', 6540, 0], [3, 10, 'TRANSFERENCIA PARA POUPANCA', 20000, 0], [3, 15, 'PAGAMENTO CARTAO CREDITO', 12500, 0], [3, 22, 'COMPRA FARMACIA EPSILON', 1830, 0]];
  const oOpen = 80000; let ob = oOpen;
  const hd = (pp, y, a, b, c, dd) => { pp.T(40, y, 'Data', 8, true); pp.T(100, y, 'Descrição', 8, true); if (dd) { pp.R(400, y, a, 8, true); pp.R(470, y, b, 8, true); pp.R(550, y, c, 8, true); } else { pp.R(470, y, a, 8, true); pp.R(550, y, b, 8, true); } };
  hd(p, 700, 'Débito', 'Crédito', 'Saldo', true); let y = 686; p.T(100, y, 'Saldo inicial'); p.R(550, y, pt(oOpen)); y -= 13;
  for (const [m, dd, desc, db, cr] of ord) { ob += cr - db; p.T(40, y, `${p2(dd)}-${p2(m)}`); p.T(100, y, desc); if (db) p.R(400, y, pt(db)); if (cr) p.R(470, y, pt(cr)); p.R(550, y, pt(ob)); y -= 13; }
  p.T(100, y, 'Saldo final', 8, true); p.R(550, y, pt(ob), 8, true); y -= 40;
  // 2) poupança (Movimento + Saldo)
  p.T(40, y, 'Conta Poupança Objetivo Férias', 9, true); y -= 12; p.T(40, y, 'IBAN: PT50 9999 0007 0000 0000 0000 7'); y -= 28;
  const pou = [[3, 10, 'TRANSFERENCIA DA CONTA ORDEM', 20000], [3, 31, 'JUROS CREDORES', 215]]; const sOpen = 500000; let sb = sOpen;
  hd(p, y, 'Montante', 'Saldo', '', false); y -= 14; p.T(100, y, 'Saldo anterior'); p.R(550, y, pt(sOpen)); y -= 13;
  for (const [m, dd, desc, v] of pou) { sb += v; p.T(40, y, `${p2(dd)}-${p2(m)}`); p.T(100, y, desc); p.R(470, y, ptS(v)); p.R(550, y, pt(sb)); y -= 13; }
  p.T(100, y, 'Saldo final', 8, true); p.R(550, y, pt(sb), 8, true);
  // página 2: cartão de crédito
  const p2g = new Pg(d); p2g.T(40, 806, 'EPSILON BANK — Extrato combinado Março 2026 (fictício)', 10, true); p2g.T(500, 806, 'Página 2', 8);
  p2g.T(40, 770, 'Cartão de Crédito Visa Epsilon', 9, true); p2g.T(40, 758, 'Cartão n.º **** **** **** 4242'); 
  const car = [[3, 5, 'COMPRA LOJA ONLINE EPSILON', -4999], [3, 8, 'COMPRA RESTAURANTE EPSILON', -3250], [3, 12, 'COMPRA POSTO COMBUSTIVEL', -5000], [3, 15, 'PAGAMENTO RECEBIDO - OBRIGADO', 12500], [3, 19, 'COMPRA CINEMA EPSILON', -1400]];
  hd(p2g, 725, 'Montante', 'Saldo', '', false); let yc = 711; const cOpen = -12500; let cb = cOpen; p2g.T(100, yc, 'Saldo anterior'); p2g.R(550, yc, ptS(cOpen)); yc -= 13;
  for (const [m, dd, desc, v] of car) { cb += v; p2g.T(40, yc, `${p2(dd)}-${p2(m)}`); p2g.T(100, yc, desc); p2g.R(470, yc, ptS(v)); p2g.R(550, yc, ptS(cb)); yc -= 13; }
  p2g.T(100, yc, 'Saldo final', 8, true); p2g.R(550, yc, ptS(cb), 8, true);
  out('gen-e-multi-conta.pdf', await save(d));
  return { sections: 3, ord: { n: ord.length, opening: oOpen, final: ob }, pou: { n: pou.length, opening: sOpen, final: sb }, car: { n: car.length, opening: cOpen, final: cb, valores: car.map((c) => c[3]) }, total: ord.length + pou.length + car.length, iban1: 'PT50999900060000000000006', iban2: 'PT50999900070000000000007' };
}

// ---------- (f) extrato de cartão: compras e um pagamento; «12 abr»; valores sem sinal e «CR» nos créditos ----------
async function fxF() {
  const d = await newDoc(); const p = new Pg(d);
  p.T(40, 800, 'ZETA CARDS (fictício)', 13, true); p.T(40, 784, 'Extrato do cartão de crédito Mastercard — cartão terminado em 7788'); p.T(40, 770, 'Período do extrato: 01 abr 2026 a 30 abr 2026');
  p.T(40, 756, 'Saldo anterior'); p.R(550, 756, '350,00');
  p.T(40, 730, 'Data', 8, true); p.T(100, 730, 'Data valor', 8, true); p.T(170, 730, 'Descrição', 8, true); p.R(550, 730, 'Montante (EUR)', 8, true);
  const tx = [[2, 3, 'AMAZON MARKETPLACE', 4599, -1], [3, 5, 'UBER *TRIP LISBOA', 1260, -1], [4, 8, 'CONTINENTE MODELO', 8734, -1], [8, 9, 'PAGAMENTO POR DEBITO EM CONTA', 35000, 1], [10, 11, 'RESTAURANTE ZETA', 4250, -1], [14, 15, 'NETFLIX.COM', 1199, -1], [20, 21, 'ESTORNO LOJA ZETA', 2000, 1], [25, 26, 'JUROS E ENCARGOS', 410, -1]];
  let y = 714; let soma = 0;
  for (const [dd, dv, desc, v, s] of tx) { soma += s * v; p.T(40, y, `${p2(dd)} ${MPT[3]}`); p.T(100, y, `${p2(dv)} ${MPT[3]}`); p.T(170, y, desc); p.R(550, y, pt(v) + (s > 0 ? ' CR' : '')); y -= 13; }
  y -= 8; p.T(40, y, 'Novo saldo', 8, true); p.R(550, y, pt(35000 - soma), 8, true);
  out('gen-f-cartao.pdf', await save(d));
  // convenção do cartão no app: compras = saída (−), pagamentos/estornos = entrada (+)
  return { n: tx.length, valores: tx.map((t) => t[4] * t[3]), soma, firstDate: iso(4, 2), lastDate: iso(4, 25), entradas: tx.filter((t) => t[4] > 0).length, saidas: tx.filter((t) => t[4] < 0).length, tipo: 'cartao', opening: 35000, final: 35000 - soma };
}

// ---------- (h) 3 páginas: cabeçalho/rodapé repetidos, texto vertical na margem a cruzar as linhas, cabeçalho de tabela repetido ----------
async function fxH() {
  const d = await newDoc();
  const open = 100000; let bal = open, soma = 0; const all = [];
  const days = [[3, 2], [3, 3], [3, 4], [3, 6], [3, 9], [3, 10], [3, 11], [3, 13], [3, 16], [3, 17], [3, 18], [3, 20], [3, 23], [3, 24], [3, 25], [3, 26], [3, 27], [3, 30]];
  const names = ['COMPRA SUPERMERCADO ETA', 'TRF RECEBIDA FULANO TESTE', 'PAGAMENTO LUZ ETA', 'COMPRA CAFE ETA', 'DD AGUA ETA', 'ORDENADO EMPRESA ETA', 'COMPRA ROUPA ETA', 'COMPRA LIVRARIA ETA', 'TRF ENVIADA CICLANO', 'COMPRA PADARIA ETA', 'COMPRA GINASIO ETA', 'COMPRA GASOLEO ETA', 'REEMBOLSO ETA', 'COMPRA JARDIM ETA', 'PAGAMENTO SEGURO ETA', 'COMPRA CINEMA ETA', 'TRF RECEBIDA BELTRANO', 'COMPRA SUPERMERCADO ETA'];
  const vals = [-6540, 3000, -4120, -180, -2210, 140000, -5990, -1650, -10000, -320, -3500, -5800, 2500, -2300, -7400, -1400, 4500, -4412];
  days.forEach(([m, dd], i) => { bal += vals[i]; soma += vals[i]; all.push({ ds: `${p2(dd)}/${p2(m)}/${Y}`, desc: names[i], v: vals[i], bal }); });
  const per = [all.slice(0, 7), all.slice(7, 14), all.slice(14)];
  per.forEach((rows, pi) => {
    const p = new Pg(d);
    p.T(40, 812, 'ETA BANK — EXTRATO DE CONTA N.º 3/2026', 8, true); p.R(555, 812, `PÁGINA ${pi + 1}/3`, 8); p.T(40, 800, 'IBAN PT50 9999 0008 0000 0000 0000 8 — Período 01/03/2026 a 31/03/2026', 7);
    p.T(40, 30, 'ETA BANK, S.A. — Sede: Rua Exemplo 1, Lisboa — Capital Social 1.000.000 EUR — NIPC 999999999 — documento fictício', 6);
    p.T(40, 20, 'Reclamações: www.exemplo.invalid', 6);
    let y = 760; p.T(40, y, 'Data', 8, true); p.T(110, y, 'Descrição', 8, true); p.R(430, y, 'Montante', 8, true); p.R(545, y, 'Saldo', 8, true); y -= 16;
    if (pi === 0) { p.T(110, y, 'Saldo anterior'); p.R(545, y, pt(open)); y -= 14; }
    rows.forEach((r) => { p.T(40, y, r.ds); p.T(110, y, r.desc); p.R(430, y, ptS(r.v)); p.R(545, y, ptS(r.bal)); y -= 20; });
    if (pi < 2) p.T(300, 60, 'Continua na página seguinte', 7);
    else { p.T(110, y, 'Saldo final', 8, true); p.R(545, y, ptS(bal), 8, true); }
    for (let yy = 100; yy < 780; yy += 70) p.V(18, yy, 'ETA BANK S.A. · DOCUMENTO CONFIDENCIAL · NÃO REPRODUZIR');
    p.V(300, 400, 'MARCA DE ÁGUA ROTATIVA'); p.V(330, 300, 'RASCUNHO 2026'); // cruza as linhas da tabela
  });
  out('gen-h-rodado-repetido.pdf', await save(d));
  return { n: all.length, opening: open, final: bal, soma, firstDate: iso(3, 2), lastDate: iso(3, 30), descs: all.map((a) => a.desc) };
}

// ---------- (i) PDF que não é um extrato ----------
async function fxI() {
  const d = await newDoc(); const p = new Pg(d);
  p.T(40, 780, 'Receita de bolo de laranja', 14, true);
  ['Ingredientes: 3 ovos, 200 g de açúcar, 1 laranja, 250 g de farinha.', 'Preparação: bata os ovos com o açúcar, junte o sumo e a raspa da laranja.', 'Leve ao forno a 180 graus durante 40 minutos.', 'Este documento não tem tabelas nem movimentos.'].forEach((t, i) => p.T(40, 750 - i * 14, t, 10));
  out('gen-i-nao-extrato.pdf', await save(d));
  return {};
}

// ---------- (j, j2) colunas com títulos desconhecidos e descrições neutras: o leitor automático não decide o sinal -> ajuste manual ----------
async function fxJ() {
  const mk = async (file, m, iban, tx) => {
    const d = await newDoc(); const p = new Pg(d);
    p.T(40, 800, 'ZETA BANK (fictício)', 13, true); p.T(40, 784, `Lista de operações ${p2(m)}/${Y}`); p.T(40, 764, `IBAN ${iban}`);
    p.T(60, 715, 'Quando', 8, true); p.T(130, 715, 'Detalhe', 8, true); p.R(430, 715, 'Recebi', 8, true); p.R(520, 715, 'Gastei', 8, true);
    let y = 697; for (const [dd, desc, db, cr] of tx) { p.T(60, y, `${p2(dd)}/${p2(m)}/${Y}`); p.T(130, y, desc); if (db) p.R(520, y, pt(db)); if (cr) p.R(430, y, pt(cr)); y -= 13; }
    out(file, await save(d));
    return { n: tx.length, soma: tx.reduce((a, t) => a + t[3] - t[2], 0), valores: tx.map((t) => t[3] - t[2]), firstDate: iso(m, tx[0][0]), lastDate: iso(m, tx[tx.length - 1][0]), iban: iban.replace(/\s/g, '') };
  };
  const j = await mk('gen-j-colunas-desconhecidas.pdf', 3, 'PT50 9999 0011 0000 0000 0000 1', [[2, 'MERCADO ZETA CENTRAL', 4321, 0], [3, 'EMPRESA OMEGA LDA', 0, 150000], [5, 'LOJA KAPPA 1', 2750, 0], [8, 'SERVICO LAMBDA 22', 1999, 0], [10, 'CLIENTE MU TESTE', 0, 6000], [12, 'OFICINA NI', 8400, 0], [15, 'PADARIA XI', 320, 0], [17, 'CLINICA OMICRON', 3500, 0], [19, 'FULANO PI TESTE', 0, 2500], [23, 'LOJA RHO 7', 1250, 0], [26, 'LIVRARIA SIGMA', 2290, 0], [29, 'MERCADO TAU', 5675, 0]]);
  const j2 = await mk('gen-j2-colunas-desconhecidas-abril.pdf', 4, 'PT50 9999 0011 0000 0000 0000 1', [[1, 'MERCADO UPSILON', 3890, 0], [4, 'EMPRESA OMEGA LDA', 0, 150000], [6, 'LOJA FI 3', 1500, 0], [9, 'OFICINA CHI', 6200, 0], [14, 'CICLANO PSI TESTE', 0, 4000], [21, 'SERVICO OMEGA 5', 2100, 0]]);
  return { ...j, j2 };
}

// ---------- (k) uma coluna sem sinal e descrições neutras: nada indica entrada/saída -> confiança baixa ----------
async function fxK() {
  const d = await newDoc(); const p = new Pg(d);
  const tx = [[2, 'MERCADO ZETA CENTRAL', 4321], [3, 'EMPRESA OMEGA LDA', 150000], [5, 'LOJA KAPPA 1', 2750], [8, 'SERVICO LAMBDA 22', 1999], [10, 'CLIENTE MU TESTE', 6000], [12, 'OFICINA NI', 8400], [15, 'PADARIA XI', 320], [17, 'CLINICA OMICRON', 3500]];
  p.T(40, 800, 'KAPPA BANK (fictício)', 13, true); p.T(40, 784, 'Operações 03/2026'); p.T(40, 764, 'IBAN PT50 9999 0012 0000 0000 0000 2');
  p.T(60, 715, 'Data', 8, true); p.T(130, 715, 'Descrição', 8, true); p.R(520, 715, 'Quantia', 8, true);
  let y = 697; for (const [dd, desc, v] of tx) { p.T(60, y, `${p2(dd)}/03/${Y}`); p.T(130, y, desc); p.R(520, y, pt(v)); y -= 13; }
  out('gen-k-sem-sinal-neutro.pdf', await save(d));
  return { n: tx.length, abs: tx.map((t) => t[2]) };
}

// ---------- (l) espanhol com data valor; (m) «12 abr» sem ano + sinal no fim (45,00-) / CR-DB ----------
async function fxLM() {
  const d = await newDoc(); const p = new Pg(d);
  const tx = [[2, 'COMPRA MERCADONA VALENCIA', -4512], [3, 'NOMINA EMPRESA ALFA SL', 189000], [6, 'RECIBO LUZ IBERDROLA', -6890], [9, 'TRANSFERENCIA RECIBIDA FULANO TEST', 5000], [14, 'COMPRA FARMACIA CENTRAL', -1275], [20, 'RETIRADA CAJERO', -6000]];
  p.T(40, 800, 'BANCO EPSILON (ficticio)', 13, true); p.T(40, 784, 'Extracto de cuenta corriente'); p.T(40, 770, 'IBAN ES91 2100 0418 4502 0005 1332'); p.T(40, 756, 'Periodo: 01/03/2026 - 31/03/2026');
  p.T(40, 715, 'Fecha', 8, true); p.T(95, 715, 'Fecha valor', 8, true); p.T(160, 715, 'Concepto', 8, true); p.R(470, 715, 'Importe', 8, true); p.R(550, 715, 'Saldo', 8, true);
  let bal = 100000, y = 697; p.T(160, y, 'Saldo anterior', 8, true); p.R(550, y, pt(bal), 8, true); y -= 13;
  for (const [dd, desc, v] of tx) { bal += v; const ds = `${p2(dd)}/03/${Y}`, dv = `${p2(dd + 1)}/03/${Y}`; p.T(40, y, ds); p.T(95, y, dv); p.T(160, y, desc); p.R(470, y, ptS(v)); p.R(550, y, pt(bal)); y -= 13; }
  out('gen-l-espanhol.pdf', await save(d));
  const l = { n: tx.length, valores: tx.map((t) => t[2]), opening: 100000, final: bal, firstDate: iso(3, 2), lastDate: iso(3, 20), iban: 'ES9121000418450200051332' };
  const d2 = await newDoc(); const q = new Pg(d2);
  const tx2 = [[3, 'abr', 'COMPRA CONTINENTE MODELO', -5430, 'DB'], [5, 'abr', 'ORDENADO EMPRESA GAMA LDA', 150000, 'CR'], [9, 'abr', 'PAGAMENTO SERVICOS AGUAS', -2310, 'DB'], [12, 'abr', 'TRF RECEBIDA CICLANO TESTE', 4000, 'CR'], [18, 'abr', 'COMPRA RESTAURANTE O GAMA', -3260, 'DB']];
  q.T(40, 800, 'GAMA BANK (fictício)', 13, true); q.T(40, 784, 'Extrato de Abril 2026'); q.T(40, 768, 'IBAN PT50 9999 0013 0000 0000 0000 3');
  q.T(60, 715, 'Data', 8, true); q.T(130, 715, 'Descrição', 8, true); q.R(450, 715, 'Montante', 8, true); q.T(470, 715, 'D/C', 8, true);
  let y2 = 697; for (const [dd, mon, desc, v, dc] of tx2) { q.T(60, y2, `${p2(dd)} ${mon}`); q.T(130, y2, desc); q.R(450, y2, pt(v)); q.T(470, y2, dc); y2 -= 13; }
  out('gen-m-mes-curto-cr-db.pdf', await save(d2));
  const d3 = await newDoc(); const r = new Pg(d3);
  r.T(40, 800, 'OMEGA BANK (fictício)', 13, true); r.T(40, 784, 'Extrato Abril 2026'); r.T(40, 768, 'IBAN PT50 9999 0014 0000 0000 0000 4');
  r.T(60, 715, 'Data', 8, true); r.T(130, 715, 'Descrição', 8, true); r.R(520, 715, 'Montante', 8, true);
  y2 = 697; for (const [dd, mon, desc, v] of tx2) { r.T(60, y2, `${p2(dd)} ${mon}`); r.T(130, y2, desc); r.R(520, y2, pt(v) + (v < 0 ? '-' : '')); y2 -= 13; }
  out('gen-m2-sinal-no-fim.pdf', await save(d3));
  return { ...l, m: { n: tx2.length, valores: tx2.map((t) => t[3]), firstDate: iso(4, 3), lastDate: iso(4, 18) } };
}

// ---------- (g) digitalizados: HTML → imagem (Chromium) → PDF só com imagem + PNG/JPG ----------
function html() {
  const rows = [[3, 2, 'ORDENADO EMPRESA SIGMA LDA', 0, 172500], [3, 3, 'COMPRA SUPERMERCADO SIGMA', 5890, 0], [3, 5, 'PAGAMENTO SERVICOS EDP', 4720, 0], [3, 9, 'TRF MB WAY DE FULANO TESTE', 0, 3500], [3, 12, 'COMPRA FARMACIA SIGMA', 1260, 0], [3, 16, 'LEVANTAMENTO ATM SIGMA', 4000, 0], [3, 20, 'REEMBOLSO FATURA SIGMA', 0, 2230], [3, 27, 'COMPRA CAFE SIGMA', 1850, 0]];
  const open = 90000; let bal = open; let soma = 0;
  const trs = rows.map(([m, d, desc, db, cr]) => { bal += cr - db; soma += cr - db; return `<tr><td>${p2(d)}/${p2(m)}/${Y}</td><td>${desc}</td><td class=n>${db ? pt(db) : ''}</td><td class=n>${cr ? pt(cr) : ''}</td><td class=n>${pt(bal)}</td></tr>`; }).join('');
  const page = `<html><head><meta charset=utf-8><style>body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:34px 40px;width:714px;background:#fff;color:#111}h1{font-size:20px;margin:0 0 4px}p{margin:2px 0;font-size:13px}table{border-collapse:collapse;width:100%;margin-top:18px;font-size:13px}th{text-align:left;border-bottom:2px solid #000;padding:5px 4px}td{padding:6px 4px;border-bottom:1px solid #ddd}.n{text-align:right;white-space:nowrap}th.n{text-align:right}</style></head><body>
<h1>SIGMA BANK (fictício)</h1><p>Extrato de conta — documento digitalizado para testes</p><p>IBAN: PT50 9999 0009 0000 0000 0000 9</p><p>Período: 01/03/2026 a 31/03/2026</p>
<table><thead><tr><th>Data</th><th>Descrição</th><th class=n>Débito</th><th class=n>Crédito</th><th class=n>Saldo</th></tr></thead><tbody><tr><td></td><td>Saldo anterior</td><td></td><td></td><td class=n>${pt(open)}</td></tr>${trs}<tr><td></td><td><b>Saldo final</b></td><td></td><td></td><td class=n><b>${pt(bal)}</b></td></tr></tbody></table></body></html>`;
  return { page, n: rows.length, opening: open, final: bal, soma, firstDate: iso(3, 2), lastDate: iso(3, 27), valores: rows.map((r) => r[4] - r[3]) };
}
async function fxG() {
  const { chromium } = await import('playwright');
  const h = html(); const br = await chromium.launch();
  const pg = await br.newPage({ viewport: { width: 794, height: 760 }, deviceScaleFactor: 1.6 });
  await pg.setContent(h.page); const png = await pg.screenshot({ type: 'png', fullPage: false }); const jpg = await pg.screenshot({ type: 'jpeg', quality: 80 });
  await br.close();
  out('gen-g-digitalizado.png', png); out('gen-g-foto.jpg', jpg);
  const d = await PDFDocument.create(); d.setCreationDate(new Date(0)); d.setModificationDate(new Date(0)); d.setProducer('scanner (fixtures)');
  const img = await d.embedJpg(jpg); const pageP = d.addPage([595, 842]); const w = 595, hh = img.height * (595 / img.width);
  pageP.drawImage(img, { x: 0, y: 842 - hh, width: w, height: hh });
  out('gen-g-digitalizado.pdf', Buffer.from(await d.save()));
  return { n: h.n, opening: h.opening, final: h.final, soma: h.soma, firstDate: h.firstDate, lastDate: h.lastDate, valores: h.valores };
}

export async function generatePdfFixtures({ scanned = true } = {}) {
  const gen = { a: await fxA(), b: await fxB(), c: await fxC(), d: await fxD(), e: await fxE(), f: await fxF(), h: await fxH(), i: await fxI(), j: await fxJ(), k: await fxK(), l: await fxLM() };
  if (scanned) gen.g = await fxG();
  return gen;
}
