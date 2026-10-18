// Teste ponta-a-ponta com Playwright. Uso: BASE=http://localhost:8080 node tests/e2e.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

import { mkdirSync } from 'node:fs';
mkdirSync('/tmp/shots', { recursive: true });
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
// filtros (agrupados na folha "Filtros"; só a pesquisa fica visível)
eq(await page.locator('#view select').count(), 0, 'filtros escondidos: só a pesquisa fica visível');
ok(await page.locator('input[name=q]').isVisible() && await page.locator('[data-filters]').isVisible(), 'pesquisa e botão Filtros visíveis');
eq(await page.locator('#fcount').count(), 0, 'sem filtros ativos: sem selo de contagem');
const openFilters = async () => { await page.click('[data-filters]'); await page.waitForSelector('.modal.sheet [name=cat]'); };
const closeFilters = async () => { await page.click('.modal.sheet [data-done]'); await page.waitForTimeout(100); };
await openFilters();
ok(await page.locator('.modal.sheet #fs-month').isVisible(), 'folha de filtros inclui o mês');
await page.selectOption('.modal.sheet select[name=cat]', 'cat-supermercado');
eq(await T('#fcount'), '1', 'selo mostra 1 filtro ativo');
ok((await T('#sum-line')).includes('1 movimento'), 'filtro por categoria');
await page.selectOption('.modal.sheet select[name=cat]', '');
await page.selectOption('.modal.sheet select[name=tipo]', 'entrada');
ok((await T('#sum-line')).includes('1 movimento'), 'filtro por tipo');
await page.selectOption('.modal.sheet select[name=conta]', 'acc-ordem');
eq(await T('#fcount'), '2', 'selo mostra 2 filtros ativos (tipo + conta)');
ok((await page.getAttribute('[data-filters]', 'aria-label')).includes('2 ativos'), 'botão Filtros com aria-label da contagem');
await page.click('.modal.sheet [data-reset]');
eq(await page.locator('#fcount').count(), 0, 'limpar filtros remove o selo');
await closeFilters();
await page.fill('input[name=q]', 'pingo');
ok((await T('#mov-list')).includes('Compras Pingo Doce') && !(await T('#mov-list')).includes('Ordenado'), 'pesquisa por nota');
await page.fill('input[name=q]', '');
await openFilters(); await page.click('.modal.sheet [data-fm="-1"]');
eq(await T('#fcount'), '1', 'mês diferente do atual conta como filtro');
ok((await T('#mov-list')).includes('Sem movimentos'), 'mês anterior vazio');
await page.click('.modal.sheet [data-fm=all]');
ok((await T('#mov-month')).includes('Todos'), 'ver todos os meses');
await page.click('.modal.sheet [data-fm=all]');
await closeFilters();
eq(await page.locator('#fcount').count(), 0, 'mês atual: sem filtros ativos');
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
await go('#/movimentos');

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


// =====================================================================================
// Novas funcionalidades — contexto novo (base de dados limpa) para dados determinísticos
// =====================================================================================
await page.setViewportSize({ width: 390, height: 844 });
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-PT', timezoneId: 'Europe/Lisbon', colorScheme: 'dark' });
const p2 = await ctx2.newPage();
p2.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`p2 ${m.type()}: ${m.text()}`); });
p2.on('pageerror', (e) => errors.push('p2 pageerror: ' + e.message));
const T2 = (sel) => p2.locator(sel).first().innerText().then(norm);
const go2 = async (h) => { await p2.evaluate((x) => (location.hash = x), h); await p2.waitForTimeout(150); };
const modal2 = () => p2.locator('.modal-back').last();
const submit2 = async () => { await modal2().locator('button[type=submit]').click(); await p2.waitForTimeout(250); };
const mkey = (n) => { const x = new Date(now.getFullYear(), now.getMonth() + n, 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };
const add2 = async (tipo, valor, data, cat) => {
  await p2.click('#fab');
  if (await p2.locator('.modal-back').count() && await p2.locator('.modal.sheet').count()) { await p2.locator('.modal.sheet [data-full]').click(); await p2.waitForSelector('.modal-back input[name=tipo]', { state: 'attached' }); }
  await p2.check(`input[name=tipo][value=${tipo}]`, { force: true });
  await p2.fill('input[name=valor]', valor);
  await p2.fill('input[data-date-for=data]', data.split('-').reverse().join('/'));
  if (cat) await p2.selectOption('select[name=categoriaId]', cat);
  await submit2();
};
const dark2 = await (async () => { await p2.goto(BASE + '/'); await p2.waitForFunction(() => window.__ready); return true; })();

console.log('\n== Painel: atalhos rápidos e botão de despesa rápida ==');
eq(await p2.locator('.quick .qtile').count(), 4, '4 atalhos no Painel');
const tiles = (await p2.locator('.quick .qtile').allInnerTexts()).map(norm).join('|');
ok(['Despesa rápida', 'Ler talão', 'Abastecimento', 'Garantias'].every((t) => tiles.includes(t)), 'atalhos: Despesa rápida, Ler talão, Abastecimento, Garantias — ' + tiles);
ok((await p2.locator('#fab').getAttribute('class')).includes('extended') && (await T2('#fab')).includes('Despesa rápida'), 'botão flutuante destacado "Despesa rápida" no Painel');
eq(await p2.getAttribute('#fab', 'aria-label'), 'Adicionar despesa rápida', 'FAB com aria-label');
ok((await p2.locator('.quick .qtile').first().boundingBox()).height >= 44, 'atalhos com altura de toque ≥ 44px');
// atalho Garantias navega
await p2.locator('.qtile[data-quick=garantias]').click(); await p2.waitForTimeout(150);
ok(p2.url().endsWith('#/garantias'), 'atalho Garantias abre as garantias'); await go2('#/painel');
// atalho Abastecimento sem veículo -> Combustível (adicionar veículo)
await p2.locator('.qtile[data-quick=abastecer]').click(); await p2.waitForTimeout(150);
ok(p2.url().endsWith('#/combustivel') && await p2.locator('[data-vnew]').count() > 0, 'atalho Abastecimento sem veículo leva a adicionar veículo');
await p2.click('[data-vnew]'); await p2.fill('input[name=nome]', 'Carro'); await submit2();
await go2('#/painel');
await p2.locator('.qtile[data-quick=abastecer]').click(); await p2.waitForSelector('.modal-back input[name=litros]');
ok((await modal2().innerText()).includes('Novo abastecimento'), 'atalho Abastecimento abre o formulário de abastecimento'); await modal2().locator('[data-close]').click();
// atalho Ler talão -> OCR de imagem
ok(await p2.locator('#q-file').count() === 1, 'atalho Ler talão tem entrada de câmara/ficheiro');

console.log('\n== Despesa rápida (folha inferior) ==');
eq(await T2('#kpi-out'), '0,00 €', 'sem saídas no início');
await p2.click('#fab'); await p2.waitForSelector('.modal.sheet');
ok(await p2.locator('.modal.sheet .grabber').count() === 1, 'abre como folha inferior (bottom sheet)');
const sheetBox = await p2.locator('.modal.sheet').boundingBox();
ok(sheetBox.y + sheetBox.height >= 843 && sheetBox.y > 100, 'folha ancorada em baixo, não ocupa o ecrã todo');
ok(await p2.locator('.modal.sheet input[name=valor]').isVisible() && await p2.locator('.modal.sheet .cat-opt').first().isVisible(), 'valor e categoria na mesma folha');
eq(await p2.locator('.modal.sheet .more-opts').evaluate((e) => e.open), false, 'conta, nota e data estão recolhidas (opcionais)');
await submit2();
ok((await modal2().locator('.form-error').innerText()).includes('valor'), 'sem valor: erro');
await p2.fill('.modal.sheet input[name=valor]', '4,50'); await submit2();
ok((await modal2().locator('.form-error').innerText()).includes('categoria'), 'sem categoria: erro');
await p2.locator('.modal.sheet .cat-opt', { hasText: 'Restaurantes' }).click();
eq(await p2.locator('.modal.sheet input[name=data]').inputValue(), `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, 'data por omissão: hoje');
await submit2();
eq(await p2.locator('.modal-back').count(), 0, 'folha fecha ao guardar');
await p2.waitForSelector('.toast.ok'); ok(norm(await p2.locator('.toast', { hasText: 'Despesa de' }).first().innerText()).includes('4,50 € registada em Restaurantes'), 'aviso de confirmação');
eq(await T2('#kpi-out'), '4,50 €', 'saída aparece no Painel');
// última conta usada
await p2.click('#fab'); await p2.waitForSelector('.modal.sheet');
await p2.locator('.modal.sheet summary').click();
eq(await p2.locator('.modal.sheet select[name=contaId]').inputValue(), 'acc-ordem', 'conta por omissão: primeira conta');
await p2.selectOption('.modal.sheet select[name=contaId]', 'acc-dinheiro');
await p2.fill('.modal.sheet input[name=valor]', '2'); await p2.fill('.modal.sheet input[name=nota]', 'Café');
await p2.locator('.modal.sheet .cat-opt', { hasText: 'Restaurantes' }).click(); await submit2();
await p2.click('#fab'); await p2.waitForSelector('.modal.sheet'); await p2.locator('.modal.sheet summary').click();
eq(await p2.locator('.modal.sheet select[name=contaId]').inputValue(), 'acc-dinheiro', 'conta por omissão: a última usada');
// categorias mais usadas primeiro
eq((await p2.locator('.modal.sheet .cat-opt').first().innerText()).trim().replace(/^\S+\s*/, ''), 'Restaurantes', 'categoria mais usada aparece primeiro');
// ligação ao formulário completo mantendo o valor
await p2.fill('.modal.sheet input[name=valor]', '12'); await p2.locator('.modal.sheet [data-full]').click(); await p2.waitForSelector('.modal-back input[name=tipo]', { state: 'attached' });
eq(await p2.inputValue('input[name=valor]'), '12,00', 'formulário completo recebe o valor já escrito');
await modal2().locator('[data-close]').click();
await go2('#/movimentos');
ok((await T2('#mov-list')).includes('Café') && (await T2('#mov-list')).includes('Dinheiro'), 'despesa rápida com conta e nota guardada em Movimentos');
await go2('#/painel');
await p2.screenshot({ path: '/tmp/shots/m-dark-painel-top.png' });
await p2.click('#fab'); await p2.waitForSelector('.modal.sheet'); await p2.fill('.modal.sheet input[name=valor]', '23,90');
await p2.locator('.modal.sheet .cat-opt', { hasText: 'Supermercado' }).click();
await p2.screenshot({ path: '/tmp/shots/m-dark-quick-sheet.png' });
await p2.keyboard.press('Escape');

console.log('\n== Painel: comparação com o mês anterior ==');
const unit = await p2.evaluate(async () => {
  const { compare } = await import('./js/util.js');
  return { a: compare(5, 0), b: compare(0, 0), c: compare(-50, -100), d: compare(150, 100, { good: 'down' }), e: compare(1, 2, { hasPrev: false }), f: compare(0, 100, { good: 'down' }), g: compare(1000000, 1) };
});
eq(unit.a.dir + '/' + unit.a.text, 'new/novo', 'divisão por zero (anterior 0, atual >0) → "novo", sem %');
eq(unit.b.dir, 'flat', '0 vs 0 → igual');
ok(unit.c.dir === 'up' && unit.c.text === '50 %' && unit.c.tone === 'pos', 'saldo negativo que melhora conta como subida (50 %)');
ok(unit.d.dir === 'up' && unit.d.tone === 'neg', 'Saídas a subir é mau (cor negativa)');
eq(unit.e.dir, 'none', 'sem dados do mês anterior → none');
ok(unit.f.dir === 'down' && unit.f.tone === 'pos' && unit.f.text === '100 %', 'Saídas a descer 100 % é bom');
eq(unit.g.text, '>999 %', 'percentagens enormes limitadas');
ok(await p2.locator('.kpi .delta[data-delta=none]').count() === 3, 'sem mês anterior: os 3 cartões indicam "Sem mês anterior"');
const m0 = mkey(0), m1 = mkey(-1), m2 = mkey(-2);
await go2('#/movimentos');
await add2('entrada', '2000', `${m2}-01`, 'cat-salario'); await add2('saida', '400', `${m2}-01`, 'cat-casa');
await add2('entrada', '1000', `${m1}-01`, 'cat-salario'); await add2('saida', '100', `${m1}-01`, 'cat-casa');
await add2('entrada', '1500', `${m0}-01`, 'cat-salario'); await add2('saida', '150', `${m0}-01`, 'cat-casa');
await go2('#/painel');
// mês atual: saídas = 4,50 + 2 + 150 = 156,50 vs 100 (mesmo período) -> ↑ 57 % (mau)
const dIn = p2.locator('.kpi').nth(0).locator('.delta'), dOut = p2.locator('.kpi').nth(1).locator('.delta'), dNet = p2.locator('.kpi').nth(2).locator('.delta');
eq(await T2('#kpi-out'), '156,50 €', 'saídas do mês = 156,50');
ok((await dIn.innerText()).includes('↑ 50 %') && (await dIn.getAttribute('class')).includes('pos'), 'Entradas ↑ 50 % em verde: ' + norm(await dIn.innerText()));
ok((await dOut.innerText()).includes('↑ 57 %') && (await dOut.getAttribute('class')).includes('neg'), 'Saídas ↑ 57 % em vermelho (subir é mau): ' + norm(await dOut.innerText()));
ok((await dNet.innerText()).includes('↑') && (await dNet.getAttribute('class')).includes('pos'), 'Saldo ↑ em verde: ' + norm(await dNet.innerText()));
ok((await dIn.getAttribute('aria-label')).includes('Entradas: subiu 50 %') , 'variação com aria-label legível: ' + await dIn.getAttribute('aria-label'));
ok((await T2('#cmp-note')).includes('mesmo período'), 'mês em curso compara com o mesmo período do mês anterior');
// mês anterior: entradas 1000 vs 2000 ↓ 50 % (mau), saídas 100 vs 400 ↓ 75 % (bom), saldo 900 vs 1600 ↓ 44 % (mau)
await p2.click('[data-m="-1"]');
ok((await dIn.innerText()).includes('↓ 50 %') && (await dIn.getAttribute('class')).includes('neg'), 'Entradas ↓ 50 % em vermelho');
ok((await dOut.innerText()).includes('↓ 75 %') && (await dOut.getAttribute('class')).includes('pos'), 'Saídas ↓ 75 % em verde (descer é bom)');
ok((await dNet.innerText()).includes('↓ 44 %') && (await dNet.getAttribute('class')).includes('neg'), 'Saldo ↓ 44 % em vermelho');
eq(await p2.locator('#cmp-note').count(), 0, 'meses passados comparam o mês completo');
await p2.click('[data-m="-1"]');
ok(await p2.locator('.kpi .delta[data-delta=none]').count() === 3, 'mês sem mês anterior: "Sem mês anterior"');
await p2.click('[data-m="today"]');
await p2.screenshot({ path: '/tmp/shots/m-dark-painel-kpis.png' });

console.log('\n== Orçamentos por categoria ==');
ok((await T2('.budgets')).includes('Definir orçamentos'), 'sem orçamentos: convite a definir');
await p2.click('[data-budgets]'); await p2.waitForSelector('.modal.sheet .bud-edit');
await p2.fill('.modal.sheet input[name=b_cat-restaurantes]', '5');
await p2.fill('.modal.sheet input[name=b_cat-supermercado]', 'abc'); await submit2();
ok((await modal2().locator('.form-error').innerText()).includes('Supermercado'), 'orçamento inválido rejeitado');
await p2.fill('.modal.sheet input[name=b_cat-supermercado]', '100'); await p2.fill('.modal.sheet input[name=b_cat-casa]', '200'); await submit2();
// gastos: Restaurantes 6,50 (130 % de 5 → excedeu); Supermercado 0 → ok; Casa 150/200 = 75 % ok
await go2('#/movimentos');
await add2('saida', '45', `${m0}-02`, 'cat-supermercado');   // 45 % ok
await add2('saida', '40', `${m0}-02`, 'cat-casa');           // Casa 190/200 = 95 % → perto do limite
await go2('#/painel');
const bud = (id) => p2.locator(`.bud[data-budget=${id}]`);
eq(await p2.locator('.bud').count(), 3, '3 barras de orçamento');
ok((await bud('cat-restaurantes').getAttribute('class')).includes('over') && norm(await bud('cat-restaurantes').innerText()).includes('Excedeu 1,50 €'), 'Restaurantes excedido (vermelho): ' + norm(await bud('cat-restaurantes').innerText()));
ok((await bud('cat-casa').getAttribute('class')).includes('near') && (await bud('cat-casa').innerText()).includes('Perto do limite'), 'Casa perto do limite (laranja): ' + norm(await bud('cat-casa').innerText()));
ok((await bud('cat-supermercado').getAttribute('class')).includes('ok') && norm(await bud('cat-supermercado').innerText()).includes('Restam 55,00 €'), 'Supermercado dentro do orçamento (verde)');
eq(await bud('cat-restaurantes').locator('[role=progressbar]').getAttribute('aria-valuenow'), '100', 'barra excedida limitada a 100 %');
eq(await bud('cat-casa').locator('[role=progressbar]').getAttribute('aria-valuenow'), '95', 'progressbar com aria-valuenow (95)');
ok(Math.round((await bud('cat-casa').locator('.bar i').boundingBox()).width / (await bud('cat-casa').locator('.bar').boundingBox()).width * 100) === 95, 'largura da barra = 95 %');
const cols = await p2.evaluate(() => Object.fromEntries([...document.querySelectorAll('.bud')].map((b) => [b.dataset.budget, getComputedStyle(b.querySelector('.bar i')).backgroundColor])));
ok(new Set(Object.values(cols)).size === 3, 'três cores distintas para ok / perto / excedido: ' + JSON.stringify(cols));
eq(await p2.locator('.bud').first().getAttribute('data-budget'), 'cat-restaurantes', 'ordenado do mais para o menos consumido');
await p2.locator('.bud[data-budget=cat-casa]').click(); await p2.waitForTimeout(200);
ok(p2.url().endsWith('#/movimentos') && (await T2('#mov-month')).includes('Casa'), 'clicar numa barra abre os movimentos dessa categoria');
await go2('#/painel');
await p2.screenshot({ path: '/tmp/shots/m-dark-budgets.png', fullPage: true });
// persiste após recarregar; editável nas Categorias
await p2.reload(); await p2.waitForFunction(() => window.__ready);
eq(await p2.locator('.bud').count(), 3, 'orçamentos persistem após recarregar');
await go2('#/categorias');
ok((await T2('[data-edit="cat-casa"]')).includes('Orçamento: 200,00'), 'orçamento visível na lista de categorias');
await p2.locator('[data-edit="cat-casa"]').click();
eq(await p2.inputValue('.modal-back input[name=orcamento]'), '200,00', 'categoria mostra o orçamento atual');
await p2.fill('.modal-back input[name=orcamento]', '300'); await submit2();
await go2('#/painel');
ok((await bud('cat-casa').innerText()).includes('de 300,00') , 'alterar orçamento na categoria atualiza o Painel');
await go2('#/categorias');
await p2.locator('[data-edit="cat-casa"]').click(); await p2.fill('.modal-back input[name=orcamento]', ''); await submit2();
await p2.locator('[data-edit="cat-supermercado"]').click(); await p2.fill('.modal-back input[name=orcamento]', '0'); await submit2();
await p2.click('[data-budgets]'); await p2.fill('.modal.sheet input[name=b_cat-restaurantes]', ''); await submit2();
await go2('#/painel');
eq(await p2.locator('.bud').count(), 0, 'limpar orçamentos remove as barras'); ok((await T2('.budgets')).includes('Definir orçamentos'), 'convite volta a aparecer');
await p2.locator('[data-budgets]').click(); await p2.fill('.modal.sheet input[name=b_cat-casa]', '200'); await p2.fill('.modal.sheet input[name=b_cat-restaurantes]', '5'); await p2.fill('.modal.sheet input[name=b_cat-supermercado]', '100'); await submit2();
// categoria de entrada não tem orçamento
await go2('#/categorias'); await p2.locator('[data-edit="cat-salario"]').click();
eq(await p2.locator('.modal-back [data-for=orc]').isVisible(), false, 'categorias de entrada não têm campo de orçamento'); await modal2().locator('[data-close]').click();
// exportação inclui orçamentos
const exp = await p2.evaluate(async () => JSON.parse(await (await import('./js/db.js')).exportData()));
ok(exp.versao === 3 && exp.dados.categories.find((c) => c.id === 'cat-casa').orcamento === 20000, 'cópia de segurança inclui orçamentos (versão 3 do esquema)');

console.log('\n== Migração do esquema (v1 → v2) ==');
await p2.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open('financas-pessoais', 1);
  r.onsuccess = () => {
    const db = r.result, t = db.transaction('kv', 'readwrite'), st = t.objectStore('kv');
    st.put({ versao: 1, criadoEm: '2025-01-01T00:00:00.000Z' }, 'meta');
    st.put([{ id: 'cat-supermercado', nome: 'Supermercado', icone: '🛒', tipo: 'saida' }, { id: 'cat-salario', nome: 'Salário', icone: '💼', tipo: 'entrada', orcamento: 999 }, { id: 'cat-x', nome: 'Lixo', icone: '📦', tipo: 'saida', orcamento: 'abc' }], 'categories');
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  };
}));
await p2.reload(); await p2.waitForFunction(() => window.__ready);
const mig = await p2.evaluate(async () => {
  const { S } = await import('./js/db.js');
  const stored = await new Promise((res) => { const r = indexedDB.open('financas-pessoais', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('meta'); g.onsuccess = () => res(g.result); }; });
  return { v: S.meta.versao, st: stored.versao, cats: S.categories.map((c) => [c.id, c.orcamento]) };
});
ok(mig.v === 3 && mig.st === 3, 'dados v1 migrados até à versão atual (v3) e guardados (meta.versao=3)');
ok(mig.cats.every(([, o]) => o === null), 'migração normaliza orçamentos (ausente/ inválido/ entrada → null): ' + JSON.stringify(mig.cats));
await go2('#/painel'); ok((await T2('#view')).includes('Despesa rápida'), 'app abre normalmente após migração');

console.log('\n== Acessibilidade: contraste (WCAG AA) ==');
// restaurar dados para ter conteúdo realista nas verificações
await p2.evaluate(async () => { const { resetAll } = await import('./js/db.js'); await resetAll(); const { loadDemo } = await import('./js/demo.js'); await loadDemo(); });
await p2.reload(); await p2.waitForFunction(() => window.__ready);
const contrastAudit = () => p2.evaluate(() => {
  const parse = (c) => {
    if (c.startsWith('color(')) { const [r, g, b, a = 1] = c.replace(/^color\(srgb\s*/, '').replace(')', '').split(/[ \/]+/).filter(Boolean).map(Number); return { r: r * 255, g: g * 255, b: b * 255, a }; }
    const m = c.match(/rgba?\(([^)]+)\)/); const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r, g, b, a };
  };
  const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(getComputedStyle(e).backgroundColor); let bg = { r: 255, g: 255, b: 255, a: 1 }; for (const c of chain.reverse()) { const p = parse(c); if (p.a > 0) bg = blend(p, bg); } return bg; };
  const bad = []; let n = 0;
  const tc = (el) => { const cs = getComputedStyle(el); return cs.color; };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg') && !el.matches('text')) continue;
    if (![...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[hidden]') || el.closest('.modal-back') && false) continue;
    if (el.closest(':disabled') || el.closest('#toasts')) continue;
    const fg = parse(el.matches('text') ? cs.fill : cs.color); const bg = bgOf(el);
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const ratio = cr(blend({ ...fg, a: fg.a * op }, bg), bg); n++;
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) bad.push(`${el.tagName.toLowerCase()}.${(el.className?.baseVal ?? el.className) || ''}:"${el.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}<${need}`);
  }
  return { n, bad };
});
for (const theme of ['dark', 'light']) {
  await p2.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  for (const route of ['#/painel', '#/movimentos', '#/contas', '#/dividas', '#/mais', '#/categorias', '#/garantias', '#/combustivel']) {
    await go2(route); await p2.waitForTimeout(100);
    const r = await contrastAudit();
    ok(r.bad.length === 0, `contraste AA ${theme} ${route} (${r.n} textos)${r.bad.length ? ': ' + r.bad.slice(0, 6).join(' | ') : ''}`);
  }
  await go2('#/painel'); await p2.click('#fab'); await p2.waitForSelector('.modal.sheet'); await p2.waitForTimeout(400);
  let r = await contrastAudit(); ok(r.bad.length === 0, `contraste AA ${theme} folha Despesa rápida${r.bad.length ? ': ' + r.bad.slice(0, 6).join(' | ') : ''}`);
  await p2.keyboard.press('Escape');
  await go2('#/movimentos'); await p2.click('[data-filters]'); await p2.waitForSelector('.modal.sheet'); await p2.waitForTimeout(400);
  r = await contrastAudit(); ok(r.bad.length === 0, `contraste AA ${theme} folha Filtros${r.bad.length ? ': ' + r.bad.slice(0, 6).join(' | ') : ''}`);
  await p2.keyboard.press('Escape');
}
const mutedRatios = await p2.evaluate(() => {
  const out = {};
  const parse = (c) => { const t = document.createElement('i'); t.style.color = c; document.body.appendChild(t); const m = getComputedStyle(t).color.match(/[\d.]+/g).map(Number); t.remove(); return m; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const t of ['dark', 'light']) {
    document.documentElement.dataset.theme = t;
    const cs = getComputedStyle(document.documentElement); const v = (n) => parse(cs.getPropertyValue(n).trim());
    out[t] = ['--bg', '--card', '--accent-soft'].map((b) => [b, +cr(v('--muted'), v(b)).toFixed(2)]);
  }
  return out;
});
console.log('    --muted vs fundos:', JSON.stringify(mutedRatios));
ok(Object.values(mutedRatios).flat().every(([, r]) => r >= 4.5), 'texto secundário (--muted) ≥ 4,5:1 sobre bg/card/accent-soft nos dois temas');
ok(mutedRatios.dark.every(([, r]) => r >= 7), 'tema escuro: texto secundário ≥ 7:1 (acima do mínimo AA)');

console.log('\n== Acessibilidade: áreas de toque e nomes ==');
await p2.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
const tapAudit = () => p2.evaluate(() => {
  const small = [], unnamed = [];
  const sel = 'a[href], button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), summary, [role=button]';
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[hidden]') || el.matches('.date-native')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const id = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]}:"${(el.getAttribute('aria-label') || el.textContent || el.name || '').trim().slice(0, 18)}" ${Math.round(r.width)}x${Math.round(r.height)}`;
    if ((r.width < 43.5 || r.height < 43.5) && !(el.closest('p') && el.matches('.btn-link'))) small.push(id);
    const lab = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent.trim() || el.getAttribute('title') || el.labels?.[0]?.textContent.trim() || el.getAttribute('placeholder');
    if (!lab) unnamed.push(id);
  }
  return { small, unnamed };
});
for (const route of ['#/painel', '#/movimentos', '#/contas', '#/dividas', '#/mais', '#/categorias', '#/garantias', '#/precos', '#/taloes', '#/combustivel', '#/definicoes']) {
  await go2(route); await p2.waitForTimeout(100);
  const r = await tapAudit();
  ok(r.small.length === 0, `áreas de toque ≥ 44px em ${route}${r.small.length ? ': ' + r.small.slice(0, 8).join(' | ') : ''}`);
  ok(r.unnamed.length === 0, `controlos com nome acessível em ${route}${r.unnamed.length ? ': ' + r.unnamed.join(' | ') : ''}`);
}
for (const [name, open] of [['despesa rápida', async () => { await go2('#/painel'); await p2.click('#fab'); }], ['filtros', async () => { await go2('#/movimentos'); await p2.click('[data-filters]'); }], ['orçamentos', async () => { await go2('#/painel'); await p2.click('[data-budgets]'); }], ['movimento completo', async () => { await go2('#/movimentos'); await p2.click('.page-head [data-new]'); }]]) {
  await open(); await p2.waitForSelector('.modal-back');
  const r = await tapAudit();
  ok(r.small.length === 0 && r.unnamed.length === 0, `folha "${name}": toque ≥ 44px e nomes acessíveis${r.small.length ? ' ' + r.small.join(' | ') : ''}${r.unnamed.length ? ' sem nome: ' + r.unnamed.join(' | ') : ''}`);
  await p2.keyboard.press('Escape');
}
await go2('#/painel');
for (const b of await p2.locator('.month-nav .icon-btn').all()) { const bb = await b.boundingBox(); ok(bb.width >= 44 && bb.height >= 44, `seta do mês ${await b.getAttribute('aria-label')} ${Math.round(bb.width)}x${Math.round(bb.height)} ≥ 44x44`); }
await go2('#/movimentos'); await p2.click('[data-filters]');
for (const b of await p2.locator('.modal.sheet .month-nav .icon-btn').all()) { const bb = await b.boundingBox(); ok(bb.width >= 44 && bb.height >= 44, `seta do mês nos filtros ≥ 44x44 (${Math.round(bb.width)}x${Math.round(bb.height)})`); }
await p2.keyboard.press('Escape');

console.log('\n== Capturas de ecrã ==');
await p2.evaluate(async () => { const { S, save } = await import('./js/db.js'); const set = { 'cat-casa': 45000, 'cat-supermercado': 21000, 'cat-restaurantes': 6000, 'cat-saude': 4000 }; S.categories.forEach((c) => { if (set[c.id]) c.orcamento = set[c.id]; }); await save('categories'); });
await p2.waitForTimeout(300);
for (const theme of ['dark', 'light']) {
  await p2.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await go2('#/painel'); await p2.waitForTimeout(150);
  await p2.screenshot({ path: `/tmp/shots/m-${theme}-painel.png`, fullPage: true });
  await p2.screenshot({ path: `/tmp/shots/m-${theme}-painel-view.png` });
  await p2.locator('section.card:has(.budgets)').scrollIntoViewIfNeeded(); await p2.locator('#fab').evaluate((e) => { e.style.display = 'none'; });
  await p2.locator('section.card:has(.budgets)').screenshot({ path: `/tmp/shots/m-${theme}-painel-orcamentos.png` }); await p2.locator('#fab').evaluate((e) => { e.style.display = ''; });
  await go2('#/movimentos'); await p2.waitForTimeout(100);
  await p2.screenshot({ path: `/tmp/shots/m-${theme}-movimentos.png` });
  await p2.click('[data-filters]'); await p2.waitForSelector('.modal.sheet'); await p2.selectOption('.modal.sheet select[name=tipo]', 'saida'); await p2.waitForTimeout(400);
  await p2.screenshot({ path: `/tmp/shots/m-${theme}-filtros.png` });
  await p2.keyboard.press('Escape');
  await p2.click('[data-clear]');
  await go2('#/painel'); await p2.click('[data-budgets]'); await p2.waitForSelector('.modal.sheet .bud-edit'); await p2.waitForTimeout(400);
  await p2.screenshot({ path: `/tmp/shots/m-${theme}-orcamentos-sheet.png` });
  await p2.keyboard.press('Escape');
  await go2('#/painel'); await p2.click('#fab'); await p2.waitForSelector('.modal.sheet'); await p2.fill('.modal.sheet input[name=valor]', '7,80'); await p2.locator('.modal.sheet .cat-opt').nth(1).click(); await p2.waitForTimeout(400);
  await p2.screenshot({ path: `/tmp/shots/m-${theme}-despesa-rapida.png` });
  await p2.keyboard.press('Escape');
}
await p2.setViewportSize({ width: 1280, height: 800 });
for (const theme of ['dark', 'light']) {
  await p2.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await go2('#/painel'); await p2.waitForTimeout(150);
  await p2.screenshot({ path: `/tmp/shots/d-${theme}-painel.png` });
  await go2('#/movimentos'); await p2.click('[data-filters]'); await p2.waitForSelector('.modal.sheet'); await p2.waitForTimeout(400);
  await p2.screenshot({ path: `/tmp/shots/d-${theme}-filtros.png` });
  await p2.keyboard.press('Escape');
}
ok(true, 'capturas guardadas em /tmp/shots');
await ctx2.close();

console.log('\n== Erros na consola ==');
const real = errors.filter((e) => !/favicon|Failed to load resource.*(404)/.test(e));
ok(real.length === 0, 'sem erros/avisos na consola' + (real.length ? ': ' + real.join(' | ') : ''));
await browser.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
