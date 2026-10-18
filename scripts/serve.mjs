// Servidor estático mínimo (sem dependências). Uso: node scripts/serve.mjs [pasta] [porta]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = process.argv[2] || 'dist';
const port = Number(process.argv[3] || process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.md': 'text/plain; charset=utf-8' };
createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let f = join(root, p);
    if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, 'index.html');
    const data = await readFile(f);
    res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream', 'Cache-Control': f.endsWith('sw.js') ? 'no-cache' : 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Não encontrado'); }
}).listen(port, '0.0.0.0', () => console.log(`Finanças a servir ${root}/ em http://localhost:${port}`));
