import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlunoFull } from '../js/alunofull.js';
import { createDataTable } from '../js/data-table.js';
import { createApp } from '../js/app.js';
import { createDom, flush } from './helpers/dom-env.js';

const PARTS = ['af-loading', 'af-error', 'af-empty', 'af-ready'];
const ok = (data) => ({ ok: true, data, error: null, correlationId: 'c1' });
const fail = (code, message) => ({ ok: false, data: null, error: { code, message }, correlationId: 'c2' });
const flat = (t) => String(t).replace(/\s/g, ' ');

const mat = (over = {}) => ({ enrollment_id: 'MAT-1', plan_id: 'PLA-1', plano: 'Custom', valor: 200, dia_vencimento: 10, status: 'Ativa', pago_ate: '', tipo_isencao: '', ...over });
const aluno = (id, nome, over = {}) => ({ student_id: id, nome, status: 'Ativo', faixa: 'Branca', graus: 0, familia_id: null, papel: 'sem_responsavel', responsaveis: [], matricula: mat(), pendentes: 0, vencidas: 0, valorPendente: 0, ...over });
const DATA = () => ({
  familias: [
    { guardian_id: 'RES-1', tipo: 'aluno', aluno_id: 'ALU-1', nome: 'Bruno Ficticio', membros: ['ALU-1', 'ALU-2'], resumo: { alunos: 2, mensal: 350, pendentes: 2, vencidas: 1, valorPendente: 300 } },
    { guardian_id: 'RES-2', tipo: 'externo', aluno_id: null, nome: 'Carla Externa', membros: [], resumo: { alunos: 0, mensal: 0, pendentes: 0, vencidas: 0, valorPendente: 0 } },
  ],
  alunos: [
    aluno('ALU-1', 'Bruno Ficticio', { familia_id: 'RES-1', papel: 'responsavel' }),
    aluno('ALU-2', 'Ana Ficticia', { familia_id: 'RES-1', papel: 'dependente', matricula: mat({ valor: 150, pago_ate: '2027-01' }), pendentes: 2, vencidas: 1, valorPendente: 300 }),
    aluno('ALU-3', 'Daniela Solta', { matricula: mat({ valor: 180, tipo_isencao: 'Bolsa / cortesia' }) }),
  ],
  semResponsavel: ['ALU-3'],
  planos: [], avisos: [], total: 3,
});

const texts = (node) => [node._t, ...(node.children || []).flatMap(texts)].filter(Boolean);
const allText = (node) => flat(texts(node).join(' | '));

function setup(respond = () => ok(DATA()), { withTable = false } = {}) {
  const dom = createDom();
  const calls = [];
  const auth = [];
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(acao, args, calls.length); } };
  const createTable = withTable ? (opts) => createDataTable({ doc: dom.doc, storage: null, download: () => {}, ...opts }) : null;
  const af = createAlunoFull({ doc: dom.doc, api, onAuthFailure: (c) => auth.push(c), createTable });
  return { dom, calls, auth, af };
}

test('activate carrega uma única vez e pede alunofull.listar sem argumentos', async () => {
  const { dom, calls, af } = setup();
  af.activate();
  af.activate();
  assert.deepEqual(dom.visible(PARTS), ['af-loading']);
  await flush();
  assert.deepEqual(calls, [{ acao: 'alunofull.listar', args: [] }]);
  assert.deepEqual(dom.visible(PARTS), ['af-ready']);
});

test('mostra cada família com resumo, o responsável que é aluno, dependentes e o grupo sem responsável', async () => {
  const { dom, af } = setup();
  af.activate();
  await flush();
  const text = allText(dom.$('af-groups'));
  assert.match(text, /Bruno Ficticio/);
  assert.match(text, /Responsável e aluno/);
  assert.match(text, /2 alunos · R\$\s350,00\/mês · 2 pendências \(R\$\s300,00\)/);
  assert.match(text, /Carla Externa/);
  assert.match(text, /Nenhum dependente vinculado/);
  assert.match(text, /Sem responsável/);
  assert.match(text, /Daniela Solta/);
  assert.match(text, /Bolsa \/ cortesia/, 'isenção aparece no lugar do valor');
  assert.match(text, /01\/2027/, 'pago até em mês/ano');
  assert.equal(dom.$('af-count').textContent, '3 alunos');
});

test('busca por aluno ou por família, sem acento nem caixa; sem resultado mostra aviso', async () => {
  const { dom, af } = setup();
  af.activate();
  await flush();
  const q = dom.$('af-q');
  q.value = 'ANA';
  q.listeners.input();
  let text = allText(dom.$('af-groups'));
  assert.match(text, /Ana Ficticia/);
  assert.doesNotMatch(text, /Daniela/);
  assert.equal(dom.$('af-count').textContent, '1 de 3 alunos');
  q.value = 'carla';
  q.listeners.input();
  text = allText(dom.$('af-groups'));
  assert.match(text, /Carla Externa/);
  q.value = 'inexistente';
  q.listeners.input();
  assert.equal(dom.$('af-nomatch').hidden, false);
  assert.equal(dom.$('af-groups').children.length, 0);
});

test('alternar para Lista mostra a tabela configurável; Famílias volta ao agrupamento', async () => {
  const { dom, af } = setup(undefined, { withTable: true });
  af.activate();
  await flush();
  assert.equal(dom.$('af-views').hidden, false);
  assert.equal(dom.$('af-groups').hidden, false);
  assert.equal(dom.$('af-table-root').hidden, true);
  dom.$('af-view-list').listeners.click();
  assert.equal(dom.$('af-groups').hidden, true);
  assert.equal(dom.$('af-table-root').hidden, false);
  assert.equal(dom.$('af-view-list').getAttribute('aria-pressed'), 'true');
  assert.equal(dom.$('af-q-box').hidden, true, 'a tabela tem a própria busca');
  assert.match(allText(dom.$('af-table-root')), /3 registros/);
  dom.$('af-view-families').listeners.click();
  assert.equal(dom.$('af-groups').hidden, false);
});

test('sem a tabela injetada, não há alternância (só famílias)', async () => {
  const { dom, af } = setup();
  af.activate();
  await flush();
  assert.equal(dom.$('af-views').hidden, true);
});

test('lista vazia mostra o estado vazio', async () => {
  const { dom, af } = setup(() => ok({ ...DATA(), familias: [], alunos: [], semResponsavel: [], total: 0 }));
  af.activate();
  await flush();
  assert.deepEqual(dom.visible(PARTS), ['af-empty']);
});

test('inconsistências nos vínculos viram um aviso discreto', async () => {
  const { dom, af } = setup(() => ok({ ...DATA(), avisos: [{ tipo: 'RELACAO_INVALIDA' }, { tipo: 'RELACAO_INVALIDA' }] }));
  af.activate();
  await flush();
  assert.equal(dom.$('af-avisos').hidden, false);
  assert.match(dom.$('af-avisos').textContent, /2 vínculos com inconsistência/);
});

test('erro do servidor, transporte e resposta malformada mostram erro e nunca ficam em Carregando', async () => {
  for (const respond of [() => fail('ERRO_INTERNO', 'Erro seguro.'), () => { throw Object.assign(new Error('Sem rede.'), { name: 'TransportError' }); }, () => ok({ familias: 'x' })]) {
    const { dom, af } = setup(respond);
    af.activate();
    await flush();
    assert.deepEqual(dom.visible(PARTS), ['af-error']);
    assert.ok(dom.$('af-error-msg').textContent.length > 0);
    assert.ok(dom.$('af-retry').focused > 0);
  }
});

test('ACESSO_NEGADO e NAO_AUTENTICADO são repassados ao app (que encerra a sessão)', async () => {
  for (const code of ['ACESSO_NEGADO', 'NAO_AUTENTICADO']) {
    const { auth, af } = setup(() => fail(code, 'x'));
    af.activate();
    await flush();
    assert.deepEqual(auth, [code]);
  }
});

test('Atualizar recarrega; reset apaga a tela e descarta resposta que chegar depois', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  let n = 0;
  const { dom, calls, af } = setup(() => (++n === 1 ? ok(DATA()) : slow));
  af.activate();
  await flush();
  dom.$('af-refresh').listeners.click();
  assert.equal(calls.length, 2);
  af.reset();
  release(ok(DATA()));
  await flush();
  assert.deepEqual(dom.visible(PARTS), ['af-loading'], 'resposta antiga não repinta a tela');
  assert.equal(dom.$('af-groups').children.length, 0);
  assert.equal(dom.$('af-q').value, '');
  af.activate();
  await flush();
  assert.equal(calls.length, 3, 'depois do reset a lista é pedida de novo');
});

test('nomes vindos do servidor entram como texto, nunca como HTML', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const d = DATA();
  d.alunos[0].nome = evil;
  d.familias[0].nome = evil;
  const { dom, af } = setup(() => ok(d));
  af.activate();
  await flush();
  assert.ok(allText(dom.$('af-groups')).includes(evil));
});

// ---------- aba no app ----------
function appSetup(perfil) {
  const dom = createDom();
  const events = [];
  let onUser = null;
  const auth = { start: (cb) => { onUser = cb; }, login: async () => {}, logout: async () => { onUser(null); return true; }, touch() {}, checkIdle: async () => false };
  const api = { call: async () => ({ ok: true, data: { usuario: { nome: 'Teste', perfil } }, error: null, correlationId: 'c' }) };
  const stub = (name) => ({ activate: () => events.push(name + '.activate'), reset: () => events.push(name + '.reset'), load: async () => ({ ok: true }) });
  const app = createApp({ doc: dom.doc, auth, api, dashboard: stub('dash'), students: stub('students'), mensalidades: stub('mens'), alunofull: stub('af') });
  app.start();
  onUser({ email: 'x@exemplo.com' });
  return { dom, events, onUser };
}

test('a aba Aluno Full só aparece para o Administrador', async () => {
  for (const [perfil, visible] of [['Administrador', true], ['Gestor', false], ['Financeiro', false], ['Recepcao', false], ['Professor', false], ['Consulta', false]]) {
    const { dom } = appSetup(perfil);
    await flush();
    assert.equal(dom.$('tab-alunofull').hidden, !visible, perfil);
  }
});

test('abrir a aba ativa o Aluno Full; sair apaga e esconde a aba', async () => {
  const { dom, events, onUser } = appSetup('Administrador');
  await flush();
  dom.$('tab-alunofull').listeners.click();
  assert.ok(events.includes('af.activate'));
  assert.equal(dom.$('view-alunofull').hidden, false);
  assert.equal(dom.$('view-dashboard').hidden, true);
  onUser(null);
  assert.ok(events.includes('af.reset'));
  assert.equal(dom.$('tab-alunofull').hidden, true);
});
