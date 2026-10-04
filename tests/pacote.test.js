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

// ---------- pacote da família ----------
const mem = (id, nome, over) => ({ student_id: id, nome, matricula: over === null ? null : { valor: 200, versao: 'v-' + id, status: 'Ativa', tipo_isencao: '', pago_ate: '', ...over } });
const FAMILY = () => ({
  id: 'RES-1', nome: 'Bruno Ficticio',
  membros: [
    mem('ALU-1', 'Bruno Ficticio', { valor: 200 }),
    mem('ALU-2', 'Ana Ficticia', { valor: 150 }),
    mem('ALU-3', 'Carlos Ficticio', { valor: 100, tipo_isencao: 'Bolsa / cortesia' }),
    mem('ALU-4', 'Sem Matricula', null),
  ],
});
const FAM_RESUMO = { familia: 'RES-1', codigo: 'PCT-x', modo: 'unico', mes_inicial: '2026-09', meses: 3, membros: 2, valor_total: 1050, confirmados: 2, previstos: 0, itens: [] };
/** linhas da tabela de membros: { box, name, valor, note } */
const rowsOf = (dom) => dom.$('pk-members').children.map((r) => ({ row: r, box: r.children[0].children[0], name: r.children[0].children[1].textContent, valor: r.children[1], note: r.children[2].textContent }));
const checkFamily = (dom, on = true) => { dom.$('pk-f-familia').checked = on; dom.$('pk-f-familia').listeners.change(); };

test('aluno com família: aparece a opção "família toda", desmarcada; sem família ela some', () => {
  const a = setup();
  a.pacote.open({ item: ITEM(), opener: a.opener, formas: FORMAS, family: FAMILY() });
  assert.equal(a.dom.$('pk-family-toggle-box').hidden, false);
  assert.equal(a.dom.$('pk-f-familia').checked, false);
  assert.equal(a.dom.$('pk-members-box').hidden, true);
  assert.equal(a.dom.$('pk-valor-box').hidden, false);
  const b = setup();
  b.open();
  assert.equal(b.dom.$('pk-family-toggle-box').hidden, true);
  assert.equal(b.dom.$('pk-members-box').hidden, true);
});

test('marcar "família toda": mostra os membros com valor sugerido (mensalidade × meses), troca o valor único pela soma e bloqueia quem não pode', () => {
  const { dom, pacote, opener, fill } = setup();
  pacote.open({ item: ITEM(), opener, formas: FORMAS, family: FAMILY() });
  fill({ 'pk-f-meses': '3' });
  dom.$('pk-f-meses').listeners.change();
  checkFamily(dom);
  assert.equal(dom.$('pk-members-box').hidden, false);
  assert.equal(dom.$('pk-valor-box').hidden, true);
  const rows = rowsOf(dom);
  assert.deepEqual(rows.map((r) => r.name), ['Bruno Ficticio', 'Ana Ficticia', 'Carlos Ficticio', 'Sem Matricula']);
  assert.deepEqual(rows.map((r) => r.box.checked), [true, true, false, false]);
  assert.deepEqual(rows.map((r) => r.box.disabled), [false, false, true, true]);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.valor.value), ['600', '450']);
  assert.match(rows[2].note, /isen/i);
  assert.match(rows[3].note, /matr/i);
  assert.match(flatText(dom.$('pk-total')), /R\$\s?1\.050,00/);
  checkFamily(dom, false);
  assert.equal(dom.$('pk-members-box').hidden, true);
  assert.equal(dom.$('pk-valor-box').hidden, false);
});
const flatText = (n) => String(n.textContent).replace(/\s/g, ' ');

test('mudar os meses atualiza só os valores que você não editou; a soma acompanha', () => {
  const { dom, pacote, opener, fill } = setup();
  pacote.open({ item: ITEM(), opener, formas: FORMAS, family: FAMILY() });
  checkFamily(dom);
  const rows = rowsOf(dom);
  rows[0].valor.value = '999,50';
  rows[0].valor.listeners.input();
  fill({ 'pk-f-meses': '2' });
  dom.$('pk-f-meses').listeners.change();
  assert.equal(rowsOf(dom)[0].valor.value, '999,50', 'editado: preservado');
  assert.equal(rowsOf(dom)[1].valor.value, '300', 'sugerido: 150 × 2');
  assert.match(flatText(dom.$('pk-total')), /R\$\s?1\.299,50/);
});

test('desmarcar um membro tira o valor dele da soma', () => {
  const { dom, pacote, opener } = setup();
  pacote.open({ item: ITEM(), opener, formas: FORMAS, family: FAMILY() });
  checkFamily(dom);
  const rows = rowsOf(dom);
  rows[1].box.checked = false;
  rows[1].box.listeners.change();
  assert.match(flatText(dom.$('pk-total')), /R\$\s?200,00/);
});

test('enviar para a família: chama pacotes.registrarFamilia com os membros marcados, cada um com a sua versão e o seu valor', async () => {
  const { dom, calls, events, pacote, opener, fill, submit } = setup(() => ok({ resumo: FAM_RESUMO }));
  pacote.open({ item: ITEM(), opener, formas: FORMAS, family: FAMILY() });
  fill({ 'pk-f-meses': '3', 'pk-f-valor': '' });
  dom.$('pk-f-meses').listeners.change();
  checkFamily(dom);
  await submit();
  assert.deepEqual(calls, [{ acao: 'pacotes.registrarFamilia', args: ['RES-1', {
    modo: 'unico', data: '2026-09-28', mes_inicial: '2026-09', meses: 3, forma: 'Crédito', observacao: '',
    membros: [{ student_id: 'ALU-1', versao: 'v-ALU-1', valor_total: 600 }, { student_id: 'ALU-2', versao: 'v-ALU-2', valor_total: 450 }],
  }] }]);
  assert.equal(dom.$('pk-dialog').hidden, true);
  assert.deepEqual(events.saved, [FAM_RESUMO]);
});

test('família: valida no navegador (nenhum membro, valor inválido) sem chamar o servidor, citando o aluno', async () => {
  const { dom, calls, pacote, opener, fill, submit } = setup();
  pacote.open({ item: ITEM(), opener, formas: FORMAS, family: FAMILY() });
  fill({ 'pk-f-meses': '3' });
  checkFamily(dom);
  const rows = rowsOf(dom);
  rows[1].valor.value = 'abc';
  rows[1].valor.listeners.input();
  await submit();
  assert.match(dom.$('pk-dialog-error').textContent, /Ana Ficticia/);
  rows[1].valor.value = '450';
  rows[0].box.checked = false; rows[0].box.listeners.change();
  rows[1].box.checked = false; rows[1].box.listeners.change();
  await submit();
  assert.match(dom.$('pk-dialog-error').textContent, /pelo menos um aluno/i);
  assert.equal(calls.length, 0);
});

test('abrir direto pela família (sem aluno): título da família, membros já visíveis e sem a opção de alternar', () => {
  const { dom, pacote, opener } = setup();
  pacote.open({ item: null, opener, formas: FORMAS, family: FAMILY() });
  assert.equal(dom.$('pk-dialog-title').textContent, 'Pacote da família · Bruno Ficticio');
  assert.equal(dom.$('pk-family-toggle-box').hidden, true);
  assert.equal(dom.$('pk-members-box').hidden, false);
  assert.equal(dom.$('pk-valor-box').hidden, true);
  assert.equal(rowsOf(dom).filter((r) => r.box.checked).length, 2);
});

test('família: mensagem do servidor (ex.: mês já pago de um membro) aparece e o painel continua aberto', async () => {
  const { dom, pacote, opener, fill, submit } = setup(() => fail('VALIDACAO', 'x', [{ campo: 'mes_inicial', mensagem: 'Ana Ficticia: já há cobrança paga em: 2026-09.' }]));
  pacote.open({ item: null, opener, formas: FORMAS, family: FAMILY() });
  fill({ 'pk-f-meses': '3' });
  await submit();
  assert.match(dom.$('pk-dialog-error').textContent, /Ana Ficticia: já há cobrança paga/);
  assert.equal(dom.$('pk-dialog').hidden, false);
  assert.equal(dom.$('pk-save').disabled, false);
});

test('reset e reabertura limpam a tabela de membros (nada do uso anterior fica)', () => {
  const { dom, pacote, opener } = setup();
  pacote.open({ item: ITEM(), opener, formas: FORMAS, family: FAMILY() });
  checkFamily(dom);
  pacote.reset();
  assert.equal(dom.$('pk-members').children.length, 0);
  assert.equal(dom.$('pk-total').textContent, '');
  pacote.open({ item: ITEM(), opener, formas: FORMAS });
  assert.equal(dom.$('pk-f-familia').checked, false);
  assert.equal(dom.$('pk-members-box').hidden, true);
});
