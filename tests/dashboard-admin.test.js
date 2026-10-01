import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createDashboard } from '../js/dashboard.js';
import { formatIndicator } from '../js/dashboard-admin.js';
import { createStudents } from '../js/students.js';
import { createStudentForm } from '../js/student-form.js';
import { createDom, flush } from './helpers/dom-env.js';
import { createFakeApi, okEnv } from './helpers/fake-api.js';

const PARTS = ['dash-loading', 'dash-error', 'dash-ready'];
const ind = (id, titulo, extra = {}) => ({
  id, titulo, estado: 'aguardando', formato: 'inteiro', valor: null, secundario: null,
  mensagem: 'Aguardando importação das mensalidades', ajuda: 'Como se calcula ' + id, detalhe: null, ...extra,
});
const ATIVOS = [
  { student_id: 'ALU-1', nome: 'Bruno Ficticio' },
  { student_id: 'ALU-2', nome: 'Ana Ficticia' },
  { student_id: 'ALU-3', nome: 'Érica Ficticia' },
];
const ADMIN = {
  escola: 'Gracie Barra Itu', ambiente: 'production', usuario: { nome: 'Admin', perfil: 'Administrador' },
  alunosPorStatus: [{ status: 'Ativo', total: 3 }], totalAlunos: 4,
  atualizadoEm: '2026-10-01T15:00:00.000Z', atualizadoEmLocal: '01/10/2026 12:00:00',
  presenca: { fonte: 'physical_card', aviso: 'Presença por cartões.' },
  completo: true, competencia: '2026-10', hoje: '2026-10-05',
  indicadores: {
    principais: [
      ind('alunosAtivos', 'Alunos ativos', { estado: 'ok', valor: 3, secundario: 'de 4 cadastrados', mensagem: null, detalhe: 'alunosAtivos' }),
      ind('receitaRecebida', 'Receita recebida', { formato: 'moeda' }),
    ],
    complementares: [
      ind('novasMatriculas', 'Novas matrículas', { estado: 'ok', valor: 0, secundario: 'Mês anterior: 2', mensagem: null, detalhe: 'novasMatriculas' }),
      ind('leads', 'Leads', { estado: 'nao_configurado', mensagem: 'Módulo ainda não configurado' }),
    ],
  },
  graficos: {
    situacaoAlunos: { estado: 'ok', itens: [{ status: 'Experimental', total: 0 }, { status: 'Ativo', total: 3 }, { status: 'Inativo', total: 1 }] },
    receitaPrevistaRecebida: { estado: 'aguardando', mensagem: 'Aguardando importação das mensalidades' },
    ocupacaoTurmas: { estado: 'aguardando', mensagem: 'Aguardando lançamento das presenças' },
  },
  aniversariantes: [
    { student_id: 'ALU-2', nome: 'Ana Maria Ficticia', dia: 5, mes: 10, idade: 11, hoje: true, proximos: false },
    { student_id: 'ALU-1', nome: 'Bruno Ficticio', dia: 9, mes: 10, idade: 36, hoje: false, proximos: true },
    { student_id: 'ALU-3', nome: 'Carla', dia: 28, mes: 10, idade: null, hoje: false, proximos: false },
  ],
  detalhes: { alunosAtivos: ATIVOS, novasMatriculas: [] },
};

function setup(respond = () => okEnv(ADMIN)) {
  const dom = createDom();
  const calls = [];
  const opened = [];
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(calls.length, args); } };
  const dashboard = createDashboard({ doc: dom.doc, api, openStudent: (id) => opened.push(id) });
  const names = (id) => dom.$(id).children.map((li) => li.children[0].children[0].textContent);
  const card = (grid, i) => dom.$(grid).children[i];
  const press = (key) => (dom.docListeners.keydown || []).forEach((fn) => fn({ key }));
  return { dom, calls, opened, dashboard, names, card, press };
}

test('formatação pt-BR: inteiro, moeda e percentual com uma casa', () => {
  assert.equal(formatIndicator({ formato: 'inteiro', valor: 1234 }), '1.234');
  assert.equal(formatIndicator({ formato: 'moeda', valor: 1234.56 }).replace(/\s/g, ' '), 'R$ 1.234,56');
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
  assert.equal(dom.$('kpi-main').children.length, 2);
  assert.equal(dom.$('kpi-more').children.length, 2);
});

test('cartão com dado mostra o valor; sem dado mostra só a mensagem (nunca zero)', async () => {
  const { dom, dashboard, card } = setup();
  await dashboard.load();
  const text = (node) => node.children.map((c) => c.textContent);
  assert.deepEqual(text(card('kpi-main', 0)).slice(0, 3), ['Alunos ativos', '3', 'de 4 cadastrados']);
  const pending = card('kpi-main', 1);
  assert.deepEqual(text(pending).slice(0, 2), ['Receita recebida', 'Aguardando importação das mensalidades']);
  assert.ok(!pending.children.some((c) => c.className === 'kpi-value'));
  assert.equal(pending.tag, 'div');
  assert.equal(card('kpi-more', 1).children[1].textContent, 'Módulo ainda não configurado');
  assert.equal(card('kpi-main', 0).title, 'Como se calcula alunosAtivos');
  assert.ok(text(card('kpi-main', 0)).some((t) => t.startsWith('Como é calculado')));
  assert.equal(dom.$('drawer').hidden, true);
});

test('cartão com detalhe é botão: abre a gaveta com a lista, contagem e foco; Esc fecha e devolve o foco', async () => {
  const { dom, dashboard, card, names, press } = setup();
  await dashboard.load();
  const opener = card('kpi-main', 0);
  assert.equal(opener.tag, 'button');
  assert.equal(card('kpi-more', 0).tag, 'button');
  opener.listeners.click();
  assert.equal(dom.$('drawer').hidden, false);
  assert.equal(dom.$('drawer-title').textContent, 'Alunos ativos');
  assert.deepEqual(names('drawer-list'), ['Ana Ficticia', 'Bruno Ficticio', 'Érica Ficticia']);
  assert.equal(dom.$('drawer-count').textContent, '3 alunos');
  assert.ok(dom.$('drawer-panel').focused > 0);
  assert.equal(dom.$('dash-ready').inert, true);
  press('Enter');
  assert.equal(dom.$('drawer').hidden, false);
  press('Escape');
  assert.equal(dom.$('drawer').hidden, true);
  assert.equal(dom.$('dash-ready').inert, false);
  assert.ok(opener.focused > 0);
});

test('gaveta: busca ignora acento e caixa, ordenação inverte, vazio é explicado', async () => {
  const { dom, dashboard, card, names } = setup();
  await dashboard.load();
  card('kpi-main', 0).listeners.click();
  dom.$('drawer-q').value = 'erica';
  dom.$('drawer-q').listeners.input();
  assert.deepEqual(names('drawer-list'), ['Érica Ficticia']);
  assert.equal(dom.$('drawer-count').textContent, '1 de 3 alunos');
  dom.$('drawer-q').value = 'zzz';
  dom.$('drawer-q').listeners.input();
  assert.equal(dom.$('drawer-empty').hidden, false);
  assert.equal(dom.$('drawer-empty').textContent, 'Nenhum aluno encontrado para esta busca.');
  dom.$('drawer-q').value = '';
  dom.$('drawer-sort').value = 'za';
  dom.$('drawer-sort').listeners.change();
  assert.deepEqual(names('drawer-list'), ['Érica Ficticia', 'Bruno Ficticio', 'Ana Ficticia']);
});

test('gaveta vazia (nenhuma matrícula no mês) mostra o estado vazio; fechar pelo botão e pelo fundo', async () => {
  const { dom, dashboard, card } = setup();
  await dashboard.load();
  card('kpi-more', 0).listeners.click();
  assert.equal(dom.$('drawer-empty').hidden, false);
  assert.equal(dom.$('drawer-empty').textContent, 'Nenhum aluno neste indicador.');
  dom.click('drawer-close');
  assert.equal(dom.$('drawer').hidden, true);
  card('kpi-more', 0).listeners.click();
  dom.click('drawer-backdrop');
  assert.equal(dom.$('drawer').hidden, true);
});

test('clicar em um aluno da lista fecha a gaveta e abre o cadastro', async () => {
  const { dom, dashboard, card, opened } = setup();
  await dashboard.load();
  card('kpi-main', 0).listeners.click();
  dom.$('drawer-list').children[1].children[0].listeners.click();
  assert.deepEqual(opened, ['ALU-1']);
  assert.equal(dom.$('drawer').hidden, true);
});

test('aniversariantes: iniciais, dia/mês, idade, destaques Hoje e Em breve; clique abre o cadastro', async () => {
  const { dom, dashboard, opened } = setup();
  await dashboard.load();
  const rows = dom.$('bday-list').children.map((li) => li.children[0]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].children[0].textContent, 'AF');
  assert.equal(rows[0].children[1].children[0].textContent, 'Ana Maria Ficticia');
  assert.equal(rows[0].children[1].children[1].textContent, '05/10 · completa 11 anos');
  assert.equal(rows[0].children[2].textContent, 'Hoje');
  assert.equal(rows[1].children[2].textContent, 'Em breve');
  assert.equal(rows[2].children.length, 2);
  assert.equal(rows[2].children[0].textContent, 'C');
  assert.equal(rows[2].children[1].children[1].textContent, '28/10');
  assert.equal(dom.$('bday-empty').hidden, true);
  rows[1].listeners.click();
  assert.deepEqual(opened, ['ALU-1']);
});

test('sem aniversariantes: mostra a mensagem do mês', async () => {
  const { dom, dashboard } = setup(() => okEnv({ ...ADMIN, aniversariantes: [] }));
  await dashboard.load();
  assert.equal(dom.$('bday-empty').hidden, false);
  assert.ok(readFileSync(new URL('../index.html', import.meta.url), 'utf8').includes('<p id="bday-empty" class="muted" hidden>Não há aniversariantes neste mês.</p>'));
  assert.equal(dom.$('bday-list').children.length, 0);
});

test('gráficos: situação em barras com rótulo acessível; receita e ocupação mostram o estado de espera', async () => {
  const { dom, dashboard } = setup();
  await dashboard.load();
  const bars = dom.$('chart-status').children[0].children;
  assert.equal(bars.length, 3);
  const bar = bars[1].children[1];
  assert.equal(bar.value, 3);
  assert.equal(bar.max, 3);
  assert.equal(bar.getAttribute('aria-label'), 'Ativo: 3 de 4 alunos');
  assert.equal(dom.$('chart-revenue').children[0].textContent, 'Aguardando importação das mensalidades');
  assert.equal(dom.$('chart-occupancy').children[0].textContent, 'Aguardando lançamento das presenças');
});

test('situação sem nenhum aluno: "Ainda sem dados."', async () => {
  const empty = { estado: 'ok', itens: [{ status: 'Ativo', total: 0 }] };
  const { dom, dashboard } = setup(() => okEnv({ ...ADMIN, graficos: { ...ADMIN.graficos, situacaoAlunos: empty } }));
  await dashboard.load();
  assert.equal(dom.$('chart-status').children[0].textContent, 'Ainda sem dados.');
});

test('competência: trocar no seletor recarrega com a competência; valor inválido é ignorado', async () => {
  const { dom, calls, dashboard } = setup((n, args) => okEnv({ ...ADMIN, competencia: args[0] ? args[0].competencia : '2026-10' }));
  await dashboard.load();
  dom.$('dash-comp').value = '2026-08';
  dom.$('dash-comp').listeners.change();
  await flush();
  assert.deepEqual(calls[1], { acao: 'dashboard.obter', args: [{ competencia: '2026-08' }] });
  assert.equal(dom.$('dash-comp').value, '2026-08');
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
  const { dom, dashboard } = setup((n) => (n === 1 ? okEnv(ADMIN) : gate.then(() => okEnv(ADMIN))));
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
  assert.equal(dom.$('updated').textContent, 'Atualizado em 01/10/2026, 12:00:00');
});

test('perfil sem painel completo: quadro básico, sem seletor de competência e sem competência na chamada', async () => {
  const basic = { ...ADMIN };
  ['completo', 'competencia', 'indicadores', 'graficos', 'aniversariantes', 'detalhes', 'hoje'].forEach((k) => delete basic[k]);
  const { dom, calls, dashboard } = setup(() => okEnv(basic));
  await dashboard.load();
  await dashboard.load();
  assert.equal(dom.$('dash-basic').hidden, false);
  assert.equal(dom.$('dash-admin').hidden, true);
  assert.equal(dom.$('dash-comp-box').hidden, true);
  assert.deepEqual(calls.map((c) => c.args), [[], []]);
});

test('reset apaga o painel completo do usuário anterior (cartões, aniversariantes, gaveta e competência)', async () => {
  const { dom, dashboard, card } = setup();
  await dashboard.load();
  card('kpi-main', 0).listeners.click();
  dashboard.reset();
  assert.equal(dom.$('dash-admin').hidden, true);
  assert.equal(dom.$('drawer').hidden, true);
  ['kpi-main', 'kpi-more', 'bday-list', 'drawer-list', 'chart-status'].forEach((id) => assert.equal(dom.$(id).children.length, 0, id));
  assert.equal(dom.$('dash-comp-box').hidden, true);
  assert.equal(dom.$('dash-comp').value, '');
  assert.equal(dom.$('dash-basic').hidden, false);
  assert.equal(dom.$('dash-refresh').disabled, false);
  assert.equal(dom.$('dash-ready').inert, false);
});

test('resposta completa malformada: erro genérico, sem detalhe técnico', async () => {
  const { dom, dashboard } = setup(() => okEnv({ ...ADMIN, indicadores: null }));
  const result = await dashboard.load();
  assert.deepEqual(result, { ok: false, code: 'CLIENT' });
  assert.deepEqual(dom.visible(PARTS), ['dash-error']);
  assert.equal(dom.$('dash-error-msg').textContent, 'Não foi possível exibir os dados. Tente novamente.');
});

test('texto do servidor com HTML aparece literalmente', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const data = { ...ADMIN, aniversariantes: [{ student_id: 'ALU-9', nome: evil, dia: 1, mes: 10, idade: 5, hoje: false, proximos: false }],
    indicadores: { ...ADMIN.indicadores, principais: [ind('x', evil, { mensagem: evil })] } };
  const { dom, dashboard, card } = setup(() => okEnv(data));
  await dashboard.load();
  assert.equal(card('kpi-main', 0).children[0].textContent, evil);
  assert.equal(card('kpi-main', 0).children[1].textContent, evil);
  assert.equal(dom.$('bday-list').children[0].children[0].children[1].children[0].textContent, evil);
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
  assert.equal(fake.last().acao, 'alunos.obter');
  await fake.resolve(okEnv({ aluno: { student_id: 'ALU-7', nome_completo: 'Bruno Ficticio', nome_social: '', status: 'Ativo' }, avisos: [], versao: 'v', edicao: { podeEditar: false, campos: [], statusPermitidos: [], confirmarDuplicidade: false } }));
  await opening;
  assert.equal(dom.$('student-detail').hidden, false);
  assert.equal(dom.$('detail-name').textContent, 'Bruno Ficticio');
  students.activate(); // já carregada: não repete a listagem
  assert.equal(fake.byAcao('alunos.listar').length, 1);
});

// ---------- D2: financeiro ----------
import { metaOf } from '../js/dashboard-admin.js';

const FIN = {
  ...ADMIN,
  avisos: ['1 pagamento sem data não entra na receita recebida.'],
  aniversariantesEstado: 'ok',
  indicadores: {
    principais: [
      ind('inadimplentes', 'Inadimplentes', { estado: 'ok', valor: 2, secundario: 'R$ 410,00 em aberto', mensagem: null, detalhe: 'inadimplentes' }),
      ind('receitaRecebida', 'Receita recebida', { estado: 'ok', formato: 'moeda', valor: 1234.5, secundario: '2 pagamentos', mensagem: null, detalhe: 'receitaRecebida' }),
    ],
    complementares: [ind('ticketMedio', 'Ticket médio', { estado: 'ok', formato: 'moeda', valor: 400, secundario: '2 alunos pagaram', mensagem: null })],
  },
  graficos: {
    ...ADMIN.graficos,
    receitaPrevistaRecebida: { estado: 'ok', meses: [
      { competencia: '2026-08', prevista: 200, recebida: 100 },
      { competencia: '2026-09', prevista: 600, recebida: 800 },
    ] },
  },
  detalhes: {
    ...ADMIN.detalhes,
    inadimplentes: [{ student_id: 'ALU-2', nome: 'Ana Ficticia', info: { competencia: '2026-09', vencimento: '2026-09-10', valor: 250, telefone: '(11) 90000-0000' } }],
    receitaRecebida: [{ student_id: 'ALU-1', nome: 'Bruno Ficticio', data: '2026-09-10', valor: 200, forma: 'PIX' }],
  },
};

test('metaOf: compõe o texto de apoio com o que existir (matrícula, competência, vencimento, data, valor, forma, telefone)', () => {
  assert.equal(metaOf({ data_matricula: '10/09/2026' }), 'Matrícula em 10/09/2026');
  const flat = (t) => t.replace(/\s/g, ' ');
  assert.equal(flat(metaOf({ info: { competencia: '2026-09', vencimento: '2026-09-10', valor: 250, telefone: '(11) 90000-0000' } })),
    'Competência 09/2026 · vence 10/09/2026 · R$ 250,00 · (11) 90000-0000');
  assert.equal(flat(metaOf({ data: '2026-09-10', valor: 200, forma: 'PIX' })), '10/09/2026 · R$ 200,00 · PIX');
  assert.equal(metaOf({ student_id: 'A', nome: 'X' }), '');
});

test('cartões financeiros mostram moeda pt-BR e abrem a lista de inadimplentes com competência, vencimento, valor e telefone', async () => {
  const { dom, dashboard, card } = setup(() => okEnv(FIN));
  await dashboard.load();
  assert.equal(card('kpi-main', 1).children[1].textContent.replace(/\s/g, ' '), 'R$ 1.234,50');
  assert.equal(card('kpi-main', 1).children[2].textContent, '2 pagamentos');
  card('kpi-main', 0).listeners.click();
  assert.equal(dom.$('drawer-title').textContent, 'Inadimplentes');
  const meta = dom.$('drawer-list').children[0].children[0].children[1].textContent.replace(/\s/g, ' ');
  assert.equal(meta, 'Competência 09/2026 · vence 10/09/2026 · R$ 250,00 · (11) 90000-0000');
  assert.equal(dom.$('drawer-count').textContent, '1 registros');
});

test('lista de receita recebida: data, valor e forma; a contagem fala em registros', async () => {
  const { dom, dashboard, card } = setup(() => okEnv(FIN));
  await dashboard.load();
  card('kpi-main', 1).listeners.click();
  assert.equal(dom.$('drawer-list').children[0].children[0].children[1].textContent.replace(/\s/g, ' '), '10/09/2026 · R$ 200,00 · PIX');
});

test('gráfico de receita: uma linha por mês com barra prevista e barra recebida na mesma escala, com rótulos acessíveis', async () => {
  const { dom, dashboard } = setup(() => okEnv(FIN));
  await dashboard.load();
  const box = dom.$('chart-revenue');
  assert.equal(box.children[0].textContent, 'Cinza: previsto · Vermelho: recebido');
  const rows = box.children[1].children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].textContent, 'ago/26');
  const [prev, rec] = rows[1].children[1].children;
  assert.deepEqual([prev.value, prev.max, rec.value, rec.max], [600, 800, 800, 800]);
  assert.match(prev.getAttribute('aria-label').replace(/\s/g, ' '), /set\/26, previsto: R\$ 600,00/);
  assert.match(rec.getAttribute('aria-label').replace(/\s/g, ' '), /set\/26, recebido: R\$ 800,00/);
  assert.equal(rows[1].children[2].textContent.replace(/\s/g, ' '), 'R$ 600,00 / R$ 800,00');
});

test('avisos de qualidade aparecem num quadro e somem quando não há avisos', async () => {
  const withAvisos = setup(() => okEnv(FIN));
  await withAvisos.dashboard.load();
  assert.equal(withAvisos.dom.$('dash-avisos-box').hidden, false);
  assert.equal(withAvisos.dom.$('dash-avisos').children[0].textContent, FIN.avisos[0]);
  const without = setup(() => okEnv({ ...FIN, avisos: [] }));
  await without.dashboard.load();
  assert.equal(without.dom.$('dash-avisos-box').hidden, true);
});

test('sem datas de nascimento: mensagem de espera em vez de "não há aniversariantes"', async () => {
  const { dom, dashboard } = setup(() => okEnv({ ...FIN, aniversariantes: [], aniversariantesEstado: 'sem_datas' }));
  await dashboard.load();
  assert.equal(dom.$('bday-pending').hidden, false);
  assert.equal(dom.$('bday-empty').hidden, true);
  const ok = setup(() => okEnv({ ...FIN, aniversariantes: [], aniversariantesEstado: 'ok' }));
  await ok.dashboard.load();
  assert.equal(ok.dom.$('bday-pending').hidden, true);
  assert.equal(ok.dom.$('bday-empty').hidden, false);
});

test('reset apaga avisos e gráfico financeiro do usuário anterior', async () => {
  const { dom, dashboard } = setup(() => okEnv(FIN));
  await dashboard.load();
  dashboard.reset();
  assert.equal(dom.$('dash-avisos').children.length, 0);
  assert.equal(dom.$('dash-avisos-box').hidden, true);
  assert.equal(dom.$('chart-revenue').children.length, 0);
  assert.equal(dom.$('bday-pending').hidden, true);
});

test('texto financeiro do servidor com HTML aparece literalmente', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { dom, dashboard } = setup(() => okEnv({ ...FIN, avisos: [evil] }));
  await dashboard.load();
  assert.equal(dom.$('dash-avisos').children[0].textContent, evil);
});
