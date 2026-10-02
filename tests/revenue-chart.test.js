import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRevenueCard, niceScale, axisLabel, realization, monthLabel, pct } from '../js/revenue-chart.js';
import { createDom } from './helpers/dom-env.js';
import { ADMIN, flat } from './helpers/dash-fixtures.js';

const CHART = ADMIN.graficos.receitaPrevistaRecebida;
function draw(chart = CHART) {
  const dom = createDom();
  const box = dom.$('chart-revenue');
  renderRevenueCard({ doc: dom.doc, box, chart });
  const [head, body] = box.children;
  const [left, right] = body ? body.children : [];
  return { dom, box, head, body, left, right };
}

test('escala do eixo: teto redondo com 4 intervalos e rótulos compactos em pt-BR', () => {
  assert.deepEqual(niceScale(25100), { step: 10000, max: 40000 });
  assert.deepEqual(niceScale(1000), { step: 250, max: 1000 });
  assert.deepEqual(niceScale(0), { step: 0.25, max: 1 });
  assert.equal(axisLabel(0), '0');
  assert.equal(axisLabel(10000), '10 mil');
  assert.equal(axisLabel(1500), '1,5 mil');
  assert.equal(axisLabel(500), '500');
});

test('realização = recebido ÷ previsto; sem previsão é nulo (nunca 0% enganoso)', () => {
  assert.equal(realization({ prevista: 1000, recebida: 250 }), 25);
  assert.equal(realization({ prevista: 1000, recebida: 1500 }), 150);
  assert.equal(realization({ prevista: 0, recebida: 500 }), null);
  assert.equal(monthLabel('2026-09'), 'set/26');
  assert.equal(pct(23.4), '23,4%');
});

test('estado de espera: só a mensagem', () => {
  const { box } = draw({ estado: 'aguardando', mensagem: 'Aguardando importação das mensalidades' });
  assert.equal(box.children.length, 1);
  assert.equal(box.children[0].textContent, 'Aguardando importação das mensalidades');
  assert.equal(draw(null).box.children[0].textContent, 'Ainda sem dados.');
  assert.equal(draw({ estado: 'ok', meses: [] }).box.children[0].textContent, 'Ainda sem dados.');
});

test('cabeçalho: legenda Previsto/Recebido e variação sobre o mês anterior', () => {
  const { head } = draw();
  assert.deepEqual(head.children[0].children.map((i) => i.children[1].textContent), ['Previsto', 'Recebido']);
  assert.equal(head.children[1].textContent, '+9,3% vs mês anterior');
  assert.equal(head.children[1].className, 'chip chip-paga');
  const down = draw({ ...CHART, variacao: -12.5 }).head.children[1];
  assert.equal(down.textContent, '−12,5% vs mês anterior');
  assert.equal(down.className, 'chip chip-vencida');
  assert.equal(draw({ ...CHART, variacao: null }).head.children.length, 1);
});

test('anel: percentual do mês no centro, arco proporcional (limitado ao círculo) e rótulo acessível', () => {
  const { left } = draw();
  const ringBox = left.children[0];
  const svg = ringBox.children[0];
  assert.equal(svg.getAttribute('role'), 'img');
  assert.match(svg.getAttribute('aria-label'), /Realização do mês: 105,0% do previsto já recebido/);
  assert.equal(ringBox.children[1].children[0].textContent, '105,0%');
  assert.equal(ringBox.children[1].children[1].textContent, 'do previsto já recebido');
  const bar = svg.children[1];
  const C = 2 * Math.PI * 50;
  assert.equal(bar.getAttribute('stroke-dasharray'), C.toFixed(2) + ' ' + C.toFixed(2));
  const half = draw({ ...CHART, meses: [{ competencia: '2026-10', prevista: 1000, recebida: 500 }] }).left.children[0].children[0].children[1];
  assert.equal(half.getAttribute('stroke-dasharray'), (C / 2).toFixed(2) + ' ' + C.toFixed(2));
  assert.equal(half.getAttribute('transform'), 'rotate(-90 60 60)');
});

test('sem previsão no mês: anel sem arco e texto "sem previsão"', () => {
  const { left } = draw({ ...CHART, meses: [{ competencia: '2026-10', prevista: 0, recebida: 0 }], mes: null });
  assert.equal(left.children[0].children[0].children.length, 1, 'só a trilha');
  assert.equal(left.children[0].children[1].children[0].textContent, '—');
  assert.equal(left.children[0].children[1].children[1].textContent, 'sem previsão');
  assert.equal(left.children.length, 1, 'sem composição quando o mês não tem lançamento');
});

test('composição do mês: recebido, pacote, a vencer e em aberto vencido, com barra empilhada', () => {
  const { left } = draw();
  const items = left.children[1].children.map((li) => [li.children[1].textContent, flat(li.children[2].textContent)]);
  assert.deepEqual(items, [['Recebido', 'R$ 1.050,00'], ['Coberto por pacote', 'R$ 200,00'], ['A vencer', 'R$ 450,00'], ['Em aberto vencido', 'R$ 860,00']]);
  const stack = left.children[2];
  assert.equal(stack.getAttribute('role'), 'img');
  const widths = stack.children.map((r) => Number(r.getAttribute('width')));
  assert.equal(stack.children.length, 4);
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.05);
  assert.deepEqual(stack.children.map((r) => r.getAttribute('class').split(' ')[1]), ['dot-rec', 'dot-pacote', 'dot-avencer', 'dot-vencido']);
});

test('composição com partes zeradas não desenha segmentos vazios', () => {
  const { left } = draw({ ...CHART, mes: { previsto: 100, recebido: 100, pacote: 0, aVencer: 0, emAberto: 0 } });
  assert.equal(left.children[2].children.length, 1);
});

test('colunas: eixo com linhas de grade e rótulos, um grupo por mês, o último em destaque', () => {
  const { right } = draw();
  const svg = right.children[1];
  assert.equal(svg.getAttribute('viewBox'), '0 0 720 280');
  const lines = svg.children.filter((n) => n.tag === 'line');
  assert.equal(lines.length, 5);
  assert.deepEqual(svg.children.filter((n) => n.tag === 'text').map((t) => t.textContent), ['0', '10 mil', '20 mil', '30 mil', '40 mil']);
  const groups = svg.children.filter((n) => n.tag === 'g');
  assert.equal(groups.length, 6);
  assert.equal(groups[5].getAttribute('class'), 'rev-group rev-group-selected');
  assert.equal(groups[0].getAttribute('class'), 'rev-group');
  assert.equal(groups[0].getAttribute('tabindex'), '0');
  assert.deepEqual(groups.map((g) => g.children[g.children.length - 1].textContent), ['mai/26', 'jun/26', 'jul/26', 'ago/26', 'set/26', 'out/26']);
});

test('barras na mesma escala: altura proporcional ao valor, previsto cinza e recebido vermelho', () => {
  const { right } = draw();
  const groups = right.children[1].children.filter((n) => n.tag === 'g');
  const sept = groups[4];
  const bars = sept.children.filter((n) => (n.getAttribute('class') || '').startsWith('rev-bar'));
  const ph = 280 - 16 - 34;
  const hPrev = Number(bars[0].getAttribute('height'));
  const hRec = Number(bars[1].getAttribute('height'));
  assert.equal(bars[0].getAttribute('class'), 'rev-bar rev-bar-prev');
  assert.equal(bars[1].getAttribute('class'), 'rev-bar rev-bar-rec');
  assert.ok(Math.abs(hPrev - (23500 / 40000) * ph) < 0.2, String(hPrev));
  assert.ok(Math.abs(hRec - (5500 / 40000) * ph) < 0.2, String(hRec));
  assert.ok(hPrev > hRec);
});

test('grupos têm rótulo e título acessíveis com previsto, recebido e realização', () => {
  const { right } = draw();
  const g = right.children[1].children.filter((n) => n.tag === 'g')[5];
  const label = flat(g.getAttribute('aria-label'));
  assert.equal(label, 'out/26 · Previsto R$ 1.000,00 · Recebido R$ 1.050,00 · 105,0% realizado');
  assert.equal(flat(g.children[0].textContent), label);
  assert.equal(g.getAttribute('role'), 'img');
});

test('texto de destaque começa no último mês e acompanha o mouse e o foco', () => {
  const { right } = draw();
  const callout = right.children[0];
  assert.equal(flat(callout.textContent), 'out/26 · Previsto R$ 1.000,00 · Recebido R$ 1.050,00 · 105,0% realizado');
  const g = right.children[1].children.filter((n) => n.tag === 'g')[4];
  g.listeners.mouseenter();
  assert.equal(flat(callout.textContent), 'set/26 · Previsto R$ 23.500,00 · Recebido R$ 5.500,00 · 23,4% realizado');
  const first = right.children[1].children.filter((n) => n.tag === 'g')[0];
  first.listeners.focus();
  assert.match(flat(callout.textContent), /^mai\/26/);
});

test('chips de realização por mês: verde a partir de 90%, âmbar de 60 a 89%, vermelho abaixo de 60%', () => {
  const { right } = draw();
  const chips = right.children[2].children.map((li) => li.children[0]);
  assert.deepEqual(chips.map((c) => c.textContent), ['76,4%', '50,2%', '21,5%', '20,4%', '23,4%', '105,0%']);
  assert.deepEqual(chips.map((c) => c.className), [
    'chip chip-pendente', 'chip chip-vencida', 'chip chip-vencida', 'chip chip-vencida', 'chip chip-vencida', 'chip chip-paga',
  ]);
  const none = draw({ ...CHART, meses: [{ competencia: '2026-10', prevista: 0, recebida: 5 }] }).right.children[2].children[0].children[0];
  assert.equal(none.textContent, '—');
  assert.equal(none.className, 'chip chip-neutro');
});

test('mês acima do previsto (venda de pacote) não estoura o gráfico: o eixo cresce para caber', () => {
  const { right } = draw({ ...CHART, meses: [{ competencia: '2026-01', prevista: 18674, recebida: 41044 }, { competencia: '2026-02', prevista: 20007, recebida: 23467 }] });
  const labels = right.children[1].children.filter((n) => n.tag === 'text').map((t) => t.textContent);
  assert.equal(labels[labels.length - 1], '80 mil');
  const bars = right.children[1].children.filter((n) => n.tag === 'g')[0].children.filter((n) => (n.getAttribute('class') || '').startsWith('rev-bar'));
  assert.ok(Number(bars[1].getAttribute('height')) <= 280 - 16 - 34);
});

test('mensagem do servidor com HTML aparece literalmente', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.equal(draw({ estado: 'aguardando', mensagem: evil }).box.children[0].textContent, evil);
});

test('refazer o desenho limpa o anterior', () => {
  const dom = createDom();
  const box = dom.$('chart-revenue');
  renderRevenueCard({ doc: dom.doc, box, chart: CHART });
  renderRevenueCard({ doc: dom.doc, box, chart: { estado: 'aguardando', mensagem: 'x' } });
  assert.equal(box.children.length, 1);
});
