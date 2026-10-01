// Visão completa do painel (somente Administrador): cartões, gráficos, aniversariantes e lista de detalhes.
// Texto do servidor entra sempre por textContent. Recebe doc e openStudent por injeção; não chama a rede.

const NUMBER = new Intl.NumberFormat('pt-BR');
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PERCENT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const SORTS = { az: 1, za: -1 };
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const pad2 = (n) => String(n).padStart(2, '0');

export function formatIndicator(i) {
  if (i.formato === 'moeda') return MONEY.format(i.valor);
  if (i.formato === 'percentual') return PERCENT.format(i.valor) + '%';
  return NUMBER.format(i.valor);
}

const dateBR = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const compBR = (c) => (/^\d{4}-\d{2}$/.test(c) ? c.slice(5) + '/' + c.slice(0, 4) : '');
const monthLabel = (c) => (/^\d{4}-\d{2}$/.test(c) ? MONTHS[parseInt(c.slice(5), 10) - 1] + '/' + c.slice(2, 4) : String(c));

/** Texto de apoio de uma linha da gaveta: matrícula, competência, vencimento, data, valor, forma e telefone (o que existir). */
export function metaOf(item) {
  const i = item.info || item;
  const parts = [];
  if (item.data_matricula) parts.push('Matrícula em ' + item.data_matricula);
  if (i.competencia) parts.push('Competência ' + compBR(i.competencia));
  if (i.vencimento) parts.push('vence ' + dateBR(i.vencimento));
  if (i.data) parts.push(dateBR(i.data));
  if (typeof i.valor === 'number') parts.push(MONEY.format(i.valor));
  if (i.forma) parts.push(i.forma);
  if (i.telefone) parts.push(i.telefone);
  return parts.join(' · ');
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function createAdminDashboard({ doc, openStudent }) {
  const $ = (id) => doc.getElementById(id);
  let drawer = null; // { title, items, opener }

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

  // ---------- Detalhes (gaveta) ----------
  function setInert(on) {
    $('dash-ready').inert = on;
  }

  function drawerRows() {
    const q = fold($('drawer-q').value);
    const dir = SORTS[$('drawer-sort').value] || 1;
    return drawer.items
      .filter((a) => !q || fold(a.nome).includes(q))
      .sort((a, b) => dir * fold(a.nome).localeCompare(fold(b.nome), 'pt-BR'));
  }

  function renderDrawerList() {
    const rows = drawerRows();
    const list = $('drawer-list');
    list.textContent = '';
    $('drawer-empty').hidden = rows.length > 0;
    if (rows.length === 0) {
      $('drawer-empty').textContent = drawer.items.length === 0 ? 'Nenhum aluno neste indicador.' : 'Nenhum aluno encontrado para esta busca.';
    }
    const unit = drawer.items.some((a) => a.info || typeof a.valor === 'number') ? ' registros' : ' alunos';
    $('drawer-count').textContent = rows.length === drawer.items.length ? rows.length + unit : rows.length + ' de ' + drawer.items.length + unit;
    rows.forEach((a) => {
      const li = doc.createElement('li');
      const btn = el('button', 'student-row');
      btn.type = 'button';
      btn.appendChild(el('span', 'student-name', a.nome));
      btn.appendChild(el('span', 'muted', metaOf(a) || 'Abrir cadastro'));
      btn.addEventListener('click', () => { closeDrawer(false); openStudent(a.student_id); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function openDrawer(title, items, opener) {
    drawer = { title, items, opener };
    $('drawer-title').textContent = title;
    $('drawer-q').value = '';
    $('drawer-sort').value = 'az';
    renderDrawerList();
    $('drawer').hidden = false;
    setInert(true);
    $('drawer-panel').focus();
  }

  function closeDrawer(restoreFocus = true) {
    if (!drawer) return;
    const opener = drawer.opener;
    drawer = null;
    $('drawer').hidden = true;
    $('drawer-list').textContent = '';
    setInert(false);
    if (restoreFocus && opener && opener.focus) opener.focus();
  }

  // ---------- Cartões ----------
  function kpi(ind, big, detalhes) {
    const items = ind.estado === 'ok' && ind.detalhe ? detalhes[ind.detalhe] : null;
    const clickable = Array.isArray(items);
    const card = el(clickable ? 'button' : 'div', 'kpi' + (big ? ' kpi-big' : '') + (ind.estado === 'ok' ? '' : ' kpi-pending'));
    if (clickable) {
      card.type = 'button';
      card.setAttribute('aria-haspopup', 'dialog');
    }
    card.title = ind.ajuda;
    card.appendChild(el('span', 'kpi-title', ind.titulo));
    if (ind.estado === 'ok') {
      card.appendChild(el('strong', 'kpi-value', formatIndicator(ind)));
      if (ind.secundario) card.appendChild(el('span', 'muted', ind.secundario));
    } else {
      card.appendChild(el('span', 'kpi-msg', ind.mensagem));
    }
    card.appendChild(el('span', 'sr-only', 'Como é calculado: ' + ind.ajuda));
    if (clickable) card.addEventListener('click', () => openDrawer(ind.titulo, items, card));
    return card;
  }

  function renderKpis(data) {
    const main = $('kpi-main');
    const more = $('kpi-more');
    main.textContent = '';
    more.textContent = '';
    data.indicadores.principais.forEach((i) => main.appendChild(kpi(i, true, data.detalhes)));
    data.indicadores.complementares.forEach((i) => more.appendChild(kpi(i, false, data.detalhes)));
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

  function renderRevenueChart(chart) {
    const box = $('chart-revenue');
    box.textContent = '';
    const meses = chart && Array.isArray(chart.meses) ? chart.meses : [];
    if (!chart || chart.estado !== 'ok' || meses.length === 0) { emptyChart(box, (chart && chart.mensagem) || 'Ainda sem dados.'); return; }
    const max = Math.max(1, ...meses.map((m) => Math.max(m.prevista, m.recebida)));
    const legend = el('p', 'muted', 'Cinza: previsto · Vermelho: recebido');
    box.appendChild(legend);
    const list = el('ul', 'bars bars-pair');
    meses.forEach((m) => {
      const li = doc.createElement('li');
      li.appendChild(el('span', 'bar-label', monthLabel(m.competencia)));
      const pair = el('span', 'bar-pair');
      [['previsto', 'bar bar-prev', m.prevista], ['recebido', 'bar bar-rec', m.recebida]].forEach(([name, cls, value]) => {
        const bar = el('progress', cls);
        bar.max = max;
        bar.value = value;
        bar.setAttribute('aria-label', monthLabel(m.competencia) + ', ' + name + ': ' + MONEY.format(value));
        pair.appendChild(bar);
      });
      li.appendChild(pair);
      li.appendChild(el('span', 'bar-values', MONEY.format(m.prevista) + ' / ' + MONEY.format(m.recebida)));
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
    closeDrawer(false);
    renderKpis(data);
    renderStatusChart(data.graficos.situacaoAlunos);
    renderRevenueChart(data.graficos.receitaPrevistaRecebida);
    renderAvisos(data.avisos);
    emptyChart($('chart-occupancy'), (data.graficos.ocupacaoTurmas || {}).mensagem || 'Ainda sem dados.');
    renderBirthdays(data.aniversariantes, data.aniversariantesEstado === 'sem_datas');
    $('dash-admin').hidden = false;
  }

  /** Apaga tudo do usuário anterior. */
  function reset() {
    closeDrawer(false);
    ['kpi-main', 'kpi-more', 'chart-status', 'chart-revenue', 'chart-occupancy', 'bday-list', 'drawer-list'].forEach((id) => { $(id).textContent = ''; });
    $('bday-empty').hidden = true;
    $('bday-pending').hidden = true;
    $('dash-avisos').textContent = '';
    $('dash-avisos-box').hidden = true;
    $('drawer-count').textContent = '';
    $('drawer-empty').textContent = '';
    $('dash-admin').hidden = true;
  }

  $('drawer-close').addEventListener('click', () => closeDrawer());
  $('drawer-backdrop').addEventListener('click', () => closeDrawer());
  $('drawer-q').addEventListener('input', () => { if (drawer) renderDrawerList(); });
  $('drawer-sort').addEventListener('change', () => { if (drawer) renderDrawerList(); });
  doc.addEventListener('keydown', (e) => { if (drawer && e && e.key === 'Escape') closeDrawer(); });

  return { render, reset, closeDrawer };
}
