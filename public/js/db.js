// Armazenamento local (IndexedDB). Estado em memória (S) + persistência por coleção.
// Modelo de dados (versão 2) — cada módulo futuro acrescenta a sua própria coleção:
//   accounts, categories, movements, debts, debtPayments,
//   vehicles, fuel, warranties, receipts, prices
// Valores monetários em cêntimos (inteiros); datas em 'AAAA-MM-DD'; fotos na store 'images' (Blob).
import { DEFAULT_CATEGORIES, DEFAULT_ACCOUNTS, DEFAULT_SETTINGS } from './defaults.js';

export const SCHEMA_VERSION = 2; // v2: categorias de saída podem ter 'orcamento' (cêntimos/mês)
export const COLLS = ['accounts', 'categories', 'movements', 'debts', 'debtPayments', 'vehicles', 'fuel', 'warranties', 'receipts', 'prices'];
export const S = { meta: { versao: SCHEMA_VERSION, criadoEm: new Date().toISOString() }, settings: DEFAULT_SETTINGS() };
COLLS.forEach((c) => (S[c] = []));

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f());

let dbp;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('financas-pessoais', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('images'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return dbp.then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export function seedDefaults() {
  S.categories = structuredClone(DEFAULT_CATEGORIES);
  S.accounts = DEFAULT_ACCOUNTS();
}

export async function load() {
  dbp = openDB();
  const saved = await tx('kv', 'readonly', (s) => s.get('meta'));
  if (!saved) {
    seedDefaults();
    await save(...COLLS, 'settings', 'meta');
  } else {
    for (const k of [...COLLS, 'settings', 'meta']) {
      const v = await tx('kv', 'readonly', (s) => s.get(k));
      if (v !== undefined) S[k] = v;
    }
    S.settings = { ...DEFAULT_SETTINGS(), ...S.settings, ia: { ...DEFAULT_SETTINGS().ia, ...(S.settings.ia || {}) } };
    const antes = S.meta.versao || 1;
    migrate();
    if (antes !== SCHEMA_VERSION) await save('categories', 'meta'); // guarda o esquema migrado
  }
  try { navigator.storage?.persist?.(); } catch { /* ignorar */ }
}

function migrate() {
  // v1 -> v2: orçamento mensal por categoria (campo opcional 'orcamento', em cêntimos; null = sem orçamento)
  if ((S.meta.versao || 1) < 2) S.categories.forEach((c) => { if (c.orcamento === undefined) c.orcamento = null; });
  S.categories.forEach((c) => { if (!(c.orcamento > 0) || c.tipo !== 'saida') c.orcamento = null; });
  S.meta.versao = SCHEMA_VERSION;
}

export function save(...keys) {
  const ps = keys.map((k) => tx('kv', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(S[k])), k)));
  emit();
  return Promise.all(ps);
}

// ---------- imagens (fotos de talões / garantias) ----------
export const putImage = async (blob, id) => { id = id || 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); await tx('images', 'readwrite', (s) => s.put(blob, id)); return id; };
export const getImage = (id) => tx('images', 'readonly', (s) => s.get(id));
const urlCache = new Map();
export async function imageURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await getImage(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(id, u);
  return u;
}
export function imageInUse(id) {
  return S.receipts.some((r) => r.fotoId === id) || S.warranties.some((w) => w.fotoId === id);
}
export async function dropImageIfUnused(id) {
  if (!id || imageInUse(id)) return;
  await tx('images', 'readwrite', (s) => s.delete(id));
  urlCache.delete(id);
}

// ---------- cópia de segurança ----------
const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
export async function exportData() {
  const imagens = {};
  const ids = await tx('images', 'readonly', (s) => s.getAllKeys());
  for (const id of ids) imagens[id] = await blobToDataURL(await getImage(id));
  const settings = { ...S.settings, ia: { ...S.settings.ia, chave: '' } }; // a chave de API nunca sai do dispositivo
  const dados = { settings }; COLLS.forEach((c) => (dados[c] = S[c]));
  return JSON.stringify({ app: 'financas-pessoais', versao: SCHEMA_VERSION, exportadoEm: new Date().toISOString(), dados, imagens }, null, 1);
}

export function parseBackup(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('O ficheiro não é um JSON válido.'); }
  if (!o || o.app !== 'financas-pessoais' || typeof o.dados !== 'object') throw new Error('Este ficheiro não é uma cópia de segurança desta aplicação.');
  if (o.versao > SCHEMA_VERSION) throw new Error('A cópia foi criada por uma versão mais recente da aplicação.');
  for (const c of COLLS) if (o.dados[c] !== undefined && !Array.isArray(o.dados[c])) throw new Error(`Dados inválidos na secção "${c}".`);
  return o;
}

export async function importData(o) {
  const keepKey = S.settings.ia?.chave || '';
  COLLS.forEach((c) => (S[c] = o.dados[c] || []));
  if (!S.categories.length) S.categories = structuredClone(DEFAULT_CATEGORIES);
  S.settings = { ...DEFAULT_SETTINGS(), ...(o.dados.settings || {}) };
  S.settings.ia = { ...DEFAULT_SETTINGS().ia, ...(S.settings.ia || {}), chave: keepKey };
  migrate();
  await tx('images', 'readwrite', (s) => s.clear());
  urlCache.clear();
  for (const [id, data] of Object.entries(o.imagens || {})) await putImage(await (await fetch(data)).blob(), id);
  await save(...COLLS, 'settings', 'meta');
}

export async function resetAll() {
  COLLS.forEach((c) => (S[c] = []));
  S.settings = DEFAULT_SETTINGS();
  seedDefaults();
  await tx('images', 'readwrite', (s) => s.clear());
  urlCache.clear();
  await save(...COLLS, 'settings', 'meta');
}
