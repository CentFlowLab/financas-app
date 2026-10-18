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
out('expected.json', JSON.stringify(expected, null, 1) + '\n');
console.log('fixtures geradas:', Object.keys(expected).join(', '));
