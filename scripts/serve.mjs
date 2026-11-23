// Tiny static server for previewing _site/ locally. Usage: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '_site');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

if (!existsSync(ROOT)) { console.error('_site/ not found, run `npm run build` first'); process.exit(1); }

createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url.replace(/^\/{2,}/, '/'), 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  let f = resolve(ROOT, '.' + urlPath);
  if (f !== ROOT && !f.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  if (existsSync(f) && statSync(f).isDirectory()) {
    if (!urlPath.endsWith('/')) { res.writeHead(301, { Location: urlPath + '/' }).end(); return; }
    f = join(f, 'index.html');
  }
  if (!existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`Serving _site/ at http://localhost:${PORT}/`));
