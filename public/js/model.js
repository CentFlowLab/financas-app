// Lógica de negócio: saldos, resumos, dívidas, combustível, garantias, preços
import { S, save } from './db.js';
import { uid, sum, monthKey, addMonthsISO, daysBetween, today, shiftMonth, norm } from './util.js';
import { CAT_DEBT } from './defaults.js';

export const acc = (id) => S.accounts.find((a) => a.id === id);
export const cat = (id) => S.categories.find((c) => c.id === id);
export const accName = (id) => acc(id)?.nome || '(conta removida)';
export const catName = (id) => cat(id)?.nome || 'Sem categoria';
export const catIcon = (id) => cat(id)?.icone || '📦';

// ---------- contas ----------
export function accountBalance(a, upTo) {
  let b = a.saldoInicial || 0;
  for (const m of S.movements) {
    if (upTo && m.data > upTo) continue;
    if (m.tipo === 'entrada' && m.contaId === a.id) b += m.valor;
    else if (m.tipo === 'saida' && m.contaId === a.id) b -= m.valor;
    else if (m.tipo === 'transferencia') { if (m.contaId === a.id) b -= m.valor; if (m.contaDestinoId === a.id) b += m.valor; }
  }
  return b;
}
export const activeAccounts = () => S.accounts.filter((a) => !a.arquivada);
export const totalBalance = () => sum(activeAccounts(), accountBalance);

// ---------- movimentos ----------
export const sortMovs = (arr) => [...arr].sort((a, b) => (b.data.localeCompare(a.data)) || (b.criadoEm || '').localeCompare(a.criadoEm || ''));
export const movsOfMonth = (key) => S.movements.filter((m) => monthKey(m.data) === key);
export function monthSummary(key) {
  const ms = movsOfMonth(key);
  const entradas = sum(ms.filter((m) => m.tipo === 'entrada'), (m) => m.valor);
  const saidas = sum(ms.filter((m) => m.tipo === 'saida'), (m) => m.valor);
  const by = new Map();
  for (const m of ms) if (m.tipo === 'saida') by.set(m.categoriaId, (by.get(m.categoriaId) || 0) + m.valor);
  const porCategoria = [...by].map(([id, total]) => ({ id, total })).sort((a, b) => b.total - a.total);
  return { entradas, saidas, saldo: entradas - saidas, porCategoria };
}

export function upsertMovement(data, id) {
  if (id) { const m = S.movements.find((x) => x.id === id); Object.assign(m, data); return m; }
  const m = { id: uid(), criadoEm: new Date().toISOString(), ...data };
  S.movements.push(m);
  return m;
}
export const removeMovement = (id) => { S.movements = S.movements.filter((m) => m.id !== id); };

// Sincroniza o movimento ligado a uma entidade (abastecimento, talão, pagamento): cria, atualiza ou remove
export function syncLinkedMovement(entity, spec) {
  const existing = entity.movId && S.movements.find((m) => m.id === entity.movId);
  if (!spec) { if (existing) removeMovement(existing.id); entity.movId = null; return; }
  const m = upsertMovement({ tipo: 'saida', ...spec }, existing?.id);
  entity.movId = m.id;
}

// ---------- dívidas ----------
export const debtPayments = (id) => S.debtPayments.filter((p) => p.debtId === id).sort((a, b) => b.data.localeCompare(a.data));
export const debtSaldo = (d) => Math.max(0, d.saldoInicial - sum(S.debtPayments.filter((p) => p.debtId === d.id), (p) => p.valor - (p.juros || 0)));
export const debtPaid = (d) => Math.max(0, d.total - debtSaldo(d));
export const debtProgress = (d) => (d.total > 0 ? Math.min(1, debtPaid(d) / d.total) : 0);
export const activeDebts = () => S.debts.filter((d) => debtSaldo(d) > 0);
export const totalDebt = () => sum(S.debts, debtSaldo);
export const totalInstallments = () => sum(activeDebts(), (d) => d.prestacao || 0);

// Simulação mês a mês. strategy: 'avalanche' (maior taxa primeiro) | 'bola' (menor saldo primeiro)
export function simulatePayoff(strategy, extra = 0, startMonth = shiftMonth(today().slice(0, 7), 1)) {
  const ds = activeDebts().map((d) => ({ id: d.id, nome: d.credor, saldo: debtSaldo(d), taxa: d.taxa || 0, min: d.prestacao || 0, fim: null, juros: 0 }));
  const budget = sum(ds, (d) => d.min) + extra;
  let month = 0, totalInterest = 0;
  if (!ds.length) return { meses: 0, juros: 0, fim: null, porDivida: [], impossivel: false };
  while (ds.some((d) => d.saldo > 0.5) && month < 600) {
    month++;
    for (const d of ds) if (d.saldo > 0) { const i = (d.saldo * d.taxa) / 1200; d.saldo += i; d.juros += i; totalInterest += i; }
    let avail = budget;
    for (const d of ds) if (d.saldo > 0) { const p = Math.min(d.min, d.saldo, avail); d.saldo -= p; avail -= p; }
    const order = ds.filter((d) => d.saldo > 0.5).sort(strategy === 'avalanche' ? (a, b) => b.taxa - a.taxa || a.saldo - b.saldo : (a, b) => a.saldo - b.saldo || b.taxa - a.taxa);
    for (const d of order) { if (avail <= 0) break; const p = Math.min(avail, d.saldo); d.saldo -= p; avail -= p; }
    for (const d of ds) if (d.saldo <= 0.5 && d.fim === null) { d.saldo = 0; d.fim = month; }
  }
  const impossivel = ds.some((d) => d.fim === null);
  return { meses: month, juros: Math.round(totalInterest), fim: impossivel ? null : shiftMonth(startMonth, month - 1), impossivel, budget, porDivida: ds.map((d) => ({ id: d.id, nome: d.nome, meses: d.fim, fim: d.fim ? shiftMonth(startMonth, d.fim - 1) : null, juros: Math.round(d.juros) })).sort((a, b) => (a.meses ?? 1e9) - (b.meses ?? 1e9)) };
}

// ---------- combustível ----------
export function fuelStats(vehicleId) {
  const fills = S.fuel.filter((f) => f.veiculoId === vehicleId).sort((a, b) => a.km - b.km || a.data.localeCompare(b.data));
  const out = []; let lastFull = null; let acc = 0, accCost = 0;
  for (const f of fills) {
    const row = { ...f, eurL: f.litros > 0 ? f.total / 100 / f.litros : 0, l100: null, custoKm: null, dist: null };
    if (lastFull) { acc += f.litros; accCost += f.total; }
    if (f.cheio) {
      if (lastFull && f.km > lastFull.km) { row.dist = f.km - lastFull.km; row.l100 = (acc / row.dist) * 100; row.custoKm = accCost / row.dist; }
      lastFull = f; acc = 0; accCost = 0;
    }
    out.push(row);
  }
  const withC = out.filter((r) => r.l100 != null);
  const dist = sum(withC, (r) => r.dist);
  return {
    rows: out,
    mediaL100: dist ? (sum(withC, (r) => r.l100 * r.dist) / dist) : null,
    ultimoL100: withC.length ? withC[withC.length - 1].l100 : null,
    eurLMedio: out.length ? sum(out, (r) => r.total) / 100 / sum(out, (r) => r.litros) : null,
    custoKm: dist ? sum(withC, (r) => r.custoKm * r.dist) / dist / 100 : null, // €/km
    totalGasto: sum(out, (r) => r.total),
    totalLitros: sum(out, (r) => r.litros),
  };
}

// ---------- garantias ----------
export const warrantyStatus = (w, ref = today()) => {
  const dias = daysBetween(ref, w.validade);
  const alerta = S.settings.alertaGarantiaDias ?? 60;
  return { dias, estado: dias < 0 ? 'expirada' : dias <= alerta ? 'a-expirar' : 'valida' };
};
export const expiringWarranties = () => S.warranties.map((w) => ({ w, ...warrantyStatus(w) })).filter((x) => x.estado === 'a-expirar').sort((a, b) => a.dias - b.dias);
export const warrantyEnd = (compra, meses) => addMonthsISO(compra, meses);

// ---------- preços ----------
export const prodKey = (s) => norm(s).replace(/\s+/g, ' ');
export function priceGroups() {
  const g = new Map();
  for (const p of S.prices) { const k = prodKey(p.produto) + '|' + (p.unidade || 'un'); if (!g.has(k)) g.set(k, { nome: p.produto, unidade: p.unidade || 'un', obs: [] }); g.get(k).obs.push(p); }
  return [...g.values()].map((x) => {
    const byStore = new Map();
    for (const o of [...x.obs].sort((a, b) => a.data.localeCompare(b.data))) byStore.set(norm(o.loja), o); // último preço por loja
    const lojas = [...byStore.values()].sort((a, b) => a.preco - b.preco);
    const hist = [...x.obs].sort((a, b) => a.data.localeCompare(b.data));
    return { ...x, lojas, barato: lojas[0], caro: lojas[lojas.length - 1], poupanca: lojas.length > 1 ? lojas[lojas.length - 1].preco - lojas[0].preco : 0, hist };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

// ---------- operações de alto nível ----------
export function addDebtPayment({ debtId, data, valor, juros = 0, contaId = null, nota = '' }) {
  const d = S.debts.find((x) => x.id === debtId);
  const p = { id: uid(), debtId, data, valor, juros, contaId, movId: null, nota };
  if (contaId) syncLinkedMovement(p, { categoriaId: CAT_DEBT, contaId, valor, data, nota: `Pagamento: ${d.credor}${nota ? ' — ' + nota : ''}`, ligacao: { tipo: 'divida', id: p.id } });
  S.debtPayments.push(p);
  return p;
}
export function deleteDebtPayment(id) {
  const p = S.debtPayments.find((x) => x.id === id);
  if (p?.movId) removeMovement(p.movId);
  S.debtPayments = S.debtPayments.filter((x) => x.id !== id);
}

export function summaryForAssistant(key) {
  const s = monthSummary(key);
  return { mes: key, entradas: s.entradas / 100, saidas: s.saidas / 100, porCategoria: s.porCategoria.map((c) => ({ categoria: catName(c.id), valor: c.total / 100 })), contas: activeAccounts().map((a) => ({ nome: a.nome, saldo: accountBalance(a) / 100 })), dividas: activeDebts().map((d) => ({ credor: d.credor, saldo: debtSaldo(d) / 100, taxa: d.taxa, prestacao: (d.prestacao || 0) / 100 })) };
}
export { save };
