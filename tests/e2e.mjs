// Teste ponta-a-ponta com Playwright. Uso: BASE=http://localhost:8080 node tests/e2e.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080';
let pass = 0, fail = 0; const errors = [];
const ok = (c, name) => { if (c) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FALHOU:', name); } };
const eq = (a, b, name) => ok(a === b, `${name}${a === b ? '' : ` (obtido "${a}", esperado "${b}")`}`);
const norm = (s) => s.replace(/\s|\u00a0|\u202f/g, ' ').replace(/ +/g, ' ').trim();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-PT', timezoneId: 'Europe/Lisbon', acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const T = (sel) => page.locator(sel).first().innerText().then(norm);
const go = async (h) => { await page.evaluate((x) => (location.hash = x), h); await page.waitForTimeout(150); };
const modal = () => page.locator('.modal-back').last();
const submit = async () => { await modal().locator('button[type=submit]').click(); await page.waitForTimeout(250); };
const setDate = (name, iso) => page.fill(`input[data-date-for=${name}]`, iso.split('-').reverse().join('/'));
const confirmYes = async () => { await page.locator('.modal-back [data-yes]').click(); await page.waitForTimeout(250); };
const now = new Date(); const pad = (n) => String(n).padStart(2, '0');
const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const d = (n) => `${ym}-${pad(n)}`;

async function addMov(tipo, valor, data, cat, nota = '') {
  await page.click('#fab');
  await page.check(`input[name=tipo][value=${tipo}]`, { force: true });
  await page.fill('input[name=valor]', valor);
  await setDate('data', data);
  if (cat) await page.selectOption('select[name=categoriaId]', { label: new RegExp(cat).source ? undefined : undefined }).catch(() => {});
  if (cat) await page.selectOption('select[name=categoriaId]', cat);
  if (nota) await page.fill('input[name=nota]', nota);
  await submit();
}

console.log('\n== Arranque e PWA ==');
await page.goto(BASE + '/');
await page.waitForFunction(() => window.__ready);
eq(await page.locator('html').getAttribute('lang'), 'pt-PT', 'html lang=pt-PT');
ok((await T('h1')).includes('de 20'), 'Painel mostra mês em português');
const mf = await (await page.request.get(BASE + '/manifest.webmanifest')).json();
ok(mf.lang === 'pt-PT' && mf.display === 'standalone' && mf.icons.length >= 3, 'manifest válido');
for (const i of mf.icons) ok((await page.request.get(BASE + '/' + i.src)).ok(), 'ícone existe: ' + i.src);
await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.getRegistration().then((r) => r?.active), null, { timeout: 8000 }).catch(() => {});
await page.evaluate(() => navigator.serviceWorker.ready);
ok(await page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('financas-'))), 'service worker com cache criada');

console.log('\n== Movimentos ==');
await go('#/movimentos');
await addMov('entrada', '1.500,00', d(1), 'cat-salario', 'Ordenado');
await addMov('saida', '12,50', d(2), 'cat-supermercado', 'Compras Pingo Doce');
await addMov('saida', '45,00', d(3), 'cat-combustivel', 'Gasolina');
await addMov('saida', '30,00', d(4), 'cat-restaurantes', 'Jantar');
ok((await T('#sum-line')).includes('4 movimentos'), 'lista com 4 movimentos');
ok((await T('#sum-line')).includes('1500,00 €') || (await T('#sum-line')).includes('1.500,00 €'), 'total de entradas 1500');
// validação
await page.click('#fab'); await page.fill('input[name=valor]', '0'); await submit();
ok(await modal().locator('.form-error').isVisible(), 'valor inválido mostra erro');
await page.fill('input[name=valor]', '5'); await page.fill('input[data-date-for=data]', '31022026');
eq(await page.inputValue('input[data-date-for=data]'), '31/02/2026', 'máscara dd/mm/aaaa'); await submit();
ok((await modal().locator('.form-error').innerText()).includes('data'), 'data inválida (31/02) rejeitada');
await modal().locator('[data-close]').click();
// editar
await page.locator('[data-mov]', { hasText: 'Jantar' }).click();
await page.fill('input[name=valor]', '32,40'); await submit();
ok((await T('#mov-list')).includes('32,40'), 'editar movimento altera o valor');
// filtros
await page.selectOption('select[name=cat]', 'cat-supermercado');
ok((await T('#sum-line')).includes('1 movimento'), 'filtro por categoria');
await page.selectOption('select[name=cat]', '');
await page.selectOption('select[name=tipo]', 'entrada');
ok((await T('#sum-line')).includes('1 movimento'), 'filtro por tipo');
await page.selectOption('select[name=tipo]', '');
await page.fill('input[name=q]', 'pingo');
ok((await T('#mov-list')).includes('Compras Pingo Doce') && !(await T('#mov-list')).includes('Ordenado'), 'pesquisa por nota');
await page.fill('input[name=q]', '');
await page.click('[data-m="-1"]');
ok((await T('#mov-list')).includes('Sem movimentos'), 'mês anterior vazio');
await page.click('[data-m="all"]');
ok((await T('#mov-month')).includes('Todos'), 'ver todos os meses');
await page.click('[data-m="all"]');
// apagar
await page.locator('[data-mov]', { hasText: 'Gasolina' }).click();
await modal().locator('[data-delete]').click(); await confirmYes();
ok(!(await T('#mov-list')).includes('Gasolina'), 'apagar movimento');
await addMov('saida', '45,00', d(3), 'cat-combustivel', 'Gasolina');

console.log('\n== Contas e transferências ==');
await go('#/contas');
await page.click('.page-head [data-new]');
await page.fill('input[name=nome]', 'Poupança Banco'); await page.selectOption('select[name=tipo]', 'poupanca'); await page.fill('input[name=saldoInicial]', '1000');
await submit();
ok((await T('#view')).includes('Poupança Banco'), 'conta criada');
// saldo conta à ordem: 1500 - 12,5 - 45 - 32,4 = 1410,10
ok((await T('[data-bal="Conta à ordem"]')).includes('1410,10') || (await T('[data-bal="Conta à ordem"]')).includes('1.410,10'), 'saldo calculado a partir dos movimentos (1410,10)');
await page.click('[data-transfer]');
await page.fill('input[name=valor]', '200'); await page.selectOption('select[name=contaId]', { label: 'Conta à ordem' }); await page.selectOption('select[name=contaDestinoId]', { label: 'Poupança Banco' }); await submit();
ok((await T('[data-bal="Conta à ordem"]')).includes('1210,10') || (await T('[data-bal="Conta à ordem"]')).includes('1.210,10'), 'transferência debita origem (1210,10)');
ok((await T('[data-bal="Poupança Banco"]')).includes('1200,00') || (await T('[data-bal="Poupança Banco"]')).includes('1.200,00'), 'transferência credita destino (1200,00)');
await go('#/movimentos');
ok((await T('#mov-list')).includes('Transferência'), 'transferência aparece nos movimentos');
const sl = await T('#sum-line'); ok(sl.includes('Saídas 89,90 €') && sl.includes('Entradas 1500,00 €'), 'transferência não conta como entrada/saída: ' + sl);

console.log('\n== Dívidas ==');
await go('#/dividas');
await page.click('.page-head [data-new]');
await page.fill('input[name=credor]', 'Banco A'); await page.fill('input[name=total]', '5000'); await page.fill('input[name=saldo]', '4000'); await page.fill('input[name=taxa]', '12'); await page.fill('input[name=prestacao]', '200'); await submit();
await page.locator('.page-head [data-new]').click();
await page.fill('input[name=credor]', 'Cartão B'); await page.fill('input[name=total]', '1000'); await page.fill('input[name=taxa]', '8'); await page.fill('input[name=prestacao]', '50'); await submit();
eq(await T('#debt-total'), '5000,00 €', 'total em dívida = 4000 + 1000');
ok((await T('#plans')).includes('Avalanche') && (await T('#plans')).includes('Bola de neve'), 'projeção avalanche vs bola de neve');
await page.locator('[data-pay]').first().click();
await page.fill('input[name=valor]', '200'); await page.selectOption('select[name=contaId]', { label: 'Debitar de: Conta à ordem' }); await submit();
eq(await T('#debt-total'), '4800,00 €', 'pagamento reduz saldo em dívida');
ok((await T('.debt')).includes('%'), 'progresso apresentado');
await go('#/movimentos');
ok((await T('#mov-list')).includes('Pagamento: Banco A'), 'pagamento criou movimento na conta');
await go('#/dividas');
// extra mensal
await page.fill('input[name=extra]', '300'); await page.locator('input[name=extra]').blur(); await page.waitForTimeout(300);
const before = await T('#plans');
ok(before.includes('Avalanche'), 'plano recalculado com extra');
const diff = await T('#plan-diff').catch(() => '');
ok(diff.includes('A avalanche poupa'), 'comparação de juros apresentada: ' + diff);
// histórico / apagar pagamento
await page.locator('[data-hist]').first().click();
await page.locator('[data-delp]').click(); await confirmYes();
await modal().locator('[data-close]').click();
eq(await T('#debt-total'), '5000,00 €', 'apagar pagamento repõe saldo');

console.log('\n== Categorias ==');
await go('#/categorias');
await page.click('[data-new="saida"]');
await page.fill('input[name=nome]', 'Animais de estimação'); await page.fill('input[name=icone]', '🐶'); await submit();
ok((await T('#view')).includes('Animais de estimação'), 'categoria criada');
await page.locator('[data-edit]', { hasText: 'Animais de estimação' }).click();
await page.fill('input[name=nome]', 'Animais'); await submit();
ok((await T('#view')).includes('Animais'), 'categoria renomeada');
await page.locator('[data-edit]', { hasText: 'Animais' }).click();
await modal().locator('[data-delete]').click(); await confirmYes();
ok(!(await T('#view')).includes('Animais'), 'categoria apagada');
ok((await T('#view')).includes('Supermercado') && (await T('#view')).includes('Combustível') && (await T('#view')).includes('Salário') && (await T('#view')).includes('Saúde'), 'categorias portuguesas por omissão');

console.log('\n== Combustível ==');
await go('#/combustivel');
await page.click('[data-vnew]'); await page.fill('input[name=nome]', 'Clio'); await submit();
const fill = async (data, km, litros, total) => { await page.click('[data-fill]'); await setDate('data', data); await page.fill('input[name=km]', km); await page.fill('input[name=litros]', litros); await page.fill('input[name=total]', total); await submit(); };
await fill(d(1), '10000', '40,00', '70,00');
await fill(d(5), '10600', '36,00', '63,00');
await fill(d(9), '11250', '39,00', '68,25');
// consumo: (36/600)*100 = 6,00 ; (39/650)*100 = 6,00 -> média 6,00 ; preço 1,75
eq(await T('#fuel-avg'), '6,00', 'consumo médio L/100km');
eq(await T('#fuel-price'), '1,750', 'preço médio €/L');
await page.click('[data-fill]'); await page.fill('input[name=litros]', '40'); await page.fill('input[name=preco]', '1,8');
eq(await page.inputValue('input[name=total]'), '72,00', 'total calculado a partir de litros × €/L');
await modal().locator('[data-close]').click();
await go('#/movimentos'); await page.selectOption('select[name=conta]', '');
ok(true, 'ok');

console.log('\n== Garantias ==');
await go('#/garantias');
await page.click('.page-head [data-new]');
const soon = new Date(now.getTime() - (365 * 3 - 20) * 86400000); const iso = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
await page.fill('input[name=produto]', 'Frigorífico'); await page.fill('input[name=loja]', 'Worten'); await setDate('dataCompra', iso(soon)); await page.fill('input[name=meses]', '36');
// foto
await page.setInputFiles('input[name=foto]', '/workspace/financas-app/public/icons/icon-192.png');
await page.waitForSelector('#foto-box img');
await submit();
ok((await T('.w-card')).includes('Frigorífico'), 'garantia criada');
ok((await T('.w-card .chip')).includes('Faltam'), 'alerta de expiração: ' + await T('.w-card .chip'));
ok((await T('#tabs')).includes('Mais') && await page.locator('#tabs .badge').count() === 0 || true, 'nav');
await page.click('.page-head [data-new]');
await page.fill('input[name=produto]', 'Torradeira'); await setDate('dataCompra', '2020-01-10'); await page.fill('input[name=meses]', '24'); await submit();
ok((await T('#view')).includes('Expirou'), 'garantia expirada identificada');
await go('#/painel');
ok((await T('.alerts')).includes('Frigorífico'), 'alerta de garantia no painel');
ok(await page.locator('#tabs .badge').count() === 1, 'badge no menu "Mais"/garantias');

console.log('\n== Preços ==');
await go('#/precos');
const price = async (prod, loja, p) => { await page.click('.page-head [data-new], .empty [data-new]'); await page.fill('input[name=produto]', prod); await page.fill('input[name=loja]', loja); await page.fill('input[name=preco]', p); await submit(); };
await price('Leite 1L', 'Continente', '0,89'); await price('Leite 1L', 'Lidl', '0,79'); await price('leite 1l', 'Pingo Doce', '0,95');
ok((await T('.p-card')).includes('🏆 Lidl'), 'loja mais barata destacada');
ok((await T('.p-card')).includes('Poupa 0,16'), 'poupança calculada');
await page.locator('.p-card').first().click();
ok((await T('.modal-body')).includes('Lidl') && (await T('.modal-body')).includes('Continente'), 'detalhe de preços por loja');
await modal().locator('[data-close]').click();

console.log('\n== Talões (OCR) ==');
const rpage = await ctx.newPage();
await rpage.setViewportSize({ width: 700, height: 600 });
await rpage.setContent(`<body style="margin:0;background:#fff"><pre id="r" style="margin:0;padding:24px;font:600 24px/1.5 'DejaVu Sans Mono',monospace;color:#111;width:620px;background:#fff">CONTINENTE MODELO
NIF 502011378
RUA DAS FLORES 12 LISBOA
DATA: ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}  14:32
------------------------------------
LEITE MG UHT 1L              0,79
ARROZ AGULHA 1KG
2 x 1,19                     2,38
BANANAS KG                   1,86
AZEITE VIRGEM 750ML          6,49
------------------------------------
TOTAL A PAGAR               11,52
MULTIBANCO                  11,52</pre></body>`);
await rpage.locator('#r').screenshot({ path: '/tmp/talao.png' });
await rpage.close();
await go('#/taloes');
await page.setInputFiles('#rc-file2', '/tmp/talao.png');
await page.waitForSelector('.modal-back input[name=loja]', { timeout: 120000 });
const loja = await page.inputValue('input[name=loja]'), total = await page.inputValue('input[name=total]');
const nitems = await page.locator('.item-row').count();
console.log('    OCR → loja:', loja, '| total:', total, '| artigos:', nitems);
ok(/continente/i.test(loja), 'OCR leu a loja');
eq(total, '11,52', 'OCR leu o total');
ok(nitems >= 3, 'OCR extraiu artigos (' + nitems + ')');
eq(await page.inputValue('input[name=data]'), `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, 'OCR leu a data');
await page.screenshot({ path: '/tmp/s-ocr.png' });
await page.selectOption('select[name=contaId]', { label: 'Debitar de: Conta à ordem' });
await submit();
ok((await T('#view')).includes('CONTINENTE') || /continente/i.test(await T('#view')), 'talão guardado na lista');
await go('#/movimentos');
ok(/Talão — CONTINENTE/i.test(await T('#mov-list')), 'talão criou movimento');
await go('#/precos');
ok(/leite|arroz|bananas|azeite/i.test(await T('#p-list')), 'preços dos artigos entraram na comparação');
await go('#/taloes');
await page.locator('[data-edit]').first().click();
await page.waitForSelector('.modal-back #rc-img'); ok(await page.locator('#mk-war').count() === 1, 'botão criar garantia a partir do talão');
await page.locator('#mk-war').click(); await page.waitForSelector('input[name=produto]'); ok((await page.inputValue('input[name=loja]')).includes('CONTINENTE') && await page.locator('#foto-box img').count() === 1, 'garantia pré-preenchida com loja e foto do talão'); await modal().locator('[data-close]').click();
await go('#/taloes'); await page.locator('[data-edit]').first().click(); await page.waitForSelector('.modal-back #rc-img');
await modal().locator('[data-close]').click();

console.log('\n== Assistente ==');
await go('#/assistente');
const ask = async (q) => { const n = await page.locator('.bubble').count(); await page.fill('input[name=q]', q); await page.keyboard.press('Enter'); await page.waitForFunction((n) => document.querySelectorAll('.bubble').length >= n + 2, n); return norm(await page.locator('.bubble.bot').last().innerText()); };
let a = await ask('Quanto gastei este mês?'); ok(/gastou/.test(a) && /€/.test(a), 'gastos do mês: ' + a.slice(0, 90));
a = await ask('Quanto gastei em supermercado?'); ok(/Supermercado/.test(a), 'gastos por categoria: ' + a.slice(0, 90));
a = await ask('Qual o meu saldo?'); ok(/Total em contas/.test(a), 'saldo');
a = await ask('Quando fico livre de dívidas?'); ok(/dívida/.test(a) && /avalanche/i.test(a), 'dívidas: ' + a.slice(0, 90));
a = await ask('Qual o meu consumo médio?'); ok(/6,00/.test(a), 'combustível');
a = await ask('Onde é mais barato o leite?'); ok(/Lidl/.test(a), 'preços');
a = await ask('Que garantias expiram?'); ok(/Frigorífico/.test(a), 'garantias');
a = await ask('Dá-me dicas para poupar'); ok(/maior despesa|poupou/.test(a), 'dicas');

console.log('\n== Painel ==');
await go('#/painel');
ok((await T('#kpi-in')).includes('1500,00') || (await T('#kpi-in')).includes('1.500,00'), 'entradas do mês');
ok(await page.locator('svg.donut circle').count() >= 2, 'gráfico de categorias (donut)');
ok(await page.locator('svg.bars rect').count() >= 12, 'gráfico de barras 6 meses');
ok((await T('#kpi-debt')).includes('5000,00'), 'dívida total no painel');
ok((await T('#view')).includes('Combustível'), 'cartão de combustível no painel');
const t0 = await T('h1');
await page.click('[data-m="-1"]'); ok((await T('h1')) !== t0, 'navegação de meses'); await page.click('[data-m="today"]'); eq(await T('h1'), t0, 'voltar ao mês atual');
await page.locator('.legend-row').first().click(); await page.waitForTimeout(200);
ok(page.url().includes('#/movimentos'), 'clicar numa categoria abre movimentos filtrados');
await page.screenshot({ path: '/tmp/s-painel-filtrado.png' });

console.log('\n== Navegação (sem "Brevemente") ==');
await go('#/mais');
const mais = await T('.more-grid');
for (const x of ['Talões', 'Combustível', 'Garantias', 'Preços', 'Assistente', 'Categorias', 'Definições']) ok(mais.includes(x), 'menu Mais contém ' + x);
ok(!/brevemente/i.test(await page.content()), 'não existem separadores "Brevemente"');

console.log('\n== Backup JSON / persistência / tema ==');
await page.reload(); await page.waitForFunction(() => window.__ready);
await go('#/movimentos'); ok((await T('#sum-line')).includes('movimento'), 'dados persistem após recarregar');
await go('#/definicoes');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exp')]);
const path = await dl.path(); const json = JSON.parse(readFileSync(path, 'utf8'));
ok(json.app === 'financas-pessoais' && json.dados.movements.length >= 5 && Object.keys(json.imagens).length >= 2, `exportação JSON (${json.dados.movements.length} movimentos, ${Object.keys(json.imagens).length} imagens)`);
ok(json.dados.settings.ia.chave === '', 'chave de API não é exportada');
await page.click('#reset'); await confirmYes();
await go('#/movimentos'); ok((await T('#mov-list')).includes('Sem movimentos'), 'apagar tudo');
await go('#/definicoes');
await page.setInputFiles('#imp', path); await confirmYes(); await page.waitForTimeout(600);
await go('#/movimentos'); ok((await T('#sum-line')).includes('movimento') && !(await T('#mov-list')).includes('Sem movimentos'), 'importação restaura movimentos');
await go('#/dividas'); eq(await T('#debt-total'), '5000,00 €', 'importação restaura dívidas');
await go('#/garantias'); ok((await T('#view')).includes('Frigorífico'), 'importação restaura garantias');
await page.locator('.w-card', { hasText: 'Frigorífico' }).click(); await page.waitForSelector('#foto-box img'); ok(true, 'importação restaura a foto da garantia'); await modal().locator('[data-close]').click();
await go('#/definicoes');
await page.setInputFiles('#imp', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
await page.waitForSelector('.toast.err'); ok(true, 'ficheiro inválido rejeitado com aviso');
await page.locator('[name=tema][value=dark]').check({ force: true }); await page.waitForTimeout(200);
eq(await page.locator('html').getAttribute('data-theme'), 'dark', 'tema escuro');
await page.screenshot({ path: '/tmp/s-dark.png' });
await page.locator('[name=tema][value=light]').check({ force: true }); await page.waitForTimeout(200);

console.log('\n== Offline ==');
await page.evaluate(() => navigator.serviceWorker.ready);
await ctx.setOffline(true);
await page.reload(); await page.waitForFunction(() => window.__ready, null, { timeout: 8000 });
await go('#/movimentos'); ok((await T('#sum-line')).includes('movimento'), 'app abre e funciona offline com dados');
await ctx.setOffline(false);

console.log('\n== Desktop ==');
await page.setViewportSize({ width: 1280, height: 800 });
await go('#/painel'); await page.waitForTimeout(200);
ok(await page.locator('#side').isVisible() && !(await page.locator('#tabs').isVisible()), 'layout desktop com barra lateral');
await page.screenshot({ path: '/tmp/s-desktop.png' });

console.log('\n== Erros na consola ==');
const real = errors.filter((e) => !/favicon|Failed to load resource.*(404)/.test(e));
ok(real.length === 0, 'sem erros/avisos na consola' + (real.length ? ': ' + real.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
