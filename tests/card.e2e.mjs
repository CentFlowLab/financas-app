// Testes ponta-a-ponta dos extratos de CARTÃO DE CRÉDITO (PDF) e do ecrã «Ajustar leitura» sem linhas — só dados sintéticos (tests/fixtures/generate-card.mjs).
// Uso: BASE=http://localhost:8080 node tests/card.e2e.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:8080';
const FX = (n) => fileURLToPath(new URL('./fixtures/' + n, import.meta.url));
const EXP = JSON.parse(readFileSync(FX('expected.json'), 'utf8')).card;
let pass = 0, fail = 0; const errors = [];
const ok = (c, name) => { if (c) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FALHOU:', name); } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), `${name}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)})`}`);
const norm = (s) => s.replace(/\s|\u00a0|\u202f/g, ' ').replace(/ +/g, ' ').trim();
const sum = (a) => a.reduce((x, y) => x + y, 0);

const browser = await chromium.launch();
// Cada cenário usa um contexto novo (base de dados vazia)
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-PT', timezoneId: 'Europe/Lisbon' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '/'); await page.waitForFunction(() => window.__ready);
  const h = {
    page, ctx,
    T: (sel) => page.locator(sel).first().innerText().then(norm),
    go: async (x) => { await page.evaluate((v) => (location.hash = v), x); await page.waitForTimeout(200); },
    state: () => page.evaluate(async () => { const { S } = await import('./js/db.js'); return JSON.parse(JSON.stringify({ accounts: S.accounts, movements: S.movements, imports: S.imports, categories: S.categories })); }),
    waitStep: (s) => page.waitForSelector(`#imp-body[data-step=${s}]`, { timeout: 30000 }),
    open: async () => { await h.go('#/importar?novo=1'); await h.waitStep('ficheiro'); },
    upload: (f) => page.setInputFiles('#imp-file', FX(f)),
    next: async () => { await page.click('#imp-body [data-next]'); await page.waitForTimeout(150); },
    bal: (st, id) => { const a = st.accounts.find((x) => x.id === id); let b = a.saldoInicial || 0; for (const m of st.movements) { if (m.tipo === 'entrada' && m.contaId === id) b += m.valor; else if (m.tipo === 'saida' && m.contaId === id) b -= m.valor; else if (m.tipo === 'transferencia') { if (m.contaId === id) b -= m.valor; if (m.contaDestinoId === id) b += m.valor; } } return b; },
  };
  h.toContas = async (f) => { await h.open(); await h.upload(f); await h.waitStep('contas'); };
  h.toReview = async (f) => { await h.toContas(f); await h.next(); await h.waitStep('rever'); };
  h.commit = async () => { await page.locator('#imp-revisto').check().catch(() => {}); await page.click('[data-commit]'); await h.waitStep('feito'); };
  return h;
}
// Leitura pelo motor (sem UI)
const readFx = (page, name) => page.evaluate(async ({ name, b64 }) => {
  const E = await import('./js/import/engine.js');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  try {
    const src = await E.loadSource(new File([bytes], name));
    const sess = E.buildSession(src), p = E.getParsed(src), g = sess.groups[0];
    return { metodo: p.metodo, conf: p.confianca?.nivel, warnings: sess.warnings, cartao: p.cartao, nGroups: sess.groups.length,
      rows: sess.rows.map((r) => ({ d: r.data, v: r.valor, desc: r.desc, cat: r.cat, herdada: !!r.herdada, inc: !!r.semSinal })),
      g: { tipo: g.novo.tipo, nome: g.novo.nome, opening: g.bal?.opening ?? null, final: g.bal?.final ?? null, diff: E.reconcile(g)?.diff ?? null, keys: g.matchKeys, iban: g.iban, guardar: g.guardarCartao, limite: g.novo.limite } };
  } catch (e) { return { error: e.message }; }
}, { name, b64: readFileSync(FX(name)).toString('base64') });

// ============ (1) motor: extrato de cartão (layout de um extrato real português, dados fictícios) ============
console.log('\n== (1) Cartão: leitura pelo motor ==');
{
  const h = await fresh(); const e = EXP.fev;
  const r = await readFx(h.page, 'gen-n-cartao-fev.pdf'), v = r.rows;
  ok(!r.error, 'lê o PDF sem erro' + (r.error ? ': ' + r.error : ''));
  eq(r.nGroups, 1, 'uma só conta de cartão (as páginas de movimentos juntam-se)'); eq(r.g.tipo, 'cartao', 'tipo «cartão de crédito» detetado');
  eq(v.length, e.nMov, `${e.nMov} movimentos (${e.nDateLed - 1} linhas com data + ${e.nSub} sublinhas sem data − linhas a zero)`);
  eq(v.filter((x) => x.v < 0).length, e.nDeb, `${e.nDeb} débitos (compras, transferências, comissões, selo, juros) negativos`);
  eq(v.filter((x) => x.v > 0).length, e.nCre, `${e.nCre} créditos (pagamentos) positivos`);
  eq(-sum(v.filter((x) => x.v < 0).map((x) => x.v)), e.deb, 'soma dos débitos = total de débitos do resumo');
  eq(sum(v.filter((x) => x.v > 0).map((x) => x.v)), e.cre, 'soma dos créditos = total de créditos do resumo');
  eq(v.filter((x) => x.v > 0).map((x) => x.v), e.creditos, 'créditos nas colunas certas (TRF IMEDIATA)');
  ok(v.every((x) => x.v !== 0), 'linhas a zero (Imp. Selo 0,00) ignoradas'); ok(v.every((x) => !x.inc), 'nenhum sinal incerto');
  eq([r.g.opening, r.g.final, r.g.diff], [e.opening, e.final, 0], 'saldo inicial = −dívida anterior, final = −dívida atual, diferença 0');
  eq(r.cartao.validacao.ok, true, 'validação contra o resumo da página 1: tudo confere'); eq(r.cartao.validacao.resumo, { anterior: e.prev, creditos: e.cre, debitos: e.deb, atual: e.cur, fonte: 'resumo' }, 'resumo lido (anterior, créditos, débitos, atual)');
  eq([r.cartao.limite, r.cartao.tan, r.cartao.minimo, r.cartao.dataLimite, r.cartao.numero, r.cartao.extratoNo], [e.limite, e.tan, e.minimo, e.dataLimite, e.numero, '03/2026'], 'limite, TAN, mínimo, data limite, nº mascarado, nº do extrato');
  eq(r.g.keys, ['cartao:400012XXXXXX0007', 'cartao-iban:PT50999900150000000000005'], 'chaves da conta: nº mascarado e IBAN de pagamento (o IBAN do cartão não é usado como IBAN da conta)'); eq(r.g.iban, null, 'sem IBAN de conta (evita misturar com a conta à ordem)');
  eq([v[0].d, v.at(-1).d], [e.firstDate, '2026-02-19'], 'datas dd.mm com o ano do período; 17.02 (antes do início do período) fica em 2026; juros com a data valor (19.02)');
  const com = v.filter((x) => /Comiss/.test(x.desc)); eq(com.length, 2, '2 comissões (sublinhas sem data)'); ok(com.every((x) => x.herdada && x.d === '2026-02-17' || x.d === '2026-02-24'), 'comissões/selo herdam a data do movimento anterior');
  const sel = v.filter((x) => /Imp\. Selo/.test(x.desc)); eq(sel.length, 3, '3 linhas de imposto do selo (2 sublinhas + 1 dos juros; a de 0,00 ignorada)');
  ok(v.every((x) => !/\b(PRT|GBR|USA)$/.test(x.desc)), 'código do país não fica na descrição'); ok(v.some((x) => x.desc.includes('30,00USD')), 'valor em moeda estrangeira (USD) fica na descrição'); ok(!v.some((x) => /EUR/.test(x.desc)), 'valores «,35EUR» (sem zero à esquerda) não contaminam a descrição');
  eq(v.filter((x) => x.v === -35).length, 8, "8 compras de 0,35 € (valor «,35EUR» sem zero) lidas no débito certo");
  eq(v.filter((x) => /Comiss|Imp\. Selo|JUROS/.test(x.desc)).every((x) => ['cat-comissoes', 'cat-impostos'].includes(x.cat)), true, 'comissões/juros → «Comissões e juros»; selo → «Impostos e taxas»');
  eq(v.filter((x) => /^TRFI PARA/.test(x.desc)).every((x) => x.cat === 'cat-transferencias'), true, 'TRFI PARA … (MB Way) → Transferências'); eq(v.filter((x) => /^TRF IMEDIATA/.test(x.desc)).every((x) => x.cat === 'cat-transferencias-in'), true, 'TRF IMEDIATA (pagamentos ao cartão) → Transferências (entrada)');
  ok(!r.warnings.some((w) => /não coincide|não fecha|não consigo validar/.test(w)), 'sem avisos de totais'); eq(r.conf, 'alta', 'confiança alta (resumo confirma)');
  await h.ctx.close();
}
console.log('\n== (1b) Cartão: tabela deslocada na 2.ª página de movimentos (outra indentação) ==');
{
  const h = await fresh(); const e = EXP.fev;
  const r = await readFx(h.page, 'gen-n4-cartao-indentacao.pdf');
  eq([r.rows.length, r.cartao?.validacao.ok, r.g.diff], [e.nMov, true, 0], 'mesmos movimentos e totais com a tabela deslocada');
  await h.ctx.close();
}
console.log('\n== (1c) Cartão: viragem de ano (dezembro → janeiro) ==');
{
  const h = await fresh(); const e = EXP.viragem;
  const r = await readFx(h.page, 'gen-n3-cartao-viragem.pdf');
  eq(r.rows.map((x) => x.d).filter((d, i, a) => a.indexOf(d) === i).sort(), [...e.datas, e.jurosData].sort(), 'dezembro → 2026, janeiro → 2027 (incl. 17.12 antes do início do período)');
  eq([r.g.opening, r.g.final, r.g.diff, r.cartao.validacao.ok], [e.opening, e.final, 0, true], 'reconciliação com o resumo');
  await h.ctx.close();
}
console.log('\n== (1d) Validação: totais lidos que não batem certo são assinalados ==');
{
  const h = await fresh(); const e = EXP.fev;
  const res = await h.page.evaluate(async ({ e }) => {
    const C = await import('./js/import/cardstatement.js');
    const info = { resumo: { anterior: e.prev, creditos: e.cre, debitos: e.deb, atual: e.cur } };
    const rows = [{ valor: -e.deb + 500 }, { valor: e.cre }]; // falta 5,00 € de débitos
    return C.validateCard(rows, info);
  }, { e });
  eq(res.ok, false, 'não confere'); eq(res.diffDeb, -500, 'diferença nos débitos = −5,00 €'); eq(res.diffCre, 0, 'créditos confere'); ok(res.avisos.length === 2 && /débitos/.test(res.avisos[0]), 'avisos com os valores do extrato e os lidos');
  await h.ctx.close();
}

// ============ (2) UI: conta nova de cartão, saldos, limite/TAN, categorias em falta ============
console.log('\n== (2) UI: importar extrato de cartão → conta de cartão com dívida negativa ==');
{
  const h = await fresh(), { page } = h, e = EXP.fev;
  // base de dados «antiga»: sem as categorias novas -> têm de ser acrescentadas
  await page.evaluate(async () => { const { S } = await import('./js/db.js'); S.categories = S.categories.filter((c) => !['cat-comissoes', 'cat-transferencias', 'cat-transferencias-in'].includes(c.id)); });
  await h.toContas('gen-n-cartao-fev.pdf');
  ok(await page.locator('#imp-card').isVisible(), 'painel «Cartão de crédito» visível'); ok(/Cartão de crédito 4000 12XX XXXX 0007/.test(await h.T('#imp-card')), 'mostra o cartão mascarado');
  const resumo = await h.T('#imp-card-resumo');
  ok(['924,70', '736,40', '708,95', '897,25'].every((x) => resumo.includes(x)), 'resumo: dívida anterior 924,70 · créditos 736,40 · débitos 708,95 · dívida atual 897,25');
  ok((await h.T('#imp-card-ok')).startsWith('✓'), 'totais lidos conferem com o resumo'); eq(await page.locator('#imp-card-resumo .neg').count(), 0, 'sem marcas ⚠️ no resumo');
  eq(await page.locator('select[name=g-tipo]').inputValue(), 'cartao', 'tipo de conta = cartão de crédito'); eq(await page.locator('input[name=g-saldo]').inputValue(), '-924,70', 'saldo inicial = −dívida do extrato anterior');
  ok(/bate certo/.test(await h.T('[data-recon]')), 'reconciliação: saldo final do extrato bate certo (−897,25 €)'); ok(await page.locator('input[name=g-cartao]').isChecked(), 'guardar limite e TAN: marcado por omissão');
  { const t = await h.T('#imp-card'); ok(/3\.?\s?000,00/.test(t) && /TAN 12,5%/.test(t), 'limite de crédito 3.000,00 € e TAN 12,5% apresentados'); }
  await h.next(); await h.waitStep('rever');
  ok(/40 movimentos/.test(await h.T('#imp-sum')), '40 movimentos na revisão'); ok((await h.T('#imp-recon')).includes('=') || /✓/.test(await h.T('#imp-recon')), 'faixa de reconciliação ✓');
  await h.commit();
  const st = await h.state(), card = st.accounts.find((a) => a.tipo === 'cartao');
  ok(!!card, 'conta de cartão criada'); eq([card.saldoInicial, card.limite, card.tan], [e.opening, e.limite, e.tan], 'saldo inicial −924,70 €; limite 3.000,00 €; TAN 12,5%');
  eq(h.bal(st, card.id), e.final, 'saldo da conta = −dívida atual do extrato (−897,25 €)'); eq(st.movements.length, e.nMov, '40 movimentos guardados');
  eq(st.movements.filter((m) => m.tipo === 'saida').length, e.nDeb, '37 saídas (débitos aumentam a dívida)'); eq(st.movements.filter((m) => m.tipo === 'entrada').length, e.nCre, '3 entradas (pagamentos reduzem a dívida)');
  ok(card.chaves.includes('cartao:400012XXXXXX0007'), 'conta identificada pelo nº mascarado do cartão');
  ok(['cat-comissoes', 'cat-transferencias', 'cat-transferencias-in'].every((id) => st.categories.some((c) => c.id === id)), 'categorias «Comissões e juros» e «Transferências» acrescentadas quando faltam');
  eq(st.movements.filter((m) => m.categoriaId === 'cat-comissoes').length, 3, '3 movimentos em «Comissões e juros» (2 comissões + juros)');
  await h.go('#/contas'); await page.waitForTimeout(300);
  ok(/Disponível 2\.?\s?102,75 € de 3\.?\s?000,00 €/.test(await h.T('.acc-card:has-text("Cartão de crédito")')), 'Contas: «Disponível 2.102,75 € de 3.000,00 €»'); ok(/TAN 12,5%/.test(await h.T('.acc-card:has-text("Cartão de crédito")')), 'Contas: TAN visível');

  // ============ (3) extratos mensais consecutivos ============
  console.log('\n== (3) Segundo extrato (mês seguinte): mesma conta, sem nova conta, continuidade verificada ==');
  const e2 = EXP.mar; const nAcc = st.accounts.length;
  await h.toContas('gen-n2-cartao-mar.pdf');
  eq(await page.locator('select[name=g-choice]').inputValue(), card.id, 'conta do cartão escolhida automaticamente (nº mascarado)'); eq(await page.locator('.new-acc').count(), 0, 'sem «criar conta nova»');
  ok((await h.T('#imp-card-cont')).startsWith('✓'), 'continuidade: dívida anterior do extrato = dívida registada'); ok(/bate certo/.test(await h.T('[data-recon]')), 'reconciliação ✓');
  await h.next(); await h.waitStep('rever'); await h.commit();
  const st2 = await h.state(), card2 = st2.accounts.find((a) => a.tipo === 'cartao');
  eq(st2.accounts.length, nAcc, 'nenhuma conta nova'); eq(card2.saldoInicial, e.opening, 'saldo inicial da conta intacto'); eq(h.bal(st2, card2.id), e2.final, `saldo = −dívida do 2.º extrato (${e2.final})`);
  eq(st2.movements.length, e.nMov + e2.nMov, 'movimentos acumulados'); eq(card2.limite, e.limite, 'limite mantido');
  // o mesmo extrato outra vez: tudo duplicado
  console.log('\n== (3b) Reimportar o mesmo extrato: duplicados ignorados ==');
  await h.toContas('gen-n2-cartao-mar.pdf'); await h.next(); await h.waitStep('rever');
  ok(await page.locator('#imp-already').count() > 0, 'aviso «este ficheiro já foi importado»'); eq(await page.locator('.irow.dup').count(), e2.nMov, `${e2.nMov} duplicados`); ok(/0 movimentos/.test(await h.T('#imp-sum')), '0 movimentos a importar');
  await h.go('#/importar?novo=1'); await h.waitStep('ficheiro');
  // extrato 1 outra vez (mês anterior, já importado): duplicados; a continuidade (dívida anterior) continua a bater certo
  await h.toContas('gen-n-cartao-fev.pdf'); await h.next(); await h.waitStep('rever'); eq(await page.locator('.irow.dup').count(), e.nMov, '1.º extrato reimportado: 40 duplicados');
  const st3 = await h.state(); eq(st3.movements.length, e.nMov + e2.nMov, 'nada foi gravado');
  await h.ctx.close();
}
console.log('\n== (3c) Continuidade quebrada: 2.º extrato numa conta de cartão que não tem o extrato anterior ==');
{
  const h = await fresh(), { page } = h, e2 = EXP.mar;
  await page.evaluate(async () => { const { S, save } = await import('./js/db.js'); S.accounts.push({ id: 'acc-cartao-manual', nome: 'Meu cartão', tipo: 'cartao', saldoInicial: 0, limite: null, arquivada: false }); await save('accounts'); });
  await h.toContas('gen-n2-cartao-mar.pdf');
  await page.selectOption('select[name=g-choice]', 'acc-cartao-manual'); await page.waitForTimeout(150);
  const t = await h.T('#imp-card-cont'); ok(t.startsWith('⚠️') && /falta importar o extrato do mês anterior/.test(t), 'avisa que falta o extrato anterior');
  ok(/não bate certo/i.test(await h.T('[data-recon]')) || (await page.locator('.recon.bad').count()) > 0, 'reconciliação com diferença (−dívida anterior em falta)');
  ok((await page.locator('[data-adjust-acc]').count()) === 1, 'oferece ajustar o saldo inicial da conta (não altera nada sem confirmar)');
  const st = await h.state(); eq(st.accounts.find((a) => a.id === 'acc-cartao-manual').saldoInicial, 0, 'saldo inicial só muda se o utilizador pedir');
  eq(e2.opening, -(e2.prev), 'verificação: abertura esperada = −dívida anterior');
  await h.ctx.close();
}

// ============ (4) emparelhamento com a conta à ordem ============
console.log('\n== (4) Pagamentos do cartão ↔ saídas da conta à ordem: transferência interna (±5 dias) ==');
for (const ordemPrimeiro of [true, false]) {
  const h = await fresh(), { page } = h, e = EXP.fev;
  console.log(ordemPrimeiro ? '  -- conta à ordem importada primeiro' : '  -- cartão importado primeiro');
  const first = ordemPrimeiro ? 'gen-n5-conta-ordem-pagamentos.pdf' : 'gen-n-cartao-fev.pdf', second = ordemPrimeiro ? 'gen-n-cartao-fev.pdf' : 'gen-n5-conta-ordem-pagamentos.pdf';
  await h.toReview(first); await h.commit();
  const s1 = await h.state(), n1 = s1.movements.length;
  await h.toReview(second);
  ok(await page.locator('[data-pair-ex]').count() === 2, '2 pagamentos emparelhados com movimentos já registados (5.260,00 está a 28 dias: não emparelha)'); ok((await page.locator('[data-pair-ex].ok').count()) === 2, 'transferência ligada por omissão (um dos lados é cartão)');
  ok(/2 transferências/.test(await h.T('#imp-sum')), 'resumo: 2 transferências');
  await h.commit();
  const st = await h.state(), card = st.accounts.find((a) => a.tipo === 'cartao'), ordem = st.accounts.find((a) => a.tipo === 'ordem' && a.importId);
  const tr = st.movements.filter((m) => m.tipo === 'transferencia');
  eq(tr.length, 2, '2 transferências internas (movimentos existentes convertidos, não duplicados)'); eq(tr.map((m) => m.valor).sort((a, b) => a - b), [31880, 36500], 'valores 318,80 e 365,00');
  ok(tr.every((m) => m.contaId === ordem.id && m.contaDestinoId === card.id), 'origem = conta à ordem, destino = cartão');
  eq(st.movements.length, ordemPrimeiro ? n1 + e.nMov - 2 : n1 + 7 - 2, 'não cria despesa/receita para os emparelhados');
  eq(h.bal(st, card.id), e.final, 'saldo do cartão = −dívida atual do extrato (as transferências contam como pagamento)'); eq(h.bal(st, ordem.id), EXP.conta.final, 'saldo da conta à ordem igual ao do extrato');
  // anular: o movimento convertido volta a saída
  await h.open();
  const impId = st.imports.at(-1).id; await page.evaluate(async (id) => { const E = await import('./js/import/engine.js'); E.undoImport(id); }, impId);
  const su = await h.state(); eq(su.movements.filter((m) => m.tipo === 'transferencia').length, 0, 'anular a importação: sem transferências');
  if (ordemPrimeiro) eq(su.movements.filter((m) => m.tipo === 'saida' && /CARTAO/.test(m.nota)).length, 3, 'as 3 saídas da conta à ordem voltam ao que eram (movimentos convertidos repostos)');
  else eq(su.movements.filter((m) => m.tipo === 'entrada' && m.contaId === card.id).length, 3, 'os 3 pagamentos (entradas) do cartão voltam ao que eram');
  await h.ctx.close();
}

// ============ (5) sem linhas: ecrã «Ajustar leitura» com pré-visualização de texto ============
console.log('\n== (5) Nenhuma linha encontrada → «Ajustar leitura do PDF» com o texto lido ==');
{
  const h = await fresh(), { page } = h, e = EXP.ddmm;
  await h.open(); await h.upload('gen-o-datas-ddmm-duas-colunas.pdf');
  await page.waitForSelector('#imp-body[data-step=pdfajuste]', { timeout: 30000 });
  ok(await page.locator('#aj-vazio').isVisible(), 'em vez de erro/ecrã vazio: ecrã de ajuste com explicação'); ok((await page.locator('#aj-text span').count()) >= 10, 'pré-visualização do texto extraído (linhas)');
  ok((await h.T('#aj-text')).includes('03.05') && /Valor/.test(await h.T('#aj-text')), 'o texto mostra as datas e valores lidos'); eq(await page.locator('#aj-table').count(), 0, 'ainda sem colunas (nada reconhecido)');
  ok(await page.locator('select[name=aj-datefmt]').isVisible() && await page.locator('select[name=aj-tipo]').isVisible() && await page.locator('input[name=aj-dotdates]').isVisible(), 'opções: formato da data, tipo de conta, datas dd.mm');
  await page.click('[data-aj-try]'); await page.waitForTimeout(200);
  ok(await page.locator('#aj-tentou').count() === 1, 'tentar sem alterar nada → mensagem clara, continua no ecrã de ajuste');
  await page.locator('input[name=aj-dotdates]').check(); await page.click('[data-aj-try]'); await page.waitForSelector('#aj-table', { timeout: 10000 });
  eq((await h.T('#aj-count')).match(/(\d+) movimentos/)?.[1], String(e.n), `com «datas dd.mm»: ${e.n} movimentos reconhecidos`);
  await page.click('[data-aj-next]'); await h.waitStep('contas'); await h.next(); await h.waitStep('rever');
  eq(await page.locator('.irow').count(), e.n, 'revisão com as linhas lidas'); eq(await page.locator('.irow .d').first().innerText().then(norm), '03/05/2026', 'data dd.mm com o ano do período');
  await h.ctx.close();
}
console.log('\n== (5b) PDF que não é extrato continua a dar erro claro ==');
{
  const h = await fresh(), { page } = h;
  await h.open(); await h.upload('gen-i-nao-extrato.pdf'); await page.waitForFunction(() => document.querySelector('#imp-msg')?.textContent.includes('❌'), null, { timeout: 20000 });
  ok(/não parece ser um extrato/.test(await h.T('#imp-msg')), 'mensagem clara'); await h.ctx.close();
}

console.log('\n== Erros na consola ==');
ok(errors.length === 0, 'sem erros nem avisos na consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
