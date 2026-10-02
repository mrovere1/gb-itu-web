// Visão completa do painel (somente Administrador): cartões, gráficos, aniversariantes e área de trabalho.
// Texto do servidor entra sempre por textContent. Recebe doc e callbacks por injeção; não chama a rede.
import { renderRevenueCard } from './revenue-chart.js?v=459aba66e2';
import { createWorkspace } from './workspace.js?v=459aba66e2';
import { deltaChip, deltaInfo } from './delta.js?v=459aba66e2';

const NUMBER = new Intl.NumberFormat('pt-BR');
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PERCENT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const pad2 = (n) => String(n).padStart(2, '0');

export function formatIndicator(i) {
  if (i.formato === 'moeda') return MONEY.format(i.valor);
  if (i.formato === 'percentual') return PERCENT.format(i.valor) + '%';
  return NUMBER.format(i.valor);
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function createAdminDashboard({ doc, openStudent, openMensalidade = () => {}, download = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  const workspace = createWorkspace({ doc, openStudent, openMensalidade, download });

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function assertShape(data) {
    const ok = data && data.indicadores && Array.isArray(data.indicadores.principais) && Array.isArray(data.indicadores.complementares)
      && data.graficos && data.graficos.situacaoAlunos && Array.isArray(data.aniversariantes)
      && data.detalhes && Array.isArray(data.detalhes.alunosAtivos) && Array.isArray(data.detalhes.novasMatriculas);
    if (!ok) throw new Error('painel malformado');
  }

  // ---------- Cartões ----------
  function formatAnterior(a, formato) {
    return formatIndicator({ formato, valor: a.valor });
  }

  function kpi(ind, big, data) {
    const hasList = ind.estado === 'ok' && ind.detalhe && Array.isArray(data.detalhes[ind.detalhe]);
    const info = ind.estado === 'ok' && ind.delta ? deltaInfo(ind.delta.pct, ind.delta.sentido) : null;
    const tone = info ? ' kpi-' + info.tone : '';
    const card = el(hasList ? 'button' : 'div', 'kpi' + (big ? ' kpi-big' : '') + (ind.estado === 'ok' ? tone : ' kpi-pending'));
    if (hasList) card.type = 'button';
    card.title = ind.ajuda;
    card.appendChild(el('span', 'kpi-title', ind.titulo));
    if (ind.estado === 'ok') {
      const main = el('div', 'kpi-main');
      main.appendChild(el('strong', 'kpi-value', formatIndicator(ind)));
      const chip = info ? deltaChip(doc, ind.delta.pct, ind.delta.sentido, ind.anterior && ind.anterior.rotulo) : null;
      if (chip) main.appendChild(chip);
      card.appendChild(main);
      if (ind.secundario) card.appendChild(el('span', 'muted', ind.secundario));
      if (ind.anterior && typeof ind.anterior.valor === 'number') card.appendChild(el('span', 'kpi-prev', ind.anterior.rotulo + ': ' + formatAnterior(ind.anterior, ind.formato)));
    } else {
      card.appendChild(el('span', 'kpi-msg', ind.mensagem));
    }
    card.appendChild(el('span', 'sr-only', 'Como é calculado: ' + ind.ajuda));
    if (hasList) {
      card.appendChild(el('span', 'kpi-open', 'Abrir área de trabalho →'));
      card.addEventListener('click', () => workspace.open(ind.detalhe, data, card));
    }
    return card;
  }

  function renderKpis(data) {
    const main = $('kpi-main');
    const more = $('kpi-more');
    main.textContent = '';
    more.textContent = '';
    data.indicadores.principais.forEach((i) => main.appendChild(kpi(i, true, data)));
    data.indicadores.complementares.forEach((i) => more.appendChild(kpi(i, false, data)));
  }

  // ---------- Gráficos ----------
  function emptyChart(box, message) {
    box.textContent = '';
    box.appendChild(el('p', 'muted', message));
  }

  function renderStatusChart(chart) {
    const box = $('chart-status');
    box.textContent = '';
    const items = Array.isArray(chart.itens) ? chart.itens : [];
    const total = items.reduce((sum, i) => sum + i.total, 0);
    if (chart.estado !== 'ok' || total === 0) { emptyChart(box, 'Ainda sem dados.'); return; }
    const max = Math.max(...items.map((i) => i.total));
    const list = el('ul', 'bars');
    items.forEach((i) => {
      const li = doc.createElement('li');
      li.appendChild(el('span', 'bar-label', i.status));
      const bar = el('progress', 'bar');
      bar.max = max;
      bar.value = i.total;
      bar.setAttribute('aria-label', i.status + ': ' + i.total + ' de ' + total + ' alunos');
      li.appendChild(bar);
      li.appendChild(el('strong', 'bar-count', NUMBER.format(i.total)));
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function renderAvisos(avisos) {
    const list = $('dash-avisos');
    list.textContent = '';
    (Array.isArray(avisos) ? avisos : []).forEach((text) => list.appendChild(el('li', '', text)));
    $('dash-avisos-box').hidden = list.children.length === 0;
  }

  // ---------- Aniversariantes ----------
  function renderBirthdays(list, pending) {
    const ul = $('bday-list');
    ul.textContent = '';
    $('bday-empty').hidden = list.length > 0 || pending;
    $('bday-pending').hidden = !(list.length === 0 && pending);
    list.forEach((a) => {
      const li = doc.createElement('li');
      const btn = el('button', 'bday-row');
      btn.type = 'button';
      btn.appendChild(el('span', 'avatar', initials(a.nome)));
      const info = el('span', 'bday-info');
      info.appendChild(el('span', 'student-name', a.nome));
      const when = pad2(a.dia) + '/' + pad2(a.mes) + (a.idade != null ? ' · completa ' + a.idade + ' anos' : '');
      info.appendChild(el('span', 'muted', when));
      btn.appendChild(info);
      if (a.hoje) btn.appendChild(el('span', 'tag tag-today', 'Hoje'));
      else if (a.proximos) btn.appendChild(el('span', 'tag tag-soon', 'Em breve'));
      btn.addEventListener('click', () => openStudent(a.student_id));
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function render(data) {
    assertShape(data);
    renderKpis(data);
    renderStatusChart(data.graficos.situacaoAlunos);
    renderRevenueCard({ doc, box: $('chart-revenue'), chart: data.graficos.receitaPrevistaRecebida });
    emptyChart($('chart-occupancy'), (data.graficos.ocupacaoTurmas || {}).mensagem || 'Ainda sem dados.');
    renderAvisos(data.avisos);
    renderBirthdays(data.aniversariantes, data.aniversariantesEstado === 'sem_datas');
    if (workspace.isOpen()) workspace.refresh(data);
    $('dash-admin').hidden = workspace.isOpen(); // com a área de trabalho aberta, o painel fica escondido
  }

  /** Apaga tudo do usuário anterior. */
  function reset() {
    workspace.reset();
    ['kpi-main', 'kpi-more', 'chart-status', 'chart-revenue', 'chart-occupancy', 'bday-list'].forEach((id) => { $(id).textContent = ''; });
    $('bday-empty').hidden = true;
    $('bday-pending').hidden = true;
    $('dash-avisos').textContent = '';
    $('dash-avisos-box').hidden = true;
    $('dash-admin').hidden = true;
  }

  return { render, reset, closeWorkspace: () => workspace.close(false) };
}
