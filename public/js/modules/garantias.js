import { S, save, putImage, imageURL, dropImageIfUnused } from '../db.js';
import { eur, esc, parseEuro, centsToInput, uid, today, fmtDate, addMonthsISO } from '../util.js';
import { warrantyStatus, expiringWarranties } from '../model.js';
import { fld, inp, sel, money, formModal, openModal, toast, empty } from '../ui.js';
import { resizeImage } from '../image.js';
import { ICONS } from '../icons.js';

export function warrantyForm(id, preset = {}) {
  const edit = id ? S.warranties.find((w) => w.id === id) : null;
  const w = edit || { produto: '', loja: '', dataCompra: today(), meses: 36, valor: null, notas: '', fotoId: null, ...preset };
  let fotoId = w.fotoId, newBlob = null, removed = false;
  formModal({
    title: edit ? 'Editar garantia' : 'Nova garantia',
    html: `${fld('Produto', inp('produto', w.produto, 'required maxlength="80" placeholder="Ex.: Máquina de lavar roupa"'))}
      ${fld('Loja (opcional)', inp('loja', w.loja || '', 'maxlength="60"'))}
      ${fld('Data da compra', inp('dataCompra', w.dataCompra, 'type="date" required'))}
      ${fld('Duração da garantia (meses)', inp('meses', w.meses, 'type="number" min="1" max="240" required'), 'Em Portugal, os bens novos têm 3 anos (36 meses) de garantia legal.')}
      <p class="hint" id="w-end"></p>
      ${fld('Valor pago (€, opcional)', money('valor', centsToInput(w.valor)))}
      ${fld('Notas (nº de série, contactos de assistência…)', `<textarea name="notas" rows="2" maxlength="400">${esc(w.notas || '')}</textarea>`)}
      <div class="fld"><span>Foto do talão / fatura</span><div id="foto-box" class="foto-box"></div>
      <div class="btn-row"><label class="btn ghost small">${ICONS.camera} Tirar / escolher foto<input type="file" name="foto" accept="image/*" hidden></label><button type="button" class="btn ghost small" id="foto-rm" hidden>Remover foto</button></div></div>`,
    async onMount(form) {
      const end = () => { const d = form.dataCompra.value, m = parseInt(form.meses.value, 10); form.querySelector('#w-end').textContent = d && m > 0 ? `Garantia válida até ${fmtDate(addMonthsISO(d, m))}.` : ''; };
      form.dataCompra.addEventListener('input', end); form.meses.addEventListener('input', end); end();
      const box = form.querySelector('#foto-box'), rm = form.querySelector('#foto-rm');
      const show = async () => {
        const u = newBlob ? URL.createObjectURL(newBlob) : (fotoId && !removed ? await imageURL(fotoId) : null);
        box.innerHTML = u ? `<img src="${u}" alt="Foto do talão" class="thumb-lg">` : '<small class="muted">Sem foto.</small>';
        rm.hidden = !u;
        box.querySelector('img')?.addEventListener('click', () => openModal('Foto', `<img src="${u}" alt="Foto do talão" class="full-img">`, { wide: true }));
      };
      await show();
      form.foto.addEventListener('change', async () => { const f = form.foto.files[0]; if (!f) return; try { newBlob = await resizeImage(f); removed = false; await show(); } catch (e) { form.showError(e.message); } });
      rm.addEventListener('click', () => { newBlob = null; removed = true; show(); });
    },
    onDelete: edit ? async () => { S.warranties = S.warranties.filter((x) => x.id !== id); await save('warranties'); await dropImageIfUnused(edit.fotoId); toast('Garantia apagada'); } : null,
    async onSubmit(fd) {
      const produto = (fd.get('produto') || '').trim(); if (!produto) return 'Indique o produto.';
      const dataCompra = fd.get('dataCompra'); if (!dataCompra) return 'Indique a data da compra.';
      const meses = parseInt(fd.get('meses'), 10); if (!(meses > 0)) return 'Indique a duração em meses.';
      const valor = fd.get('valor').trim() ? parseEuro(fd.get('valor')) : null; if (Number.isNaN(valor)) return 'Valor inválido.';
      let novoFoto = fotoId;
      if (newBlob) novoFoto = await putImage(newBlob); else if (removed) novoFoto = null;
      const rec = { produto, loja: (fd.get('loja') || '').trim(), dataCompra, meses, validade: addMonthsISO(dataCompra, meses), valor, notas: (fd.get('notas') || '').trim(), fotoId: novoFoto };
      const old = edit?.fotoId;
      if (edit) Object.assign(edit, rec); else S.warranties.push({ id: uid(), ...rec });
      await save('warranties');
      if (old && old !== novoFoto) await dropImageIfUnused(old);
      toast('Garantia guardada', 'ok');
    },
  });
}

const FILTERS = [['todas', 'Todas'], ['a-expirar', 'A expirar'], ['valida', 'Válidas'], ['expirada', 'Expiradas']];
let filter = 'todas';

export default {
  id: 'garantias', titulo: 'Garantias', icone: 'garantias', descricao: 'Prazos e alertas',
  badge: () => expiringWarranties().length || '',
  render() {
    const all = S.warranties.map((w) => ({ w, ...warrantyStatus(w) })).sort((a, b) => a.w.validade.localeCompare(b.w.validade));
    const list = all.filter((x) => filter === 'todas' || x.estado === filter);
    const label = (x) => x.estado === 'expirada' ? `Expirou há ${-x.dias} dia${x.dias === -1 ? '' : 's'}` : x.dias === 0 ? 'Termina hoje' : `Faltam ${x.dias} dia${x.dias === 1 ? '' : 's'}`;
    const chip = { 'a-expirar': 'warn', valida: 'ok', expirada: 'bad' };
    return `<div class="page-head"><h1 class="page-title">Garantias</h1><button class="btn primary small" data-new>${ICONS.plus} Nova</button></div>
    ${S.warranties.length ? `<div class="pills" role="tablist">${FILTERS.map(([v, t]) => `<button class="pill ${filter === v ? 'on' : ''}" data-f="${v}">${t}${v !== 'todas' ? ` (${all.filter((x) => x.estado === v).length})` : ` (${all.length})`}</button>`).join('')}</div>
    ${list.length ? list.map((x) => `<button class="card w-card" data-edit="${x.w.id}"><span class="ico-round big">${x.w.fotoId ? '🧾' : '🛡️'}</span><span class="grow"><span class="t">${esc(x.w.produto)}</span><small>Comprado a ${fmtDate(x.w.dataCompra)}${x.w.loja ? ' · ' + esc(x.w.loja) : ''}${x.w.valor ? ' · ' + eur(x.w.valor) : ''}</small><small>Válida até <b>${fmtDate(x.w.validade)}</b></small></span><span class="chip ${chip[x.estado]}">${label(x)}</span></button>`).join('') : '<p class="muted center">Nada neste filtro.</p>'}`
    : empty('🛡️', 'Controlo de garantias', 'Guarde produtos, prazos e a foto do talão. A app avisa quando uma garantia está a acabar.', '<button class="btn primary" data-new>Adicionar garantia</button>')}`;
  },
  mount(el, ctx) {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) return warrantyForm();
      const ed = e.target.closest('[data-edit]'); if (ed) return warrantyForm(ed.dataset.edit);
      const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; ctx.rerender(); }
    });
  },
};
