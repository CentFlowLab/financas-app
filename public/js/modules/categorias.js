import { S, save } from '../db.js';
import { esc, uid, norm } from '../util.js';
import { fld, inp, sel, formModal, toast, confirmBox } from '../ui.js';
import { FALLBACK_IN, FALLBACK_OUT, CAT_FUEL, CAT_DEBT } from '../defaults.js';
import { ICONS } from '../icons.js';

const EMOJIS = ['🛒', '🍽️', '☕', '⛽', '🚗', '🚌', '🏠', '💡', '📱', '💊', '🎬', '👕', '🎓', '🛡️', '🏛️', '🎁', '💳', '📦', '💼', '🏖️', '💶', '↩️', '🐾', '🧒', '✈️', '🏋️', '🔧', '📚', '💇', '🎮', '🍺', '➕'];
const PROTECTED = new Set([FALLBACK_IN, FALLBACK_OUT, CAT_FUEL, CAT_DEBT]); // usadas por outros módulos

function catForm(id, tipoNovo = 'saida') {
  const c = id ? S.categories.find((x) => x.id === id) : { nome: '', icone: '📦', tipo: tipoNovo };
  const uses = id ? S.movements.filter((m) => m.categoriaId === id).length : 0;
  formModal({
    title: id ? 'Editar categoria' : 'Nova categoria',
    html: `${fld('Nome', inp('nome', c.nome, 'required maxlength="30"'))}
      ${id ? `<p class="muted">Tipo: <b>${c.tipo === 'entrada' ? 'Entrada' : 'Saída'}</b> · ${uses} movimento${uses === 1 ? '' : 's'}</p>` : fld('Tipo', sel('tipo', [{ v: 'saida', t: 'Saída (despesa)' }, { v: 'entrada', t: 'Entrada (receita)' }], c.tipo))}
      ${fld('Ícone', inp('icone', c.icone, 'maxlength="4" class="emoji-in"'))}
      <div class="emoji-pick">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('')}</div>`,
    onMount(form) { form.querySelector('.emoji-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-emoji]'); if (b) form.icone.value = b.dataset.emoji; }); },
    onDelete: id && !PROTECTED.has(id) ? async () => {
      const fb = c.tipo === 'entrada' ? FALLBACK_IN : FALLBACK_OUT;
      S.movements.forEach((m) => { if (m.categoriaId === id) m.categoriaId = fb; });
      S.categories = S.categories.filter((x) => x.id !== id);
      await save('categories', 'movements');
      toast(uses ? `Categoria apagada; ${uses} movimento(s) passaram para "Outros"` : 'Categoria apagada');
    } : null,
    onSubmit(fd) {
      const nome = (fd.get('nome') || '').trim();
      if (!nome) return 'Indique o nome.';
      const tipo = id ? c.tipo : fd.get('tipo');
      if (S.categories.some((x) => x.id !== id && x.tipo === tipo && norm(x.nome) === norm(nome))) return 'Já existe uma categoria com esse nome.';
      const icone = (fd.get('icone') || '').trim() || '📦';
      if (id) Object.assign(c, { nome, icone }); else S.categories.push({ id: uid(), nome, icone, tipo });
      save('categories');
      toast(id ? 'Categoria atualizada' : 'Categoria criada', 'ok');
    },
  });
}

export default {
  id: 'categorias', titulo: 'Categorias', icone: 'categorias', descricao: 'Personalizar',
  render() {
    const list = (tipo) => S.categories.filter((c) => c.tipo === tipo).map((c) => `<button class="row" data-edit="${c.id}"><span class="ico-round">${esc(c.icone)}</span><span class="grow">${esc(c.nome)}</span><small class="muted">${S.movements.filter((m) => m.categoriaId === c.id).length}</small></button>`).join('');
    return `<div class="page-head"><h1 class="page-title">Categorias</h1></div>
    <section class="card"><div class="card-h"><h2>Saídas</h2><button class="btn ghost small" data-new="saida">${ICONS.plus} Nova</button></div>${list('saida')}</section>
    <section class="card"><div class="card-h"><h2>Entradas</h2><button class="btn ghost small" data-new="entrada">${ICONS.plus} Nova</button></div>${list('entrada')}</section>`;
  },
  mount(el) {
    el.addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) return catForm(ed.dataset.edit);
      const nw = e.target.closest('[data-new]'); if (nw) catForm(null, nw.dataset.new);
    });
  },
};
