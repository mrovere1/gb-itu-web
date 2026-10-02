// Cartão "Receita prevista × recebida": anel de realização do mês com a composição, e colunas comparativas dos últimos meses.
// SVG gerado por JS (sem biblioteca, sem estilo inline: tudo por atributos e classes). Não importa nada.
// Texto do servidor entra sempre por textContent/atributos.

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const RING_R = 50;
const RING_C = 2 * Math.PI * RING_R;
const PLOT = { w: 720, h: 280, left: 64, right: 12, top: 16, bottom: 34 };

export const monthLabel = (c) => (/^\d{4}-\d{2}$/.test(c) ? MONTHS[parseInt(c.slice(5), 10) - 1] + '/' + c.slice(2, 4) : String(c));
export const money = (n) => MONEY.format(n);
export const pct = (n) => PCT.format(n) + '%';
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/** Teto "redondo" do eixo e o passo entre as linhas de grade (4 intervalos). */
export function niceScale(max) {
  const safe = max > 0 ? max : 1;
  const rough = safe / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough);
  return { step, max: step * 4 };
}

export function axisLabel(v) {
  if (v === 0) return '0';
  if (v >= 1000) return (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return String(v);
}

/** Realização = recebido ÷ previsto, em %. Sem previsão: null (nunca 0% enganoso). */
export const realization = (m) => (num(m.prevista) > 0 ? (num(m.recebida) / m.prevista) * 100 : null);

function chipClass(p) {
  if (p == null) return 'chip chip-neutro';
  if (p >= 90) return 'chip chip-paga';
  if (p >= 60) return 'chip chip-pendente';
  return 'chip chip-vencida';
}

export function renderRevenueCard({ doc, box, chart }) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svg = (tag, attrs, text) => {
    const n = doc.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, String(attrs[k])));
    if (text !== undefined) n.textContent = text;
    return n;
  };
  box.textContent = '';
  const meses = chart && Array.isArray(chart.meses) ? chart.meses : [];
  if (!chart || chart.estado !== 'ok' || meses.length === 0) {
    box.appendChild(el('p', 'muted', (chart && chart.mensagem) || 'Ainda sem dados.'));
    return;
  }
  const last = meses[meses.length - 1];

  // ---- cabeçalho: legenda e variação ----
  const head = el('div', 'rev-head');
  const legend = el('p', 'rev-legend');
  [['rev-key rev-key-prev', 'Previsto'], ['rev-key rev-key-rec', 'Recebido']].forEach(([cls, label]) => {
    const item = el('span', 'rev-legend-item');
    item.appendChild(el('span', cls));
    item.appendChild(el('span', '', label));
    legend.appendChild(item);
  });
  head.appendChild(legend);
  if (typeof chart.variacao === 'number') {
    const up = chart.variacao >= 0;
    head.appendChild(el('span', 'chip ' + (up ? 'chip-paga' : 'chip-vencida'), (up ? '+' : '−') + pct(Math.abs(chart.variacao)) + ' vs mês anterior'));
  }
  box.appendChild(head);

  const body = el('div', 'rev-body');

  // ---- anel + composição do mês ----
  const left = el('div', 'rev-left');
  const mes = chart.mes;
  const real = realization(last);
  const ring = svg('svg', { viewBox: '0 0 120 120', class: 'rev-ring', role: 'img', 'aria-label': real == null ? 'Sem previsão neste mês' : 'Realização do mês: ' + pct(real) + ' do previsto já recebido' });
  ring.appendChild(svg('circle', { cx: 60, cy: 60, r: RING_R, class: 'rev-ring-track', fill: 'none', 'stroke-width': 12 }));
  if (real != null) {
    const filled = Math.min(real, 100) / 100 * RING_C;
    ring.appendChild(svg('circle', {
      cx: 60, cy: 60, r: RING_R, class: 'rev-ring-bar', fill: 'none', 'stroke-width': 12, 'stroke-linecap': 'round',
      'stroke-dasharray': filled.toFixed(2) + ' ' + RING_C.toFixed(2), transform: 'rotate(-90 60 60)',
    }));
  }
  const ringBox = el('div', 'rev-ring-box');
  ringBox.appendChild(ring);
  const center = el('div', 'rev-ring-center');
  center.appendChild(el('strong', 'rev-ring-pct', real == null ? '—' : pct(real)));
  center.appendChild(el('span', 'muted', real == null ? 'sem previsão' : 'do previsto já recebido'));
  ringBox.appendChild(center);
  left.appendChild(ringBox);

  if (mes) {
    const parts = [
      ['Recebido', mes.recebido, 'dot dot-rec'], ['Coberto por pacote', mes.pacote, 'dot dot-pacote'],
      ['A vencer', mes.aVencer, 'dot dot-avencer'], ['Em aberto vencido', mes.emAberto, 'dot dot-vencido'],
    ];
    const list = el('ul', 'rev-parts');
    parts.forEach(([label, value, cls]) => {
      const li = doc.createElement('li');
      li.appendChild(el('span', cls));
      li.appendChild(el('span', 'rev-part-label', label));
      li.appendChild(el('strong', '', money(num(value))));
      list.appendChild(li);
    });
    left.appendChild(list);
    const total = parts.reduce((t, p) => t + num(p[1]), 0);
    if (total > 0) {
      const bar = svg('svg', { viewBox: '0 0 100 8', class: 'rev-stack', role: 'img', preserveAspectRatio: 'none', 'aria-label': 'Composição do mês' });
      let x = 0;
      parts.forEach(([label, value, cls]) => {
        const w = (num(value) / total) * 100;
        if (w <= 0) return;
        bar.appendChild(svg('rect', { x: x.toFixed(2), y: 0, width: w.toFixed(2), height: 8, class: 'rev-seg ' + cls.split(' ')[1], 'data-label': label }));
        x += w;
      });
      left.appendChild(bar);
    }
  }
  body.appendChild(left);

  // ---- colunas comparativas ----
  const right = el('div', 'rev-right');
  const callout = el('p', 'rev-callout');
  const callText = (m) => {
    const r = realization(m);
    return monthLabel(m.competencia) + ' · Previsto ' + money(num(m.prevista)) + ' · Recebido ' + money(num(m.recebida)) + (r == null ? '' : ' · ' + pct(r) + ' realizado');
  };
  callout.textContent = callText(last);
  right.appendChild(callout);

  const scale = niceScale(Math.max(...meses.map((m) => Math.max(num(m.prevista), num(m.recebida)))));
  const pw = PLOT.w - PLOT.left - PLOT.right;
  const ph = PLOT.h - PLOT.top - PLOT.bottom;
  const gw = pw / meses.length;
  const bw = Math.min(34, gw * 0.28);
  const yOf = (v) => PLOT.top + ph - (Math.min(v, scale.max) / scale.max) * ph;
  const chartSvg = svg('svg', { viewBox: '0 0 ' + PLOT.w + ' ' + PLOT.h, class: 'rev-chart', role: 'group', 'aria-label': 'Receita prevista e recebida por mês' });
  for (let i = 0; i <= 4; i++) {
    const v = scale.step * i;
    const y = yOf(v);
    chartSvg.appendChild(svg('line', { x1: PLOT.left, x2: PLOT.w - PLOT.right, y1: y.toFixed(1), y2: y.toFixed(1), class: 'rev-grid' }));
    chartSvg.appendChild(svg('text', { x: PLOT.left - 8, y: (y + 4).toFixed(1), class: 'rev-axis', 'text-anchor': 'end' }, axisLabel(v)));
  }
  meses.forEach((m, i) => {
    const x0 = PLOT.left + gw * i;
    const isLast = i === meses.length - 1;
    const g = svg('g', { class: 'rev-group' + (isLast ? ' rev-group-selected' : ''), tabindex: 0, role: 'img', 'aria-label': callText(m) });
    g.appendChild(svg('title', {}, callText(m)));
    g.appendChild(svg('rect', { x: x0.toFixed(1), y: PLOT.top, width: gw.toFixed(1), height: ph, class: 'rev-band' }));
    [['rev-bar rev-bar-prev', num(m.prevista), -bw - 3], ['rev-bar rev-bar-rec', num(m.recebida), 3]].forEach(([cls, v, dx]) => {
      const y = yOf(v);
      const h = v > 0 ? Math.max(PLOT.top + ph - y, 1) : 0;
      g.appendChild(svg('rect', { x: (x0 + gw / 2 + dx).toFixed(1), y: (PLOT.top + ph - h).toFixed(1), width: bw.toFixed(1), height: h.toFixed(1), class: cls, rx: 2 }));
    });
    g.appendChild(svg('text', { x: (x0 + gw / 2).toFixed(1), y: PLOT.h - 12, class: 'rev-month' + (isLast ? ' rev-month-selected' : ''), 'text-anchor': 'middle' }, monthLabel(m.competencia)));
    const show = () => { callout.textContent = callText(m); };
    g.addEventListener('mouseenter', show);
    g.addEventListener('focus', show);
    chartSvg.appendChild(g);
  });
  right.appendChild(chartSvg);

  const chips = el('ul', 'rev-chips');
  chips.setAttribute('aria-label', 'Realização por mês (recebido ÷ previsto)');
  meses.forEach((m) => {
    const r = realization(m);
    const li = doc.createElement('li');
    li.appendChild(el('span', chipClass(r), r == null ? '—' : pct(r)));
    chips.appendChild(li);
  });
  right.appendChild(chips);
  body.appendChild(right);
  box.appendChild(body);
}
