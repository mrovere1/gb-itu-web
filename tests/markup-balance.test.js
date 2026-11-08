import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateHtml } from '../scripts/validate-html.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');

test('index.html: tags balanceadas e ids únicos', () => {
  assert.deepEqual(validateHtml(html), []);
});

test('index.html: um único main e as views fecham antes dele', () => {
  assert.equal((html.match(/<main\b/g) || []).length, 1);
  assert.equal((html.match(/<\/main>/g) || []).length, 1);
  // As abas precisam fechar antes do </main>; os drawers de Mensalidades ficam fora das views.
  const mainAt = html.indexOf('</main>');
  const viewStudentsAt = html.indexOf('id="view-students"');
  assert.ok(viewStudentsAt > -1 && viewStudentsAt < mainAt);
  assert.ok(html.indexOf('</section>', viewStudentsAt) < mainAt);
});

test('validador: acusa tag faltando e id duplicado', () => {
  assert.deepEqual(validateHtml('<div><span></span></div>'), []);
  assert.equal(validateHtml('<div><span></div>').length, 1);
  assert.equal(validateHtml('<p id="a"></p><p id="a"></p>').length, 1);
  assert.equal(validateHtml('<img src="x"><br><input>').length, 0);
  assert.equal(validateHtml('<script>if (a < b) {}</script>').length, 0);
});
