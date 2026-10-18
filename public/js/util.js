// Utilitários gerais: formatação pt-PT, datas, valores em cêntimos
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const nfEur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const nf2 = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur = (cents) => nfEur.format((cents || 0) / 100);
export const eurSigned = (cents) => (cents > 0 ? '+' : '') + eur(cents);
export const num = (n, d = 2) => new Intl.NumberFormat('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
export const pct = (n, d = 1) => num(n, d) + ' %';
export { nf2 };

// "12,50" | "1.234,56" | "12.5" -> cêntimos (NaN se inválido)
export function parseEuro(str) {
  let s = String(str ?? '').replace(/[€\s\u00a0]/g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-');
  s = s.replace(/^-/, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const v = Math.round(parseFloat(s) * 100);
  return neg ? -v : v;
}
export const parseDec = (str, thousands = false) => { // número decimal genérico (litros, km, taxas)
  let s = String(str ?? '').replace(/[\s\u00a0]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (thousands && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  return Number.isFinite(v) ? v : NaN;
};
export const centsToInput = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

// Datas: guardadas como 'YYYY-MM-DD', apresentadas dd/mm/aaaa
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISO(new Date());
export const fmtDate = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
export const monthKey = (iso) => iso.slice(0, 7);
export const curMonth = () => today().slice(0, 7);
export const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return cap(new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))).replace(' De ', ' de '); };
export const monthShort = (key) => { const [y, m] = key.split('-').map(Number); return cap(new Intl.DateTimeFormat('pt-PT', { month: 'short' }).format(new Date(y, m - 1, 1)).replace('.', '')); };
export const monthName = (m) => cap(new Intl.DateTimeFormat('pt-PT', { month: 'long' }).format(new Date(2000, m - 1, 1)));
export const weekdayLabel = (iso) => cap(new Intl.DateTimeFormat('pt-PT', { weekday: 'long' }).format(new Date(iso + 'T12:00:00')));
export function addMonthsISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  return toISO(new Date(y, m - 1 + n, Math.min(d, last)));
}
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// Comparação com um período anterior. good = 'up' (mais é melhor) | 'down' (menos é melhor).
// Devolve { dir: 'up'|'down'|'flat'|'new'|'none', pct, tone: 'pos'|'neg'|'flat', text, arrow }
export function compare(cur, prev, { good = 'up', hasPrev = true } = {}) {
  if (!hasPrev) return { dir: 'none', pct: null, tone: 'flat', text: '—', arrow: '' };
  if (cur === prev) return { dir: 'flat', pct: 0, tone: 'flat', text: '0 %', arrow: '=' };
  const up = cur > prev;
  const tone = up === (good === 'up') ? 'pos' : 'neg';
  if (!prev) return { dir: 'new', pct: null, tone, text: 'novo', arrow: up ? '↑' : '↓' };
  const pc = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pc) < 0.05) return { dir: 'flat', pct: 0, tone: 'flat', text: '0 %', arrow: '=' };
  const a = Math.abs(pc) + 1e-9; // evita 56,4999… a arredondar para baixo
  const t = a > 999 ? '>999 %' : a >= 10 ? Math.round(a) + ' %' : num(a, 1) + ' %';
  return { dir: up ? 'up' : 'down', pct: pc, tone, text: t, arrow: up ? '↑' : '↓' };
}
