import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, csvCell, daysBetween, dateBR } from '../js/workspace.js';
import { createDom } from './helpers/dom-env.js';
import { ADMIN, flat } from './helpers/dash-fixtures.js';

function setup(data = ADMIN) {
  const dom = createDom();
  const opened = [];
  const mens = [];
  const files = [];
  const ws = createWorkspace({ doc: dom.doc, openStudent: (id) => opened.push(id), openMensalidade: (f) => mens.push(f), download: (n, t) => files.push({ name: n, text: t }) });
  dom.$('dash-admin').hidden = false; // painel completo já na tela
  dom.$('dash-basic').hidden = true;  // o administrador não vê o quadro básico
  const opener = { focused: 0, focus() { this.focused += 1; } };
  const rows = () => dom.$('ws-tbody').children;
  const cell = (r, c) => rows()[r].children[c];
  const names = () => rows().map((tr) => tr.children[1].children[0].textContent);
  const headers = () => dom.$('ws-thead').children[0].children;
  const tiles = () => dom.$('ws-tiles').children.map((t) => [t.children[0].textContent, flat(t.children[1].textContent)]);
  const press = (key) => (dom.docListeners.keydown || []).forEach((fn) => fn({ key }));
  return { dom, ws, opened, mens, files, opener, rows, cell, names, headers, tiles, press, data };
}
const open = (s, kind = 'inadimplentes', data = s.data) => s.ws.open(kind, data, s.opener);

test('utilitários: dias entre datas, data BR e células de CSV seguras', () => {
  assert.equal(daysBetween('2026-09-28', '2026-10-05'), 7);
  assert.equal(daysBetween('2026-10-05', '2026-10-05'), 0);
  assert.equal(daysBetween('2026-12-30', '2027-01-02'), 3);
  assert.equal(dateBR('2026-09-28'), '28/09/2026');
  assert.equal(csvCell('Ana'), 'Ana');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvCell('=SOMA(A1:A2)'), "'=SOMA(A1:A2)");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('-1+1'), "'-1+1");
  assert.equal(csvCell(null), '');
});

test('abrir com vários meses: a competência vira o período escolhido', () => {
  const s = setup();
  open(s, 'inadimplentes', { ...s.data, competencias: ['2026-08', '2026-09'], periodoRotulo: 'ago/26–set/26' });
  assert.equal(s.dom.$('ws-comp').textContent, 'Competências ago/26–set/26');
});

test('abrir: mostra a área, esconde o painel, foca o título e informa a competência', () => {
  const s = setup();
  open(s);
  assert.equal(s.dom.$('ws').hidden, false);
  assert.deepEqual(['dash-admin', 'dash-presenca', 'dash-basic'].map((id) => s.dom.$(id).hidden), [true, true, true]);
  assert.equal(s.dom.$('ws-title').textContent, 'Inadimplentes');
  assert.equal(s.dom.$('ws-crumb-title').textContent, 'Inadimplentes');
  assert.equal(s.dom.$('ws-comp').textContent, 'Competência 10/2026');
  assert.ok(s.dom.$('ws-title').focused > 0);
  assert.equal(s.ws.isOpen(), true);
});

test('inadimplentes: ordem padrão por atraso (maior primeiro), chips de atraso e valores em R$', () => {
  const s = setup();
  open(s);
  assert.deepEqual(s.names(), ['Bruno Ficticio', 'Diego Ficticio', 'Ana Ficticia', 'Érica Ficticia']);
  assert.equal(s.cell(0, 4).children[0].textContent, '77 dias');
  assert.equal(s.cell(0, 4).children[0].className, 'chip chip-vencida');
  assert.equal(s.cell(2, 4).children[0].className, 'chip chip-pendente');
  assert.equal(flat(s.cell(2, 5).textContent), 'R$ 250,00');
  assert.equal(s.cell(2, 2).textContent, '09/2026');
  assert.equal(s.cell(2, 3).textContent, '28/09/2026');
  assert.equal(s.cell(2, 1).children[1].textContent, '(11) 90000-0001', 'telefone aparece sob o nome');
});

test('resumo da lista: inadimplentes, em aberto, maior atraso e média por aluno', () => {
  const s = setup();
  open(s);
  assert.deepEqual(s.tiles(), [['Alunos inadimplentes', '4'], ['Em aberto', 'R$ 860,00'], ['Maior atraso', '77 dias'], ['Média por aluno', 'R$ 215,00']]);
  assert.equal(flat(s.dom.$('ws-foot').textContent), '4 registros · R$ 860,00');
  assert.equal(s.dom.$('ws-count').textContent, '4 registros');
});

test('cabeçalhos ordenáveis anunciam aria-sort e invertem ao clicar', () => {
  const s = setup();
  open(s);
  const sortOf = (i) => s.headers()[i].getAttribute('aria-sort');
  assert.equal(sortOf(4), 'descending');
  assert.equal(sortOf(1), 'none');
  s.headers()[1].children[0].listeners.click(); // nome
  assert.equal(sortOf(1), 'ascending');
  assert.deepEqual(s.names(), ['Ana Ficticia', 'Bruno Ficticio', 'Diego Ficticio', 'Érica Ficticia']);
  s.headers()[1].children[0].listeners.click();
  assert.deepEqual(s.names(), ['Érica Ficticia', 'Diego Ficticio', 'Bruno Ficticio', 'Ana Ficticia']);
  s.headers()[5].children[0].listeners.click(); // valor: numérico começa do maior
  assert.equal(sortOf(5), 'descending');
  assert.deepEqual(s.names(), ['Ana Ficticia', 'Diego Ficticio', 'Bruno Ficticio', 'Érica Ficticia']);
  assert.equal(s.headers()[6].getAttribute('aria-sort'), null, 'ações não ordenam');
});

test('busca ignora acento e caixa; sem resultado mostra o vazio de filtro', () => {
  const s = setup();
  open(s);
  s.dom.$('ws-q').value = 'erica';
  s.dom.$('ws-q').listeners.input();
  assert.deepEqual(s.names(), ['Érica Ficticia']);
  assert.equal(s.dom.$('ws-count').textContent, '1 de 4 registros');
  s.dom.$('ws-q').value = 'zzz';
  s.dom.$('ws-q').listeners.input();
  assert.equal(s.dom.$('ws-empty').hidden, false);
  assert.equal(s.dom.$('ws-empty').textContent, 'Nenhum registro encontrado para estes filtros.');
  assert.equal(s.dom.$('ws-table-wrap').hidden, true);
  assert.equal(s.dom.$('ws-export').disabled, true);
});

test('filtro por faixa de atraso', () => {
  const s = setup();
  open(s);
  const pick = (v) => { s.dom.$('ws-filter').value = v; s.dom.$('ws-filter').listeners.change(); return s.names(); };
  assert.deepEqual(pick('1-7'), ['Ana Ficticia', 'Érica Ficticia']);
  assert.deepEqual(pick('8-30'), []);
  assert.deepEqual(pick('31-60'), ['Diego Ficticio']);
  assert.deepEqual(pick('61+'), ['Bruno Ficticio']);
  assert.deepEqual(pick(''), ['Bruno Ficticio', 'Diego Ficticio', 'Ana Ficticia', 'Érica Ficticia']);
  assert.equal(s.dom.$('ws-filter-label').textContent, 'Faixa de atraso');
});

test('quadro por faixa de atraso: quatro colunas com contagem e total, cartões focáveis e ações', () => {
  const s = setup();
  open(s);
  assert.equal(s.dom.$('ws-views').hidden, false);
  s.dom.click('ws-view-board');
  assert.equal(s.dom.$('ws-board').hidden, false);
  assert.equal(s.dom.$('ws-table-wrap').hidden, true);
  assert.equal(s.dom.$('ws-view-board').getAttribute('aria-pressed'), 'true');
  const cols = s.dom.$('ws-board').children;
  assert.equal(cols.length, 4);
  assert.deepEqual(cols.map((c) => c.children[0].children[0].textContent), ['1–7 dias', '8–30 dias', '31–60 dias', 'Mais de 60 dias']);
  assert.deepEqual(cols.map((c) => flat(c.children[0].children[1].textContent)), ['2 alunos · R$ 430,00', '0 alunos · R$ 0,00', '1 aluno · R$ 230,00', '1 aluno · R$ 200,00']);
  const card = cols[3].children[1];
  assert.equal(card.getAttribute('tabindex'), '0');
  assert.equal(card.children[0].textContent, 'Bruno Ficticio');
  card.children[card.children.length - 1].children[1].listeners.click();
  assert.deepEqual(s.mens, [{ competencia: '2026-08', busca: 'Bruno Ficticio' }]);
  s.dom.click('ws-view-table');
  assert.equal(s.dom.$('ws-table-wrap').hidden, false);
  assert.equal(s.dom.$('ws-board').hidden, true);
});

test('seleção: marcar linhas mostra a barra com a soma; selecionar todos; limpar', () => {
  const s = setup();
  open(s);
  assert.equal(s.dom.$('ws-bulk').hidden, true);
  s.cell(0, 0).children[0].checked = true;
  s.cell(0, 0).children[0].listeners.change();
  assert.equal(s.dom.$('ws-bulk').hidden, false);
  assert.equal(flat(s.dom.$('ws-bulk-text').textContent), '1 selecionado · R$ 200,00');
  s.headers()[0].children[0].checked = true;
  s.headers()[0].children[0].listeners.change();
  assert.equal(flat(s.dom.$('ws-bulk-text').textContent), '4 selecionados · R$ 860,00');
  s.dom.click('ws-clear');
  assert.equal(s.dom.$('ws-bulk').hidden, true);
});

test('exportar CSV: BOM, separador ;, cabeçalho em português, valores em vírgula decimal e nome do arquivo com a competência', () => {
  const s = setup();
  open(s);
  s.dom.click('ws-export');
  assert.equal(s.files.length, 1);
  assert.equal(s.files[0].name, 'inadimplentes-2026-10.csv');
  const lines = s.files[0].text.split('\r\n');
  assert.equal(lines[0], '﻿Aluno;Telefone;Competência;Vencimento;Atraso;Valor');
  assert.equal(lines[1], 'Bruno Ficticio;;08/2026;20/07/2026;77 dias;200,00');
  assert.equal(lines[3], 'Ana Ficticia;(11) 90000-0001;09/2026;28/09/2026;7 dias;250,00');
  assert.equal(lines.length, 6);
});

test('exportar a seleção leva só as linhas marcadas; exportar respeita busca e filtro', () => {
  const s = setup();
  open(s);
  s.cell(1, 0).children[0].checked = true;
  s.cell(1, 0).children[0].listeners.change();
  s.dom.click('ws-export-selected');
  assert.equal(s.files[0].name, 'inadimplentes-2026-10-selecao.csv');
  assert.deepEqual(s.files[0].text.split('\r\n').slice(1, 2), ['Diego Ficticio;;09/2026;02/09/2026;33 dias;230,00']);
  s.dom.$('ws-filter').value = '1-7';
  s.dom.$('ws-filter').listeners.change();
  s.dom.click('ws-export');
  assert.equal(s.files[1].text.split('\r\n').length, 4);
});

test('nome com fórmula é neutralizado no CSV', () => {
  const evil = '=HYPERLINK("http://x")';
  const s = setup({ ...ADMIN, detalhes: { ...ADMIN.detalhes, alunosAtivos: [{ student_id: 'ALU-9', nome: evil }] } });
  open(s, 'alunosAtivos');
  s.dom.click('ws-export');
  assert.equal(s.files[0].text.split('\r\n')[1], '"\'=HYPERLINK(""http://x"")"');
});

test('ações da linha: abrir cadastro e abrir Mensalidades já filtrada pelo aluno e competência', () => {
  const s = setup();
  open(s);
  const actions = s.cell(2, 6).children; // Ana
  assert.equal(actions[0].textContent, 'Abrir cadastro');
  assert.equal(actions[1].textContent, 'Ver em Mensalidades');
  actions[0].listeners.click();
  actions[1].listeners.click();
  assert.deepEqual(s.opened, ['ALU-2']);
  assert.deepEqual(s.mens, [{ competencia: '2026-09', busca: 'Ana Ficticia' }]);
});

test('trocar de lista pelo seletor: cada lista tem suas colunas, resumo e ordem', () => {
  const s = setup();
  open(s);
  const tabs = s.dom.$('ws-switch').children;
  assert.deepEqual(tabs.map((t) => t.textContent), ['Inadimplentes (4)', 'Contas a vencer (2)', 'Receita recebida (3)', 'Alunos ativos (3)', 'Novas matrículas (1)']);
  assert.equal(tabs[0].getAttribute('aria-current'), 'true');
  tabs[1].listeners.click();
  assert.equal(s.dom.$('ws-title').textContent, 'Contas a vencer');
  assert.deepEqual(s.names(), ['Ana Ficticia', 'Bruno Ficticio']);
  assert.equal(s.cell(0, 4).children[0].textContent, 'hoje');
  assert.equal(s.cell(1, 4).children[0].textContent, 'em 4 dias');
  assert.deepEqual(s.tiles(), [['Cobranças', '2'], ['Valor total', 'R$ 450,00'], ['Vencem hoje', '1'], ['Próximo vencimento', '05/10/2026']]);
  assert.equal(s.dom.$('ws-views').hidden, true, 'o quadro por atraso é só dos inadimplentes');
  assert.equal(s.dom.$('ws-switch').children[1].getAttribute('aria-current'), 'true');
});

test('receita recebida: mais recente primeiro, filtro por forma montado dos dados e resumo', () => {
  const s = setup();
  open(s, 'receitaRecebida');
  assert.deepEqual(s.names(), ['Érica Ficticia', 'Bruno Ficticio', 'Ana Ficticia']);
  assert.equal(s.cell(0, 2).textContent, '03/10/2026');
  assert.equal(s.cell(0, 3).textContent, 'Crédito');
  assert.deepEqual(s.dom.$('ws-filter').options.map((o) => o.value), ['', 'Crédito', 'PIX']);
  assert.equal(s.dom.$('ws-filter-label').textContent, 'Forma de pagamento');
  s.dom.$('ws-filter').value = 'PIX';
  s.dom.$('ws-filter').listeners.change();
  assert.deepEqual(s.names(), ['Bruno Ficticio', 'Ana Ficticia']);
  assert.deepEqual(s.tiles(), [['Recebido', 'R$ 1.050,00'], ['Pagamentos', '3'], ['Maior pagamento', 'R$ 600,00'], ['Ticket médio', 'R$ 350,00']]);
  s.dom.click('ws-export');
  assert.equal(s.files[0].text.split('\r\n')[0], '﻿Aluno;Data;Forma;Valor');
});

test('alunos ativos e novas matrículas: colunas simples e CSV', () => {
  const s = setup();
  open(s, 'alunosAtivos');
  assert.deepEqual(s.names(), ['Ana Ficticia', 'Bruno Ficticio', 'Érica Ficticia']);
  assert.deepEqual(s.tiles(), [['Alunos ativos', '3']]);
  s.ws.open('novasMatriculas', s.data, s.opener);
  assert.equal(s.cell(0, 2).textContent, '03/10/2026');
  s.dom.click('ws-export');
  assert.equal(s.files[0].text.split('\r\n')[1], 'Fábio Ficticio;03/10/2026');
});

test('lista vazia: mensagem própria da lista, sem tabela e sem exportar', () => {
  const s = setup({ ...ADMIN, detalhes: { ...ADMIN.detalhes, inadimplentes: [] } });
  open(s);
  assert.equal(s.dom.$('ws-empty').hidden, false);
  assert.equal(s.dom.$('ws-empty').textContent, 'Nenhum inadimplente nesta competência.');
  assert.equal(s.dom.$('ws-table-wrap').hidden, true);
  assert.equal(s.dom.$('ws-export').disabled, true);
  assert.deepEqual(s.tiles()[0], ['Alunos inadimplentes', '0']);
});

test('fechar (Voltar ou Esc) devolve o painel, o foco e o estado anterior das partes', () => {
  const s = setup();
  open(s);
  s.dom.click('ws-back');
  assert.equal(s.dom.$('ws').hidden, true);
  assert.deepEqual(['dash-admin', 'dash-presenca', 'dash-basic'].map((id) => s.dom.$(id).hidden), [false, false, true]);
  assert.equal(s.opener.focused, 1);
  open(s);
  s.press('Enter');
  assert.equal(s.ws.isOpen(), true);
  s.press('Escape');
  assert.equal(s.ws.isOpen(), false);
  assert.equal(s.opener.focused, 2);
});

test('refresh mantém lista, busca, filtro e ordem e limpa a seleção', () => {
  const s = setup();
  open(s);
  s.dom.$('ws-q').value = 'ana';
  s.dom.$('ws-q').listeners.input();
  s.cell(0, 0).children[0].checked = true;
  s.cell(0, 0).children[0].listeners.change();
  const novo = { ...ADMIN, competencia: '2026-09', detalhes: { ...ADMIN.detalhes, inadimplentes: [{ student_id: 'ALU-2', nome: 'Ana Ficticia', info: { competencia: '2026-09', vencimento: '2026-09-28', valor: 999 } }] } };
  s.ws.refresh(novo);
  assert.equal(s.dom.$('ws-comp').textContent, 'Competência 09/2026');
  assert.equal(flat(s.cell(0, 5).textContent), 'R$ 999,00');
  assert.equal(s.dom.$('ws-q').value, 'ana');
  assert.equal(s.dom.$('ws-bulk').hidden, true);
});

test('reset apaga tudo e devolve as partes escondidas', () => {
  const s = setup();
  open(s);
  s.ws.reset();
  assert.equal(s.ws.isOpen(), false);
  assert.equal(s.dom.$('ws').hidden, true);
  assert.equal(s.dom.$('dash-admin').hidden, false);
  ['ws-tbody', 'ws-tiles', 'ws-switch', 'ws-board'].forEach((id) => assert.equal(s.dom.$(id).children.length, 0, id));
});

test('nome/telefone com HTML aparecem literalmente; tipo de lista desconhecido é ignorado', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const s = setup({ ...ADMIN, detalhes: { ...ADMIN.detalhes, inadimplentes: [{ student_id: 'A', nome: evil, info: { competencia: '2026-09', vencimento: '2026-09-01', valor: 1, telefone: evil } }] } });
  open(s);
  assert.equal(s.cell(0, 1).children[0].textContent, evil);
  assert.equal(s.cell(0, 1).children[1].textContent, evil);
  s.ws.close(false);
  s.ws.open('qualquerCoisa', s.data, s.opener);
  assert.equal(s.ws.isOpen(), false);
});
