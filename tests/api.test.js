import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi, TransportError, TRANSPORT_MESSAGES } from '../js/api.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/contract/${name}.json`, import.meta.url), 'utf8'));
const ok = (data) => ({ ok: true, data, error: null, correlationId: 'c1' });
const err = (code) => ({ ok: false, data: null, error: { code, message: code }, correlationId: 'c2' });

class FakeAbort {
  constructor() {
    this.signal = { aborted: false, listeners: [], addEventListener(ev, fn) { this.listeners.push(fn); } };
  }
  abort() { this.signal.aborted = true; this.signal.listeners.forEach((fn) => fn()); }
}

function setup({ responses = [], tokens = ['tok-1'], getIdToken } = {}) {
  const requests = [];
  const tokenCalls = [];
  let timerFn = null;
  let t = 0;
  let r = 0;
  const deps = {
    apiUrl: 'https://exemplo.test/exec',
    timeoutMs: 30000,
    AbortController: FakeAbort,
    setTimeout: (fn) => { timerFn = fn; return 1; },
    clearTimeout: () => { timerFn = null; },
    getIdToken: getIdToken || (async (force) => { tokenCalls.push(force); return tokens[Math.min(t++, tokens.length - 1)]; }),
    fetch: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      const next = responses[Math.min(r++, responses.length - 1)];
      if (typeof next === 'function') return next(init);
      return { text: async () => (typeof next === 'string' ? next : JSON.stringify(next)) };
    },
  };
  return { api: createApi(deps), requests, tokenCalls, fire: () => timerFn && timerFn() };
}

test('envia POST text/plain com acao, token e args; o token não vai na URL nem nos cabeçalhos', async () => {
  const { api, requests } = setup({ responses: [ok({ a: 1 })] });
  const resp = await api.call('alunos.listar', [{ busca: 'ana' }]);
  assert.deepEqual(resp, ok({ a: 1 }));
  assert.equal(requests.length, 1);
  const { url, init, body } = requests[0];
  assert.equal(url, 'https://exemplo.test/exec');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(Object.keys(body).sort(), ['acao', 'args', 'token']);
  assert.deepEqual(body, { acao: 'alunos.listar', token: 'tok-1', args: [{ busca: 'ana' }] });
  assert.ok(!url.includes('tok-1') && !JSON.stringify(init.headers).includes('tok-1'));
});

test('args padrão é lista vazia', async () => {
  const { api, requests } = setup({ responses: [ok(null)] });
  await api.call('sessao');
  assert.deepEqual(requests[0].body.args, []);
});

test('erro do servidor volta no envelope e não lança', async () => {
  const { api } = setup({ responses: [err('ACESSO_NEGADO')] });
  const resp = await api.call('sessao');
  assert.equal(resp.ok, false);
  assert.equal(resp.error.code, 'ACESSO_NEGADO');
});

test('NAO_AUTENTICADO renova o token uma vez e repete com o token novo', async () => {
  const { api, requests, tokenCalls } = setup({ responses: [err('NAO_AUTENTICADO'), ok({ fim: true })], tokens: ['velho', 'novo'] });
  const resp = await api.call('sessao');
  assert.equal(resp.ok, true);
  assert.deepEqual(tokenCalls, [false, true]);
  assert.deepEqual(requests.map((q) => q.body.token), ['velho', 'novo']);
});

test('NAO_AUTENTICADO persistente: só uma repetição, sem laço', async () => {
  const { api, requests } = setup({ responses: [err('NAO_AUTENTICADO')], tokens: ['a', 'b'] });
  const resp = await api.call('sessao');
  assert.equal(resp.error.code, 'NAO_AUTENTICADO');
  assert.equal(requests.length, 2);
});

test('sem token não há chamada de rede: devolve NAO_AUTENTICADO sintético', async () => {
  const { api, requests } = setup({ responses: [ok({})], tokens: [null] });
  const resp = await api.call('sessao');
  assert.equal(requests.length, 0);
  assert.equal(resp.ok, false);
  assert.equal(resp.error.code, 'NAO_AUTENTICADO');
});

test('se a renovação não devolve token, não repete a chamada', async () => {
  const { api, requests } = setup({ responses: [err('NAO_AUTENTICADO')], tokens: ['a', null] });
  const resp = await api.call('sessao');
  assert.equal(requests.length, 1);
  assert.equal(resp.error.code, 'NAO_AUTENTICADO');
});

test('tempo limite: aborta e lança TransportError(timeout) com mensagem amigável', async () => {
  const hang = (init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('abortado'))); });
  const { api, fire } = setup({ responses: [hang] });
  const pending = api.call('sessao');
  await tick();
  fire();
  await assert.rejects(pending, (e) => e.name === 'TransportError' && e.kind === 'timeout' && e.message === TRANSPORT_MESSAGES.timeout);
});

test('rede fora do ar: TransportError(network)', async () => {
  const { api } = setup({ responses: [() => { throw new Error('sem rede'); }] });
  await assert.rejects(api.call('sessao'), (e) => e.name === 'TransportError' && e.kind === 'network');
});

test('falha ao ler o corpo da resposta: TransportError(network)', async () => {
  const { api } = setup({ responses: [() => ({ text: async () => { throw new Error('corpo quebrado'); } })] });
  await assert.rejects(api.call('sessao'), (e) => e.kind === 'network');
});

test('resposta que não é JSON ou não é envelope: TransportError(invalid-response)', async () => {
  for (const bad of ['<!DOCTYPE html><html>página de erro do Google</html>', '{"a":1}', '[]', 'null', '"texto"', '']) {
    const { api } = setup({ responses: [bad] });
    await assert.rejects(api.call('sessao'), (e) => e.kind === 'invalid-response', JSON.stringify(bad));
  }
});

test('falha ao obter o token (SDK): TransportError(network)', async () => {
  const { api } = setup({ getIdToken: async () => { throw new Error('sdk'); } });
  await assert.rejects(api.call('sessao'), (e) => e.kind === 'network');
});

test('TransportError tem nome, tipo e mensagem em português', () => {
  const e = new TransportError('timeout');
  assert.equal(e.name, 'TransportError');
  assert.equal(e.kind, 'timeout');
  assert.match(e.message, /demorou/);
  assert.ok(e instanceof Error);
});

test('contrato: as fixtures do servidor passam pelo cliente sem alteração', async () => {
  for (const name of ['sessao-ok', 'nao-autenticado']) {
    const f = fixture(name);
    const { api, requests } = setup({ responses: [f.response], tokens: ['t1', 't2'] });
    const resp = await api.call(f.request.acao, f.request.args);
    assert.deepEqual(resp, f.response, name);
    assert.deepEqual(Object.keys(requests[0].body).sort(), Object.keys(f.request).sort(), name);
  }
});
