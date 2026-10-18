import { S } from '../db.js';
import { ui } from '../state.js';
import { eur, esc, norm, curMonth, shiftMonth, monthLabel, monthName, num, pct, fmtDate, sum } from '../util.js';
import { monthSummary, catName, accountBalance, activeAccounts, totalBalance, activeDebts, debtSaldo, totalDebt, simulatePayoff, fuelStats, expiringWarranties, warrantyStatus, priceGroups, summaryForAssistant, totalInstallments } from '../model.js';
import { ICONS } from '../icons.js';

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const STOP = new Set(['qual', 'onde', 'mais', 'barato', 'preco', 'precos', 'comprar', 'custa', 'quanto', 'para', 'esta', 'este', 'tenho', 'como', 'que', 'dos', 'das', 'uma', 'por', 'com', 'esta', 'meu', 'minha', 'sao', 'foi', 'ver', 'melhor', 'loja', 'lojas', 'devo']);
const tokens = (n) => n.split(/[^a-z0-9]+/).filter(Boolean);

function period(n) {
  const cur = curMonth();
  if (/mes passado|ultimo mes|mes anterior/.test(n)) return { key: shiftMonth(cur, -1), label: monthLabel(shiftMonth(cur, -1)) };
  if (/este ano|neste ano|no ano|ano todo|este ano/.test(n)) return { ano: +cur.slice(0, 4), label: 'este ano' };
  for (let i = 0; i < 12; i++) if (new RegExp('\\b' + MESES[i]).test(n)) {
    let y = +cur.slice(0, 4); if (i + 1 > +cur.slice(5)) y--;
    const key = `${y}-${String(i + 1).padStart(2, '0')}`; return { key, label: monthLabel(key) };
  }
  return { key: cur, label: 'este mês (' + monthLabel(cur) + ')', def: true };
}
function findCategory(n) {
  const toks = tokens(n);
  for (const c of S.categories.filter((c) => c.tipo === 'saida')) {
    const words = tokens(norm(c.nome)).filter((w) => w.length >= 3 && !['agua', 'luz'].includes(w) || ['agua', 'luz'].includes(w));
    for (const w of words) if (toks.some((t) => t === w || (w.length >= 6 && t.startsWith(w.slice(0, -1))))) return c;
  }
  return null;
}
const catTotals = (p) => {
  if (p.key) return monthSummary(p.key);
  const by = new Map(); let ent = 0, sai = 0;
  for (const m of S.movements.filter((x) => x.data.startsWith(String(p.ano)))) { if (m.tipo === 'entrada') ent += m.valor; if (m.tipo === 'saida') { sai += m.valor; by.set(m.categoriaId, (by.get(m.categoriaId) || 0) + m.valor); } }
  return { entradas: ent, saidas: sai, saldo: ent - sai, porCategoria: [...by].map(([id, total]) => ({ id, total })).sort((a, b) => b.total - a.total) };
};

export function answerLocal(q) {
  const n = norm(q);
  const L = [];
  const p = period(n);
  const s = catTotals(p);
  const cat = findCategory(n);
  const has = (re) => re.test(n);

  if (has(/\b(ola|bom dia|boa tarde|boa noite|oi)\b/) && n.length < 20) return 'Olá! 👋 Posso responder sobre os seus gastos, contas, dívidas, combustível, garantias e preços. Experimente uma das sugestões abaixo.';
  if (has(/garantia/)) {
    const ex = expiringWarranties();
    if (!S.warranties.length) return 'Ainda não registou garantias. Pode adicioná-las no separador Garantias.';
    L.push(`Tem <b>${S.warranties.length}</b> garantia(s) registada(s).`);
    if (ex.length) { L.push('⚠️ A expirar em breve:'); ex.forEach((x) => L.push(`• <b>${esc(x.w.produto)}</b> — termina a ${fmtDate(x.w.validade)} (${x.dias} dia${x.dias === 1 ? '' : 's'})`)); }
    else L.push('Nenhuma garantia expira nos próximos ' + (S.settings.alertaGarantiaDias ?? 60) + ' dias. ✅');
    const exp = S.warranties.filter((w) => warrantyStatus(w).estado === 'expirada'); if (exp.length) L.push(`${exp.length} já expirada(s).`);
    return L.join('<br>');
  }
  if (has(/divida|devo|emprestimo|credito|prestac|avalanche|bola de neve|liquidar/)) {
    const ds = activeDebts();
    if (!ds.length) return 'Não tem dívidas ativas registadas. 🎉';
    L.push(`Tem <b>${eur(totalDebt())}</b> em dívida (${ds.length} dívida${ds.length === 1 ? '' : 's'}), com prestações de <b>${eur(totalInstallments())}</b> por mês.`);
    ds.forEach((d) => L.push(`• ${esc(d.credor)}: ${eur(debtSaldo(d))} a ${num(d.taxa || 0, 2)} %`));
    const extra = S.settings.extraDivida || 0;
    const av = simulatePayoff('avalanche', extra), bo = simulatePayoff('bola', extra);
    if (av.impossivel || bo.impossivel) L.push('⚠️ Com as prestações atuais há dívidas que não são liquidadas (não cobrem os juros). Aumente as prestações.');
    else {
      L.push(`📅 Com o plano atual, fica livre de dívidas em <b>${monthLabel(av.fim)}</b> (avalanche) ou <b>${monthLabel(bo.fim)}</b> (bola de neve).`);
      L.push(`Avalanche: ${eur(av.juros)} de juros · Bola de neve: ${eur(bo.juros)} de juros.`);
    }
    const alvo = [...ds].sort((a, b) => (b.taxa || 0) - (a.taxa || 0))[0];
    L.push(`💡 Matematicamente, o melhor alvo para dinheiro extra é <b>${esc(alvo.credor)}</b> (juro mais alto: ${num(alvo.taxa || 0, 2)} %).`);
    return L.join('<br>');
  }
  if (has(/combustivel|consumo|litros|gasolina|gasoleo|l\/100|abastec/) && !has(/gast|despes|paguei/)) {
    if (!S.vehicles.length || !S.fuel.length) return 'Ainda não há abastecimentos registados. Use o separador Combustível.';
    for (const v of S.vehicles) {
      const st = fuelStats(v.id); if (!st.rows.length) continue;
      L.push(`<b>${esc(v.nome)}</b>: consumo médio ${st.mediaL100 ? num(st.mediaL100, 2) + ' L/100 km' : 'ainda sem dados suficientes'}, preço médio ${num(st.eurLMedio, 3)} €/L${st.custoKm ? `, custo ${num(st.custoKm, 3)} €/km` : ''}. Gastou ${eur(st.totalGasto)} em ${num(st.totalLitros, 0)} L.`);
      if (st.ultimoL100 && st.mediaL100) L.push(`Último consumo: ${num(st.ultimoL100, 2)} L/100 km (${st.ultimoL100 > st.mediaL100 * 1.1 ? 'acima da média ⚠️' : st.ultimoL100 < st.mediaL100 * 0.9 ? 'abaixo da média 👍' : 'dentro da média'}).`);
    }
    return L.join('<br>');
  }
  if (has(/preco|barato|comprar|custa/)) {
    const toks = tokens(n).filter((t) => t.length >= 4 && !STOP.has(t));
    const gs = priceGroups();
    const m = gs.filter((g) => toks.some((t) => norm(g.nome).includes(t.length > 5 ? t.slice(0, -1) : t)));
    if (!gs.length) return 'Ainda não há preços registados. Leia talões ou registe preços no separador Preços.';
    if (!m.length) return 'Não encontrei esse produto nos preços registados. Produtos conhecidos: ' + esc(gs.slice(0, 8).map((g) => g.nome).join(', ')) + '.';
    m.slice(0, 4).forEach((g) => { const u = g.unidade === 'un' ? '' : '/' + g.unidade; L.push(`<b>${esc(g.nome)}</b>: ` + g.lojas.map((o, i) => `${i === 0 && g.lojas.length > 1 ? '🏆 ' : ''}${esc(o.loja)} ${eur(o.preco)}${u}`).join(' · ') + (g.lojas.length > 1 ? ` — poupa ${eur(g.poupanca)} comprando em ${esc(g.barato.loja)}.` : '')); });
    return L.join('<br>');
  }
  if (has(/saldo|quanto tenho|patrimonio|dinheiro tenho|minhas contas|\bcontas\b/) && !has(/gast|despes/)) {
    const as = activeAccounts();
    L.push(`Total em contas: <b>${eur(totalBalance())}</b>.`);
    as.forEach((a) => L.push(`• ${esc(a.nome)}: ${eur(accountBalance(a))}`));
    if (S.debts.length) L.push(`Dívidas: ${eur(totalDebt())} → património líquido ${eur(totalBalance() - totalDebt())}.`);
    return L.join('<br>');
  }
  if (has(/poupar|poupanca|dica|conselho|sugest|melhorar|cortar/)) {
    const cur = monthSummary(curMonth()), prev = monthSummary(shiftMonth(curMonth(), -1));
    if (!cur.saidas && !prev.saidas) return 'Ainda não tenho movimentos suficientes para dar sugestões. Registe algumas despesas primeiro.';
    const ref = cur.saidas ? cur : prev, refLabel = cur.saidas ? 'este mês' : 'no mês passado';
    if (ref.entradas > 0) { const rate = (ref.saldo / ref.entradas) * 100; L.push(`💰 ${refLabel[0].toUpperCase() + refLabel.slice(1)} poupou <b>${pct(rate, 0)}</b> das entradas${rate < 10 ? ' — tente chegar aos 10–20%' : rate >= 20 ? ' — excelente!' : ''}.`); }
    const top = ref.porCategoria[0]; if (top) L.push(`🔎 A maior despesa é <b>${esc(catName(top.id))}</b>: ${eur(top.total)} (${pct((top.total / ref.saidas) * 100, 0)} das saídas).`);
    if (cur.saidas && prev.saidas) {
      const grow = cur.porCategoria.map((c) => ({ c, prev: prev.porCategoria.find((x) => x.id === c.id)?.total || 0 })).filter((x) => x.prev > 0 && x.c.total > x.prev * 1.3 && x.c.total - x.prev > 1000).sort((a, b) => (b.c.total - b.prev) - (a.c.total - a.prev))[0];
      if (grow) L.push(`📈 <b>${esc(catName(grow.c.id))}</b> subiu ${pct(((grow.c.total - grow.prev) / grow.prev) * 100, 0)} face ao mês passado (+${eur(grow.c.total - grow.prev)}).`);
    }
    const ds = activeDebts().sort((a, b) => (b.taxa || 0) - (a.taxa || 0))[0]; if (ds && ds.taxa > 5) L.push(`💳 Pagar mais depressa <b>${esc(ds.credor)}</b> (${num(ds.taxa, 1)} % de juro) rende mais do que qualquer poupança.`);
    const ex = expiringWarranties(); if (ex.length) L.push(`🛡️ Verifique a garantia de <b>${esc(ex[0].w.produto)}</b> antes de ${fmtDate(ex[0].w.validade)}.`);
    const grp = priceGroups().filter((g) => g.lojas.length > 1).sort((a, b) => b.poupanca - a.poupanca)[0]; if (grp) L.push(`🏷️ ${esc(grp.nome)} é ${eur(grp.poupanca)} mais barato em ${esc(grp.barato.loja)}.`);
    return L.join('<br>');
  }
  if (has(/recebi|entradas|receita|rendimento|salario|ganhei/) && !has(/gast/)) {
    return `Em ${p.label}, as entradas foram <b>${eur(s.entradas)}</b>${s.saidas ? ` e as saídas <b>${eur(s.saidas)}</b> (saldo ${eur(s.saldo)})` : ''}.`;
  }
  if (has(/gast|despes|saidas|paguei|onde.*(vai|dinheiro)|maior|categoria/) || cat) {
    if (cat) {
      const t = s.porCategoria.find((x) => x.id === cat.id)?.total || 0;
      L.push(`Em ${p.label}, gastou <b>${eur(t)}</b> em ${cat.icone} ${esc(cat.nome)}${s.saidas ? ` (${pct((t / s.saidas) * 100, 0)} das saídas)` : ''}.`);
      if (p.key) { const pv = monthSummary(shiftMonth(p.key, -1)).porCategoria.find((x) => x.id === cat.id)?.total || 0; if (pv) L.push(`No mês anterior foram ${eur(pv)} (${t >= pv ? '+' : '−'}${eur(Math.abs(t - pv))}).`); }
      return L.join('<br>');
    }
    if (!s.saidas) return `Não há saídas registadas em ${p.label}.`;
    L.push(`Em ${p.label}, gastou <b>${eur(s.saidas)}</b>. Para onde foi:`);
    s.porCategoria.slice(0, 5).forEach((c, i) => L.push(`${i + 1}. ${esc(catName(c.id))} — ${eur(c.total)} (${pct((c.total / s.saidas) * 100, 0)})`));
    return L.join('<br>');
  }
  if (has(/resumo|situacao|como estou|visao geral|ponto da situacao/)) {
    const c = monthSummary(curMonth());
    L.push(`📅 ${monthLabel(curMonth())}: entradas ${eur(c.entradas)}, saídas ${eur(c.saidas)}, saldo <b>${eur(c.saldo)}</b>.`);
    L.push(`🏦 Contas: ${eur(totalBalance())}${S.debts.length ? ` · 💳 Dívidas: ${eur(totalDebt())}` : ''}.`);
    const ex = expiringWarranties(); if (ex.length) L.push(`🛡️ ${ex.length} garantia(s) a expirar.`);
    return L.join('<br>');
  }
  if (has(/talao|taloes|fatura/)) return `Tem ${S.receipts.length} talão(ões) guardado(s), num total de ${eur(sum(S.receipts, (r) => r.total))}.`;
  return 'Ainda não percebi bem. 🤔 Posso responder, por exemplo, a: <i>"Quanto gastei este mês?"</i>, <i>"Quanto gastei em supermercado?"</i>, <i>"Qual o meu saldo?"</i>, <i>"Quando fico livre de dívidas?"</i>, <i>"Qual o meu consumo médio?"</i>, <i>"Onde é mais barato o leite?"</i>, <i>"Que garantias expiram?"</i> ou <i>"Dá-me dicas para poupar"</i>.';
}

async function answerOnline(q) {
  const { url, modelo, chave } = S.settings.ia;
  const ctx = { dataHoje: new Date().toISOString().slice(0, 10), mesAtual: summaryForAssistant(curMonth()), mesAnterior: summaryForAssistant(shiftMonth(curMonth(), -1)) };
  const msgs = [{ role: 'system', content: 'És o assistente financeiro da app "Finanças" de um utilizador em Portugal. Responde sempre em português de Portugal (pt-PT), de forma curta, clara e prática, com valores em euros. Usa apenas os dados fornecidos; se não souberes, diz. Dados do utilizador (JSON): ' + JSON.stringify(ctx) }, ...ui.chat.slice(-6).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.replace(/<[^>]+>/g, ' ') })), { role: 'user', content: q }];
  const r = await fetch(url.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave }, body: JSON.stringify({ model: modelo, messages: msgs, temperature: 0.3 }) });
  if (!r.ok) throw new Error('Serviço de IA respondeu ' + r.status);
  const j = await r.json();
  return esc(j.choices?.[0]?.message?.content || '').replace(/\n/g, '<br>');
}

const SUGGEST = ['Quanto gastei este mês?', 'Para onde vai o meu dinheiro?', 'Qual o meu saldo?', 'Quando fico livre de dívidas?', 'Dá-me dicas para poupar', 'Qual o meu consumo médio?', 'Que garantias expiram?'];

export default {
  id: 'assistente', titulo: 'Assistente', icone: 'assistente', descricao: 'Pergunte à IA',
  render() {
    const online = !!S.settings.ia.chave;
    const msgs = ui.chat.map((m) => `<div class="bubble ${m.role}">${m.role === 'user' ? esc(m.text) : m.text}</div>`).join('');
    return `<div class="chat-page"><div class="page-head"><h1 class="page-title">Assistente</h1><span class="chip ${online ? 'ok' : ''}">${online ? 'IA online ativa' : 'Modo local (privado)'}</span></div>
    <div id="chat" class="chat" aria-live="polite">${msgs || '<div class="bubble bot">Olá! Sou o assistente das suas finanças. 💬 Pergunte-me sobre gastos, saldos, dívidas, combustível, garantias ou preços — respondo com base nos seus dados, sem sair do dispositivo.</div>'}</div>
    <div class="chips sugg">${SUGGEST.map((s) => `<button class="chip btn-chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <form id="chat-form" class="chat-form"><input name="q" placeholder="Escreva a sua pergunta…" autocomplete="off" aria-label="Pergunta" required><button class="btn primary" type="submit">Enviar</button></form></div>`;
  },
  mount(el) {
    const chat = el.querySelector('#chat');
    const scroll = () => { chat.scrollTop = chat.scrollHeight; window.scrollTo(0, document.body.scrollHeight); };
    const add = (role, text) => { ui.chat.push({ role, text }); chat.insertAdjacentHTML('beforeend', `<div class="bubble ${role}">${role === 'user' ? esc(text) : text}</div>`); scroll(); };
    async function ask(q) {
      q = q.trim(); if (!q) return;
      add('user', q);
      let a;
      if (S.settings.ia.chave) { try { a = await answerOnline(q); } catch (e) { a = answerLocal(q) + `<br><small class="muted">(IA online indisponível: ${esc(e.message)} — resposta local.)</small>`; } }
      else a = answerLocal(q);
      add('bot', a);
    }
    el.querySelector('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = e.target.q; const v = i.value; i.value = ''; ask(v); });
    el.querySelector('.sugg').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) ask(b.dataset.q); });
    scroll();
  },
};
