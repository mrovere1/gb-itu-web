// Área de trabalho dos cartões do painel: tela larga para trabalhar a lista de cada indicador.
// Tabela ordenável com busca, filtro, seleção, exportação CSV e (nos inadimplentes) quadro de faixas de atraso.
// Recebe doc e os callbacks por injeção; não importa nada. Texto do servidor entra sempre por textContent.
// Nada financeiro é alterado aqui: registrar pagamento acontece na aba Mensalidades (o botão leva até lá, já filtrado).

const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BOARD = [['1–7 dias', 1, 7], ['8–30 dias', 8, 30], ['31–60 dias', 31, 60], ['Mais de 60 dias', 61, Infinity]];
const HIDE_WHILE_OPEN = ['dash-admin', 'dash-presenca', 'dash-basic'];

export const dateBR = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const compBR = (c) => (/^\d{4}-\d{2}$/.test(c) ? c.slice(5) + '/' + c.slice(0, 4) : '');
const isoFromBR = (s) => (/^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.slice(6) + '-' + s.slice(3, 5) + '-' + s.slice(0, 2) : '');
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const money = (n) => (typeof n === 'number' ? MONEY.format(n) : '—');

/** Dias entre duas datas ISO (b − a), em calendário UTC. */
export function daysBetween(aIso, bIso) {
  const t = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(bIso) - t(aIso)) / 86400000);
}

/** Texto seguro para planilha: aspas, ponto e vírgula e quebras tratados; fórmulas (= + - @) neutralizadas. */
export function csvCell(value) {
  let s = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const COLS = {
  nome: { label: 'Aluno', sort: (r) => fold(r.nome), csv: (r) => r.nome },
  competencia: { label: 'Competência', sort: (r) => r.competencia, csv: (r) => compBR(r.competencia) },
  vencimento: { label: 'Vencimento', sort: (r) => r.vencimento, csv: (r) => dateBR(r.vencimento) },
  atraso: { label: 'Atraso', num: true, sort: (r) => r.atraso, csv: (r) => (r.atraso == null ? '' : r.atraso + ' dias') },
  dias: { label: 'Vence em', num: true, sort: (r) => r.dias, csv: (r) => (r.dias == null ? '' : r.dias + ' dias') },
  valor: { label: 'Valor', num: true, right: true, sort: (r) => r.valor, csv: (r) => (typeof r.valor === 'number' ? r.valor.toFixed(2).replace('.', ',') : '') },
  data: { label: 'Data', sort: (r) => r.data, csv: (r) => dateBR(r.data) },
  forma: { label: 'Forma', sort: (r) => fold(r.forma), csv: (r) => r.forma },
  matricula: { label: 'Matrícula', sort: (r) => r.matriculaIso, csv: (r) => r.matricula },
  telefone: { label: 'Telefone', sort: (r) => r.telefone, csv: (r) => r.telefone },
  acoes: { label: 'Ações', noSort: true },
};

const rangeFilter = (key, lo, hi) => (r) => r[key] != null && r[key] >= lo && r[key] <= hi;
const KINDS = {
  inadimplentes: {
    label: 'Inadimplentes', cols: ['nome', 'competencia', 'vencimento', 'atraso', 'valor', 'acoes'], csvCols: ['nome', 'telefone', 'competencia', 'vencimento', 'atraso', 'valor'],
    sort: ['atraso', -1], board: true, mens: true,
    filter: ['Faixa de atraso', [['', 'Todas'], ['1-7', '1 a 7 dias'], ['8-30', '8 a 30 dias'], ['31-60', '31 a 60 dias'], ['61+', 'Mais de 60 dias']],
      (r, v) => { const b = BOARD[['1-7', '8-30', '31-60', '61+'].indexOf(v)]; return rangeFilter('atraso', b[1], b[2])(r); }],
    empty: 'Nenhum inadimplente nesta competência.',
  },
  contasAVencer: {
    label: 'Contas a vencer', cols: ['nome', 'competencia', 'vencimento', 'dias', 'valor', 'acoes'], csvCols: ['nome', 'competencia', 'vencimento', 'dias', 'valor'],
    sort: ['vencimento', 1], mens: true,
    filter: ['Vence em', [['', 'Todas'], ['0', 'Hoje'], ['1-3', '1 a 3 dias'], ['4-7', '4 a 7 dias']],
      (r, v) => ({ 0: rangeFilter('dias', 0, 0), '1-3': rangeFilter('dias', 1, 3), '4-7': rangeFilter('dias', 4, 7) })[v](r)],
    empty: 'Nenhuma conta vence nos próximos dias.',
  },
  receitaRecebida: {
    label: 'Receita recebida', cols: ['nome', 'data', 'forma', 'valor', 'acoes'], csvCols: ['nome', 'data', 'forma', 'valor'],
    sort: ['data', -1], mens: true, dynamicFilter: 'forma', filterLabel: 'Forma de pagamento',
    empty: 'Nenhum pagamento recebido nesta competência.',
  },
  alunosAtivos: { label: 'Alunos ativos', cols: ['nome', 'acoes'], csvCols: ['nome'], sort: ['nome', 1], empty: 'Nenhum aluno ativo.' },
  novasMatriculas: { label: 'Novas matrículas', cols: ['nome', 'matricula', 'acoes'], csvCols: ['nome', 'matricula'], sort: ['matricula', -1], empty: 'Nenhuma matrícula nesta competência.' },
};
const ORDER = ['inadimplentes', 'contasAVencer', 'receitaRecebida', 'alunosAtivos', 'novasMatriculas'];

function toRows(kind, data) {
  const hoje = data.hoje;
  return (data.detalhes[kind] || []).map((it, i) => {
    const info = it.info || {};
    const valor = typeof info.valor === 'number' ? info.valor : (typeof it.valor === 'number' ? it.valor : null);
    const venc = info.vencimento || '';
    return {
      id: kind + ':' + i, student_id: it.student_id, nome: it.nome, telefone: info.telefone || '',
      competencia: info.competencia || (it.data ? it.data.slice(0, 7) : ''), vencimento: venc, valor,
      data: it.data || '', forma: it.forma || '', matricula: it.data_matricula || '', matriculaIso: isoFromBR(it.data_matricula || ''),
      atraso: venc && hoje ? Math.max(daysBetween(venc, hoje), 0) : null,
      dias: venc && hoje ? Math.max(daysBetween(hoje, venc), 0) : null,
    };
  });
}

export function createWorkspace({ doc, openStudent = () => {}, openMensalidade = () => {}, download = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  let state = null; // { kind, data, opener, rows, sort, filter, q, view, selected:Set, saved:{} }

  function el(tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  const button = (label, cls, onClick) => {
    const b = el('button', cls || 'secondary', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  // ---------- dados derivados ----------
  function visibleRows() {
    const cfg = KINDS[state.kind];
    const q = fold(state.q);
    let rows = state.rows.filter((r) => !q || fold(r.nome).includes(q));
    if (state.filter) {
      if (cfg.dynamicFilter) rows = rows.filter((r) => r[cfg.dynamicFilter] === state.filter);
      else rows = rows.filter((r) => cfg.filter[2](r, state.filter));
    }
    const [key, dir] = state.sort;
    const get = COLS[key].sort;
    return rows.slice().sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null || x === '') return y == null || y === '' ? 0 : 1; // vazios sempre por último
      if (y == null || y === '') return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }

  const sumOf = (rows) => rows.reduce((t, r) => t + (typeof r.valor === 'number' ? r.valor : 0), 0);
  const distinct = (rows) => new Set(rows.map((r) => r.student_id)).size;

  function tilesFor(rows) {
    const k = state.kind;
    const total = sumOf(rows);
    if (k === 'inadimplentes') {
      const maxAtraso = rows.reduce((m, r) => Math.max(m, r.atraso || 0), 0);
      const n = distinct(rows);
      return [['Alunos inadimplentes', String(n)], ['Em aberto', money(total)], ['Maior atraso', maxAtraso + ' dias'], ['Média por aluno', n ? money(total / n) : '—']];
    }
    if (k === 'contasAVencer') {
      const next = rows.map((r) => r.vencimento).filter(Boolean).sort()[0];
      return [['Cobranças', String(rows.length)], ['Valor total', money(total)], ['Vencem hoje', String(rows.filter((r) => r.dias === 0).length)], ['Próximo vencimento', next ? dateBR(next) : '—']];
    }
    if (k === 'receitaRecebida') {
      const n = distinct(rows);
      return [['Recebido', money(total)], ['Pagamentos', String(rows.length)], ['Maior pagamento', money(rows.reduce((m, r) => Math.max(m, r.valor || 0), 0))], ['Ticket médio', n ? money(total / n) : '—']];
    }
    return [[KINDS[k].label, String(rows.length)]];
  }

  // ---------- renderização ----------
  function renderSwitch() {
    const box = $('ws-switch');
    box.textContent = '';
    ORDER.forEach((k) => {
      const count = (state.data.detalhes[k] || []).length;
      const b = el('button', 'ws-tab', KINDS[k].label + ' (' + count + ')');
      b.type = 'button';
      if (k === state.kind) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => { if (k !== state.kind) switchKind(k); });
      box.appendChild(b);
    });
  }

  function renderTools() {
    const cfg = KINDS[state.kind];
    $('ws-q').value = state.q;
    const sel = $('ws-filter');
    sel.textContent = '';
    let options;
    let label;
    if (cfg.dynamicFilter) {
      const values = [...new Set(state.rows.map((r) => r[cfg.dynamicFilter]).filter(Boolean))].sort();
      options = [['', 'Todas'], ...values.map((v) => [v, v])];
      label = cfg.filterLabel;
    } else if (cfg.filter) {
      options = cfg.filter[1];
      label = cfg.filter[0];
    }
    $('ws-filter-box').hidden = !options || options.length < 2;
    $('ws-filter-label').textContent = label || 'Filtro';
    (options || []).forEach(([v, text]) => {
      const o = doc.createElement('option');
      o.value = v;
      o.textContent = text;
      sel.appendChild(o);
    });
    sel.value = state.filter;
    $('ws-views').hidden = !cfg.board;
    $('ws-view-table').setAttribute('aria-pressed', String(state.view === 'table'));
    $('ws-view-board').setAttribute('aria-pressed', String(state.view === 'board'));
  }

  function renderTiles(rows) {
    const box = $('ws-tiles');
    box.textContent = '';
    tilesFor(rows).forEach(([label, value]) => {
      const card = el('div', 'total-card');
      card.appendChild(el('span', 'muted', label));
      card.appendChild(el('strong', '', value));
      box.appendChild(card);
    });
  }

  function rowActions(r) {
    const cfg = KINDS[state.kind];
    const cell = el('td', 'ws-actions');
    cell.appendChild(button('Abrir cadastro', 'secondary', () => openStudent(r.student_id)));
    if (cfg.mens) cell.appendChild(button('Ver em Mensalidades', 'secondary', () => openMensalidade({ competencia: r.competencia, busca: r.nome })));
    return cell;
  }

  function cellFor(col, r) {
    const td = el('td', col === 'valor' ? 'ws-num' : '');
    if (col === 'nome') {
      td.appendChild(el('strong', '', r.nome));
      if (r.telefone) td.appendChild(el('span', 'muted ws-sub', r.telefone));
    } else if (col === 'competencia') td.textContent = compBR(r.competencia);
    else if (col === 'vencimento') td.textContent = dateBR(r.vencimento) || '—';
    else if (col === 'data') td.textContent = dateBR(r.data) || '—';
    else if (col === 'forma') td.textContent = r.forma || '—';
    else if (col === 'matricula') td.textContent = r.matricula || '—';
    else if (col === 'valor') td.textContent = money(r.valor);
    else if (col === 'atraso') td.appendChild(el('span', 'chip ' + (r.atraso > 30 ? 'chip-vencida' : 'chip-pendente'), r.atraso == null ? '—' : r.atraso + (r.atraso === 1 ? ' dia' : ' dias')));
    else if (col === 'dias') td.appendChild(el('span', 'chip ' + (r.dias === 0 ? 'chip-vencida' : 'chip-pendente'), r.dias == null ? '—' : r.dias === 0 ? 'hoje' : 'em ' + r.dias + (r.dias === 1 ? ' dia' : ' dias')));
    return td;
  }

  function sortHeader(col) {
    const th = el('th', COLS[col].right ? 'ws-num' : '');
    th.setAttribute('scope', 'col');
    if (COLS[col].noSort) { th.textContent = COLS[col].label; return th; }
    const active = state.sort[0] === col;
    th.setAttribute('aria-sort', active ? (state.sort[1] > 0 ? 'ascending' : 'descending') : 'none');
    const b = el('button', 'ws-sort', COLS[col].label + (active ? (state.sort[1] > 0 ? ' ▲' : ' ▼') : ''));
    b.type = 'button';
    b.addEventListener('click', () => {
      state.sort = [col, active ? -state.sort[1] : (COLS[col].num ? -1 : 1)];
      render();
    });
    th.appendChild(b);
    return th;
  }

  function renderTable(rows) {
    const cfg = KINDS[state.kind];
    const head = $('ws-thead');
    head.textContent = '';
    const tr = doc.createElement('tr');
    const all = el('th', 'ws-check');
    all.setAttribute('scope', 'col');
    const allBox = doc.createElement('input');
    allBox.type = 'checkbox';
    allBox.setAttribute('aria-label', 'Selecionar todos os registros da lista');
    allBox.checked = rows.length > 0 && rows.every((r) => state.selected.has(r.id));
    allBox.addEventListener('change', () => {
      rows.forEach((r) => (allBox.checked ? state.selected.add(r.id) : state.selected.delete(r.id)));
      render();
    });
    all.appendChild(allBox);
    tr.appendChild(all);
    cfg.cols.forEach((c) => tr.appendChild(sortHeader(c)));
    head.appendChild(tr);

    const body = $('ws-tbody');
    body.textContent = '';
    rows.forEach((r) => {
      const row = doc.createElement('tr');
      const c0 = el('td', 'ws-check');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.setAttribute('aria-label', 'Selecionar ' + r.nome);
      box.checked = state.selected.has(r.id);
      box.addEventListener('change', () => { if (box.checked) state.selected.add(r.id); else state.selected.delete(r.id); renderBulk(); });
      c0.appendChild(box);
      row.appendChild(c0);
      cfg.cols.forEach((c) => row.appendChild(c === 'acoes' ? rowActions(r) : cellFor(c, r)));
      body.appendChild(row);
    });
  }

  function renderBoard(rows) {
    const box = $('ws-board');
    box.textContent = '';
    BOARD.forEach(([label, lo, hi], i) => {
      const items = rows.filter((r) => r.atraso != null && r.atraso >= lo && r.atraso <= hi);
      const col = el('section', 'ws-col ws-col-' + i);
      col.setAttribute('aria-label', label);
      const head = el('div', 'ws-col-head');
      head.appendChild(el('strong', '', label));
      head.appendChild(el('span', 'muted', items.length + (items.length === 1 ? ' aluno · ' : ' alunos · ') + money(sumOf(items))));
      col.appendChild(head);
      items.forEach((r) => {
        const card = el('div', 'ws-card');
        card.setAttribute('tabindex', '0');
        card.appendChild(el('strong', '', r.nome));
        card.appendChild(el('span', 'muted', 'Competência ' + compBR(r.competencia) + ' · vence ' + dateBR(r.vencimento)));
        if (r.telefone) card.appendChild(el('span', 'muted', r.telefone));
        card.appendChild(el('span', 'ws-card-value', money(r.valor)));
        const actions = el('div', 'ws-card-actions');
        actions.appendChild(button('Abrir cadastro', 'secondary', () => openStudent(r.student_id)));
        actions.appendChild(button('Ver em Mensalidades', 'secondary', () => openMensalidade({ competencia: r.competencia, busca: r.nome })));
        card.appendChild(actions);
        col.appendChild(card);
      });
      box.appendChild(col);
    });
  }

  function renderBulk() {
    const picked = state.rows.filter((r) => state.selected.has(r.id));
    $('ws-bulk').hidden = picked.length === 0;
    const hasValue = picked.some((r) => typeof r.valor === 'number');
    $('ws-bulk-text').textContent = picked.length + (picked.length === 1 ? ' selecionado' : ' selecionados') + (hasValue ? ' · ' + money(sumOf(picked)) : '');
  }

  function render() {
    const cfg = KINDS[state.kind];
    const rows = visibleRows();
    $('ws-title').textContent = cfg.label;
    $('ws-crumb-title').textContent = cfg.label;
    $('ws-comp').textContent = 'Competência ' + compBR(state.data.competencia);
    renderSwitch();
    renderTools();
    renderTiles(state.rows);
    const boardOn = !!cfg.board && state.view === 'board';
    $('ws-table-wrap').hidden = boardOn || rows.length === 0;
    $('ws-board').hidden = !boardOn || rows.length === 0;
    $('ws-empty').hidden = rows.length > 0;
    $('ws-empty').textContent = state.rows.length === 0 ? cfg.empty : 'Nenhum registro encontrado para estes filtros.';
    if (!boardOn) renderTable(rows); else renderBoard(rows);
    const hasValue = state.rows.some((r) => typeof r.valor === 'number');
    $('ws-count').textContent = rows.length === state.rows.length ? rows.length + ' registros' : rows.length + ' de ' + state.rows.length + ' registros';
    $('ws-foot').textContent = rows.length + (rows.length === 1 ? ' registro' : ' registros') + (hasValue ? ' · ' + money(sumOf(rows)) : '');
    $('ws-export').disabled = rows.length === 0;
    renderBulk();
  }

  // ---------- exportação ----------
  function exportCsv(rows, suffix) {
    const cfg = KINDS[state.kind];
    const lines = [cfg.csvCols.map((c) => csvCell(COLS[c].label)).join(';')];
    rows.forEach((r) => lines.push(cfg.csvCols.map((c) => csvCell(COLS[c].csv(r))).join(';')));
    download(state.kind + '-' + state.data.competencia + (suffix || '') + '.csv', '﻿' + lines.join('\r\n') + '\r\n');
  }

  // ---------- ciclo de vida ----------
  function begin(kind) {
    const cfg = KINDS[kind];
    state.kind = kind;
    state.rows = toRows(kind, state.data);
    state.sort = cfg.sort.slice();
    state.filter = '';
    state.q = '';
    state.view = 'table';
    state.selected = new Set();
  }

  function switchKind(kind) {
    begin(kind);
    render();
    $('ws-title').focus();
  }

  function open(kind, data, opener) {
    if (!KINDS[kind]) return;
    if (!state) {
      const saved = {};
      HIDE_WHILE_OPEN.forEach((id) => { saved[id] = $(id).hidden; $(id).hidden = true; });
      state = { data, opener, saved };
    } else {
      state.data = data;
      state.opener = opener || state.opener;
    }
    begin(kind);
    $('ws').hidden = false;
    render();
    $('ws-title').focus();
  }

  function close(restoreFocus = true) {
    if (!state) return;
    const { saved, opener } = state;
    state = null;
    $('ws').hidden = true;
    HIDE_WHILE_OPEN.forEach((id) => { $(id).hidden = saved[id]; });
    if (restoreFocus && opener && opener.focus) opener.focus();
  }

  /** O painel foi recarregado (outra competência ou Atualizar): refaz a lista aberta com os dados novos. */
  function refresh(data) {
    if (!state) return;
    state.data = data;
    const keep = { sort: state.sort, filter: state.filter, q: state.q, view: state.view };
    state.rows = toRows(state.kind, data);
    Object.assign(state, keep);
    state.selected = new Set();
    render();
  }

  /** Apaga tudo do usuário anterior. */
  function reset() {
    if (state) {
      const { saved } = state;
      HIDE_WHILE_OPEN.forEach((id) => { $(id).hidden = saved[id]; });
    }
    state = null;
    $('ws').hidden = true;
    ['ws-switch', 'ws-tiles', 'ws-thead', 'ws-tbody', 'ws-board'].forEach((id) => { $(id).textContent = ''; });
    $('ws-q').value = '';
    $('ws-bulk').hidden = true;
  }

  $('ws-back').addEventListener('click', () => close());
  $('ws-q').addEventListener('input', () => { if (state) { state.q = $('ws-q').value; render(); } });
  $('ws-filter').addEventListener('change', () => { if (state) { state.filter = $('ws-filter').value; render(); } });
  $('ws-view-table').addEventListener('click', () => { if (state) { state.view = 'table'; render(); } });
  $('ws-view-board').addEventListener('click', () => { if (state) { state.view = 'board'; render(); } });
  $('ws-export').addEventListener('click', () => { if (state) exportCsv(visibleRows()); });
  $('ws-export-selected').addEventListener('click', () => { if (state) exportCsv(state.rows.filter((r) => state.selected.has(r.id)), '-selecao'); });
  $('ws-clear').addEventListener('click', () => { if (state) { state.selected = new Set(); render(); } });
  doc.addEventListener('keydown', (e) => { if (state && e && e.key === 'Escape') close(); });

  return { open, close, refresh, reset, isOpen: () => !!state };
}
