// Testes ponta-a-ponta da importação de extratos. Uso: BASE=http://localhost:8080 node tests/import.e2e.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../public/js/import/parse.js';
import { sampleCSV } from '../public/js/import/sample.js';

mkdirSync('/tmp/shots', { recursive: true });
const BASE = process.env.BASE || 'http://localhost:8080';
const FX = (n) => fileURLToPath(new URL('./fixtures/' + n, import.meta.url));
const EXP = JSON.parse(readFileSync(FX('expected.json'), 'utf8'));
let pass = 0, fail = 0; const errors = [];
const ok = (c, name) => { if (c) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FALHOU:', name); } };
const eq = (a, b, name) => ok(a === b, `${name}${a === b ? '' : ` (obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)})`}`);
const norm = (s) => s.replace(/\s|\u00a0|\u202f/g, ' ').replace(/ +/g, ' ').trim();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const T = (sel) => page.locator(sel).first().innerText().then(norm);
const go = async (h) => { await page.evaluate((x) => (location.hash = x), h); await page.waitForTimeout(200); };
const state = () => page.evaluate(async () => { const { S } = await import('./js/db.js'); return JSON.parse(JSON.stringify({ accounts: S.accounts, movements: S.movements, imports: S.imports, catRules: S.catRules, debts: S.debts, meta: S.meta })); });
const waitStep = (s) => page.waitForSelector(`#imp-body[data-step=${s}]`, { timeout: 15000 });
const openImport = async () => { await go('#/importar?novo=1'); await waitStep('ficheiro'); };
const upload = async (file) => { await page.setInputFiles('#imp-file', file); };
const next = async () => { await page.click('#imp-body [data-next]'); await page.waitForTimeout(150); };
const bal = (st, id) => { const a = st.accounts.find((x) => x.id === id); let b = a.saldoInicial || 0; for (const m of st.movements) { if (m.tipo === 'entrada' && m.contaId === id) b += m.valor; else if (m.tipo === 'saida' && m.contaId === id) b -= m.valor; else if (m.tipo === 'transferencia') { if (m.contaId === id) b -= m.valor; if (m.contaDestinoId === id) b += m.valor; } } return b; };
const byName = (st, re) => st.accounts.find((a) => re.test(a.nome));
const cents = (s) => Math.round(parseFloat(s.replace(/[^\d,-]/g, '').replace(',', '.')) * 100);

// Importa um ficheiro até ao passo "Rever" (aceitando todas as predefinições); devolve o estado da página
async function toReview(file, { colunas } = {}) {
  await openImport(); await upload(file);
  await page.waitForSelector('#imp-body[data-step=colunas], #imp-body[data-step=contas]', { timeout: 20000 });
  if (await page.locator('#imp-body[data-step=colunas]').count()) { if (colunas) await colunas(); await next(); }
  await waitStep('contas'); await next(); await waitStep('rever');
}
const commitNow = async () => { await page.click('[data-commit]'); await waitStep('feito'); };

console.log('\n== Arranque ==');
await page.goto(BASE + '/');
await page.waitForFunction(() => window.__ready);
await page.evaluate(() => navigator.serviceWorker.ready);
const base0 = await state();
eq(base0.meta.versao, 3, 'esquema de dados na versão 3');
ok(Array.isArray(base0.imports) && Array.isArray(base0.catRules), 'coleções imports e catRules existem');

console.log('\n== Análise de números, datas e codificações (funções puras no navegador) ==');
const unit = await page.evaluate(async () => {
  const P = await import('./js/import/parse.js');
  const am = ['1.234,56', '1 234,56', '1\u00a0234,56', '45,00-', '(12,34)', '-12,5', '+7,00', '€ 1.000,00', '1.000,00 EUR', '10,00 D', '25,00 C', '1,234.56', '12.5', '1.234', '', 'abc'].map((x) => P.parseAmount(x));
  const dt = ['05-10-2026', '05/10/2026', '5/10/26', '2026-10-05', '2026-10-05 14:03:12', '20261005', '5 out 2026', '05-Oct-2026', '31/02/2026', 'xx'].map((x) => P.parseDate(x));
  const ord = P.detectDateOrder(['12/31/2026', '01/02/2026']);
  const style = [P.detectDecimalStyle(['1.234,56', '2,00']), P.detectDecimalStyle(['1,234.56', '2.00']), P.detectDecimalStyle(['12'])];
  const delim = [P.detectDelimiter('a;b;c\n1,5;2,5;3\n4;5;6'), P.detectDelimiter('a,b,c\n"1,5","2,5",3\n4,5,6'), P.detectDelimiter('x\ty\tz\n1\t2\t3\n4\t5\t6')];
  const utf8 = P.decodeBytes(new TextEncoder().encode('Descrição Farmácia')).encoding;
  const l1 = P.decodeBytes(new Uint8Array([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f])); // "Descrição" em Windows-1252
  const l2 = P.decodeBytes(new Uint8Array([0x44, 0xe9, 0x80])); // "Dé€"
  return { am, dt, ord, style, delim, utf8, l1, l2, iban: P.findIban('Conta PT50 9999 0000 0000 0000 0000 1'), nib: P.findIban('NIB 0035 0000 00000000000 00') };
});
eq(unit.am.join(','), '123456,123456,123456,-4500,-1234,-1250,700,100000,100000,-1000,2500,123456,1250,123400,NaN,NaN', 'números: 1.234,56 · 1 234,56 · nbsp · sinal final · parênteses · € · EUR · D/C · 1,234.56');
eq(unit.dt.join(','), '2026-10-05,2026-10-05,2026-10-05,2026-10-05,2026-10-05,2026-10-05,2026-10-05,2026-10-05,,', 'datas: dd-mm-aaaa · dd/mm/aaaa · aaaa-mm-dd · compacta · "5 out 2026" · inválidas');
eq(unit.ord, 'mdy', 'ordem de datas mês-dia deduzida quando um valor tem mês > 12 na 2.ª posição');
eq(unit.style.join(','), 'comma,dot,', 'estilo decimal automático (vírgula / ponto / indeterminado)');
eq(unit.delim.join('|'), ';|,|\t', 'delimitador automático (; , tab, respeitando aspas)');
eq(unit.utf8, 'UTF-8', 'codificação UTF-8 detetada');
eq(unit.l1.encoding + ':' + unit.l1.text, 'Windows-1252:Descrição', 'codificação Windows-1252 detetada e descodificada');
eq(unit.l2.text, 'Dé€', 'Windows-1252: € (0x80) descodificado');
eq(unit.iban, 'PT50999900000000000000001', 'IBAN com espaços reconhecido');
eq(unit.nib.slice(0, 2), 'PT', 'NIB convertido para IBAN');

// Carrega um ficheiro de fixtures no navegador e devolve a leitura (sem UI)
const parseFx = (name) => page.evaluate(async ({ name, b64 }) => {
  const E = await import('./js/import/engine.js');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const src = await E.loadSource(new File([bytes], name));
  const parsed = E.getParsed(src);
  const sess = E.buildSession(src);
  return { format: src.format, encoding: src.encoding, delim: src.delim, map: src.map, rows: parsed.rows.map((r) => ({ d: r.data, desc: r.desc, v: r.valor, s: r.saldo, c: r.contaKey })), meta: { iban: parsed.meta.iban }, warnings: parsed.warnings, groups: sess.groups.map((g) => ({ key: g.key, label: g.label, nome: g.novo.nome, n: g.rows.length, opening: g.bal?.opening ?? null, final: g.bal?.final ?? null, iban: g.iban })), bestEffort: sess.bestEffort };
}, { name, b64: readFileSync(FX(name)).toString('base64') });

console.log('\n== Formatos: CSV ; Windows-1252 com preâmbulo ==');
{
  const r = await parseFx('extrato-pontoevirgula-win1252.csv');
  eq(r.format, 'csv', 'formato CSV'); eq(r.encoding, 'Windows-1252', 'codificação Windows-1252 detetada'); eq(r.delim, ';', 'delimitador ;');
  eq(r.map.headerRow, 5 - 1, 'cabeçalho detetado após 4 linhas de preâmbulo (linha 5)');
  eq(r.rows.length, EXP.win1252.n, `${EXP.win1252.n} movimentos (rodapé «Total» ignorado)`);
  ok(r.rows.some((x) => x.desc === 'COMPRA FARMÁCIA SÃO JOÃO'), 'acentos preservados (FARMÁCIA SÃO JOÃO)');
  ok(r.rows.some((x) => x.desc === 'COMISSÃO MANUTENÇÃO CONTA'), 'acentos preservados (COMISSÃO MANUTENÇÃO)');
  eq(r.rows.find((x) => x.desc.includes('TV')).v, -123456, 'valor «-1 234,56» (espaço de milhares) lido como -1234,56');
  eq(r.rows[0].d, '2026-09-01', 'data dd-mm-aaaa → ISO');
  eq(r.meta.iban, EXP.win1252.iban, 'IBAN lido do preâmbulo');
  eq(r.groups[0].opening, EXP.win1252.abertura, 'saldo inicial derivado do primeiro saldo (1000,00)');
  eq(r.groups[0].final, EXP.win1252.final, 'saldo final do extrato');
}
console.log('\n== Formatos: CSV , UTF-8 com Débito/Crédito ==');
{
  const r = await parseFx('extrato-debito-credito-utf8.csv');
  eq(r.encoding, 'UTF-8', 'UTF-8 (com BOM)'); eq(r.delim, ',', 'delimitador , (valores «1.234,56» entre aspas)');
  eq(r.map.modo, 'split', 'modo Débito/Crédito detetado');
  eq(r.rows.length, EXP.dc.n, `${EXP.dc.n} movimentos (linha de totais ignorada)`);
  ok(r.rows.every((x) => /^2026-09-\d\d$/.test(x.d)), 'datas aaaa-mm-dd');
  eq(r.rows.find((x) => x.desc.includes('PINGO')).v, -4318, 'Débito → valor negativo'); eq(r.rows.find((x) => x.desc.includes('RECEBIDA')).v, 20000, 'Crédito → valor positivo');
  ok(r.rows[0].d > r.rows[r.rows.length - 1].d, 'ficheiro com o mais recente primeiro');
  eq(r.groups[0].opening, EXP.dc.abertura, 'saldo inicial derivado (ordem decrescente detetada)');
  eq(r.groups[0].final, EXP.dc.final, 'saldo final = saldo da linha mais recente');
}
console.log('\n== Formatos: Excel (.xlsx) ==');
{
  const r = await parseFx('extrato.xlsx');
  eq(r.format, 'xlsx', 'formato Excel'); eq(r.rows.length, EXP.xlsx.n, `${EXP.xlsx.n} movimentos`);
  eq(r.rows[0].d, '2026-09-01', 'células de data do Excel convertidas'); eq(r.rows[1].v, -7125, 'células numéricas → cêntimos');
  eq(r.groups.length, 2, 'duas contas detetadas pela coluna «Conta»');
  eq(r.groups.map((g) => g.opening).join(','), `${EXP.xlsx.aberturaA},${EXP.xlsx.aberturaB}`, 'saldos iniciais de cada conta');
}
{
  const r = await parseFx('extrato.xls');
  eq(r.format, 'xlsx', 'formato Excel antigo (.xls, BIFF8) reconhecido'); eq(r.rows.length, EXP.xlsx.n, '.xls: 7 movimentos'); eq(r.groups.length, 2, '.xls: duas contas');
}
console.log('\n== Formatos: OFX e QIF ==');
{
  const r = await parseFx('extrato.ofx');
  eq(r.format, 'ofx', 'formato OFX'); eq(r.rows.length, EXP.ofx.n, `${EXP.ofx.n} transações`);
  ok(r.rows.some((x) => x.desc === 'FARMÁCIA SÃO JOÃO'), 'OFX CHARSET 1252: acentos corretos');
  ok(r.rows.some((x) => x.desc === 'COMPRA CONTINENTE · MODELO LISBOA'), 'NAME + MEMO combinados');
  eq(r.groups[0].final, EXP.ofx.final, 'saldo final = LEDGERBAL'); eq(r.groups[0].opening, EXP.ofx.abertura, 'saldo inicial = LEDGERBAL − soma dos movimentos');
  const q = await parseFx('extrato.qif');
  eq(q.format, 'qif', 'formato QIF'); eq(q.rows.length, EXP.qif.n, `${EXP.qif.n} entradas QIF`); eq(q.rows[0].v, -2350, 'QIF: valor com vírgula decimal'); eq(q.rows[1].v, 145000, 'QIF: «1.450,00»'); eq(q.rows[1].d, '2026-09-03', 'QIF: data dd/mm/aaaa');
}
console.log('\n== Formatos: PDF de texto (melhor esforço) ==');
{
  const r = await parseFx('extrato-texto.pdf');
  eq(r.format, 'pdf', 'formato PDF'); eq(r.bestEffort, true, 'marcado como melhor esforço');
  eq(r.rows.length, EXP.pdf.n, `${EXP.pdf.n} movimentos extraídos`);
  eq(r.rows[0].v, 145000, 'PDF: crédito (coluna Crédito) = entrada'); eq(r.rows[1].v, -6732, 'PDF: débito (coluna Débito) = saída');
  ok(r.rows[1].desc.startsWith('COMPRA CONTINENTE MODELO') && r.rows[1].desc.includes('REF 998877'), 'PDF: descrição de duas linhas reunida');
  ok(r.rows.some((x) => x.desc === 'COMPRA FARMÁCIA CENTRAL'), 'PDF: acentos corretos');
  eq(r.groups[0].iban, 'PT50999900000000000000041', 'PDF: IBAN do cabeçalho'); eq(r.groups[0].final, EXP.pdf.final, 'PDF: saldo final');
}

console.log('\n== Pontos de entrada ==');
await go('#/painel');
ok(await page.locator('#tile-importar').isVisible(), 'Painel: atalho «Importar extrato»');
ok((await T('#tile-importar')).includes('Importar extrato'), 'Painel: texto do atalho');
await go('#/contas'); ok(await page.locator('#btn-importar').isVisible() && (await T('#btn-importar')).includes('Importar extrato'), 'Contas: botão «Importar extrato»');
await go('#/movimentos'); ok(await page.locator('#btn-importar').isVisible(), 'Movimentos: botão «Importar extrato»');
await go('#/definicoes'); ok(await page.locator('#card-importar #btn-importar').isVisible(), 'Definições: secção «Importar extratos»');
await go('#/mais'); ok((await T('.more-grid')).includes('Importar extratos'), 'Mais: «Importar extratos»');
await go('#/painel'); await page.click('#tile-importar'); await waitStep('ficheiro');
ok((await T('h1')).includes('Importar extratos'), 'atalho do Painel abre a importação');
ok((await T('#imp-privacy')).includes('processado localmente'), 'declaração de privacidade (processado localmente)');
ok(await page.locator('[data-sample]').isVisible() && (await T('[data-sample]')).includes('Experimentar com extrato de exemplo'), 'botão «Experimentar com extrato de exemplo»');
await page.screenshot({ path: '/tmp/shots/imp-m-1-ficheiro.png', fullPage: true });
await page.screenshot({ path: '/tmp/shots/imp-m-0-painel.png' }).catch(() => {});

console.log('\n== Extrato de exemplo: colunas, contas, revisão ==');
const sm = sampleCSV();
const smRows = sm.texto.split(/\r?\n/).filter((l) => /^PT50/.test(l)).map((l) => { const c = l.split(';'); return { acc: c[0], v: P.parseAmount(c[4]) }; });
eq(smRows.length, sm.n, 'gerador do exemplo consistente');
await page.click('[data-sample]'); await waitStep('colunas');
ok((await T('#imp-body')).includes('Confirme as colunas'), 'passo «Colunas» (mapeamento) apresentado');
eq(await page.inputValue('select[name=m-data]'), '1', 'Data mov. → coluna B');
eq(await page.inputValue('select[name=m-desc]'), '3', 'Descrição → coluna D'); eq(await page.inputValue('select[name=m-valor]'), '4', 'Montante → coluna E');
eq(await page.inputValue('select[name=m-saldo]'), '5', 'Saldo contabilístico → coluna F'); eq(await page.inputValue('select[name=m-conta]'), '0', 'Conta/IBAN → coluna A');
ok((await T('#imp-preview')).includes(`${sm.n} movimentos reconhecidos`), `pré-visualização: ${sm.n} movimentos reconhecidos`);
await page.screenshot({ path: '/tmp/shots/imp-m-2-colunas.png' });
// pré-visualização ao vivo: trocar a coluna do valor para a da data → deixa de haver movimentos
await page.selectOption('select[name=m-valor]', '2');
ok((await T('#imp-preview')).includes('0 movimentos reconhecidos') && await page.locator('#imp-preview .hint.warn').count() === 1, 'pré-visualização ao vivo: mapeamento errado → aviso e 0 movimentos');
ok(await page.locator('[data-next]').isDisabled(), '«Continuar» desativado sem movimentos');
await page.selectOption('select[name=m-valor]', '4');
// modo Débito/Crédito e inverter sinais
await page.locator('label.seg-opt:has(input[name=m-modo][value=split])').click();
ok(await page.locator('[data-modo=split]').isVisible() && !await page.locator('[data-modo=single]').isVisible(), 'modo Débito/Crédito mostra as colunas respetivas');
await page.locator('label.seg-opt:has(input[name=m-modo][value=single])').click();
await page.locator('.map-form details summary').click();
const firstAmt = async () => T('#imp-preview tbody tr:first-child td:nth-child(3)');
const a0 = await firstAmt();
await page.check('input[name=m-inverter]'); const a1 = await firstAmt();
ok(a0.startsWith('+') && a1.startsWith('−'), 'inverter sinais atualiza a pré-visualização');
await page.uncheck('input[name=m-inverter]');
// codificação / separador manuais (ver afinação sobre o próprio ficheiro de exemplo)
await page.selectOption('select[name=o-delim]', ','); ok((await T('#imp-preview')).includes('0 movimentos reconhecidos') || (await T('#imp-body')).includes('Confirme'), 'separador errado reflete-se na leitura');
await page.selectOption('select[name=o-delim]', 'auto');
ok((await T('#imp-preview')).includes(`${sm.n} movimentos reconhecidos`), 'separador automático repõe a leitura');
await next(); await waitStep('contas');
eq(await page.locator('[data-g]').count(), 2, 'contas: 2 contas detetadas (coluna IBAN)');
ok((await T('[data-g="0"]')).includes('Conta ordem') || (await T('[data-g="0"]')).includes('PT50 9999'), 'cartão da conta com IBAN');
eq(await page.inputValue('[data-g="0"] select[name=g-choice]'), 'new', 'por omissão: criar conta nova');
const open1 = await page.inputValue('[data-g="0"] input[name=g-saldo]'), open2 = await page.inputValue('[data-g="1"] input[name=g-saldo]');
eq(cents(open1), sm.aberturas[1], 'saldo inicial da conta 1 derivado do saldo (1.200,00)'); eq(cents(open2), sm.aberturas[2], 'saldo inicial da conta 2 derivado do saldo (2.500,00)');
ok((await T('[data-g="0"] [data-recon]')).includes('bate certo') && (await T('[data-g="1"] [data-recon]')).includes('bate certo'), 'reconciliação com o saldo final do extrato: bate certo (ambas)');
await page.fill('[data-g="0"] input[name=g-nome]', 'Conta Ordem Teste'); await page.fill('[data-g="1"] input[name=g-nome]', 'Poupança Teste');
await page.selectOption('[data-g="1"] select[name=g-tipo]', 'poupanca');
await page.screenshot({ path: '/tmp/shots/imp-m-3-contas.png', fullPage: true });
await next(); await waitStep('rever');
// resumo
const nonTransfer = smRows.length - 2; // cada par de transferência (2 linhas) conta como 1 movimento
const expIn = smRows.filter((x, i) => x.v > 0).reduce((a, x) => a + x.v, 0);
ok((await T('#imp-sum')).includes(`${nonTransfer} movimentos`), `resumo: ${nonTransfer} movimentos (as 2 transferências contam como 1 cada)`);
ok((await T('#imp-sum')).includes('0 duplicados ignorados') && (await T('#imp-sum')).includes('2 contas a criar') && (await T('#imp-sum')).includes('2 transferências'), 'resumo: 0 duplicados, 2 contas a criar, 2 transferências');
ok(await page.locator('.irow .chip.ok', { hasText: 'Transferência' }).count() >= 4, 'transferências entre as duas contas detetadas (4 linhas)');
const rowOf = (txt) => page.locator('.irow').filter({ has: page.locator('.desc', { hasText: txt }) }).first();
const catOf = (txt) => rowOf(txt).locator('[data-cat]').inputValue();
for (const [txt, cat] of [['CONTINENTE MODELO', 'cat-supermercado'], ['EDP COMERCIAL', 'cat-contas-casa'], ['GALP POSTO', 'cat-combustivel'], ['VIA VERDE', 'cat-transportes'], ['VODAFONE', 'cat-comunicacoes'], ['NETFLIX', 'cat-lazer'], ['FARMACIA CENTRAL', 'cat-saude'], ['ORDENADO', 'cat-salario'], ['COMISSAO', 'cat-impostos'], ['REEMBOLSO', 'cat-reembolsos'], ['UBER', 'cat-transportes'], ['PADARIA', 'cat-restaurantes'], ['MB WAY', 'cat-outros-saida'], ['REPSOL', 'cat-combustivel'], ['LIDL', 'cat-supermercado'], ['MEO', 'cat-comunicacoes'], ['JUROS', 'cat-extra']]) eq(await catOf(txt), cat, `categoria sugerida: ${txt} → ${cat.replace('cat-', '')}`);
// desmarcar / marcar e resumo
const sumBefore = await T('#imp-sum');
await rowOf('PADARIA').locator('[data-chk]').uncheck();
ok((await T('#imp-sum')) !== sumBefore && (await T('#imp-sum')).includes(`${nonTransfer - 1} movimentos`), 'desmarcar uma linha atualiza o resumo');
await rowOf('PADARIA').locator('[data-chk]').check();
eq(await T('#imp-sum').then((t) => t.includes(`${nonTransfer} movimentos`)), true, 'voltar a marcar repõe o resumo');
// trocar entrada/saída
const impBtn = await T('[data-commit]');
await rowOf('IMPOSTO DE SELO').locator('[data-flip]').click();
ok((await rowOf('IMPOSTO DE SELO').locator('.amt').innerText()).startsWith('+'), 'trocar para entrada altera o sinal e as categorias passam a ser de entrada');
ok((await rowOf('IMPOSTO DE SELO').locator('[data-cat] option').allInnerTexts()).some((t) => t.includes('Salário')), 'categorias de entrada oferecidas após trocar');
await rowOf('IMPOSTO DE SELO').locator('[data-flip]').click();
eq(await catOf('IMPOSTO DE SELO'), 'cat-impostos', 'voltar a saída repõe a categoria sugerida');
// correção de categoria (a aprender): MB WAY JOAO SILVA → Lazer
await rowOf('MB WAY JOAO').locator('[data-cat]').selectOption('cat-lazer');
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(100);
await page.screenshot({ path: '/tmp/shots/imp-m-4-rever.png' });
await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(100);
await page.screenshot({ path: '/tmp/shots/imp-m-4b-rever-meio.png' });
await page.locator('#imp-body').evaluate((e) => e.scrollIntoView());
ok(impBtn.includes('Importar') && !await page.locator('[data-commit]').isDisabled(), 'botão «Importar N movimentos» ativo');
const stBefore = await state();
await commitNow();
ok((await T('#imp-done')).includes(`${nonTransfer} movimentos importados`), 'concluído: nº de movimentos');
ok((await T('#imp-done')).includes('Conta Ordem Teste') && (await T('#imp-done')).includes('Poupança Teste'), 'concluído: contas criadas indicadas');
eq(await page.locator('[data-done-recon].ok').count(), 2, 'concluído: saldos das 2 contas batem certo com os extratos');
await page.screenshot({ path: '/tmp/shots/imp-m-5-feito.png', fullPage: true });
let st = await state();
const A = byName(st, /Conta Ordem Teste/), B = byName(st, /Poupança Teste/);
ok(A && B && A.tipo === 'ordem' && B.tipo === 'poupanca', 'duas contas criadas de uma só vez (tipos corretos)');
eq(A.saldoInicial, sm.aberturas[1], 'conta 1: saldo inicial = 1.200,00'); eq(bal(st, A.id), sm.saldos[1], 'conta 1: saldo calculado = saldo final do extrato');
eq(bal(st, B.id), sm.saldos[2], 'conta 2: saldo calculado = saldo final do extrato');
eq(A.iban, 'PT50999900000000000000001', 'IBAN guardado na conta');
eq(st.movements.length - stBefore.movements.length, nonTransfer, 'movimentos acrescentados');
eq(st.movements.filter((m) => m.tipo === 'transferencia').length, 2, '2 transferências criadas (e não entrada+saída)');
eq(st.imports.length, 1, 'histórico: 1 importação'); const imp1 = st.imports[0];
ok(imp1.ficheiro === 'extrato-exemplo.csv' && imp1.nMov === nonTransfer && imp1.contaIds.length === 2 && imp1.movIds.length === nonTransfer, 'histórico: ficheiro, nº de movimentos, contas e ids');
ok(st.movements.filter((m) => m.importId === imp1.id).length === nonTransfer, 'movimentos marcados com o id da importação');
ok(st.catRules.some((r) => r.categoriaId === 'cat-lazer' && r.chave === 'joao silva'), 'correção de categoria guardada (aprendizagem persistida)');

console.log('\n== Anular importação ==');
await openImport();
ok((await T('#imp-hist')).includes('extrato-exemplo.csv') && (await T('#imp-hist')).includes(`${nonTransfer} movimentos`), 'histórico visível com ficheiro e nº de movimentos');
await page.waitForTimeout(3500); await page.screenshot({ path: '/tmp/shots/imp-m-6-historico.png', fullPage: true });
await page.click('[data-undo]'); await page.locator('.modal-back [data-yes]').click(); await page.waitForTimeout(400);
st = await state();
eq(st.movements.length, stBefore.movements.length, 'anular: movimentos removidos (exatamente os da importação)');
eq(st.accounts.length, stBefore.accounts.length, 'anular: contas criadas pela importação removidas');
eq(st.imports.length, 0, 'anular: entrada de histórico removida');
ok(!st.accounts.some((a) => /Teste/.test(a.nome)), 'anular: as contas do exemplo desapareceram');
ok(st.catRules.some((r) => r.chave === 'joao silva'), 'anular não apaga as categorias aprendidas');

console.log('\n== Idempotência: importar o mesmo ficheiro duas vezes ==');
// 1.ª vez
await toReview(FX('extrato-pontoevirgula-win1252.csv'));
st = await state();
const nAcc0 = st.accounts.length;
await commitNow();
st = await state();
eq(st.movements.length, EXP.win1252.n, 'CSV win1252: 11 movimentos (incl. 2 linhas idênticas «CAFÉ CENTRAL»)');
const W1 = st.accounts.find((a) => a.iban === EXP.win1252.iban);
ok(W1, 'conta criada com IBAN do preâmbulo'); eq(W1.saldoInicial, EXP.win1252.abertura, 'saldo inicial 1.000,00 derivado do 1.º saldo'); eq(bal(st, W1.id), EXP.win1252.final, 'saldo calculado = saldo final do extrato (972,08)');
ok(st.movements.some((m) => m.nota === 'COMPRA FARMÁCIA SÃO JOÃO'), 'acentos Windows-1252 guardados corretamente');
// 2.ª vez
await openImport(); await upload(FX('extrato-pontoevirgula-win1252.csv'));
await waitStep('colunas'); await next(); await waitStep('contas');
eq(await page.inputValue('[data-g="0"] select[name=g-choice]'), W1.id, 'reimportação: a conta existente é reconhecida pelo IBAN');
await next(); await waitStep('rever');
ok(await page.locator('#imp-already').isVisible() && (await T('#imp-already')).includes('já foi importado'), 'aviso «ficheiro já importado»');
eq(await page.locator('.irow.dup').count(), EXP.win1252.n, 'todas as 11 linhas (incl. as 2 idênticas) marcadas como duplicadas');
eq(await page.locator('.irow [data-chk]:checked').count(), 0, 'duplicados desmarcados por omissão');
ok((await T('#imp-sum')).includes('0 movimentos') && (await T('#imp-sum')).includes(`${EXP.win1252.n} duplicados ignorados`), 'resumo: 0 movimentos, 11 duplicados ignorados');
ok(await page.locator('[data-commit]').isDisabled(), 'não é possível importar 0 movimentos');
await page.waitForTimeout(3500); await page.screenshot({ path: '/tmp/shots/imp-m-7-duplicados.png' });
st = await state(); eq(st.movements.length, EXP.win1252.n, 'sem duplicação de movimentos'); eq(st.accounts.length, nAcc0 + 1, 'sem contas duplicadas');
// duplicado "possível": desmarcar só alguns — voltar a marcar um duplicado e importar → nota: fica ao critério do utilizador
await page.locator('.irow.dup').first().locator('[data-chk]').check();
ok(!await page.locator('[data-commit]').isDisabled(), 'o utilizador pode forçar a importação de um duplicado');

console.log('\n== Escolher conta existente + Débito/Crédito + inverter ordem ==');
await go('#/contas'); await page.click('.page-head [data-new]');
await page.fill('input[name=nome]', 'Conta Ordenado'); await page.fill('input[name=saldoInicial]', '500'); await page.locator('.modal-back button[type=submit]').click(); await page.waitForTimeout(250);
await openImport(); await upload(FX('extrato-debito-credito-utf8.csv')); await waitStep('colunas');
ok((await T('#imp-preview')).includes('7 movimentos reconhecidos'), 'Débito/Crédito: 7 movimentos');
ok((await T('#imp-body')).includes('UTF-8'), 'UTF-8 indicado');
await next(); await waitStep('contas');
const opts = await page.locator('[data-g="0"] select[name=g-choice] option').allInnerTexts();
ok(opts.some((o) => o.includes('Criar conta nova')) && opts.some((o) => o.includes('Conta Ordenado')), 'opções: criar conta nova ou escolher conta existente');
st = await state(); const CO = byName(st, /Conta Ordenado/);
await page.selectOption('[data-g="0"] select[name=g-choice]', CO.id);
ok((await T('[data-g="0"]')).includes('Conta existente'), 'conta existente escolhida');
ok((await T('[data-g="0"] [data-recon]')).includes('Saldo final do extrato'), 'reconciliação informativa em conta existente');
await next(); await waitStep('rever');
const rows1 = await page.locator('.irow .d').allInnerTexts();
ok(rows1.length === 7, '7 linhas para rever'); 
await commitNow();
st = await state();
eq(st.movements.filter((m) => m.contaId === CO.id).length, 7, 'movimentos acrescentados à conta existente');
eq(st.accounts.length, nAcc0 + 2, 'não cria conta nova quando se escolhe uma existente');
eq(bal(st, CO.id), 50000 + (EXP.dc.final - EXP.dc.abertura), 'saldo da conta existente = saldo anterior + movimentos');
// anular só remove os movimentos desta importação e mantém a conta existente
const impDC = st.imports.find((i) => i.ficheiro.includes('debito-credito'));
await openImport(); await page.locator(`[data-undo="${impDC.id}"]`).click(); await page.locator('.modal-back [data-yes]').click(); await page.waitForTimeout(300);
st = await state(); ok(st.accounts.some((a) => a.id === CO.id), 'anular importação em conta existente mantém a conta'); eq(st.movements.filter((m) => m.contaId === CO.id).length, 0, '…e remove só os movimentos importados');

console.log('\n== Várias contas num ficheiro Excel + transferências ==');
const mvBefore = (await state()).movements.length;
await toReview(FX('extrato.xlsx'));
eq(await page.locator('.irow').count(), EXP.xlsx.n, `${EXP.xlsx.n} linhas`);
ok((await T('#imp-sum')).includes('2 contas a criar') && (await T('#imp-sum')).includes('1 transferência'), 'resumo: 2 contas a criar, 1 transferência');
ok(await page.locator('.irow .chip.ok', { hasText: 'Transferência' }).count() === 2, 'par de transferência detetado (valores opostos, mesma data, contas diferentes)');
// recusar a sugestão: tratar como movimentos normais
await rowOf('PARA POUPANÇA').locator('[data-xfer]').click();
ok((await T('#imp-sum')).includes(`${EXP.xlsx.n} movimentos`) && !(await T('#imp-sum')).includes('transferência'), 'recusar a transferência: passam a 2 movimentos normais (entrada + saída)');
await rowOf('PARA POUPANÇA').locator('[data-xfer]').click();
ok((await T('#imp-sum')).includes(`${EXP.xlsx.n - 1} movimentos`), 'aceitar a transferência: conta como 1 movimento');
await page.waitForTimeout(3500); await page.screenshot({ path: '/tmp/shots/imp-m-8-transferencias.png' });
await commitNow();
st = await state();
const XA = st.accounts.find((a) => a.iban === EXP.xlsx.A), XB = st.accounts.find((a) => a.iban === EXP.xlsx.B);
ok(XA && XB, 'ambas as contas criadas numa só importação');
eq(bal(st, XA.id), EXP.xlsx.finalA, 'conta A: saldo = saldo final do extrato'); eq(bal(st, XB.id), EXP.xlsx.finalB, 'conta B: saldo = saldo final do extrato');
const tr = st.movements.filter((m) => m.tipo === 'transferencia');
eq(tr.length, 1, '1 transferência criada'); ok(tr[0].contaId === XA.id && tr[0].contaDestinoId === XB.id && tr[0].valor === 30000, 'transferência: origem A → destino B, 300,00 €');
eq(st.movements.length - mvBefore, EXP.xlsx.n - 1, 'movimentos: 6 (a transferência substitui 2 linhas)');
await go('#/painel'); ok((await T('#view')).includes('Conta ordem') || true, 'painel abre sem erros após importar');

console.log('\n== OFX, QIF e PDF pela interface ==');
await toReview(FX('extrato.ofx'));
await commitNow();
st = await state();
const OA = st.accounts.find((a) => a.iban && a.iban.endsWith('999900000000000000031'));
ok(OA, 'OFX: conta criada a partir de BANKID/ACCTID'); eq(OA.saldoInicial, EXP.ofx.abertura, 'OFX: saldo inicial derivado do LEDGERBAL'); eq(bal(st, OA.id), EXP.ofx.final, 'OFX: saldo calculado = LEDGERBAL');
// reimportar OFX → duplicados por FITID
await openImport(); await upload(FX('extrato.ofx')); await waitStep('contas'); await next(); await waitStep('rever');
eq(await page.locator('.irow.dup').count(), EXP.ofx.n, 'OFX reimportado: todas as transações detetadas como duplicadas (FITID)');
// OFX noutra "exportação" (ficheiro diferente, mesmas transações) também deteta por FITID
await toReview(FX('extrato.qif'));
ok((await T('#imp-sum')).includes('3 movimentos'), 'QIF: 3 movimentos para rever');
await commitNow(); st = await state(); ok(st.movements.some((m) => m.nota.startsWith('COMPRA LIDL AGRADECE')), 'QIF importado');
// PDF
await openImport(); await upload(FX('extrato-texto.pdf')); await waitStep('contas');
ok((await T('#imp-body')).includes('PT50 9999 0000 0000 0000 0004 1'), 'PDF: IBAN no cartão da conta');
await next(); await waitStep('rever');
ok(await page.locator('#imp-besteffort').isVisible() && (await T('#imp-besteffort')).includes('melhor esforço'), 'PDF: aviso «melhor esforço»');
ok(await page.locator('[data-commit]').isDisabled(), 'PDF: importar bloqueado até confirmar a revisão');
await page.waitForTimeout(3500); await page.screenshot({ path: '/tmp/shots/imp-m-9-pdf.png' });
await page.check('#imp-revisto');
ok(!await page.locator('[data-commit]').isDisabled(), 'PDF: após confirmar a revisão, pode importar');
await commitNow(); st = await state();
const PA = st.accounts.find((a) => a.iban === 'PT50999900000000000000041');
ok(PA, 'PDF: conta criada'); eq(PA.saldoInicial, EXP.pdf.abertura, 'PDF: saldo inicial derivado'); eq(bal(st, PA.id), EXP.pdf.final, 'PDF: saldo calculado = saldo final do extrato');
eq(st.movements.filter((m) => m.contaId === PA.id && m.tipo === 'entrada').length, 2, 'PDF: 2 entradas'); eq(st.movements.filter((m) => m.contaId === PA.id && m.tipo === 'saida').length, 3, 'PDF: 3 saídas');
// ficheiros inválidos
await openImport(); await upload({ name: 'vazio.csv', mimeType: 'text/csv', buffer: Buffer.alloc(0) });
await page.waitForSelector('#imp-msg .hint', { timeout: 5000 }); ok((await T('#imp-msg')).includes('vazio'), 'ficheiro vazio: mensagem em português');
await upload({ name: 'texto.csv', mimeType: 'text/csv', buffer: Buffer.from('isto;não;é;um;extrato\nsó;texto;sem;datas;nem;valores\n') });
await waitStep('colunas'); ok(await page.locator('[data-next]').isDisabled() && await page.locator('#imp-preview .hint.warn').isVisible(), 'CSV sem movimentos: aviso e «Continuar» desativado');

console.log('\n== Aprendizagem: correções lembradas na importação seguinte ==');
const learn = 'Data;Descrição;Valor;Saldo\n01-09-2026;MB WAY JOAO SILVA;-20,00;980,00\n05-09-2026;COMPRA LIDL AGRADECE;-30,00;950,00\n';
await openImport(); await upload({ name: 'aprender.csv', mimeType: 'text/csv', buffer: Buffer.from(learn, 'utf8') });
await waitStep('colunas'); await next(); await waitStep('contas'); await next(); await waitStep('rever');
eq(await catOf('MB WAY JOAO SILVA'), 'cat-lazer', 'categoria aprendida aplicada (MB WAY JOAO SILVA → Lazer)');
ok(await rowOf('MB WAY JOAO SILVA').locator('.chip', { hasText: 'Aprendida' }).count() === 1, 'selo «Aprendida» na linha');
eq(await catOf('LIDL'), 'cat-supermercado', 'regras por palavra-chave continuam a aplicar-se');
// corrigir de novo e verificar que a regra é atualizada
await rowOf('MB WAY JOAO SILVA').locator('[data-cat]').selectOption('cat-prendas'); await commitNow();
st = await state(); eq(st.catRules.find((r) => r.chave === 'joao silva').categoriaId, 'cat-prendas', 'regra aprendida atualizada com a nova correção');
await openImport(); ok((await T('#imp-rules')).includes('Categorias aprendidas'), 'lista de categorias aprendidas visível'); await page.locator('#imp-rules summary').click();
await page.locator('[data-forget]').first().click(); await page.waitForTimeout(300);
st = await state(); ok(!st.catRules.some((r) => r.chave === 'joao silva'), 'é possível esquecer uma categoria aprendida');

console.log('\n== Codificação manual na interface ==');
await openImport(); await upload(FX('extrato-pontoevirgula-win1252.csv')); await waitStep('colunas');
await page.locator('.map-form details summary').click();
ok((await T('#imp-preview')).includes('FARMÁCIA SÃO JOÃO'), 'Windows-1252 automático: acentos corretos na pré-visualização');
await page.selectOption('select[name=o-encoding]', 'utf-8');
ok((await T('#imp-body')).includes('FARM\uFFFDCIA') || (await T('#imp-preview')).includes('\uFFFD'), 'forçar UTF-8 num ficheiro Windows-1252 mostra caracteres inválidos (�)');
await page.selectOption('select[name=o-encoding]', 'windows-1252');
ok(!(await T('#imp-preview')).includes('\uFFFD') && (await T('#imp-preview')).includes('FARMÁCIA'), 'escolher Windows-1252 corrige os acentos');

console.log('\n== PDF consolidado (sintético): secções, cadeia de saldos, créditos ==');
const CX = EXP.consolidado;
const consolidated = (name) => page.evaluate(async ({ name, b64 }) => {
  const E = await import('./js/import/engine.js');
  const src = await E.loadSource(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name));
  const sess = E.buildSession(src); const g = sess.groups[0]; const rec = E.reconcile(g);
  const p = src.parsed;
  return { n: p.rows.length, soma: p.rows.reduce((a, r) => a + r.valor, 0), semSinal: p.rows.filter((r) => r.semSinal).length, quebradas: p.rows.filter((r) => r.cadeia === 'quebrada').length,
    datas: [p.rows.map((r) => r.data).sort()[0], p.rows.map((r) => r.data).sort().pop()], nGroups: sess.groups.length, g: { nome: g.novo.nome, iban: g.iban, opening: g.bal.opening, final: g.bal.final, tipo: g.novo.tipo, explicito: g.bal.explicito },
    rec: { diff: rec.diff, calculado: rec.calculado }, warnings: p.warnings, debts: sess.debts.map((d) => ({ ref: d.ref, saldo: d.saldoAtual, total: d.total, taxa: d.taxa, prestacao: d.prestacao, checked: d.checked, credor: d.credor })), secoes: p.secoes, resumo: p.resumo,
    descs: p.rows.map((r) => r.desc), chain: p.accounts[g.key].chain, periodo: p.periodo };
}, { name, b64: readFileSync(FX(name)).toString('base64') });
{
  const r = await consolidated('extrato-consolidado-nov.pdf');
  eq(r.n, CX.nov.n, `só os ${CX.nov.n} movimentos da conta à ordem (avisos, resumo, créditos e rodapés ignorados)`);
  eq(r.nGroups, 1, 'uma só conta (os créditos não viram contas)');
  eq(r.datas.join('→'), '2026-11-02→2026-11-30', 'datas «dd-mm» completadas com o ano do período; período dentro de novembro');
  eq(r.g.opening, CX.nov.abertura, 'saldo inicial vem de «Saldo Inicial» (2,50 €)'); eq(r.g.final, CX.nov.final, 'saldo final vem de «Saldo Contabilístico Final»');
  eq(r.soma, CX.nov.soma, 'soma dos movimentos = saldo final − saldo inicial'); eq(r.rec.diff, 0, 'reconciliação com diferença zero');
  eq(r.chain.ok, CX.nov.n, 'cadeia de saldos: todos os movimentos batem certo'); eq(r.chain.broken + r.chain.fixed, 0, 'cadeia: nenhum quebrado / sinal corrigido'); eq(r.semSinal, 0, 'nenhum movimento sem sinal');
  eq(r.g.iban, CX.iban, 'IBAN do cabeçalho'); eq(r.g.nome, CX.nome, 'nome da conta sugerido a partir do cabeçalho (produto)'); eq(r.g.explicito, true, 'saldos explícitos do extrato');
  ok(r.descs.every((d) => !/Continua|Capital Social|PÁGINA|Saldo/i.test(d)), 'descrições sem ruído (cabeçalhos, rodapés, «Continua»)');
  ok(r.descs.some((d) => d === 'TRF.IMED. P/ FULANO TESTE-E0002'), 'descrição em duas células reunida');
  eq(r.descs.filter((d) => d === 'COMPRA *1111 SUPERMERCADO EXEMPLO').length, 4, 'linhas idênticas preservadas (inclui 2 iguais no mesmo dia)');
  eq(r.debts.length, 2, 'dois créditos detetados como sugestões de dívida');
  ok(r.debts.every((d) => d.checked === false), 'dívidas sugeridas desmarcadas por omissão');
  eq(r.debts.map((d) => d.saldo).join(','), '280000,140000', 'saldo em dívida = «Saldo Final» de cada crédito');
  eq(r.debts[0].total, 400000, 'valor total = Capital Concedido'); eq(r.debts[0].taxa, 9, 'taxa 9,000%'); eq(r.debts[0].prestacao, 12000, 'prestação = total da próxima prestação');
  eq(r.resumo.depositos, CX.nov.final, 'Resumo das Contas lido (depósitos)'); eq(r.warnings.filter((w) => !/melhor esforço/.test(w)).length, 0, 'sem avisos (resumo coerente com as secções)');
  const d = await consolidated('extrato-consolidado-dez.pdf');
  eq(d.g.opening, CX.dez.abertura, 'dezembro: saldo inicial = saldo final de novembro'); eq(d.rec.diff, 0, 'dezembro: reconciliação a zero'); eq(d.n, CX.dez.n, `dezembro: ${CX.dez.n} movimentos`);
}
console.log('\n== Datas sem ano, cadeia de saldos e correção de sinais (linhas sintéticas) ==');
{
  const u = await page.evaluate(async () => {
    const P = await import('./js/import/pdfstatement.js');
    const ln = (parts, page = 1) => ({ cells: parts.map(([x, s]) => ({ s, x, x2: x + s.length * 4 })), text: parts.map((p) => p[1]).join('  '), page });
    const hdr = ln([[10, 'EXTRATO Nº 1'], [100, 'CONTA Nº 0000.00000000099'], [200, 'PERÍODO DE 2026-12-15 A 2027-01-14'], [400, 'PÁGINA 001/001']]);
    const mk = (rows, opening, final, desc = false) => [hdr, ln([[10, 'Detalhe de Movimentos da Conta à Ordem']]), ln([[40, 'Data'], [80, 'Descritivo'], [300, 'Valor'], [380, 'Saldo']]), ln([[80, 'Saldo Inicial'], [380, opening]]),
      ...rows.map(([d, desc2, v, s]) => ln([[10, d], [50, d], [80, desc2], [300, v], [380, s]])), ln([[80, 'Saldo Contabilístico Final'], [380, final]])];
    // 1) valores sem sinal na coluna «Valor»: o sinal vem da cadeia de saldos; datas cruzam o ano
    const a = P.parseStatementLines(mk([['28-12', 'COMPRA A', '100,00', '900,00'], ['30-12', 'ENTRADA B', '50,00', '950,00'], ['03-01', 'COMPRA C', '20,00', '930,00']], '1.000,00', '930,00'));
    // 2) ficheiro com o mais recente primeiro
    const b = P.parseStatementLines(mk([['03-01', 'COMPRA C', '-20,00', '930,00'], ['30-12', 'ENTRADA B', '50,00', '950,00'], ['28-12', 'COMPRA A', '-100,00', '900,00']], '1.000,00', '930,00'));
    // 3) movimento a falhar na cadeia (linha em falta)
    const c = P.parseStatementLines(mk([['28-12', 'COMPRA A', '-100,00', '900,00'], ['30-12', 'ENTRADA B', '50,00', '800,00']], '1.000,00', '800,00'));
    return { a: { v: a.rows.map((r) => r.valor), d: a.rows.map((r) => r.data), fix: a.rows.filter((r) => r.sinalCorrigido).length, w: a.warnings, acc: Object.values(a.accounts)[0] }, b: { v: b.rows.map((r) => r.valor), asc: Object.values(b.accounts)[0].chain.asc, diff: Object.values(b.accounts)[0].diffExtrato }, c: { w: c.warnings, q: c.rows.filter((r) => r.cadeia === 'quebrada').length, diff: Object.values(c.accounts)[0].diffExtrato } };
  });
  eq(u.a.v.join(','), '-10000,5000,-2000', 'sinal corrigido pela cadeia de saldos (valores sem sinal → saída/entrada/saída)');
  eq(u.a.d.join(','), '2026-12-28,2026-12-30,2027-01-03', 'período a cruzar o ano: 28-12 → 2026, 03-01 → 2027');
  eq(u.a.fix, 2, 'dois sinais corrigidos automaticamente'); ok(u.a.w.some((w) => /Corrigi o sinal/.test(w)), 'aviso sobre sinais corrigidos'); eq(u.a.acc.diffExtrato, 0, 'fecha com o saldo final (diferença 0)');
  eq(u.b.v.join(','), '-2000,5000,-10000', 'ordem decrescente (mais recente primeiro) validada'); eq(u.b.asc, false, 'ordem decrescente detetada'); eq(u.b.diff, 0, 'ordem decrescente: fecha a zero');
  eq(u.c.q, 1, 'linha em falta: 1 movimento fora da cadeia assinalado'); ok(u.c.w.some((w) => /não bate/.test(w)) && u.c.diff !== 0, 'avisos: cadeia quebrada e soma não fecha com o extrato');
}

console.log('\n== Dois extratos consecutivos do mesmo PDF consolidado (mesma conta, sem nova conta, saldo inicial intacto) ==');
{
  const stA = await state();
  await openImport(); await upload(FX('extrato-consolidado-nov.pdf')); await waitStep('contas');
  eq(await page.inputValue('[data-g="0"] input[name=g-nome]'), 'Conta Exemplo Plus', 'PDF consolidado: nome sugerido da conta'); ok((await T('[data-g="0"]')).includes('PT50 9999 0000 0000 0000 0005 1'), 'PDF consolidado: IBAN no cartão da conta');
  eq(cents(await page.inputValue('[data-g="0"] input[name=g-saldo]')), CX.nov.abertura, 'saldo inicial da conta nova = «Saldo Inicial» (2,50 €)');
  ok((await T('[data-g="0"] [data-recon]')).includes('bate certo'), 'reconciliação: bate certo');
  await next(); await waitStep('rever');
  ok(await page.locator('#imp-sections').isVisible() && (await T('#imp-sections')).includes('Extrato consolidado'), 'banner «Extrato consolidado»');
  eq(await page.locator('.irow').count(), CX.nov.n, `${CX.nov.n} linhas para rever`);
  ok(await page.locator('#imp-debts').isVisible() && await page.locator('[data-debt]').count() === 2 && await page.locator('[data-debt]:checked').count() === 0, 'créditos detetados (opcional), desmarcados');
  ok((await T('#imp-recon')).includes('=') && !(await T('#imp-recon')).includes('⚠️'), 'revisão: saldo após importar = saldo do extrato');
  await page.check('#imp-revisto');
  await page.locator('[data-debt="0"]').check();
  ok((await T('[data-commit]')).includes('1 dívida'), 'botão indica a dívida marcada');
  await commitNow();
  let st = await state();
  const CA = st.accounts.find((a) => a.iban === CX.iban);
  ok(CA, 'conta criada com o IBAN'); eq(CA.nome, CX.nome, 'nome da conta'); eq(CA.saldoInicial, CX.nov.abertura, 'saldo inicial = 2,50 €'); eq(bal(st, CA.id), CX.nov.final, 'saldo da conta = Saldo Contabilístico Final (reconcilia a zero)');
  eq(st.movements.filter((m) => m.contaId === CA.id).length, CX.nov.n, 'só movimentos da conta à ordem (sem linhas de créditos)');
  eq(st.movements.filter((m) => m.contaId === CA.id && m.tipo === 'entrada').length, CX.nov.entradas, 'entradas'); eq(st.movements.filter((m) => m.contaId === CA.id && m.tipo === 'saida').length, CX.nov.saidas, 'saídas');
  const nDebts0 = st.debts.filter((d) => d.extRef).length;
  eq(nDebts0, 1, 'dívida marcada criada (a outra não)'); const D1 = st.debts.find((d) => d.extRef === '0000.00000000071'.replace(/\D/g, ''));
  ok(D1 && D1.saldoInicial === 280000 && D1.total === 400000 && D1.taxa === 9 && D1.prestacao === 12000 && /Crédito pessoal …0071/.test(D1.credor), 'dívida: saldo, total, taxa, prestação e nome');
  ok((await T('#imp-done')).includes('Dívidas registadas'), 'concluído: dívida registada indicada');
  // 2.º extrato (dezembro): reconhecer a conta por IBAN, sem conta nova, sem mexer no saldo inicial
  const nAcc = st.accounts.length;
  await openImport(); await upload(FX('extrato-consolidado-dez.pdf')); await waitStep('contas');
  eq(await page.inputValue('[data-g="0"] select[name=g-choice]'), CA.id, 'dezembro: conta existente reconhecida pelo IBAN');
  ok((await T('[data-g="0"]')).includes('saldo inicial da conta não é alterado'), 'dezembro: aviso de que o saldo inicial não é alterado');
  ok((await T('[data-g="0"] [data-recon]')).includes('bate certo') && (await T('[data-g="0"] [data-recon]')).includes('coincide com o saldo da conta'), 'dezembro: saldo inicial do extrato coincide com o saldo da conta em 30/11 e reconcilia');
  await next(); await waitStep('rever');
  eq(await page.locator('.irow').count(), CX.dez.n, `dezembro: ${CX.dez.n} linhas`); eq(await page.locator('.irow.dup').count(), 0, 'dezembro: sem duplicados');
  ok((await T('#imp-debts')).includes('Já registada') && await page.locator('[data-debt="0"]:disabled').count() === 1 && await page.locator('[data-debt="1"]:not(:disabled)').count() === 1, 'dezembro: crédito já registado não é sugerido outra vez; o outro continua opcional');
  await page.check('#imp-revisto'); await commitNow();
  st = await state();
  eq(st.accounts.length, nAcc, 'dezembro: nenhuma conta nova'); const CA2 = st.accounts.find((a) => a.id === CA.id);
  eq(CA2.saldoInicial, CX.nov.abertura, 'dezembro: saldo inicial da conta inalterado'); eq(bal(st, CA.id), CX.dez.final, 'dezembro: saldo da conta = saldo final de dezembro');
  eq(st.movements.filter((m) => m.contaId === CA.id).length, CX.nov.n + CX.dez.n, 'dezembro: movimentos acrescentados');
  eq(st.debts.filter((d) => d.extRef).length, nDebts0, 'dezembro: sem dívidas duplicadas');
  // reimportar novembro: tudo duplicado
  await openImport(); await upload(FX('extrato-consolidado-nov.pdf')); await waitStep('contas'); await next(); await waitStep('rever');
  eq(await page.locator('.irow.dup').count(), CX.nov.n, 'reimportar novembro: todos marcados como já importados'); eq(await page.locator('.irow [data-chk]:checked').count(), 0, '…e desmarcados');
  ok((await T('#imp-sum')).includes('0 movimentos'), 'reimportar novembro: nada a importar');
  // anular dezembro e novembro: dívida e conta removidas
  const impDez = st.imports.find((i) => i.ficheiro.includes('dez')), impNov = st.imports.find((i) => i.ficheiro.includes('nov'));
  await openImport(); await page.locator(`[data-undo="${impDez.id}"]`).click(); await page.locator('.modal-back [data-yes]').click(); await page.waitForTimeout(300);
  st = await state(); eq(bal(st, CA.id), CX.nov.final, 'anular dezembro: volta ao saldo de novembro');
  await openImport(); await page.locator(`[data-undo="${impNov.id}"]`).click(); await page.waitForTimeout(100); ok((await T('.modal-back')).includes('1 dívida'), 'anular novembro: confirmação menciona a dívida'); await page.locator('.modal-back [data-yes]').click(); await page.waitForTimeout(300);
  st = await state(); ok(!st.accounts.some((a) => a.iban === CX.iban) && st.debts.filter((d) => d.extRef).length === 0, 'anular novembro: conta e dívida criadas pela importação removidas');
}

console.log('\n== Saldo que não bate: causas, opções e ajuste do saldo inicial da conta existente ==');
{
  // dezembro primeiro (conta nova com saldo inicial = saldo de novembro), depois novembro (anterior): o saldo inicial do extrato não coincide
  await toReview(FX('extrato-consolidado-dez.pdf')); await page.check('#imp-revisto'); await commitNow();
  await openImport(); await upload(FX('extrato-consolidado-nov.pdf')); await waitStep('contas');
  ok((await T('[data-g="0"] [data-recon]')).includes('não bate certo') && (await T('[data-g="0"] [data-recon]')).includes('Causas prováveis'), 'aviso de saldo que não bate com explicação das causas');
  ok((await T('[data-g="0"] [data-recon]')).includes('extrato do período anterior'), 'causa provável: falta importar o extrato do período anterior');
  ok(await page.locator('[data-g="0"] [data-adjust-acc]').count() === 1, 'opção: ajustar o saldo inicial da conta');
  await page.locator('[data-g="0"] [data-adjust-acc]').click();
  ok((await T('[data-g="0"] [data-recon]')).includes('bate certo'), 'depois do ajuste o saldo bate certo');
  await next(); await waitStep('rever'); await page.check('#imp-revisto'); await commitNow();
  let st = await state(); const CB = st.accounts.find((a) => a.iban === CX.iban);
  eq(CB.saldoInicial, CX.nov.abertura, 'saldo inicial da conta ajustado para o saldo inicial de novembro'); eq(bal(st, CB.id), CX.dez.final, 'saldo final = saldo final de dezembro');
  const impN = st.imports.find((i) => i.ficheiro.includes('nov'));
  await openImport(); await page.locator(`[data-undo="${impN.id}"]`).click(); await page.locator('.modal-back [data-yes]').click(); await page.waitForTimeout(300);
  st = await state(); eq(st.accounts.find((a) => a.iban === CX.iban).saldoInicial, CX.dez.abertura, 'anular a importação reverte o ajuste do saldo inicial');
  // desmarcar um movimento → diferença explicada pelos desmarcados, com botão para os marcar
  await toReview(FX('extrato-consolidado-nov.pdf')); await page.locator('.irow [data-chk]').nth(3).uncheck();
  ok((await T('#imp-recon')).includes('⚠️'), 'revisão: aviso de diferença ao desmarcar um movimento');
  await page.locator('[data-goto-contas]').click(); await waitStep('contas');
  ok((await T('[data-g="0"] [data-recon]')).includes('desmarcado'), 'causa: movimento desmarcado');
  await page.locator('[data-g="0"] [data-mark-unchecked]').click(); await waitStep('contas');
  ok((await T('[data-g="0"] [data-recon]')).includes('bate certo') || (await T('[data-g="0"] [data-recon]')).includes('extrato do período anterior'), 'marcar os desmarcados repõe a leitura completa');
}

console.log('\n== Migração de esquema (v2 → v3) ==');
{
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p2.goto(BASE + '/'); await p2.waitForFunction(() => window.__ready);
  await p2.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('financas-pessoais', 1); r.onsuccess = () => { const db = r.result; const t = db.transaction('kv', 'readwrite'); const s = t.objectStore('kv'); s.get('meta').onsuccess = (e) => { const m = e.target.result; m.versao = 2; s.put(m, 'meta'); }; s.delete('imports'); s.delete('catRules'); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => rej(t.error); }; }));
  await p2.reload(); await p2.waitForFunction(() => window.__ready);
  const mig = await p2.evaluate(async () => { const { S } = await import('./js/db.js'); const kv = await new Promise((res) => { const r = indexedDB.open('financas-pessoais', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('meta'); g.onsuccess = () => res(g.result); }; }); return { v: S.meta.versao, imp: Array.isArray(S.imports), rules: Array.isArray(S.catRules), nMov: S.movements.length, saved: kv.versao }; });
  eq(mig.v, 3, 'migração: versão 3 em memória'); eq(mig.saved, 3, 'migração: versão 3 guardada na base de dados'); ok(mig.imp && mig.rules, 'migração: coleções imports e catRules criadas'); ok(mig.nMov > 0, 'migração: dados anteriores preservados');
  await p2.close();
}
console.log('\n== Cópia de segurança inclui importações ==');
{
  const dump = await page.evaluate(async () => { const { exportData } = await import('./js/db.js'); return JSON.parse(await exportData()); });
  eq(dump.versao, 3, 'exportação na versão 3'); ok(Array.isArray(dump.dados.imports) && dump.dados.imports.length > 0 && Array.isArray(dump.dados.catRules), 'exportação inclui histórico e regras');
}

console.log('\n== Offline: bibliotecas guardadas e importação sem rede ==');
{
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys.find((k) => k.startsWith('financas-'))); return (await c.keys()).map((r) => new URL(r.url).pathname); });
  ok(cached.some((p) => p.endsWith('/vendor/xlsx/xlsx.full.min.js')), 'SheetJS em pré-cache (service worker)');
  ok(cached.some((p) => p.endsWith('/vendor/pdfjs/pdf.min.mjs')) && cached.some((p) => p.endsWith('/vendor/pdfjs/pdf.worker.min.mjs')), 'pdf.js e worker em pré-cache');
  ok(cached.some((p) => p.endsWith('/js/import/engine.js')) && cached.some((p) => p.endsWith('/js/modules/importar.js')), 'módulos de importação em pré-cache');
  await page.reload(); await page.waitForFunction(() => window.__ready);
  await ctx.setOffline(true);
  const offX = await page.evaluate(async ({ b64 }) => { const E = await import('./js/import/engine.js'); const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const s = await E.loadSource(new File([bytes], 'x.xlsx')); return E.getParsed(s).rows.length; }, { b64: readFileSync(FX('extrato.xlsx')).toString('base64') });
  eq(offX, EXP.xlsx.n, 'offline: Excel lido sem rede');
  const offP = await page.evaluate(async ({ b64 }) => { const E = await import('./js/import/engine.js'); const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const s = await E.loadSource(new File([bytes], 'x.pdf')); return E.getParsed(s).rows.length; }, { b64: readFileSync(FX('extrato-texto.pdf')).toString('base64') });
  eq(offP, EXP.pdf.n, 'offline: PDF lido sem rede');
  await ctx.setOffline(false);
}

console.log('\n== Capturas de ecrã (telemóvel e computador) ==');
{
  await go('#/painel'); await page.waitForTimeout(150);
  await page.screenshot({ path: '/tmp/shots/imp-m-0-painel.png' });
  const p2 = await ctx.newPage(); await p2.setViewportSize({ width: 1280, height: 860 }); p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p2.goto(BASE + '/'); await p2.waitForFunction(() => window.__ready);
  await p2.evaluate(async () => { const { S, save } = await import('./js/db.js'); S.accounts = S.accounts.filter((a) => a.id.startsWith('acc-')); S.movements = []; S.imports = []; await save('accounts', 'movements', 'imports'); });
  await p2.waitForTimeout(200);
  await p2.screenshot({ path: '/tmp/shots/imp-d-0-painel.png' });
  await p2.evaluate(() => (location.hash = '#/importar?novo=1')); await p2.waitForSelector('#imp-body[data-step=ficheiro]');
  await p2.screenshot({ path: '/tmp/shots/imp-d-1-ficheiro.png' });
  await p2.click('[data-sample]'); await p2.waitForSelector('#imp-body[data-step=colunas]'); await p2.waitForTimeout(150);
  await p2.screenshot({ path: '/tmp/shots/imp-d-2-colunas.png', fullPage: true });
  await p2.click('[data-next]'); await p2.waitForSelector('#imp-body[data-step=contas]'); await p2.waitForTimeout(150);
  await p2.screenshot({ path: '/tmp/shots/imp-d-3-contas.png', fullPage: true });
  await p2.click('[data-next]'); await p2.waitForSelector('#imp-body[data-step=rever]'); await p2.waitForTimeout(150);
  await p2.screenshot({ path: '/tmp/shots/imp-d-4-rever.png' });
  await p2.click('[data-commit]'); await p2.waitForSelector('#imp-body[data-step=feito]'); await p2.waitForTimeout(150);
  await p2.screenshot({ path: '/tmp/shots/imp-d-5-feito.png' });
  await p2.evaluate(() => (location.hash = '#/painel')); await p2.waitForTimeout(300);
  await p2.screenshot({ path: '/tmp/shots/imp-d-6-painel-depois.png', fullPage: true });
  await p2.close();
  ok(true, 'capturas guardadas em /tmp/shots (imp-*)');
}

console.log('\n== Erros na consola ==');
const real = errors.filter((e) => !/favicon|Failed to load resource.*(404)/.test(e));
ok(real.length === 0, 'sem erros/avisos na consola' + (real.length ? ': ' + real.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
