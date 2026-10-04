import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthSelect, describeSelection, monthChoices } from '../js/month-select.js';
import { createDom } from './helpers/dom-env.js';

const OPTIONS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

function setup({ options = OPTIONS, value = ['2026-09'] } = {}) {
  const dom = createDom();
  const changes = [];
  const ms = createMonthSelect({ doc: dom.doc, id: 'dash-comp', onChange: (list) => changes.push(list) });
  ms.setOptions(options);
  ms.setValue(value);
  const boxes = () => dom.$('dash-comp-list').children.map((label) => label.children[0]);
  const box = (iso) => boxes().find((b) => b.value === iso);
  const toggle = (iso, checked) => { const b = box(iso); b.checked = checked; b.listeners.change(); };
  const open = () => dom.click('dash-comp-btn');
  return { dom, ms, changes, boxes, box, toggle, open };
}

test('rótulo do botão: um mês, sequência, poucos meses salteados, muitos meses e todos', () => {
  assert.equal(describeSelection(['2026-09'], OPTIONS), 'Setembro/2026');
  assert.equal(describeSelection(['2026-07', '2026-08', '2026-09'], OPTIONS), 'jul/26–set/26 (3 meses)');
  assert.equal(describeSelection(['2026-06', '2026-08'], OPTIONS), 'jun/26, ago/26');
  assert.equal(describeSelection(['2026-06', '2026-07', '2026-09', '2026-10'], OPTIONS), '4 meses selecionados');
  assert.equal(describeSelection(OPTIONS, OPTIONS), 'Todos os meses (5)');
  assert.equal(describeSelection([], OPTIONS), 'Escolha o mês');
});

test('começa fechado, com o rótulo da seleção atual e o estado acessível do botão', () => {
  const { dom } = setup();
  assert.equal(dom.$('dash-comp-btn').textContent, 'Setembro/2026');
  assert.equal(dom.$('dash-comp-panel').hidden, true);
  assert.equal(dom.$('dash-comp-btn').getAttribute('aria-expanded'), 'false');
  assert.equal(dom.$('dash-comp-backdrop').hidden, true);
});

test('abrir: lista os meses do mais recente ao mais antigo, marca a seleção e coloca o foco na lista', () => {
  const { dom, open, boxes, box } = setup({ value: ['2026-08', '2026-09'] });
  open();
  assert.equal(dom.$('dash-comp-panel').hidden, false);
  assert.equal(dom.$('dash-comp-btn').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(boxes().map((b) => b.value), ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06']);
  assert.deepEqual(boxes().filter((b) => b.checked).map((b) => b.value), ['2026-09', '2026-08']);
  assert.equal(dom.$('dash-comp-all').checked, false);
  assert.ok(box('2026-10').focused > 0);
  assert.equal(dom.$('dash-comp-backdrop').hidden, false);
});

test('marcar vários meses e Aplicar: devolve os meses em ordem, atualiza o rótulo e fecha', () => {
  const { dom, changes, open, toggle } = setup();
  open();
  toggle('2026-07', true);
  toggle('2026-08', true);
  dom.click('dash-comp-apply');
  assert.deepEqual(changes, [['2026-07', '2026-08', '2026-09']]);
  assert.equal(dom.$('dash-comp-btn').textContent, 'jul/26–set/26 (3 meses)');
  assert.equal(dom.$('dash-comp-panel').hidden, true);
  assert.ok(dom.$('dash-comp-btn').focused > 0, 'o foco volta ao botão');
});

test('"Todos os meses" marca e desmarca tudo; com todos marcados o rótulo diz "Todos os meses"', () => {
  const { dom, changes, open, boxes } = setup();
  open();
  dom.$('dash-comp-all').checked = true;
  dom.$('dash-comp-all').listeners.change();
  assert.equal(boxes().every((b) => b.checked), true);
  dom.click('dash-comp-apply');
  assert.deepEqual(changes, [OPTIONS]);
  assert.equal(dom.$('dash-comp-btn').textContent, 'Todos os meses (5)');
  open();
  assert.equal(dom.$('dash-comp-all').checked, true, 'reabrir mostra "Todos" marcado');
  dom.$('dash-comp-all').checked = false;
  dom.$('dash-comp-all').listeners.change();
  assert.equal(boxes().some((b) => b.checked), false);
});

test('desmarcar um mês desmarca "Todos"; marcar o último que faltava marca "Todos"', () => {
  const { dom, open, toggle } = setup({ value: OPTIONS });
  open();
  assert.equal(dom.$('dash-comp-all').checked, true);
  toggle('2026-06', false);
  assert.equal(dom.$('dash-comp-all').checked, false);
  toggle('2026-06', true);
  assert.equal(dom.$('dash-comp-all').checked, true);
});

test('Aplicar sem nenhum mês: avisa e não muda nada nem fecha', () => {
  const { dom, changes, open, toggle } = setup();
  open();
  toggle('2026-09', false);
  dom.click('dash-comp-apply');
  assert.deepEqual(changes, []);
  assert.equal(dom.$('dash-comp-panel').hidden, false);
  assert.match(dom.$('dash-comp-msg').textContent, /pelo menos um mês/);
  assert.equal(dom.$('dash-comp-msg').hidden, false);
});

test('Aplicar sem mudar a seleção não dispara nova carga', () => {
  const { dom, changes, open } = setup();
  open();
  dom.click('dash-comp-apply');
  assert.deepEqual(changes, []);
  assert.equal(dom.$('dash-comp-panel').hidden, true);
});

test('Cancelar, Escape e o fundo fecham sem aplicar, e a próxima abertura volta à seleção salva', () => {
  for (const how of ['cancelar', 'escape', 'fundo']) {
    const { dom, changes, open, toggle, boxes } = setup();
    open();
    toggle('2026-06', true);
    if (how === 'cancelar') dom.click('dash-comp-cancel');
    if (how === 'escape') dom.docListeners.keydown.forEach((fn) => fn({ key: 'Escape' }));
    if (how === 'fundo') dom.click('dash-comp-backdrop');
    assert.equal(dom.$('dash-comp-panel').hidden, true, how);
    assert.equal(dom.$('dash-comp-btn').getAttribute('aria-expanded'), 'false', how);
    assert.deepEqual(changes, [], how);
    open();
    assert.deepEqual(boxes().filter((b) => b.checked).map((b) => b.value), ['2026-09'], how);
  }
});

test('o botão alterna abrir/fechar', () => {
  const { dom, open } = setup();
  open();
  assert.equal(dom.$('dash-comp-panel').hidden, false);
  open();
  assert.equal(dom.$('dash-comp-panel').hidden, true);
});

test('setValue com mês fora das opções mantém a opção para não perder a seleção', () => {
  const { dom, open, boxes } = setup({ value: ['2026-01'] });
  assert.equal(dom.$('dash-comp-btn').textContent, 'Janeiro/2026');
  open();
  assert.ok(boxes().some((b) => b.value === '2026-01' && b.checked));
});

test('reset fecha o painel e limpa o rótulo; setOptions vazio não quebra', () => {
  const { dom, ms, open } = setup();
  open();
  ms.reset();
  assert.equal(dom.$('dash-comp-panel').hidden, true);
  assert.equal(dom.$('dash-comp-btn').textContent, 'Escolha o mês');
  ms.setOptions([]);
  open();
  assert.equal(dom.$('dash-comp-list').children.length, 0);
});

test('monthChoices: do janeiro do ano anterior até 36 meses à frente, sem repetição, e inclui meses extras fora da faixa', () => {
  const list = monthChoices('2026-10-04');
  assert.equal(list[0], '2025-01');
  assert.equal(list[list.length - 1], '2029-10');
  assert.equal(new Set(list).size, list.length);
  assert.ok(list.includes('2026-10'));
  const extra = monthChoices('2026-10-04', ['2019-12', '2035-01', '2026-10', 'lixo']);
  assert.equal(extra[0], '2019-12');
  assert.equal(extra[extra.length - 1], '2035-01');
  assert.equal(extra.includes('lixo'), false);
  assert.equal(extra.filter((v) => v === '2026-10').length, 1);
});
