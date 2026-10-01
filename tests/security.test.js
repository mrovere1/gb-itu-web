import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const html = read('index.html');
const jsFiles = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).sort();
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const EXPECTED_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://script.google.com https://script.googleusercontent.com; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";

test('política de conteúdo: meta com exatamente a política aprovada', () => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, 'meta de política de conteúdo ausente');
  assert.equal(m[1], EXPECTED_CSP);
});

test('index.html: sem script inline, estilo inline, manipulador de evento nem endereço externo', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  assert.ok(scripts.length >= 1, 'nenhum <script>');
  scripts.forEach((s) => assert.match(s, /\ssrc="[^"]+"/, s));
  assert.ok(!/<script\b[^>]*>[^<]+<\/script>/i.test(html), 'conteúdo dentro de <script>');
  assert.ok(!/<style\b/i.test(html), '<style> inline');
  assert.ok(!/\sstyle\s*=/i.test(html), 'atributo style');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'manipulador on*=');
  assert.ok(!/javascript:/i.test(html), 'endereço javascript:');
  [...html.matchAll(/\s(?:src|href)="([^"]+)"/gi)].forEach((m) => {
    if (m[1].startsWith('#')) return;
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(m[1]) && !m[1].startsWith('//'), 'endereço externo: ' + m[1]);
  });
});

test('código do portal: sem APIs perigosas, sem armazenamento e sem log', () => {
  const banned = [
    /\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write\b/, /\beval\s*\(/, /\bnew Function\b/,
    /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bconsole\./, /\bXMLHttpRequest\b/, /\bWebSocket\b/,
  ];
  jsFiles.forEach((f) => {
    const src = stripComments(read('js/' + f));
    banned.forEach((re) => assert.ok(!re.test(src), `js/${f} contém ${re}`));
  });
});

test('só api.js e main.js usam fetch; a URL da API só existe em config.js', () => {
  jsFiles.forEach((f) => {
    const src = stripComments(read('js/' + f));
    if (f !== 'api.js' && f !== 'main.js') assert.ok(!/\bfetch\b/.test(src), `js/${f} usa fetch`);
    if (f !== 'config.js') assert.ok(!/script\.google\.com\/macros/.test(src), `js/${f} tem a URL da API`);
  });
});

test('SDK do Firebase copiado: versão fixada, imports relativos e SHA-256 conferido', () => {
  const version = read('vendor/firebase/VERSION').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const dir = `vendor/firebase/${version}`;
  assert.deepEqual(readdirSync(join(root, dir)).sort(), ['firebase-app.js', 'firebase-auth.js']);
  const auth = read(dir + '/firebase-auth.js');
  assert.ok(!/gstatic\.com\/firebasejs/.test(auth), 'import absoluto do CDN');
  assert.ok(/from"\.\/firebase-app\.js"/.test(auth), 'import relativo do firebase-app.js');
  const sums = read('vendor/firebase/SHA256SUMS').trim().split('\n').map((l) => l.split(/\s+/));
  assert.equal(sums.length, 2);
  sums.forEach(([hash, file]) => {
    const actual = createHash('sha256').update(readFileSync(join(root, 'vendor/firebase', file))).digest('hex');
    assert.equal(actual, hash, file);
  });
});

test('domínio e ícone: CNAME correto e ícone da aba existente', () => {
  assert.equal(read('CNAME').trim(), 'gb.mrovere.com');
  assert.ok(existsSync(join(root, 'img/icone.png')));
});

test('carimbo de versão dos arquivos está atualizado', () => {
  execFileSync('node', ['scripts/stamp-version.js', '--check'], { cwd: root, stdio: 'pipe' });
});

test('firebase.js é o único arquivo que importa o SDK e aponta para a versão fixada', () => {
  const version = read('vendor/firebase/VERSION').trim();
  const imports = jsFiles.filter((f) => /vendor\/firebase/.test(read('js/' + f)));
  assert.deepEqual(imports, ['firebase.js']);
  const src = read('js/firebase.js');
  assert.ok(src.includes(`../vendor/firebase/${version}/firebase-app.js`));
  assert.ok(src.includes(`../vendor/firebase/${version}/firebase-auth.js`));
  assert.ok(/initializeAuth\(/.test(src) && !/getAuth\(/.test(src), 'deve usar initializeAuth, sem getAuth');
  assert.ok(/browserSessionPersistence/.test(src));
  assert.ok(!/popupRedirectResolver|signInWithPopup|signInWithRedirect|GoogleAuthProvider/.test(src), 'sem login por popup');
});
