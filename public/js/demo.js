// Dados de exemplo (para experimentar a app)
import { S, save, COLLS } from './db.js';
import { uid, toISO, shiftMonth, addMonthsISO } from './util.js';
import { CAT_FUEL, CAT_DEBT } from './defaults.js';

export async function loadDemo() {
  let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const r = (a, b) => Math.round(a + rnd() * (b - a));
  const now = new Date(); const cur = toISO(now).slice(0, 7);
  const mk = (id, rec) => { const e = S.accounts.find((a) => a.id === id); if (e && !S.movements.some((m) => m.contaId === id)) return Object.assign(e, rec); const n = { id: id && !e ? id : uid(), ...rec }; S.accounts.push(n); return n; };
  const ordem = mk('acc-ordem', { nome: 'Conta Ordenado', tipo: 'ordem', saldoInicial: 120000, arquivada: false });
  const din = mk('acc-dinheiro', { nome: 'Dinheiro', tipo: 'dinheiro', saldoInicial: 8000, arquivada: false });
  const poup = mk(null, { nome: 'Poupança', tipo: 'poupanca', saldoInicial: 300000, arquivada: false });
  const cartao = mk(null, { nome: 'Cartão de crédito', tipo: 'cartao', saldoInicial: -25000, limite: 100000, arquivada: false });
  const mv = (tipo, valor, data, cat, conta, nota = '', extra = {}) => S.movements.push({ id: uid(), criadoEm: data + 'T12:00:00', tipo, valor, data, categoriaId: cat, contaId: conta.id, nota, ...extra });
  const day = (mk, d) => `${mk}-${String(Math.min(d, 28)).padStart(2, '0')}`;
  for (let i = 3; i >= 0; i--) {
    const mk = shiftMonth(cur, -i);
    const last = i === 0 ? now.getDate() : 28;
    const ok = (d) => d <= last;
    if (ok(1)) mv('entrada', 165000, day(mk, 1), 'cat-salario', ordem, 'Ordenado');
    if (ok(2)) mv('saida', 52000, day(mk, 2), 'cat-casa', ordem, 'Renda');
    if (ok(5)) mv('saida', r(7500, 11000), day(mk, 5), 'cat-contas-casa', ordem, 'Eletricidade e água');
    if (ok(6)) mv('saida', 3990, day(mk, 6), 'cat-comunicacoes', ordem, 'Internet e telemóvel');
    if (ok(10)) mv('transferencia', 20000, day(mk, 10), null, ordem, 'Poupança mensal', { contaDestinoId: poup.id });
    for (const d of [3, 9, 15, 22, 27]) if (ok(d)) mv('saida', r(3500, 9500), day(mk, d), 'cat-supermercado', d % 2 ? ordem : cartao, 'Compras');
    for (const d of [7, 19]) if (ok(d)) mv('saida', r(2800, 4500), day(mk, d), CAT_FUEL, ordem, 'Abastecimento');
    for (const d of [8, 14, 23]) if (ok(d)) mv('saida', r(1200, 3800), day(mk, d), 'cat-restaurantes', d === 14 ? cartao : din, 'Refeição');
    if (ok(12)) mv('saida', r(1500, 4500), day(mk, 12), 'cat-lazer', cartao, 'Cinema / saída');
    if (ok(17)) mv('saida', r(1500, 6000), day(mk, 17), 'cat-saude', ordem, 'Farmácia');
    if (ok(11)) mv('saida', 4000, day(mk, 11), 'cat-transportes', ordem, 'Passe');
    if (ok(25)) mv('saida', 28000, day(mk, 25), CAT_DEBT, ordem, 'Prestação carro');
  }
  const d1 = { id: uid(), credor: 'Crédito automóvel', total: 1200000, saldoInicial: 920000, taxa: 6.5, prestacao: 28000, criadoEm: new Date().toISOString() };
  const d2 = { id: uid(), credor: 'Cartão de crédito', total: 150000, saldoInicial: 90000, taxa: 18, prestacao: 9000, criadoEm: new Date().toISOString() };
  const d3 = { id: uid(), credor: 'Crédito pessoal', total: 300000, saldoInicial: 120000, taxa: 9, prestacao: 15000, criadoEm: new Date().toISOString() };
  S.debts.push(d1, d2, d3);
  for (let i = 3; i >= 1; i--) S.debtPayments.push({ id: uid(), debtId: d1.id, data: day(shiftMonth(cur, -i), 25), valor: 28000, juros: 4800, contaId: null, movId: null, nota: '' });
  const car = { id: uid(), nome: 'Renault Clio', matricula: '12-AB-34', combustivel: 'Gasolina 95' };
  S.vehicles.push(car);
  let km = 84000;
  for (let i = 0; i < 6; i++) { const dd = new Date(now.getTime() - (6 - i) * 14 * 86400000); const litros = 36 + r(0, 8); const preco = 1.72 + rnd() * 0.12; km += Math.round(litros / (6.1 + rnd() * 0.8) * 100); S.fuel.push({ id: uid(), veiculoId: car.id, data: toISO(dd), km, litros, total: Math.round(litros * preco * 100), cheio: true, posto: ['Galp', 'Repsol', 'Prio'][i % 3], contaId: null, movId: null }); }
  const today = toISO(now);
  const w = (produto, loja, dias, meses, valor) => { const dc = toISO(new Date(now.getTime() - dias * 86400000)); S.warranties.push({ id: uid(), produto, loja, dataCompra: dc, meses, validade: addMonthsISO(dc, meses), valor, notas: '', fotoId: null }); };
  w('Máquina de lavar roupa', 'Worten', 1095 - 20, 36, 42900); w('Televisor 55"', 'Fnac', 400, 36, 59900); w('Telemóvel', 'MEO', 800, 24, 34900); w('Aspirador', 'Radio Popular', 120, 24, 12900);
  const pr = (produto, loja, preco, dias, un = 'un') => S.prices.push({ id: uid(), produto, loja, preco, unidade: un, data: toISO(new Date(now.getTime() - dias * 86400000)), fonte: 'manual' });
  pr('Leite meio-gordo 1L', 'Continente', 79, 5); pr('Leite meio-gordo 1L', 'Pingo Doce', 85, 9); pr('Leite meio-gordo 1L', 'Lidl', 72, 3); pr('Leite meio-gordo 1L', 'Lidl', 69, 30);
  pr('Arroz agulha 1kg', 'Continente', 119, 6); pr('Arroz agulha 1kg', 'Lidl', 99, 4); pr('Arroz agulha 1kg', 'Pingo Doce', 129, 8);
  pr('Azeite virgem extra 750ml', 'Continente', 649, 12); pr('Azeite virgem extra 750ml', 'Pingo Doce', 599, 10); pr('Azeite virgem extra 750ml', 'Lidl', 579, 7);
  pr('Bananas', 'Pingo Doce', 129, 5, 'kg'); pr('Bananas', 'Lidl', 109, 5, 'kg');
  await save(...COLLS);
}
