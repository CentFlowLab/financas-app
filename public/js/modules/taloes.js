import { S, save, putImage, imageURL, dropImageIfUnused } from '../db.js';
import { eur, esc, parseEuro, parseDec, centsToInput, uid, today, fmtDate, num, sum } from '../util.js';
import { syncLinkedMovement, activeAccounts, removeMovement, catName } from '../model.js';
import { fld, inp, sel, money, formModal, openModal, toast, empty } from '../ui.js';
import { resizeImage, prepareForOCR } from '../image.js';
import { recognize } from '../ocr.js';
import { parseReceipt } from '../receipt-parser.js';
import { warrantyForm } from './garantias.js';
import { ICONS } from '../icons.js';

const itemRow = (it = { nome: '', qtd: 1, preco: null, total: null }) => `<div class="item-row">
  <input name="i_nome" value="${esc(it.nome)}" placeholder="Artigo" aria-label="Artigo">
  <input name="i_qtd" value="${esc(String(it.qtd ?? 1).replace('.', ','))}" inputmode="decimal" aria-label="Quantidade" title="Quantidade">
  <input name="i_preco" value="${esc(centsToInput(it.preco))}" inputmode="decimal" placeholder="€ un." aria-label="Preço unitário" title="Preço unitário">
  <button type="button" class="icon-btn" data-rmitem aria-label="Remover artigo">✕</button></div>`;

// Formulário de revisão/edição do talão (usado após OCR, em modo manual e para editar)
async function reviewForm({ receipt, parsed, fotoBlob, texto }) {
  const edit = receipt || null;
  const p = edit || { loja: parsed?.loja || '', data: parsed?.data || today(), total: parsed?.total ?? null, itens: parsed?.itens || [], categoriaId: parsed?.categoriaId || 'cat-supermercado', contaId: activeAccounts()[0]?.id || '', texto: texto || '', fotoId: null };
  const accs = [{ v: '', t: 'Não registar como movimento' }, ...activeAccounts().map((a) => ({ v: a.id, t: `Debitar de: ${a.nome}` }))];
  const cats = S.categories.filter((c) => c.tipo === 'saida').map((c) => ({ v: c.id, t: `${c.icone} ${c.nome}` }));
  const contaDefault = edit ? (edit.movId ? edit.contaId : '') : p.contaId;
  const previewUrl = fotoBlob ? URL.createObjectURL(fotoBlob) : edit?.fotoId ? await imageURL(edit.fotoId) : null;
  const hintTotal = !edit && parsed && parsed.total == null ? '<p class="hint warn">Não foi possível ler o total — confirme o valor.</p>' : '';
  formModal({
    title: edit ? 'Talão' : 'Rever talão', wide: true, submit: edit ? 'Guardar' : 'Guardar talão',
    html: `${previewUrl ? `<img class="thumb-lg" src="${previewUrl}" alt="Foto do talão" id="rc-img">` : ''}
      ${!edit && parsed ? '<p class="hint">Verifique os dados lidos — o OCR pode falhar em letras e números pequenos. Corrija o que for preciso.</p>' : ''}${hintTotal}
      <div class="grid2">${fld('Loja', inp('loja', p.loja, 'maxlength="60" required'))}${fld('Data', inp('data', p.data, 'type="date" required'))}</div>
      <div class="grid2">${fld('Total (€)', money('total', centsToInput(p.total), 'required'))}${fld('Categoria', sel('categoriaId', cats, p.categoriaId))}</div>
      ${fld('Conta', sel('contaId', accs, contaDefault))}
      <div class="fld"><span>Artigos <small class="muted">(nome · qtd · preço unitário)</small></span><div id="items">${p.itens.map(itemRow).join('')}</div><button type="button" class="btn ghost small" id="add-item">${ICONS.plus} Artigo</button><small id="sum-hint" class="muted"></small></div>
      <label class="check"><input type="checkbox" name="guardarPrecos" checked> Guardar os preços dos artigos para a comparação de preços</label>
      ${p.texto ? `<details><summary>Texto lido (OCR)</summary><pre class="ocr-text">${esc(p.texto)}</pre></details>` : ''}
      ${edit?.fotoId ? '<button type="button" class="btn ghost small" id="mk-war">🛡️ Criar garantia com este talão</button>' : ''}`,
    onMount(form, close) {
      const items = form.querySelector('#items');
      const hint = () => {
        const rows = [...items.querySelectorAll('.item-row')];
        const s = sum(rows, (r) => { const q = parseDec(r.querySelector('[name=i_qtd]').value), pr = parseEuro(r.querySelector('[name=i_preco]').value); return q > 0 && pr > 0 ? Math.round(q * pr) : 0; });
        const t = parseEuro(form.total.value);
        form.querySelector('#sum-hint').textContent = rows.length ? `Soma dos artigos: ${eur(s)}${t > 0 && Math.abs(s - t) > 1 ? ` (diferença para o total: ${eur(t - s)})` : ''}` : '';
      };
      form.querySelector('#add-item').addEventListener('click', () => { items.insertAdjacentHTML('beforeend', itemRow()); items.lastElementChild.querySelector('input').focus(); hint(); });
      items.addEventListener('click', (e) => { if (e.target.closest('[data-rmitem]')) { e.target.closest('.item-row').remove(); hint(); } });
      items.addEventListener('input', hint); form.total.addEventListener('input', hint); hint();
      form.querySelector('#rc-img')?.addEventListener('click', (e) => openModal('Foto do talão', `<img class="full-img" src="${e.target.src}" alt="Foto do talão">`, { wide: true }));
      form.querySelector('#mk-war')?.addEventListener('click', () => { const loja = form.loja.value, d = form.data.value; close(); warrantyForm(null, { loja, dataCompra: d, fotoId: edit.fotoId }); });
    },
    onDelete: edit ? async () => {
      if (edit.movId) removeMovement(edit.movId);
      S.prices = S.prices.filter((x) => x.receiptId !== edit.id);
      S.receipts = S.receipts.filter((x) => x.id !== edit.id);
      await save('receipts', 'prices', 'movements'); await dropImageIfUnused(edit.fotoId); toast('Talão apagado (e o movimento associado)');
    } : null,
    async onSubmit(fd, form) {
      const loja = (fd.get('loja') || '').trim(); if (!loja) return 'Indique a loja.';
      const data = fd.get('data'); if (!data) return 'Indique a data.';
      const total = parseEuro(fd.get('total')); if (!(total > 0)) return 'Indique o total do talão.';
      const itens = [...form.querySelectorAll('.item-row')].map((r) => {
        const nome = r.querySelector('[name=i_nome]').value.trim(); const qtd = parseDec(r.querySelector('[name=i_qtd]').value) || 1; const preco = parseEuro(r.querySelector('[name=i_preco]').value);
        return { nome, qtd, preco, total: Math.round(qtd * preco) };
      }).filter((i) => i.nome);
      if (itens.some((i) => !(i.preco >= 0))) return 'Há artigos com preço inválido.';
      const contaId = fd.get('contaId') || null;
      const target = edit || { id: uid(), movId: null, fotoId: null, texto: texto || '' };
      if (!edit && fotoBlob) target.fotoId = await putImage(fotoBlob);
      Object.assign(target, { loja, data, total, categoriaId: fd.get('categoriaId'), contaId, itens });
      syncLinkedMovement(target, contaId ? { categoriaId: target.categoriaId, contaId, valor: total, data, nota: `Talão — ${loja}`, ligacao: { tipo: 'talao', id: target.id } } : null);
      S.prices = S.prices.filter((x) => x.receiptId !== target.id);
      if (fd.get('guardarPrecos')) for (const i of itens) if (i.preco > 0) S.prices.push({ id: uid(), produto: i.nome, loja, preco: i.preco, unidade: 'un', data, fonte: 'talao', receiptId: target.id });
      if (!edit) S.receipts.push(target);
      await save('receipts', 'prices', 'movements');
      toast('Talão guardado', 'ok');
    },
  });
}

async function scanFile(file) {
  const m = openModal('A ler o talão…', `<div class="scan"><img id="scan-img" class="thumb-lg" alt="Pré-visualização do talão"><div class="progress"><div id="scan-bar" style="width:3%"></div></div><p id="scan-msg" class="muted center">A preparar…</p></div>`, { onMount() {} });
  const bar = m.el.querySelector('#scan-bar'), msg = m.el.querySelector('#scan-msg');
  let cancelled = false;
  m.el.closest('.modal-back').querySelector('[data-close]').addEventListener('click', () => { cancelled = true; });
  try {
    const foto = await resizeImage(file, 1600, 0.82);
    m.el.querySelector('#scan-img').src = URL.createObjectURL(foto);
    const prep = await prepareForOCR(foto);
    const texto = await recognize(prep, (p, s) => { bar.style.width = Math.max(3, Math.round(p * 100)) + '%'; msg.textContent = s + (p ? ` ${Math.round(p * 100)} %` : ''); });
    if (cancelled) return;
    m.close();
    const parsed = parseReceipt(texto);
    await reviewForm({ parsed, fotoBlob: foto, texto });
  } catch (e) {
    console.error(e);
    if (cancelled) return;
    msg.textContent = 'Não foi possível ler o talão: ' + (e.message || e) + ' Pode introduzir os dados manualmente.';
    msg.classList.add('neg');
  }
}

export default {
  id: 'taloes', titulo: 'Talões', icone: 'taloes', descricao: 'Ler com a câmara',
  render() {
    const list = [...S.receipts].sort((a, b) => b.data.localeCompare(a.data));
    return `<div class="page-head"><h1 class="page-title">Talões e faturas</h1></div>
    <section class="card scan-card"><p>Fotografe um talão: a app lê a loja, a data, o total e os artigos, e regista a despesa. Tudo é processado <b>no seu dispositivo</b> (funciona offline).</p>
      <div class="btn-row"><label class="btn primary">${ICONS.camera} Ler talão<input type="file" id="rc-file" accept="image/*" capture="environment" hidden></label><label class="btn ghost">Escolher da galeria<input type="file" id="rc-file2" accept="image/*" hidden></label><button class="btn ghost" data-manual>Introduzir à mão</button></div></section>
    ${list.length ? `<section class="card"><h2>Talões guardados</h2>${list.map((r) => `<button class="row" data-edit="${r.id}"><span class="ico-round">${r.fotoId ? '🧾' : '📝'}</span><span class="grow"><span class="t">${esc(r.loja)}</span><small>${fmtDate(r.data)} · ${esc(catName(r.categoriaId))} · ${r.itens.length} artigo${r.itens.length === 1 ? '' : 's'}</small></span><b>${eur(r.total)}</b></button>`).join('')}</section>` : empty('🧾', 'Ainda sem talões', 'Os talões que ler aparecem aqui.', '')}`;
  },
  mount(el) {
    const onFile = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) scanFile(f); };
    el.querySelector('#rc-file').addEventListener('change', onFile);
    el.querySelector('#rc-file2').addEventListener('change', onFile);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-manual]')) return reviewForm({});
      const ed = e.target.closest('[data-edit]'); if (ed) reviewForm({ receipt: S.receipts.find((r) => r.id === ed.dataset.edit) });
    });
  },
};
