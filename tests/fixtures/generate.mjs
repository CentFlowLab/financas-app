// Gera os ficheiros de exemplo (SINTÉTICOS, dados fictícios) usados nos testes: node tests/fixtures/generate.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const out = (n, data) => writeFileSync(join(dir, n), data);
const require = createRequire(import.meta.url);
const XLSX = (() => { const m = { exports: {} }; new Function('module', 'exports', 'require', readFileSync(join(dir, '../../public/vendor/xlsx/xlsx.full.min.js'), 'utf8')).call(m.exports, m, m.exports, require); return m.exports; })();

// Windows-1252 (Latin-1 + €)
const cp1252 = (s) => Buffer.from([...s].map((ch) => { const c = ch.charCodeAt(0); if (ch === '€') return 0x80; if (c < 256) return c; return 63; }));
const pt = (c) => (c < 0 ? '-' : '') + Math.abs(c / 100).toFixed(2).replace('.', ',').replace(/(\d)(?=(\d{3})+,)/g, '$1.');
const NB = '\u00a0';
const expected = {};

// ---------- 1) CSV ; Windows-1252, com linhas de preâmbulo, sinal no valor, milhares com espaço, saldo ----------
{
  const open = 100000;
  const tx = [['01-09-2026', 'ORDENADO EMPRESA TESTE LDA', 145000], ['02-09-2026', 'COMPRA CONTINENTE MODELO LISBOA', -6732], ['03-09-2026', 'PAGAMENTO EDP COMERCIAL', -5840], ['05-09-2026', 'COMPRA FARMÁCIA SÃO JOÃO', -1485], ['07-09-2026', 'COMPRA TV E ELETRODOMÉSTICOS', -123456], ['10-09-2026', 'COMPRA GALP POSTO A5', -5210], ['12-09-2026', 'DD VODAFONE PORTUGAL', -3999], ['15-09-2026', 'COMPRA PADARIA CENTRAL', -380], ['16-09-2026', 'COMPRA CAFÉ CENTRAL', -120], ['16-09-2026', 'COMPRA CAFÉ CENTRAL', -120], ['20-09-2026', 'COMISSÃO MANUTENÇÃO CONTA', -450]];
  const money = (c) => pt(c).replace(/\./g, NB).replace(',', ',');
  let bal = open; const lines = ['Consulta de movimentos - EXTRATO FICTÍCIO PARA TESTES;;;;', 'Banco Teste, S.A.;;;;', 'IBAN;PT50999900000000000000011;;;', 'Período;01-09-2026 a 30-09-2026;;;', ';;;;', 'Data mov.;Data valor;Descrição;Montante;Saldo contabilístico'];
  for (const [d, desc, v] of tx) { bal += v; lines.push([d, d, desc, money(v), money(bal)].join(';')); }
  lines.push(';;;;', `Total de movimentos;${tx.length};;;`);
  out('extrato-pontoevirgula-win1252.csv', cp1252(lines.join('\r\n') + '\r\n'));
  expected.win1252 = { n: tx.length, abertura: open, final: bal, iban: 'PT50999900000000000000011', entradas: 145000, saidas: tx.filter((t) => t[2] < 0).reduce((a, t) => a - t[2], 0) };
}

// ---------- 2) CSV , UTF-8 com BOM, colunas Débito/Crédito, datas AAAA-MM-DD, valores entre aspas, mais recente primeiro ----------
{
  const open = 50000;
  const tx = [['2026-09-02', 'TRANSFERÊNCIA RECEBIDA MARIA TESTE', 0, 20000], ['2026-09-04', 'COMPRA PINGO DOCE ALGÉS', 4318, 0], ['2026-09-08', 'PAGAMENTO MEO SERVIÇOS', 3299, 0], ['2026-09-11', 'COMPRA RESTAURANTE O TACHO', 2450, 0], ['2026-09-14', 'VIA VERDE PORTAGENS', 1260, 0], ['2026-09-18', 'REEMBOLSO COMPRA LIDL', 0, 1250], ['2026-09-25', 'MB WAY JOAO TESTE', 2000, 0]];
  let bal = open; const rows = tx.map(([d, desc, db, cr]) => { bal += cr - db; return { d, desc, db, cr, bal }; });
  const q = (s) => `"${s}"`;
  const lines = ['Data operação,Data valor,Movimento,Débito,Crédito,Saldo'];
  for (const r of [...rows].reverse()) lines.push([r.d, r.d, r.desc, r.db ? q(pt(r.db)) : '', r.cr ? q(pt(r.cr)) : '', q(pt(r.bal))].join(','));
  lines.push(',,TOTAIS,"' + pt(rows.reduce((a, r) => a + r.db, 0)) + '","' + pt(rows.reduce((a, r) => a + r.cr, 0)) + '",');
  out('extrato-debito-credito-utf8.csv', '\ufeff' + lines.join('\n') + '\n');
  expected.dc = { n: tx.length, abertura: open, final: bal };
}

// ---------- 3) Excel .xlsx: preâmbulo, duas contas (coluna IBAN), datas reais, transferência entre as contas ----------
{
  const A = 'PT50999900000000000000021', B = 'PT50999900000000000000022';
  const tx = [[A, '2026-09-01', 'ORDENADO EMPRESA TESTE LDA', 150000], [A, '2026-09-03', 'COMPRA CONTINENTE MODELO LISBOA', -7125], [A, '2026-09-10', 'TRANSFERÊNCIA PARA POUPANÇA', -30000], [B, '2026-09-10', 'TRANSFERÊNCIA DA CONTA ORDEM', 30000], [A, '2026-09-12', 'COMPRA SPOTIFY AB', -799], [B, '2026-09-20', 'JUROS CREDORES', 312], [A, '2026-09-22', 'UBER *TRIP LISBOA', -740]];
  const open = { [A]: 80000, [B]: 200000 }; const bal = { ...open };
  const aoa = [['Extrato fictício (xlsx) - dados de teste'], ['Banco Teste'], [], ['Conta', 'Data', 'Descrição', 'Valor', 'Saldo']];
  for (const [c, d, desc, v] of tx) { bal[c] += v; aoa.push([c, new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))), desc, v / 100, bal[c] / 100]); }
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  for (let r = 4; r < aoa.length; r++) { ws['B' + (r + 1)].z = 'dd/mm/yyyy'; ws['D' + (r + 1)].z = '#,##0.00'; ws['E' + (r + 1)].z = '#,##0.00'; }
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Movimentos');
  out('extrato.xlsx', Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true })));
  out('extrato.xls', Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'biff8', cellDates: true })));
  expected.xlsx = { n: tx.length, A, B, aberturaA: open[A], aberturaB: open[B], finalA: bal[A], finalB: bal[B] };
}

// ---------- 4) OFX (SGML v1, CHARSET 1252) ----------
{
  const open = 200000;
  const tx = [['20260901', 'ORDENADO EMPRESA TESTE LDA', '', 1450.0, 'F001'], ['20260902', 'COMPRA CONTINENTE', 'MODELO LISBOA', -67.32, 'F002'], ['20260905', 'FARMÁCIA SÃO JOÃO', '', -14.85, 'F003'], ['20260908', 'PAGAMENTO EDP COMERCIAL', '', -58.4, 'F004'], ['20260910', 'COMPRA REPSOL ESTAÇÃO', '', -48.9, 'F005'], ['20260915', 'NETFLIX.COM', '', -11.99, 'F006']];
  const total = Math.round(tx.reduce((a, t) => a + t[3] * 100, 0)); const final = open + total;
  const L = ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '', '<OFX>', '<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260930120000<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>', '<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>', '<STMTRS><CURDEF>EUR', '<BANKACCTFROM><BANKID>9999<ACCTID>999900000000000000031<ACCTTYPE>CHECKING</BANKACCTFROM>', '<BANKTRANLIST><DTSTART>20260901<DTEND>20260930'];
  for (const [d, n, m, v, f] of tx) L.push('<STMTTRN>', `<TRNTYPE>${v < 0 ? 'DEBIT' : 'CREDIT'}`, `<DTPOSTED>${d}120000[0:GMT]`, `<TRNAMT>${v.toFixed(2)}`, `<FITID>${f}`, `<NAME>${n}`, ...(m ? [`<MEMO>${m}`] : []), '</STMTTRN>');
  L.push('</BANKTRANLIST>', `<LEDGERBAL><BALAMT>${(final / 100).toFixed(2)}<DTASOF>20260930120000</LEDGERBAL>`, '</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>');
  out('extrato.ofx', cp1252(L.join('\r\n') + '\r\n'));
  expected.ofx = { n: tx.length, abertura: open, final, acctId: '999900000000000000031' };
}

// ---------- 5) QIF ----------
{
  const tx = [['01/09/2026', -2350, 'COMPRA LIDL AGRADECE'], ['03/09/2026', 145000, 'ORDENADO EMPRESA TESTE LDA'], ['09/09/2026', -1000, 'MB WAY JOAO TESTE']];
  const L = ['!Type:Bank']; for (const [d, v, p] of tx) L.push('D' + d, 'T' + pt(v), 'P' + p, 'MQIF de teste', '^');
  out('extrato.qif', L.join('\r\n') + '\r\n');
  expected.qif = { n: tx.length };
}

// ---------- 6) PDF de texto (gerado à mão, sem bibliotecas) ----------
{
  const open = 120000;
  const tx = [['01-09-2026', 'ORDENADO EMPRESA TESTE LDA', 0, 145000, ''], ['02-09-2026', 'COMPRA CONTINENTE MODELO', 6732, 0, 'REF 998877'], ['04-09-2026', 'PAGAMENTO EDP COMERCIAL', 5840, 0, ''], ['09-09-2026', 'COMPRA FARMÁCIA CENTRAL', 1485, 0, ''], ['14-09-2026', 'JUROS CREDORES', 0, 312, '']];
  const W = (s) => [...s].reduce((a, ch) => a + (/\d/.test(ch) ? 0.556 : ch === ',' || ch === '.' || ch === ' ' ? 0.278 : ch === '-' ? 0.333 : 0.6), 0) * 9;
  const esc = (s) => [...s].map((ch) => { const c = ch.charCodeAt(0); if (ch === '(' || ch === ')' || ch === '\\') return '\\' + ch; return c > 126 ? '\\' + c.toString(8).padStart(3, '0') : ch; }).join('');
  let content = ''; const T = (x, y, s, size = 9) => { content += `BT /F1 ${size} Tf ${x.toFixed(2)} ${y} Td (${esc(s)}) Tj ET\n`; };
  const R = (right, y, s) => T(right - W(s), y, s);
  T(40, 790, 'EXTRATO FICTÍCIO - DADOS DE TESTE', 12); T(40, 772, 'Banco Teste, S.A.'); T(40, 760, 'Conta: PT50 9999 0000 0000 0000 0004 1'); T(40, 748, 'Período: 01-09-2026 a 30-09-2026');
  const cDeb = 410, cCre = 475, cSal = 545; const yH = 715;
  T(40, yH, 'Data mov.'); T(100, yH, 'Data valor'); T(165, yH, 'Descrição'); T(cDeb - 17 - W('Débito') / 2, yH, 'Débito'); T(cCre - 17 - W('Crédito') / 2, yH, 'Crédito'); T(cSal - 17 - W('Saldo') / 2, yH, 'Saldo');
  let y = yH - 18, bal = open;
  for (const [d, desc, db, cr, ref] of tx) { bal += cr - db; T(40, y, d); T(100, y, d); T(165, y, desc); if (db) R(cDeb, y, pt(db)); if (cr) R(cCre, y, pt(cr)); R(cSal, y, pt(bal)); y -= 12; if (ref) { T(165, y, ref); y -= 12; } y -= 4; }
  T(40, 60, 'Página 1 de 1');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const body = Buffer.from(content, 'latin1');
  let pdf = Buffer.from('%PDF-1.4\n'); const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf = Buffer.concat([pdf, i === 3 ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${body.length} >>\nstream\n`), body, Buffer.from('\nendstream\nendobj\n')]) : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`)]); });
  const xref = pdf.length;
  pdf = Buffer.concat([pdf, Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
  out('extrato-texto.pdf', pdf);
  expected.pdf = { n: tx.length, abertura: open, final: bal };
}

// ---------- 7) PDF «extrato consolidado» SINTÉTICO (layout inspirado em extratos de bancos portugueses, dados 100% fictícios) ----------
// Páginas de avisos, resumo de contas, tabela da conta à ordem em várias páginas (cabeçalhos repetidos, «Continua»/«Continuação»,
// texto vertical na margem a cruzar as linhas), duas secções de crédito (Saldo Inicial/Final) e tabelas de reembolso com datas.
{
  const IBAN = 'PT50999900000000000000051', CONTA = '0000.00000000051';
  const FW = (s, size) => [...s].reduce((a, ch) => a + (/\d/.test(ch) ? 0.556 : ch === ',' || ch === '.' || ch === ' ' || ch === ':' ? 0.278 : ch === '-' ? 0.333 : /[A-Z]/.test(ch) ? 0.68 : 0.52), 0) * size;
  const pesc = (s) => [...s].map((ch) => { const c = ch.charCodeAt(0); if (ch === '(' || ch === ')' || ch === '\\') return '\\' + ch; return c > 126 ? '\\' + c.toString(8).padStart(3, '0') : ch; }).join('');
  const mkpdf = (pages) => {
    const objs = [null, null]; const kids = []; const f1 = 2 + pages.length * 2 + 1; // números de objeto (índice + 1)
    pages.forEach((content) => { const pi = objs.length; objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${pi + 2} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f1 + 1} 0 R >> >> >>`, { stream: content }); kids.push(pi); });
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    objs[0] = '<< /Type /Catalog /Pages 2 0 R >>'; objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + 1 + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let pdf = Buffer.from('%PDF-1.4\n'); const offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); if (o && o.stream != null) { const b = Buffer.from(o.stream, 'latin1'); pdf = Buffer.concat([pdf, Buffer.from(`${i + 1} 0 obj\n<< /Length ${b.length} >>\nstream\n`), b, Buffer.from('\nendstream\nendobj\n')]); } else pdf = Buffer.concat([pdf, Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`)]); });
    const xref = pdf.length;
    return Buffer.concat([pdf, Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
  };
  const page = () => { let c = ''; const f = { c: () => c };
    f.T = (x, y, s, size = 8, font = 'F1') => { c += `BT /${font} ${size} Tf ${x.toFixed(2)} ${y} Td (${pesc(s)}) Tj ET\n`; };
    f.R = (right, y, s, size = 8, font = 'F1') => f.T(right - FW(s, size), y, s, size, font);
    f.V = (x, y, s) => { c += `BT /F1 5 Tf 0 1 -1 0 ${x} ${y} Tm (${pesc(s)}) Tj ET\n`; };
    return f; };
  const money = (c) => (c < 0 ? '-' : '') + Math.abs(c / 100).toFixed(2).replace('.', ',').replace(/(\d)(?=(\d{3})+,)/g, '$1.');
  const FOOT = 'BANCO EXEMPLO, S.A. - Capital Social: 1.000.000 EUR - C.R.C. Lisboa com o NIPC 999 999 999 - Sede Social: Rua Exemplo, nº 1 - 1000-001 LISBOA';
  const header = (p, ext, ini, fim, n, total) => { p.T(39, 815, `EXTRATO Nº ${ext}`); p.T(167, 815, `CONTA Nº ${CONTA}`); p.T(322, 815, `PERÍODO DE ${ini} A ${fim}`); p.T(513, 815, `PÁGINA ${String(n).padStart(3, '0')}/${String(total).padStart(3, '0')}`); };
  const colHeader = (p, y) => { p.T(44, y + 9, 'Data'); p.T(44, y, 'Mov'); p.T(76, y, 'Valor Descritivo do Movimento'); p.T(420, y, 'Moeda'); p.T(478, y, 'Valor'); p.T(543, y, 'Saldo'); };
  const mov = (p, y, [dm, dv, desc, v], saldo) => { p.T(42, y, dm); p.T(76, y, dv); const i = desc.indexOf('|'); if (i > 0) { p.T(106, y, desc.slice(0, i)); p.T(155, y, desc.slice(i + 1)); } else p.T(106, y, desc); p.R(501, y, money(v)); p.R(569, y, money(saldo)); };

  // Movimentos fictícios (sinal no valor; créditos sem «+»). [data mov, data valor, descrição («|» separa duas células), cêntimos]
  const NOV = [['02-11', '02-11', 'OP.BAIXO VALOR 0001', -75], ['03-11', '03-11', 'TRF.IMED.|DE FULANO TESTE-R0001', 15000], ['03-11', '03-11', 'TRF CRED SEPA+ ORDENADO DE EMPRESA EXEMPLO LDA', 157720], ['03-11', '03-11', 'TRF.IMED.|P/ CICLANO TESTE-E0001', -100000], ['05-11', '06-11', 'COMPRA *1111 SUPERMERCADO EXEMPLO', -4590], ['05-11', '06-11', 'COMPRA *1111 SUPERMERCADO EXEMPLO', -4590], ['05-11', '05-11', 'COMPRA *1111 POSTO COMBUSTIVEL EXEMPLO', -5000], ['06-11', '06-11', 'TRF.IMED.|DE BELTRANO TESTE-R0002', 2000], ['06-11', '06-11', 'COMPRA *1111 CAFE EXEMPLO', -180], ['07-11', '07-11', 'COB.REC.31.000111111111111/ 1', -2949], ['09-11', '09-11', 'COMPRA ESTRANG*1111 LOJA ONLINE EXEMPLO', -1999], ['10-11', '10-11', 'TRF.IMED.|P/ FULANO TESTE-E0002', -5000], ['10-11', '10-11', 'MANUTENCAO DE CONTA PACOTE', -760], ['10-11', '10-11', 'IMPOSTO DO SELO', -30], ['11-11', '11-11', 'COMPRA *1111 FARMACIA EXEMPLO', -1235], ['12-11', '12-11', '9017502 DEP.NOTAS       AGENCIA EXEMPLO', 20000], ['12-11', '12-11', 'PAG SERVICOS *1111 12110-051949', -3550], ['13-11', '13-11', 'ENTREGA ANTECIPADA', -10000], ['14-11', '14-11', 'TRF CRED SEPA+ DE REEMBOLSOS IRS EXEMPLO', 45000], ['14-11', '14-11', 'COMPRA *1111 RESTAURANTE EXEMPLO', -2750], ['16-11', '16-11', 'TRF.IMED.|DE FULANO TESTE-R0003', 7500], ['17-11', '17-11', 'COMPRA *1111 SUPERMERCADO EXEMPLO', -6310], ['18-11', '18-11', 'TRF.IMED.|P/ CICLANO TESTE-E0003', -12000], ['19-11', '19-11', 'COMPRA *1111 PADARIA EXEMPLO', -420], ['20-11', '20-11', 'COMPRA *1111 POSTO COMBUSTIVEL EXEMPLO', -4800], ['21-11', '21-11', 'TRF.IMED.|DE BELTRANO TESTE-R0004', 3000], ['22-11', '22-11', 'COMPRA *1111 LIVRARIA EXEMPLO', -1590], ['24-11', '24-11', 'PAG SERVICOS *1111 22110-051950', -4000], ['25-11', '25-11', 'TRF.IMED.|P/ FULANO TESTE-E0004', -2500], ['26-11', '26-11', 'COMPRA *1111 SUPERMERCADO EXEMPLO', -3875], ['27-11', '27-11', 'COMPRA *1111 CAFE EXEMPLO', -210], ['28-11', '28-11', 'TRF.IMED.|DE BELTRANO TESTE-R0005', 5000], ['28-11', '28-11', 'COMPRA *1111 CINEMA EXEMPLO', -1400], ['29-11', '29-11', 'COMPRA *1111 PADARIA EXEMPLO', -350], ['30-11', '30-11', 'TRF CRED SEPA+ ORDENADO DE EMPRESA EXEMPLO LDA', 105080], ['30-11', '30-11', 'IMPOSTO SELO P/UTILIZAÇÃO DE CRÉDITO', -1], ['30-11', '30-11', 'TRF.IMED.|P/ CICLANO TESTE-E0005', -105000], ['30-11', '04-12', 'COMPRA *1111 PADARIA EXEMPLO', -280]];
  const DEC = [['01-12', '01-12', 'COMPRA *1111 SUPERMERCADO EXEMPLO', -5120], ['02-12', '02-12', 'TRF.IMED.|DE FULANO TESTE-R0006', 12000], ['03-12', '03-12', 'COB.REC.31.000222222222222/ 2', -2949], ['05-12', '05-12', 'MANUTENCAO DE CONTA PACOTE', -760], ['05-12', '05-12', 'IMPOSTO DO SELO', -30], ['09-12', '09-12', 'COMPRA *1111 POSTO COMBUSTIVEL EXEMPLO', -5200], ['12-12', '12-12', 'TRF CRED SEPA+ ORDENADO DE EMPRESA EXEMPLO LDA', 157720], ['15-12', '15-12', 'TRF.IMED.|P/ CICLANO TESTE-E0006', -90000], ['18-12', '18-12', 'COMPRA *1111 LOJA DE BRINQUEDOS EXEMPLO', -7490], ['23-12', '23-12', 'COMPRA *1111 SUPERMERCADO EXEMPLO', -8160], ['30-12', '30-12', 'TRF CRED SEPA+ ORDENADO DE EMPRESA EXEMPLO LDA', 105080], ['31-12', '02-01', 'COMPRA *1111 CAFE EXEMPLO', -230]];

  const build = ({ ext, ini, fim, rows, opening, loans, nome }) => {
    const totalPages = 5; const pg = [];
    let bal = opening; const saldos = rows.map((r) => (bal += r[3]));
    const final = bal;
    const split = [rows.slice(0, 8), rows.slice(8, 28), rows.slice(28)];
    const resp = loans.reduce((a, l) => a + l.fim, 0);
    // página 1: capa + avisos (texto fora de qualquer tabela; algumas linhas começam por datas e valores de propósito)
    let p = page(); header(p, ext, ini, fim, 1, totalPages);
    p.T(303, 770, 'CONTA EXEMPLO PLUS', 9, 'F2'); p.T(303, 758, 'N.I.B.: 9999 0000 00000000051 00'); p.T(303, 746, `IBAN: ${IBAN}`); p.T(303, 734, 'BIC/SWIFT: EXPLPTPL'); p.T(303, 722, `DATA DE EMISSÃO: ${fim}`);
    p.T(38, 690, 'EXMº SENHOR,');
    p.T(38, 670, 'Como é calculada a Euribor usada no seu crédito', 9, 'F2');
    ['01-12 passa a aplicar-se a nova taxa indicada abaixo para todos os contratos.', '15-12  20-12  Prazo para comunicar a sua oposição: 1.234,56 EUR de encargos.', 'A taxa é atualizada no final de cada período de contagem.'].forEach((t, i) => p.T(38, 656 - i * 11, t));
    p.T(38, 600, 'Serviço Mais', 9, 'F2'); p.T(38, 588, 'Benefícios com o Serviço Mais'); p.T(38, 576, 'Reembolsos + Poupanças'); p.R(210, 576, '0,00 EUR'); p.R(480, 576, '143,71 EUR');
    for (let y = 80; y < 420; y += 12) p.V(15.5, y, 'BANCO EXEMPLO, S.A. - Capital Social');
    p.T(15, 30, FOOT, 5); pg.push(p.c());
    // página 2: resumo + início da tabela
    p = page(); header(p, ext, ini, fim, 2, totalPages);
    p.T(37, 790, 'Resumo das Contas', 9, 'F2');
    p.T(74, 774, 'Natureza'); p.T(213, 774, 'Descrição'); p.T(405, 774, 'Moeda'); p.T(494, 774, 'Eur'); p.T(535, 774, 'Data');
    p.T(73, 760, 'DEP.OUT ACTIVOS'); p.T(213, 760, 'DEPÓSITOS À ORDEM'); p.T(410, 760, 'EUR'); p.R(509, 760, money(final)); p.T(533, 760, fim.slice(8) + '-' + fim.slice(5, 7)); p.T(213, 750, 'TOTAL'); p.R(509, 750, money(final));
    p.T(73, 730, 'RESPONSABILIDADES'); p.T(213, 730, 'CRÉDITO PESSOAL'); p.T(410, 730, 'EUR'); p.R(509, 730, money(-resp)); p.T(533, 730, fim.slice(8) + '-' + fim.slice(5, 7)); p.T(213, 720, 'TOTAL'); p.R(509, 720, money(-resp));
    p.T(37, 690, 'Detalhe de Movimentos da Conta à Ordem', 9, 'F2'); p.T(44, 678, 'Moeda: EUR');
    colHeader(p, 650);
    p.T(359, 632, 'Saldo Inicial'); p.T(429, 632, 'EUR'); p.R(568, 632, money(opening));
    let y = 614; split[0].forEach((r, i) => { mov(p, y, r, saldos[i]); y -= 11; });
    p.T(371, 70, 'Continua'); p.T(15, 30, FOOT, 5); pg.push(p.c());
    // página 3: continuação (cabeçalhos repetidos; texto vertical a cruzar as linhas)
    p = page(); header(p, ext, ini, fim, 3, totalPages);
    colHeader(p, 770); p.T(357, 752, 'Continuação');
    y = 735; split[1].forEach((r, i) => { mov(p, y, r, saldos[8 + i]); y -= 11; });
    for (let yy = 100; yy < 560; yy += 12) p.V(15.5, yy, 'BANCO EXEMPLO, S.A. - Capital Social');
    [2, 9, 14].forEach((k) => p.V(15.5, 735 - 11 * k, 'BANCO EXEMPLO, S.A. - Capital Social: 1.000.000 EUR - C.R.C. Lisboa com o NIPC 999 999 999')); // texto vertical que cruza linhas da tabela
    p.T(371, 70, 'Continua'); p.T(15, 30, FOOT, 5); pg.push(p.c());
    // página 4: fim da tabela + saldos + 1.º crédito
    p = page(); header(p, ext, ini, fim, 4, totalPages);
    colHeader(p, 770); p.T(357, 752, 'Continuação');
    y = 735; split[2].forEach((r, i) => { mov(p, y, r, saldos[28 + i]); y -= 11; });
    y -= 14; p.T(325, y, 'Saldo Contabilístico Final'); p.T(430, y, 'EUR'); p.R(569, y, money(final));
    y -= 11; p.T(337, y, 'Saldo Disponível Final'); p.T(430, y, 'EUR'); p.R(569, y, money(final));
    y -= 16; p.T(44, y, '(*) O valor indicado varia em função das condições contratuais aplicáveis.'); y -= 11; p.T(44, y, '30-12 e 31-12 são datas de exemplo num aviso: 99,99 EUR.');
    const loan = (p, y0, L, left) => {
      const x0 = left; p.T(x0, y0, `Empréstimo CRÉDITO PESSOAL Número: ${L.num}`, 8, 'F2'); p.T(380, y0, `Tx. Juro Aplicada: ${L.taxa}`);
      p.T(x0, y0 - 11, 'Prazo: 36 MESES'); p.T(380, y0 - 11, `Capital Concedido: ${money(L.concedido)}`);
      p.T(x0, y0 - 22, 'Moeda: EURO'); p.T(380, y0 - 22, `Capital Vincendo: ${money(L.fim)}`);
      p.T(x0, y0 - 33, 'Data Formalização: 2026-01-20');
      p.T(x0, y0 - 48, 'Detalhe de Movimentos', 8, 'F2');
      p.T(96, y0 - 62, 'Data'); p.T(333, y0 - 62, 'Conta'); p.T(417, y0 - 62, 'Outros'); p.T(473, y0 - 62, 'Movimento'); p.T(529, y0 - 62, 'Saldo');
      p.T(64, y0 - 72, 'Mov'); p.T(131, y0 - 72, 'Valor'); p.T(175, y0 - 72, 'Descritivo Movimento'); p.T(333, y0 - 72, 'Movimentada'); p.T(417, y0 - 72, 'Movimentos'); p.T(473, y0 - 72, 'Capital'); p.T(529, y0 - 72, 'Empréstimo');
      let yy = y0 - 86; const d = (dt, desc, extra) => { p.T(50, yy, dt); p.T(119, yy, dt); p.T(175, yy, desc); (extra || []).forEach(([kind, v]) => { if (kind === 'conta') p.T(335, yy, v); else if (kind === 'out') p.R(466, yy, v); else if (kind === 'cap') p.R(514, yy, v); else p.R(572, yy, v); }); yy -= 11; };
      d('2026-' + L.mes + '-02', 'Saldo Inicial', [['sal', money(-L.ini)]]);
      L.linhas.forEach((ln) => d(ln[0], ln[1], ln[2]));
      d('2026-' + L.mes + '-' + L.dia, 'Saldo Final', [['sal', money(-L.fim)]]);
      yy -= 6; p.T(x0, yy, `Reembolso antecipado do Empréstimo Número: ${L.num}`, 8, 'F2'); yy -= 12;
      p.T(43, yy + 9, 'Data'); p.T(43, yy, 'Mov'); p.T(115, yy, 'Valor'); p.T(308, yy, 'Montante do Reembolso'); yy -= 11;
      p.T(37, yy, '2026-' + L.mes + '-13'); p.T(109, yy, '2026-' + L.mes + '-13'); p.R(404, yy, money(L.reemb)); yy -= 16;
      return yy;
    };
    const L1 = loans[0], L2 = loans[1];
    const yAfter = loan(p, y - 30, L1, 37);
    p.T(15, 30, FOOT, 5); pg.push(p.c());
    // página 5: próxima prestação do 1.º crédito + 2.º crédito
    p = page(); header(p, ext, ini, fim, 5, totalPages);
    p.T(37, 790, `Próxima Prestação do Empréstimo Número ${L1.num}`, 8, 'F2'); p.T(48, 778, 'Vencimento'); p.T(123, 778, 'Prest. Nº'); p.T(188, 778, 'TAN'); p.T(395, 778, 'Total');
    p.T(50, 766, `2026-${L1.prox[0]}-10`); p.T(140, 766, String(L1.prox[1])); p.T(184, 766, L1.taxa); p.R(417, 766, money(L1.prox[2]));
    p.T(77, 746, 'Detalhe da Prest. N.º: ' + L1.prox[1], 8, 'F2'); p.T(175, 734, 'CAPITAL'); p.R(399, 734, money(L1.prox[2] - 5000)); p.T(175, 723, 'JUROS'); p.R(399, 723, money(5000));
    loan(p, 680, L2, 38);
    p.T(15, 30, FOOT, 5); pg.push(p.c());
    return { pdf: mkpdf(pg), final, opening, soma: final - opening, n: rows.length, resp, saldos };
  };
  const mkLoan = (num, mes, dia, ini, fim, concedido, taxa, reemb, prox) => ({ num, mes, dia, ini, fim, concedido, taxa, reemb, prox, linhas: [[`2026-${mes}-10`, 'PRESTAÇÃO Nº.00004', [['conta', CONTA]]], [`2026-${mes}-10`, 'CAPITAL', [['cap', money(10000)], ['sal', money(-(ini - 10000))]]], [`2026-${mes}-10`, 'JUROS', [['out', money(2500)]]], [`2026-${mes}-${dia}`, 'REEMBOLSO ANTECIPADO', [['cap', money(ini - 10000 - fim)], ['sal', money(-fim)]]]] });
  const nov = build({ ext: 11, ini: '2026-11-01', fim: '2026-11-30', rows: NOV, opening: 250, loans: [mkLoan('0000.00000000071', '11', '13', 300000, 280000, 400000, '9,000%', 10000, ['12', 4, 12000]), mkLoan('0000.00000000072', '11', '13', 150000, 140000, 200000, '8,000%', 0, ['12', 3, 9000])] });
  const dez = build({ ext: 12, ini: '2026-12-01', fim: '2026-12-31', rows: DEC, opening: nov.final, loans: [mkLoan('0000.00000000071', '12', '13', 280000, 260000, 400000, '9,000%', 10000, ['01', 5, 12000]), mkLoan('0000.00000000072', '12', '13', 140000, 130000, 200000, '8,000%', 0, ['01', 4, 9000])] });
  out('extrato-consolidado-nov.pdf', nov.pdf); out('extrato-consolidado-dez.pdf', dez.pdf);
  expected.consolidado = {
    iban: IBAN, nome: 'Conta Exemplo Plus',
    nov: { n: nov.n, abertura: nov.opening, final: nov.final, soma: nov.soma, entradas: NOV.filter((r) => r[3] > 0).length, saidas: NOV.filter((r) => r[3] < 0).length, dividas: [{ ref: '0000.00000000071', saldo: 280000, total: 400000, taxa: 9, prestacao: 12000 }, { ref: '0000.00000000072', saldo: 140000, total: 200000, taxa: 8, prestacao: 9000 }] },
    dez: { n: dez.n, abertura: dez.opening, final: dez.final, soma: dez.soma },
  };
}
// ---------- 8) PDFs sintéticos de estilos diferentes (ver generate-pdf.mjs) ----------
{
  const { generatePdfFixtures } = await import('./generate-pdf.mjs');
  expected.gen = await generatePdfFixtures();
}
out('expected.json', JSON.stringify(expected, null, 1) + '\n');
console.log('fixtures geradas:', Object.keys(expected).join(', '));
