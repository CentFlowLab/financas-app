import { S } from '../db.js';
import { ui } from '../state.js';
import { eur, esc, monthLabel, shiftMonth, monthShort, fmtDate, pct, num, curMonth } from '../util.js';
import { monthSummary, activeAccounts, accountBalance, totalBalance, totalDebt, activeDebts, debtSaldo, totalInstallments, sortMovs, movsOfMonth, catName, catIcon, accName, expiringWarranties, fuelStats, cat, debtProgress, monthComparison, budgetRows } from '../model.js';
import { donut, bars, color } from '../charts.js';
import { ICONS } from '../icons.js';
import { accountTypeInfo } from '../defaults.js';
import { movRow } from './movimentos.js';
import { openQuickExpense } from '../quick.js';
import { openBudgetSheet } from './categorias.js';
import { scanFile } from './taloes.js';
import { fillForm } from './combustivel.js';

// Variação face ao mês anterior: seta + %, cor consoante seja bom/mau, e texto completo para leitores de ecrã
function deltaHtml(label, c, cmp, { noun = 'face a' } = {}) {
  const prevName = monthLabel(cmp.prevKey);
  const periodo = cmp.day ? ` (até ao dia ${cmp.day})` : '';
  if (c.dir === 'none') return `<span class="delta flat" data-delta="none" aria-label="${label}: sem dados do mês anterior" title="Sem movimentos em ${prevName}">Sem mês anterior</span>`;
  const desc = c.dir === 'flat' ? 'igual' : c.dir === 'new' ? `${c.arrow === '↑' ? 'subiu' : 'desceu'} (sem valor de referência)` : `${c.dir === 'up' ? 'subiu' : 'desceu'} ${c.text}`;
  return `<span class="delta ${c.tone}" data-delta="${c.dir}" aria-label="${label}: ${desc} ${noun} ${prevName}${periodo}" title="${prevName}${periodo}: ${eur(cmp.prevValue[label])}"><span aria-hidden="true">${c.arrow} ${c.text}</span> <small aria-hidden="true">vs. ${monthShort(cmp.prevKey)}</small></span>`;
}

function budgetsHtml(key) {
  const rows = budgetRows(key);
  if (!rows.length) return `<div class="budgets"><p class="hint">Defina um orçamento mensal por categoria e acompanhe aqui o que já gastou. <button type="button" class="link btn-link" data-budgets>Definir orçamentos</button></p></div>`;
  const note = (r) => r.estado === 'over' ? `Excedeu ${eur(-r.restante)}` : r.estado === 'near' ? `Perto do limite — restam ${eur(r.restante)}` : `Restam ${eur(r.restante)}`;
  return `<div class="budgets"><div class="card-h"><h3>Orçamento mensal</h3><button type="button" class="link btn-link" data-budgets>Editar orçamentos</button></div>${rows.map((r) => `<a class="bud ${r.estado}" data-budget="${r.cat.id}" href="#/movimentos?mes=${key}&cat=${r.cat.id}&tipo=saida"><span class="bud-h"><span class="grow">${esc(r.cat.icone)} ${esc(r.cat.nome)}</span><b>${eur(r.spent)} <small>de ${eur(r.budget)}</small></b></span><span class="bar" role="progressbar" aria-label="Orçamento de ${esc(r.cat.nome)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, r.pct)}" aria-valuetext="${r.pct} % do orçamento gasto"><i style="width:${Math.min(100, r.pct)}%"></i></span><small class="bud-note">${r.pct} % · ${note(r)}</small></a>`).join('')}</div>`;
}

export default {
  id: 'painel', titulo: 'Painel', icone: 'painel',
  render() {
    const key = ui.month;
    const s = monthSummary(key);
    const isCur = key === curMonth();
    // donut: top 6 + restantes
    const top = s.porCategoria.slice(0, 6).map((c, i) => ({ id: c.id, label: catName(c.id), value: c.total, color: color(i), icon: catIcon(c.id) }));
    const rest = s.porCategoria.slice(6);
    if (rest.length) top.push({ id: '', label: 'Outras categorias', value: rest.reduce((a, c) => a + c.total, 0), color: '#94a3b8', icon: '…' });
    const legend = top.map((t) => `<${t.id ? `a href="#/movimentos?mes=${key}&cat=${t.id}&tipo=saida"` : 'div'} class="legend-row"><i style="background:${t.color}"></i><span class="grow">${t.icon} ${esc(t.label)}</span><span class="muted">${pct((t.value / s.saidas) * 100, 0)}</span><b>${eur(t.value)}</b></${t.id ? 'a' : 'div'}>`).join('');
    // últimos 6 meses
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(key, i - 5));
    const groups = months.map((m) => { const x = monthSummary(m); return { label: monthShort(m), a: x.entradas, b: x.saidas }; });
    // contas
    const accs = activeAccounts();
    const accRows = accs.map((a) => { const b = accountBalance(a); return `<a href="#/movimentos?conta=${a.id}&mes=" class="row"><span class="ico-round">${accountTypeInfo(a.tipo).i}</span><span class="grow">${esc(a.nome)}</span><b class="${b < 0 ? 'neg' : ''}">${eur(b)}</b></a>`; }).join('');
    // dívidas
    const ds = activeDebts();
    const dv = totalDebt();
    const totalOrig = S.debts.reduce((a, d) => a + d.total, 0);
    const prog = totalOrig ? Math.round(((totalOrig - dv) / totalOrig) * 100) : 0;
    // alertas
    const exp = expiringWarranties();
    const alerts = exp.map((x) => `<a class="alert warn" href="#/garantias">🛡️ <span><b>${esc(x.w.produto)}</b> — garantia termina em ${x.dias} dia${x.dias === 1 ? '' : 's'} (${fmtDate(x.w.validade)})</span></a>`).join('');
    // combustível
    const veh = S.vehicles[0];
    const fs = veh ? fuelStats(veh.id) : null;
    const ms = sortMovs(movsOfMonth(key)).slice(0, 5);
    const saldoCls = s.saldo < 0 ? 'neg' : 'pos';
    const cmp = monthComparison(key);
    cmp.prevValue = { Entradas: cmp.prev.entradas, 'Saídas': cmp.prev.saidas, 'Saldo do mês': cmp.prev.saldo };
    const nExp = expiringWarranties().length;
    return `
    <div class="page-head"><div class="month-nav"><button class="icon-btn" data-m="-1" aria-label="Mês anterior" title="Mês anterior">${ICONS.left}</button><h1 id="month-title">${monthLabel(key)}</h1><button class="icon-btn" data-m="1" aria-label="Mês seguinte" title="Mês seguinte">${ICONS.right}</button></div>${isCur ? '' : '<button class="btn small ghost" data-m="today">Hoje</button>'}</div>
    ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
    <section class="kpis">
      <div class="kpi"><small>Entradas</small><b class="pos" id="kpi-in">${eur(s.entradas)}</b>${deltaHtml('Entradas', cmp.entradas, cmp)}</div>
      <div class="kpi"><small>Saídas</small><b class="neg" id="kpi-out">${eur(s.saidas)}</b>${deltaHtml('Saídas', cmp.saidas, cmp)}</div>
      <div class="kpi"><small>Saldo do mês</small><b class="${saldoCls}" id="kpi-net">${eur(s.saldo)}</b>${deltaHtml('Saldo do mês', cmp.saldo, cmp)}</div>
    </section>
    ${isCur && cmp.hasPrev ? `<p class="cmp-note small muted" id="cmp-note">Comparação com o mesmo período de ${monthLabel(cmp.prevKey)} (até ao dia ${cmp.day}).</p>` : ''}
    <nav class="quick" aria-label="Atalhos rápidos">
      <button type="button" class="qtile" data-quick="despesa">${ICONS.plus}<span>Despesa rápida</span></button>
      <button type="button" class="qtile" data-quick="talao">${ICONS.taloes}<span>Ler talão</span></button>
      <button type="button" class="qtile" data-quick="abastecer">${ICONS.combustivel}<span>Abastecimento</span></button>
      <a class="qtile" href="#/garantias" data-quick="garantias">${ICONS.garantias}<span>Garantias</span>${nExp ? `<b class="badge" aria-label="${nExp} a expirar">${nExp}</b>` : ''}</a>
    </nav>
    <a class="import-tile" id="tile-importar" href="#/importar?novo=1">${ICONS.importar}<span class="grow"><b>Importar extrato</b><small>CSV, Excel, OFX, QIF ou PDF do seu banco — cria contas e movimentos por si</small></span><span class="chev" aria-hidden="true">›</span></a>
    <input type="file" id="q-file" accept="image/*" capture="environment" hidden>
    <section class="card"><h2>Para onde vai o dinheiro</h2>
      ${s.saidas ? `<div class="donut-wrap">${donut(top, { centerTop: 'Saídas', centerBottom: eur(s.saidas) })}<div class="legend">${legend}</div></div>` : '<p class="muted center">Sem saídas registadas neste mês.</p>'}
      ${budgetsHtml(key)}
    </section>
    <section class="card"><h2>Entradas vs. saídas</h2>${bars(groups)}<div class="chart-legend"><span><i style="background:var(--pos)"></i>Entradas</span><span><i style="background:var(--neg)"></i>Saídas</span></div></section>
    <div class="grid2">
    <section class="card"><div class="card-h"><h2>Contas</h2><a href="#/contas" class="link">Ver</a></div>${accRows || '<p class="muted">Sem contas.</p>'}<div class="row total"><span class="grow">Total</span><b id="kpi-total" class="${totalBalance() < 0 ? 'neg' : ''}">${eur(totalBalance())}</b></div></section>
    <section class="card"><div class="card-h"><h2>Dívidas</h2><a href="#/dividas" class="link">Ver</a></div>
      ${S.debts.length ? `<div class="big" id="kpi-debt">${eur(dv)}</div><small class="muted">em dívida · ${ds.length} ativa${ds.length === 1 ? '' : 's'} · prestações ${eur(totalInstallments())}/mês</small><div class="progress"><div style="width:${prog}%"></div></div><small class="muted">${prog}% já pago</small>` : '<p class="muted">Sem dívidas registadas. 🎉</p><span id="kpi-debt" hidden>0</span>'}
    </section></div>
    ${fs && fs.rows.length ? `<section class="card"><div class="card-h"><h2>Combustível</h2><a href="#/combustivel" class="link">Ver</a></div><div class="mini-stats"><div><small>Consumo médio</small><b>${fs.mediaL100 ? num(fs.mediaL100, 1) + ' L/100km' : '—'}</b></div><div><small>Preço médio</small><b>${fs.eurLMedio ? num(fs.eurLMedio, 3) + ' €/L' : '—'}</b></div><div><small>Custo por km</small><b>${fs.custoKm ? num(fs.custoKm, 3) + ' €' : '—'}</b></div></div></section>` : ''}
    <section class="card"><div class="card-h"><h2>Últimos movimentos</h2><a href="#/movimentos?mes=${key}" class="link">Ver tudo</a></div>${ms.length ? ms.map(movRow).join('') : '<p class="muted center">Ainda sem movimentos neste mês. Toque em «Despesa rápida» para registar.</p>'}</section>`;
  },
  mount(el, ctx) {
    const file = el.querySelector('#q-file');
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) scanFile(f); });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-budgets]')) return openBudgetSheet();
      const q = e.target.closest('button[data-quick]');
      if (q) {
        if (q.dataset.quick === 'despesa') return openQuickExpense();
        if (q.dataset.quick === 'talao') return file.click();
        if (q.dataset.quick === 'abastecer') return S.vehicles.length ? fillForm(S.vehicles.find((v) => v.id === ui.fuelVehicle)?.id || S.vehicles[0].id) : ctx.go('#/combustivel');
      }
      const b = e.target.closest('[data-m]');
      if (b) { const v = b.dataset.m; ui.month = v === 'today' ? curMonth() : shiftMonth(ui.month, Number(v)); ctx.rerender(); return; }
      const mv = e.target.closest('[data-mov]');
      if (mv) import('./movimentos.js').then((m) => m.openMovementForm({ id: mv.dataset.mov }));
    });
  },
};
