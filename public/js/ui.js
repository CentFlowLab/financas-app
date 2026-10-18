// Componentes de UI partilhados: modais, formulários, avisos
import { esc, fmtDate } from './util.js';

export const fld = (label, inner, hint) => `<label class="fld"><span>${label}</span>${inner}${hint ? `<small>${hint}</small>` : ''}</label>`;
export const inp = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" ${attrs}>`;
export const sel = (name, opts, val, attrs = '') => `<select name="${name}" ${attrs}>${opts.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
export const money = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" inputmode="decimal" placeholder="0,00" autocomplete="off" ${attrs}>`;

export function openModal(title, bodyHtml, { onMount, wide, onClose, sheet } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${sheet ? 'sheet' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">${sheet ? '<span class="grabber" aria-hidden="true"></span>' : ''}<header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button></header><div class="modal-body">${bodyHtml}</div></div>`;
  document.body.appendChild(back);
  document.body.classList.add('noscroll');
  const close = () => {
    back.remove();
    if (onClose) onClose();
    document.removeEventListener('keydown', onKey);
    if (!document.querySelector('.modal-back')) document.body.classList.remove('noscroll');
  };
  const onKey = (e) => { if (e.key === 'Escape' && back === [...document.querySelectorAll('.modal-back')].pop()) close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelector('[data-close]').addEventListener('click', close);
  const body = back.querySelector('.modal-body');
  if (onMount) onMount(body, close);
  const first = body.querySelector('input:not([type=hidden]):not([type=file]),select,textarea');
  if (first && !matchMedia('(pointer:coarse)').matches) first.focus();
  return { el: body, close };
}

// Modal com formulário. onSubmit(fd, form, close) -> false/mensagem de erro para manter aberto
export function formModal({ title, html, submit = 'Guardar', onSubmit, onMount, onDelete, deleteLabel = 'Apagar', wide, sheet }) {
  const body = `<form class="form" novalidate>${html}<p class="form-error" role="alert" hidden></p><div class="actions">${onDelete ? `<button type="button" class="btn danger" data-delete>${deleteLabel}</button>` : ''}<span class="grow"></span><button type="button" class="btn ghost" data-close2>Cancelar</button><button class="btn primary" type="submit">${submit}</button></div></form>`;
  return openModal(title, body, {
    wide, sheet,
    onMount: (el, close) => {
      const form = el.querySelector('form');
      const err = form.querySelector('.form-error');
      form.showError = (msg) => { err.textContent = msg; err.hidden = !msg; };
      enhanceDates(form);
      form.querySelector('[data-close2]').addEventListener('click', close);
      if (onDelete) form.querySelector('[data-delete]').addEventListener('click', async () => { if (await confirmBox('Tem a certeza que quer apagar? Esta ação não pode ser anulada.', { okLabel: 'Apagar', danger: true })) { await onDelete(); close(); } });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        form.showError('');
        const r = await onSubmit(new FormData(form), form, close);
        if (typeof r === 'string') form.showError(r);
        else if (r !== false) close();
      });
      if (onMount) onMount(form, close);
    },
  });
}

export function confirmBox(msg, { okLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    openModal('Confirmar', `<p>${esc(msg)}</p><div class="actions"><span class="grow"></span><button class="btn ghost" data-no>Cancelar</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-yes>${esc(okLabel)}</button></div>`, {
      onClose: () => resolve(false),
      onMount: (el, close) => {
        el.querySelector('[data-no]').onclick = close;
        el.querySelector('[data-yes]').onclick = () => { resolve(true); close(); };
      },
    });
  });
}

export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2800);
  setTimeout(() => t.remove(), 3300);
}

export function download(filename, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const empty = (icon, title, text, btn) => `<div class="empty"><div class="empty-ico">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn || ''}</div>`;

// Campos de data em dd/mm/aaaa (independente da língua do navegador). Mantém um <input hidden name=...> com o valor ISO.
const validISO = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d && y >= 1900 && y <= 2200; };
export function enhanceDates(root) {
  root.querySelectorAll('input[type=date]').forEach((orig) => {
    const name = orig.name, iso = orig.value;
    const label = orig.closest('label')?.querySelector('span')?.textContent || 'Data';
    const wrap = document.createElement('div');
    wrap.className = 'datef';
    wrap.innerHTML = `<input type="text" class="date-txt" inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" autocomplete="off" data-date-for="${name}" aria-label="${esc(label)} (dd/mm/aaaa)" value="${fmtDate(iso)}"><input type="hidden" name="${name}" value="${iso}"><input type="date" class="date-native" tabindex="-1" aria-hidden="true" value="${iso}"><button type="button" class="icon-btn" aria-label="Escolher data no calendário">📅</button>`;
    orig.replaceWith(wrap);
    const [txt, hid, nat, btn] = wrap.children;
    const set = (v) => { hid.value = v; hid.dispatchEvent(new Event('input', { bubbles: true })); };
    txt.addEventListener('input', () => {
      let v = txt.value.replace(/[^\d]/g, '').slice(0, 8);
      if (v.length > 4) v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4); else if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
      if (txt.value.length >= v.length || /\d$/.test(txt.value)) txt.value = v;
      const m = txt.value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m && validISO(+m[3], +m[2], +m[1])) { set(`${m[3]}-${m[2]}-${m[1]}`); nat.value = hid.value; txt.removeAttribute('aria-invalid'); }
      else { set(''); if (txt.value) txt.setAttribute('aria-invalid', 'true'); }
    });
    nat.addEventListener('change', () => { if (nat.value) { txt.value = fmtDate(nat.value); txt.removeAttribute('aria-invalid'); set(nat.value); } });
    btn.addEventListener('click', () => { try { nat.showPicker(); } catch { nat.focus(); nat.click(); } });
  });
}
