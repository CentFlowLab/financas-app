import { load, onChange, S } from './db.js';
import { ICONS } from './icons.js';
import { esc } from './util.js';
import { toast } from './ui.js';
import { expiringWarranties } from './model.js';
import painel from './modules/painel.js';
import movimentos, { openMovementForm } from './modules/movimentos.js';
import contas from './modules/contas.js';
import dividas from './modules/dividas.js';
import taloes from './modules/taloes.js';
import combustivel from './modules/combustivel.js';
import garantias from './modules/garantias.js';
import precos from './modules/precos.js';
import assistente from './modules/assistente.js';
import categorias from './modules/categorias.js';
import definicoes from './modules/definicoes.js';

// Registo de módulos — para acrescentar um módulo novo basta criar o ficheiro e juntá-lo aqui.
const MAIN = [painel, movimentos, contas, dividas];
const MORE = [taloes, combustivel, garantias, precos, assistente, categorias, definicoes];
const ALL = [...MAIN, ...MORE];

const mais = {
  id: 'mais', titulo: 'Mais', icone: 'mais',
  badge: () => MORE.reduce((a, m) => a + (Number(m.badge?.()) || 0), 0) || '',
  render: () => `<h1 class="page-title">Mais</h1><div class="more-grid">${MORE.map((m) => `<a class="more-item" href="#/${m.id}">${ICONS[m.icone]}<span>${esc(m.titulo)}</span>${m.badge?.() ? `<b class="badge">${m.badge()}</b>` : ''}<small>${esc(m.descricao || '')}</small></a>`).join('')}</div>`,
};

const $ = (s) => document.querySelector(s);
let current = null, currentKey = '';

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'painel';
  const [id, q] = h.split('?');
  return { id, params: new URLSearchParams(q || '') };
}

function renderNav(activeId) {
  const inMore = !MAIN.some((m) => m.id === activeId);
  const item = (m, active, href) => `<a class="nav-item ${active ? 'active' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>${ICONS[m.icone]}<span>${esc(m.titulo)}</span>${m.badge?.() ? `<b class="badge">${m.badge()}</b>` : ''}</a>`;
  $('#tabs').innerHTML = MAIN.map((m) => item(m, m.id === activeId, '#/' + m.id)).join('') + item(mais, inMore, '#/mais');
  $('#side').innerHTML = `<div class="brand"><img src="icons/icon.svg" alt="" width="34" height="34"><div><b>Finanças</b><small>As suas contas, em privado</small></div></div>` + ALL.map((m) => item(m, m.id === activeId, '#/' + m.id)).join('');
}

async function render() {
  let { id, params } = parseHash();
  let mod = id === 'mais' ? mais : ALL.find((m) => m.id === id);
  if (!mod) { location.replace('#/painel'); return; }
  const key = id + '?' + params.toString();
  const y = window.scrollY;
  const el = document.createElement('div');
  el.className = 'view';
  const ctx = { params, rerender: render, go: (h) => { location.hash = h; } };
  try {
    el.innerHTML = mod.render(ctx);
    mod.mount?.(el, ctx);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="empty"><h3>Ocorreu um erro</h3><p>${esc(e.message)}</p></div>`;
  }
  $('#view').replaceChildren(el);
  document.title = (mod.titulo === 'Painel' ? '' : mod.titulo + ' · ') + 'Finanças';
  renderNav(id);
  $('#fab').hidden = id === 'assistente' || id === 'definicoes';
  window.scrollTo(0, id === current ? y : 0);
  current = id; currentKey = key;
}

export function applyTheme() {
  const t = S.settings.tema || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('fin-tema', t); } catch { /* ignorar */ }
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0b1b1a' : '#0f766e';
}

garantias.badge = () => expiringWarranties().length || '';

window.addEventListener('hashchange', render);
let pending = false;
onChange(() => { applyTheme(); if (!pending) { pending = true; queueMicrotask(() => { pending = false; render(); }); } });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installEvt = e; if (current === 'definicoes') render(); });

(async function init() {
  $('#fab').innerHTML = ICONS.plus;
  $('#fab').addEventListener('click', () => openMovementForm({}));
  try { await load(); } catch (e) { console.error(e); $('#view').innerHTML = `<div class="empty"><h3>Não foi possível abrir o armazenamento local</h3><p>${esc(e.message || e)}. Verifique se o navegador permite guardar dados neste site (modo privado bloqueia).</p></div>`; return; }
  applyTheme();
  await render();
  window.__ready = true;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  warmOCR();
  const exp = expiringWarranties();
  if (exp.length) toast(`⚠️ ${exp.length} garantia(s) a expirar em breve`);
})();

// Descarrega o motor de OCR em segundo plano (uma vez) para a leitura de talões funcionar offline
function warmOCR() {
  try {
    if (localStorage.getItem('fin-ocr') || !navigator.onLine || navigator.connection?.saveData || !('serviceWorker' in navigator)) return;
    setTimeout(() => import('./ocr.js').then((m) => m.warmup()).then(() => localStorage.setItem('fin-ocr', '1')).catch(() => {}), 8000);
  } catch { /* ignorar */ }
}
