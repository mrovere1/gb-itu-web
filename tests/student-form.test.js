import test from 'node:test';
import assert from 'node:assert/strict';
import { createDom } from './helpers/dom-env.js';
import { createFakeApi, okEnv, failEnv, transportError } from './helpers/fake-api.js';
import { createStudentForm } from '../js/student-form.js';

const OPCOES = {
  statusCriacao: ['Experimental', 'Ativo', 'Trancado', 'Inativo'],
  faixas: { adulto: ['Branca', 'Azul', 'Roxa', 'Marrom', 'Preta'], infantil: ['Branca', 'Cinza-Branca', 'Cinza', 'Verde-Preta'] },
};
const GESTOR = { criar: true, editarSensivel: true, confirmarDuplicidade: true };
const RECEPCAO = { criar: true, editarSensivel: false, confirmarDuplicidade: false };

const EDIT_ALL = ['nome_completo', 'nome_social', 'data_nascimento', 'data_matricula', 'telefone', 'email', 'contato_emergencia',
  'telefone_emergencia', 'observacoes', 'cpf', 'restricoes_medicas', 'faixa', 'graus'];
const EDICAO_GESTOR = { podeEditar: true, campos: EDIT_ALL, statusPermitidos: ['Trancado', 'Inativo'], confirmarDuplicidade: true };
const EDICAO_RECEPCAO = {
  podeEditar: true, statusPermitidos: [], confirmarDuplicidade: false,
  campos: ['nome_completo', 'nome_social', 'data_nascimento', 'data_matricula', 'telefone', 'email', 'contato_emergencia', 'telefone_emergencia', 'observacoes'],
};

function aluno(extra = {}) {
  return {
    student_id: 'ALU-9', nome_completo: 'Bruno Ficticio', nome_social: '', data_matricula: '01/02/2026', status: 'Ativo', faixa: 'Azul', graus: 2,
    turma_principal_id: '', updated_at: '01/02/2026', idade: 36, categoria: 'adulto', data_nascimento: '22/08/1990',
    telefone: '(11) 91234-5678', email: 'b@example.com', contato_emergencia: 'Contato', telefone_emergencia: '(11) 98888-7777',
    cpf: '111.444.777-35', restricoes_medicas: 'Asma', observacoes: 'Nota', ...extra,
  };
}
const detailOf = (edicao, extra = {}) => ({
  aluno: aluno(extra), permissoes: { contato: true, cpf: 'completo', medico: true, observacoes: true }, avisos: [], versao: 'V1', edicao,
});

function setup() {
  const dom = createDom();
  const fake = createFakeApi();
  const events = [];
  const hooks = {
    onSaved: (resp, notice) => events.push(['saved', resp.data, notice]),
    onCancel: (mode) => events.push(['cancel', mode]),
    onReload: (id) => events.push(['reload', id]),
    onAuthFailure: (code) => events.push(['auth', code]),
  };
  const form = createStudentForm({ doc: dom.doc, api: fake.api, hooks });
  const fill = (values) => Object.keys(values).forEach((k) => { dom.$('f-' + k).value = values[k]; });
  const startCreate = (perm = GESTOR) => form.openCreate({ opcoes: OPCOES, perm });
  const startEdit = (perm = GESTOR, edicao = EDICAO_GESTOR, extra) => form.openEdit({ detail: detailOf(edicao, extra), opcoes: OPCOES, perm });
  return { dom, fake, form, events, fill, startCreate, startEdit };
}

// ---------- novos (comportamento do portal) ----------
test('reset: apaga TODOS os valores digitados, erros, opções e confirmação (nada do usuário anterior no DOM)', () => {
  const { dom, form, fill, startCreate } = setup();
  startCreate();
  fill({ nome_completo: 'Ana Ficticia', cpf: '111.444.777-35', restricoes_medicas: 'asma', observacoes: 'x', telefone: '1' });
  dom.$('f-confirmarDuplicidade').checked = true;
  dom.$('confirm-box').hidden = false;
  dom.$('form-summary').textContent = 'erro';
  form.reset();
  ['nome_completo', 'nome_social', 'data_nascimento', 'data_matricula', 'cpf', 'telefone', 'email', 'contato_emergencia',
    'telefone_emergencia', 'restricoes_medicas', 'observacoes'].forEach((f) => assert.equal(dom.$('f-' + f).value, '', f));
  assert.equal(dom.$('f-status').options.length, 0);
  assert.equal(dom.$('f-faixa').options.length, 0);
  assert.equal(dom.$('f-confirmarDuplicidade').checked, false);
  assert.equal(dom.$('confirm-box').hidden, true);
  assert.equal(dom.$('form-summary').textContent, '');
  assert.equal(dom.$('form-submit').disabled, false);
});

test('reset invalida salvamento em andamento: a resposta tardia não chama onSaved nem reabre erro', async () => {
  const { dom, fake, form, events, fill, startCreate } = setup();
  startCreate();
  fill({ nome_completo: 'Ana Ficticia', data_nascimento: '2015-01-01' });
  dom.submit('student-form');
  assert.equal(fake.calls.length, 1);
  form.reset();
  await fake.resolve(okEnv({ aluno: aluno() }));
  assert.deepEqual(events, []);
  assert.equal(dom.$('form-submit').disabled, false);
});

test('sessão expirada ao salvar: avisa o app (onAuthFailure), libera o botão e não mostra erro de campo', async () => {
  for (const code of ['NAO_AUTENTICADO', 'ACESSO_NEGADO']) {
    const { dom, fake, events, fill, startCreate } = setup();
    startCreate();
    fill({ nome_completo: 'Ana Ficticia' });
    dom.submit('student-form');
    await fake.resolve(failEnv(code));
    assert.deepEqual(events, [['auth', code]], code);
    assert.equal(dom.$('form-submit').disabled, false, code);
    assert.equal(dom.$('form-summary').hidden, true, code);
  }
});

test('resposta de salvamento inválida ou tempo esgotado: dados preservados e aviso de que pode ter sido feito', async () => {
  for (const [mode, kind, expected] of [
    ['create', 'timeout', /cadastro pode ter sido feito/i],
    ['create', 'invalid-response', /cadastro pode ter sido feito/i],
    ['edit', 'timeout', /alteração pode ter sido feita/i],
    ['edit', 'invalid-response', /alteração pode ter sido feita/i],
  ]) {
    const { dom, fake, events, fill, startCreate, startEdit } = setup();
    if (mode === 'create') { startCreate(); fill({ nome_completo: 'Ana Ficticia' }); }
    else { startEdit(); fill({ nome_completo: 'Paula Alterada' }); }
    dom.submit('student-form');
    await fake.reject(transportError(kind));
    assert.match(dom.$('form-summary').textContent, expected, mode + '/' + kind);
    assert.equal(dom.$('f-nome_completo').value, mode === 'create' ? 'Ana Ficticia' : 'Paula Alterada');
    assert.equal(dom.$('form-submit').disabled, false);
    assert.deepEqual(events, []);
  }
});

test('falha de rede: aviso de que os dados continuam no formulário (sem afirmar que gravou)', async () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate();
  fill({ nome_completo: 'Ana Ficticia' });
  dom.submit('student-form');
  await fake.reject(transportError('network'));
  assert.match(dom.$('form-summary').textContent, /continuam no formulário/i);
  assert.doesNotMatch(dom.$('form-summary').textContent, /pode ter sido/i);
});

test('erro inesperado do cliente ao tratar a resposta não deixa o botão preso', async () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate();
  fill({ nome_completo: 'Ana Ficticia' });
  dom.submit('student-form');
  await fake.reject(new Error('bug qualquer'));
  assert.equal(dom.$('form-submit').disabled, false);
  assert.match(dom.$('form-summary').textContent, /não foi possível concluir/i);
});

test('cancelar e recarregar chamam os hooks (cancelar informa o modo)', () => {
  const a = setup();
  a.startCreate();
  a.dom.click('form-cancel');
  assert.deepEqual(a.events, [['cancel', 'create']]);
  const b = setup();
  b.startEdit();
  b.dom.click('form-cancel');
  b.dom.click('form-reload');
  assert.deepEqual(b.events, [['cancel', 'edit'], ['reload', 'ALU-9']]);
});

// ---------- portados do app antigo (mesmos nomes) ----------
test('formulário: opções de status/faixa vindas do servidor e padrões do dia', () => {
  const { dom, startCreate } = setup();
  startCreate();
  assert.deepEqual(dom.$('f-status').options.map((o) => o.value), OPCOES.statusCriacao);
  const faixa = dom.$('f-faixa').options;
  assert.equal(faixa[0].value, 'Branca');
  assert.deepEqual(faixa.slice(1).map((g) => g.label), ['Adulto', 'Infantil']);
  assert.deepEqual(faixa[1].children.map((o) => o.value), ['Azul', 'Roxa', 'Marrom', 'Preta']);
  assert.deepEqual(faixa[2].children.map((o) => o.value), ['Cinza-Branca', 'Cinza', 'Verde-Preta']);
  assert.match(dom.$('f-data_matricula').value, /^\d{4}-\d{2}-\d{2}$/);
});

test('Recepção: campos sensíveis escondidos e nunca enviados', () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate(RECEPCAO);
  assert.ok(dom.$('box-cpf').hidden && dom.$('box-restricoes_medicas').hidden);
  fill({ nome_completo: 'Paula Ficticia', data_nascimento: '1990-01-01', cpf: '52998224725', restricoes_medicas: 'x' });
  dom.submit('student-form');
  const payload = fake.last().args[0];
  assert.equal(fake.last().acao, 'alunos.criar');
  assert.ok(!('cpf' in payload) && !('restricoes_medicas' in payload));
  assert.equal(payload.nome_completo, 'Paula Ficticia');
});

test('Gestor: campos sensíveis visíveis e enviados', () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate(GESTOR);
  assert.ok(dom.$('box-cpf').hidden === false && dom.$('box-restricoes_medicas').hidden === false);
  fill({ nome_completo: 'Paula Ficticia', data_nascimento: '1990-01-01', cpf: '52998224725' });
  dom.submit('student-form');
  assert.equal(fake.last().args[0].cpf, '52998224725');
  assert.ok(!('confirmarDuplicidade' in fake.last().args[0]));
});

test('envio duplo: o segundo clique é ignorado e o botão fica desabilitado', () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate();
  fill({ nome_completo: 'Paula Ficticia', data_nascimento: '1990-01-01' });
  dom.submit('student-form');
  assert.equal(dom.$('form-submit').disabled, true);
  dom.submit('student-form');
  assert.equal(fake.byAcao('alunos.criar').length, 1);
});

test('erro de validação: mensagens por campo, formulário preservado e botão liberado', async () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate();
  fill({ nome_completo: 'Al', data_nascimento: '1990-01-01' });
  dom.submit('student-form');
  await fake.resolve(failEnv('VALIDACAO', 'Dados inválidos.', [
    { campo: 'nome_completo', mensagem: 'Informe ao menos 3 caracteres.' }, { campo: '_', mensagem: 'Campo não reconhecido.' }]));
  assert.equal(dom.$('e-nome_completo').textContent, 'Informe ao menos 3 caracteres.');
  assert.equal(dom.$('e-nome_completo').hidden, false);
  assert.equal(dom.$('f-nome_completo').getAttribute('aria-invalid'), 'true');
  assert.equal(dom.$('f-nome_completo').value, 'Al');
  assert.ok(dom.$('form-summary').textContent.includes('Campo não reconhecido.'));
  assert.equal(dom.$('form-summary').hidden, false);
  assert.ok(dom.$('form-summary').focused > 0);
  assert.equal(dom.$('form-submit').disabled, false);
  // reenvio limpa os erros anteriores
  dom.submit('student-form');
  assert.equal(dom.$('e-nome_completo').hidden, true);
  assert.equal(dom.$('f-nome_completo').getAttribute('aria-invalid'), null);
});

test('duplicidade: Gestor vê a confirmação e reenvia com confirmarDuplicidade', async () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate(GESTOR);
  fill({ nome_completo: 'Ana Ficticia', data_nascimento: '2015-03-15' });
  dom.submit('student-form');
  await fake.resolve(failEnv('CONFLITO', 'Já existe um cadastro com estes dados.', [{ campo: 'confirmarDuplicidade', mensagem: 'Confirme para cadastrar mesmo assim.' }]));
  assert.equal(dom.$('confirm-box').hidden, false);
  assert.equal(dom.$('e-confirmarDuplicidade').hidden, false);
  dom.$('f-confirmarDuplicidade').checked = true;
  dom.submit('student-form');
  assert.equal(fake.last().args[0].confirmarDuplicidade, true);
});

test('duplicidade: Recepção não recebe a opção de confirmar', async () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate(RECEPCAO);
  fill({ nome_completo: 'Ana Ficticia', data_nascimento: '2015-03-15' });
  dom.submit('student-form');
  await fake.resolve(failEnv('CONFLITO', 'Já existe um cadastro com estes dados.', [{ campo: 'confirmarDuplicidade', mensagem: 'Procure um gestor.' }]));
  assert.equal(dom.$('confirm-box').hidden, true);
  assert.equal(dom.$('e-confirmarDuplicidade').textContent, 'Procure um gestor.');
});

test('falha de rede ao cadastrar: formulário e dados preservados, sem perder o que foi digitado', async () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate();
  fill({ nome_completo: 'Paula Ficticia', data_nascimento: '1990-01-01' });
  dom.submit('student-form');
  await fake.reject(transportError('network'));
  assert.equal(dom.$('f-nome_completo').value, 'Paula Ficticia');
  assert.equal(dom.$('form-submit').disabled, false);
  assert.ok(dom.$('form-summary').textContent.includes('continuam no formulário'));
});

test('timeout ao cadastrar: avisa que o cadastro pode ter sido feito', async () => {
  const { dom, fake, fill, startCreate } = setup();
  startCreate();
  fill({ nome_completo: 'Paula Ficticia', data_nascimento: '1990-01-01' });
  dom.submit('student-form');
  await fake.reject(transportError('timeout'));
  assert.ok(dom.$('form-summary').textContent.includes('pode ter sido feito'));
  assert.equal(dom.$('form-submit').disabled, false);
});

test('edição: formulário preenchido com os dados atuais (datas em ISO) e status = atual + transições permitidas', () => {
  const { dom, startEdit } = setup();
  startEdit();
  assert.equal(dom.$('form-title').textContent, 'Editar aluno');
  assert.equal(dom.$('form-submit').textContent, 'Salvar alterações');
  assert.equal(dom.$('f-nome_completo').value, 'Bruno Ficticio');
  assert.equal(dom.$('f-data_nascimento').value, '1990-08-22');
  assert.equal(dom.$('f-data_matricula').value, '2026-02-01');
  assert.equal(dom.$('f-graus').value, '2');
  assert.equal(dom.$('f-faixa').value, 'Azul');
  assert.equal(dom.$('f-cpf').value, '111.444.777-35');
  assert.deepEqual(dom.$('f-status').options.map((o) => o.value), ['Ativo', 'Trancado', 'Inativo']);
  EDIT_ALL.concat(['status']).forEach((f) => assert.equal(dom.$('f-' + f).disabled, false, f));
});

test('edição (Recepção): campos não editáveis ficam desabilitados e os sensíveis escondidos', () => {
  const { dom, startEdit } = setup();
  startEdit(RECEPCAO, EDICAO_RECEPCAO);
  ['cpf', 'restricoes_medicas', 'faixa', 'graus', 'status'].forEach((f) => assert.equal(dom.$('f-' + f).disabled, true, f));
  ['nome_completo', 'telefone', 'observacoes'].forEach((f) => assert.equal(dom.$('f-' + f).disabled, false, f));
  assert.ok(dom.$('box-cpf').hidden && dom.$('box-restricoes_medicas').hidden);
});

test('edição: envia apenas os campos alterados, com a versão, e só o que está habilitado', () => {
  const { dom, fake, fill, startEdit } = setup();
  startEdit();
  fill({ nome_completo: 'Bruno Ficticio Silva', telefone: '11955554444' });
  dom.submit('student-form');
  assert.equal(fake.last().acao, 'alunos.atualizar');
  assert.deepEqual(fake.last().args, ['ALU-9', { versao: 'V1', campos: { nome_completo: 'Bruno Ficticio Silva', telefone: '11955554444' } }]);
  assert.equal(dom.$('form-submit').disabled, true);
});

test('edição (Recepção): campo desabilitado nunca é enviado, mesmo se alterado no DOM', () => {
  const { dom, fake, fill, startEdit } = setup();
  startEdit(RECEPCAO, EDICAO_RECEPCAO);
  fill({ cpf: '52998224725', faixa: 'Roxa', observacoes: 'Outra nota' });
  dom.submit('student-form');
  assert.deepEqual(fake.last().args[1].campos, { observacoes: 'Outra nota' });
});

test('edição: sem alterações não chama o servidor', () => {
  const { dom, fake, startEdit } = setup();
  startEdit();
  dom.submit('student-form');
  assert.equal(fake.calls.length, 0);
  assert.equal(dom.$('form-summary').hidden, false);
  assert.equal(dom.$('form-summary').textContent, 'Nenhuma alteração para salvar.');
});

test('edição: mudança de status enviada quando escolhida', () => {
  const { dom, fake, fill, startEdit } = setup();
  startEdit();
  fill({ status: 'Inativo' });
  dom.submit('student-form');
  assert.deepEqual(fake.last().args[1].campos, { status: 'Inativo' });
});

test('edição: erros por campo do servidor, formulário e digitação preservados', async () => {
  const { dom, fake, fill, startEdit } = setup();
  startEdit();
  fill({ telefone: '123' });
  dom.submit('student-form');
  await fake.resolve(failEnv('VALIDACAO', 'Dados inválidos.', [{ campo: 'telefone', mensagem: 'Telefone inválido. Informe DDD e número.' }]));
  assert.equal(dom.$('e-telefone').textContent, 'Telefone inválido. Informe DDD e número.');
  assert.equal(dom.$('f-telefone').getAttribute('aria-invalid'), 'true');
  assert.equal(dom.$('f-telefone').value, '123');
  assert.equal(dom.$('form-submit').disabled, false);
  assert.equal(dom.$('form-reload').hidden, true);
});

test('edição: versão desatualizada avisa e oferece recarregar o cadastro', async () => {
  const { dom, fake, events, fill, startEdit } = setup();
  startEdit();
  fill({ nome_social: 'Bru' });
  dom.submit('student-form');
  await fake.resolve(failEnv('VERSAO_DESATUALIZADA', 'Este cadastro foi alterado por outra pessoa. Recarregue os dados e refaça a alteração.'));
  assert.equal(dom.$('form-reload').hidden, false);
  assert.ok(dom.$('form-summary').textContent.includes('alterado por outra pessoa'));
  assert.ok(!dom.$('form-summary').textContent.includes('código de referência'));
  dom.click('form-reload');
  assert.deepEqual(events, [['reload', 'ALU-9']]);
});

test('edição: duplicidade pede confirmação ao Gestor e reenvia com confirmarDuplicidade', async () => {
  const { dom, fake, fill, startEdit } = setup();
  startEdit();
  fill({ nome_completo: 'Ana Ficticia' });
  dom.submit('student-form');
  await fake.resolve(failEnv('CONFLITO', 'Já existe um cadastro com estes dados.', [{ campo: 'confirmarDuplicidade', mensagem: 'Confirme para salvar mesmo assim.' }]));
  assert.equal(dom.$('confirm-box').hidden, false);
  dom.$('f-confirmarDuplicidade').checked = true;
  dom.submit('student-form');
  assert.equal(fake.last().args[1].confirmarDuplicidade, true);
  assert.deepEqual(fake.last().args[1].campos, { nome_completo: 'Ana Ficticia' });
});

test('edição: envio duplo é ignorado', () => {
  const { dom, fake, fill, startEdit } = setup();
  startEdit();
  fill({ nome_social: 'Bru' });
  dom.submit('student-form');
  dom.submit('student-form');
  assert.equal(fake.byAcao('alunos.atualizar').length, 1);
});

test('edição: falha de rede e timeout preservam o formulário e explicam', async () => {
  const a = setup();
  a.startEdit();
  a.fill({ nome_social: 'Bru' });
  a.dom.submit('student-form');
  await a.fake.reject(transportError('network'));
  assert.equal(a.dom.$('f-nome_social').value, 'Bru');
  assert.equal(a.dom.$('form-submit').disabled, false);

  const b = setup();
  b.startEdit();
  b.fill({ nome_social: 'Bru' });
  b.dom.submit('student-form');
  await b.fake.reject(transportError('timeout'));
  assert.ok(b.dom.$('form-summary').textContent.includes('A alteração pode ter sido feita'));
});

test('edição: valores antigos fora da lista (faixa) e status vazio não se perdem nem são enviados', () => {
  const { dom, fake, fill, startEdit } = setup();
  startEdit(GESTOR, EDICAO_GESTOR, { faixa: 'Xpto', status: '' });
  assert.ok(dom.$('f-faixa').options.some((o) => o.value === 'Xpto' && o.textContent.includes('fora da lista')));
  assert.equal(dom.$('f-faixa').value, 'Xpto');
  assert.equal(dom.$('f-status').options[0].textContent, '(sem status)');
  fill({ nome_social: 'Bru' });
  dom.submit('student-form');
  assert.deepEqual(fake.last().args[1].campos, { nome_social: 'Bru' });
});
