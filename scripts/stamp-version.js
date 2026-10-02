// Carimba ?v=<hash do conteúdo> nos endereços de arquivos do portal, para driblar o cache de 10 minutos do GitHub Pages.
// Uso: node scripts/stamp-version.js            (grava)
//      node scripts/stamp-version.js --check    (falha se estiver desatualizado)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const STAMPED = ['index.html', 'js/main.js', 'js/dashboard.js', 'js/dashboard-admin.js', 'js/mensalidades.js', 'js/alunofull.js'];
const jsFiles = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).sort().map((f) => 'js/' + f);
const imgFiles = readdirSync(join(root, 'img')).sort().map((f) => 'img/' + f);
const SOURCES = ['index.html', 'css/app.css', ...jsFiles];
const TOKEN = /\?v=[A-Za-z0-9]+/g;

const read = (p) => readFileSync(join(root, p), 'utf8');
const hash = createHash('sha256');
SOURCES.forEach((p) => hash.update(p + '\0' + read(p).replace(TOKEN, '?v=@') + '\0'));
imgFiles.forEach((p) => { hash.update(p + '\0'); hash.update(readFileSync(join(root, p))); hash.update('\0'); }); // binários: bytes puros
const version = hash.digest('hex').slice(0, 10);

const check = process.argv.includes('--check');
let stale = 0;
STAMPED.forEach((p) => {
  const current = read(p);
  const next = current.replace(TOKEN, '?v=' + version);
  if (next === current) return;
  if (check) { stale += 1; console.error('desatualizado: ' + p); } else { writeFileSync(join(root, p), next); console.log('carimbado: ' + p); }
});
if (check && stale) { console.error('Execute: npm run stamp'); process.exit(1); }
if (!check) console.log('versão ' + version);
