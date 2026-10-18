import { S, save } from '../db.js';
import { ui } from '../state.js';
import { eur, esc, fmtDate, today, monthLabel, shiftMonth, curMonth, parseEuro, centsToInput, weekdayLabel, sum, norm } from '../util.js';
import { sortMovs, catName, catIcon, accName, upsertMovement, removeMovement, activeAccounts } from '../model.js';
import { fld, inp, sel, money, formModal, empty, toast, openModal } from '../ui.js';
import { ICONS } from '../icons.js';

const LABEL = { saida: 'Saída', entrada: 'Entrada', transferencia: 'Transferência' };

export function movRow(m) {
  const tr = m.tipo === 'transferencia';
  const title = tr ? `Transferência` : catName(m.categoriaId);
  const sub = tr ? `${esc(accName(m.contaId))} → ${esc(accName(m.contaDestinoId))}` : esc(accName(m.contaId));
  const amount = tr ? `<b class="muted">${eur(m.valor)}</b>` : `<b class="${m.tipo === 'entrada' ? 'pos' : 'neg'}">${m.tipo === 'entrada' ? '+' : '−'}${eur(m.valor)}</b>`;
  return `<button class="row mov" data-mov="${m.id}"><span class="ico-round">${tr ? '🔁' : catIcon(m.categoriaId)}</span><span class="grow"><span class="t">${esc(title)}</span><small>${sub} · ${fmtDate(m.data)}${m.nota ? ' · ' + esc(m.nota) : ''}</small></span>${amount}</button>`;
}

export function openMovementForm(preset = {}) {
  const edit = preset.id ? S.movements.find((m) => m.id === preset.id) : null;
  const m = edit || { tipo: preset.tipo || 'saida', data: today(), contaId: preset.contaId || activeAccounts()[0]?.id, ...preset };
  const accOpts = S.accounts.filter((a) => !a.arquivada || a.id === m.contaId || a.id === m.contaDestinoId).map((a) => ({ v: a.id, t: a.nome }));
  const catOpts = (tipo) => S.categories.filter((c) => c.tipo === tipo).map((c) => ({ v: c.id, t: `${c.icone} ${c.nome}` }));
  const seg = Object.entries(LABEL).map(([v, t]) => `<label class="seg-opt ${v}"><input type="radio" name="tipo" value="${v}" ${m.tipo === v ? 'checked' : ''}><span>${t}</span></label>`).join('');
  const html = `
    <div class="seg" role="radiogroup" aria-label="Tipo">${seg}</div>
    ${fld('Valor (€)', money('valor', centsToInput(m.valor), 'required autofocus'))}
    ${fld('Data', inp('data', m.data, 'type="date" required'))}
    <div data-for="cat">${fld('Categoria', sel('categoriaId', catOpts(m.tipo === 'transferencia' ? 'saida' : m.tipo), m.categoriaId))}</div>
    ${fld('<span data-lbl="conta">Conta</span>', sel('contaId', accOpts, m.contaId))}
    <div data-for="dest">${fld('Conta de destino', sel('contaDestinoId', accOpts, m.contaDestinoId || accOpts.find((o) => o.v !== m.contaId)?.v))}</div>
    ${fld('Nota (opcional)', inp('nota', m.nota || '', 'maxlength="200" placeholder="Ex.: compras da semana"'))}
    ${edit?.ligacao ? '<p class="hint">Este movimento está ligado a outro registo (dívida, combustível ou talão). Alterações aqui não atualizam esse registo.</p>' : ''}`;
  formModal({
    title: edit ? 'Editar movimento' : 'Novo movimento', html, submit: edit ? 'Guardar' : 'Adicionar',
    onDelete: edit ? () => { removeMovement(edit.id); save('movements'); toast('Movimento apagado'); } : null,
    onMount(form) {
      const apply = () => {
        const tipo = form.tipo.value;
        form.querySelector('[data-for=cat]').hidden = tipo === 'transferencia';
        form.querySelector('[data-for=dest]').hidden = tipo !== 'transferencia';
        form.querySelector('[data-lbl=conta]').textContent = tipo === 'transferencia' ? 'Conta de origem' : 'Conta';
        if (tipo !== 'transferencia') {
          const cur = form.categoriaId.value;
          form.categoriaId.innerHTML = catOpts(tipo).map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join('');
          if ([...form.categoriaId.options].some((o) => o.value === cur)) form.categoriaId.value = cur;
        }
      };
      form.querySelectorAll('[name=tipo]').forEach((r) => r.addEventListener('change', apply));
      apply();
      if (edit?.categoriaId) form.categoriaId.value = edit.categoriaId;
    },
    onSubmit(fd) {
      const tipo = fd.get('tipo');
      const valor = parseEuro(fd.get('valor'));
      if (!(valor > 0)) return 'Indique um valor maior que zero (ex.: 12,50).';
      const data = fd.get('data');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'Indique uma data válida.';
      const contaId = fd.get('contaId');
      if (!contaId) return 'Crie primeiro uma conta.';
      const rec = { tipo, valor, data, contaId, nota: (fd.get('nota') || '').trim() };
      if (tipo === 'transferencia') {
        rec.contaDestinoId = fd.get('contaDestinoId');
        if (!rec.contaDestinoId || rec.contaDestinoId === contaId) return 'Escolha uma conta de destino diferente da origem.';
        rec.categoriaId = null;
      } else { rec.categoriaId = fd.get('categoriaId'); rec.contaDestinoId = null; }
      upsertMovement(rec, edit?.id);
      save('movements');
      toast(edit ? 'Movimento atualizado' : tipo === 'transferencia' ? 'Transferência registada' : 'Movimento registado', 'ok');
    },
  });
}

function filtered() {
  const f = ui.mov;
  const q = norm(f.q);
  return sortMovs(S.movements.filter((m) =>
    (!f.mes || m.data.startsWith(f.mes)) &&
    (!f.tipo || m.tipo === f.tipo) &&
    (!f.cat || m.categoriaId === f.cat) &&
    (!f.conta || m.contaId === f.conta || m.contaDestinoId === f.conta) &&
    (!q || norm(m.nota).includes(q) || norm(catName(m.categoriaId)).includes(q))));
}

const MOV_TIPOS = [{ v: '', t: 'Todos os tipos' }, { v: 'entrada', t: 'Entradas' }, { v: 'saida', t: 'Saídas' }, { v: 'transferencia', t: 'Transferências' }];
// Nº de filtros ativos (o mês só conta se não for o mês atual)
export const activeFilterCount = (f = ui.mov) => (f.mes !== curMonth() ? 1 : 0) + (f.cat ? 1 : 0) + (f.conta ? 1 : 0) + (f.tipo ? 1 : 0);
function filterSummary(f = ui.mov) {
  const parts = [f.mes ? monthLabel(f.mes) : 'Todos os meses'];
  if (f.cat) parts.push(catName(f.cat));
  if (f.conta) parts.push(accName(f.conta));
  if (f.tipo) parts.push(MOV_TIPOS.find((t) => t.v === f.tipo)?.t || f.tipo);
  return parts.join(' · ');
}

// Folha de filtros: mês, categoria, conta e tipo
function openFilters(ctx) {
  const f = ui.mov;
  const cats = [{ v: '', t: 'Todas as categorias' }, ...S.categories.map((c) => ({ v: c.id, t: `${c.icone} ${c.nome}${c.tipo === 'entrada' ? ' (entrada)' : ''}` }))];
  const accs = [{ v: '', t: 'Todas as contas' }, ...S.accounts.map((a) => ({ v: a.id, t: a.nome }))];
  const html = `<div class="month-nav small"><button type="button" class="icon-btn" data-fm="-1" aria-label="Mês anterior" title="Mês anterior">${ICONS.left}</button><b id="fs-month"></b><button type="button" class="icon-btn" data-fm="1" aria-label="Mês seguinte" title="Mês seguinte">${ICONS.right}</button><button type="button" class="btn small ghost" data-fm="all"></button></div>
    ${fld('Categoria', sel('cat', cats, f.cat))}${fld('Conta', sel('conta', accs, f.conta))}${fld('Tipo', sel('tipo', MOV_TIPOS, f.tipo))}
    <div class="actions"><button type="button" class="btn ghost" data-reset>Limpar filtros</button><span class="grow"></span><button type="button" class="btn primary" data-done>Ver resultados</button></div>`;
  openModal('Filtros', html, {
    sheet: true,
    onMount(el, close) {
      const paint = () => {
        const fm = ui.mov.mes;
        el.querySelector('#fs-month').textContent = fm ? monthLabel(fm) : 'Todos os meses';
        el.querySelectorAll('[data-fm="-1"],[data-fm="1"]').forEach((b) => { b.disabled = !fm; });
        el.querySelector('[data-fm=all]').textContent = fm ? 'Ver tudo' : 'Mês atual';
        for (const n of ['cat', 'conta', 'tipo']) el.querySelector(`[name=${n}]`).value = ui.mov[n];
      };
      paint();
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-fm]');
        if (b) { const v = b.dataset.fm; ui.mov.mes = v === 'all' ? (ui.mov.mes ? '' : curMonth()) : shiftMonth(ui.mov.mes, Number(v)); paint(); ctx.rerender(); return; }
        if (e.target.closest('[data-reset]')) { Object.assign(ui.mov, { mes: curMonth(), cat: '', conta: '', tipo: '' }); paint(); ctx.rerender(); return; }
        if (e.target.closest('[data-done]')) close();
      });
      el.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { ui.mov[s.name] = s.value; ctx.rerender(); }));
    },
    onClose: () => document.querySelector('[data-filters]')?.focus(),
  });
}

function listHtml() {
  const list = filtered();
  const f = ui.mov;
  if (!list.length) return empty('🔎', 'Sem movimentos', S.movements.length ? 'Nenhum movimento corresponde a estes filtros.' : 'Ainda não registou nenhum movimento.', '<button class="btn primary" data-new>Registar movimento</button>');
  const ent = sum(list.filter((m) => m.tipo === 'entrada'), (m) => m.valor);
  const sai = sum(list.filter((m) => m.tipo === 'saida'), (m) => m.valor);
  let html = `<div class="sum-line" id="sum-line"><span>${list.length} movimento${list.length === 1 ? '' : 's'}</span><span>Entradas <b class="pos">${eur(ent)}</b></span><span>Saídas <b class="neg">${eur(sai)}</b></span><span>Saldo <b class="${ent - sai < 0 ? 'neg' : 'pos'}">${eur(ent - sai)}</b></span></div>`;
  let day = '';
  for (const m of list) {
    if (m.data !== day) { if (day) html += '</section>'; day = m.data; html += `<section class="day"><h3>${weekdayLabel(m.data)}, ${fmtDate(m.data)}</h3>`; }
    html += movRow(m);
  }
  return html + '</section>';
}

export default {
  id: 'movimentos', titulo: 'Movimentos', icone: 'movimentos',
  render(ctx) {
    if ([...ctx.params.keys()].length) {
      const p = ctx.params;
      ui.mov = { mes: p.has('mes') ? p.get('mes') : curMonth(), cat: p.get('cat') || '', conta: p.get('conta') || '', tipo: p.get('tipo') || '', q: '' };
      history.replaceState(null, '', '#/movimentos');
    }
    const f = ui.mov;
    const n = activeFilterCount();
    return `<div class="page-head"><h1 class="page-title">Movimentos</h1><div class="btn-row"><a class="btn ghost small" id="btn-importar" href="#/importar?novo=1">${ICONS.importar} Importar extrato</a><button class="btn primary small" data-new>${ICONS.plus} Novo</button></div></div>
    <div class="searchbar"><input type="search" name="q" value="${esc(f.q)}" placeholder="Pesquisar nota…" aria-label="Pesquisar"><button type="button" class="btn filter-btn" data-filters aria-haspopup="dialog" aria-label="Filtros${n ? `, ${n} ativo${n === 1 ? '' : 's'}` : ''}">${ICONS.filtros}<span>Filtros</span>${n ? `<b class="fcount" id="fcount">${n}</b>` : ''}</button></div>
    <p class="filter-sum small muted"><span id="mov-month">${esc(filterSummary())}</span>${n ? ' <button type="button" class="link btn-link" data-clear>Limpar filtros</button>' : ''}</p>
    <div id="mov-list">${listHtml()}</div>`;
  },
  mount(el, ctx) {
    const listEl = el.querySelector('#mov-list');
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-filters]')) return openFilters(ctx);
      if (e.target.closest('[data-clear]')) { Object.assign(ui.mov, { mes: curMonth(), cat: '', conta: '', tipo: '' }); return ctx.rerender(); }
      const mv = e.target.closest('[data-mov]'); if (mv) return openMovementForm({ id: mv.dataset.mov });
      if (e.target.closest('[data-new]')) return openMovementForm({ contaId: ui.mov.conta || undefined });
    });
    el.querySelector('[name=q]').addEventListener('input', (e) => { ui.mov.q = e.target.value; listEl.innerHTML = listHtml(); });
  },
};
