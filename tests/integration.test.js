import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../js/api.js';
import { createAuth } from '../js/auth.js';
import { createDashboard } from '../js/dashboard.js';
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
    idleMs: 1000, checkEveryMs: 100, onIdle: () => app.onIdle(),
  });
  class FakeAbort { constructor() { this.signal = { aborted: false, addEventListener() {} }; } abort() { this.signal.aborted = true; } }
  const api = createApi({
    apiUrl: 'https://exemplo.test/exec', timeoutMs: 30000, AbortController: FakeAbort,
    setTimeout: () => 1, clearTimeout: () => {}, getIdToken: (force) => auth.getIdToken(force),
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return { text: async () => JSON.stringify(server(body, requests.length)) };
    },
  });
  const dashboard = createDashboard({ doc: dom.doc, api });
  app = createApp({ doc: dom.doc, auth, api, dashboard });
  return { dom, requests, tokenCalls, firebase, app, advance: (ms) => { now += ms; }, tick: () => tick && tick() };
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
