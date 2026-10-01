import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../js/api.js';
import { createAuth } from '../js/auth.js';
import { createDashboard } from '../js/dashboard.js';
import { createStudents } from '../js/students.js';
import { createStudentForm } from '../js/student-form.js';
import { createApp } from '../js/app.js';
import { createDom, flush } from './helpers/dom-env.js';

const VIEWS = ['view-boot', 'view-login', 'view-session', 'view-app'];
const DASH = {
  escola: 'Gracie Barra Itu', ambiente: 'development', usuario: { nome: 'Ana Ficticia', perfil: 'Gestor' },
  alunosPorStatus: [{ status: 'Ativo', total: 2 }], totalAlunos: 2, atualizadoEm: '2026-09-30T21:10:32.000Z',
  presenca: { fonte: 'physical_card', aviso: 'Presença por cartões físicos.' },
};
const envelope = (data) => ({ ok: true, data, error: null, correlationId: 'c' });
const denied = (code) => ({ ok: false, data: null, error: { code, message: code }, correlationId: 'c' });

function build({ server, existingUser = null, tokens = ['tok-1'] } = {}) {
  const dom = createDom();
  const requests = [];
  const tokenCalls = [];
  let t = 0;
  let listener = null;
  let now = 0;
  let tick = null;

  const firebase = {
    user: existingUser,
    // como o SDK real: o estado inicial (usuário restaurado ou nulo) chega logo depois do registro
    onChange: (cb) => { listener = cb; Promise.resolve().then(() => cb(firebase.user)); },
    signIn: async (email) => { firebase.user = { email }; listener(firebase.user); },
    signOut: async () => { firebase.user = null; listener(null); },
    hasUser: () => firebase.user !== null,
    getIdToken: async (force) => { tokenCalls.push(force); return tokens[Math.min(t++, tokens.length - 1)]; },
  };
  let app = null;
  const auth = createAuth({
    firebase, now: () => now, setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; },
    idleMs: 1000, checkEveryMs: 100, onIdle: () => app.onIdle(), onSignOutFailed: () => app.onSignOutFailed(),
  });
  class FakeAbort { constructor() { this.signal = { aborted: false, addEventListener() {} }; } abort() { this.signal.aborted = true; } }
  const api = createApi({
    apiUrl: 'https://exemplo.test/exec', timeoutMs: 30000, AbortController: FakeAbort,
    setTimeout: () => 1, clearTimeout: () => {}, getIdToken: (force) => auth.getIdToken(force),
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return { text: async () => JSON.stringify(await server(body, requests.length)) };
    },
  });
  const dashboard = createDashboard({ doc: dom.doc, api });
  const students = createStudents({ doc: dom.doc, api, createForm: createStudentForm, onAuthFailure: (code) => app.onAuthFailure(code) });
  app = createApp({ doc: dom.doc, auth, api, dashboard, students });
  return { dom, requests, tokenCalls, firebase, app, students, advance: (ms) => { now += ms; }, tick: () => tick && tick() };
}

const okServer = (body) => envelope(body.acao === 'sessao' ? { usuario: { nome: 'Ana Ficticia', perfil: 'Gestor' } } : DASH);

test('login de ponta a ponta: sessao e dashboard.obter com o token, sistema visível, Sair volta ao login', async () => {
  const { dom, requests, app } = build({ server: okServer });
  app.start();
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  dom.$('login-email').value = 'ana@exemplo.com';
  dom.$('login-password').value = 'segredo';
  dom.submit('login-form');
  await flush();
  await flush();
  assert.deepEqual(requests.map((r) => r.acao), ['sessao', 'dashboard.obter']);
  assert.ok(requests.every((r) => r.token === 'tok-1'));
  assert.deepEqual(dom.visible(VIEWS), ['view-app']);
  assert.equal(dom.$('user-line').textContent, 'Ana Ficticia · Gestor');
  assert.equal(dom.$('total').textContent, '2');
  dom.click('logout');
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
});

test('recarregar com sessão ativa: entra direto, sem formulário, com uma chamada de sessao', async () => {
  const { dom, requests, app } = build({ server: okServer, existingUser: { email: 'ana@exemplo.com' } });
  app.start();
  await flush();
  await flush();
  assert.deepEqual(requests.map((r) => r.acao), ['sessao', 'dashboard.obter']);
  assert.deepEqual(dom.visible(VIEWS), ['view-app']);
});

test('servidor nega o acesso: desconecta do Firebase e mostra o aviso no login', async () => {
  const { dom, firebase, app } = build({ server: () => denied('ACESSO_NEGADO'), existingUser: { email: 'x@exemplo.com' } });
  app.start();
  await flush();
  await flush();
  assert.equal(firebase.user, null);
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.match(dom.$('login-error').textContent, /não tem acesso ao sistema/);
});

test('token vencido: renova uma vez e a chamada seguinte funciona', async () => {
  let n = 0;
  const server = (body) => (n++ === 0 ? denied('NAO_AUTENTICADO') : okServer(body));
  const { dom, requests, tokenCalls, app } = build({ server, existingUser: { email: 'a@b.com' }, tokens: ['velho', 'novo'] });
  app.start();
  await flush();
  await flush();
  assert.deepEqual(requests.slice(0, 2).map((r) => r.token), ['velho', 'novo']);
  assert.deepEqual(tokenCalls.slice(0, 2), [false, true]);
  assert.deepEqual(dom.visible(VIEWS), ['view-app']);
});

test('inatividade de ponta a ponta: passado o prazo, o monitor encerra e o login mostra o aviso', async () => {
  const { dom, app, advance, tick } = build({ server: okServer, existingUser: { email: 'a@b.com' } });
  app.start();
  await flush();
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-app']);
  advance(1500);
  tick();
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.match(dom.$('login-error').textContent, /inatividade/);
});

test('troca de usuário com painel pendente: a resposta atrasada do usuário anterior não sobrescreve a do novo', async () => {
  let release;
  const slowA = new Promise((resolve) => { release = resolve; });
  let dashboards = 0;
  const server = (body) => {
    if (body.acao === 'sessao') return envelope({ usuario: { nome: 'Ana Ficticia', perfil: 'Gestor' } });
    dashboards += 1;
    return dashboards === 1 ? slowA : envelope({ ...DASH, totalAlunos: 7 });
  };
  const { dom, app } = build({ server, existingUser: { email: 'a@exemplo.com' } });
  app.start();
  await flush();
  await flush();
  dom.click('logout');
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  dom.$('login-email').value = 'b@exemplo.com';
  dom.$('login-password').value = 'segredo';
  dom.submit('login-form');
  await flush();
  await flush();
  assert.equal(dom.$('total').textContent, '7');
  release(envelope({ ...DASH, totalAlunos: 1, escola: 'Escola do usuário A' }));
  await flush();
  assert.equal(dom.$('total').textContent, '7');
  assert.notEqual(dom.$('school').textContent, 'Escola do usuário A');
});

test('integração: A abre Alunos e digita CPF; sai; B entra e não vê nada de A, nem a lista tardia', async () => {
  let who = 'A';
  let releaseListaA;
  const gateA = new Promise((resolve) => { releaseListaA = resolve; });
  const perm = { criar: true, editarSensivel: true, confirmarDuplicidade: true };
  const opcoes = { statusCriacao: ['Ativo'], faixas: { adulto: ['Branca'], infantil: ['Branca'] } };
  const lista = (nome) => ({
    itens: [{ student_id: 'ALU-1', nome_completo: nome, nome_social: '', status: 'Ativo', faixa: 'Branca', idade: 30 }],
    total: 1, totalGeral: 1, porStatus: [], statusDisponiveis: ['Ativo'], permissoes: perm, opcoes,
  });
  const server = async (body) => {
    if (body.acao === 'sessao') return envelope({ usuario: { nome: who === 'A' ? 'Ana Ficticia' : 'Bruno Ficticio', perfil: 'Gestor' } });
    if (body.acao === 'alunos.listar') { await gateA; return envelope(lista('Aluno do A Ficticio')); }
    return envelope(DASH);
  };
  const { dom, app } = build({ server, tokens: ['tok-a', 'tok-b'] });
  const login = async (email) => {
    dom.$('login-email').value = email;
    dom.$('login-password').value = 'segredo';
    dom.submit('login-form');
    await flush();
    await flush();
  };
  app.start();
  await flush();
  await login('ana@exemplo.com');
  dom.click('tab-students'); // a lista de A fica pendente
  await flush();
  dom.$('f-cpf').value = '111.444.777-35'; // valor digitado por A no formulário
  dom.click('logout');
  await flush();
  who = 'B';
  await login('bruno@exemplo.com');
  releaseListaA(); // a resposta de A chega depois da troca
  await flush();
  await flush();
  assert.equal(dom.$('students-list').children.length, 0);
  assert.equal(dom.$('f-cpf').value, '');
  assert.equal(dom.$('user-line').textContent, 'Bruno Ficticio · Gestor');
  assert.equal(dom.$('view-students').hidden, true);
  assert.deepEqual(dom.visible(VIEWS), ['view-app']);
});
