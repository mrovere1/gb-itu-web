import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboard } from '../js/dashboard.js';
import { formatIndicator } from '../js/dashboard-admin.js';
import { createStudents } from '../js/students.js';
import { createStudentForm } from '../js/student-form.js';
import { createDom, flush } from './helpers/dom-env.js';
import { createFakeApi, okEnv } from './helpers/fake-api.js';
import { ADMIN, ok, flat } from './helpers/dash-fixtures.js';

const PARTS = ['dash-loading', 'dash-error', 'dash-ready'];

function setup(respond = () => ok(ADMIN)) {
  const dom = createDom();
  const calls = [];
  const opened = [];
  const mens = [];
  const downloads = [];
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(calls.length, args); } };
  const dashboard = createDashboard({
    doc: dom.doc, api, openStudent: (id) => opened.push(id), openMensalidade: (f) => mens.push(f), download: (n, t) => downloads.push([n, t]),
  });
  const card = (grid, i) => dom.$(grid).children[i];
  const press = (key) => (dom.docListeners.keydown || []).forEach((fn) => fn({ key }));
  return { dom, calls, opened, mens, downloads, dashboard, card, press };
}

test('formatação pt-BR: inteiro, moeda e percentual com uma casa', () => {
  assert.equal(formatIndicator({ formato: 'inteiro', valor: 1234 }), '1.234');
  assert.equal(flat(formatIndicator({ formato: 'moeda', valor: 1234.56 })), 'R$ 1.234,56');
  assert.equal(formatIndicator({ formato: 'percentual', valor: 8.5 }), '8,5%');
});

test('administrador: mostra cartões, gráficos e aniversariantes; esconde o quadro básico e libera a competência', async () => {
  const { dom, calls, dashboard } = setup();
  assert.deepEqual(await dashboard.load(), { ok: true });
  assert.deepEqual(calls[0], { acao: 'dashboard.obter', args: [] });
  assert.deepEqual(dom.visible(PARTS), ['dash-ready']);
  assert.equal(dom.$('dash-admin').hidden, false);
  assert.equal(dom.$('dash-basic').hidden, true);
  assert.equal(dom.$('dash-comp-box').hidden, false);
  assert.equal(dom.$('dash-comp').value, '2026-10');
  assert.equal(dom.$('kpi-main').children.length, 4);
  assert.equal(dom.$('kpi-more').children.length, 3);
  assert.equal(dom.$('ws').hidden, true);
});

test('cartão com dado mostra o valor; sem dado mostra só a mensagem (nunca zero)', async () => {
  const { dashboard, card } = setup();
  await dashboard.load();
  const text = (node) => node.children.map((c) => c.textContent);
  const ativos = card('kpi-main', 0);
  assert.equal(ativos.children[0].textContent, 'Alunos ativos');
  assert.equal(ativos.children[1].children[0].textContent, '3');
  assert.equal(ativos.children[2].textContent, 'de 4 cadastrados');
  const pending = card('kpi-main', 3);
  assert.deepEqual(text(pending).slice(0, 2), ['Resultado mensal', 'Aguardando módulo financeiro']);
  assert.ok(!pending.children.some((c) => c.className === 'kpi-value'));
  assert.equal(pending.tag, 'div');
  assert.equal(card('kpi-more', 2).children[1].textContent, 'Módulo ainda não configurado');
  assert.equal(card('kpi-main', 0).title, 'Como se calcula alunosAtivos');
  assert.ok(text(card('kpi-main', 0)).some((t) => t.startsWith('Como é calculado')));
});

test('cartão com comparação: chip de variação ao lado do valor, mês anterior abaixo e filete conforme o sentido', async () => {
  const { dashboard, card } = setup();
  await dashboard.load();
  const rec = card('kpi-main', 2);
  assert.match(rec.className, /kpi-good/);
  const main = rec.children[1];
  assert.equal(flat(main.children[0].textContent), 'R$ 1.050,00');
  assert.equal(main.children[1].textContent, '+9,3%');
  assert.equal(main.children[1].className, 'delta delta-good');
  assert.equal(main.children[1].getAttribute('aria-label'), 'Variação de +9,3% sobre set/26');
  assert.equal(rec.children[2].textContent, '3 pagamentos');
  assert.equal(flat(rec.children[3].textContent), 'set/26: R$ 960,60');
  assert.equal(rec.children[3].className, 'kpi-prev');
  const nov = card('kpi-more', 1);
  assert.match(nov.className, /kpi-bad/, 'menos matrículas que no mês anterior é ruim');
  assert.equal(nov.children[1].children[1].textContent, '−50,0%');
  assert.equal(nov.children[1].children[1].className, 'delta delta-bad');
  assert.equal(nov.children[2].textContent, 'set/26: 2');
  assert.doesNotMatch(card('kpi-main', 0).className, /kpi-good|kpi-bad/, 'sem comparação, sem cor de sentido');
  assert.equal(card('kpi-main', 0).children[1].children.length, 1, 'sem chip');
});

test('cartão com lista é botão e convida a abrir a área de trabalho; sem lista não é clicável', async () => {
  const { dashboard, card } = setup();
  await dashboard.load();
  [['kpi-main', 0], ['kpi-main', 1], ['kpi-main', 2], ['kpi-more', 0], ['kpi-more', 1]].forEach(([g, i]) => {
    assert.equal(card(g, i).tag, 'button', g + i);
    assert.ok(card(g, i).children.some((c) => c.textContent === 'Abrir área de trabalho →'), g + i);
  });
  assert.equal(card('kpi-main', 3).tag, 'div');
  assert.equal(card('kpi-more', 2).tag, 'div');
});

test('clicar no cartão abre a SUA área de trabalho em tela larga e esconde o painel; Voltar restaura e devolve o foco', async () => {
  const { dom, dashboard, card } = setup();
  await dashboard.load();
  const opener = card('kpi-main', 1);
  opener.listeners.click();
  assert.equal(dom.$('ws').hidden, false);
  assert.equal(dom.$('ws-title').textContent, 'Inadimplentes');
  assert.equal(dom.$('dash-admin').hidden, true);
  assert.equal(dom.$('dash-presenca').hidden, true);
  assert.ok(dom.$('ws-title').focused > 0);
  dom.click('ws-back');
  assert.equal(dom.$('ws').hidden, true);
  assert.equal(dom.$('dash-admin').hidden, false);
  assert.equal(dom.$('dash-presenca').hidden, false);
  assert.equal(dom.$('dash-basic').hidden, true, 'o quadro básico continua escondido para o administrador');
  assert.ok(opener.focused > 0);
  card('kpi-main', 2).listeners.click();
  assert.equal(dom.$('ws-title').textContent, 'Receita recebida');
  card('kpi-main', 2).listeners.click;
  dom.click('ws-back');
  card('kpi-more', 1).listeners.click();
  assert.equal(dom.$('ws-title').textContent, 'Novas matrículas');
});

test('na área de trabalho, trocar a competência recarrega e a lista aberta é refeita com os dados novos', async () => {
  const novo = { ...ADMIN, competencia: '2026-09', detalhes: { ...ADMIN.detalhes, inadimplentes: ADMIN.detalhes.inadimplentes.slice(0, 1) } };
  const { dom, calls, dashboard, card } = setup((n, args) => ok(args[0] ? novo : ADMIN));
  await dashboard.load();
  card('kpi-main', 1).listeners.click();
  assert.equal(dom.$('ws-tbody').children.length, 4);
  dom.$('dash-comp').value = '2026-09';
  dom.$('dash-comp').listeners.change();
  await flush();
  assert.deepEqual(calls[1].args, [{ competencia: '2026-09' }]);
  assert.equal(dom.$('ws').hidden, false, 'continua na área de trabalho');
  assert.equal(dom.$('ws-tbody').children.length, 1);
  assert.equal(dom.$('dash-admin').hidden, true);
});

test('ações da área de trabalho chegam ao aplicativo: abrir cadastro e abrir Mensalidades filtrada', async () => {
  const { dom, dashboard, card, opened, mens } = setup();
  await dashboard.load();
  card('kpi-main', 1).listeners.click();
  const firstRow = dom.$('ws-tbody').children[0];
  const actions = firstRow.children[firstRow.children.length - 1].children;
  actions[0].listeners.click();
  actions[1].listeners.click();
  assert.deepEqual(opened, ['ALU-1']);
  assert.deepEqual(mens, [{ competencia: '2026-08', busca: 'Bruno Ficticio' }]);
});

test('aniversariantes: iniciais, dia/mês, idade, destaques Hoje e Em breve; clique abre o cadastro', async () => {
  const { dom, dashboard, opened } = setup();
  await dashboard.load();
  const rows = dom.$('bday-list').children.map((li) => li.children[0]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].children[0].textContent, 'AF');
  assert.equal(rows[0].children[1].children[1].textContent, '05/10 · completa 11 anos');
  assert.equal(rows[0].children[2].textContent, 'Hoje');
  assert.equal(rows[1].children[2].textContent, 'Em breve');
  assert.equal(rows[2].children.length, 2);
  assert.equal(rows[2].children[1].children[1].textContent, '28/10');
  rows[1].listeners.click();
  assert.deepEqual(opened, ['ALU-1']);
});

test('sem aniversariantes: mensagem do mês; sem datas de nascimento: mensagem de espera', async () => {
  const a = setup(() => ok({ ...ADMIN, aniversariantes: [] }));
  await a.dashboard.load();
  assert.equal(a.dom.$('bday-empty').hidden, false);
  assert.equal(a.dom.$('bday-pending').hidden, true);
  const b = setup(() => ok({ ...ADMIN, aniversariantes: [], aniversariantesEstado: 'sem_datas' }));
  await b.dashboard.load();
  assert.equal(b.dom.$('bday-pending').hidden, false);
  assert.equal(b.dom.$('bday-empty').hidden, true);
});

test('gráfico de situação: barras com rótulo acessível; ocupação mostra o estado de espera', async () => {
  const { dom, dashboard } = setup();
  await dashboard.load();
  const bars = dom.$('chart-status').children[0].children;
  assert.equal(bars.length, 3);
  assert.equal(bars[1].children[1].value, 3);
  assert.equal(bars[1].children[1].getAttribute('aria-label'), 'Ativo: 3 de 4 alunos');
  assert.equal(dom.$('chart-occupancy').children[0].textContent, 'Aguardando lançamento das presenças');
});

test('situação sem nenhum aluno: "Ainda sem dados."', async () => {
  const empty = { estado: 'ok', itens: [{ status: 'Ativo', total: 0 }] };
  const { dom, dashboard } = setup(() => ok({ ...ADMIN, graficos: { ...ADMIN.graficos, situacaoAlunos: empty } }));
  await dashboard.load();
  assert.equal(dom.$('chart-status').children[0].textContent, 'Ainda sem dados.');
});

test('cartão de receita novo é desenhado dentro do painel (anel e colunas)', async () => {
  const { dom, dashboard } = setup();
  await dashboard.load();
  assert.ok(dom.$('chart-revenue').children.length > 0);
  assert.equal(dom.$('chart-revenue').children[1].className, 'rev-body');
});

test('avisos de qualidade aparecem num quadro e somem quando não há avisos', async () => {
  const a = setup(() => ok({ ...ADMIN, avisos: ['1 pagamento sem data não entra na receita recebida.'] }));
  await a.dashboard.load();
  assert.equal(a.dom.$('dash-avisos-box').hidden, false);
  assert.equal(a.dom.$('dash-avisos').children[0].textContent, '1 pagamento sem data não entra na receita recebida.');
  const b = setup();
  await b.dashboard.load();
  assert.equal(b.dom.$('dash-avisos-box').hidden, true);
});

test('competência: trocar no seletor recarrega com a competência; valor inválido é ignorado', async () => {
  const { dom, calls, dashboard } = setup((n, args) => ok({ ...ADMIN, competencia: args[0] ? args[0].competencia : '2026-10' }));
  await dashboard.load();
  dom.$('dash-comp').value = '2026-08';
  dom.$('dash-comp').listeners.change();
  await flush();
  assert.deepEqual(calls[1], { acao: 'dashboard.obter', args: [{ competencia: '2026-08' }] });
  dom.$('dash-comp').value = '2026-13';
  dom.$('dash-comp').listeners.change();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(dom.$('dash-comp').value, '2026-08');
  dom.click('dash-refresh');
  await flush();
  assert.deepEqual(calls[2].args, [{ competencia: '2026-08' }]);
});

test('Atualizar com o painel aberto mantém o conteúdo, desabilita o botão e o reabilita ao terminar', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { dom, dashboard } = setup((n) => (n === 1 ? ok(ADMIN) : gate.then(() => ok(ADMIN))));
  await dashboard.load();
  dom.click('dash-refresh');
  await flush();
  assert.deepEqual(dom.visible(PARTS), ['dash-ready']);
  assert.equal(dom.$('dash-refresh').disabled, true);
  assert.equal(dom.$('dash-refresh').textContent, 'Atualizando…');
  release();
  await flush();
  assert.equal(dom.$('dash-refresh').disabled, false);
  assert.equal(dom.$('dash-refresh').textContent, 'Atualizar');
  assert.equal(dom.$('updated').textContent, 'Atualizado em 05/10/2026, 12:00:00');
});

test('perfil sem painel completo: quadro básico, sem seletor de competência e sem competência na chamada', async () => {
  const basic = { ...ADMIN };
  ['completo', 'competencia', 'indicadores', 'graficos', 'aniversariantes', 'detalhes', 'hoje', 'avisos'].forEach((k) => delete basic[k]);
  const { dom, calls, dashboard } = setup(() => ok(basic));
  await dashboard.load();
  await dashboard.load();
  assert.equal(dom.$('dash-basic').hidden, false);
  assert.equal(dom.$('dash-admin').hidden, true);
  assert.equal(dom.$('dash-comp-box').hidden, true);
  assert.deepEqual(calls.map((c) => c.args), [[], []]);
});

test('reset apaga o painel completo e fecha a área de trabalho do usuário anterior', async () => {
  const { dom, dashboard, card } = setup();
  await dashboard.load();
  card('kpi-main', 1).listeners.click();
  dashboard.reset();
  assert.equal(dom.$('ws').hidden, true);
  assert.equal(dom.$('dash-admin').hidden, true);
  ['kpi-main', 'kpi-more', 'bday-list', 'chart-status', 'chart-revenue', 'ws-tbody', 'ws-tiles'].forEach((id) => assert.equal(dom.$(id).children.length, 0, id));
  assert.equal(dom.$('dash-avisos-box').hidden, true);
  assert.equal(dom.$('dash-comp-box').hidden, true);
  assert.equal(dom.$('dash-comp').value, '');
  assert.equal(dom.$('dash-basic').hidden, false);
  assert.equal(dom.$('dash-refresh').disabled, false);
});

test('resposta completa malformada: erro genérico, sem detalhe técnico', async () => {
  const { dom, dashboard } = setup(() => ok({ ...ADMIN, indicadores: null }));
  const result = await dashboard.load();
  assert.deepEqual(result, { ok: false, code: 'CLIENT' });
  assert.deepEqual(dom.visible(PARTS), ['dash-error']);
  assert.equal(dom.$('dash-error-msg').textContent, 'Não foi possível exibir os dados. Tente novamente.');
});

test('texto do servidor com HTML aparece literalmente (cartão, aviso, aniversariante, lista)', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const data = {
    ...ADMIN, avisos: [evil],
    aniversariantes: [{ student_id: 'ALU-9', nome: evil, dia: 1, mes: 10, idade: 5, hoje: false, proximos: false }],
    indicadores: { ...ADMIN.indicadores, principais: [{ ...ADMIN.indicadores.principais[0], titulo: evil }] },
    detalhes: { ...ADMIN.detalhes, alunosAtivos: [{ student_id: 'ALU-9', nome: evil }] },
  };
  const { dom, dashboard, card } = setup(() => ok(data));
  await dashboard.load();
  assert.equal(card('kpi-main', 0).children[0].textContent, evil);
  assert.equal(dom.$('dash-avisos').children[0].textContent, evil);
  assert.equal(dom.$('bday-list').children[0].children[0].children[1].children[0].textContent, evil);
  card('kpi-main', 0).listeners.click();
  assert.equal(dom.$('ws-tbody').children[0].children[1].children[0].textContent, evil);
});

test('students.open: carrega a lista (perfil e opções) e depois o detalhe do aluno pedido', async () => {
  const dom = createDom();
  const fake = createFakeApi();
  const students = createStudents({ doc: dom.doc, api: fake.api, createForm: createStudentForm, onAuthFailure: () => {} });
  const opening = students.open('ALU-7');
  await flush();
  assert.equal(fake.calls[0].acao, 'alunos.listar');
  await fake.resolve(okEnv({
    itens: [], total: 0, totalGeral: 0, porStatus: [], statusDisponiveis: ['Ativo'], permissoes: { criar: true, editarSensivel: false, confirmarDuplicidade: false },
    opcoes: { statusCriacao: ['Ativo'], faixas: { adulto: ['Branca'], infantil: ['Branca'] } },
  }));
  await flush();
  assert.deepEqual(fake.last().args, ['ALU-7']);
  await fake.resolve(okEnv({ aluno: { student_id: 'ALU-7', nome_completo: 'Bruno Ficticio', nome_social: '', status: 'Ativo' }, avisos: [], versao: 'v', edicao: { podeEditar: false, campos: [], statusPermitidos: [], confirmarDuplicidade: false } }));
  await opening;
  assert.equal(dom.$('student-detail').hidden, false);
  assert.equal(dom.$('detail-name').textContent, 'Bruno Ficticio');
  students.activate();
  assert.equal(fake.byAcao('alunos.listar').length, 1);
});
