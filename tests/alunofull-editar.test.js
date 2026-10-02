import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlunoFull } from '../js/alunofull.js';
import { createDataTable } from '../js/data-table.js';
import { createDom, flush } from './helpers/dom-env.js';

const PARTS = ['af-loading', 'af-error', 'af-empty', 'af-ready'];
const ok = (data) => ({ ok: true, data, error: null, correlationId: 'c1' });
const fail = (code, message, fields) => ({ ok: false, data: null, error: fields ? { code, message, fields } : { code, message }, correlationId: 'c2' });

const mat = (over = {}) => ({ enrollment_id: 'MAT-1', plan_id: 'PLA-1', plano: 'Custom', valor: 200, dia_vencimento: 10, status: 'Ativa', pago_ate: '', tipo_isencao: '', versao: 'v-mat', ...over });
const aluno = (id, nome, over = {}) => ({ student_id: id, nome, status: 'Ativo', faixa: 'Branca', graus: 0, familia_id: null, papel: 'sem_responsavel', responsaveis: [], matricula: mat(), pendentes: 0, vencidas: 0, valorPendente: 0, versaoFamilia: 'vf-' + id, ...over });
const DATA = (over = {}) => ({
  familias: [
    { guardian_id: 'RES-1', tipo: 'aluno', aluno_id: 'ALU-1', nome: 'Bruno Ficticio', membros: ['ALU-1', 'ALU-2'], resumo: { alunos: 2, mensal: 350, pendentes: 0, vencidas: 0, valorPendente: 0 } },
    { guardian_id: 'RES-2', tipo: 'externo', aluno_id: null, nome: 'Carla Externa', membros: [], resumo: { alunos: 0, mensal: 0, pendentes: 0, vencidas: 0, valorPendente: 0 } },
  ],
  alunos: [
    aluno('ALU-1', 'Bruno Ficticio', { familia_id: 'RES-1', papel: 'responsavel' }),
    aluno('ALU-2', 'Ana Ficticia', { familia_id: 'RES-1', papel: 'dependente', matricula: mat({ valor: 150, pago_ate: '2027-01' }) }),
    aluno('ALU-3', 'Daniela Solta', { matricula: null }),
    aluno('ALU-4', 'Elias Solto'),
  ],
  semResponsavel: ['ALU-3', 'ALU-4'],
  planos: [{ plan_id: 'PLA-1', nome: 'Custom', valor_padrao: 200, status: 'Ativo' }, { plan_id: 'PLA-0', nome: 'Antigo', valor_padrao: 100, status: 'Inativo' }],
  opcoes: { isencoes: ['Assistente', 'Bolsa / cortesia'] }, permissoes: { editar: true }, avisos: [], total: 4, ...over,
});

const texts = (node) => [node._t, ...(node.children || []).flatMap(texts)].filter(Boolean);
const allText = (node) => texts(node).join(' | ').replace(/\s/g, ' ');
const optionValues = (sel) => sel.options.map((o) => o.value);

function setup(respond = () => ok(DATA()), { withTable = false } = {}) {
  const dom = createDom();
  const calls = [];
  const auth = [];
  const opened = [];
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(acao, args, calls.length); } };
  const createTable = withTable ? (opts) => createDataTable({ doc: dom.doc, storage: null, download: () => {}, ...opts }) : null;
  const af = createAlunoFull({ doc: dom.doc, api, onAuthFailure: (c) => auth.push(c), createTable, openStudent: (id) => opened.push(id) });
  const nameButton = (nome) => {
    const found = [];
    const walk = (n) => { if (n.tag === 'button' && n._t === nome) found.push(n); (n.children || []).forEach(walk); };
    walk(dom.$('af-groups'));
    return found[0];
  };
  const open = async (nome) => { af.activate(); await flush(); const b = nameButton(nome); b.listeners.click(); return b; };
  const submit = async () => { dom.submit('af-form'); await flush(); };
  return { dom, calls, auth, opened, af, nameButton, open, submit };
}
const mutations = (calls) => calls.filter((c) => c.acao !== 'alunofull.listar');

test('com permissão de edição os nomes viram botões; sem ela continuam texto', async () => {
  const a = setup();
  a.af.activate();
  await flush();
  const b = a.nameButton('Ana Ficticia');
  assert.ok(b);
  assert.equal(b.getAttribute('aria-label'), 'Editar Ana Ficticia');
  const b2 = setup(() => ok(DATA({ permissoes: { editar: false } })));
  b2.af.activate();
  await flush();
  assert.equal(b2.nameButton('Ana Ficticia'), undefined);
});

test('abrir o painel: mostra o aluno, a situação de hoje, preenche os campos e isola o fundo', async () => {
  const { dom, open } = setup();
  const opener = await open('Ana Ficticia');
  assert.equal(dom.$('af-dialog').hidden, false);
  assert.equal(dom.$('af-inner').inert, true);
  assert.equal(dom.$('af-dialog-title').textContent, 'Ana Ficticia');
  assert.equal(dom.$('af-dialog-info').textContent, 'Hoje: dependente de Bruno Ficticio');
  assert.equal(dom.$('af-f-modo').value, 'aluno');
  assert.equal(dom.$('af-f-aluno').value, 'ALU-1');
  assert.equal(dom.$('af-f-valor').value, '150');
  assert.equal(dom.$('af-f-dia').value, '10');
  assert.equal(dom.$('af-f-plano').value, 'PLA-1');
  assert.equal(dom.$('af-f-pago').value, '2027-01');
  assert.deepEqual(optionValues(dom.$('af-f-plano')), ['PLA-1'], 'plano inativo não é oferecido');
  assert.deepEqual(optionValues(dom.$('af-f-isencao')), ['', 'Assistente', 'Bolsa / cortesia']);
  assert.ok(dom.$('af-f-modo').focused > 0);
  assert.match(dom.$('af-dialog-hint').textContent, /as já geradas não mudam/);
  assert.ok(opener);
});

test('Escape, Fechar e o fundo fecham o painel, devolvem o foco e liberam a tela', async () => {
  const { dom, open } = setup();
  for (const how of ['escape', 'fechar', 'fundo']) {
    const opener = await open('Ana Ficticia');
    const before = opener.focused;
    if (how === 'escape') (dom.docListeners.keydown || []).forEach((fn) => fn({ key: 'Escape' }));
    if (how === 'fechar') dom.click('af-cancel');
    if (how === 'fundo') dom.click('af-dialog-backdrop');
    assert.equal(dom.$('af-dialog').hidden, true, how);
    assert.equal(dom.$('af-inner').inert, false, how);
    assert.equal(opener.focused, before + 1, how);
  }
});

test('só os candidatos certos aparecem como aluno responsável (sem o próprio aluno e sem dependentes), com busca', async () => {
  const { dom, open } = setup();
  await open('Daniela Solta');
  dom.$('af-f-modo').value = 'aluno';
  dom.$('af-f-modo').listeners.change();
  assert.equal(dom.$('af-f-aluno-box').hidden, false);
  assert.deepEqual(optionValues(dom.$('af-f-aluno')), ['', 'ALU-1', 'ALU-4'], 'Daniela e a dependente Ana ficam de fora');
  dom.$('af-f-aluno-q').value = 'ELI';
  dom.$('af-f-aluno-q').listeners.input();
  assert.deepEqual(optionValues(dom.$('af-f-aluno')), ['', 'ALU-4']);
});

test('salvar só o valor chama salvarMatricula com a versão da matrícula e fecha com aviso; a lista é redesenhada', async () => {
  const updated = DATA();
  updated.alunos[1] = aluno('ALU-2', 'Ana Ficticia', { familia_id: 'RES-1', papel: 'dependente', matricula: mat({ valor: 180, pago_ate: '2027-01', versao: 'v-nova' }) });
  const { dom, calls, open, submit } = setup((acao) => (acao === 'alunofull.salvarMatricula' ? ok({ ...updated, salvo: 'ALU-2' }) : ok(DATA())));
  await open('Ana Ficticia');
  dom.$('af-f-valor').value = '180,00';
  await submit();
  assert.deepEqual(mutations(calls), [{ acao: 'alunofull.salvarMatricula', args: ['ALU-2', { versao: 'v-mat', plan_id: 'PLA-1', valor: 180, dia_vencimento: 10, tipo_isencao: '', pago_ate: '2027-01' }] }]);
  assert.equal(dom.$('af-dialog').hidden, true);
  assert.equal(dom.$('af-inner').inert, false);
  assert.equal(dom.$('af-notice').textContent, 'Alterações salvas.');
  assert.equal(dom.$('af-notice').hidden, false);
  assert.match(allText(dom.$('af-groups')), /R\$\s180,00/);
});

test('trocar o responsável chama definirResponsavel com a versão da família', async () => {
  const { dom, calls, open, submit } = setup();
  await open('Elias Solto');
  dom.$('af-f-modo').value = 'proprio';
  dom.$('af-f-modo').listeners.change();
  await submit();
  assert.deepEqual(mutations(calls), [{ acao: 'alunofull.definirResponsavel', args: ['ALU-4', { versao: 'vf-ALU-4', modo: 'proprio' }] }]);
  const b = setup();
  await b.open('Elias Solto');
  b.dom.$('af-f-modo').value = 'aluno';
  b.dom.$('af-f-modo').listeners.change();
  b.dom.$('af-f-aluno').value = 'ALU-1';
  b.dom.$('af-f-parent').value = 'Filho';
  await b.submit();
  assert.deepEqual(mutations(b.calls)[0].args[1], { versao: 'vf-ALU-4', modo: 'aluno', responsavel_aluno_id: 'ALU-1', parentesco: 'Filho' });
});

test('aluno como responsável exige a escolha; responsável externo novo exige o nome e envia os dados', async () => {
  const { dom, calls, open, submit } = setup();
  await open('Elias Solto');
  dom.$('af-f-modo').value = 'aluno';
  dom.$('af-f-modo').listeners.change();
  await submit();
  assert.equal(mutations(calls).length, 0);
  assert.equal(dom.$('af-dialog-error').hidden, false);
  assert.match(dom.$('af-dialog-error').textContent, /Escolha o aluno responsável/);

  dom.$('af-f-modo').value = 'externo';
  dom.$('af-f-modo').listeners.change();
  dom.$('af-f-ext').value = '__novo';
  dom.$('af-f-ext').listeners.change();
  assert.equal(dom.$('af-f-novo-box').hidden, false);
  await submit();
  assert.match(dom.$('af-dialog-error').textContent, /nome do novo responsável/);
  dom.$('af-f-nome').value = 'Fulana Ficticia';
  dom.$('af-f-tel').value = '(11) 90000-0000';
  dom.$('af-f-email').value = 'fulana@example.com';
  await submit();
  assert.deepEqual(mutations(calls)[0].args[1], { versao: 'vf-ALU-4', modo: 'externo', novo: { nome: 'Fulana Ficticia', telefone: '(11) 90000-0000', email: 'fulana@example.com' }, parentesco: '' });
});

test('responsável externo existente é escolhido na lista (sem repetir quando já é o atual)', async () => {
  const { dom, calls, open, submit } = setup();
  await open('Elias Solto');
  dom.$('af-f-modo').value = 'externo';
  dom.$('af-f-modo').listeners.change();
  assert.deepEqual(optionValues(dom.$('af-f-ext')), ['', 'RES-2', '__novo']);
  dom.$('af-f-ext').value = 'RES-2';
  await submit();
  assert.deepEqual(mutations(calls)[0].args[1], { versao: 'vf-ALU-4', modo: 'externo', guardian_id: 'RES-2', parentesco: '' });
});

test('sem mudanças: não chama o servidor e fecha o painel', async () => {
  const { dom, calls, open, submit } = setup();
  await open('Ana Ficticia');
  await submit();
  assert.equal(mutations(calls).length, 0);
  assert.equal(dom.$('af-dialog').hidden, true);
});

test('aluno sem matrícula: só cria se algo for preenchido, com versão "nova"', async () => {
  const { dom, calls, open, submit } = setup();
  await open('Daniela Solta');
  assert.match(dom.$('af-dialog-hint').textContent, /ainda não tem matrícula/);
  assert.equal(dom.$('af-f-plano').value, 'PLA-1', 'sugere o plano Custom');
  await submit();
  assert.equal(mutations(calls).length, 0, 'plano sugerido sozinho não cria matrícula');
  await open('Daniela Solta');
  dom.$('af-f-valor').value = '200';
  await submit();
  assert.deepEqual(mutations(calls), [{ acao: 'alunofull.salvarMatricula', args: ['ALU-3', { versao: 'nova', plan_id: 'PLA-1', valor: 200, dia_vencimento: '', tipo_isencao: '', pago_ate: '' }] }]);
});

test('valor inválido no formulário é barrado antes de chamar o servidor', async () => {
  const { dom, calls, open, submit } = setup();
  await open('Ana Ficticia');
  dom.$('af-f-valor').value = 'abc';
  await submit();
  assert.equal(mutations(calls).length, 0);
  assert.match(dom.$('af-dialog-error').textContent, /Informe o valor/);
  assert.equal(dom.$('af-dialog').hidden, false);
});

test('mudar família e valor: duas chamadas em ordem; se a segunda falha, a primeira fica salva e o painel avisa; ao tentar de novo só a matrícula é enviada', async () => {
  const afterFamily = DATA();
  afterFamily.alunos[3] = aluno('ALU-4', 'Elias Solto', { familia_id: 'RES-1', papel: 'dependente', versaoFamilia: 'vf-novo' });
  afterFamily.familias[0].membros.push('ALU-4');
  let matriculaFalha = true;
  const respond = (acao) => {
    if (acao === 'alunofull.definirResponsavel') return ok(afterFamily);
    if (acao === 'alunofull.salvarMatricula') return matriculaFalha ? fail('VALIDACAO', 'Dados inválidos', [{ campo: 'valor', mensagem: 'Valor zero só é permitido com um tipo de isenção.' }]) : ok({ ...afterFamily, salvo: 'ALU-4' });
    return ok(DATA());
  };
  const { dom, calls, open, submit } = setup(respond);
  await open('Elias Solto');
  dom.$('af-f-modo').value = 'aluno';
  dom.$('af-f-modo').listeners.change();
  dom.$('af-f-aluno').value = 'ALU-1';
  dom.$('af-f-valor').value = '0';
  await submit();
  assert.deepEqual(mutations(calls).map((c) => c.acao), ['alunofull.definirResponsavel', 'alunofull.salvarMatricula']);
  assert.equal(dom.$('af-dialog').hidden, false, 'painel segue aberto');
  assert.match(dom.$('af-dialog-error').textContent, /A família foi salva, mas a matrícula não\. Valor zero só é permitido/);
  assert.equal(dom.$('af-save').disabled, false);
  assert.match(allText(dom.$('af-groups')), /Elias Solto/, 'a tela já mostra a família nova');

  matriculaFalha = false;
  dom.$('af-f-valor').value = '170';
  calls.length = 0;
  await submit();
  assert.deepEqual(mutations(calls).map((c) => c.acao), ['alunofull.salvarMatricula'], 'a família já salva não é reenviada');
  assert.equal(mutations(calls)[0].args[1].valor, 170);
  assert.equal(dom.$('af-dialog').hidden, true);
});

test('erro de validação do servidor aparece no painel e o botão volta a funcionar', async () => {
  const { dom, open, submit } = setup((acao) => (acao === 'alunofull.salvarMatricula' ? fail('VALIDACAO', 'Dados inválidos', [{ campo: 'dia_vencimento', mensagem: 'O dia de vencimento deve ser de 1 a 31.' }]) : ok(DATA())));
  await open('Ana Ficticia');
  dom.$('af-f-dia').value = '40';
  await submit();
  assert.equal(dom.$('af-dialog').hidden, false);
  assert.match(dom.$('af-dialog-error').textContent, /de 1 a 31/);
  assert.ok(dom.$('af-dialog-error').focused > 0);
  assert.equal(dom.$('af-save').disabled, false);
});

test('versão desatualizada: fecha o painel, avisa e recarrega a lista', async () => {
  const { dom, calls, open, submit } = setup((acao) => (acao === 'alunofull.salvarMatricula' ? fail('VERSAO_DESATUALIZADA', 'x') : ok(DATA())));
  await open('Ana Ficticia');
  dom.$('af-f-valor').value = '99';
  await submit();
  await flush();
  assert.equal(dom.$('af-dialog').hidden, true);
  assert.equal(dom.$('af-inner').inert, false);
  assert.match(dom.$('af-notice').textContent, /alterado por outra pessoa/);
  assert.equal(calls.filter((c) => c.acao === 'alunofull.listar').length, 2, 'a lista foi pedida de novo');
});

test('sessão recusada ou falha de rede: repassa ao app / mostra erro seguro e libera o botão', async () => {
  const a = setup((acao) => (acao === 'alunofull.salvarMatricula' ? fail('ACESSO_NEGADO', 'x') : ok(DATA())));
  await a.open('Ana Ficticia');
  a.dom.$('af-f-valor').value = '99';
  await a.submit();
  assert.deepEqual(a.auth, ['ACESSO_NEGADO']);
  assert.equal(a.dom.$('af-dialog').hidden, true);

  const b = setup((acao) => { if (acao === 'alunofull.salvarMatricula') throw Object.assign(new Error('Sem conexão.'), { name: 'TransportError' }); return ok(DATA()); });
  await b.open('Ana Ficticia');
  b.dom.$('af-f-valor').value = '99';
  await b.submit();
  assert.equal(b.dom.$('af-dialog-error').textContent, 'Sem conexão.');
  assert.equal(b.dom.$('af-save').disabled, false);
  const c = setup((acao) => { if (acao === 'alunofull.salvarMatricula') throw new Error('boom detalhado'); return ok(DATA()); });
  await c.open('Ana Ficticia');
  c.dom.$('af-f-valor').value = '99';
  await c.submit();
  assert.equal(c.dom.$('af-dialog-error').textContent, 'Não foi possível salvar. Tente novamente.');
});

test('duplo envio: enquanto salva, o segundo clique é ignorado', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const { dom, calls, open } = setup((acao) => (acao === 'alunofull.salvarMatricula' ? slow : ok(DATA())));
  await open('Ana Ficticia');
  dom.$('af-f-valor').value = '99';
  dom.submit('af-form');
  dom.submit('af-form');
  await flush();
  assert.equal(mutations(calls).length, 1);
  assert.equal(dom.$('af-save').disabled, true);
  release(ok(DATA()));
  await flush();
});

test('reset (troca/saída de usuário) fecha o painel e descarta a resposta que chegar depois', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const { dom, af, open } = setup((acao) => (acao === 'alunofull.salvarMatricula' ? slow : ok(DATA())));
  await open('Ana Ficticia');
  dom.$('af-f-valor').value = '99';
  dom.submit('af-form');
  await flush();
  af.reset();
  assert.equal(dom.$('af-dialog').hidden, true);
  assert.equal(dom.$('af-inner').inert, false);
  release(ok(DATA()));
  await flush();
  assert.deepEqual(dom.visible(PARTS), ['af-loading']);
  assert.equal(dom.$('af-notice').hidden, true);
});

test('"Abrir cadastro completo" fecha o painel e abre o cadastro do aluno', async () => {
  const { dom, opened, open } = setup();
  await open('Ana Ficticia');
  dom.click('af-open-student');
  assert.deepEqual(opened, ['ALU-2']);
  assert.equal(dom.$('af-dialog').hidden, true);
});

test('na visão Lista (tabela) o nome também abre o painel', async () => {
  const { dom, af } = setup(undefined, { withTable: true });
  af.activate();
  await flush();
  dom.$('af-view-list').listeners.click();
  const found = [];
  const walk = (n) => { if (n.tag === 'button' && n._t === 'Ana Ficticia') found.push(n); (n.children || []).forEach(walk); };
  walk(dom.$('af-table-root'));
  assert.equal(found.length, 1);
  found[0].listeners.click();
  assert.equal(dom.$('af-dialog').hidden, false);
});

test('nada do servidor entra como HTML no painel (nomes só como texto)', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const d = DATA();
  d.alunos[1].nome = evil;
  d.familias[0].nome = evil;
  const { dom, af } = setup(() => ok(d));
  af.activate();
  await flush();
  const b = (() => { const f = []; const walk = (n) => { if (n.tag === 'button' && n._t === evil) f.push(n); (n.children || []).forEach(walk); }; walk(dom.$('af-groups')); return f[0]; })();
  b.listeners.click();
  assert.equal(dom.$('af-dialog-title').textContent, evil);
  assert.ok(dom.$('af-dialog-info').textContent.includes(evil));
});
