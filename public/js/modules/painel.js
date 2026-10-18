import { S } from '../db.js';
import { ui } from '../state.js';
import { eur, esc, monthLabel, shiftMonth, monthShort, fmtDate, pct, num, curMonth } from '../util.js';
import { monthSummary, activeAccounts, accountBalance, totalBalance, totalDebt, activeDebts, debtSaldo, totalInstallments, sortMovs, movsOfMonth, catName, catIcon, accName, expiringWarranties, fuelStats, cat, debtProgress } from '../model.js';
import { donut, bars, color } from '../charts.js';
import { ICONS } from '../icons.js';
import { accountTypeInfo } from '../defaults.js';
import { movRow } from './movimentos.js';

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
    return `
    <div class="page-head"><div class="month-nav"><button class="icon-btn" data-m="-1" aria-label="Mês anterior">${ICONS.left}</button><h1 id="month-title">${monthLabel(key)}</h1><button class="icon-btn" data-m="1" aria-label="Mês seguinte">${ICONS.right}</button></div>${isCur ? '' : '<button class="btn small ghost" data-m="today">Hoje</button>'}</div>
    ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
    <section class="kpis">
      <div class="kpi"><small>Entradas</small><b class="pos" id="kpi-in">${eur(s.entradas)}</b></div>
      <div class="kpi"><small>Saídas</small><b class="neg" id="kpi-out">${eur(s.saidas)}</b></div>
      <div class="kpi"><small>Saldo do mês</small><b class="${saldoCls}" id="kpi-net">${eur(s.saldo)}</b></div>
    </section>
    <section class="card"><h2>Para onde vai o dinheiro</h2>
      ${s.saidas ? `<div class="donut-wrap">${donut(top, { centerTop: 'Saídas', centerBottom: eur(s.saidas) })}<div class="legend">${legend}</div></div>` : '<p class="muted center">Sem saídas registadas neste mês.</p>'}
    </section>
    <section class="card"><h2>Entradas vs. saídas</h2>${bars(groups)}<div class="chart-legend"><span><i style="background:var(--pos)"></i>Entradas</span><span><i style="background:var(--neg)"></i>Saídas</span></div></section>
    <div class="grid2">
    <section class="card"><div class="card-h"><h2>Contas</h2><a href="#/contas" class="link">Ver</a></div>${accRows || '<p class="muted">Sem contas.</p>'}<div class="row total"><span class="grow">Total</span><b id="kpi-total" class="${totalBalance() < 0 ? 'neg' : ''}">${eur(totalBalance())}</b></div></section>
    <section class="card"><div class="card-h"><h2>Dívidas</h2><a href="#/dividas" class="link">Ver</a></div>
      ${S.debts.length ? `<div class="big" id="kpi-debt">${eur(dv)}</div><small class="muted">em dívida · ${ds.length} ativa${ds.length === 1 ? '' : 's'} · prestações ${eur(totalInstallments())}/mês</small><div class="progress"><div style="width:${prog}%"></div></div><small class="muted">${prog}% já pago</small>` : '<p class="muted">Sem dívidas registadas. 🎉</p><span id="kpi-debt" hidden>0</span>'}
    </section></div>
    ${fs && fs.rows.length ? `<section class="card"><div class="card-h"><h2>Combustível</h2><a href="#/combustivel" class="link">Ver</a></div><div class="mini-stats"><div><small>Consumo médio</small><b>${fs.mediaL100 ? num(fs.mediaL100, 1) + ' L/100km' : '—'}</b></div><div><small>Preço médio</small><b>${fs.eurLMedio ? num(fs.eurLMedio, 3) + ' €/L' : '—'}</b></div><div><small>Custo por km</small><b>${fs.custoKm ? num(fs.custoKm, 3) + ' €' : '—'}</b></div></div></section>` : ''}
    <section class="card"><div class="card-h"><h2>Últimos movimentos</h2><a href="#/movimentos?mes=${key}" class="link">Ver tudo</a></div>${ms.length ? ms.map(movRow).join('') : '<p class="muted center">Ainda sem movimentos neste mês. Toque em ＋ para registar.</p>'}</section>`;
  },
  mount(el, ctx) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) { const v = b.dataset.m; ui.month = v === 'today' ? curMonth() : shiftMonth(ui.month, Number(v)); ctx.rerender(); return; }
      const mv = e.target.closest('[data-mov]');
      if (mv) import('./movimentos.js').then((m) => m.openMovementForm({ id: mv.dataset.mov }));
    });
  },
};
