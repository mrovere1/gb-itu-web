import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataTable, csvCell } from '../js/data-table.js';
import { createDom } from './helpers/dom-env.js';
import { flat } from './helpers/dash-fixtures.js';

const ROWS = [
  { nome: 'Bruno Lima', status: 'Pendente', valor: 200, meses: 3, venc: '2026-08-10', obs: 'x' },
  { nome: 'Ana Souza', status: 'Paga', valor: 250, meses: 0, venc: '2026-09-10', obs: 'y' },
  { nome: 'Érica Dias', status: 'Pendente', valor: 180, meses: 1, venc: '2026-09-28', obs: '' },
  { nome: 'Diego Ferraz', status: 'Paga', valor: null, meses: null, venc: '', obs: 'z' },
];
const COLUMNS = [
  { key: 'nome', label: 'Aluno', type: 'text', value: (r) => r.nome, filter: 'text' },
  { key: 'status', label: 'Status', type: 'text', value: (r) => r.status, filter: 'select' },
  { key: 'valor', label: 'Valor', type: 'money', value: (r) => r.valor, filter: 'range' },
  { key: 'meses', label: 'Meses', type: 'number', value: (r) => r.meses, filter: 'range' },
  { key: 'venc', label: 'Vencimento', type: 'date', value: (r) => r.venc, filter: 'date' },
  { key: 'obs', label: 'Observação', type: 'text', value: (r) => r.obs, defaultVisible: false },
  { key: 'acoes', label: 'Ações', locked: true, value: () => '', render: (r, td) => { const b = td.ownerDoc.createElement('button'); b.textContent = 'Abrir ' + r.nome; td.appendChild(b); } },
];

function memory(initial) {
  const data = new Map(initial ? Object.entries(initial) : []);
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), data };
}

function setup({ storage = memory(), columns = COLUMNS, rows = ROWS } = {}) {
  const dom = createDom();
  const files = [];
  const root = dom.$('mens-table-root');
  const wrapped = columns.map((c) => (c.render ? { ...c, render: (r, td) => { td.ownerDoc = dom.doc; c.render(r, td); } } : c));
  const t = createDataTable({ doc: dom.doc, root, tableId: 'teste', columns: wrapped, storage, download: (n, x) => files.push({ name: n, text: x }), fileName: 'teste', defaultSort: ['nome', 1] });
  t.setRows(rows);
  const q = {
    bar: () => root.children[0], picker: () => root.children[1], table: () => root.children[2].children[0],
    head: () => q.table().children[0].children[0].children, filters: () => q.table().children[0].children[1].children,
    rows: () => q.table().children[1].children, empty: () => root.children[3], foot: () => root.children[4],
    names: () => q.rows().map((tr) => tr.children[0].textContent),
    headers: () => q.head().map((th) => (th.children[0] ? th.children[0].textContent : th.textContent).replace(/ [▲▼]$/, '')),
    btn: (label) => q.bar().children.find((b) => b.textContent === label),
  };
  return { dom, t, root, files, storage, q };
}

test('csvCell neutraliza fórmulas e protege separadores', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell(null), '');
});

test('mostra só as colunas padrão, na ordem, com as bloqueadas (Ações) no fim; a oculta não aparece', () => {
  const { q } = setup();
  assert.deepEqual(q.headers(), ['Aluno', 'Status', 'Valor', 'Meses', 'Vencimento', 'Ações']);
  assert.equal(q.rows().length, 4);
});

test('ordem padrão por nome sem acento; valores vazios aparecem como traço e formatos pt-BR', () => {
  const { q } = setup();
  assert.deepEqual(q.names(), ['Ana Souza', 'Bruno Lima', 'Diego Ferraz', 'Érica Dias']);
  const diego = q.rows()[2].children;
  assert.equal(diego[2].textContent, '—');
  assert.equal(diego[4].textContent, '—');
  assert.equal(flat(q.rows()[0].children[2].textContent), 'R$ 250,00');
  assert.equal(q.rows()[0].children[4].textContent, '10/09/2026');
});

test('ordenar: clique alterna crescente/decrescente, anuncia aria-sort, número começa do maior e vazios ficam por último', () => {
  const { q } = setup();
  const sortOf = (i) => q.head()[i].getAttribute('aria-sort');
  assert.equal(sortOf(0), 'ascending');
  q.head()[0].children[0].listeners.click();
  assert.equal(sortOf(0), 'descending');
  assert.deepEqual(q.names(), ['Érica Dias', 'Diego Ferraz', 'Bruno Lima', 'Ana Souza']);
  q.head()[2].children[0].listeners.click();
  assert.equal(sortOf(2), 'descending');
  assert.deepEqual(q.names(), ['Ana Souza', 'Bruno Lima', 'Érica Dias', 'Diego Ferraz'], 'sem valor por último');
  q.head()[2].children[0].listeners.click();
  assert.deepEqual(q.names(), ['Érica Dias', 'Bruno Lima', 'Ana Souza', 'Diego Ferraz'], 'continua por último no crescente');
  assert.equal(q.head()[5].getAttribute('aria-sort'), null, 'ações não ordenam');
});

test('filtro de texto (sem acento), lista, faixa numérica e período; contagem e limpar', () => {
  const { q } = setup();
  const filterOf = (i) => q.filters()[i].children;
  filterOf(0)[0].value = 'erica';
  filterOf(0)[0].listeners.input();
  assert.deepEqual(q.names(), ['Érica Dias']);
  assert.equal(q.btn('Limpar filtros').disabled, false);
  q.btn('Limpar filtros').listeners.click();
  assert.equal(q.rows().length, 4);
  assert.equal(q.btn('Limpar filtros').disabled, true);

  assert.deepEqual(filterOf(1)[0].options.map((o) => o.value), ['', 'Paga', 'Pendente']);
  filterOf(1)[0].value = 'Pendente';
  filterOf(1)[0].listeners.change();
  assert.deepEqual(q.names(), ['Bruno Lima', 'Érica Dias']);

  filterOf(2)[0].value = '190';
  filterOf(2)[0].listeners.input();
  assert.deepEqual(q.names(), ['Bruno Lima']);
  filterOf(2)[1].value = '150';
  filterOf(2)[1].listeners.input();
  assert.deepEqual(q.names(), [], 'min 190 e max 150 não casa ninguém');
  assert.equal(q.empty().hidden, false);
  assert.equal(q.btn('Exportar planilha (CSV)').disabled, true);
});

test('filtro por período usa data inicial e final', () => {
  const { q } = setup();
  const f = q.filters()[4].children;
  f[0].value = '2026-09-01';
  f[0].listeners.input();
  assert.deepEqual(q.names(), ['Ana Souza', 'Érica Dias']);
  f[1].value = '2026-09-15';
  f[1].listeners.input();
  assert.deepEqual(q.names(), ['Ana Souza']);
});

test('rodapé: contagem e total da primeira coluna de dinheiro visível, sobre as linhas filtradas', () => {
  const { q } = setup();
  assert.equal(flat(q.foot().textContent), '4 registros · Valor: R$ 630,00');
  q.filters()[1].children[0].value = 'Paga';
  q.filters()[1].children[0].listeners.change();
  assert.equal(flat(q.foot().textContent), '2 de 4 registros · Valor: R$ 250,00');
  assert.equal(q.bar().children[3].textContent, '2 de 4 registros');
});

test('seletor de colunas: abrir, esconder, reordenar com setas, restaurar; preferências salvas só com as chaves', () => {
  const { q, storage } = setup();
  q.btn('Colunas').listeners.click();
  assert.equal(q.picker().hidden, false);
  const list = () => q.picker().children[1].children;
  const labels = () => list().map((li) => li.children[0].children[1].textContent);
  assert.deepEqual(labels(), ['Aluno', 'Status', 'Valor', 'Meses', 'Vencimento', 'Observação'], 'mostradas primeiro, depois as ocultas');
  // mostrar Observação
  list()[5].children[0].children[0].checked = true;
  list()[5].children[0].children[0].listeners.change();
  assert.deepEqual(q.headers(), ['Aluno', 'Status', 'Valor', 'Meses', 'Vencimento', 'Observação', 'Ações']);
  // esconder Status
  q.picker().children[1].children[1].children[0].children[0].checked = false;
  q.picker().children[1].children[1].children[0].children[0].listeners.change();
  assert.deepEqual(q.headers(), ['Aluno', 'Valor', 'Meses', 'Vencimento', 'Observação', 'Ações']);
  // mover Valor para o fim das visíveis (seta para depois)
  const valorRow = q.picker().children[1].children[1];
  valorRow.children[2].listeners.click();
  assert.deepEqual(q.headers(), ['Aluno', 'Meses', 'Valor', 'Vencimento', 'Observação', 'Ações']);
  assert.deepEqual(JSON.parse(storage.data.get('gbitu.colunas.teste')), { v: 1, cols: ['nome', 'meses', 'valor', 'venc', 'obs'] });
  // restaurar o padrão
  q.picker().children[2].listeners.click();
  assert.deepEqual(q.headers(), ['Aluno', 'Status', 'Valor', 'Meses', 'Vencimento', 'Ações']);
});

test('preferência salva é aplicada ao recriar a tabela; chaves inválidas ou armazenamento quebrado voltam ao padrão', () => {
  const storage = memory({ 'gbitu.colunas.teste': JSON.stringify({ v: 1, cols: ['valor', 'nome', 'xx', 'nome'] }) });
  assert.deepEqual(setup({ storage }).q.headers(), ['Valor', 'Aluno', 'Ações']);
  const bad = memory({ 'gbitu.colunas.teste': '{não é json' });
  assert.deepEqual(setup({ storage: bad }).q.headers(), ['Aluno', 'Status', 'Valor', 'Meses', 'Vencimento', 'Ações']);
  const throwing = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  const s = setup({ storage: throwing });
  s.q.btn('Colunas').listeners.click();
  s.q.picker().children[1].children[0].children[0].children[0].checked = false;
  s.q.picker().children[1].children[0].children[0].children[0].listeners.change();
  assert.equal(s.q.headers()[0], 'Status', 'funciona mesmo sem poder salvar');
  assert.deepEqual(setup({ storage: null }).q.headers().length, 6);
});

test('sempre sobra ao menos uma coluna visível', () => {
  const { q } = setup({ columns: COLUMNS.filter((c) => ['nome', 'acoes'].includes(c.key)) });
  q.btn('Colunas').listeners.click();
  const box = q.picker().children[1].children[0].children[0].children[0];
  box.checked = false;
  box.listeners.change();
  assert.deepEqual(q.headers(), ['Aluno', 'Ações']);
});

test('exportar CSV: colunas visíveis (sem Ações), linhas filtradas e ordenadas, BOM, ponto e vírgula e vírgula decimal', () => {
  const { q, files } = setup();
  q.filters()[1].children[0].value = 'Pendente';
  q.filters()[1].children[0].listeners.change();
  q.btn('Exportar planilha (CSV)').listeners.click();
  assert.equal(files[0].name, 'teste.csv');
  assert.deepEqual(files[0].text.split('\r\n').slice(0, 3), ['﻿Aluno;Status;Valor;Meses;Vencimento', 'Bruno Lima;Pendente;200,00;3;10/08/2026', 'Érica Dias;Pendente;180,00;1;28/09/2026']);
});

test('célula personalizada (botão de ação) é desenhada por linha; texto dos dados é literal', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { q } = setup({ rows: [{ ...ROWS[0], nome: evil }] });
  assert.equal(q.rows()[0].children[0].textContent, evil);
  assert.equal(q.rows()[0].children[5].children[0].textContent, 'Abrir ' + evil);
});

test('reset limpa linhas, filtros, ordem e o seletor; setRows refaz a lista', () => {
  const { q, t } = setup();
  q.filters()[0].children[0].value = 'ana';
  q.filters()[0].children[0].listeners.input();
  t.reset();
  assert.equal(q.rows().length, 0);
  assert.equal(t.state().total, 0);
  assert.deepEqual(t.state().filters, {});
  t.setRows(ROWS);
  assert.equal(q.rows().length, 4);
  assert.equal(t.state().shown, 4);
});
