// Fixtures SINTÉTICAS (100% fictícias) de extratos de CARTÃO DE CRÉDITO com o mesmo layout de um extrato real português:
// página 1 com «Resumo da sua conta» (saldo em dívida anterior − créditos + débitos = saldo em dívida atual), dados do cartão (TAN, limite,
// montante mínimo), texto de rodapé/legal e glifos de «código de barras»; páginas de «Detalhe dos movimentos» com cabeçalho repetido
// (Data | Data valor | Descrição | Débitos | Créditos), datas dd.mm, valores na moeda original sem zero à esquerda («,30EUR»), linhas sem data
// (comissão/imposto do selo) e linha só com data valor (juros); última página «Detalhe dos pagamentos» (não são movimentos).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const out = (n, data) => writeFileSync(join(dir, n), data);
const grp = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const pt = (c) => { const a = Math.abs(c) / 100, [i, d] = a.toFixed(2).split('.'); return grp(i) + ',' + d; };
const ptNoZero = (c) => { const t = pt(c); return t.startsWith('0,') ? t.slice(1) : t; }; // «,30» (sem zero à esquerda)
const p2 = (n) => String(n).padStart(2, '0');

// Um «movimento» do cartão: [dia, mês, valorDia|null, descrição, país|null, orig|null, débito|null, crédito|null, subLinhas[]]
//   orig = { c: cêntimos, moeda: 'EUR'|'USD' }; subLinhas = [[descrição, cêntimos]] (sem data, coluna Débitos)
const M = (d, m, vd, desc, pais, orig, deb, cre, subs = []) => ({ d, m, vd, desc, pais, orig, deb, cre, subs });

async function cardPdf(file, o) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); doc.setProducer('fixtures'); doc.setCreator('fixtures');
  const f = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) };
  let pg = null, y = 0, pageNo = 0;
  const T = (x, yy, s, size = 8, bold = false) => pg.drawText(String(s), { x, y: yy, size, font: bold ? f.b : f.r, color: rgb(0, 0, 0) });
  const R = (xr, yy, s, size = 8, bold = false) => T(xr - (bold ? f.b : f.r).widthOfTextAtSize(String(s), size), yy, s, size, bold);
  const newPage = () => { pg = doc.addPage([595, 842]); pageNo++; R(557, 807, `Página ${pageNo} de ${o.totalPages}`, 8); return pg; };
  const GARBAGE = ['ÂÞÞÞÂ×Þ§Ü¿ð®ùÑ²', 'Àµ¤ª«»«èêìøÃ×ÿçý¹¾', 'ããÚÈþÖÈ¿ð®ùÑ²é¡øúä´', 'ÓýñÈÖÿáÇË¨´±ßß¹ïÿÏßÀ', 'ñÑÑÑñÑñÁÁÁÑ¡±±ñÑ±¡ñÑ±'];
  const footer = (page1) => {
    T(49, 55, 'O BANCO FICTICIO é uma marca detida pela FICTICIO HOLDING, S.A.', 7); T(49, 46, 'Sede: Rua Exemplo 1, 0000-000 Cidade Teste', 7);
    T(49, 37, 'Número único de pessoa coletiva e de registo na Conservatória do Registo Comercial de Teste: 500 000 000', 7); T(49, 28, 'Capital Social: 1.000.000.000,00€', 7);
    T(49, 22, 'Swift Address - TESTPTPL', 7); T(49, 12, 'T 21 000 00 00 (chamada para rede fixa nacional) - E apoio@fictic.test', 7);
    if (page1) GARBAGE.forEach((g, i) => T(521, 63 - i * 9, g, 6));
  };
  const hdr = (yy, sh = 0) => { T(41 + sh, yy, 'Data', 8, true); T(69 + sh, yy, 'Data valor', 8, true); T(142 + sh, yy, 'Descrição', 8, true); R(509 + sh, yy, 'Débitos', 8, true); R(565 + sh, yy, 'Créditos', 8, true); };

  // totais
  let deb = 0, cre = 0;
  for (const m of o.movs) { deb += (m.deb || 0) + m.subs.reduce((a, s) => a + s[1], 0); cre += m.cre || 0; }
  for (const [, c] of o.juros) deb += c;
  const cur = o.prev + deb - cre;
  const [ini, fim] = o.period;

  // ----- página 1 -----
  newPage();
  T(44, 735, 'Serviço de Apoio ao Cliente', 8); T(44, 725, '21 000 00 00 (chamada para a rede fixa nacional)', 8); T(44, 714, 'Dias úteis das 8h às 23h', 8);
  T(44, 694, 'E-mail: apoio@fictic.test', 8); T(482, 690, 'B^^^BUMnB^^^B', 6); T(482, 684, "'#=+(jj<%4<", 6); T(482, 678, 'B^^^B*\\ sWGE*sZ =', 6);
  T(44, 673, 'Extravio de Cartões 21 000 00 01 (24h/dia)', 8); T(313, 673, 'TITULAR FICTICIO TESTE', 8);
  T(39, 635, `Extrato nº ${o.extratoNo} | Periodo de Extrato: ${ini} a ${fim}`, 9, true);
  T(40, 608, 'Resumo da sua conta', 11, true);
  R(511, 560, 'O montante mínimo a pagar é', 8); R(511, 550, pt(o.minimo), 8, true); R(554, 540, 'data limite para pagamento', 8); R(523, 530, o.dataLimite, 8, true);
  const fig = [[65, pt(o.prev)], [126, '-'], [162, pt(cre)], [220, '+'], [257, pt(deb)], [317, '='], [353, pt(cur)]];
  for (const [x, s] of fig) T(x, 545, s, 9, true);
  T(46, 502, 'Saldo em Dívida à', 8); T(158, 502, 'Créditos', 8); T(258, 502, 'Débitos', 8); T(335, 502, 'Saldo em Dívida à', 8); T(37, 491, 'data do extrato anterior', 8); T(331, 491, 'data do extrato atual', 8);
  T(39, 459, 'Mensagens', 10, true); T(39, 442, 'UTILIZE A APP FICTICIA ONDE E QUANDO QUISER E ACOMPANHE TODOS OS SEUS MOVIMENTOS. SAIBA SEMPRE QUAL O SALDO', 7);
  T(39, 433, 'DISPONÍVEL PARA UTILIZAÇÃO, REALIZE PAGAMENTOS DE SERVIÇOS, E MUITO MAIS. MAIS EM WWW.FICTIC.TEST', 7);
  T(38, 396, 'Cartão de Crédito BANCO FICTICIO', 10, true);
  T(38, 374, `Identificação do contrato: ${o.cartao}`, 8); T(372, 374, `TAN: ${o.tan}`, 8);
  T(38, 361, `IBAN: ${o.iban}`, 8); T(372, 361, `Limite de Crédito: ${pt(o.limite)}`, 8);
  T(38, 348, `Data de emissão do extrato anterior: ${o.emissaoAnt}`, 8); T(372, 348, 'Forma de Pagamento: Iniciado por Cliente', 8);
  T(38, 335, `Data de emissão do extrato atual: ${fim}`, 8); T(372, 335, 'Opção de Pagamento: 1%', 8); T(38, 321, 'Moeda do Extrato: EUR', 8);
  T(38, 295, 'Informações de pagamento', 10, true);
  T(50, 267, 'Pagamento iniciado por Cliente', 8); T(319, 267, 'Pagamento por Débito Direto', 8);
  T(50, 243, `Data limite de pagamento: ${o.dataLimite}`, 8); T(319, 243, 'Identificação do credor: 100000', 8);
  T(55, 233, `Montante a pagar: Qualquer valor a partir de ${pt(o.minimo)}`, 8); T(319, 233, 'Número da Autorização: 10000000000', 8);
  T(121, 211, 'Transferência imediata via MB Way', 8); T(121, 158, 'Transferência bancária', 8); T(121, 148, `IBAN: ${o.iban}`, 8);
  T(121, 122, 'Pagamento de Serviços', 8); T(121, 112, 'Entidade: 20000', 8); T(121, 101, 'Referência: 900 000 001', 8);
  footer(true);

  // ----- páginas de movimentos -----
  const startPage = () => { newPage(); T(41, 736, o.cartao, 8); T(41, 722, 'Detalhe dos movimentos da sua conta', 11, true); T(41, 705, `Cartão nº ${o.cartao} | Periodo de Extrato: ${ini} a ${fim}`, 8); hdr(687, o.shift?.[pageNo - 2] || 0); y = 647; };
  startPage();
  const step = 14.2, perPage = o.perPage || 22; let used = 0;
  const brk = (need) => { if (used + need > perPage) { T(41, y - 4, 'continua na página seguinte', 8); footer(false); startPage(); used = 0; } };
  const sh = () => o.shift?.[pageNo - 2] || 0;
  for (const m of o.movs) {
    brk(1 + m.subs.length);
    T(41 + sh(), y, `${p2(m.d)}.${p2(m.m)}`, 8); if (m.vd) T(78 + sh(), y, m.vd, 8);
    T(145 + sh(), y, m.desc, 8); if (m.pais) T(294 + sh(), y, m.pais, 8);
    if (m.orig) R(397 + sh(), y, (m.orig.c < 100 ? ptNoZero(m.orig.c) : pt(m.orig.c)) + m.orig.moeda, 8);
    if (m.deb) R(509 + sh(), y, pt(m.deb), 8); if (m.cre) R(563 + sh(), y, pt(m.cre), 8);
    y -= step; used++;
    for (const [sd, sc] of m.subs) { T(145 + sh(), y, sd, 8); R(509 + sh(), y, pt(sc), 8); y -= step; used++; }
  }
  brk(o.juros.length + 1);
  o.juros.forEach(([desc, c], i) => { if (i === 0) T(77 + sh(), y, o.juros.vd, 8); T(144 + sh(), y, desc, 8); R(509 + sh(), y, pt(c), 8); y -= step; });
  footer(false);

  // ----- detalhe dos pagamentos (NÃO são movimentos) -----
  newPage(); T(41, 735, 'Detalhe dos pagamentos', 11, true); T(393, 715, 'Montante', 8, true);
  const cap = Math.round(cre * 0.9), com = cre - cap;
  [['Amortização de Capital', cap], ['Amortização de Juros', 0], ['Amortização de Comissões', com], ['Amortização de Despesas', 0]].forEach(([k, v], i) => { T(41, 700 - i * 14, k, 8); R(430, 700 - i * 14, pt(v), 8); });
  T(41, 640, 'Total Pagamentos', 8, true); R(430, 640, pt(cre), 8, true);
  out(file, Buffer.from(await doc.save()));
  return { deb, cre, cur, nDeb: o.movs.filter((m) => m.deb).length + o.movs.reduce((a, m) => a + m.subs.length, 0) + o.juros.filter(([, c]) => c).length, nCre: o.movs.filter((m) => m.cre).length, nDateLed: o.movs.length + 1 };
}

const IBANC = 'PT50 9999 0015 0000 0000 0000 5';

// Extrato 1 (fevereiro/março): 34 linhas com data (2 páginas de movimentos), 2 compras com comissão e selo (1 em USD), 3 pagamentos (créditos), juros no fim
function movs1() {
  const E = (c) => ({ c, moeda: 'EUR' });
  return [
    M(17, 2, '18.03', 'WPT*Fatura ALFA', 'PRT', E(1290), 1290, null),
    M(17, 2, '18.03', 'LOJAEXTERIOR1', 'GBR', E(12750), 12750, null, [['Comissão No Resto do Mundo', 255], ['Imp. Selo art 17.3.4 TGIS', 10]]),
    M(18, 2, '18.03', 'MERCEARIA TESTE BETA', 'PRT', E(4215), 4215, null),
    M(19, 2, '18.03', 'TRFI PARA +351900XXX111', null, null, 1375, null),
    M(20, 2, null, 'TRF IMEDIATA', null, null, null, 5260),
    M(21, 2, '18.03', 'BOMBA COMBUSTIVEL TESTE', 'PRT', E(2230), 2230, null),
    M(22, 2, '18.03', 'CAFE EXEMPLO CENTRAL', 'PRT', E(135), 135, null),
    M(23, 2, '18.03', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(23, 2, '18.03', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(23, 2, '18.03', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(24, 2, '18.03', 'STREAMING TESTE', 'USA', { c: 3000, moeda: 'USD' }, 2745, null, [['Comissão No Resto do Mundo', 82], ['Imp. Selo art 17.3.4 TGIS', 3]]),
    M(25, 2, '18.03', 'TRFI PARA +351900XXX222', null, null, 6400, null),
    M(26, 2, '18.03', 'FARMACIA TESTE GAMA', 'PRT', E(1685), 1685, null),
    M(27, 2, '18.03', 'RESTAURANTE EXEMPLO', 'PRT', E(3140), 3140, null),
    M(28, 2, '18.03', 'TRFI PARA +351900XXX111', null, null, 52, null),
    M(1, 3, '18.03', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(1, 3, '18.03', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(2, 3, null, 'TRF IMEDIATA', null, null, null, 31880),
    M(3, 3, '18.03', 'WPT*Fatura ALFA', 'PRT', E(1290), 1290, null),
    M(4, 3, '18.03', 'TRFI PARA +351900XXX333', null, null, 2200, null),
    M(5, 3, '18.03', 'LIVRARIA TESTE DELTA', 'PRT', E(1830), 1830, null),
    M(6, 3, '18.03', 'TRFI PARA +351900XXX111', null, null, 441, null),
    M(7, 3, '18.03', 'SUPERMERCADO FICTICIO', 'PRT', E(2987), 2987, null),
    M(8, 3, '18.03', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(8, 3, '18.03', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(9, 3, '18.03', 'CAFE EXEMPLO CENTRAL', 'PRT', E(315), 315, null),
    M(10, 3, null, 'TRF IMEDIATA', null, null, null, 36500),
    M(11, 3, '18.03', 'TRFI PARA +351900XXX222', null, null, 8500, null),
    M(12, 3, '18.03', 'OPERADORA MOVEL TESTE', 'PRT', E(3250), 3250, null),
    M(13, 3, '18.03', 'PAPELARIA TESTE', null, null, 3900, null),
    M(14, 3, '18.03', 'TRFI PARA +351900XXX111', null, null, 187, null),
    M(15, 3, '18.03', 'TRFI PARA +351900XXX333', null, null, 1700, null),
    M(16, 3, '18.03', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(17, 3, '18.03', 'TRFI PARA +351900XXX222', null, null, 7415, null),
  ];
}
// Extrato 2 (março/abril): continua o 1 (dívida anterior = dívida atual do 1); 1 compra de 17.03 (antes do início do período), pagamentos, juros
function movs2() {
  const E = (c) => ({ c, moeda: 'EUR' });
  return [
    M(17, 3, '18.04', 'LOJA EXEMPLO EPSILON', 'PRT', E(2635), 2635, null),
    M(20, 3, '18.04', 'SUPERMERCADO FICTICIO', 'PRT', E(4390), 4390, null),
    M(22, 3, '18.04', 'TRFI PARA +351900XXX111', null, null, 1620, null),
    M(25, 3, '18.04', 'LOJAEXTERIOR1', 'GBR', E(5400), 5400, null, [['Comissão No Resto do Mundo', 108], ['Imp. Selo art 17.3.4 TGIS', 4]]),
    M(30, 3, null, 'TRF IMEDIATA', null, null, null, 14750),
    M(2, 4, '18.04', 'BOMBA COMBUSTIVEL TESTE', 'PRT', E(1925), 1925, null),
    M(8, 4, '18.04', 'MINIMERCADO TESTE 77', 'PRT', E(35), 35, null),
    M(11, 4, '18.04', 'FARMACIA TESTE GAMA', 'PRT', E(1040), 1040, null),
    M(15, 4, null, 'TRF IMEDIATA', null, null, null, 28300),
    M(16, 4, '18.04', 'RESTAURANTE EXEMPLO', 'PRT', E(3380), 3380, null),
  ];
}
// Extrato de viragem de ano (dezembro/janeiro): movimentos de 17.12 e 28.12 (ano anterior) e 02.01…09.01
function movs3() {
  const E = (c) => ({ c, moeda: 'EUR' });
  return [
    M(17, 12, '18.01', 'LOJA EXEMPLO ZETA', 'PRT', E(2190), 2190, null),
    M(28, 12, '18.01', 'SUPERMERCADO FICTICIO', 'PRT', E(5440), 5440, null),
    M(2, 1, '18.01', 'CAFE EXEMPLO CENTRAL', 'PRT', E(145), 145, null),
    M(5, 1, null, 'TRF IMEDIATA', null, null, null, 6800),
    M(9, 1, '18.01', 'TRFI PARA +351900XXX111', null, null, 2650, null),
  ];
}

// Conta à ordem (para o emparelhamento dos pagamentos do cartão): saídas «TRF IMEDIATA» com o mesmo valor dos créditos do cartão (±5 dias)
async function checkingPdf(file) {
  const doc = await PDFDocument.create(); doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); doc.setProducer('fixtures'); doc.setCreator('fixtures');
  const f = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) };
  const pg = doc.addPage([595, 842]);
  const T = (x, y, s, size = 8.5, bold = false) => pg.drawText(String(s), { x, y, size, font: bold ? f.b : f.r, color: rgb(0, 0, 0) });
  const R = (xr, y, s, size = 8.5, bold = false) => T(xr - (bold ? f.b : f.r).widthOfTextAtSize(String(s), size), y, s, size, bold);
  // [dia, mês, descrição, débito, crédito] — as saídas para o cartão caem 0–2 dias antes/depois dos créditos do cartão
  const tx = [[1, 3, 'TRANSF IMEDIATA PARA CARTAO', 31880, 0], [3, 3, 'ORDENADO EMPRESA TESTE LDA', 0, 148000], [4, 3, 'COMPRA SUPERMERCADO ALFA', 5894, 0], [6, 3, 'TRANSF IMEDIATA PARA CARTAO', 36500, 0], [9, 3, 'PAGAMENTO SERVICOS AGUAS', 2318, 0], [12, 3, 'COMPRA RESTAURANTE BETA', 1890, 0], [20, 3, 'TRANSF IMEDIATA PARA CARTAO', 5260, 0]];
  const open = 133000; let bal = open, y = 697;
  T(40, 800, 'BANCO ALFA (fictício)', 13, true); T(40, 784, 'Extrato de Conta à Ordem (documento fictício para testes)'); T(40, 764, 'IBAN: PT50 9999 0016 0000 0000 0000 6'); T(40, 752, 'Período: 01/03/2026 a 31/03/2026');
  T(40, 715, 'Data Mov.', 8, true); T(100, 715, 'Data Valor', 8, true); T(160, 715, 'Descrição', 8, true); R(408, 715, 'Débito', 8, true); R(473, 715, 'Crédito', 8, true); R(550, 715, 'Saldo', 8, true);
  T(160, y, 'Saldo anterior'); R(550, y, pt(open)); y -= 14;
  for (const [d, m, desc, db, cr] of tx) { bal += cr - db; const ds = `${p2(d)}/${p2(m)}/2026`; T(40, y, ds); T(100, y, ds); T(160, y, desc); if (db) R(408, y, pt(db)); if (cr) R(473, y, pt(cr)); R(550, y, (bal < 0 ? '-' : '') + pt(bal)); y -= 14; }
  y -= 6; T(160, y, 'Saldo final', 8, true); R(550, y, pt(bal), 8, true);
  out(file, Buffer.from(await doc.save()));
  return { n: tx.length, opening: open, final: bal, saidasCartao: tx.filter((t) => /CARTAO/.test(t[2])).map((t) => t[3]) };
}

// Duas colunas «Data» + «Valor» com datas dd.mm: a leitura automática NÃO encontra linhas (dd.mm lido como valor) — serve o ecrã «Ajustar leitura»
async function ddmmPdf(file) {
  const doc = await PDFDocument.create(); doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); doc.setProducer('fixtures'); doc.setCreator('fixtures');
  const f = await doc.embedFont(StandardFonts.Helvetica); const pg = doc.addPage([595, 842]);
  const T = (x, y, s, size = 9) => pg.drawText(String(s), { x, y, size, font: f, color: rgb(0, 0, 0) });
  const R = (xr, y, s, size = 9) => T(xr - f.widthOfTextAtSize(String(s), size), y, s, size);
  T(40, 800, 'Lista de movimentos (documento fictício)', 12); T(40, 784, 'Período 2026-05-01 a 2026-05-31');
  T(60, 750, 'Data', 9); R(300, 750, 'Valor', 9);
  const v = [1375, 3299, 415, 9120, 2250, 1890, 735, 12800]; let y = 734;
  v.forEach((c, i) => { T(60, y, `${p2(3 + i * 3)}.05`); R(300, y, pt(c)); y -= 14; });
  out(file, Buffer.from(await doc.save()));
  return { n: v.length, valores: v, soma: v.reduce((a, c) => a + c, 0), firstDate: '2026-05-03', lastDate: '2026-05-24' };
}

export async function generateCardFixtures() {
  const base = { cartao: '4000 12XX XXXX 0007', iban: IBANC, tan: '12,500%', limite: 300000, totalPages: 4 };
  const j1 = [['JUROS SOBRE O SALDO EM DÍVIDA', 204], ['Imp. Selo art 17.3.1 TGIS', 0], ['Imp. Selo art 17.2.1 TGIS', 29]]; j1.vd = '19.02';
  const j2 = [['JUROS SOBRE O SALDO EM DÍVIDA', 231], ['Imp. Selo art 17.3.1 TGIS', 0], ['Imp. Selo art 17.2.1 TGIS', 33]]; j2.vd = '19.03';
  const j3 = [['JUROS SOBRE O SALDO EM DÍVIDA', 118], ['Imp. Selo art 17.3.1 TGIS', 0], ['Imp. Selo art 17.2.1 TGIS', 14]]; j3.vd = '19.12';
  const prev1 = 92470;
  const s1 = await cardPdf('gen-n-cartao-fev.pdf', { ...base, extratoNo: '03/2026', period: ['2026-02-19', '2026-03-18'], emissaoAnt: '2026-02-18', prev: prev1, movs: movs1(), juros: j1, minimo: 3000, dataLimite: '2026-04-08', perPage: 24, totalPages: 4 });
  const s2 = await cardPdf('gen-n2-cartao-mar.pdf', { ...base, extratoNo: '04/2026', period: ['2026-03-19', '2026-04-18'], emissaoAnt: '2026-03-18', prev: s1.cur, movs: movs2(), juros: j2, minimo: 2400, dataLimite: '2026-05-08', perPage: 30, totalPages: 3 });
  const s3 = await cardPdf('gen-n3-cartao-viragem.pdf', { ...base, extratoNo: '01/2027', period: ['2026-12-19', '2027-01-18'], emissaoAnt: '2026-12-18', prev: 24300, movs: movs3(), juros: j3, minimo: 1800, dataLimite: '2027-02-08', perPage: 30, totalPages: 3 });
  // variante com a tabela da 2.ª página de movimentos deslocada (cabeçalho com outra indentação)
  const s4 = await cardPdf('gen-n4-cartao-indentacao.pdf', { ...base, extratoNo: '03/2026', period: ['2026-02-19', '2026-03-18'], emissaoAnt: '2026-02-18', prev: prev1, movs: movs1(), juros: j1, minimo: 3000, dataLimite: '2026-04-08', perPage: 24, totalPages: 4, shift: [0, 14] });
  const conta = await checkingPdf('gen-n5-conta-ordem-pagamentos.pdf');
  const dd = await ddmmPdf('gen-o-datas-ddmm-duas-colunas.pdf');
  const dateLed = (m) => m.length + 1;
  return {
    fev: { ...s1, prev: prev1, nMov: s1.nDeb + s1.nCre, nDateLed: dateLed(movs1()), nSub: movs1().reduce((a, m) => a + m.subs.length, 0), nZero: 1, opening: -prev1, final: -s1.cur, period: ['2026-02-19', '2026-03-18'], limite: 300000, tan: 12.5, minimo: 3000, dataLimite: '2026-04-08', numero: '4000 12XX XXXX 0007', creditos: movs1().filter((m) => m.cre).map((m) => m.cre), firstDate: '2026-02-17', lastDate: '2026-03-17', jurosData: '2026-02-19', usd: movs1().find((m) => m.orig?.moeda === 'USD').desc },
    mar: { ...s2, prev: s1.cur, nMov: s2.nDeb + s2.nCre, nDateLed: dateLed(movs2()), opening: -s1.cur, final: -s2.cur, period: ['2026-03-19', '2026-04-18'], firstDate: '2026-03-17' },
    viragem: { ...s3, prev: 24300, nMov: s3.nDeb + s3.nCre, opening: -24300, final: -s3.cur, datas: ['2026-12-17', '2026-12-28', '2027-01-02', '2027-01-05', '2027-01-09'], jurosData: '2026-12-19' },
    conta, ddmm: dd,
  };
}
