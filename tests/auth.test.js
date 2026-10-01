import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, loginErrorMessage, AuthError } from '../js/auth.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ idleMs = 1000 } = {}) {
  let now = 0;
  let tickFn = null;
  let listener = null;
  const events = [];
  const firebase = {
    user: null,
    failWith: null,
    signOutFails: false,
    onChange: (cb) => { listener = cb; },
    signIn: async (email, password) => {
      events.push(['signIn', email, password]);
      if (firebase.failWith) throw Object.assign(new Error('detalhe interno do sdk'), { code: firebase.failWith });
    },
    signOut: async () => {
      events.push(['signOut']);
      if (firebase.signOutFails) throw new Error('falhou');
      firebase.user = null;
      listener(null);
    },
    hasUser: () => firebase.user !== null,
    getIdToken: async (force) => { events.push(['getIdToken', force]); return 'tok'; },
  };
  const auth = createAuth({
    firebase,
    now: () => now,
    setInterval: (fn) => { tickFn = fn; return 7; },
    clearInterval: () => { tickFn = null; },
    idleMs,
    checkEveryMs: 100,
    onIdle: () => events.push(['idle']),
  });
  const users = [];
  auth.start((u) => users.push(u));
  return {
    auth, firebase, events, users,
    emit: (u) => { firebase.user = u; listener(u); },
    advance: (ms) => { now += ms; },
    tick: () => tickFn && tickFn(),
    ticking: () => tickFn !== null,
  };
}

test('mensagens de login: credenciais erradas, usuário inexistente e inválido são idênticos (sem enumeração)', () => {
  const a = loginErrorMessage('auth/wrong-password');
  assert.equal(loginErrorMessage('auth/user-not-found'), a);
  assert.equal(loginErrorMessage('auth/invalid-credential'), a);
  assert.match(a, /incorretos/);
});

test('mensagens de login: outros casos em português e sem código bruto', () => {
  assert.match(loginErrorMessage('auth/too-many-requests'), /Muitas tentativas/);
  assert.match(loginErrorMessage('auth/network-request-failed'), /conexão/);
  assert.match(loginErrorMessage('auth/user-disabled'), /desativada/);
  assert.match(loginErrorMessage('auth/invalid-email'), /e-mail válido/);
  const generic = loginErrorMessage('auth/qualquer-coisa-nova');
  assert.match(generic, /Não foi possível entrar/);
  assert.ok(!/auth\//.test(generic));
  assert.equal(loginErrorMessage(undefined), generic);
});

test('login: usa e-mail sem espaços, repassa a senha e não devolve nada', async () => {
  const { auth, events } = setup();
  assert.equal(await auth.login('  ana@exemplo.com ', 'segredo'), undefined);
  assert.deepEqual(events, [['signIn', 'ana@exemplo.com', 'segredo']]);
});

test('login: campos vazios lançam AuthError sem chamar o Firebase', async () => {
  const { auth, events } = setup();
  for (const [e, p] of [['', 'x'], ['a@b.com', ''], ['  ', '  '], [undefined, undefined]]) {
    await assert.rejects(auth.login(e, p), (err) => err.name === 'AuthError' && /Informe e-mail e senha/.test(err.message));
  }
  assert.equal(events.length, 0);
});

test('login: falha vira AuthError com mensagem segura (nunca o código, o e-mail ou a senha)', async () => {
  const { auth, firebase } = setup();
  firebase.failWith = 'auth/wrong-password';
  await assert.rejects(auth.login('ana@exemplo.com', 'senha-errada'), (err) => {
    assert.equal(err.name, 'AuthError');
    assert.ok(err instanceof AuthError);
    assert.ok(!/ana@|senha-errada|auth\/|sdk/.test(err.message), err.message);
    return true;
  });
});

test('start: repassa mudanças do Firebase como { email } ou null', () => {
  const { users, emit } = setup();
  emit({ email: 'ana@exemplo.com', extra: 'x' });
  emit(null);
  assert.deepEqual(users, [{ email: 'ana@exemplo.com', extra: 'x' }, null]);
});

test('getIdToken: null sem usuário; com usuário repassa o pedido de renovação', async () => {
  const { auth, emit, events } = setup();
  assert.equal(await auth.getIdToken(false), null);
  emit({ email: 'a@b.com' });
  assert.equal(await auth.getIdToken(true), 'tok');
  assert.deepEqual(events.filter((e) => e[0] === 'getIdToken'), [['getIdToken', true]]);
});

test('inatividade: após idleMs sem interação encerra a sessão (aviso antes da saída)', async () => {
  const { events, users, emit, advance, tick, ticking } = setup({ idleMs: 1000 });
  assert.equal(ticking(), false);
  emit({ email: 'a@b.com' });
  assert.equal(ticking(), true);
  advance(999);
  tick();
  await flush();
  assert.equal(events.some((e) => e[0] === 'signOut'), false);
  advance(1);
  tick();
  await flush();
  assert.deepEqual(events.map((e) => e[0]), ['idle', 'signOut']);
  assert.equal(users[users.length - 1], null);
  assert.equal(ticking(), false);
});

test('inatividade: touch() renova o prazo', async () => {
  const { auth, events, emit, advance, tick } = setup({ idleMs: 1000 });
  emit({ email: 'a@b.com' });
  advance(900);
  auth.touch();
  advance(900);
  tick();
  await flush();
  assert.equal(events.some((e) => e[0] === 'signOut'), false);
});

test('inatividade: aba em segundo plano com temporizador congelado — checkIdle() pelo relógio encerra ao voltar', async () => {
  const { auth, events, emit, advance } = setup({ idleMs: 1000 });
  emit({ email: 'a@b.com' });
  advance(60 * 60 * 1000); // uma hora sem nenhum tique do temporizador
  assert.equal(await auth.checkIdle(), true);
  assert.deepEqual(events.map((e) => e[0]), ['idle', 'signOut']);
});

test('inatividade: sem sessão não faz nada; touch sem sessão é inofensivo', async () => {
  const { auth, events, advance } = setup({ idleMs: 1000 });
  advance(10000);
  auth.touch();
  assert.equal(await auth.checkIdle(), false);
  assert.equal(events.length, 0);
});

test('logout para o monitor de inatividade; falha do Firebase no logout não lança', async () => {
  const { auth, firebase, emit, ticking } = setup();
  emit({ email: 'a@b.com' });
  await auth.logout();
  assert.equal(ticking(), false);
  emit({ email: 'a@b.com' });
  firebase.signOutFails = true;
  await auth.logout();
});

test('checkIdle sobrevive a falha ao sair', async () => {
  const { auth, firebase, emit, advance } = setup({ idleMs: 1000 });
  emit({ email: 'a@b.com' });
  firebase.signOutFails = true;
  advance(5000);
  assert.equal(await auth.checkIdle(), true);
});
