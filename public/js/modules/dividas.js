import { S, save } from '../db.js';
import { eur, esc, parseEuro, parseDec, centsToInput, uid, today, fmtDate, monthLabel, num, sum, pct } from '../util.js';
import { debtSaldo, debtPaid, debtProgress, debtPayments, activeDebts, totalDebt, totalInstallments, simulatePayoff, addDebtPayment, deleteDebtPayment, activeAccounts, accName, removeMovement } from '../model.js';
import { fld, inp, sel, money, formModal, openModal, toast, empty, confirmBox } from '../ui.js';
import { ICONS } from '../icons.js';

// Meses para liquidar uma dívida isolada só com a prestação habitual
function monthsAlone(d) {
  let s = debtSaldo(d); const min = d.prestacao || 0; let n = 0;
  if (s <= 0) return 0;
  while (s > 0.5 && n < 600) { s += (s * (d.taxa || 0)) / 1200; s -= Math.min(min, s); n++; if (min <= 0) return null; }
  return n >= 600 ? null : n;
}
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const durLabel = (m) => (m == null ? '—' : m >= 12 ? `${plural(Math.floor(m / 12), 'ano', 'anos')}${m % 12 ? ' e ' + plural(m % 12, 'mês', 'meses') : ''}` : plural(m, 'mês', 'meses'));

function debtForm(id) {
  const d = id ? S.debts.find((x) => x.id === id) : { credor: '', total: null, taxa: '', prestacao: null };
  const saldo = id ? debtSaldo(d) : null;
  formModal({
    title: id ? 'Editar dívida' : 'Nova dívida',
    html: `${fld('Credor', inp('credor', d.credor, 'required maxlength="60" placeholder="Ex.: Banco X — crédito automóvel"'))}
      ${fld('Valor total da dívida (€)', money('total', centsToInput(d.total)), 'O montante original; serve para calcular o progresso.')}
      ${fld('Saldo em dívida atual (€)', money('saldo', centsToInput(saldo)), 'Quanto ainda falta pagar. Se vazio, assume o valor total.')}
      ${fld('Taxa de juro anual (%)', inp('taxa', d.taxa === '' ? '' : String(d.taxa).replace('.', ','), 'inputmode="decimal" placeholder="0"'))}
      ${fld('Prestação mensal (€)', money('prestacao', centsToInput(d.prestacao)))}`,
    onDelete: id ? () => {
      for (const p of S.debtPayments.filter((x) => x.debtId === id)) if (p.movId) removeMovement(p.movId);
      S.debtPayments = S.debtPayments.filter((x) => x.debtId !== id); S.debts = S.debts.filter((x) => x.id !== id);
      save('debts', 'debtPayments', 'movements'); toast('Dívida apagada');
    } : null,
    onSubmit(fd) {
      const credor = (fd.get('credor') || '').trim();
      if (!credor) return 'Indique o credor.';
      const total = parseEuro(fd.get('total'));
      if (!(total > 0)) return 'Indique o valor total da dívida.';
      const saldoIn = fd.get('saldo').trim() ? parseEuro(fd.get('saldo')) : total;
      if (Number.isNaN(saldoIn) || saldoIn < 0) return 'Saldo em dívida inválido.';
      if (saldoIn > total) return 'O saldo em dívida não pode ser superior ao valor total.';
      const taxa = fd.get('taxa').trim() ? parseDec(fd.get('taxa')) : 0;
      if (Number.isNaN(taxa) || taxa < 0 || taxa > 100) return 'Taxa de juro inválida (0 a 100).';
      const prest = fd.get('prestacao').trim() ? parseEuro(fd.get('prestacao')) : 0;
      if (Number.isNaN(prest) || prest < 0) return 'Prestação inválida.';
      if (id) { const pagos = sum(S.debtPayments.filter((p) => p.debtId === id), (p) => p.valor - (p.juros || 0)); Object.assign(d, { credor, total, taxa, prestacao: prest, saldoInicial: saldoIn + pagos }); }
      else S.debts.push({ id: uid(), credor, total, saldoInicial: saldoIn, taxa, prestacao: prest, criadoEm: new Date().toISOString() });
      save('debts');
      toast(id ? 'Dívida atualizada' : 'Dívida registada', 'ok');
    },
  });
}

function paymentForm(id) {
  const d = S.debts.find((x) => x.id === id);
  const accs = [{ v: '', t: 'Não registar como movimento' }, ...activeAccounts().map((a) => ({ v: a.id, t: `Debitar de: ${a.nome}` }))];
  formModal({
    title: `Pagamento — ${d.credor}`,
    html: `<p class="muted">Em dívida: <b>${eur(debtSaldo(d))}</b></p>
      ${fld('Valor pago (€)', money('valor', centsToInput(Math.min(d.prestacao || 0, debtSaldo(d)) || null), 'required'))}
      ${fld('Data', inp('data', today(), 'type="date" required'))}
      ${fld('Dos quais juros/comissões (€, opcional)', money('juros'), 'Só a parte de capital reduz o saldo em dívida.')}
      ${fld('Conta', sel('contaId', accs, activeAccounts()[0]?.id || ''))}
      ${fld('Nota (opcional)', inp('nota', '', 'maxlength="100"'))}`,
    submit: 'Registar pagamento',
    onSubmit(fd) {
      const valor = parseEuro(fd.get('valor'));
      if (!(valor > 0)) return 'Indique o valor pago.';
      const juros = fd.get('juros').trim() ? parseEuro(fd.get('juros')) : 0;
      if (Number.isNaN(juros) || juros < 0 || juros > valor) return 'Os juros não podem ser superiores ao valor pago.';
      if (!fd.get('data')) return 'Indique a data.';
      addDebtPayment({ debtId: id, data: fd.get('data'), valor, juros, contaId: fd.get('contaId') || null, nota: (fd.get('nota') || '').trim() });
      save('debtPayments', 'movements');
      toast('Pagamento registado', 'ok');
    },
  });
}

function historyModal(id) {
  const d = S.debts.find((x) => x.id === id);
  const draw = (el) => {
    const ps = debtPayments(id);
    el.innerHTML = ps.length ? ps.map((p) => `<div class="row"><span class="grow"><span class="t">${fmtDate(p.data)}</span><small>${p.contaId ? esc(accName(p.contaId)) : 'Sem conta'}${p.juros ? ' · juros ' + eur(p.juros) : ''}${p.nota ? ' · ' + esc(p.nota) : ''}</small></span><b>${eur(p.valor)}</b><button class="icon-btn" data-delp="${p.id}" aria-label="Apagar pagamento">🗑️</button></div>`).join('') : '<p class="muted center">Sem pagamentos registados.</p>';
  };
  openModal(`Histórico — ${d.credor}`, '<div id="hist"></div>', { onMount(el) {
    const box = el.querySelector('#hist'); draw(box);
    box.addEventListener('click', async (e) => { const b = e.target.closest('[data-delp]'); if (b && await confirmBox('Apagar este pagamento? O saldo em dívida volta a aumentar.', { okLabel: 'Apagar', danger: true })) { deleteDebtPayment(b.dataset.delp); await save('debtPayments', 'movements'); draw(box); } });
  } });
}

export default {
  id: 'dividas', titulo: 'Dívidas', icone: 'dividas',
  render() {
    const ds = S.debts;
    const extra = S.settings.extraDivida || 0;
    const av = simulatePayoff('avalanche', extra), bo = simulatePayoff('bola', extra);
    const card = (d) => {
      const s = debtSaldo(d), p = Math.round(debtProgress(d) * 100), n = monthsAlone(d);
      return `<article class="card debt ${s <= 0 ? 'done' : ''}" data-id="${d.id}">
        <div class="card-h"><h2>${esc(d.credor)}</h2>${s <= 0 ? '<span class="chip ok">Liquidada ✓</span>' : `<b class="big-sm neg">${eur(s)}</b>`}</div>
        <div class="progress" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><div style="width:${p}%"></div></div>
        <div class="debt-meta"><span>${p}% pago (${eur(debtPaid(d))} de ${eur(d.total)})</span></div>
        <div class="chips"><span class="chip">Juro ${num(d.taxa || 0, 2)} %/ano</span><span class="chip">Prestação ${eur(d.prestacao || 0)}</span>${s > 0 ? `<span class="chip">${n == null ? 'Prestação não chega para liquidar' : 'Liquidada em ~' + durLabel(n)}</span>` : ''}</div>
        <div class="btn-row">${s > 0 ? `<button class="btn primary small" data-pay="${d.id}">Registar pagamento</button>` : ''}<button class="btn ghost small" data-hist="${d.id}">Histórico</button><button class="btn ghost small" data-edit="${d.id}">Editar</button></div></article>`;
    };
    const planCol = (r, nome, desc, best) => `<div class="plan ${best ? 'best' : ''}"><h3>${nome}${best ? ' <span class="chip ok">Menos juros</span>' : ''}</h3><small class="muted">${desc}</small>
      ${r.impossivel ? '<p class="neg">Com estas prestações há dívidas que nunca são liquidadas (a prestação não cobre os juros). Aumente o valor extra.</p>' : `<div class="plan-n"><b>${durLabel(r.meses)}</b><small>livre de dívidas em ${monthLabel(r.fim)}</small></div><div class="plan-n"><b>${eur(r.juros)}</b><small>juros totais</small></div>`}
      <ol class="order">${r.porDivida.map((x) => `<li><span>${esc(x.nome)}</span><small>${x.fim ? monthLabel(x.fim) : '—'}</small></li>`).join('')}</ol></div>`;
    const bestAv = !av.impossivel && (bo.impossivel || av.juros <= bo.juros);
    const act = activeDebts();
    return `<div class="page-head"><h1 class="page-title">Dívidas</h1><button class="btn primary small" data-new>${ICONS.plus} Nova dívida</button></div>
    ${ds.length ? `<section class="kpis two"><div class="kpi"><small>Total em dívida</small><b class="neg" id="debt-total">${eur(totalDebt())}</b></div><div class="kpi"><small>Prestações por mês</small><b id="debt-inst">${eur(totalInstallments())}</b></div></section>
    ${ds.map(card).join('')}
    ${act.length ? `<section class="card"><h2>Plano para sair das dívidas</h2>
      <p class="muted">Compare duas estratégias. Em ambas paga as prestações normais; o dinheiro "livre" (extra + prestações das dívidas já liquidadas) vai sempre para uma dívida-alvo.</p>
      <ul class="plain"><li><b>Avalanche</b>: ataca primeiro a dívida com a <b>maior taxa de juro</b> — poupa mais em juros.</li><li><b>Bola de neve</b>: ataca primeiro a dívida com o <b>menor saldo</b> — liquida dívidas mais depressa e dá motivação.</li></ul>
      ${fldExtra(extra)}
      <div class="plans" id="plans">${planCol(av, 'Avalanche', 'Maior taxa primeiro', bestAv)}${planCol(bo, 'Bola de neve', 'Menor saldo primeiro', !bestAv && !bo.impossivel)}</div>
      ${!av.impossivel && !bo.impossivel && bo.juros !== av.juros ? `<p class="hint" id="plan-diff">A avalanche poupa <b>${eur(bo.juros - av.juros)}</b> em juros face à bola de neve${bo.meses !== av.meses ? ` (${bo.meses > av.meses ? 'e termina ' + plural(bo.meses - av.meses, 'mês', 'meses') + ' mais cedo' : 'mas termina ' + plural(av.meses - bo.meses, 'mês', 'meses') + ' mais tarde'})` : ''}.</p>` : ''}
      ${!av.impossivel && !bo.impossivel && bo.juros === av.juros ? '<p class="hint" id="plan-diff">Neste cenário as duas estratégias dão o mesmo resultado. Experimente acrescentar um valor extra mensal para ver a diferença.</p>' : ''}
      <small class="muted">Estimativa simplificada: juros mensais = saldo × taxa anual ÷ 12, sem comissões nem seguros.</small></section>` : '<section class="card"><p class="center">🎉 Todas as dívidas estão liquidadas.</p></section>'}`
      : empty('💳', 'Sem dívidas registadas', 'Registe créditos, cartões ou empréstimos para acompanhar o progresso e planear a liquidação.', '<button class="btn primary" data-new>Nova dívida</button>')}`;
  },
  mount(el, ctx) {
    el.addEventListener('click', (e) => {
      const t = (a) => e.target.closest(`[${a}]`)?.getAttribute(a);
      if (e.target.closest('[data-new]')) return debtForm();
      if (t('data-edit')) return debtForm(t('data-edit'));
      if (t('data-pay')) return paymentForm(t('data-pay'));
      if (t('data-hist')) return historyModal(t('data-hist'));
    });
    el.querySelector('[name=extra]')?.addEventListener('change', (e) => {
      const v = e.target.value.trim() ? parseEuro(e.target.value) : 0;
      if (Number.isNaN(v) || v < 0) { toast('Valor extra inválido', 'err'); return; }
      S.settings.extraDivida = v; save('settings');
    });
  },
};
const fldExtra = (v) => fld('Valor extra por mês para dívidas (€)', money('extra', v ? centsToInput(v) : '', 'aria-label="Valor extra mensal"'), 'Quanto pode juntar, além das prestações normais.');
