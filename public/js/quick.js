// Despesa rápida: folha inferior com valor + categoria numa só vista (conta, nota e data são opcionais).
import { S, save } from './db.js';
import { esc, eur, parseEuro, today, centsToInput, shiftMonth } from './util.js';
import { activeAccounts, upsertMovement, lastUsedAccountId, catName } from './model.js';
import { fld, inp, sel, money, formModal, toast } from './ui.js';

// Categorias de saída ordenadas pelas mais usadas nos últimos 3 meses (mantém a ordem por omissão em caso de empate)
function categoriesByUse() {
  const since = shiftMonth(today().slice(0, 7), -2) + '-01';
  const uses = new Map();
  for (const m of S.movements) if (m.tipo === 'saida' && m.data >= since) uses.set(m.categoriaId, (uses.get(m.categoriaId) || 0) + 1);
  return S.categories.filter((c) => c.tipo === 'saida').map((c, i) => ({ c, i, n: uses.get(c.id) || 0 })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.c);
}

export function openQuickExpense(preset = {}) {
  const accs = activeAccounts();
  if (!accs.length) { toast('Crie primeiro uma conta.', 'err'); return; }
  const cats = categoriesByUse();
  const html = `
    ${fld('Valor (€)', money('valor', centsToInput(preset.valor), 'required class="amount" aria-describedby="q-hint"'))}
    <fieldset class="catpick"><legend>Categoria</legend><div class="cat-grid">${cats.map((c) => `<label class="cat-opt"><input type="radio" name="categoriaId" value="${esc(c.id)}"><span><i aria-hidden="true">${esc(c.icone)}</i>${esc(c.nome)}</span></label>`).join('')}</div></fieldset>
    <details class="more-opts"><summary>Conta, nota e data <small>(opcional)</small></summary>
      ${fld('Conta', sel('contaId', accs.map((a) => ({ v: a.id, t: a.nome })), lastUsedAccountId()))}
      ${fld('Nota', inp('nota', '', 'maxlength="200" placeholder="Ex.: café"'))}
      ${fld('Data', inp('data', today(), 'type="date"'))}
    </details>
    <p class="muted small" id="q-hint">Hoje · conta usada pela última vez. <button type="button" class="link btn-link" data-full>Entrada, transferência ou mais detalhes</button></p>`;
  formModal({
    title: 'Despesa rápida', html, submit: 'Adicionar', sheet: true,
    onMount(form, close) {
      form.querySelector('[data-full]').addEventListener('click', async () => {
        const valor = parseEuro(form.valor.value);
        close();
        const { openMovementForm } = await import('./modules/movimentos.js');
        openMovementForm(valor > 0 ? { valor } : {});
      });
    },
    onSubmit(fd) {
      const valor = parseEuro(fd.get('valor'));
      if (!(valor > 0)) return 'Indique um valor maior que zero (ex.: 4,50).';
      const categoriaId = fd.get('categoriaId');
      if (!categoriaId) return 'Escolha uma categoria.';
      const data = fd.get('data') || today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'Indique uma data válida.';
      upsertMovement({ tipo: 'saida', valor, data, contaId: fd.get('contaId') || lastUsedAccountId(), categoriaId, contaDestinoId: null, nota: (fd.get('nota') || '').trim() });
      save('movements');
      toast(`Despesa de ${eur(valor)} registada em ${catName(categoriaId)}`, 'ok');
    },
  });
}
