import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

const FIELDS = ['nome_completo', 'nome_social', 'data_nascimento', 'data_matricula', 'status', 'faixa', 'graus', 'cpf',
  'telefone', 'email', 'contato_emergencia', 'telefone_emergencia', 'restricoes_medicas', 'observacoes'];

const STATIC_IDS = ['tab-dashboard', 'tab-students', 'view-dashboard', 'view-students', 'box-cpf', 'box-restricoes_medicas',
  'students-filter', 'students-q', 'students-status', 'students-new', 'students-loading', 'students-error', 'students-error-msg',
  'students-error-ref', 'students-retry', 'students-empty', 'students-ready', 'students-count', 'students-list',
  'student-form-section', 'form-cancel', 'form-title', 'student-form', 'form-summary', 'confirm-box',
  'f-confirmarDuplicidade', 'e-confirmarDuplicidade', 'hint-emergencia', 'form-submit', 'form-reload',
  'student-detail', 'detail-back', 'detail-edit', 'detail-name', 'detail-notice', 'detail-warnings', 'detail-fields'];

test('markup: todo id que os módulos de Alunos usam existe no index.html', () => {
  const needed = [...STATIC_IDS, ...FIELDS.map((f) => 'f-' + f), ...FIELDS.map((f) => 'e-' + f)];
  const missing = needed.filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('markup: ids são únicos', () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(all.length, new Set(all).size);
});

test('markup: Alunos começa escondido, Início visível e campos sensíveis identificados por id (não por atributo)', () => {
  assert.match(html, /id="view-students"[^>]*\shidden/);
  assert.doesNotMatch(html, /id="view-dashboard"[^>]*\shidden/);
  assert.doesNotMatch(html, /data-sensitive/);
  assert.match(html, /id="box-cpf"/);
  assert.match(html, /id="box-restricoes_medicas"/);
});

test('markup: nada de check-in ou QR Code na interface (CLAUDE.md §10)', () => {
  assert.doesNotMatch(html, /qr ?code|check-?in/i);
});
