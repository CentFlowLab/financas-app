// Build estático: copia public/ -> dist/ e gera a lista de ficheiros para pré-cache offline.
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const src = 'public', out = 'dist';
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(relative(out, p).split('\\').join('/')); } })(out);
const shell = files.filter((f) => f !== 'sw.js' && f !== '_headers' && !f.startsWith('vendor/tesseract/')).sort();
const h = createHash('sha1');
for (const f of shell) h.update(f).update(readFileSync(join(out, f)));
const version = h.digest('hex').slice(0, 10);
let sw = readFileSync(join(out, 'sw.js'), 'utf8');
sw = sw.replace("const VERSION = 'dev';", `const VERSION = '${version}';`).replace('const SHELL = [];', `const SHELL = ${JSON.stringify(['./', ...shell])};`);
writeFileSync(join(out, 'sw.js'), sw);
console.log(`dist/ pronto — ${files.length} ficheiros, ${shell.length} em pré-cache, versão ${version}`);
