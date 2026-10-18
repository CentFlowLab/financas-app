// Gráficos SVG simples (sem dependências)
import { esc, eur, num } from './util.js';
import { PALETTE } from './defaults.js';
export const color = (i) => PALETTE[i % PALETTE.length];

export function donut(items, { size = 200, centerTop = '', centerBottom = '' } = {}) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const r = 70, C = 2 * Math.PI * r;
  let off = 0;
  const arcs = total ? items.map((it) => {
    const len = (it.value / total) * C;
    const s = `<circle r="${r}" cx="100" cy="100" fill="none" stroke="${it.color}" stroke-width="28" stroke-dasharray="${Math.max(len - (items.length > 1 ? 1.5 : 0), 0.1)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)"><title>${esc(it.label)}: ${eur(it.value)}</title></circle>`;
    off += len; return s;
  }).join('') : `<circle r="${r}" cx="100" cy="100" fill="none" stroke="var(--line)" stroke-width="28"/>`;
  return `<svg class="donut" viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-label="Gráfico circular de despesas por categoria">${arcs}<text x="100" y="96" text-anchor="middle" class="d-top">${esc(centerTop)}</text><text x="100" y="118" text-anchor="middle" class="d-bot">${esc(centerBottom)}</text></svg>`;
}

// groups: [{label, a, b}] — a = entradas, b = saídas
export function bars(groups, { colors = ['var(--pos)', 'var(--neg)'], names = ['Entradas', 'Saídas'] } = {}) {
  const W = 320, H = 150, pad = 24, base = H - 22;
  const max = Math.max(0, ...groups.flatMap((g) => [g.a, g.b]));
  if (!max) return '<p class="muted center">Ainda sem dados para mostrar.</p>';
  const gw = (W - pad) / groups.length;
  const bw = Math.min(16, gw / 3);
  const h = (v) => Math.round(((base - 12) * v) / max);
  const els = groups.map((g, i) => {
    const x = pad + i * gw + gw / 2;
    return `<g><rect x="${x - bw - 1}" y="${base - h(g.a)}" width="${bw}" height="${h(g.a)}" rx="3" fill="${colors[0]}"><title>${names[0]}: ${eur(g.a)}</title></rect><rect x="${x + 1}" y="${base - h(g.b)}" width="${bw}" height="${h(g.b)}" rx="3" fill="${colors[1]}"><title>${names[1]}: ${eur(g.b)}</title></rect><text x="${x}" y="${H - 6}" text-anchor="middle" class="ax">${esc(g.label)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="bars" role="img" aria-label="Entradas e saídas por mês"><line x1="${pad}" x2="${W}" y1="${base}" y2="${base}" stroke="var(--line)"/><text x="0" y="12" class="ax">${esc(eur(max).replace(/,00/, ''))}</text>${els}</svg>`;
}

// points: [{label, v}]
export function line(points, { unit = '', decimals = 2, stroke = 'var(--accent)' } = {}) {
  if (!points.length) return '';
  const W = 320, H = 130, px = 28, top = 16, base = H - 22;
  const vs = points.map((p) => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => (points.length === 1 ? W / 2 : px + (i * (W - px - 10)) / (points.length - 1));
  const y = (v) => top + ((max - v) / (max - min)) * (base - top);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5" fill="${stroke}"><title>${esc(p.label)}: ${num(p.v, decimals)} ${unit}</title></circle>`).join('');
  const lab = (i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : 'end'}" class="ax">${esc(points[i].label)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="lines" role="img"><line x1="${px}" x2="${W - 6}" y1="${base}" y2="${base}" stroke="var(--line)"/><text x="0" y="${top + 4}" class="ax">${num(max, decimals)}</text><text x="0" y="${base}" class="ax">${num(min, decimals)}</text><path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}${lab(0)}${points.length > 1 ? lab(points.length - 1) : ''}</svg>`;
}
