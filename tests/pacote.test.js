import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacote } from '../js/pacote.js';
import { createDom, flush } from './helpers/dom-env.js';

const ok = (data) => ({ ok: true, data, error: null, correlationId: 'c1' });
const fail = (code, message, fields) => ({ ok: false, data: null, error: fields ? { code, message, fields } : { code, message }, correlationId: 'c2' });
const FORMAS = ['PIX', 'Débito', 'Crédito', 'Dinheiro', 'Misto'];
const ITEM = (over = {}) => ({ student_id: 'ALU-2', nome: 'Ana Ficticia', matricula: { enrollment_id: 'MAT-1', valor: 150, dia_vencimento: 10, status: 'Ativa', pago_ate: '', tipo_isencao: '', versao: 'v-mat', ...over } });
const RESUMO = { modo: 'unico', meses: 3, valor_total: 600, mes_inicial: '2026-09', pago_ate: '2026-11', cobrancas_criadas: 2, cobrancas_cobertas: 3, confirmados: 1, previstos: 0 };

function setup(respond = () => ok({ resumo: RESUMO }), today = '2026-09-30') {
  const dom = createDom();
  const calls = [];
  const events = { saved: [], stale: 0, auth: [] };
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(acao, args); } };
  const pacote = createPacote({
    doc: dom.doc, api, today: () => today,
    onSaved: (resumo) => events.saved.push(resumo), onStale: () => { events.stale += 1; }, onAuthFailure: (c) => events.auth.push(c),
  });
  const opener = { focused: 0, focus() { this.focused += 1; } };
  const open = (item = ITEM(), formas = FORMAS) => pacote.open({ item, opener, formas });
  const fill = (over = {}) => {
    const v = { 'pk-f-modo': 'unico', 'pk-f-data': '2026-09-28', 'pk-f-mes': '2026-09', 'pk-f-meses': '3', 'pk-f-valor': '600', 'pk-f-forma': 'Crédito', 'pk-f-obs': '', ...over };
    Object.entries(v).forEach(([id, value]) => { dom.$(id).value = value; });
  };
  const submit = async () => { dom.submit('pk-form'); await flush(); };
  return { dom, calls, events, pacote, opener, open, fill, submit };
}

test('abrir: título com o aluno, campos com padrões seguros e tipo de pagamento sem escolha prévia', () => {
  const { dom, open } = setup();
  open();
  assert.equal(dom.$('pk-dialog').hidden, false);
  assert.equal(dom.$('af-inner').inert, true);
  assert.equal(dom.$('pk-dialog-title').textContent, 'Registrar pacote · Ana Ficticia');
  assert.equal(dom.$('pk-f-modo').value, '', 'o usuário precisa escolher: único ou recorrente');
  assert.deepEqual(dom.$('pk-f-modo').options.map((o) => o.value), ['', 'unico', 'recorrente']);
  assert.equal(dom.$('pk-f-data').value, '2026-09-30');
  assert.equal(dom.$('pk-f-data').max, '2026-09-30');
  assert.equal(dom.$('pk-f-mes').value, '2026-09');
  assert.equal(dom.$('pk-f-meses').value, '1');
  assert.equal(dom.$('pk-f-valor').value, '');
  assert.deepEqual(dom.$('pk-f-forma').options.map((o) => o.value), ['', ...FORMAS]);
  assert.ok(dom.$('pk-f-modo').focused > 0);
});

test('primeiro mês coberto é uma lista de meses (não um campo de digitar), com o mês sugerido selecionado', () => {
  const { dom, open } = setup();
  open(ITEM({ pago_ate: '2026-12' }));
  const values = dom.$('pk-f-mes').options.map((o) => o.value);
  assert.ok(values.includes('2026-09') && values.includes('2027-01') && values.includes('2025-01'));
  assert.equal(dom.$('pk-f-mes').options.find((o) => o.value === '2027-01').textContent, 'Janeiro/2027');
  assert.equal(dom.$('pk-f-mes').value, '2027-01');
  assert.deepEqual(values, values.slice().sort());
});

test('mês inicial padrão: o mês seguinte ao "pago até" quando ele ainda vale; senão o mês de hoje', () => {
  const a = setup();
  a.open(ITEM({ pago_ate: '2026-12' }));
  assert.equal(a.dom.$('pk-f-mes').value, '2027-01');
  const b = setup();
  b.open(ITEM({ pago_ate: '2026-03' }));
  assert.equal(b.dom.$('pk-f-mes').value, '2026-09');
  const c = setup();
  c.open(ITEM({ pago_ate: '2026-09' }));
  assert.equal(c.dom.$('pk-f-mes').value, '2026-10');
});

test('resumo ao vivo: único mostra o valor e a data; recorrente mostra as parcelas e a última absorve o centavo', () => {
  const { dom, open, fill } = setup();
  open();
  fill({ 'pk-f-modo': 'unico' });
  dom.$('pk-f-valor').listeners.input();
  assert.match(dom.$('pk-preview').textContent, /R\$\s?600,00/);
  assert.match(dom.$('pk-preview').textContent, /uma única vez/);
  assert.match(dom.$('pk-preview').textContent, /28\/09\/2026/);
  assert.match(dom.$('pk-preview').textContent, /09\/2026 a 11\/2026/);
  fill({ 'pk-f-modo': 'recorrente', 'pk-f-valor': '100' });
  dom.$('pk-f-modo').listeners.change();
  const t = dom.$('pk-preview').textContent;
  assert.match(t, /3 parcelas/);
  assert.match(t, /R\$\s?33,33/);
  assert.match(t, /R\$\s?33,34/);
  assert.match(t, /mês a mês/);
});

test('resumo ao vivo: sem dados válidos não inventa números', () => {
  const { dom, open, fill } = setup();
  open();
  fill({ 'pk-f-modo': 'recorrente', 'pk-f-valor': 'abc' });
  dom.$('pk-f-valor').listeners.input();
  assert.doesNotMatch(dom.$('pk-preview').textContent, /R\$/);
});

test('enviar: manda o pacote com a versão da matrícula, fecha, devolve o foco e avisa quem abriu', async () => {
  const { dom, calls, events, opener, open, fill, submit } = setup();
  open();
  fill({ 'pk-f-obs': 'cartão do pai' });
  await submit();
  assert.deepEqual(calls, [{ acao: 'pacotes.registrar', args: ['ALU-2', { versao: 'v-mat', modo: 'unico', data: '2026-09-28', mes_inicial: '2026-09', meses: 3, valor_total: 600, forma: 'Crédito', observacao: 'cartão do pai' }] }]);
  assert.equal(dom.$('pk-dialog').hidden, true);
  assert.equal(dom.$('af-inner').inert, false);
  assert.deepEqual(events.saved, [RESUMO]);
  assert.ok(opener.focused > 0);
});

test('valor aceita vírgula decimal e é enviado como número', async () => {
  const { calls, open, fill, submit } = setup();
  open();
  fill({ 'pk-f-valor': '1250,50', 'pk-f-modo': 'recorrente' });
  await submit();
  assert.equal(calls[0].args[1].valor_total, 1250.5);
  assert.equal(calls[0].args[1].modo, 'recorrente');
});

test('validação no navegador: sem tipo, valor inválido, forma vazia ou meses fora de 1–24 não chamam o servidor', async () => {
  const { dom, calls, open, fill, submit } = setup();
  open();
  const tries = [
    [{ 'pk-f-modo': '' }, /único ou recorrente/],
    [{ 'pk-f-valor': '' }, /valor/i],
    [{ 'pk-f-valor': 'abc' }, /valor/i],
    [{ 'pk-f-valor': '0' }, /valor/i],
    [{ 'pk-f-forma': '' }, /forma/i],
    [{ 'pk-f-meses': '0' }, /meses/i],
    [{ 'pk-f-meses': '25' }, /meses/i],
    [{ 'pk-f-meses': '1,5' }, /meses/i],
    [{ 'pk-f-mes': '' }, /mês/i],
    [{ 'pk-f-data': '' }, /data/i],
  ];
  for (const [over, re] of tries) {
    fill(over);
    await submit();
    assert.equal(dom.$('pk-dialog-error').hidden, false, JSON.stringify(over));
    assert.match(dom.$('pk-dialog-error').textContent, re, JSON.stringify(over));
  }
  assert.equal(calls.length, 0);
  assert.equal(dom.$('pk-dialog').hidden, false);
});

test('recusa do servidor com campos: mostra as mensagens, mantém o painel aberto e libera o botão', async () => {
  const { dom, events, open, fill, submit } = setup(() => fail('VALIDACAO', 'Dados inválidos', [{ campo: 'mes_inicial', mensagem: 'Já há cobrança paga em: 2026-09. Escolha outro mês inicial.' }]));
  open();
  fill();
  await submit();
  assert.match(dom.$('pk-dialog-error').textContent, /Já há cobrança paga em: 2026-09/);
  assert.equal(dom.$('pk-dialog').hidden, false);
  assert.equal(dom.$('pk-save').disabled, false);
  assert.deepEqual(events.saved, []);
});

test('versão desatualizada: fecha o painel e pede ao Aluno Full recarregar', async () => {
  const { dom, events, open, fill, submit } = setup(() => fail('VERSAO_DESATUALIZADA', 'x'));
  open();
  fill();
  await submit();
  assert.equal(dom.$('pk-dialog').hidden, true);
  assert.equal(events.stale, 1);
  assert.deepEqual(events.saved, []);
});

test('sessão caída: fecha o painel e avisa o aplicativo', async () => {
  const { dom, events, open, fill, submit } = setup(() => fail('NAO_AUTENTICADO', 'x'));
  open();
  fill();
  await submit();
  assert.equal(dom.$('pk-dialog').hidden, true);
  assert.deepEqual(events.auth, ['NAO_AUTENTICADO']);
});

test('erro de rede: mostra a mensagem e deixa tentar de novo', async () => {
  const dom = createDom();
  const err = Object.assign(new Error('Sem conexão com o servidor.'), { name: 'TransportError' });
  const pacote = createPacote({ doc: dom.doc, api: { call: async () => { throw err; } }, today: () => '2026-09-30', onSaved() {}, onStale() {}, onAuthFailure() {} });
  pacote.open({ item: ITEM(), opener: null, formas: FORMAS });
  Object.entries({ 'pk-f-modo': 'unico', 'pk-f-data': '2026-09-28', 'pk-f-mes': '2026-09', 'pk-f-meses': '3', 'pk-f-valor': '600', 'pk-f-forma': 'PIX' }).forEach(([id, v]) => { dom.$(id).value = v; });
  dom.submit('pk-form');
  await flush();
  assert.match(dom.$('pk-dialog-error').textContent, /Sem conexão/);
  assert.equal(dom.$('pk-save').disabled, false);
});

test('duplo envio: só uma chamada enquanto a primeira não termina', async () => {
  let release;
  const { calls, open, fill, dom } = setup(() => new Promise((r) => { release = () => r(ok({ resumo: RESUMO })); }));
  open();
  fill();
  dom.submit('pk-form');
  dom.submit('pk-form');
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(dom.$('pk-save').disabled, true);
  release();
  await flush();
});

test('Escape, Fechar e o fundo fecham o painel e devolvem o foco, sem chamar o servidor', async () => {
  for (const how of ['escape', 'fechar', 'fundo']) {
    const { dom, calls, opener, open } = setup();
    open();
    if (how === 'escape') dom.docEvent('keydown'); // sem tecla: não fecha
    assert.equal(dom.$('pk-dialog').hidden, false);
    if (how === 'escape') dom.docListeners.keydown.forEach((fn) => fn({ key: 'Escape' }));
    if (how === 'fechar') dom.click('pk-cancel');
    if (how === 'fundo') dom.click('pk-dialog-backdrop');
    assert.equal(dom.$('pk-dialog').hidden, true, how);
    assert.equal(dom.$('af-inner').inert, false, how);
    assert.ok(opener.focused > 0, how);
    assert.equal(calls.length, 0, how);
  }
});

test('reset (troca de usuário) fecha o painel e apaga o que foi digitado', () => {
  const { dom, open, fill, pacote } = setup();
  open();
  fill({ 'pk-f-valor': '999' });
  pacote.reset();
  assert.equal(dom.$('pk-dialog').hidden, true);
  assert.equal(dom.$('af-inner').inert, false);
  assert.equal(dom.$('pk-f-valor').value, '');
  assert.equal(dom.$('pk-preview').textContent, '');
});

test('respostas atrasadas depois de um reset são descartadas', async () => {
  let release;
  const { events, open, fill, dom, pacote } = setup(() => new Promise((r) => { release = () => r(ok({ resumo: RESUMO })); }));
  open();
  fill();
  dom.submit('pk-form');
  await flush();
  pacote.reset();
  release();
  await flush();
  assert.deepEqual(events.saved, []);
});
