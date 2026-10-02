import test from 'node:test';
import assert from 'node:assert/strict';
import { createDom, flush } from './helpers/dom-env.js';
import { createFakeApi, okEnv, failEnv, transportError } from './helpers/fake-api.js';
import { createStudentForm } from '../js/student-form.js';
import { createStudents } from '../js/students.js';
import { createDataTable } from '../js/data-table.js';

const PARTS = ['students-loading', 'students-error', 'students-empty', 'students-ready', 'student-detail', 'student-form-section'];
const OPCOES = {
  statusCriacao: ['Experimental', 'Ativo', 'Trancado', 'Inativo'],
  faixas: { adulto: ['Branca', 'Azul', 'Roxa', 'Marrom', 'Preta'], infantil: ['Branca', 'Cinza-Branca', 'Cinza', 'Verde-Preta'] },
};
const GESTOR = { criar: true, editarSensivel: true, confirmarDuplicidade: true };
const RECEPCAO = { criar: true, editarSensivel: false, confirmarDuplicidade: false };
const SOMENTE_LEITURA = { criar: false, editarSensivel: false, confirmarDuplicidade: false };
const ANA = { student_id: 'ALU-1', nome_completo: 'Ana Ficticia', nome_social: '', status: 'Ativo', faixa: 'Cinza', idade: 11 };
const listData = (perm, itens = [ANA]) => ({
  itens, total: itens.length, totalGeral: itens.length, porStatus: [],
  statusDisponiveis: ['Experimental', 'Ativo', 'Trancado', 'Inativo'], permissoes: perm, opcoes: OPCOES,
});

const EDIT_ALL = ['nome_completo', 'nome_social', 'data_nascimento', 'data_matricula', 'telefone', 'email', 'contato_emergencia',
  'telefone_emergencia', 'observacoes', 'cpf', 'restricoes_medicas', 'faixa', 'graus'];
const EDICAO_GESTOR = { podeEditar: true, campos: EDIT_ALL, statusPermitidos: ['Trancado', 'Inativo'], confirmarDuplicidade: true };
const EDICAO_RECEPCAO = {
  podeEditar: true, statusPermitidos: [], confirmarDuplicidade: false,
  campos: ['nome_completo', 'nome_social', 'data_nascimento', 'data_matricula', 'telefone', 'email', 'contato_emergencia', 'telefone_emergencia', 'observacoes'],
};
const EDICAO_NENHUMA = { podeEditar: false, campos: [], statusPermitidos: [], confirmarDuplicidade: false };
const PAULA = { student_id: 'ALU-9', nome_completo: 'Paula Ficticia', nome_social: '', status: 'Experimental', faixa: 'Branca', graus: 0, idade: 34, cpf: '111.444.777-35' };
const detailData = (aluno = PAULA, edicao = EDICAO_NENHUMA, versao = 'v1') => ({
  aluno, versao, permissoes: { contato: true, cpf: 'completo', medico: true, observacoes: true }, avisos: [], edicao,
});
const bruno = (extra = {}) => ({
  student_id: 'ALU-9', nome_completo: 'Bruno Ficticio', nome_social: '', data_matricula: '01/02/2026', status: 'Ativo', faixa: 'Azul', graus: 2,
  turma_principal_id: '', updated_at: '01/02/2026', idade: 36, categoria: 'adulto', data_nascimento: '22/08/1990',
  telefone: '(11) 91234-5678', email: 'b@example.com', contato_emergencia: 'Contato', telefone_emergencia: '(11) 98888-7777',
  cpf: '111.444.777-35', restricoes_medicas: 'Asma', observacoes: 'Nota', ...extra,
});

function setup() {
  const dom = createDom();
  const fake = createFakeApi();
  const authFailures = [];
  const students = createStudents({
    doc: dom.doc, api: fake.api, createForm: createStudentForm, onAuthFailure: (code) => authFailures.push(code),
  });
  const fill = (values) => Object.keys(values).forEach((k) => { dom.$('f-' + k).value = values[k]; });
  const clickRow = () => dom.$('students-list').children[0].children[0].listeners.click();
  return { dom, fake, students, authFailures, fill, clickRow };
}
async function openList(perm = GESTOR, itens) {
  const ctx = setup();
  ctx.students.activate();
  await ctx.fake.resolve(okEnv(listData(perm, itens)));
  return ctx;
}
async function openDetailUi(perm, edicao, extra) {
  const ctx = await openList(perm);
  ctx.clickRow();
  await ctx.fake.resolve(okEnv(detailData(bruno(extra), edicao)));
  return ctx;
}
async function startEdit(perm = GESTOR, edicao = EDICAO_GESTOR, extra) {
  const ctx = await openDetailUi(perm, edicao, extra);
  ctx.dom.click('detail-edit');
  return ctx;
}

// ---------- novos (comportamento do portal) ----------
test('reset: some tudo do usuário anterior (lista, detalhe com CPF, formulário digitado, filtros) e volta a "Carregando"', async () => {
  const { dom, fake, students } = await openList();
  dom.$('students-q').value = 'ana';
  dom.click('students-new');
  dom.$('f-nome_completo').value = 'Digitado Ficticio';
  dom.$('f-cpf').value = '111.444.777-35';
  students.reset();
  assert.equal(dom.$('students-list').children.length, 0);
  assert.equal(dom.$('students-count').textContent, '');
  assert.equal(dom.$('detail-name').textContent, '');
  assert.equal(dom.$('detail-fields').children.length, 0);
  assert.equal(dom.$('students-q').value, '');
  assert.equal(dom.$('f-nome_completo').value, '');
  assert.equal(dom.$('f-cpf').value, '');
  assert.equal(dom.$('students-new').hidden, true);
  assert.deepEqual(dom.visible(PARTS), ['students-loading']);
  assert.equal(fake.calls.length, 1);
});

test('reset apaga o detalhe aberto (nome, campos com CPF e aviso)', async () => {
  const { dom, students } = await openDetailUi(GESTOR, EDICAO_NENHUMA);
  assert.ok(dom.$('detail-fields').children.length > 0);
  students.reset();
  assert.equal(dom.$('detail-name').textContent, '');
  assert.equal(dom.$('detail-fields').children.length, 0);
  assert.equal(dom.$('detail-edit').hidden, true);
});

test('reset invalida a lista que ainda não chegou: resposta tardia não renderiza', async () => {
  const { dom, fake, students } = setup();
  students.activate();
  students.reset();
  await fake.resolve(okEnv(listData(GESTOR)));
  assert.equal(dom.$('students-list').children.length, 0);
  assert.deepEqual(dom.visible(PARTS), ['students-loading']);
});

test('depois do reset, activate carrega a lista de novo (outro usuário)', async () => {
  const { fake, students } = await openList();
  students.reset();
  students.activate();
  assert.equal(fake.byAcao('alunos.listar').length, 2);
});

test('activate repetido não recarrega a lista', async () => {
  const { fake, students } = await openList();
  students.activate();
  students.activate();
  assert.equal(fake.byAcao('alunos.listar').length, 1);
});

test('requisições sobrepostas: só a mais nova renderiza', async () => {
  const { dom, fake, students } = setup();
  students.activate();
  const first = fake.last();
  dom.submit('students-filter'); // segunda lista
  const second = fake.last();
  await fake.resolve(okEnv(listData(GESTOR, [{ ...ANA, nome_completo: 'Segunda Ficticia' }])), second);
  await fake.resolve(okEnv(listData(GESTOR, [{ ...ANA, nome_completo: 'Primeira Ficticia' }])), first);
  assert.equal(dom.$('students-list').children[0].children[0].children[0].textContent, 'Segunda Ficticia');
});

test('NAO_AUTENTICADO ou ACESSO_NEGADO em lista e detalhe: avisa o app uma vez, sem mostrar erro de tela', async () => {
  for (const code of ['NAO_AUTENTICADO', 'ACESSO_NEGADO']) {
    const a = setup();
    a.students.activate();
    await a.fake.resolve(failEnv(code));
    assert.deepEqual(a.authFailures, [code]);

    const b = await openList();
    b.clickRow();
    await b.fake.resolve(failEnv(code));
    assert.deepEqual(b.authFailures, [code]);
  }
});

test('lista com data malformada (sem itens/opcoes) vira erro recuperável com "Tentar novamente"', async () => {
  const { dom, fake, students } = setup();
  students.activate();
  await fake.resolve(okEnv({}));
  assert.deepEqual(dom.visible(PARTS), ['students-error']);
  assert.match(dom.$('students-error-msg').textContent, /não foi possível exibir/i);
  dom.click('students-retry');
  assert.equal(fake.byAcao('alunos.listar').length, 2);
  await fake.resolve(okEnv(listData(GESTOR)));
  assert.deepEqual(dom.visible(PARTS), ['students-ready']);
});

test('detalhe com data malformada (sem aluno) vira erro recuperável', async () => {
  const { dom, fake, clickRow } = await openList();
  clickRow();
  await fake.resolve(okEnv({}));
  assert.deepEqual(dom.visible(PARTS), ['students-error']);
});

test('falha de transporte na lista mostra a mensagem do transporte e permite tentar de novo', async () => {
  const { dom, fake, students } = setup();
  students.activate();
  await fake.reject(transportError('timeout'));
  assert.deepEqual(dom.visible(PARTS), ['students-error']);
  assert.ok(dom.$('students-error-msg').textContent.length > 0);
  assert.ok(dom.$('students-retry').focused > 0);
});

test('texto de aluno entra por textContent: marcação digitada vira texto, nunca elemento', async () => {
  const { dom } = await openList(GESTOR, [{ ...ANA, nome_completo: '<img src=x onerror=alert(1)>' }]);
  const btn = dom.$('students-list').children[0].children[0];
  assert.equal(btn.children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(btn.children.length, 2); // só os dois spans criados pelo código
});

test('cancelar com salvamento pendente: a resposta tardia não sobrescreve a navegação mais nova e a lista é recarregada', async () => {
  const { dom, fake, fill } = await startEdit();
  fill({ nome_social: 'Bru' });
  dom.submit('student-form');
  const save = fake.last();
  dom.click('form-cancel'); // volta ao detalhe
  dom.click('detail-back'); // pode ter gravado: a lista precisa ser recarregada
  assert.equal(fake.byAcao('alunos.listar').length, 2);
  await fake.resolve(okEnv(listData(GESTOR, [{ ...ANA, nome_completo: 'Segunda Ficticia' }])));
  await fake.resolve(okEnv(detailData(bruno({ nome_social: 'Bru' }), EDICAO_GESTOR, 'V2')), save);
  assert.deepEqual(dom.visible(PARTS), ['students-ready']);
  assert.equal(dom.$('detail-notice').hidden, true);
});

test('recarregar o cadastro com salvamento pendente: a resposta tardia do salvamento é ignorada', async () => {
  const { dom, fake, fill } = await startEdit();
  fill({ nome_social: 'Bru' });
  dom.submit('student-form');
  const save = fake.last();
  dom.click('form-reload'); // só aparece após erro de versão, mas o clique deve ser seguro a qualquer momento
  await fake.resolve(okEnv(detailData(bruno({ nome_social: 'Novo' }), EDICAO_GESTOR, 'V9')));
  await fake.resolve(okEnv(detailData(bruno({ nome_social: 'Velho' }), EDICAO_GESTOR, 'V2')), save);
  assert.equal(dom.$('detail-name').textContent, 'Novo (Bruno Ficticio)');
});

test('reset e nova lista trocam as opções de status do filtro (nada do usuário anterior no DOM)', async () => {
  const { dom, fake, students } = setup();
  students.activate();
  await fake.resolve(okEnv({ ...listData(GESTOR), statusDisponiveis: ['Ativo', 'Suspenso'] }));
  assert.deepEqual(dom.$('students-status').options.map((o) => o.value), ['', 'Ativo', 'Suspenso']);
  students.reset();
  assert.deepEqual(dom.$('students-status').options.map((o) => o.value), ['']);
  students.activate();
  await fake.resolve(okEnv({ ...listData(GESTOR), statusDisponiveis: ['Ativo'] }));
  assert.deepEqual(dom.$('students-status').options.map((o) => o.value), ['', 'Ativo']);
});

test('lista com opcoes incompletas vira erro recuperável (Novo aluno nunca fica quebrado)', async () => {
  for (const opcoes of [{}, { statusCriacao: ['Ativo'] }, { statusCriacao: 'Ativo', faixas: { adulto: [], infantil: [] } }, { statusCriacao: [], faixas: { adulto: [] } }]) {
    const { dom, fake, students } = setup();
    students.activate();
    await fake.resolve(okEnv({ ...listData(GESTOR), opcoes }));
    assert.deepEqual(dom.visible(PARTS), ['students-error'], JSON.stringify(opcoes));
  }
});

// ---------- portados do app antigo (mesmos nomes) ----------
test('lista: botão Novo aluno só aparece para quem pode criar', async () => {
  assert.equal((await openList(GESTOR)).dom.$('students-new').hidden, false);
  assert.equal((await openList(RECEPCAO)).dom.$('students-new').hidden, false);
  assert.equal((await openList(SOMENTE_LEITURA)).dom.$('students-new').hidden, true);
});

test('lista vazia ainda permite cadastrar o primeiro aluno', async () => {
  const { dom } = await openList(GESTOR, []);
  assert.deepEqual(dom.visible(PARTS), ['students-empty']);
  assert.equal(dom.$('students-new').hidden, false);
});

test('sucesso: mostra o aluno criado com aviso e recarrega a lista ao voltar', async () => {
  const { dom, fake, fill } = await openList(GESTOR);
  dom.click('students-new');
  assert.deepEqual(dom.visible(PARTS), ['student-form-section']);
  fill({ nome_completo: 'Paula Ficticia', data_nascimento: '1990-01-01' });
  dom.submit('student-form');
  await fake.resolve(okEnv(detailData()));
  assert.deepEqual(dom.visible(PARTS), ['student-detail']);
  assert.equal(dom.$('detail-notice').hidden, false);
  assert.equal(dom.$('detail-notice').textContent, 'Aluno cadastrado com sucesso.');
  assert.equal(dom.$('detail-name').textContent, 'Paula Ficticia');
  const before = fake.calls.length;
  dom.click('detail-back');
  assert.equal(fake.calls.length, before + 1);
  assert.equal(fake.last().acao, 'alunos.listar');
});

test('detalhe aberto pela lista não mostra o aviso de cadastro e voltar não recarrega', async () => {
  const { dom, fake, clickRow } = await openList(GESTOR);
  clickRow();
  assert.equal(fake.last().acao, 'alunos.obter');
  await fake.resolve(okEnv(detailData()));
  assert.equal(dom.$('detail-notice').hidden, true);
  const before = fake.calls.length;
  dom.click('detail-back');
  assert.equal(fake.calls.length, before);
  assert.deepEqual(dom.visible(PARTS), ['students-ready']);
});

test('cancelar volta para a lista sem recarregar', async () => {
  const { dom, fake } = await openList(GESTOR);
  dom.click('students-new');
  const before = fake.calls.length;
  dom.click('form-cancel');
  assert.equal(fake.calls.length, before);
  assert.deepEqual(dom.visible(PARTS), ['students-ready']);
});

test('todas as falhas da lista terminam em mensagem visível', async () => {
  const { dom, fake, students } = setup();
  students.activate();
  await fake.reject(transportError('network'));
  assert.deepEqual(dom.visible(PARTS), ['students-error']);
});

test('edição: botão Editar só aparece quando o servidor permite', async () => {
  assert.equal((await openDetailUi(GESTOR, EDICAO_GESTOR)).dom.$('detail-edit').hidden, false);
  assert.equal((await openDetailUi(SOMENTE_LEITURA, EDICAO_NENHUMA)).dom.$('detail-edit').hidden, true);
});

test('edição: sucesso mostra o cadastro atualizado com aviso e recarrega a lista ao voltar', async () => {
  const { dom, fake, fill } = await startEdit();
  assert.deepEqual(dom.visible(PARTS), ['student-form-section']);
  fill({ nome_social: 'Bru' });
  dom.submit('student-form');
  await fake.resolve(okEnv(detailData(bruno({ nome_social: 'Bru' }), EDICAO_GESTOR, 'V2')));
  assert.deepEqual(dom.visible(PARTS), ['student-detail']);
  assert.equal(dom.$('detail-notice').textContent, 'Alterações salvas com sucesso.');
  assert.equal(dom.$('detail-notice').hidden, false);
  assert.equal(dom.$('form-submit').disabled, false);
  const before = fake.calls.length;
  dom.click('detail-back');
  assert.equal(fake.calls.length, before + 1);
  assert.equal(fake.last().acao, 'alunos.listar');
});

test('edição: a nova versão é usada no próximo salvamento', async () => {
  const { dom, fake, fill } = await startEdit();
  fill({ nome_social: 'Bru' });
  dom.submit('student-form');
  await fake.resolve(okEnv(detailData(bruno({ nome_social: 'Bru' }), EDICAO_GESTOR, 'V2')));
  dom.click('detail-edit');
  fill({ nome_social: 'Bruninho' });
  dom.submit('student-form');
  assert.equal(fake.last().args[1].versao, 'V2');
});

test('edição: cancelar volta ao detalhe sem chamar o servidor', async () => {
  const { dom, fake } = await startEdit();
  const before = fake.calls.length;
  dom.click('form-cancel');
  assert.equal(fake.calls.length, before);
  assert.deepEqual(dom.visible(PARTS), ['student-detail']);
});

test('depois de editar, Novo aluno abre um formulário limpo e habilitado', async () => {
  const { dom, fake, fill } = await startEdit(RECEPCAO, EDICAO_RECEPCAO);
  dom.click('form-cancel');
  dom.click('detail-back');
  dom.click('students-new');
  assert.equal(dom.$('form-title').textContent, 'Novo aluno');
  assert.equal(dom.$('form-submit').textContent, 'Cadastrar aluno');
  assert.equal(dom.$('f-nome_completo').value, '');
  ['nome_completo', 'faixa', 'graus', 'status'].forEach((f) => assert.equal(dom.$('f-' + f).disabled, false, f));
  assert.deepEqual(dom.$('f-status').options.map((o) => o.value), OPCOES.statusCriacao);
  fill({ nome_completo: 'Paula Ficticia', data_nascimento: '1990-01-01' });
  dom.submit('student-form');
  assert.equal(fake.last().acao, 'alunos.criar');
});

// ---------- tabela configurável de alunos ----------
const MAIS = [
  { student_id: 'ALU-1', nome_completo: 'Ana Ficticia', nome_social: '', status: 'Ativo', faixa: 'Cinza', graus: 1, idade: 11, categoria: 'infantil', turma_principal_id: '' },
  { student_id: 'ALU-2', nome_completo: 'Bruno Ficticio', nome_social: 'Bru', status: 'Trancado', faixa: 'Azul', graus: 2, idade: 36, categoria: 'adulto', turma_principal_id: 'TUR-1' },
  { student_id: 'ALU-3', nome_completo: 'Carlos Ficticio', nome_social: '', status: 'Ativo', faixa: 'Branca', graus: 0, idade: 41, categoria: 'adulto', turma_principal_id: '' },
];
async function tableUi() {
  const dom = createDom();
  const fake = createFakeApi();
  const createTable = (opts) => createDataTable({ doc: dom.doc, storage: null, download() {}, ...opts });
  const students = createStudents({ doc: dom.doc, api: fake.api, createForm: createStudentForm, onAuthFailure: () => {}, createTable });
  students.activate();
  await fake.resolve(okEnv(listData(GESTOR, MAIS)));
  const root = dom.$('students-table-root');
  const tbl = () => root.children[2].children[0];
  const names = () => tbl().children[1].children.map((tr) => tr.children[0].children[0].textContent);
  const heads = () => tbl().children[0].children[0].children.map((th) => (th.children[0] ? th.children[0].textContent : th.textContent).replace(/ [▲▼]$/, ''));
  return { dom, fake, students, root, tbl, names, heads };
}

test('alunos: alternar Lista ⇄ Tabela, com colunas escolhíveis e nome social ao lado do nome', async () => {
  const s = await tableUi();
  assert.equal(s.dom.$('students-views').hidden, false);
  assert.equal(s.dom.$('students-list').hidden, false);
  s.dom.click('students-view-table');
  assert.equal(s.dom.$('students-list').hidden, true);
  assert.equal(s.dom.$('students-table-root').hidden, false);
  assert.equal(s.dom.$('students-view-table').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(s.heads(), ['Aluno', 'Status', 'Faixa', 'Graus', 'Idade', 'Categoria', 'Ações']);
  assert.deepEqual(s.names(), ['Ana Ficticia', 'Bruno Ficticio (Bru)', 'Carlos Ficticio']);
  s.dom.click('students-view-list');
  assert.equal(s.dom.$('students-list').hidden, false);
});

test('alunos: filtros por coluna (lista, faixa numérica) e ordenação na tabela', async () => {
  const s = await tableUi();
  s.dom.click('students-view-table');
  const filters = () => s.tbl().children[0].children[1].children;
  filters()[1].children[0].value = 'Ativo';
  filters()[1].children[0].listeners.change();
  assert.deepEqual(s.names(), ['Ana Ficticia', 'Carlos Ficticio']);
  filters()[4].children[0].children[0].value = '18';
  filters()[4].children[0].children[0].listeners.input();
  assert.deepEqual(s.names(), ['Carlos Ficticio'], 'adultos ativos');
  s.tbl().children[0].children[0].children[4].children[0].listeners.click(); // idade: começa do maior
  s.root.children[0].children.find((b) => b.textContent === 'Limpar filtros').listeners.click();
  assert.deepEqual(s.names(), ['Carlos Ficticio', 'Bruno Ficticio (Bru)', 'Ana Ficticia']);
});

test('alunos: o nome e o botão da tabela abrem o detalhe do aluno', async () => {
  const s = await tableUi();
  s.dom.click('students-view-table');
  s.tbl().children[1].children[1].children[0].children[0].listeners.click();
  await flush();
  assert.equal(s.fake.last().acao, 'alunos.obter');
  assert.deepEqual(s.fake.last().args, ['ALU-2']);
  await s.fake.resolve(okEnv(detailData(bruno(), EDICAO_NENHUMA)));
  assert.equal(s.dom.$('student-detail').hidden, false);
});

test('alunos: sem createTable não há alternância; reset volta à lista e limpa a tabela', async () => {
  const plain = await openList(GESTOR, MAIS);
  assert.equal(plain.dom.$('students-views').hidden, true);
  const s = await tableUi();
  s.dom.click('students-view-table');
  s.students.reset();
  assert.equal(s.dom.$('students-table-root').hidden, true);
  assert.equal(s.tbl().children[1].children.length, 0);
  assert.equal(s.dom.$('students-view-list').getAttribute('aria-pressed'), 'true');
});
