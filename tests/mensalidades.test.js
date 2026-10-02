import test from 'node:test';
import assert from 'node:assert/strict';
import { createMensalidades, money, dateBR, monthLabel } from '../js/mensalidades.js';
import { createDataTable } from '../js/data-table.js';
import { createApp } from '../js/app.js';
import { createDom, flush } from './helpers/dom-env.js';

const PARTS = ['mens-loading', 'mens-error', 'mens-empty', 'mens-ready'];
const flat = (t) => String(t).replace(/\s/g, ' ');
const ok = (data) => ({ ok: true, data, error: null, correlationId: 'c1' });
const fail = (code, message, fields) => ({ ok: false, data: null, error: fields ? { code, message, fields } : { code, message }, correlationId: 'c2' });

const ACOES_TODAS = { registrar: true, editarVencimento: true, cancelar: true, estornar: false };
const item = (over = {}) => ({
  charge_id: 'COB-1', student_id: 'ALU-1', nome: 'Ana Ficticia', competencia: '2026-09', vencimento: '2026-09-10', vencida: true, valor: 250,
  status: 'Pendente', versao: 'v1', pagamento: null, acoes: ACOES_TODAS, ...over,
});
const LIST = (itens = [item()], over = {}) => ({
  competencia: '2026-09', competenciaAnterior: '2026-08', itens, total: itens.length, totais: { cobrancas: itens.length, previsto: 550, pago: 200, pendente: 250, vencido: 250 },
  totaisAnterior: { cobrancas: 3, previsto: 500, pago: 400, pendente: 200, vencido: 0 },
  porStatus: { Pendente: 1 }, permissoes: { registrar: true, cancelar: true, gerar: true },
  opcoes: { formas: ['PIX', 'Débito', 'Crédito', 'Dinheiro', 'Misto'], contas: ['PF', 'PJ'], status: ['Paga', 'Pendente', 'Coberta por pacote', 'Isenta', 'Suspensa', 'Cancelada'] },
  hoje: '2026-09-30', ...over,
});

function setup(respond = () => ok(LIST())) {
  const dom = createDom();
  const calls = [];
  const auth = [];
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(acao, args, calls.length); } };
  const mens = createMensalidades({ doc: dom.doc, api, onAuthFailure: (c) => auth.push(c) });
  const rows = () => dom.$('mens-list').children;
  const buttons = (i = 0) => rows()[i].children[0].children[3].children;
  const press = (key) => (dom.docListeners.keydown || []).forEach((fn) => fn({ key }));
  return { dom, calls, auth, mens, rows, buttons, press };
}
const labels = (nodes) => nodes.map((b) => b.textContent);

test('formatadores: moeda pt-BR e data dd/mm/aaaa', () => {
  assert.equal(flat(money(1234.5)), 'R$ 1.234,50');
  assert.equal(money(null), '—');
  assert.equal(dateBR('2026-09-10'), '10/09/2026');
  assert.equal(dateBR(''), '');
});

test('activate carrega a lista uma única vez, com a competência e os filtros', async () => {
  const { dom, calls, mens } = setup();
  mens.activate();
  mens.activate();
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { acao: 'mensalidades.listar', args: [{ competencia: '', busca: '', status: '' }] });
  assert.deepEqual(dom.visible(PARTS), ['mens-ready']);
  assert.equal(dom.$('mens-comp').value, '2026-09');
  assert.equal(dom.$('mens-count').textContent, '1 cobranças');
});

test('linha: nome, vencimento, valor, status, "Vencida" e só os botões que o servidor permite', async () => {
  const { dom, rows, buttons, mens } = setup();
  mens.activate();
  await flush();
  const row = rows()[0].children[0];
  assert.equal(row.children[0].children[0].textContent, 'Ana Ficticia');
  assert.equal(row.children[0].children[1].textContent, 'vence 10/09/2026');
  assert.equal(flat(row.children[1].textContent), 'R$ 250,00');
  assert.deepEqual(labels(row.children[2].children), ['Pendente', 'Vencida']);
  assert.deepEqual(labels(buttons()), ['Registrar pagamento', 'Vencimento', 'Cancelar']);
  assert.equal(dom.$('mens-generate').hidden, false);
});

test('somente leitura (Gestor): nenhum botão de ação e sem "Gerar cobranças"', async () => {
  const none = { registrar: false, editarVencimento: false, cancelar: false, estornar: false };
  const { dom, buttons, mens } = setup(() => ok(LIST([item({ acoes: none })], { permissoes: { registrar: false, cancelar: false, gerar: false } })));
  mens.activate();
  await flush();
  assert.equal(buttons().length, 0);
  assert.equal(dom.$('mens-generate').hidden, true);
});

test('linha paga mostra data e forma; estornada avisa; pendente sem vencimento diz "sem vencimento"', async () => {
  const itens = [
    item({ status: 'Paga', vencida: false, pagamento: { payment_id: 'PAG-1', data: '2026-09-12', forma: 'PIX', valor: 250, status: 'Confirmado' }, acoes: { registrar: false, editarVencimento: false, cancelar: false, estornar: true } }),
    item({ charge_id: 'COB-2', status: 'Pendente', vencimento: '', vencida: false, pagamento: { payment_id: 'PAG-2', data: '2026-09-01', forma: 'PIX', valor: 250, status: 'Estornado' } }),
  ];
  const { rows, buttons, mens } = setup(() => ok(LIST(itens)));
  mens.activate();
  await flush();
  assert.equal(rows()[0].children[0].children[0].children[1].textContent, 'vence 10/09/2026 · pago em 12/09/2026 (PIX)');
  assert.deepEqual(labels(buttons(0)), ['Estornar']);
  assert.equal(rows()[1].children[0].children[0].children[1].textContent, 'sem vencimento · pagamento estornado');
});

test('totais da competência e estado vazio', async () => {
  const a = setup();
  a.mens.activate();
  await flush();
  assert.deepEqual(a.dom.$('mens-totals').children.map((c) => c.children[0].textContent), ['Previsto', 'Pago', 'Pendente', 'Vencido']);
  assert.equal(flat(a.dom.$('mens-totals').children[2].children[1].children[0].textContent), 'R$ 250,00');
  const b = setup(() => ok(LIST([])));
  b.mens.activate();
  await flush();
  assert.deepEqual(b.dom.visible(PARTS), ['mens-empty']);
});

test('openWith abre a lista já na competência e com a busca pedida e não recarrega de novo ao ativar', async () => {
  const { dom, calls, mens } = setup((a, args) => ok(LIST([item()], { competencia: args[0].competencia })));
  mens.openWith({ competencia: '2026-08', busca: 'Ana Ficticia' });
  mens.activate();
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args[0], { competencia: '2026-08', busca: 'Ana Ficticia', status: '' });
  assert.equal(dom.$('mens-q').value, 'Ana Ficticia');
  mens.openWith({ competencia: 'lixo', busca: 'x'.repeat(100) });
  await flush();
  assert.equal(calls[1].args[0].competencia, '2026-08', 'competência inválida é ignorada');
  assert.equal(calls[1].args[0].busca.length, 60);
});

test('totais: mês atual em destaque, mês anterior menor no mesmo cartão e chip conforme o sentido (pago subir é bom, pendente subir é ruim)', async () => {
  const { dom, mens } = setup();
  mens.activate();
  await flush();
  const cards = dom.$('mens-totals').children;
  const read = (c) => ({ label: c.children[0].textContent, value: flat(c.children[1].children[0].textContent), chip: c.children[1].children[1] ? c.children[1].children[1].textContent : null, tone: c.children[1].children[1] ? c.children[1].children[1].className : null, prev: flat(c.children[2].textContent), cls: c.className });
  assert.deepEqual(read(cards[0]), { label: 'Previsto', value: 'R$ 550,00', chip: '+10,0%', tone: 'delta delta-good', prev: 'ago/26: R$ 500,00', cls: 'total-card total-good' });
  assert.deepEqual(read(cards[1]), { label: 'Pago', value: 'R$ 200,00', chip: '−50,0%', tone: 'delta delta-bad', prev: 'ago/26: R$ 400,00', cls: 'total-card total-bad' });
  assert.deepEqual(read(cards[2]), { label: 'Pendente', value: 'R$ 250,00', chip: '+25,0%', tone: 'delta delta-bad', prev: 'ago/26: R$ 200,00', cls: 'total-card total-bad' });
  const vencido = read(cards[3]);
  assert.equal(vencido.chip, null, 'mês anterior sem vencido: sem base para variação');
  assert.equal(vencido.prev, 'ago/26: R$ 0,00');
  assert.equal(vencido.cls, 'total-card');
});

test('filtros: buscar, status e competência recarregam; competência inválida é ignorada', async () => {
  const { dom, calls, mens } = setup((a, args) => ok(LIST([item()], { competencia: args[0].competencia || '2026-09' })));
  mens.activate();
  await flush();
  dom.$('mens-q').value = 'ana';
  dom.submit('mens-filter');
  await flush();
  assert.deepEqual(calls[1].args[0], { competencia: '2026-09', busca: 'ana', status: '' });
  dom.$('mens-status').value = 'Paga';
  dom.$('mens-status').listeners.change();
  await flush();
  assert.equal(calls[2].args[0].status, 'Paga');
  dom.$('mens-comp').value = '2026-08';
  dom.$('mens-comp').listeners.change();
  await flush();
  assert.equal(calls[3].args[0].competencia, '2026-08');
  dom.$('mens-comp').value = '2026-13';
  dom.$('mens-comp').listeners.change();
  await flush();
  assert.equal(calls.length, 4);
  assert.equal(dom.$('mens-comp').value, '2026-08');
});

test('registrar pagamento: abre a janela com data de hoje, envia versão e campos, fecha, recarrega e avisa', async () => {
  const { dom, calls, buttons, mens, rows } = setup((acao) => (acao === 'mensalidades.registrarPagamento' ? ok(item({ status: 'Paga' })) : ok(LIST())));
  mens.activate();
  await flush();
  const opener = buttons()[0];
  opener.listeners.click();
  assert.equal(dom.$('mens-dialog').hidden, false);
  assert.equal(dom.$('mens-dialog-title').textContent, 'Registrar pagamento');
  assert.match(flat(dom.$('mens-dialog-info').textContent), /Ana Ficticia · competência 09\/2026 · R\$ 250,00\. O pagamento é sempre integral\./);
  assert.equal(dom.$('mens-f-data').value, '2026-09-30');
  assert.equal(dom.$('mens-f-data').max, '2026-09-30');
  assert.deepEqual(['mens-f-data-box', 'mens-f-forma-box', 'mens-f-conta-box', 'mens-f-obs-box'].map((id) => dom.$(id).hidden), [false, false, false, false]);
  assert.deepEqual(['mens-f-motivo-box', 'mens-f-venc-box', 'mens-f-gcomp-box'].map((id) => dom.$(id).hidden), [true, true, true]);
  assert.equal(dom.$('mens-view-inner'), null);
  assert.equal(dom.$('view-mensalidades-inner').inert, true);
  dom.$('mens-f-forma').value = 'PIX';
  dom.$('mens-f-conta').value = 'PF';
  dom.$('mens-f-obs').value = 'balcão';
  dom.submit('mens-form');
  await flush();
  const sent = calls.find((c) => c.acao === 'mensalidades.registrarPagamento');
  assert.deepEqual(sent.args, ['COB-1', { versao: 'v1', data: '2026-09-30', forma: 'PIX', conta: 'PF', observacao: 'balcão' }]);
  assert.equal(dom.$('mens-dialog').hidden, true);
  assert.equal(dom.$('view-mensalidades-inner').inert, false);
  assert.equal(dom.$('mens-notice').textContent, 'Pagamento registrado.');
  assert.equal(dom.$('mens-notice').hidden, false);
  assert.equal(calls.filter((c) => c.acao === 'mensalidades.listar').length, 2);
  assert.ok(rows().length === 1);
  assert.ok(opener);
});

test('erros de validação aparecem na janela (mensagens do servidor) e a janela continua aberta', async () => {
  const { dom, mens, buttons } = setup((acao) => (acao === 'mensalidades.registrarPagamento'
    ? fail('VALIDACAO', 'Dados inválidos', [{ campo: 'forma', mensagem: 'Escolha a forma de pagamento.' }, { campo: 'data', mensagem: 'Informe uma data válida.' }])
    : ok(LIST())));
  mens.activate();
  await flush();
  buttons()[0].listeners.click();
  dom.submit('mens-form');
  await flush();
  assert.equal(dom.$('mens-dialog').hidden, false);
  assert.equal(dom.$('mens-dialog-error').hidden, false);
  assert.deepEqual(dom.$('mens-dialog-error').children.map((p) => p.textContent), ['Escolha a forma de pagamento.', 'Informe uma data válida.']);
  assert.equal(dom.$('mens-submit').disabled, false);
  assert.ok(dom.$('mens-dialog-error').focused > 0);
});

test('envio duplo é ignorado enquanto a resposta não chega (sem pagamento em dobro)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { dom, calls, mens, buttons } = setup((acao) => (acao === 'mensalidades.registrarPagamento' ? gate.then(() => ok(item({ status: 'Paga' }))) : ok(LIST())));
  mens.activate();
  await flush();
  buttons()[0].listeners.click();
  dom.submit('mens-form');
  dom.submit('mens-form');
  await flush();
  assert.equal(calls.filter((c) => c.acao === 'mensalidades.registrarPagamento').length, 1);
  assert.equal(dom.$('mens-submit').disabled, true);
  release();
  await flush();
  assert.equal(calls.filter((c) => c.acao === 'mensalidades.registrarPagamento').length, 1);
});

test('conflito (versão desatualizada ou estado inválido): mostra a mensagem e recarrega a lista', async () => {
  for (const code of ['VERSAO_DESATUALIZADA', 'ESTADO_INVALIDO']) {
    const { dom, calls, mens, buttons } = setup((acao) => (acao === 'mensalidades.registrarPagamento' ? fail(code, 'Recarregue a lista.') : ok(LIST())));
    mens.activate();
    await flush();
    buttons()[0].listeners.click();
    dom.submit('mens-form');
    await flush();
    assert.equal(dom.$('mens-dialog-error').children[0].textContent, 'Recarregue a lista.', code);
    assert.equal(calls.filter((c) => c.acao === 'mensalidades.listar').length, 2, code);
  }
});

test('cancelar e estornar exigem motivo na janela e enviam o motivo', async () => {
  const itens = [item(), item({ charge_id: 'COB-2', status: 'Paga', vencida: false, pagamento: { payment_id: 'PAG-9', data: '2026-09-12', forma: 'PIX', valor: 250, status: 'Confirmado' }, acoes: { registrar: false, editarVencimento: false, cancelar: false, estornar: true } })];
  const { dom, calls, mens, buttons } = setup((acao) => (acao === 'mensalidades.listar' ? ok(LIST(itens)) : ok(item())));
  mens.activate();
  await flush();
  buttons(0)[2].listeners.click();
  assert.equal(dom.$('mens-dialog-title').textContent, 'Cancelar cobrança');
  assert.equal(dom.$('mens-f-motivo-box').hidden, false);
  assert.equal(dom.$('mens-f-data-box').hidden, true);
  assert.match(dom.$('mens-dialog-info').textContent, /Nada é apagado/);
  dom.$('mens-f-motivo').value = 'aluno trancou';
  dom.submit('mens-form');
  await flush();
  assert.deepEqual(calls.find((c) => c.acao === 'mensalidades.cancelar').args, ['COB-1', { versao: 'v1', motivo: 'aluno trancou' }]);
  buttons(1)[0].listeners.click();
  assert.equal(dom.$('mens-dialog-title').textContent, 'Estornar pagamento');
  dom.$('mens-f-motivo').value = 'PIX devolvido';
  dom.submit('mens-form');
  await flush();
  assert.deepEqual(calls.find((c) => c.acao === 'mensalidades.estornar').args, ['PAG-9', { motivo: 'PIX devolvido' }]);
});

test('editar vencimento: campo preenchido com o vencimento atual e envio da nova data', async () => {
  const { dom, calls, mens, buttons } = setup((acao) => (acao === 'mensalidades.listar' ? ok(LIST()) : ok(item())));
  mens.activate();
  await flush();
  buttons()[1].listeners.click();
  assert.equal(dom.$('mens-f-venc').value, '2026-09-10');
  assert.equal(dom.$('mens-f-venc-box').hidden, false);
  dom.$('mens-f-venc').value = '2026-10-05';
  dom.submit('mens-form');
  await flush();
  assert.deepEqual(calls.find((c) => c.acao === 'mensalidades.editarVencimento').args, ['COB-1', { versao: 'v1', vencimento: '2026-10-05' }]);
});

test('Esc, Fechar e fundo fecham a janela sem enviar nada e devolvem a tela ao normal', async () => {
  const { dom, calls, mens, buttons, press } = setup();
  mens.activate();
  await flush();
  const before = calls.length;
  buttons()[0].listeners.click();
  press('Enter');
  assert.equal(dom.$('mens-dialog').hidden, false);
  press('Escape');
  assert.equal(dom.$('mens-dialog').hidden, true);
  buttons()[0].listeners.click();
  dom.click('mens-cancel');
  assert.equal(dom.$('mens-dialog').hidden, true);
  buttons()[0].listeners.click();
  dom.click('mens-dialog-backdrop');
  assert.equal(dom.$('mens-dialog').hidden, true);
  assert.equal(dom.$('view-mensalidades-inner').inert, false);
  assert.equal(calls.length, before);
});

test('gerar cobranças: mostra a prévia (sem enviar nada a ninguém), confirma e recarrega', async () => {
  const preview = { competencia: '2026-09', diaPadrao: 10, resumo: { elegiveis: 3, jaExistentes: 1, comPacote: 1, comDiaPadrao: 2, valorTotal: 700, ignoradosIsentos: 4 } };
  const { dom, calls, mens } = setup((acao) => {
    if (acao === 'mensalidades.previaGerar') return ok(preview);
    if (acao === 'mensalidades.gerar') return ok({ competencia: '2026-09', criadas: 3, resumo: preview.resumo });
    return ok(LIST());
  });
  mens.activate();
  await flush();
  dom.click('mens-generate');
  await flush();
  assert.equal(dom.$('mens-dialog-title').textContent, 'Gerar cobranças do mês');
  assert.deepEqual(dom.$('mens-f-gcomp').options.map((o) => o.value), ['2026-09', '2026-10']);
  assert.equal(dom.$('mens-f-gcomp-box').hidden, false);
  assert.equal(flat(dom.$('mens-dialog-info').textContent), '3 cobranças serão criadas (R$ 700,00) · 1 já existiam e serão puladas · 1 coberta(s) por pacote · 2 sem dia de vencimento (usarão o dia 10) · 4 isento(s) ignorado(s). Isto só cria o registro no sistema: nenhuma mensagem é enviada a ninguém.');
  assert.deepEqual(calls.find((c) => c.acao === 'mensalidades.previaGerar').args, [{ competencia: '2026-09' }]);
  assert.equal(dom.$('mens-submit').disabled, false);
  dom.submit('mens-form');
  await flush();
  assert.deepEqual(calls.find((c) => c.acao === 'mensalidades.gerar').args, [{ competencia: '2026-09' }]);
  assert.equal(dom.$('mens-dialog').hidden, true);
  assert.equal(dom.$('mens-notice').textContent, '3 cobranças criadas para 09/2026.');
});

test('gerar sem nada novo desabilita a confirmação e explica; trocar a competência refaz a prévia', async () => {
  const none = { competencia: '2026-09', diaPadrao: 10, resumo: { elegiveis: 0, jaExistentes: 5, comPacote: 0, comDiaPadrao: 0, valorTotal: 0, ignoradosIsentos: 0 } };
  const { dom, calls, mens } = setup((acao) => (acao === 'mensalidades.previaGerar' ? ok(none) : ok(LIST())));
  mens.activate();
  await flush();
  dom.click('mens-generate');
  await flush();
  assert.equal(dom.$('mens-submit').disabled, true);
  assert.equal(dom.$('mens-dialog-error').children[0].textContent, 'Não há cobranças novas para esta competência.');
  dom.$('mens-f-gcomp').value = '2026-10';
  dom.$('mens-f-gcomp').listeners.change();
  await flush();
  assert.deepEqual(calls.filter((c) => c.acao === 'mensalidades.previaGerar').map((c) => c.args[0].competencia), ['2026-09', '2026-10']);
});

test('erros da lista: mensagem e referência; falha de transporte; erro de formato inesperado', async () => {
  const a = setup(() => fail('ERRO_INTERNO', 'Ocorreu um erro inesperado.'));
  a.mens.activate();
  await flush();
  assert.deepEqual(a.dom.visible(PARTS), ['mens-error']);
  assert.equal(a.dom.$('mens-error-ref').textContent, 'Código de referência: c2');
  const b = setup(() => { throw Object.assign(new Error('O servidor demorou para responder.'), { name: 'TransportError' }); });
  b.mens.activate();
  await flush();
  assert.equal(b.dom.$('mens-error-msg').textContent, 'O servidor demorou para responder.');
  const c = setup(() => ok({ itens: 'x' }));
  c.mens.activate();
  await flush();
  assert.equal(c.dom.$('mens-error-msg').textContent, 'Não foi possível concluir. Tente novamente.');
});

test('sessão recusada pelo servidor: avisa o aplicativo (NAO_AUTENTICADO e ACESSO_NEGADO)', async () => {
  for (const code of ['NAO_AUTENTICADO', 'ACESSO_NEGADO']) {
    const { auth, mens } = setup(() => fail(code, 'x'));
    mens.activate();
    await flush();
    assert.deepEqual(auth, [code]);
  }
});

test('reset apaga a lista, os totais e a janela do usuário anterior e descarta respostas atrasadas', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { dom, mens } = setup((acao, args, n) => (n === 1 ? ok(LIST()) : gate.then(() => ok(LIST()))));
  mens.activate();
  await flush();
  dom.$('mens-q').value = 'x';
  const pending = mens.load();
  mens.reset();
  release();
  await pending;
  assert.equal(dom.$('mens-list').children.length, 0);
  assert.equal(dom.$('mens-totals').children.length, 0);
  assert.equal(dom.$('mens-q').value, '');
  assert.equal(dom.$('mens-dialog').hidden, true);
  assert.deepEqual(dom.visible(PARTS), ['mens-loading']);
});

test('texto do servidor com HTML aparece literalmente (nome, status, forma)', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { rows, mens } = setup(() => ok(LIST([item({ nome: evil, status: evil, pagamento: { payment_id: 'P', data: '2026-09-01', forma: evil, valor: 1, status: 'Confirmado' } })])));
  mens.activate();
  await flush();
  const row = rows()[0].children[0];
  assert.equal(row.children[0].children[0].textContent, evil);
  assert.equal(row.children[2].children[0].textContent, evil);
  assert.match(row.children[0].children[1].textContent, /<img src=x onerror=alert\(1\)>/);
});

// ---------- aba na navegação ----------
function appSetup(perfil) {
  const dom = createDom();
  const events = [];
  let onUser = null;
  const auth = { start: (cb) => { onUser = cb; }, login: async () => {}, logout: async () => { onUser(null); return true; }, touch() {}, checkIdle: async () => false };
  const api = { call: async () => ok({ usuario: { nome: 'Ana', perfil } }) };
  const dash = { load: async () => ({ ok: true }), reset() {} };
  const students = { activate() {}, reset() {} };
  const mensalidades = { activate: () => events.push('activate'), reset: () => events.push('reset'), openWith: (f) => events.push(['openWith', f]) };
  const app = createApp({ doc: dom.doc, auth, api, dashboard: dash, students, mensalidades });
  app.start();
  return { dom, events, emit: (u) => onUser(u) };
}

test('aba Mensalidades só aparece para Administrador, Gestor e Financeiro e ativa a tela ao abrir', async () => {
  for (const [perfil, visible] of [['Administrador', true], ['Gestor', true], ['Financeiro', true], ['Recepcao', false], ['Professor', false], ['Consulta', false]]) {
    const { dom, events, emit } = appSetup(perfil);
    emit({ uid: 'u' });
    await flush();
    assert.equal(dom.$('tab-mensalidades').hidden, !visible, perfil);
    if (visible) {
      dom.click('tab-mensalidades');
      assert.equal(dom.$('view-mensalidades').hidden, false);
      assert.equal(dom.$('view-dashboard').hidden, true);
      assert.equal(dom.$('tab-mensalidades').getAttribute('aria-current'), 'page');
      assert.deepEqual(events, ['activate']);
    }
  }
});

test('abrir Mensalidades filtrada (vindo da área de trabalho): aplica o filtro e mostra a aba', async () => {
  const dom = createDom();
  const events = [];
  let onUser = null;
  const auth = { start: (cb) => { onUser = cb; }, login: async () => {}, logout: async () => true, touch() {}, checkIdle: async () => false };
  const api = { call: async () => ok({ usuario: { nome: 'Ana', perfil: 'Administrador' } }) };
  const mensalidades = { activate: () => events.push('activate'), reset() {}, openWith: (f) => events.push(['openWith', f]) };
  const app = createApp({ doc: dom.doc, auth, api, dashboard: { load: async () => ({ ok: true }), reset() {} }, students: { activate() {}, reset() {} }, mensalidades });
  app.start();
  onUser({ uid: 'u' });
  await flush();
  app.openMensalidade({ competencia: '2026-09', busca: 'Ana' });
  assert.deepEqual(events[0], ['openWith', { competencia: '2026-09', busca: 'Ana' }]);
  assert.equal(dom.$('view-mensalidades').hidden, false);
  assert.equal(dom.$('view-dashboard').hidden, true);
});

test('ao sair, a aba some e a tela é limpa', async () => {
  const { dom, events, emit } = appSetup('Administrador');
  emit({ uid: 'u' });
  await flush();
  dom.click('logout');
  await flush();
  assert.equal(dom.$('tab-mensalidades').hidden, true);
  assert.ok(events.includes('reset'));
});

// ---------- pendências do aluno, visão em tabela ----------
const P = (comp, valor = 250, vencida = true) => ({ competencia: comp, vencimento: comp + '-10', valor, vencida });
const withPend = (over = {}) => item({ pendencias: [P('2026-07'), P('2026-08'), P('2026-09')], pendenciasValor: 750, pendenciasAnteriores: 2, pendenciasAnterioresValor: 500, ...over });
const pendBlock = (rows) => rows()[0].children[0].children[0].children[2];

test('monthLabel abrevia a competência', () => {
  assert.equal(monthLabel('2026-07'), 'jul/26');
  assert.equal(monthLabel('2027-01'), 'jan/27');
});

test('aluno com pendência mostra TODOS os meses pendentes (também os anteriores) e quanto está atrasado antes do mês filtrado', async () => {
  const { rows, mens } = setup(() => ok(LIST([withPend()])));
  mens.activate();
  await flush();
  const block = pendBlock(rows);
  assert.equal(block.className, 'mens-pend');
  assert.equal(block.children[0].textContent, 'Pendências:');
  assert.deepEqual(block.children.slice(1, 4).map((c) => c.textContent), ['jul/26', 'ago/26', 'set/26']);
  assert.ok(block.children.slice(1, 4).every((c) => /chip-vencida/.test(c.className)));
  assert.equal(block.children[3].getAttribute('aria-current'), 'true', 'o mês que está na tela fica marcado');
  assert.equal(block.children[1].getAttribute('aria-current'), null);
  assert.equal(flat(block.children[4].textContent), '2 meses anteriores em aberto · R$ 500,00');
});

test('clicar num mês pendente abre aquele mês já filtrado pelo aluno', async () => {
  const { dom, calls, rows, mens } = setup((a, args) => ok(LIST([withPend()], { competencia: args[0].competencia || '2026-09' })));
  mens.activate();
  await flush();
  pendBlock(rows).children[1].listeners.click();
  await flush();
  assert.deepEqual(calls[1].args[0], { competencia: '2026-07', busca: 'Ana Ficticia', status: '' });
  assert.equal(dom.$('mens-q').value, 'Ana Ficticia');
});

test('aluno com a cobrança paga mas com outros meses pendentes: "Outros meses pendentes"; sem pendência: nenhum bloco; um mês só no singular', async () => {
  const paid = withPend({ status: 'Paga', vencida: false, acoes: { registrar: false, editarVencimento: false, cancelar: false, estornar: false }, pendencias: [P('2026-08')], pendenciasAnteriores: 1, pendenciasAnterioresValor: 250 });
  const a = setup(() => ok(LIST([paid])));
  a.mens.activate();
  await flush();
  assert.equal(pendBlock(a.rows).children[0].textContent, 'Outros meses pendentes:');
  assert.equal(flat(pendBlock(a.rows).children[2].textContent), '1 mês anterior em aberto · R$ 250,00');
  const none = setup(() => ok(LIST([item({ pendencias: [], pendenciasAnteriores: 0 })])));
  none.mens.activate();
  await flush();
  assert.equal(none.rows()[0].children[0].children[0].children.length, 2, 'só nome e vencimento');
});

function tableSetup(respond = () => ok(LIST([withPend(), item({ charge_id: 'COB-2', student_id: 'ALU-2', nome: 'Bruno Ficticio', status: 'Paga', vencida: false, valor: 200, pendencias: [], pendenciasAnteriores: 0, pagamento: { payment_id: 'P2', data: '2026-09-12', forma: 'PIX', valor: 200, status: 'Confirmado' }, acoes: { registrar: false, editarVencimento: false, cancelar: false, estornar: true } })]))) {
  const dom = createDom();
  const calls = [];
  const files = [];
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(acao, args, calls.length); } };
  const createTable = (opts) => createDataTable({ doc: dom.doc, storage: null, download: (n, t) => files.push({ n, t }), ...opts });
  const mens = createMensalidades({ doc: dom.doc, api, createTable });
  const root = dom.$('mens-table-root');
  const tbl = () => root.children[2].children[0];
  const names = () => tbl().children[1].children.map((tr) => tr.children[0].textContent);
  return { dom, calls, files, mens, root, tbl, names };
}

test('alternar Cartões ⇄ Tabela: a tabela usa os mesmos dados, com colunas de pendência e ações por linha', async () => {
  const s = tableSetup();
  s.mens.activate();
  await flush();
  assert.equal(s.dom.$('mens-views').hidden, false);
  assert.equal(s.dom.$('mens-list').hidden, false);
  assert.equal(s.dom.$('mens-table-root').hidden, true);
  s.dom.click('mens-view-table');
  assert.equal(s.dom.$('mens-list').hidden, true);
  assert.equal(s.dom.$('mens-table-root').hidden, false);
  assert.equal(s.dom.$('mens-view-table').getAttribute('aria-pressed'), 'true');
  const heads = s.tbl().children[0].children[0].children.map((th) => (th.children[0] ? th.children[0].textContent : th.textContent).replace(/ [▲▼]$/, ''));
  assert.deepEqual(heads, ['Aluno', 'Vencimento', 'Valor', 'Status', 'Meses pendentes', 'Meses anteriores em aberto', 'Em aberto do aluno', 'Ações']);
  assert.deepEqual(s.names(), ['Ana Ficticia', 'Bruno Ficticio']);
  const ana = s.tbl().children[1].children[0].children;
  assert.equal(ana[4].textContent, 'jul/26, ago/26, set/26');
  assert.equal(ana[5].textContent, '2');
  assert.equal(flat(ana[6].textContent), 'R$ 750,00');
  s.dom.click('mens-view-cards');
  assert.equal(s.dom.$('mens-list').hidden, false);
});

test('tabela: botão de ação da linha abre a mesma janela de operação; filtro por status funciona', async () => {
  const s = tableSetup();
  s.mens.activate();
  await flush();
  s.dom.click('mens-view-table');
  const actions = s.tbl().children[1].children[0].children[7].children;
  assert.deepEqual(actions.map((b) => b.textContent), ['Pagar', 'Vencimento', 'Cancelar']);
  actions[0].listeners.click();
  assert.equal(s.dom.$('mens-dialog').hidden, false);
  assert.equal(s.dom.$('mens-dialog-title').textContent, 'Registrar pagamento');
  s.dom.click('mens-cancel');
  const statusFilter = s.tbl().children[0].children[1].children[3].children[0];
  statusFilter.value = 'Paga';
  statusFilter.listeners.change();
  assert.deepEqual(s.names(), ['Bruno Ficticio']);
});

test('sem createTable não há alternância e a lista de cartões continua sendo a única visão; reset volta aos cartões', async () => {
  const plain = setup();
  plain.mens.activate();
  await flush();
  assert.equal(plain.dom.$('mens-views').hidden, true);
  const s = tableSetup();
  s.mens.activate();
  await flush();
  s.dom.click('mens-view-table');
  s.mens.reset();
  assert.equal(s.dom.$('mens-table-root').hidden, true);
  assert.equal(s.dom.$('mens-view-cards').getAttribute('aria-pressed'), 'true');
});
