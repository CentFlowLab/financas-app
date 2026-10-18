// Importar extratos bancários: ficheiro → colunas → contas → revisão → feito. Tudo local (nada sai do navegador).
import { S, save } from '../db.js';
import { eur, esc, fmtDate, parseEuro, centsToInput } from '../util.js';
import { accountBalance } from '../model.js';
import { ACCOUNT_TYPES, accountTypeInfo } from '../defaults.js';
import { confirmBox, toast } from '../ui.js';
import { ICONS } from '../icons.js';
import { loadSource, prepare, buildSession, isTable, getParsed, refresh, summarize, reconcile, commit, persist, undoImport, setPair, suggest, tipoOf, FORMATOS, ACEITA } from '../import/engine.js';
import { applyMapping, autoMap, cellStr } from '../import/parse.js';
import { sampleCSV } from '../import/sample.js';

let W = null; // estado do assistente (persiste enquanto navega entre vistas)
const PAGE = 150;
const persistAll = () => save('accounts', 'movements', 'imports');
const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const sgn = (c) => (c > 0 ? '+' : c < 0 ? '−' : '') + eur(Math.abs(c));
const fmtDT = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const STEPS = [['ficheiro', 'Ficheiro'], ['colunas', 'Colunas'], ['contas', 'Contas'], ['rever', 'Rever']];

const PRIVACY = '<p class="privacy" id="imp-privacy">🔒 <span><b>Privacidade:</b> tudo é processado localmente, no seu navegador. O ficheiro e os movimentos não são enviados para nenhum servidor.</span></p>';

function stepper(step) {
  const table = W?.src && isTable(W.src);
  const list = STEPS.filter(([id]) => table || id !== 'colunas');
  const idx = list.findIndex(([id]) => id === step);
  return `<ol class="steps" aria-label="Passos da importação">${list.map(([id, t], i) => `<li class="${i < idx ? 'done' : i === idx ? 'on' : ''}" ${i === idx ? 'aria-current="step"' : ''}><b>${i + 1}</b><span>${t}</span></li>`).join('')}</ol>`;
}

// ---------- passo 1: ficheiro + histórico ----------
function historyHtml() {
  if (!S.imports.length) return '';
  const list = [...S.imports].sort((a, b) => b.data.localeCompare(a.data));
  return `<section class="card" id="imp-hist"><h2>Importações anteriores</h2>${list.map((i) => `<div class="imp-hist" data-imp="${i.id}">
    <div class="grow"><span class="t">📄 ${esc(i.ficheiro)}</span><small>${FORMATOS[i.formato] || i.formato} · ${fmtDT(i.data)} · <b>${i.nMov}</b> movimento${i.nMov === 1 ? '' : 's'}${i.contas?.some((c) => c.nova) ? ` · contas criadas: ${esc(i.contas.filter((c) => c.nova).map((c) => c.nome).join(', '))}` : ''}${i.duplicados ? ` · ${i.duplicados} duplicado${i.duplicados === 1 ? '' : 's'} ignorado${i.duplicados === 1 ? '' : 's'}` : ''}</small></div>
    <button type="button" class="btn danger small" data-undo="${i.id}">Anular importação</button></div>`).join('')}</section>`;
}
function rulesHtml() {
  const rules = S.catRules || [];
  if (!rules.length) return '';
  return `<details class="card" id="imp-rules"><summary>Categorias aprendidas (${rules.length})</summary><p class="muted small">Quando corrige uma categoria na revisão, a aplicação lembra-se para as próximas importações.</p>${rules.map((r) => { const c = S.categories.find((x) => x.id === r.categoriaId); return `<div class="row"><span class="grow"><span class="t">${esc(r.chave)}</span><small>${r.tipo === 'entrada' ? 'Entrada' : 'Saída'} → ${esc(c ? c.icone + ' ' + c.nome : '?')}</small></span><button type="button" class="icon-btn" data-forget="${r.id}" aria-label="Esquecer «${esc(r.chave)}»">✕</button></div>`; }).join('')}</details>`;
}
function stepFicheiro() {
  return `<section class="card imp-drop" id="imp-drop">
    <h2>Importe o extrato do seu banco</h2>
    <p>Descarregue o extrato no homebanking e escolha o ficheiro aqui. A aplicação cria as contas que faltarem e acrescenta os movimentos — antes de guardar, verá tudo numa revisão.</p>
    <div class="btn-row imp-actions"><label class="btn primary big" id="imp-pick">${ICONS.importar} Escolher ficheiro<input type="file" id="imp-file" accept="${ACEITA}" hidden></label>
    <button type="button" class="btn ghost big" data-sample>🧪 Experimentar com extrato de exemplo</button></div>
    <p class="small muted">Formatos: <b>CSV</b> (; ou ,), <b>Excel</b> (.xlsx, .xls), <b>OFX</b>, <b>QIF</b> e <b>PDF</b> de texto (<span class="chip warn">melhor esforço</span>). Também pode largar o ficheiro nesta caixa.</p>
    ${PRIVACY}
    <div id="imp-msg" role="status" aria-live="polite"></div>
  </section>${historyHtml()}${rulesHtml()}`;
}

// ---------- passo 2: colunas ----------
const colOpts = (src, sel, { none = '— nenhuma —', allowNone = true } = {}) => {
  const rows = src.table.rows, h = src.map.headerRow;
  const n = rows.reduce((a, r) => Math.max(a, r.length), 0);
  const opts = Array.from({ length: n }, (_, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${colLetter(i)} · ${esc(h >= 0 && cellStr(rows[h][i]) ? cellStr(rows[h][i]).slice(0, 28) : 'Coluna ' + colLetter(i))}</option>`);
  return (allowNone ? `<option value="-1" ${sel < 0 ? 'selected' : ''}>${none}</option>` : '') + opts.join('');
};
function previewHtml() {
  const src = W.src, res = applyMapping(src.table.rows, src.map);
  const n = res.rows.length;
  const warn = !n ? '<p class="hint warn" role="alert">Ainda não reconheci nenhum movimento. Confirme a <b>Data</b> e o <b>Valor</b> (ou Débito/Crédito) acima.</p>' : '';
  const sample = res.rows.slice(0, 8);
  return `<div id="imp-preview">
    <p class="small"><b>${n}</b> movimento${n === 1 ? '' : 's'} reconhecido${n === 1 ? '' : 's'}${res.ignored.length ? ` · ${res.ignored.length} linha${res.ignored.length === 1 ? '' : 's'} ignorada${res.ignored.length === 1 ? '' : 's'} (títulos, totais, vazias…)` : ''}</p>${warn}
    ${n ? `<div class="tbl-wrap"><table class="tbl" aria-label="Pré-visualização dos movimentos"><thead><tr><th>Data</th><th>Descrição</th><th class="r">Valor</th><th class="r">Saldo</th>${src.map.conta >= 0 ? '<th>Conta</th>' : ''}</tr></thead><tbody>${sample.map((r) => `<tr><td>${fmtDate(r.data)}</td><td>${esc(r.desc)}</td><td class="r ${r.valor < 0 ? 'neg' : 'pos'}">${sgn(r.valor)}</td><td class="r">${r.saldo == null ? '—' : eur(r.saldo)}</td>${src.map.conta >= 0 ? `<td>${esc(r.contaLabel)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}
function stepColunas() {
  const { src } = W, m = src.map, rows = src.table.rows;
  const bank = getParsed(src).meta?.bank;
  const headerOpts = [`<option value="-1" ${m.headerRow < 0 ? 'selected' : ''}>Sem cabeçalho</option>`, ...rows.slice(0, 40).map((r, i) => `<option value="${i}" ${m.headerRow === i ? 'selected' : ''}>Linha ${i + 1}: ${esc(r.map(cellStr).filter(Boolean).join(' | ').slice(0, 50))}</option>`)].join('');
  const o = (v, t, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${t}</option>`;
  return `<section class="card">
    <h2>Confirme as colunas</h2>
    <p class="small muted">📄 <b>${esc(src.name)}</b> · ${FORMATOS[src.format]}${src.encoding ? ` · ${esc(src.encoding)}` : ''}${src.delim ? ` · separador «${src.delim === '\t' ? 'tab' : esc(src.delim)}»` : ''}. ${bank ? `Parece um extrato <b>${esc(bank.nome)}</b> (reconhecimento aproximado). ` : ''}Detetei as colunas automaticamente; se algo estiver errado, ajuste abaixo — a pré-visualização atualiza logo.</p>
    ${previewHtml()}
    <form class="map-form" id="map-form" novalidate>
      <div class="grid2">
        <label class="fld"><span>Data do movimento</span><select name="m-data">${colOpts(src, m.data, { none: '— escolha —' })}</select></label>
        <label class="fld"><span>Descrição</span><select name="m-desc">${colOpts(src, m.desc)}</select></label>
      </div>
      <div class="fld"><span>Como vem o valor?</span>
        <div class="seg" role="radiogroup" aria-label="Formato do valor"><label class="seg-opt"><input type="radio" name="m-modo" value="single" ${m.modo === 'single' ? 'checked' : ''}><span>Uma coluna (±)</span></label><label class="seg-opt"><input type="radio" name="m-modo" value="split" ${m.modo === 'split' ? 'checked' : ''}><span>Débito e Crédito</span></label></div></div>
      <div class="grid2" data-modo="single" ${m.modo === 'single' ? '' : 'hidden'}><label class="fld"><span>Valor (negativo = saída)</span><select name="m-valor">${colOpts(src, m.valor, { none: '— escolha —' })}</select></label></div>
      <div class="grid2" data-modo="split" ${m.modo === 'split' ? '' : 'hidden'}><label class="fld"><span>Débito (saídas)</span><select name="m-debito">${colOpts(src, m.debito)}</select></label><label class="fld"><span>Crédito (entradas)</span><select name="m-credito">${colOpts(src, m.credito)}</select></label></div>
      <div class="grid2">
        <label class="fld"><span>Saldo (opcional)</span><select name="m-saldo">${colOpts(src, m.saldo)}</select></label>
        <label class="fld"><span>Conta / IBAN (opcional)</span><select name="m-conta">${colOpts(src, m.conta)}</select></label>
      </div>
      <details class="more-opts adv" ${W.advOpen ? 'open' : ''}><summary>Opções avançadas</summary>
        <div class="grid2">
          <label class="fld"><span>Linha do cabeçalho</span><select name="m-header">${headerOpts}</select></label>
          ${src.format === 'csv' ? `<label class="fld"><span>Codificação</span><select name="o-encoding">${o('auto', `Automática (${esc(src.encoding || '')})`, src.opts.encoding)}${o('utf-8', 'UTF-8', src.opts.encoding)}${o('windows-1252', 'Windows-1252 / ISO-8859-1', src.opts.encoding)}</select></label>
          <label class="fld"><span>Separador</span><select name="o-delim">${o('auto', 'Automático', src.opts.delim)}${o(';', 'Ponto e vírgula (;)', src.opts.delim)}${o(',', 'Vírgula (,)', src.opts.delim)}${o('\t', 'Tabulação', src.opts.delim)}${o('|', 'Barra vertical (|)', src.opts.delim)}</select></label>` : ''}
          ${src.format === 'xlsx' && src.sheets.length > 1 ? `<label class="fld"><span>Folha</span><select name="o-sheet">${src.sheets.map((s, i) => o(i, esc(s), src.opts.sheet)).join('')}</select></label>` : ''}
          <label class="fld"><span>Formato dos números</span><select name="m-decimal">${o('auto', 'Automático', m.decimal)}${o('comma', '1.234,56 (vírgula decimal)', m.decimal)}${o('dot', '1,234.56 (ponto decimal)', m.decimal)}</select></label>
          <label class="fld"><span>Formato das datas</span><select name="m-dateOrder">${o('auto', 'Automático', m.dateOrder)}${o('dmy', 'dia-mês-ano', m.dateOrder)}${o('mdy', 'mês-dia-ano', m.dateOrder)}</select></label>
          <label class="fld"><span>Descrição adicional</span><select name="m-desc2">${colOpts(src, m.desc2)}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="m-inverter" ${m.inverter ? 'checked' : ''}> Inverter sinais (os débitos aparecem como valores positivos)</label>
      </details>
    </form>
    <details class="more-opts"><summary>Ver o ficheiro original (primeiras linhas)</summary><div class="tbl-wrap"><table class="tbl raw" aria-label="Linhas do ficheiro">${rows.slice(0, 14).map((r, i) => `<tr class="${i === m.headerRow ? 'hdr' : ''}"><th>${i + 1}</th>${r.slice(0, 10).map((c) => `<td>${esc(cellStr(c).slice(0, 30))}</td>`).join('')}</tr>`).join('')}</table></div></details>
    ${PRIVACY}
  </section>
  <div class="imp-nav sticky"><button type="button" class="btn ghost" data-restart>Cancelar</button><span class="grow"></span><button type="button" class="btn primary" data-next ${applyMapping(rows, m).rows.length ? '' : 'disabled'}>Continuar</button></div>`;
}

// ---------- passo 3: contas ----------
function reconText(g) {
  const r = reconcile(g);
  if (!r) return '<small class="muted">Este ficheiro não traz saldos: o saldo inicial fica a 0,00 € (pode ajustá-lo).</small>';
  const ok = Math.abs(r.diff) < 1;
  const novo = g.choice === 'new';
  return `<small class="recon ${ok ? 'ok' : 'bad'}" data-recon>${ok ? '✓' : '⚠️'} Saldo final do extrato: <b>${eur(r.final)}</b> · saldo da conta após importar: <b>${eur(r.calculado)}</b>${ok ? ' — bate certo.' : ` — diferença de ${eur(r.diff)}${novo ? '' : ' (pode haver movimentos em falta ou registados à mão)'}.`}${!ok && novo ? ' <button type="button" class="link btn-link" data-adjust="' + g.gi + '">Ajustar saldo inicial</button>' : ''}</small>`;
}
function groupCard(g) {
  const dates = g.rows.map((r) => r.data).sort();
  const accOpts = [`<option value="new" ${g.choice === 'new' ? 'selected' : ''}>➕ Criar conta nova</option>`, ...S.accounts.filter((a) => !a.arquivada).map((a) => `<option value="${a.id}" ${g.choice === a.id ? 'selected' : ''}>${accountTypeInfo(a.tipo).i} ${esc(a.nome)}</option>`)].join('');
  const existing = g.choice !== 'new' ? S.accounts.find((a) => a.id === g.choice) : null;
  return `<section class="card imp-acc" data-g="${g.gi}">
    <div class="card-h"><h2>🏦 ${esc(g.label)}</h2><span class="chip">${g.rows.length} movimento${g.rows.length === 1 ? '' : 's'}</span></div>
    <p class="small muted">${fmtDate(dates[0])} a ${fmtDate(dates[dates.length - 1])}${g.bank ? ` · ${esc(g.bank.nome)}` : ''}</p>
    <label class="fld"><span>Em que conta guardar?</span><select name="g-choice" aria-label="Conta de destino">${accOpts}</select></label>
    ${g.choice === 'new' ? `<div class="new-acc">
      <div class="grid2"><label class="fld"><span>Nome da conta</span><input name="g-nome" value="${esc(g.novo.nome)}" maxlength="40"></label>
      <label class="fld"><span>Tipo</span><select name="g-tipo">${ACCOUNT_TYPES.map((t) => `<option value="${t.v}" ${g.novo.tipo === t.v ? 'selected' : ''}>${t.i} ${t.t}</option>`).join('')}</select></label></div>
      <label class="fld"><span>Saldo inicial (€)</span><input name="g-saldo" value="${esc(centsToInput(g.novo.saldoInicial))}" inputmode="decimal" autocomplete="off"><small>${g.bal ? 'Calculado a partir do saldo do extrato, para que o saldo da conta fique igual ao do banco.' : 'O extrato não indica saldos; pode ajustar se souber o saldo antes do primeiro movimento.'}</small></label>
    </div>` : `<p class="small">Conta existente: <b>${esc(existing?.nome || '')}</b> · saldo atual ${eur(accountBalance(existing))}. Movimentos já existentes (mesmo dia, valor e descrição) serão marcados como duplicados.</p>`}
    ${reconText(g)}
  </section>`;
}
function stepContas() {
  const n = W.sess.groups.length;
  return `<section class="card tip"><p>${n > 1 ? `Este ficheiro tem <b>${n} contas</b>. ` : ''}Confirme onde guardar os movimentos. As contas novas são criadas todas de uma vez quando confirmar a importação.</p></section>
    ${W.sess.groups.map(groupCard).join('')}
    <div class="imp-nav sticky"><button type="button" class="btn ghost" data-back>Voltar</button><span class="grow"></span><button type="button" class="btn primary" data-next>Continuar</button></div>`;
}

// ---------- passo 4: revisão ----------
const catOptions = (tipo, cur) => S.categories.filter((c) => c.tipo === tipo).map((c) => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.icone)} ${esc(c.nome)}</option>`).join('');
const accLabel = (g) => (g.choice === 'new' ? g.novo.nome : S.accounts.find((a) => a.id === g.choice)?.nome || '');
function rowHtml(r) {
  const tipo = tipoOf(r), multi = W.sess.groups.length > 1;
  const xf = r.pairWith && r.xfer;
  const other = r.pairWith;
  const chips = [];
  if (r.dup) chips.push(`<span class="chip warn" title="${esc(r.dupMotivo)}">⚠️ Possível duplicado</span>`);
  if (r.pairWith) chips.push(`<span class="chip ${xf ? 'ok' : ''}">🔁 ${xf ? `Transferência ${r.valor < 0 ? esc(accLabel(r.g)) + ' → ' + esc(accLabel(other.g)) : esc(accLabel(other.g)) + ' → ' + esc(accLabel(r.g))}` : 'Possível transferência'}</span>`);
  if (r.catFonte === 'aprendida' && !xf) chips.push('<span class="chip" title="Categoria aprendida com as suas correções">🧠 Aprendida</span>');
  if (r.semSinal) chips.push('<span class="chip warn">Confirme entrada/saída</span>');
  if (multi) chips.push(`<span class="chip">${esc(accLabel(r.g))}</span>`);
  const ctl = xf ? '' : `<select data-cat aria-label="Categoria">${catOptions(tipo, r.cat)}</select>`;
  const flip = xf ? '' : `<button type="button" class="btn small ghost" data-flip aria-label="Trocar para ${tipo === 'entrada' ? 'saída' : 'entrada'}">⇄ ${tipo === 'entrada' ? 'É saída' : 'É entrada'}</button>`;
  const xbtn = r.pairWith ? `<button type="button" class="btn small ghost" data-xfer>${xf ? 'Não é transferência' : 'Tratar como transferência'}</button>` : '';
  return `<div class="irow ${r.dup ? 'dup' : ''} ${r.checked ? '' : 'off'}" data-r="${r.id}">
    <label class="chk"><input type="checkbox" data-chk ${r.checked ? 'checked' : ''} aria-label="Importar: ${esc(r.desc)}"></label>
    <div class="im"><div class="l1"><span class="d">${fmtDate(r.data)}</span><span class="desc" title="${esc(r.desc)}">${esc(r.desc) || '(sem descrição)'}</span><b class="amt ${xf ? 'muted' : r.valor < 0 ? 'neg' : 'pos'}">${xf ? eur(Math.abs(r.valor)) : sgn(r.valor)}</b></div>
    <div class="l2">${ctl}${flip}${xbtn}</div>${chips.length ? `<div class="l3">${chips.join('')}</div>` : ''}</div></div>`;
}
function summaryHtml() {
  const s = summarize(W.sess);
  return `<div class="imp-sum" id="imp-sum" role="status" aria-live="polite"><b data-s="n">${s.n} movimento${s.n === 1 ? '' : 's'}</b><span>Entradas <b class="pos" data-s="in">${eur(s.entradas)}</b></span><span>Saídas <b class="neg" data-s="out">${eur(s.saidas)}</b></span><span data-s="dups">${s.dups} duplicado${s.dups === 1 ? '' : 's'} ignorado${s.dups === 1 ? '' : 's'}</span><span data-s="novas">${s.novas} conta${s.novas === 1 ? '' : 's'} a criar</span>${s.nTransf ? `<span data-s="transf">${s.nTransf} transferência${s.nTransf === 1 ? '' : 's'}</span>` : ''}</div>`;
}
function filteredRows() {
  const f = W.filtro;
  return W.sess.rows.filter((r) => (f === 'todos') || (f === 'dup' && r.dup) || (f === 'transf' && r.pairWith) || (f === 'desmarcados' && !r.checked));
}
function listHtml() {
  const rows = filteredRows();
  if (!rows.length) return '<p class="muted center">Nenhum movimento neste filtro.</p>';
  const vis = rows.slice(0, W.limit);
  return vis.map(rowHtml).join('') + (rows.length > vis.length ? `<button type="button" class="btn ghost" data-more>Mostrar mais (${rows.length - vis.length})</button>` : '');
}
function pillsHtml() {
  const r = W.sess.rows;
  const cnt = { todos: r.length, dup: r.filter((x) => x.dup).length, transf: r.filter((x) => x.pairWith).length, desmarcados: r.filter((x) => !x.checked).length };
  const P = [['todos', 'Todos'], ['dup', 'Duplicados'], ['transf', 'Transferências'], ['desmarcados', 'Desmarcados']];
  return `<div class="pills" role="group" aria-label="Filtrar">${P.filter(([id]) => id === 'todos' || cnt[id]).map(([id, t]) => `<button type="button" class="pill ${W.filtro === id ? 'on' : ''}" data-f="${id}" aria-pressed="${W.filtro === id}">${t} (${cnt[id]})</button>`).join('')}</div>`;
}
function stepRever() {
  const s = W.sess;
  const banners = [];
  if (s.prev) banners.push(`<div class="hint warn" id="imp-already" role="alert">⚠️ Este ficheiro já foi importado em ${fmtDT(s.prev.data)} (${s.prev.nMov} movimentos). Os movimentos que já existem ficam marcados como duplicados e <b>não</b> serão importados outra vez.</div>`);
  if (s.bestEffort) banners.push(`<div class="hint warn" id="imp-besteffort"><b>PDF — melhor esforço.</b> As datas, descrições, valores e o sinal (entrada/saída) foram deduzidos do texto do PDF e podem estar errados. Reveja todas as linhas.<label class="check"><input type="checkbox" id="imp-revisto" ${s.revisto ? 'checked' : ''}> Revi os movimentos extraídos do PDF</label></div>`);
  for (const w of s.warnings.filter((w) => !/melhor esforço/.test(w))) banners.push(`<div class="hint warn">${esc(w)}</div>`);
  if (s.ignored.length) banners.push(`<p class="small muted">${s.ignored.length} linha${s.ignored.length === 1 ? '' : 's'} do ficheiro ignorada${s.ignored.length === 1 ? '' : 's'} (títulos, totais ou sem data/valor).</p>`);
  const sm = summarize(s);
  return `${banners.join('')}${summaryHtml()}
    <div class="imp-tools"><div id="imp-pills">${pillsHtml()}</div><div class="btn-row"><button type="button" class="btn small ghost" data-all="1">Marcar todos</button><button type="button" class="btn small ghost" data-all="0">Desmarcar todos</button></div></div>
    <div id="imp-list" class="imp-list">${listHtml()}</div>
    <div class="imp-nav sticky"><button type="button" class="btn ghost" data-back>Voltar</button><span class="grow"></span><button type="button" class="btn primary" data-commit ${sm.n && s.revisto ? '' : 'disabled'}>Importar ${sm.n} movimento${sm.n === 1 ? '' : 's'}</button></div>`;
}

// ---------- passo 5: feito ----------
function stepFeito() {
  const { rec, recon } = W.resultado;
  const novas = rec.contas.filter((c) => c.nova).map((c) => c.nome);
  return `<section class="card imp-done" id="imp-done"><div class="big-ico">✅</div><h2>Importação concluída</h2>
    <p><b>${rec.nMov}</b> movimento${rec.nMov === 1 ? '' : 's'} importado${rec.nMov === 1 ? '' : 's'}${rec.transferencias ? ` (${rec.transferencias} transferência${rec.transferencias === 1 ? '' : 's'})` : ''} de <b>${esc(rec.ficheiro)}</b>.${rec.duplicados ? ` ${rec.duplicados} duplicado${rec.duplicados === 1 ? '' : 's'} ignorado${rec.duplicados === 1 ? '' : 's'}.` : ''}${novas.length ? ` Contas criadas: <b>${esc(novas.join(', '))}</b>.` : ''}${rec.aprendidas ? ` Aprendi ${rec.aprendidas} categoria${rec.aprendidas === 1 ? '' : 's'} das suas correções.` : ''}</p>
    ${recon.map((r) => `<p class="small recon ${r.ok ? 'ok' : 'bad'}" data-done-recon>${r.ok === null ? '' : r.ok ? '✓' : '⚠️'} ${esc(r.nome)}: saldo ${eur(r.saldo)}${r.final != null ? ` · extrato ${eur(r.final)}${r.ok ? ' — bate certo' : ''}` : ''}</p>`).join('')}
    <div class="btn-row imp-actions"><a class="btn primary" href="#/movimentos?mes=&conta=${rec.contas[0]?.id || ''}">Ver movimentos</a><a class="btn ghost" href="#/contas">Ver contas</a><button type="button" class="btn danger" data-undo="${rec.id}">Anular importação</button><button type="button" class="btn ghost" data-restart>Importar outro ficheiro</button></div>
    ${PRIVACY}</section>`;
}

// ---------- vista ----------
export default {
  id: 'importar', titulo: 'Importar extratos', icone: 'importar', descricao: 'CSV, Excel, OFX, QIF, PDF',
  render(ctx) {
    if (ctx.params.has('novo')) { W = null; history.replaceState(null, '', '#/importar'); }
    return `<div class="page-head"><h1 class="page-title">Importar extratos</h1></div><div id="imp-body" data-step="ficheiro"></div>`;
  },
  mount(el, ctx) {
    const body = el.querySelector('#imp-body');
    const step = () => W?.step || 'ficheiro';
    const paint = () => {
      const st = step();
      const adv = body.querySelector('details.adv'); if (adv && W) W.advOpen = adv.open; // lembrar «Opções avançadas» aberta
      body.dataset.step = st;
      let inner = '';
      if (st === 'ficheiro') inner = stepFicheiro();
      else if (st === 'colunas') inner = stepper(st) + stepColunas();
      else if (st === 'contas') inner = stepper(st) + stepContas();
      else if (st === 'rever') inner = stepper(st) + stepRever();
      else inner = stepFeito();
      body.innerHTML = inner;
      body.querySelectorAll('details.adv').forEach((d) => d.addEventListener('toggle', () => { if (W) W.advOpen = d.open; }));
    };
    const go = (st) => { W.step = st; paint(); window.scrollTo(0, 0); };
    const goAfterColumns = () => { W.sess = buildSession(W.src); go('contas'); };
    const msg = (html, kind = '') => { const m = body.querySelector('#imp-msg'); if (m) m.innerHTML = html ? `<p class="hint ${kind}">${html}</p>` : ''; };

    async function handleFile(file) {
      msg('⏳ A ler o ficheiro…');
      try {
        const src = await loadSource(file);
        W = { step: 'ficheiro', src, sess: null, filtro: 'todos', limit: PAGE, resultado: null };
        if (isTable(src)) { go('colunas'); }
        else { W.sess = buildSession(src); go('contas'); }
      } catch (e) {
        msg('❌ ' + esc(e.message || 'Não foi possível ler o ficheiro.'), 'warn');
      }
    }
    async function loadSample() {
      const s = sampleCSV();
      await handleFile(new File([s.texto], s.nome, { type: 'text/csv' }));
    }

    const upd = () => { // atualizações pontuais na revisão
      body.querySelector('#imp-sum')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: summaryHtml() }).firstElementChild);
      const sm = summarize(W.sess);
      const b = body.querySelector('[data-commit]');
      if (b) { b.textContent = `Importar ${sm.n} movimento${sm.n === 1 ? '' : 's'}`; b.disabled = !(sm.n && W.sess.revisto); }
      const pills = body.querySelector('#imp-pills'); if (pills) pills.innerHTML = pillsHtml();
    };
    const rowEl = (r) => body.querySelector(`.irow[data-r="${r.id}"]`);
    const redrawRow = (r, focus) => {
      const old = rowEl(r); if (!old) return;
      const t = Object.assign(document.createElement('div'), { innerHTML: rowHtml(r) }).firstElementChild;
      old.replaceWith(t);
      if (focus) t.querySelector(focus)?.focus();
    };
    const redrawList = () => { body.querySelector('#imp-list').innerHTML = listHtml(); };

    // ---- eventos ----
    body.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.id === 'imp-file') { const f = t.files[0]; t.value = ''; if (f) handleFile(f); return; }
      if (t.closest('#map-form')) {
        const src = W.src, m = src.map, name = t.name;
        if (name.startsWith('o-')) {
          src.opts[name.slice(2)] = name === 'o-sheet' ? Number(t.value) : t.value;
          try { await prepare(src, true); } catch (err) { toast(err.message, 'err'); return; }
          return paint();
        }
        if (name === 'm-modo') { m.modo = t.value; body.querySelectorAll('[data-modo]').forEach((d) => (d.hidden = d.dataset.modo !== m.modo)); }
        else if (name === 'm-inverter') m.inverter = t.checked;
        else if (name === 'm-decimal' || name === 'm-dateOrder') m[name.slice(2)] = t.value;
        else if (name === 'm-header') { Object.assign(m, autoMap(src.table.rows, Number(t.value)), { inverter: m.inverter, decimal: m.decimal, dateOrder: m.dateOrder }); return paint(); }
        else m[name.slice(2)] = Number(t.value);
        body.querySelector('#imp-preview').replaceWith(Object.assign(document.createElement('div'), { innerHTML: previewHtml() }).firstElementChild);
        const nxt = body.querySelector('[data-next]'); if (nxt) nxt.disabled = !applyMapping(src.table.rows, m).rows.length;
        return;
      }
      const card = t.closest('[data-g]');
      if (card) {
        const g = W.sess.groups[Number(card.dataset.g)];
        if (t.name === 'g-choice') { g.choice = t.value; refresh(W.sess); card.replaceWith(Object.assign(document.createElement('div'), { innerHTML: groupCard(g) }).firstElementChild); }
        else if (t.name === 'g-tipo') g.novo.tipo = t.value;
        return;
      }
      const rowDiv = t.closest('.irow');
      if (rowDiv) {
        const r = W.sess.rows[Number(rowDiv.dataset.r)];
        if (t.matches('[data-chk]')) {
          r.checked = t.checked; r.touched = true;
          if (r.pairWith && r.xfer) { r.pairWith.checked = r.checked; r.pairWith.touched = true; redrawRow(r.pairWith); }
          rowDiv.classList.toggle('off', !r.checked);
        } else if (t.matches('[data-cat]')) { r.cat = t.value; r.catTouched = true; r.catFonte = 'manual'; redrawRow(r, '[data-cat]'); }
        upd();
        return;
      }
      if (t.id === 'imp-revisto') { W.sess.revisto = t.checked; upd(); }
    });
    body.addEventListener('input', (e) => { // nome/saldo da conta nova: guardar enquanto escreve (sem repintar)
      const t = e.target, card = t.closest('[data-g]'); if (!card) return;
      const g = W.sess.groups[Number(card.dataset.g)];
      if (t.name === 'g-nome') g.novo.nome = t.value;
      else if (t.name === 'g-saldo') { const v = t.value.trim() === '' ? 0 : parseEuro(t.value); if (!Number.isNaN(v)) { g.novo.saldoInicial = v; card.querySelector('[data-recon]')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: reconText(g) }).firstElementChild); } }
    });
    body.addEventListener('click', async (e) => {
      const c = (s) => e.target.closest(s);
      if (c('[data-sample]')) return loadSample();
      if (c('[data-restart]')) { W = null; return paint(); }
      if (c('[data-back]')) {
        if (W.step === 'contas') { if (isTable(W.src)) return go('colunas'); W = null; return paint(); }
        if (W.step === 'rever') return go('contas');
      }
      if (c('[data-next]')) {
        if (W.step === 'colunas') return goAfterColumns();
        if (W.step === 'contas') {
          for (const g of W.sess.groups) if (g.choice === 'new' && !g.novo.nome.trim()) return toast('Dê um nome à conta nova.', 'err');
          refresh(W.sess); W.filtro = 'todos'; W.limit = PAGE; return go('rever');
        }
      }
      const adj = c('[data-adjust]');
      if (adj) { const g = W.sess.groups[Number(adj.dataset.adjust)]; const soma = g.rows.filter((r) => r.checked).reduce((a, r) => a + r.valor, 0); g.novo.saldoInicial = g.bal.final - soma; return paint(); }
      const forget = c('[data-forget]');
      if (forget) { S.catRules = S.catRules.filter((r) => r.id !== forget.dataset.forget); await save('catRules'); return paint(); }
      const undo = c('[data-undo]');
      if (undo) {
        const imp = S.imports.find((i) => i.id === undo.dataset.undo); if (!imp) return;
        const novas = (imp.contas || []).filter((x) => x.nova).map((x) => x.nome);
        if (!await confirmBox(`Anular a importação de «${imp.ficheiro}»? Vão ser removidos os ${imp.nMov} movimentos importados${novas.length ? ` e as contas criadas (${novas.join(', ')})` : ''}.`, { okLabel: 'Anular importação', danger: true })) return;
        const r = undoImport(imp.id); W = null; await persistAll();
        toast(`Importação anulada: ${r.movs} movimento${r.movs === 1 ? '' : 's'} e ${r.contas} conta${r.contas === 1 ? '' : 's'} removidos${r.mantidas.length ? `. Conta mantida (tem outros movimentos): ${r.mantidas.join(', ')}` : ''}`, 'ok');
        return paint();
      }
      if (W?.step !== 'rever') return;
      const f = c('[data-f]'); if (f) { W.filtro = f.dataset.f; W.limit = PAGE; body.querySelector('#imp-pills').innerHTML = pillsHtml(); return redrawList(); }
      if (c('[data-more]')) { W.limit += PAGE; return redrawList(); }
      const all = c('[data-all]'); if (all) { const on = all.dataset.all === '1'; for (const r of filteredRows()) { r.checked = on; r.touched = true; } redrawList(); return upd(); }
      const row = c('.irow'); const r = row && W.sess.rows[Number(row.dataset.r)];
      if (r && c('[data-flip]')) { r.valor = -r.valor; r.flipped = true; r.semSinal = false; r.touched = true; suggest(r); if (r.pairWith) { setPair(r, false); } refresh2(); return; }
      if (r && c('[data-xfer]')) { setPair(r, !r.xfer); if (r.xfer) { r.checked = r.pairWith.checked = !(r.dup || r.pairWith.dup); } redrawRow(r, '[data-xfer]'); redrawRow(r.pairWith); return upd(); }
      if (c('[data-commit]')) {
        const b = c('[data-commit]'); b.disabled = true;
        try {
          const rec = commit(W.sess);
          const recon = W.sess.groups.filter((g) => g.rows.some((x) => x.checked)).map((g) => {
            const id = rec.grupos.find((x) => x.key === g.key)?.contaId; const a = S.accounts.find((x) => x.id === id);
            const saldo = a ? accountBalance(a) : 0;
            return { nome: a?.nome || g.label, saldo, final: g.bal ? g.bal.final : null, ok: g.bal ? Math.abs(saldo - g.bal.final) < 1 : null };
          });
          W.resultado = { rec, recon }; W.step = 'feito';
          await persist();
          toast(`${rec.nMov} movimentos importados`, 'ok');
        } catch (err) { console.error(err); toast('Não foi possível guardar: ' + err.message, 'err'); b.disabled = false; }
      }
      function refresh2() { refresh(W.sess); redrawList(); upd(); }
    });
    // arrastar e largar
    body.addEventListener('dragover', (e) => { if (e.target.closest('#imp-drop')) { e.preventDefault(); body.querySelector('#imp-drop').classList.add('over'); } });
    body.addEventListener('dragleave', () => body.querySelector('#imp-drop')?.classList.remove('over'));
    body.addEventListener('drop', (e) => { if (e.target.closest('#imp-drop')) { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); } });
    paint();
  },
};
