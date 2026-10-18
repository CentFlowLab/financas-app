import { S, save } from '../db.js';
import { eur, esc, parseEuro, centsToInput, uid, today, fmtDate, norm, pct } from '../util.js';
import { priceGroups, prodKey } from '../model.js';
import { fld, inp, sel, money, formModal, openModal, toast, empty, confirmBox } from '../ui.js';
import { line } from '../charts.js';
import { ICONS } from '../icons.js';

const UNITS = [{ v: 'un', t: 'por unidade' }, { v: 'kg', t: 'por kg' }, { v: 'L', t: 'por litro' }, { v: '100g', t: 'por 100 g' }];
let query = '';

function priceForm(preset = {}) {
  const prods = [...new Set(S.prices.map((p) => p.produto))].sort((a, b) => a.localeCompare(b, 'pt'));
  const lojas = [...new Set(S.prices.map((p) => p.loja))].sort((a, b) => a.localeCompare(b, 'pt'));
  formModal({
    title: 'Registar preço',
    html: `${fld('Produto', inp('produto', preset.produto || '', 'required maxlength="80" list="dl-prod" placeholder="Ex.: Leite meio-gordo 1L" autocomplete="off"'))}<datalist id="dl-prod">${prods.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      ${fld('Loja', inp('loja', preset.loja || '', 'required maxlength="40" list="dl-loja" placeholder="Ex.: Continente" autocomplete="off"'))}<datalist id="dl-loja">${lojas.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="grid2">${fld('Preço (€)', money('preco', '', 'required'))}${fld('Unidade', sel('unidade', UNITS, preset.unidade || 'un'))}</div>
      ${fld('Data', inp('data', today(), 'type="date" required'))}`,
    submit: 'Guardar preço',
    onSubmit(fd) {
      const produto = (fd.get('produto') || '').trim(), loja = (fd.get('loja') || '').trim();
      if (!produto || !loja) return 'Indique o produto e a loja.';
      const preco = parseEuro(fd.get('preco')); if (!(preco > 0)) return 'Indique um preço válido.';
      // reutiliza o nome já existente (ignora maiúsculas/acentos) para agrupar corretamente
      const same = S.prices.find((p) => prodKey(p.produto) === prodKey(produto)); const sameL = S.prices.find((p) => norm(p.loja) === norm(loja));
      S.prices.push({ id: uid(), produto: same ? same.produto : produto, loja: sameL ? sameL.loja : loja, preco, unidade: fd.get('unidade'), data: fd.get('data'), fonte: 'manual' });
      save('prices'); toast('Preço registado', 'ok');
    },
  });
}

function detail(key) {
  const g = priceGroups().find((x) => prodKey(x.nome) + '|' + x.unidade === key); if (!g) return;
  const lojas = [...new Set(g.hist.map((o) => o.loja))];
  const unit = g.unidade === 'un' ? '' : '/' + g.unidade;
  const draw = (el) => {
    const gg = priceGroups().find((x) => prodKey(x.nome) + '|' + x.unidade === key);
    if (!gg) { el.closest('.modal-back').querySelector('[data-close]').click(); return; }
    el.innerHTML = `<h3>${esc(gg.nome)}</h3>
      ${gg.lojas.map((o, i) => `<div class="row"><span class="grow">${i === 0 ? '🏆 ' : ''}${esc(o.loja)}<small>${fmtDate(o.data)}</small></span><b class="${i === 0 ? 'pos' : ''}">${eur(o.preco)}${unit}</b></div>`).join('')}
      ${gg.hist.length > 1 ? `<h4>Evolução (todas as lojas)</h4>${line(gg.hist.map((o) => ({ label: fmtDate(o.data).slice(0, 5), v: o.preco / 100 })), { unit: '€' })}` : ''}
      <h4>Registos</h4>${[...gg.hist].reverse().map((o) => `<div class="row"><span class="grow">${esc(o.loja)}<small>${fmtDate(o.data)} · ${o.fonte === 'talao' ? 'talão' : 'manual'}</small></span><b>${eur(o.preco)}</b><button class="icon-btn" data-del="${o.id}" aria-label="Apagar registo">🗑️</button></div>`).join('')}
      <div class="actions"><span class="grow"></span><button class="btn primary small" data-add>${ICONS.plus} Novo preço</button></div>`;
  };
  openModal('Comparação de preços', '<div id="pd"></div>', { onMount(el, close) {
    const box = el.querySelector('#pd'); draw(box);
    box.addEventListener('click', async (e) => {
      const d = e.target.closest('[data-del]');
      if (d && await confirmBox('Apagar este registo de preço?', { okLabel: 'Apagar', danger: true })) { S.prices = S.prices.filter((p) => p.id !== d.dataset.del); await save('prices'); draw(box); }
      if (e.target.closest('[data-add]')) { close(); priceForm({ produto: g.nome, unidade: g.unidade }); }
    });
  } });
}

export default {
  id: 'precos', titulo: 'Preços', icone: 'precos', descricao: 'Onde é mais barato',
  render() {
    const groups = priceGroups();
    const multi = groups.filter((g) => g.lojas.length > 1);
    const wins = new Map();
    for (const g of multi) wins.set(g.barato.loja, (wins.get(g.barato.loja) || 0) + 1);
    const best = [...wins].sort((a, b) => b[1] - a[1])[0];
    const totalSave = multi.reduce((a, g) => a + g.poupanca, 0);
    return `<div class="page-head"><h1 class="page-title">Comparação de preços</h1><button class="btn primary small" data-new>${ICONS.plus} Preço</button></div>
    ${groups.length ? `
    ${multi.length ? `<section class="card tip"><b>🏆 ${esc(best[0])}</b> é a loja mais barata em ${best[1]} de ${multi.length} produto${multi.length === 1 ? '' : 's'} comparados. Comprando sempre o mais barato, poupa até <b>${eur(totalSave)}</b> por cada cesto destes produtos.</section>` : '<section class="card tip">Registe o mesmo produto em duas ou mais lojas para ver onde é mais barato. Os preços dos talões lidos entram aqui automaticamente.</section>'}
    <input type="search" id="p-q" class="search" placeholder="Pesquisar produto…" value="${esc(query)}" aria-label="Pesquisar produto">
    <div id="p-list">${listHtml(groups)}</div>` : empty('🏷️', 'Comparação de preços', 'Registe preços manualmente ou leia talões: a app mostra onde cada produto é mais barato.', '<button class="btn primary" data-new>Registar um preço</button>')}`;
  },
  mount(el, ctx) {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) return priceForm();
      const g = e.target.closest('[data-g]'); if (g) detail(g.dataset.g);
    });
    el.querySelector('#p-q')?.addEventListener('input', (e) => { query = e.target.value; el.querySelector('#p-list').innerHTML = listHtml(priceGroups()); });
  },
};

function listHtml(groups) {
  const q = norm(query);
  const l = groups.filter((g) => !q || norm(g.nome).includes(q) || g.lojas.some((o) => norm(o.loja).includes(q)));
  if (!l.length) return '<p class="muted center">Nenhum produto encontrado.</p>';
  return l.map((g) => {
    const unit = g.unidade === 'un' ? '' : '/' + g.unidade;
    const diff = g.lojas.length > 1 ? `<span class="chip ok">Poupa ${eur(g.poupanca)} (${pct((g.poupanca / g.caro.preco) * 100, 0)})</span>` : '<span class="chip">1 loja</span>';
    return `<button class="card p-card" data-g="${esc(prodKey(g.nome) + '|' + g.unidade)}"><span class="grow"><span class="t">${esc(g.nome)}</span><small>${g.lojas.map((o, i) => `${i === 0 && g.lojas.length > 1 ? '🏆 ' : ''}${esc(o.loja)} ${eur(o.preco)}${unit}`).join(' · ')}</small></span>${diff}</button>`;
  }).join('');
}
