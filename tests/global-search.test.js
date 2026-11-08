import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalSearch } from '../js/global-search.js';
import { createDom, flush } from './helpers/dom-env.js';

const ALUNOS = [
  { student_id: 'ALU-1', nome_completo: 'Ana Ficticia', status: 'Ativo', faixa: 'Azul', idade: 11 },
  { student_id: 'ALU-2', nome_completo: 'Bruno Ficticio', status: 'Inativo', faixa: 'Branca', idade: 36 },
];
const ok = (itens) => ({ ok: true, data: { itens }, error: null, correlationId: 'c1' });

function setup({ respond = () => ok(ALUNOS), hasPay = true } = {}) {
  const dom = createDom();
  const calls = [];
  const opened = [];
  const paid = [];
  const auth = [];
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(acao, args); } };
  const search = createGlobalSearch({
    doc: dom.doc,
    api,
    openStudent: (id) => opened.push(id),
    openMensalidades: (f) => paid.push(f),
    hasPay: () => hasPay,
    onAuthFailure: (code) => auth.push(code),
    setTimer: (fn) => { fn(); return 1; },
    clearTimer: () => {},
  });
  const key = (event) => (dom.docListeners.keydown || []).forEach((fn) => fn(event));
  const type = (value) => { dom.$('search-q').value = value; dom.$('search-q').listeners.input(); };
  const openAndType = (value) => { key({ key: 'k', ctrlKey: true }); type(value); };
  return { dom, search, calls, opened, paid, auth, key, type, openAndType };
}

test('Ctrl+K abre a busca, foca o campo e isola o resto da tela', () => {
  const { dom, key } = setup();
  key({ key: 'k', ctrlKey: true });
  assert.equal(dom.$('search').hidden, false);
  assert.equal(dom.$('view-app').inert, true);
  assert.ok(dom.$('search-q').focused > 0);
});

test('digitar 2+ caracteres busca e mostra os resultados; menos que isso não chama o servidor', async () => {
  const { dom, calls, type, openAndType } = setup();
  openAndType('a');
  assert.equal(calls.length, 0);
  type('an');
  await flush();
  assert.deepEqual(calls[0], { acao: 'alunos.listar', args: [{ busca: 'an', status: '' }] });
  assert.equal(dom.$('search-results').children.length, 2);
  assert.equal(dom.$('search-results').children[0].children[0].children[0].textContent, 'Ana Ficticia');
  assert.equal(dom.$('search-empty').hidden, true);
});

test('sem resultado: mensagem de vazio e botão de pagamento escondido', async () => {
  const { dom, openAndType } = setup({ respond: () => ok([]) });
  openAndType('zzz');
  await flush();
  assert.equal(dom.$('search-empty').hidden, false);
  assert.match(dom.$('search-empty').textContent, /Nenhum aluno/);
  assert.equal(dom.$('search-mens').hidden, true);
});

test('clicar no resultado abre o cadastro e fecha a busca', async () => {
  const { dom, opened, openAndType } = setup();
  openAndType('an');
  await flush();
  dom.$('search-results').children[1].children[0].listeners.click();
  assert.deepEqual(opened, ['ALU-2']);
  assert.equal(dom.$('search').hidden, true);
  assert.equal(dom.$('view-app').inert, false);
});

test('teclado: setas mudam a seleção e Enter abre o escolhido', async () => {
  const { dom, key, openAndType, opened } = setup();
  openAndType('fict');
  await flush();
  const options = () => dom.$('search-results').children.map((li) => li.children[0].getAttribute('aria-selected'));
  assert.deepEqual(options(), ['true', 'false']);
  key({ key: 'ArrowDown' });
  assert.deepEqual(options(), ['false', 'true']);
  key({ key: 'Enter' });
  assert.deepEqual(opened, ['ALU-2']);
});

test('Escape e o fundo fecham sem escolher', () => {
  const { dom, key, opened } = setup();
  key({ key: 'k', ctrlKey: true });
  key({ key: 'Escape' });
  assert.equal(dom.$('search').hidden, true);
  key({ key: 'k', ctrlKey: true });
  dom.click('search-backdrop');
  assert.equal(dom.$('search').hidden, true);
  assert.deepEqual(opened, []);
});

test('"Registrar pagamento deste aluno" abre Mensalidades filtrada pelo nome', async () => {
  const { dom, openAndType, paid } = setup();
  openAndType('ana');
  await flush();
  assert.equal(dom.$('search-mens').hidden, false);
  dom.click('search-mens');
  assert.deepEqual(paid, [{ busca: 'Ana Ficticia' }]);
  assert.equal(dom.$('search').hidden, true);
});

test('sem permissão de pagamento: o atalho não aparece', async () => {
  const { dom, openAndType } = setup({ hasPay: false });
  openAndType('ana');
  await flush();
  assert.equal(dom.$('search-mens').hidden, true);
});

test('sessão recusada: fecha a busca e avisa o aplicativo', async () => {
  const { dom, openAndType, auth } = setup({ respond: () => ({ ok: false, data: null, error: { code: 'ACESSO_NEGADO', message: 'x' }, correlationId: 'c' }) });
  openAndType('ana');
  await flush();
  assert.deepEqual(auth, ['ACESSO_NEGADO']);
  assert.equal(dom.$('search').hidden, true);
});

test('falha de transporte: mensagem no painel e busca continua aberta', async () => {
  const { dom, openAndType } = setup({ respond: () => { throw Object.assign(new Error('Sem conexão.'), { name: 'TransportError', kind: 'network' }); } });
  openAndType('ana');
  await flush();
  assert.equal(dom.$('search').hidden, false);
  assert.equal(dom.$('search-empty').hidden, false);
  assert.match(dom.$('search-empty').textContent, /Sem conexão/);
});
