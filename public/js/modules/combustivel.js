import { S, save } from '../db.js';
import { ui } from '../state.js';
import { eur, esc, parseEuro, parseDec, centsToInput, uid, today, fmtDate, num, curMonth, monthKey, sum } from '../util.js';
import { fuelStats, syncLinkedMovement, activeAccounts, removeMovement } from '../model.js';
import { fld, inp, sel, money, formModal, toast, empty } from '../ui.js';
import { line } from '../charts.js';
import { ICONS } from '../icons.js';
import { CAT_FUEL, FUEL_TYPES } from '../defaults.js';

function vehicleForm(id) {
  const v = id ? S.vehicles.find((x) => x.id === id) : { nome: '', matricula: '', combustivel: 'Gasolina 95' };
  formModal({
    title: id ? 'Editar veículo' : 'Novo veículo',
    html: `${fld('Nome', inp('nome', v.nome, 'required maxlength="40" placeholder="Ex.: Renault Clio"'))}${fld('Matrícula (opcional)', inp('matricula', v.matricula, 'maxlength="10" placeholder="00-AA-00"'))}${fld('Combustível', sel('combustivel', FUEL_TYPES.map((t) => ({ v: t, t })), v.combustivel))}`,
    onDelete: id ? () => {
      if (S.fuel.some((f) => f.veiculoId === id)) { toast('Apague primeiro os abastecimentos deste veículo.', 'err'); return; }
      S.vehicles = S.vehicles.filter((x) => x.id !== id); if (ui.fuelVehicle === id) ui.fuelVehicle = ''; save('vehicles'); toast('Veículo apagado');
    } : null,
    onSubmit(fd) {
      const nome = (fd.get('nome') || '').trim(); if (!nome) return 'Indique o nome do veículo.';
      const rec = { nome, matricula: (fd.get('matricula') || '').trim().toUpperCase(), combustivel: fd.get('combustivel') };
      if (id) Object.assign(v, rec); else { const nv = { id: uid(), ...rec }; S.vehicles.push(nv); ui.fuelVehicle = nv.id; }
      save('vehicles'); toast('Veículo guardado', 'ok');
    },
  });
}

export function fillForm(vehicleId, id) {
  const edit = id ? S.fuel.find((f) => f.id === id) : null;
  const vstats = fuelStats(vehicleId).rows;
  const lastKm = vstats.length ? vstats[vstats.length - 1].km : '';
  const f = edit || { data: today(), km: lastKm, litros: '', preco: '', total: null, cheio: true, posto: '', contaId: activeAccounts()[0]?.id || '', nota: '' };
  const accs = [{ v: '', t: 'Não registar como movimento' }, ...activeAccounts().map((a) => ({ v: a.id, t: `Debitar de: ${a.nome}` }))];
  const contaDefault = edit ? (edit.movId ? edit.contaId : '') : f.contaId;
  formModal({
    title: edit ? 'Editar abastecimento' : 'Novo abastecimento',
    html: `${fld('Data', inp('data', f.data, 'type="date" required'))}
      ${fld('Quilómetros no conta-quilómetros', inp('km', f.km, 'inputmode="numeric" required placeholder="Ex.: 84250"'))}
      <div class="grid3">${fld('Litros', inp('litros', f.litros === '' ? '' : String(f.litros).replace('.', ','), 'inputmode="decimal" placeholder="0,00"'))}${fld('€/litro', inp('preco', f.litros ? num(f.total / 100 / f.litros, 3) : '', 'inputmode="decimal" placeholder="0,000"'))}${fld('Total (€)', money('total', centsToInput(f.total)))}</div>
      <label class="check"><input type="checkbox" name="cheio" ${f.cheio ? 'checked' : ''}> Depósito cheio (necessário para calcular o consumo)</label>
      ${fld('Posto (opcional)', inp('posto', f.posto || '', 'maxlength="40" placeholder="Ex.: Galp, Repsol, Prio"'))}
      ${fld('Conta', sel('contaId', accs, contaDefault))}`,
    onMount(form) {
      const calc = (src) => {
        const l = parseDec(form.litros.value), p = parseDec(form.preco.value), t = parseEuro(form.total.value);
        if (src === 'total') { if (l > 0 && t > 0) form.preco.value = num(t / 100 / l, 3); }
        else if (l > 0 && p > 0) form.total.value = centsToInput(Math.round(l * p * 100));
        else if (src === 'litros' && l > 0 && t > 0) form.preco.value = num(t / 100 / l, 3);
      };
      ['litros', 'preco', 'total'].forEach((n) => form[n].addEventListener('input', () => calc(n)));
    },
    onDelete: edit ? () => { if (edit.movId) removeMovement(edit.movId); S.fuel = S.fuel.filter((x) => x.id !== id); save('fuel', 'movements'); toast('Abastecimento apagado'); } : null,
    onSubmit(fd) {
      const km = parseDec(fd.get('km'), true), litros = parseDec(fd.get('litros')), total = parseEuro(fd.get('total'));
      if (!fd.get('data')) return 'Indique a data.';
      if (!(km >= 0)) return 'Indique os quilómetros do conta-quilómetros.';
      if (!(litros > 0)) return 'Indique os litros abastecidos.';
      if (!(total > 0)) return 'Indique o total pago (ou o preço por litro).';
      const rec = { veiculoId: vehicleId, data: fd.get('data'), km, litros, total, cheio: !!fd.get('cheio'), posto: (fd.get('posto') || '').trim(), contaId: fd.get('contaId') || null };
      const target = edit || { id: uid(), movId: null };
      Object.assign(target, rec);
      syncLinkedMovement(target, rec.contaId ? { categoriaId: CAT_FUEL, contaId: rec.contaId, valor: total, data: rec.data, nota: `Abastecimento${rec.posto ? ' — ' + rec.posto : ''}`, ligacao: { tipo: 'combustivel', id: target.id } } : null);
      if (!edit) S.fuel.push(target);
      save('fuel', 'movements'); toast('Abastecimento guardado', 'ok');
    },
  });
}

export default {
  id: 'combustivel', titulo: 'Combustível', icone: 'combustivel', descricao: 'Consumo e custos',
  render() {
    if (!S.vehicles.length) return `<div class="page-head"><h1 class="page-title">Combustível</h1></div>${empty('⛽', 'Controlo de combustível', 'Registe os abastecimentos para saber o consumo (L/100 km), o preço médio (€/L) e o custo por quilómetro.', '<button class="btn primary" data-vnew>Adicionar veículo</button>')}`;
    if (!S.vehicles.some((v) => v.id === ui.fuelVehicle)) ui.fuelVehicle = S.vehicles[0].id;
    const v = S.vehicles.find((x) => x.id === ui.fuelVehicle);
    const st = fuelStats(v.id);
    const rows = [...st.rows].reverse();
    const pts = st.rows.filter((r) => r.l100 != null).map((r) => ({ label: fmtDate(r.data).slice(0, 5), v: r.l100 }));
    const ptsP = st.rows.map((r) => ({ label: fmtDate(r.data).slice(0, 5), v: r.eurL }));
    const mes = sum(st.rows.filter((r) => monthKey(r.data) === curMonth()), (r) => r.total);
    return `<div class="page-head"><h1 class="page-title">Combustível</h1><button class="btn primary small" data-fill>${ICONS.plus} Abastecer</button></div>
    <div class="veh-bar">${sel('veh', S.vehicles.map((x) => ({ v: x.id, t: x.nome + (x.matricula ? ` (${x.matricula})` : '') })), v.id, 'aria-label="Veículo"')}<button class="btn ghost small" data-vedit="${v.id}">Editar</button><button class="btn ghost small" data-vnew>＋ Veículo</button></div>
    <section class="kpis four">
      <div class="kpi"><small>Consumo médio</small><b id="fuel-avg">${st.mediaL100 ? num(st.mediaL100, 2) : '—'}</b><small>L/100 km</small></div>
      <div class="kpi"><small>Preço médio</small><b id="fuel-price">${st.eurLMedio ? num(st.eurLMedio, 3) : '—'}</b><small>€/L</small></div>
      <div class="kpi"><small>Custo por km</small><b>${st.custoKm ? num(st.custoKm, 3) : '—'}</b><small>€/km</small></div>
      <div class="kpi"><small>Este mês</small><b>${eur(mes)}</b><small>${eur(st.totalGasto)} no total</small></div>
    </section>
    ${pts.length ? `<section class="card"><h2>Consumo (L/100 km)</h2>${line(pts, { unit: 'L/100km' })}</section>` : st.rows.length ? '<section class="card"><p class="muted center">Precisa de pelo menos dois abastecimentos com depósito cheio para calcular o consumo.</p></section>' : ''}
    ${ptsP.length > 1 ? `<section class="card"><h2>Preço por litro (€/L)</h2>${line(ptsP, { unit: '€/L', decimals: 3, stroke: 'var(--warn)' })}</section>` : ''}
    <section class="card"><h2>Abastecimentos</h2>${rows.length ? rows.map((r) => `<button class="row" data-edit="${r.id}"><span class="ico-round">⛽</span><span class="grow"><span class="t">${num(r.litros, 2)} L · ${eur(r.total)}</span><small>${fmtDate(r.data)} · ${num(r.km, 0)} km · ${num(r.eurL, 3)} €/L${r.posto ? ' · ' + esc(r.posto) : ''}${r.cheio ? '' : ' · parcial'}</small></span><b>${r.l100 != null ? num(r.l100, 1) + ' L/100' : '—'}</b></button>`).join('') : '<p class="muted center">Sem abastecimentos ainda.</p>'}</section>`;
  },
  mount(el, ctx) {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-vnew]')) return vehicleForm();
      const ve = e.target.closest('[data-vedit]'); if (ve) return vehicleForm(ve.dataset.vedit);
      if (e.target.closest('[data-fill]')) return fillForm(ui.fuelVehicle);
      const ed = e.target.closest('[data-edit]'); if (ed) fillForm(ui.fuelVehicle, ed.dataset.edit);
    });
    el.querySelector('[name=veh]')?.addEventListener('change', (e) => { ui.fuelVehicle = e.target.value; ctx.rerender(); });
  },
};
