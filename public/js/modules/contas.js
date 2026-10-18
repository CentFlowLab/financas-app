import { S, save } from '../db.js';
import { eur, esc, parseEuro, centsToInput, uid } from '../util.js';
import { accountBalance, activeAccounts, totalBalance } from '../model.js';
import { ACCOUNT_TYPES, accountTypeInfo } from '../defaults.js';
import { fld, inp, sel, money, formModal, toast, empty } from '../ui.js';
import { openMovementForm } from './movimentos.js';
import { ICONS } from '../icons.js';

function accountForm(id) {
  const a = id ? S.accounts.find((x) => x.id === id) : { nome: '', tipo: 'ordem', saldoInicial: 0, limite: null, arquivada: false };
  const used = id && S.movements.some((m) => m.contaId === id || m.contaDestinoId === id);
  formModal({
    title: id ? 'Editar conta' : 'Nova conta',
    html: `${fld('Nome', inp('nome', a.nome, 'required maxlength="40" placeholder="Ex.: Conta ordenado"'))}
      ${fld('Tipo', sel('tipo', ACCOUNT_TYPES.map((t) => ({ v: t.v, t: `${t.i} ${t.t}` })), a.tipo))}
      ${fld('IBAN (opcional)', inp('iban', a.iban || '', 'maxlength="40" autocomplete="off" placeholder="PT50 …"'), 'Ajuda a reconhecer a conta ao importar extratos.')}
      ${fld('Saldo inicial (€)', money('saldoInicial', centsToInput(a.saldoInicial)), 'O saldo atual = saldo inicial + movimentos. Num cartão de crédito use um valor negativo para o que já deve.')}
      <div data-for="limite">${fld('Limite do cartão (€, opcional)', money('limite', centsToInput(a.limite)))}</div>
      ${id ? `<label class="check"><input type="checkbox" name="arquivada" ${a.arquivada ? 'checked' : ''}> Arquivar (esconder das listas e dos totais)</label>` : ''}`,
    onMount(form) { const ap = () => (form.querySelector('[data-for=limite]').hidden = form.tipo.value !== 'cartao'); form.tipo.addEventListener('change', ap); ap(); },
    onDelete: id ? async () => {
      if (used) { a.arquivada = true; await save('accounts'); toast('A conta tem movimentos: foi arquivada em vez de apagada'); return; }
      S.accounts = S.accounts.filter((x) => x.id !== id); await save('accounts'); toast('Conta apagada');
    } : null,
    onSubmit(fd) {
      const nome = (fd.get('nome') || '').trim();
      if (!nome) return 'Indique o nome da conta.';
      const si = fd.get('saldoInicial').trim() === '' ? 0 : parseEuro(fd.get('saldoInicial'));
      if (Number.isNaN(si)) return 'Saldo inicial inválido.';
      const lim = fd.get('limite')?.trim() ? parseEuro(fd.get('limite')) : null;
      const rec = { nome, tipo: fd.get('tipo'), iban: (fd.get('iban') || '').replace(/\s/g, '').toUpperCase(), saldoInicial: si, limite: fd.get('tipo') === 'cartao' ? lim : null, arquivada: !!fd.get('arquivada') };
      if (id) Object.assign(a, rec); else S.accounts.push({ id: uid(), ...rec });
      save('accounts');
      toast(id ? 'Conta atualizada' : 'Conta criada', 'ok');
    },
  });
}

export default {
  id: 'contas', titulo: 'Contas', icone: 'contas', descricao: '',
  render() {
    const accs = activeAccounts();
    const arch = S.accounts.filter((a) => a.arquivada);
    const card = (a) => {
      const b = accountBalance(a); const t = accountTypeInfo(a.tipo);
      const disp = a.tipo === 'cartao' && a.limite ? `<small class="muted">Disponível ${eur(a.limite + b)} de ${eur(a.limite)}</small>` : '';
      return `<div class="acc-card"><button class="acc-main" data-edit="${a.id}" aria-label="Editar ${esc(a.nome)}"><span class="ico-round big">${t.i}</span><span class="grow"><span class="t">${esc(a.nome)}</span><small>${t.t}</small>${disp}</span><b class="${b < 0 ? 'neg' : ''}" data-bal="${esc(a.nome)}">${eur(b)}</b></button><a class="link small" href="#/movimentos?conta=${a.id}&mes=">Ver movimentos</a></div>`;
    };
    return `<div class="page-head"><h1 class="page-title">Contas</h1><div class="btn-row"><a class="btn ghost small" id="btn-importar" href="#/importar?novo=1">${ICONS.importar} Importar extrato</a><button class="btn ghost small" data-transfer>🔁 Transferir</button><button class="btn primary small" data-new>${ICONS.plus} Nova conta</button></div></div>
    <section class="card total-card"><small>Total em contas</small><div class="big ${totalBalance() < 0 ? 'neg' : ''}" id="total-contas">${eur(totalBalance())}</div></section>
    ${accs.length ? accs.map(card).join('') : empty('🏦', 'Sem contas', 'Crie a sua primeira conta para começar a registar movimentos.', '<button class="btn primary" data-new>Nova conta</button>')}
    ${arch.length ? `<details class="card"><summary>Contas arquivadas (${arch.length})</summary>${arch.map(card).join('')}</details>` : ''}`;
  },
  mount(el) {
    el.addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) return accountForm(ed.dataset.edit);
      if (e.target.closest('[data-new]')) return accountForm();
      if (e.target.closest('[data-transfer]')) {
        if (activeAccounts().length < 2) return toast('Precisa de pelo menos duas contas para transferir.', 'err');
        openMovementForm({ tipo: 'transferencia' });
      }
    });
  },
};
