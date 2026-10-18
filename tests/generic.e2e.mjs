// Testes ponta-a-ponta do leitor GENÉRICO de extratos (PDF/imagem, qualquer layout) — só dados sintéticos (tests/fixtures/generate-pdf.mjs).
// Uso: BASE=http://localhost:8080 node tests/generic.e2e.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:8080';
const FX = (n) => fileURLToPath(new URL('./fixtures/' + n, import.meta.url));
const EXP = JSON.parse(readFileSync(FX('expected.json'), 'utf8')).gen;
let pass = 0, fail = 0; const errors = [];
const ok = (c, name) => { if (c) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FALHOU:', name); } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), `${name}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)})`}`);
const norm = (s) => s.replace(/\s|\u00a0|\u202f/g, ' ').replace(/ +/g, ' ').trim();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-PT', timezoneId: 'Europe/Lisbon' });
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const T = (sel) => page.locator(sel).first().innerText().then(norm);
const go = async (h) => { await page.evaluate((x) => (location.hash = x), h); await page.waitForTimeout(200); };
const state = () => page.evaluate(async () => { const { S } = await import('./js/db.js'); return JSON.parse(JSON.stringify({ accounts: S.accounts, movements: S.movements, imports: S.imports, settings: S.settings })); });
const waitStep = (s, t = 30000) => page.waitForSelector(`#imp-body[data-step=${s}]`, { timeout: t });
const openImport = async () => { await go('#/importar?novo=1'); await waitStep('ficheiro'); };
const upload = (file) => page.setInputFiles('#imp-file', FX(file));
const reachStep = async (steps) => { await page.waitForFunction((l) => l.some((s) => document.querySelector(`#imp-body[data-step=${s}]`)), steps, { timeout: 60000 }); return page.evaluate(() => document.querySelector('#imp-body').dataset.step); };

await page.goto(BASE + '/'); await page.waitForFunction(() => window.__ready);

// Leitura pelo motor (sem UI): devolve o essencial
const readFx = (name) => page.evaluate(async ({ name, b64 }) => {
  const E = await import('./js/import/engine.js');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  try {
    const src = await E.loadSource(new File([bytes], name));
    const sess = E.buildSession(src); const p = E.getParsed(src);
    return { format: src.format, ocr: !!src.ocr, metodo: p.metodo, conf: p.confianca?.nivel, bestEffort: sess.bestEffort,
      rows: sess.rows.map((r) => ({ d: r.data, v: r.valor, desc: r.desc, inc: !!r.semSinal })),
      groups: sess.groups.map((g) => ({ label: g.label, nome: g.novo.nome, tipo: g.novo.tipo, n: g.rows.length, opening: g.bal?.opening ?? null, final: g.bal?.final ?? null, diff: E.reconcile(g)?.diff ?? null, iban: g.iban, soma: g.rows.reduce((a, r) => a + r.valor, 0) })),
      secoes: (p.secoes || []).map((x) => [x.tipo, x.titulo, x.n]) };
  } catch (e) { return { error: e.message }; }
}, { name, b64: readFileSync(FX(name)).toString('base64') });
const sum = (a) => a.reduce((x, y) => x + y, 0);
const cents = (s) => Math.round(parseFloat(s.replace(/[^\d,-]/g, '').replace(',', '.')) * 100);

console.log('\n== (a) Débito/Crédito + saldo, dd/mm/aaaa ==');
{
  const r = await readFx('gen-a-debito-credito.pdf'), e = EXP.a;
  eq(r.rows.length, e.n, `${e.n} movimentos`); eq(sum(r.rows.map((x) => x.v)), e.soma, 'soma dos movimentos');
  eq(r.rows.filter((x) => x.v > 0).length, e.entradas, `${e.entradas} entradas`); eq(r.rows.filter((x) => x.v < 0).length, e.saidas, `${e.saidas} saídas`);
  eq(r.rows[0].d, e.firstDate, 'primeira data'); eq(r.rows[r.rows.length - 1].d, e.lastDate, 'última data'); eq(r.rows[r.rows.length - 1].v, e.lastValor, 'último valor (saída)');
  eq([r.groups[0].opening, r.groups[0].final, r.groups[0].diff], [e.opening, e.final, 0], 'saldo inicial, final e diferença 0'); eq(r.groups[0].iban, e.iban, 'IBAN');
  eq(r.conf, 'alta', 'confiança alta (saldos confirmam)'); ok(r.rows.every((x) => !x.inc), 'nenhum sinal incerto');
}
console.log('\n== (b) Uma coluna «Montante» com sinal, sem saldo ==');
{
  const r = await readFx('gen-b-montante-com-sinal.pdf'), e = EXP.b;
  eq(r.rows.length, e.n, `${e.n} movimentos`); eq(sum(r.rows.map((x) => x.v)), e.soma, 'soma'); eq(r.rows.filter((x) => x.v > 0).length, e.entradas, 'entradas'); eq(r.rows.filter((x) => x.v < 0).length, e.saidas, 'saídas');
  eq([r.rows[0].d, r.rows[r.rows.length - 1].d], [e.firstDate, e.lastDate], 'datas dd-mm-aaaa'); eq(r.rows[r.rows.length - 1].v, e.lastValor, 'último valor'); ok(r.rows.every((x) => !x.inc), 'sinais certos (coluna ±)');
  const b2 = await readFx('gen-b2-sem-sinal.pdf'), e2 = e.b2;
  eq(b2.rows.length, e2.n, 'b2 (sem sinal, sem saldo): movimentos'); eq(b2.rows.filter((x) => x.inc).length, e2.incertos, `b2: ${e2.incertos} linhas «sinal incerto»`);
  eq(b2.rows.map((x, i) => (e2.sinais[i] === 0 ? 0 : Math.sign(x.v))), e2.sinais, 'b2: sinais deduzidos por palavras-chave (compra, pagamento, recebida, juros, comissão…)');
  eq(b2.rows.filter((x, i) => e2.sinais[i]).map((x) => Math.abs(x.v)), e2.valores.filter((v, i) => e2.sinais[i]).map(Math.abs), 'b2: valores absolutos');
}
console.log('\n== (c) dd-mm sem ano (ano no cabeçalho), descrições em várias linhas ==');
{
  const r = await readFx('gen-c-ddmm-multilinha.pdf'), e = EXP.c;
  eq(r.rows.length, e.n, `${e.n} movimentos`); eq(r.rows.map((x) => x.desc), e.descs, 'descrições (multi-linha reunidas)');
  eq([r.rows[0].d, r.rows[r.rows.length - 1].d], [e.firstDate, e.lastDate], 'datas com o ano do período');
  eq([r.groups[0].opening, r.groups[0].final, r.groups[0].diff], [e.opening, e.final, 0], 'saldos reconciliados'); eq(r.rows.filter((x) => x.v > 0).length, e.entradas, 'entradas');
}
console.log('\n== (d) Layout inglês: «Apr 12, 2026», «-1,234.56» ==');
{
  const r = await readFx('gen-d-english-revolut.pdf'), e = EXP.d;
  eq(r.rows.length, e.n, `${e.n} movimentos`); eq(r.rows.find((x) => x.desc.startsWith('Rent'))?.v, e.rentValor, 'valor -1,234.56 (ponto decimal)');
  eq([r.rows[0].d, r.rows[r.rows.length - 1].d], [e.firstDate, e.lastDate], 'datas «Apr 12, 2026» → ISO'); eq([r.groups[0].opening, r.groups[0].final, r.groups[0].diff], [e.opening, e.final, 0], 'saldos (Balance) reconciliados');
  const r2 = await readFx('gen-d2-english-incoming-outgoing.pdf'), e2 = e.d2;
  eq(r2.rows.map((x) => x.v), e2.valores, 'd2: «Money in / Money out» → sinais certos'); eq(r2.groups[0].opening, e2.opening, 'd2: saldo inicial');
}
console.log('\n== (l,m) Espanhol com data valor; «12 abr» sem ano; CR/DB e sinal no fim ==');
{
  const r = await readFx('gen-l-espanhol.pdf'), e = EXP.l;
  eq(r.rows.map((x) => x.v), e.valores, 'l: Fecha/Fecha valor/Concepto/Importe/Saldo → valores com sinal'); eq([r.rows[0].d, r.rows[r.rows.length - 1].d], [e.firstDate, e.lastDate], 'l: usa a data do movimento (não a data valor)');
  eq([r.groups[0].opening, r.groups[0].final], [e.opening, e.final], 'l: saldos pela coluna Saldo'); eq(r.groups[0].iban, e.iban, 'l: IBAN espanhol');
  for (const f of ['gen-m-mes-curto-cr-db.pdf', 'gen-m2-sinal-no-fim.pdf']) {
    const m = await readFx(f);
    eq(m.rows.map((x) => x.v), EXP.l.m.valores, `${f}: «45,00-» / CR-DB → sinais certos`); eq([m.rows[0].d, m.rows[m.rows.length - 1].d], [EXP.l.m.firstDate, EXP.l.m.lastDate], `${f}: «03 abr» + ano do título «Abril 2026»`);
  }
}
console.log('\n== (e) Várias contas num PDF (ordem + poupança + cartão) ==');
{
  const r = await readFx('gen-e-multi-conta.pdf'), e = EXP.e;
  eq(r.groups.length, e.sections, '3 contas/secções'); eq(r.rows.length, e.total, `${e.total} movimentos no total`);
  const [o, p, c] = r.groups;
  eq([o.n, o.opening, o.final, o.diff], [e.ord.n, e.ord.opening, e.ord.final, 0], 'conta à ordem reconciliada'); eq(o.iban, e.iban1, 'IBAN da conta à ordem');
  eq([p.n, p.opening, p.final, p.diff], [e.pou.n, e.pou.opening, e.pou.final, 0], 'poupança reconciliada'); eq(p.tipo, 'poupanca', 'tipo poupança deduzido'); eq(p.iban, e.iban2, 'IBAN da poupança');
  eq([c.n, c.opening, c.final, c.diff], [e.car.n, e.car.opening, e.car.final, 0], 'cartão reconciliado'); eq(c.tipo, 'cartao', 'tipo cartão deduzido');
}
console.log('\n== (f) Extrato de cartão (compras negativas, pagamento positivo) ==');
{
  const r = await readFx('gen-f-cartao.pdf'), e = EXP.f;
  eq(r.rows.map((x) => x.v), e.valores, 'valores: compras negativas, pagamento e estorno positivos'); eq(r.groups[0].tipo, e.tipo, 'tipo cartão');
  eq([r.rows[0].d, r.rows[r.rows.length - 1].d], [e.firstDate, e.lastDate], 'datas'); eq(sum(r.rows.map((x) => x.v)), e.soma, 'soma dos movimentos');
  eq(r.groups[0].diff, 0, 'saldo anterior + movimentos = novo saldo (diferença 0)');
}
console.log('\n== (h) Texto rodado na margem + cabeçalhos repetidos em várias páginas ==');
{
  const r = await readFx('gen-h-rodado-repetido.pdf'), e = EXP.h;
  eq(r.rows.map((x) => x.desc), e.descs, `${e.n} movimentos sem lixo (cabeçalhos/rodapés repetidos e margem rodada ignorados)`);
  eq([r.groups[0].opening, r.groups[0].final, r.groups[0].diff], [e.opening, e.final, 0], 'saldos reconciliados entre páginas');
}
console.log('\n== (j,k) Colunas desconhecidas / sinal impossível de deduzir ==');
{
  const r = await readFx('gen-j-colunas-desconhecidas.pdf'), e = EXP.j;
  eq(r.rows.length, e.n, 'j: 12 movimentos lidos pela heurística (sem cabeçalho reconhecido)'); eq(r.metodo, 'heuristica', 'j: método heurístico'); eq(r.conf, 'media', 'j: confiança média (não alta)');
  const k = await readFx('gen-k-sem-sinal-neutro.pdf');
  eq(k.rows.length, EXP.k.n, 'k: movimentos lidos'); eq(k.conf, 'baixa', 'k: confiança baixa'); eq(k.rows.filter((x) => x.inc).length, EXP.k.n, 'k: todas as linhas «sinal incerto»');
}
console.log('\n== (i) PDF que não é um extrato → erro claro ==');
{
  const r = await readFx('gen-i-nao-extrato.pdf');
  ok(!!r.error && /não parece ser um extrato/.test(r.error), 'erro claro: ' + (r.error || '').slice(0, 80));
}
console.log('\n== (g) Digitalizados (OCR): PNG, JPG e PDF só com imagem ==');
for (const f of ['gen-g-digitalizado.png', 'gen-g-foto.jpg', 'gen-g-digitalizado.pdf']) {
  const r = await readFx(f), e = EXP.g;
  ok(!r.error, `${f}: lido (${r.error || 'ok'})`); if (r.error) continue;
  eq(r.ocr, true, `${f}: marcado como OCR`); eq(r.bestEffort, true, `${f}: melhor esforço`); ok(r.conf !== 'alta', `${f}: confiança nunca «alta» em OCR (${r.conf})`);
  eq(r.rows.map((x) => x.v), e.valores, `${f}: ${e.n} movimentos com valores e sinais certos`); eq([r.rows[0].d, r.rows[r.rows.length - 1].d], [e.firstDate, e.lastDate], `${f}: datas`);
  eq([r.groups[0].opening, r.groups[0].final, r.groups[0].diff], [e.opening, e.final, 0], `${f}: saldos reconciliados`);
}

console.log('\n== UI: o que foi detetado (primeiro ecrã após escolher o ficheiro) ==');
await openImport(); await upload('gen-a-debito-credito.pdf'); await waitStep('contas');
eq(await T('#imp-detected'), 'Detetei 15 movimentos de 1 conta, confiança alta.', 'frase de deteção («Detetei 15 movimentos de 1 conta, confiança alta»)');
ok(await page.locator('[data-ajustar]').isVisible(), 'botão «Ajustar leitura do PDF» visível');
ok(await page.locator('[data-ia]').count() === 0, 'sem chave de IA: sem botão «Interpretar com IA»');

console.log('\n== UI: PDF com várias contas — escolher quais importar ==');
await openImport(); await upload('gen-e-multi-conta.pdf'); await waitStep('contas');
eq(await T('#imp-detected'), 'Detetei 12 movimentos de 3 contas, confiança alta.', '12 movimentos de 3 contas');
eq(await page.locator('#imp-secs [data-sec]').count(), 3, '3 secções com caixa de seleção');
await page.locator('#imp-secs [data-sec]').nth(1).uncheck(); await page.waitForTimeout(200);
eq(await T('#imp-detected'), 'Detetei 10 movimentos de 2 contas, confiança alta.', 'sem a poupança: 10 movimentos de 2 contas');
eq(await page.locator('.imp-acc').count(), 2, 'só 2 contas para guardar');
await page.click('#imp-body [data-next]'); await waitStep('rever');
await page.locator('#imp-revisto').check(); await page.click('[data-commit]'); await waitStep('feito');
{
  const st = await state();
  eq(st.accounts.filter((a) => !['Conta à ordem', 'Dinheiro'].includes(a.nome)).length, 2, '2 contas criadas (poupança excluída)');
  eq(st.movements.length, 9, '9 movimentos guardados (o pagamento do cartão emparelha com a saída da conta: 1 transferência)'); eq(st.movements.filter((m) => m.tipo === 'transferencia').length, 1, '1 transferência detetada entre a conta e o cartão');
  ok(!st.accounts.some((a) => /poupan/i.test(a.nome)), 'a poupança não foi importada');
  const card = st.accounts.find((a) => a.tipo === 'cartao'); ok(!!card, 'conta de cartão criada com tipo cartão');
}

console.log('\n== UI: PDF que não é extrato / digitalizado ==');
await openImport(); await upload('gen-i-nao-extrato.pdf'); await page.waitForFunction(() => document.querySelector('#imp-msg')?.textContent.includes('❌'), null, { timeout: 20000 });
ok(/não parece ser um extrato/.test(await T('#imp-msg')), 'mensagem clara no ecrã do ficheiro'); eq(await page.locator('#imp-body').getAttribute('data-step'), 'ficheiro', 'fica no passo do ficheiro');
await openImport(); await upload('gen-g-foto.jpg'); await waitStep('contas');
ok((await T('#imp-detect')).includes('OCR'), 'foto: o cartão de deteção diz que foi lido por OCR'); ok(!(await T('#imp-detected')).includes('confiança alta'), 'foto: nunca «confiança alta»');
await page.click('#imp-body [data-next]'); await waitStep('rever');
ok((await T('#imp-besteffort')).includes('OCR') && (await T('#imp-besteffort')).includes('melhor esforço'), 'revisão: aviso OCR «melhor esforço»');
ok(await page.locator('[data-commit]').isDisabled(), 'não deixa importar sem confirmar a revisão'); await page.locator('#imp-revisto').check(); ok(await page.locator('[data-commit]').isEnabled(), 'confirma a revisão → pode importar');

console.log('\n== UI: baixa confiança → vai direto para «Ajustar leitura do PDF» ==');
await openImport(); await upload('gen-k-sem-sinal-neutro.pdf');
eq(await reachStep(['pdfajuste', 'contas']), 'pdfajuste', 'confiança baixa encaminha para o passo de ajuste');
ok((await T('#imp-ajuste')).includes('Não tenho confiança suficiente'), 'explica porquê'); ok(await page.locator('#aj-table').isVisible(), 'mostra a pré-visualização das linhas/colunas');
await page.locator('[name=aj-lembrar]').uncheck(); await page.click('[data-aj-next]'); await waitStep('contas'); await page.click('#imp-body [data-next]'); await waitStep('rever');
eq(await page.locator('.irow .chip:has-text("Sinal incerto")').count(), EXP.k.n, 'revisão: linhas marcadas «Sinal incerto»');

console.log('\n== UI: ajuste manual das colunas + layout lembrado (extratos seguintes do mesmo banco) ==');
await openImport(); await upload('gen-j-colunas-desconhecidas.pdf'); await waitStep('contas');
{
  const first = await page.evaluate(async () => { const { S } = await import('./js/db.js'); void S; return 0; }); void first;
  ok((await T('#imp-detected')).includes('confiança média'), 'extrato j: confiança média (colunas «Recebi/Gastei» não reconhecidas)');
  await page.click('[data-ajustar]'); await waitStep('pdfajuste');
  const roles = await page.locator('[data-aj-role]').evaluateAll((els) => els.map((e) => e.value));
  ok(roles.includes('debit') && roles.includes('credit') && roles.includes('date') && roles.includes('desc'), 'colunas propostas: data, descrição, débito, crédito (' + roles.join(',') + ')');
  const di = roles.indexOf('debit'), ci = roles.indexOf('credit');
  const cnt0 = await T('#aj-count'); ok(cnt0.includes('12 movimentos'), 'pré-visualização: 12 movimentos');
  const ent0 = cents((await T('#aj-count')).match(/entradas ([^·]+)/)[1]);
  eq(ent0, 4321 + 2750 + 1999 + 8400 + 320 + 3500 + 1250 + 2290 + 5675, 'inicialmente as entradas estão trocadas com as saídas (coluna esquerda lida como débito)');
  await page.locator('[data-aj-role]').nth(di).selectOption('credit'); await page.locator('[data-aj-role]').nth(ci).selectOption('debit'); await page.waitForTimeout(150);
  const ent1 = cents((await T('#aj-count')).match(/entradas ([^·]+)/)[1]);
  eq(ent1, 150000 + 6000 + 2500, 'depois de trocar os papéis: entradas = ordenado + 2 transferências');
  // ignorar uma linha (a primeira do corpo)
  const sig0 = await page.locator('[data-aj-skip]').nth(await page.locator('#aj-table tr.txt').count() ? 0 : 0).getAttribute('data-aj-skip'); ok(typeof sig0 === 'string', 'linhas com caixa «ignorar»');
  await page.click('[data-aj-next]'); await waitStep('contas');
  eq(await T('#imp-detected'), 'Detetei 12 movimentos de 1 conta, confiança média.', 'depois do ajuste: 12 movimentos');
  ok((await T('#imp-detect')).includes('Leitura ajustada por si'), 'indica «Leitura ajustada por si»');
  await page.click('#imp-body [data-next]'); await waitStep('rever');
  const sums = await page.evaluate(() => [...document.querySelectorAll('.irow .amt')].map((e) => e.className.includes('pos') ? 1 : -1));
  eq(sums.filter((x) => x > 0).length, 3, 'revisão: 3 entradas'); await page.locator('#imp-revisto').check(); await page.click('[data-commit]'); await waitStep('feito');
  await page.waitForFunction(async () => { const { S } = await import('./js/db.js'); return Object.keys(S.settings.importLayouts || {}).length > 0; }, null, { timeout: 5000 }).catch(() => {});
  const st = await state(); ok(Object.keys(st.settings.importLayouts || {}).length >= 1, 'layout guardado em Definições (importLayouts)');
  ok(!JSON.stringify(st.settings.importLayouts).includes('MERCADO'), 'o layout guardado não contém texto do extrato (só colunas/formatos)');
  // 2.º extrato do mesmo banco: aplicado automaticamente
  await openImport();
  ok((await T('#imp-layouts')).includes('Layouts de leitura guardados (1)'), 'lista de layouts guardados no ecrã inicial');
  await upload('gen-j2-colunas-desconhecidas-abril.pdf'); await waitStep('contas');
  ok((await T('#imp-detect')).includes('Layout guardado aplicado'), '2.º extrato: «Layout guardado aplicado» (sem ajustes manuais)');
  eq(await T('#imp-detected'), 'Detetei 6 movimentos de 1 conta, confiança média.', '2.º extrato: 6 movimentos');
  await page.click('#imp-body [data-next]'); await waitStep('rever');
  eq(await page.evaluate(() => [...document.querySelectorAll('.irow .amt')].map((e) => (e.className.includes('pos') ? 1 : -1)).join('')), '-1' + '1' + '-1-1' + '1' + '-1', 'sinais certos no 2.º extrato (colunas lembradas)');
  await page.goBack().catch(() => {});
}
console.log('\n== UI: esquecer um layout guardado ==');
await openImport();
await page.click('#imp-layouts summary'); await page.click('[data-forget-layout]'); await page.waitForTimeout(250);
eq(await page.locator('#imp-layouts').count(), 0, 'layout esquecido (lista desaparece)'); eq(Object.keys((await state()).settings.importLayouts).length, 0, 'removido das definições');

console.log('\n== CSV/Excel: mapeamento de colunas lembrado ==');
{
  const mk = (rows) => ['Quando;Texto;Gastei;Recebi', ...rows].join('\n');
  const csv1 = mk(['02/03/2026;MERCADO ZETA;43,21;', '03/03/2026;EMPRESA OMEGA;;1500,00', '05/03/2026;LOJA KAPPA;27,50;', '08/03/2026;SERVICO LAMBDA;19,99;']);
  const csv2 = mk(['02/04/2026;MERCADO UPSILON;38,90;', '04/04/2026;EMPRESA OMEGA;;1500,00', '06/04/2026;LOJA FI;15,00;']);
  await openImport(); await page.setInputFiles('#imp-file', { name: 'zeta-marco.csv', mimeType: 'text/csv', buffer: Buffer.from(csv1) }); await waitStep('colunas');
  ok(await page.locator('#imp-saved').count() === 0, 'primeira vez: sem mapeamento guardado');
  await page.locator('input[name=m-modo][value=split]').check({ force: true }).catch(() => {}); await page.waitForTimeout(100);
  const m0 = await page.evaluate(() => ({ d: document.querySelector('[name=m-debito]').value, c: document.querySelector('[name=m-credito]').value, modo: document.querySelector('input[name=m-modo]:checked').value }));
  await page.selectOption('[name=m-debito]', '2'); await page.selectOption('[name=m-credito]', '3'); await page.waitForTimeout(150); void m0;
  ok((await T('#imp-preview')).includes('4 movimentos'), 'com Débito=Gastei e Crédito=Recebi: 4 movimentos');
  await page.click('#imp-body [data-next]'); await waitStep('contas');
  await page.waitForFunction(async () => { const { S } = await import('./js/db.js'); return Object.keys(S.settings.importLayouts || {}).some((k) => /^c0?:/.test(k)); }, null, { timeout: 5000 }).catch(() => {});
  ok(Object.keys((await state()).settings.importLayouts).some((k) => /^c0?:/.test(k)), 'mapeamento CSV guardado (impressão digital dos cabeçalhos)');
  await openImport(); await page.setInputFiles('#imp-file', { name: 'zeta-abril.csv', mimeType: 'text/csv', buffer: Buffer.from(csv2) }); await waitStep('colunas');
  ok(await page.locator('#imp-saved').isVisible(), '2.º CSV: «Apliquei o mapeamento guardado»');
  ok((await T('#imp-preview')).includes('3 movimentos'), '2.º CSV: 3 movimentos sem mexer em nada');
  eq(await page.evaluate(() => [...document.querySelectorAll('#imp-preview td.r.pos, #imp-preview td.r.neg')].filter((e) => e.className.includes('pos')).length), 1, '2.º CSV: 1 entrada e as restantes saídas');
  await page.click('[data-no-saved]'); await page.waitForTimeout(300);
  ok(await page.locator('#imp-saved').count() === 0, '«Usar a deteção automática» ignora o layout guardado');
}

console.log('\n== IA opcional (endpoint simulado) ==');
{
  await page.evaluate(async () => { const { S, save } = await import('./js/db.js'); S.settings.ia = { url: location.origin + '/mock-ia/v1', modelo: 'teste', chave: 'chave-de-teste' }; await save('settings'); });
  const reqs = []; let mode = 'ok';
  const movs = [['2026-03-02', 'MERCADO ZETA CENTRAL', -43.21], ['2026-03-03', 'EMPRESA OMEGA LDA', 1500], ['2026-03-05', 'LOJA KAPPA 1', -27.5], ['2026-03-08', 'SERVICO LAMBDA 22', -19.99], ['2026-03-10', 'CLIENTE MU TESTE', 60]];
  await page.route('**/mock-ia/v1/chat/completions', async (route) => {
    reqs.push({ body: route.request().postData(), auth: route.request().headers().authorization });
    if (mode === 'ok') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '```json\n' + JSON.stringify({ accounts: [{ title: 'Conta Zeta', type: 'checking', iban_last4: '0001', currency: 'EUR', opening_balance: null, closing_balance: null, movements: movs.map(([date, description, amount]) => ({ date, description, amount, balance: null })).concat([{ date: '2026-13-45', description: 'LINHA INVÁLIDA', amount: 5, balance: null }]) }] }) + '\n```' } }] }) });
    if (mode === 'bad-json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Desculpe, não consegui.' } }] }) });
    if (mode === 'empty') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ accounts: [{ title: 'x', movements: [] }] }) } }] }) });
    if (mode === '401') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"bad key"}' });
    return route.fulfill({ status: 500, body: 'erro' });
  });
  await openImport(); await upload('gen-j-colunas-desconhecidas.pdf'); await waitStep('contas');
  ok(await page.locator('[data-ia]').isVisible(), 'com chave configurada: botão «Interpretar com IA»');
  // recusar a confirmação: nada é enviado
  await page.click('[data-ia]'); await page.waitForSelector('.modal [data-yes], [data-yes]');
  const msg = await page.locator('[data-yes]').locator('xpath=ancestor::*[contains(@class,"modal") or @role="dialog"][1]').innerText().catch(() => '');
  ok(/PRIVACIDADE/.test(msg) && /localhost/.test(msg) && /ENVIADO/.test(msg), 'aviso de privacidade explícito com o destino (host) e confirmação');
  await page.click('[data-no]'); await page.waitForTimeout(300);
  eq(reqs.length, 0, 'cancelar: nenhum pedido enviado');
  // erros degradam com elegância (e continua a leitura automática)
  for (const [m, re] of [['bad-json', /não devolveu JSON válido/], ['empty', /nenhum movimento válido/], ['401', /recusou a chave/], ['500', /erro 500/]]) {
    mode = m; await page.click('[data-ia]'); await page.click('[data-yes]'); await page.waitForSelector('#imp-ai-msg .hint.warn', { timeout: 10000 });
    ok(re.test(await T('#imp-ai-msg')), `erro «${m}» → mensagem clara: ` + (await T('#imp-ai-msg')).slice(0, 90));
    eq(await page.locator('#imp-body').getAttribute('data-step'), 'contas', `erro «${m}»: continua no passo Contas com a leitura automática`);
  }
  eq(reqs.length, 4, 'um pedido por confirmação (4 tentativas)');
  ok(!reqs[0].body.includes('PT50 9999 0011 0000 0000 0000 1') && !reqs[0].body.includes('PT50999900110000000000001') && reqs[0].body.includes('…0001'), 'o IBAN completo não é enviado (só os 4 últimos dígitos)');
  ok(reqs[0].auth === 'Bearer chave-de-teste', 'chave enviada no cabeçalho Authorization'); ok(reqs[0].body.includes('MERCADO ZETA CENTRAL'), 'envia o texto do extrato');
  // sucesso
  mode = 'ok'; await page.click('[data-ia]'); await page.click('[data-yes]'); await page.waitForFunction(() => document.querySelector('#imp-detect')?.textContent.includes('Interpretado por IA'), null, { timeout: 15000 });
  eq(await T('#imp-detected'), 'Detetei 5 movimentos de 1 conta, confiança média.', 'IA: 5 movimentos válidos (1 linha inválida descartada), nunca «alta»');
  await page.click('#imp-body [data-next]'); await waitStep('rever');
  ok((await T('#imp-besteffort')).includes('Interpretado por IA'), 'revisão: aviso «Interpretado por IA — melhor esforço»'); ok(/ignorada/.test(await T('.hint.warn:has-text("inválidos")').catch(() => '')) || (await T('#imp-body')).includes('inválidos'), 'aviso das linhas inválidas');
  ok(await page.locator('[data-commit]').isDisabled(), 'IA: exige confirmar a revisão antes de importar');
  eq(await page.evaluate(() => [...document.querySelectorAll('.irow .amt')].map((e) => (e.className.includes('pos') ? 1 : -1)).join('')), '-1' + '1' + '-1-1' + '1', 'sinais da IA respeitados');
  await page.click('[data-back]'); await waitStep('contas'); await page.click('[data-ia-off]'); await page.waitForTimeout(200);
  eq(await T('#imp-detected'), 'Detetei 12 movimentos de 1 conta, confiança média.', '«Voltar à leitura automática» restaura os 12 movimentos');
  await page.unroute('**/mock-ia/v1/chat/completions');
  // sem chave: o botão desaparece
  await page.evaluate(async () => { const { S, save } = await import('./js/db.js'); S.settings.ia.chave = ''; await save('settings'); });
  await openImport(); await upload('gen-j-colunas-desconhecidas.pdf'); await waitStep('contas');
  eq(await page.locator('[data-ia]').count(), 0, 'sem chave: sem botão de IA');
}

console.log('\n== Pré-cache offline dos módulos novos ==');
{
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys.find((k) => k.startsWith('financas-'))); return (await c.keys()).map((r) => new URL(r.url).pathname); });
  for (const m of ['layout.js', 'tokens.js', 'ai.js', 'pdfstatement.js', 'loaders.js']) ok(cached.some((p) => p.endsWith('/js/import/' + m)), `${m} em pré-cache`);
  ok(cached.some((p) => p.includes('/vendor/tesseract/')), 'tesseract.js (OCR) em pré-cache');
}

console.log('\n== Erros na consola ==');
const real = errors.filter((e) => !/favicon|Failed to load resource.*(404|401|500)/.test(e));
ok(real.length === 0, 'sem erros/avisos na consola' + (real.length ? ': ' + real.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
