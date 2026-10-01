// Servidor estático local para testar o portal em http://localhost:8080 (domínio já autorizado no Firebase).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};
const BLOCKED = /(^|[/\\])(\.git|node_modules|\.superpowers|scripts|tests|docs)([/\\]|$)/;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  const file = join(root, path);
  if (!file.startsWith(root) || BLOCKED.test(path)) { res.writeHead(404).end('não encontrado'); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404).end('não encontrado');
  }
}).listen(8080, '127.0.0.1', () => console.log('Portal em http://localhost:8080/ (Ctrl+C para parar)'));
