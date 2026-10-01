import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboard } from '../js/dashboard.js';
import { createDom, flush } from './helpers/dom-env.js';

const DATA = {
  escola: 'Gracie Barra Itu',
  ambiente: 'development',
  usuario: { nome: 'Ana', perfil: 'Gestor' },
  alunosPorStatus: [{ status: 'Ativo', total: 2 }, { status: 'Inativo', total: 1 }],
  totalAlunos: 3,
  atualizadoEm: '2026-09-30T21:10:32.000Z',
  atualizadoEmLocal: '30/09/2026 18:10:32',
  presenca: { fonte: 'physical_card', aviso: 'A presença continua sendo controlada pelos cartões físicos. O check-in online não está ativo.' },
};
const ok = (data) => ({ ok: true, data, error: null, correlationId: 'c1' });
const fail = (code, message) => ({ ok: false, data: null, error: { code, message }, correlationId: 'c2' });
const PARTS = ['dash-loading', 'dash-error', 'dash-ready'];

function setup(respond) {
  const dom = createDom();
  const calls = [];
  const seen = [];
  const api = {
    call: async (acao, args) => {
      calls.push({ acao, args });
      seen.push(dom.visible(PARTS));
      return respond(calls.length);
    },
  };
  return { dom, calls, seen, dashboard: createDashboard({ doc: dom.doc, api }) };
}

test('carrega o painel: chama dashboard.obter e mostra escola, total, status e aviso de presença', async () => {
  const { dom, calls, seen, dashboard } = setup(() => ok(DATA));
  const result = await dashboard.load();
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ acao: 'dashboard.obter', args: [] }]);
  assert.deepEqual(seen[0], ['dash-loading']);
  assert.deepEqual(dom.visible(PARTS), ['dash-ready']);
  assert.equal(dom.$('school').textContent, 'Gracie Barra Itu');
  assert.equal(dom.$('total').textContent, '3');
  assert.equal(dom.$('empty').hidden, true);
  const items = dom.$('status-list').children;
  assert.equal(items.length, 2);
  assert.equal(items[0].children[0].textContent, 'Ativo');
  assert.equal(items[0].children[1].textContent, '2');
  assert.equal(dom.$('attendance-notice').textContent, DATA.presenca.aviso);
  assert.equal(dom.$('updated').textContent, 'Atualizado em 30/09/2026, 18:10:32');
});

test('ambiente: faixa de aviso fora de produção; em produção fica oculta', async () => {
  const dev = setup(() => ok(DATA));
  await dev.dashboard.load();
  assert.equal(dev.dom.$('env').hidden, false);
  assert.equal(dev.dom.$('env').textContent, 'development');
  const prod = setup(() => ok({ ...DATA, ambiente: 'production' }));
  await prod.dashboard.load();
  assert.equal(prod.dom.$('env').hidden, true);
});

test('sem alunos: mostra o estado vazio', async () => {
  const { dom, dashboard } = setup(() => ok({ ...DATA, totalAlunos: 0, alunosPorStatus: [] }));
  await dashboard.load();
  assert.equal(dom.$('empty').hidden, false);
  assert.equal(dom.$('status-list').children.length, 0);
});

test('texto do servidor com HTML ou script aparece literalmente (nunca interpretado)', async () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const { dom, dashboard } = setup(() => ok({ ...DATA, escola: evil, alunosPorStatus: [{ status: evil, total: 1 }], totalAlunos: 1, presenca: { aviso: evil } }));
  await dashboard.load();
  assert.equal(dom.$('school').textContent, evil);
  assert.equal(dom.$('status-list').children[0].children[0].textContent, evil);
  assert.equal(dom.$('attendance-notice').textContent, evil);
});

test('erro do servidor: mostra mensagem e referência e devolve o código', async () => {
  const { dom, dashboard } = setup(() => fail('ERRO_INTERNO', 'Ocorreu um erro inesperado.'));
  const result = await dashboard.load();
  assert.deepEqual(result, { ok: false, code: 'ERRO_INTERNO' });
  assert.deepEqual(dom.visible(PARTS), ['dash-error']);
  assert.equal(dom.$('dash-error-msg').textContent, 'Ocorreu um erro inesperado.');
  assert.equal(dom.$('dash-error-ref').textContent, 'Código de referência: c2');
  assert.ok(dom.$('dash-retry').focused > 0);
});

test('falha de transporte: mostra a mensagem amigável e devolve TRANSPORT', async () => {
  const { dom, dashboard } = setup(() => { throw Object.assign(new Error('O servidor demorou para responder.'), { name: 'TransportError', kind: 'timeout' }); });
  const result = await dashboard.load();
  assert.deepEqual(result, { ok: false, code: 'TRANSPORT' });
  assert.equal(dom.$('dash-error-msg').textContent, 'O servidor demorou para responder.');
  assert.equal(dom.$('dash-error-ref').textContent, '');
});

test('erro inesperado no código: mensagem genérica, sem vazar detalhes', async () => {
  const { dom, dashboard } = setup(() => { throw new Error('detalhe interno secreto'); });
  const result = await dashboard.load();
  assert.equal(result.ok, false);
  assert.ok(!dom.$('dash-error-msg').textContent.includes('secreto'));
});

test('tentar novamente e atualizar recarregam o painel', async () => {
  const { dom, calls, dashboard } = setup((n) => (n === 1 ? fail('ERRO_INTERNO', 'x') : ok(DATA)));
  await dashboard.load();
  dom.click('dash-retry');
  await flush();
  assert.equal(calls.length, 2);
  assert.deepEqual(dom.visible(PARTS), ['dash-ready']);
  dom.click('dash-refresh');
  await flush();
  assert.equal(calls.length, 3);
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('reset invalida o carregamento em andamento: resposta atrasada de outra sessão não aparece', async () => {
  const dom = createDom();
  const slow = deferred();
  const dashboard = createDashboard({ doc: dom.doc, api: { call: () => slow.promise } });
  const pending = dashboard.load();
  dashboard.reset();
  slow.resolve(ok({ ...DATA, escola: 'Escola do usuário A', totalAlunos: 9 }));
  const result = await pending;
  assert.deepEqual(result, { ok: false, code: 'STALE' });
  assert.equal(dom.$('school').textContent, 'Sistema Interno');
  assert.equal(dom.$('total').textContent, '0');
  assert.deepEqual(dom.visible(PARTS), ['dash-loading']);
});

test('reset apaga o conteúdo já exibido (nada do usuário anterior fica no DOM)', async () => {
  const { dom, dashboard } = setup(() => ok(DATA));
  await dashboard.load();
  assert.equal(dom.$('total').textContent, '3');
  dashboard.reset();
  assert.equal(dom.$('school').textContent, 'Sistema Interno');
  assert.equal(dom.$('total').textContent, '0');
  assert.equal(dom.$('status-list').children.length, 0);
  assert.equal(dom.$('attendance-notice').textContent, '');
  assert.equal(dom.$('updated').textContent, '');
  assert.equal(dom.$('env').hidden, true);
  assert.equal(dom.$('dash-error-msg').textContent, '');
  assert.deepEqual(dom.visible(PARTS), ['dash-loading']);
});

test('duas atualizações sobrepostas: só a mais recente é exibida', async () => {
  const dom = createDom();
  const first = deferred();
  const second = deferred();
  const queue = [first, second];
  const dashboard = createDashboard({ doc: dom.doc, api: { call: () => queue.shift().promise } });
  const a = dashboard.load();
  const b = dashboard.load();
  second.resolve(ok({ ...DATA, totalAlunos: 7 }));
  await b;
  first.resolve(ok({ ...DATA, totalAlunos: 1 }));
  const staleResult = await a;
  assert.deepEqual(staleResult, { ok: false, code: 'STALE' });
  assert.equal(dom.$('total').textContent, '7');
});
