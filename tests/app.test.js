import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../js/app.js';
import { createDom, flush } from './helpers/dom-env.js';

const VIEWS = ['view-boot', 'view-login', 'view-session', 'view-app'];
const SESSAO = { ok: true, data: { usuario: { nome: 'Ana Ficticia', perfil: 'Gestor' } }, error: null, correlationId: 'c1' };
const fail = (code, message) => ({ ok: false, data: null, error: { code, message }, correlationId: 'c9' });
const transport = (message) => Object.assign(new Error(message), { name: 'TransportError', kind: 'network' });

function setup({ sessao = [SESSAO], dashboard = [{ ok: true }], loginError = null, logoutFails = false } = {}) {
  const dom = createDom();
  const events = [];
  let onUser = null;
  const queue = { sessao: [...sessao], dashboard: [...dashboard] };
  const next = (q) => { const v = q.length > 1 ? q.shift() : q[0]; if (v instanceof Error) throw v; return v; };

  const auth = {
    loginError,
    start: (cb) => { onUser = cb; },
    login: async (email, password) => {
      events.push(['login', email, password]);
      if (auth.loginError) throw Object.assign(new Error(auth.loginError), { name: 'AuthError' });
    },
    logout: async () => { events.push(['logout']); if (logoutFails) return false; onUser(null); return true; },
    touch: () => events.push(['touch']),
    checkIdle: async () => { events.push(['checkIdle']); return false; },
  };
  const api = { call: async (acao) => { events.push(['api', acao]); return next(queue.sessao); } };
  const dash = { load: async () => { events.push(['dashboard']); return next(queue.dashboard); }, reset: () => events.push(['reset']) };
  const students = { activate: () => events.push(['students.activate']), reset: () => events.push(['students.reset']) };
  const app = createApp({ doc: dom.doc, auth, api, dashboard: dash, students });
  return { dom, events, app, auth, emit: (u) => onUser(u), count: (name) => events.filter((e) => e[0] === name).length };
}

test('sem sessão ao iniciar: mostra o login e nada do sistema', async () => {
  const { dom, app, emit } = setup();
  app.start();
  assert.deepEqual(dom.visible(VIEWS), ['view-boot']);
  emit(null);
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.ok(dom.$('login-email').focused > 0);
});

test('login com sucesso: entra, chama sessao e só então mostra o sistema e carrega o painel', async () => {
  const { dom, app, emit, events } = setup();
  app.start();
  emit(null);
  dom.$('login-email').value = 'ana@exemplo.com';
  dom.$('login-password').value = 'segredo';
  assert.equal(dom.submit('login-form'), true); // preventDefault chamado
  await flush();
  assert.deepEqual(events.find((e) => e[0] === 'login'), ['login', 'ana@exemplo.com', 'segredo']);
  assert.equal(dom.$('login-password').value, '', 'a senha é apagada do campo');
  emit({ email: 'ana@exemplo.com' });
  assert.deepEqual(dom.visible(VIEWS), ['view-session'], 'enquanto sessao não responde, o sistema não aparece');
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-app']);
  assert.equal(dom.$('user-line').textContent, 'Ana Ficticia · Gestor');
  assert.deepEqual(events.filter((e) => e[0] === 'api' || e[0] === 'dashboard').map((e) => e[0]), ['api', 'dashboard']);
});

test('sessão restaurada ao recarregar: sessao é chamada uma única vez mesmo com aviso duplicado', async () => {
  const { dom, app, emit, count } = setup();
  app.start();
  emit({ email: 'ana@exemplo.com' });
  emit({ email: 'ana@exemplo.com' });
  assert.deepEqual(dom.visible(VIEWS), ['view-session']);
  await flush();
  assert.equal(count('api'), 1);
  assert.deepEqual(dom.visible(VIEWS), ['view-app']);
});

test('falha no login: mostra a mensagem, libera o botão, apaga a senha e não chama sessao', async () => {
  const { dom, app, emit, count } = setup({ loginError: 'E-mail ou senha incorretos.' });
  app.start();
  emit(null);
  dom.$('login-email').value = 'ana@exemplo.com';
  dom.$('login-password').value = 'errada';
  dom.submit('login-form');
  await flush();
  assert.equal(dom.$('login-error').hidden, false);
  assert.equal(dom.$('login-error').textContent, 'E-mail ou senha incorretos.');
  assert.equal(dom.$('login-submit').disabled, false);
  assert.equal(dom.$('login-password').value, '');
  assert.equal(dom.$('login-email').value, 'ana@exemplo.com');
  assert.equal(count('api'), 0);
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
});

test('envio duplo do formulário de login é ignorado', async () => {
  const { dom, app, emit, count } = setup();
  app.start();
  emit(null);
  dom.$('login-email').value = 'a@b.com';
  dom.$('login-password').value = 'x';
  dom.submit('login-form');
  dom.submit('login-form');
  await flush();
  assert.equal(count('login'), 1);
});

test('sessao devolve ACESSO_NEGADO: encerra a sessão e volta ao login com aviso', async () => {
  const { dom, app, emit, count } = setup({ sessao: [fail('ACESSO_NEGADO', 'Você não tem acesso.')] });
  app.start();
  emit({ email: 'x@exemplo.com' });
  await flush();
  assert.equal(count('logout'), 1);
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.match(dom.$('login-error').textContent, /não tem acesso ao sistema/);
});

test('sessao devolve NAO_AUTENTICADO: encerra a sessão e pede para entrar de novo', async () => {
  const { dom, app, emit, count } = setup({ sessao: [fail('NAO_AUTENTICADO', 'x')] });
  app.start();
  emit({ email: 'x@exemplo.com' });
  await flush();
  assert.equal(count('logout'), 1);
  assert.match(dom.$('login-error').textContent, /sessão expirou/);
});

test('serviço indisponível ou rede fora do ar: tela de erro com tentar novamente (sem sair)', async () => {
  for (const first of [fail('SERVICO_INDISPONIVEL', 'Serviço temporariamente indisponível.'), transport('Sem rede.')]) {
    const { dom, app, emit, count } = setup({ sessao: [first, SESSAO] });
    app.start();
    emit({ email: 'a@b.com' });
    await flush();
    assert.deepEqual(dom.visible(VIEWS), ['view-session']);
    assert.equal(dom.$('session-error-box').hidden, false);
    assert.equal(dom.$('session-loading').hidden, true);
    assert.ok(dom.$('session-error-msg').textContent.length > 0);
    assert.equal(count('logout'), 0);
    dom.click('session-retry');
    await flush();
    assert.deepEqual(dom.visible(VIEWS), ['view-app']);
    assert.equal(count('api'), 2);
  }
});

test('erro genérico do servidor mostra a referência', async () => {
  const { dom, app, emit } = setup({ sessao: [fail('ERRO_INTERNO', 'Ocorreu um erro inesperado.')] });
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  assert.equal(dom.$('session-error-msg').textContent, 'Ocorreu um erro inesperado.');
  assert.equal(dom.$('session-error-ref').textContent, 'Código de referência: c9');
});

test('painel devolve NAO_AUTENTICADO ou ACESSO_NEGADO: encerra a sessão', async () => {
  for (const code of ['NAO_AUTENTICADO', 'ACESSO_NEGADO']) {
    const { dom, app, emit, count } = setup({ dashboard: [{ ok: false, code }] });
    app.start();
    emit({ email: 'a@b.com' });
    await flush();
    assert.equal(count('logout'), 1, code);
    assert.deepEqual(dom.visible(VIEWS), ['view-login'], code);
  }
});

test('Sair: encerra a sessão e mostra o login limpo', async () => {
  const { dom, app, emit, count } = setup();
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  dom.click('logout');
  await flush();
  assert.equal(count('logout'), 1);
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.equal(dom.$('login-error').hidden, true);
});

test('Sair da tela de erro de sessão também encerra', async () => {
  const { dom, app, emit, count } = setup({ sessao: [fail('SERVICO_INDISPONIVEL', 'x')] });
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  dom.click('session-logout');
  await flush();
  assert.equal(count('logout'), 1);
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
});

test('inatividade: onIdle define o aviso exibido no login depois da saída', async () => {
  const { dom, app, emit } = setup();
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  app.onIdle();
  emit(null);
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.match(dom.$('login-error').textContent, /inatividade/);
});

test('resposta atrasada de uma sessão que já terminou não reabre o sistema', async () => {
  const dom = createDom();
  let onUser = null;
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const auth = {
    start: (cb) => { onUser = cb; },
    login: async () => {},
    logout: async () => { onUser(null); return true; },
    touch() {},
    checkIdle: async () => false,
  };
  const api = { call: async () => { await slow; return SESSAO; } };
  const app = createApp({ doc: dom.doc, auth, api, dashboard: { load: async () => ({ ok: true }), reset() {} }, students: { activate() {}, reset() {} } });
  app.start();
  onUser({ email: 'a@b.com' });
  onUser(null);
  release();
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
});

test('qualquer interação renova a atividade; voltar à aba confere a inatividade pelo relógio', async () => {
  const { dom, app, count } = setup();
  app.start();
  ['keydown', 'pointerdown', 'touchstart', 'scroll'].forEach((ev) => dom.docEvent(ev));
  assert.equal(count('touch'), 4);
  dom.doc.hidden = true;
  dom.docEvent('visibilitychange');
  assert.equal(count('checkIdle'), 0, 'com a aba oculta não confere');
  dom.doc.hidden = false;
  dom.docEvent('visibilitychange');
  assert.equal(count('checkIdle'), 1);
});

test('envelope sem os campos esperados não deixa a tela presa: erro recuperável com tentar novamente', async () => {
  const incompleto = { ok: true, data: {}, error: null, correlationId: 'c3' };
  const { dom, app, emit, count } = setup({ sessao: [incompleto, SESSAO] });
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-session']);
  assert.equal(dom.$('session-error-box').hidden, false);
  assert.equal(dom.$('session-loading').hidden, true);
  dom.click('session-retry');
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-app']);
  assert.equal(count('api'), 2);
});

test('voltar ao login limpa o painel e o nome do usuário (nada do usuário anterior fica no DOM)', async () => {
  for (const how of ['sair', 'negado']) {
    const sessao = how === 'negado' ? [SESSAO] : [SESSAO];
    const { dom, app, emit, count } = setup({ sessao, dashboard: how === 'negado' ? [{ ok: false, code: 'ACESSO_NEGADO' }] : [{ ok: true }] });
    app.start();
    emit({ email: 'a@b.com' });
    await flush();
    if (how === 'sair') { dom.click('logout'); await flush(); }
    assert.deepEqual(dom.visible(VIEWS), ['view-login'], how);
    assert.equal(dom.$('user-line').textContent, '', how);
    assert.ok(count('reset') >= 1, how);
  }
});

test('falha ao encerrar a sessão: o login aparece (dados escondidos) com aviso de que não saiu com segurança', async () => {
  const { dom, app, emit, count } = setup({ logoutFails: true });
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  dom.click('logout');
  await flush();
  assert.equal(count('logout'), 1);
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.match(dom.$('login-error').textContent, /não foi possível encerrar a sessão com segurança/i);
  assert.equal(dom.$('user-line').textContent, '');
});

test('acesso negado com falha ao sair: mantém o aviso do motivo e acrescenta o de segurança', async () => {
  const { dom, app, emit } = setup({ sessao: [fail('ACESSO_NEGADO', 'x')], logoutFails: true });
  app.start();
  emit({ email: 'x@exemplo.com' });
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.match(dom.$('login-error').textContent, /não tem acesso ao sistema/);
  assert.match(dom.$('login-error').textContent, /encerrar a sessão com segurança/i);
});

test('saída por inatividade que falhou: o login aparece com o aviso de segurança', async () => {
  const { dom, app, emit } = setup();
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  app.onIdle();
  app.onSignOutFailed();
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.match(dom.$('login-error').textContent, /encerrar a sessão com segurança/i);
});

test('abas: Alunos mostra a seção e carrega a lista uma vez por chamada; Início volta ao painel', async () => {
  const { dom, app, emit, count } = setup();
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  assert.equal(dom.$('view-students').hidden, true);
  dom.click('tab-students');
  assert.equal(dom.$('view-students').hidden, false);
  assert.equal(dom.$('view-dashboard').hidden, true);
  assert.equal(dom.$('tab-students').getAttribute('aria-current'), 'page');
  assert.equal(dom.$('tab-dashboard').getAttribute('aria-current'), null);
  assert.equal(count('students.activate'), 1);
  dom.click('tab-dashboard');
  assert.equal(dom.$('view-dashboard').hidden, false);
  assert.equal(dom.$('view-students').hidden, true);
  assert.equal(dom.$('tab-dashboard').getAttribute('aria-current'), 'page');
});

test('voltar ao login zera os Alunos e volta à aba Início (nada do usuário anterior)', async () => {
  const { dom, app, emit, count } = setup();
  app.start();
  emit({ email: 'a@b.com' });
  await flush();
  dom.click('tab-students');
  dom.click('logout');
  await flush();
  assert.ok(count('students.reset') >= 1);
  assert.equal(dom.$('view-students').hidden, true);
  assert.equal(dom.$('view-dashboard').hidden, false);
  assert.equal(dom.$('tab-dashboard').getAttribute('aria-current'), 'page');
});

test('onAuthFailure dos Alunos encerra a sessão com a mensagem certa; sem sessão não faz nada', async () => {
  const { dom, app, emit, count } = setup();
  app.start();
  app.onAuthFailure('NAO_AUTENTICADO'); // sem sessão: ignorado
  assert.equal(count('logout'), 0);
  emit({ email: 'a@b.com' });
  await flush();
  app.onAuthFailure('ACESSO_NEGADO');
  await flush();
  assert.deepEqual(dom.visible(VIEWS), ['view-login']);
  assert.match(dom.$('login-error').textContent, /não tem acesso/i);
});

// ---------- menu lateral (recolhível no celular) ----------
async function signedIn() {
  const s = setup();
  s.app.start();
  s.emit({ email: 'ana@exemplo.com' });
  await flush();
  return s;
}
const pressKey = (dom, key) => (dom.docListeners.keydown || []).forEach((fn) => fn({ key }));

test('menu lateral: começa fechado; o botão abre, marca aria-expanded e mostra o fundo que fecha ao clicar', async () => {
  const { dom } = await signedIn();
  assert.equal(dom.$('sidebar').getAttribute('data-open'), 'false');
  assert.equal(dom.$('nav-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.$('sidebar-backdrop').hidden, true);
  dom.click('nav-toggle');
  assert.equal(dom.$('sidebar').getAttribute('data-open'), 'true');
  assert.equal(dom.$('nav-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(dom.$('sidebar-backdrop').hidden, false);
  assert.ok(dom.$('tab-dashboard').focused > 0, 'o foco vai para o menu');
  dom.click('sidebar-backdrop');
  assert.equal(dom.$('sidebar').getAttribute('data-open'), 'false');
  assert.equal(dom.$('sidebar-backdrop').hidden, true);
});

test('menu lateral: escolher uma seção fecha o menu; o botão alterna; Escape fecha e devolve o foco ao botão', async () => {
  const { dom } = await signedIn();
  dom.click('nav-toggle');
  dom.click('tab-students');
  assert.equal(dom.$('sidebar').getAttribute('data-open'), 'false');
  dom.click('nav-toggle');
  dom.click('nav-toggle');
  assert.equal(dom.$('sidebar').getAttribute('data-open'), 'false', 'segundo clique fecha');
  dom.click('nav-toggle');
  const before = dom.$('nav-toggle').focused;
  pressKey(dom, 'Escape');
  assert.equal(dom.$('sidebar').getAttribute('data-open'), 'false');
  assert.equal(dom.$('nav-toggle').focused, before + 1);
});

test('menu lateral: ao sair da conta o menu volta fechado', async () => {
  const { dom, emit } = await signedIn();
  dom.click('nav-toggle');
  emit(null);
  assert.equal(dom.$('sidebar').getAttribute('data-open'), 'false');
  assert.equal(dom.$('sidebar-backdrop').hidden, true);
});
