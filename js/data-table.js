// Tabela de dados configurável: colunas que se mostram, escondem e reordenam (preferência salva no navegador),
// ordenação por coluna, filtros por coluna (texto, lista, faixa de valores, período), total e exportação CSV.
// Recebe doc/storage/download por injeção; não importa nada. Texto dos dados entra sempre por textContent.
//
// Coluna: { key, label, type: 'text'|'money'|'number'|'date'|'chip', value(row), text?(row), render?(row, td), csv?(row),
//           filter?: 'text'|'select'|'range'|'date', defaultVisible?: false, locked?: true (sempre visível, no fim, sem filtro/ordem) }

const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const STORE_PREFIX = 'gbitu.colunas.';

const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const dateBR = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');

export function csvCell(value) {
  let s = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const empty = (v) => v == null || v === '' || (typeof v === 'number' && !isFinite(v));

export function createDataTable({ doc, root, tableId, columns, storage = null, download = () => {}, fileName = 'tabela', defaultSort = null }) {
  const byKey = {};
  columns.forEach((c) => { byKey[c.key] = c; });
  const locked = columns.filter((c) => c.locked).map((c) => c.key);
  const defaultOrder = columns.filter((c) => !c.locked && c.defaultVisible !== false).map((c) => c.key);
  const allMovable = columns.filter((c) => !c.locked).map((c) => c.key);

  let rows = [];
  let order = loadPrefs();
  let sort = defaultSort ? { key: defaultSort[0], dir: defaultSort[1] } : null;
  let filters = {};
  let pickerOpen = false;
  let filtersOpen = false;
  let parts = null; // referências aos pedaços da tela

  // ---------- preferências ----------
  function loadPrefs() {
    try {
      const saved = storage && JSON.parse(storage.getItem(STORE_PREFIX + tableId) || 'null');
      if (saved && Array.isArray(saved.cols)) {
        const cols = saved.cols.filter((k, i) => allMovable.includes(k) && saved.cols.indexOf(k) === i);
        if (cols.length) return cols;
      }
    } catch (e) { /* sem armazenamento: usa o padrão */ }
    return defaultOrder.slice();
  }

  function savePrefs() {
    try { if (storage) storage.setItem(STORE_PREFIX + tableId, JSON.stringify({ v: 1, cols: order })); } catch (e) { /* ignorar */ }
  }

  const visibleCols = () => order.concat(locked).map((k) => byKey[k]);

  // ---------- helpers ----------
  function el(tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(label, cls, onClick, aria) {
    const b = el('button', cls || 'btn-soft', label);
    b.type = 'button';
    if (aria) b.setAttribute('aria-label', aria);
    b.addEventListener('click', onClick);
    return b;
  }

  function display(col, row) {
    if (col.text) return col.text(row);
    const v = col.value(row);
    if (empty(v)) return '—';
    if (col.type === 'money') return MONEY.format(v);
    if (col.type === 'date') return dateBR(v) || '—';
    return String(v);
  }

  function csvValue(col, row) {
    if (col.csv) return col.csv(row);
    const v = col.value(row);
    if (empty(v)) return '';
    if (col.type === 'money') return v.toFixed(2).replace('.', ',');
    if (col.type === 'date') return dateBR(v);
    return String(v);
  }

  // ---------- filtros e ordenação ----------
  function matches(row) {
    return Object.keys(filters).every((key) => {
      const col = byKey[key];
      const f = filters[key];
      if (!col || !f || !visibleCols().includes(col)) return true;
      const v = col.value(row);
      if (col.filter === 'text') return !f.text || fold(display(col, row)).includes(fold(f.text));
      if (col.filter === 'select') return !f.selected || String(v) === f.selected;
      if (col.filter === 'range') {
        if (f.min !== '' && f.min != null && !(typeof v === 'number' && v >= Number(f.min))) return false;
        return f.max === '' || f.max == null || (typeof v === 'number' && v <= Number(f.max));
      }
      if (col.filter === 'date') {
        if (f.from && !(v && v >= f.from)) return false;
        return !f.to || (v && v <= f.to);
      }
      return true;
    });
  }

  function visibleRows() {
    const list = rows.filter(matches);
    if (!sort || !byKey[sort.key]) return list;
    const col = byKey[sort.key];
    const get = (r) => { const v = col.value(r); return typeof v === 'string' ? fold(v) : v; };
    return list.slice().sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (empty(x)) return empty(y) ? 0 : 1; // vazios sempre por último
      if (empty(y)) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }

  const isActive = (f) => !!f && Object.values(f).some((v) => v !== '' && v != null);
  const activeFilterCount = () => Object.keys(filters).filter((k) => isActive(filters[k])).length;
  const hasFilters = () => activeFilterCount() > 0;

  // ---------- estrutura ----------
  function buildPicker() {
    const panel = el('div', 'dt-picker');
    panel.hidden = !pickerOpen;
    panel.appendChild(el('p', 'muted', 'Marque as colunas que quer ver e use as setas para mudar a ordem.'));
    const ul = el('ul', 'dt-picker-list');
    const shown = order.slice();
    const hidden = allMovable.filter((k) => !shown.includes(k));
    shown.concat(hidden).forEach((key) => {
      const col = byKey[key];
      const li = doc.createElement('li');
      const label = el('label', 'check');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.checked = shown.includes(key);
      box.setAttribute('aria-label', 'Mostrar coluna ' + col.label);
      box.addEventListener('change', () => {
        if (box.checked) order = order.concat(key);
        else if (order.length > 1) order = order.filter((k) => k !== key);
        else box.checked = true; // sempre fica ao menos uma coluna
        savePrefs();
        rebuild();
      });
      label.appendChild(box);
      label.appendChild(el('span', '', col.label));
      li.appendChild(label);
      if (shown.includes(key)) {
        const i = order.indexOf(key);
        const move = (d) => { const j = i + d; if (j < 0 || j >= order.length) return; const next = order.slice(); next.splice(i, 1); next.splice(j, 0, key); order = next; savePrefs(); rebuild(); };
        const up = button('↑', 'btn-soft btn-xs dt-move', () => move(-1), 'Mover ' + col.label + ' para antes');
        const down = button('↓', 'btn-soft btn-xs dt-move', () => move(1), 'Mover ' + col.label + ' para depois');
        up.disabled = i === 0;
        down.disabled = i === order.length - 1;
        li.appendChild(up);
        li.appendChild(down);
      }
      ul.appendChild(li);
    });
    panel.appendChild(ul);
    panel.appendChild(button('Restaurar colunas padrão', 'btn-soft', () => { order = defaultOrder.slice(); savePrefs(); rebuild(); }));
    return panel;
  }

  function filterControl(col) {
    const td = el('th', 'dt-filter-cell');
    td.setAttribute('scope', 'col');
    if (!col.filter || col.locked) return td;
    const f = filters[col.key] || {};
    const set = (patch) => { filters[col.key] = Object.assign({}, filters[col.key], patch); renderBody(); };
    const labelOf = (suffix) => 'Filtrar ' + col.label + (suffix ? ' ' + suffix : '');
    if (col.filter === 'text') {
      const i = doc.createElement('input');
      i.type = 'search'; i.value = f.text || ''; i.placeholder = 'Filtrar'; i.setAttribute('aria-label', labelOf());
      i.addEventListener('input', () => set({ text: i.value }));
      td.appendChild(i);
    } else if (col.filter === 'select') {
      const s = doc.createElement('select');
      s.setAttribute('aria-label', labelOf());
      const values = [...new Set(rows.map((r) => col.value(r)).filter((v) => !empty(v)).map(String))].sort();
      [['', 'Todos'], ...values.map((v) => [v, v])].forEach(([v, t]) => { const o = doc.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); });
      s.value = values.includes(f.selected) ? f.selected : '';
      s.addEventListener('change', () => set({ selected: s.value }));
      td.appendChild(s);
    } else if (col.filter === 'range' || col.filter === 'date') {
      const isDate = col.filter === 'date';
      const pair = el('div', 'dt-range');
      td.appendChild(pair);
      [[isDate ? 'from' : 'min', isDate ? 'de' : 'mín.'], [isDate ? 'to' : 'max', isDate ? 'até' : 'máx.']].forEach(([key, hint]) => {
        const i = doc.createElement('input');
        i.type = isDate ? 'date' : 'number'; if (!isDate) i.step = 'any';
        i.value = f[key] || ''; i.setAttribute('aria-label', labelOf(hint)); i.placeholder = hint;
        i.addEventListener('input', () => set({ [key]: i.value }));
        pair.appendChild(i);
      });
    }
    return td;
  }

  function headerCell(col) {
    const th = el('th', col.type === 'money' || col.type === 'number' ? 'dt-num' : '');
    th.setAttribute('scope', 'col');
    if (col.locked) { th.textContent = col.label; return th; }
    const active = sort && sort.key === col.key;
    th.setAttribute('aria-sort', active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    const b = el('button', 'ws-sort', col.label + (active ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''));
    b.type = 'button';
    b.addEventListener('click', () => {
      sort = { key: col.key, dir: active ? -sort.dir : (col.type === 'money' || col.type === 'number' ? -1 : 1) };
      rebuild();
      if (parts && parts.sortButtons[col.key]) parts.sortButtons[col.key].focus();
    });
    th.appendChild(b);
    parts.sortButtons[col.key] = b;
    return th;
  }

  function rebuild() {
    root.textContent = '';
    parts = { sortButtons: {} };
    const cols = visibleCols();

    const bar = el('div', 'dt-bar');
    const pickerBtn = button('Colunas', 'btn-soft', () => { pickerOpen = !pickerOpen; rebuild(); parts.pickerBtn.focus(); });
    pickerBtn.setAttribute('aria-expanded', String(pickerOpen));
    parts.pickerBtn = pickerBtn;
    bar.appendChild(pickerBtn);
    const active = activeFilterCount();
    const filtersBtn = button('Filtros' + (active ? ' · ' + active : ''), 'btn-soft', () => { filtersOpen = hasFilters() ? true : !filtersOpen; rebuild(); parts.filtersBtn.focus(); });
    filtersBtn.setAttribute('aria-expanded', String(filtersOpen || active > 0));
    parts.filtersBtn = filtersBtn;
    bar.appendChild(filtersBtn);
    parts.clear = button('Limpar filtros', 'btn-soft btn-quiet', () => { filters = {}; rebuild(); });
    bar.appendChild(parts.clear);
    parts.exportBtn = button('Exportar planilha (CSV)', 'btn-soft', exportCsv);
    bar.appendChild(parts.exportBtn);
    parts.count = el('span', 'muted dt-count');
    parts.count.setAttribute('role', 'status');
    parts.count.setAttribute('aria-live', 'polite');
    bar.appendChild(parts.count);
    root.appendChild(bar);
    root.appendChild(buildPicker());

    const wrap = el('div', 'ws-table-wrap');
    const table = el('table', 'ws-table dt-table');
    const thead = doc.createElement('thead');
    const head = doc.createElement('tr');
    cols.forEach((c) => head.appendChild(headerCell(c)));
    thead.appendChild(head);
    const filterRow = el('tr', 'dt-filters');
    cols.forEach((c) => filterRow.appendChild(filterControl(c)));
    thead.appendChild(filterRow);
    filterRow.hidden = !(filtersOpen || hasFilters());
    parts.filterRow = filterRow;
    table.appendChild(thead);
    parts.tbody = doc.createElement('tbody');
    table.appendChild(parts.tbody);
    wrap.appendChild(table);
    root.appendChild(wrap);
    parts.empty = el('p', 'card muted', 'Nenhum registro encontrado para estes filtros.');
    root.appendChild(parts.empty);
    parts.foot = el('p', 'ws-foot');
    parts.foot.setAttribute('role', 'status');
    root.appendChild(parts.foot);
    renderBody();
  }

  function renderBody() {
    if (!parts) return;
    const cols = visibleCols();
    const list = visibleRows();
    parts.tbody.textContent = '';
    list.forEach((r) => {
      const tr = doc.createElement('tr');
      cols.forEach((c) => {
        const td = el('td', c.type === 'money' || c.type === 'number' ? 'dt-num' : (c.locked ? 'ws-actions' : ''));
        if (c.render) c.render(r, td); else td.textContent = display(c, r);
        tr.appendChild(td);
      });
      parts.tbody.appendChild(tr);
    });
    parts.empty.hidden = list.length > 0;
    parts.exportBtn.disabled = list.length === 0;
    parts.clear.hidden = !hasFilters();
    const active = activeFilterCount();
    parts.filtersBtn.textContent = 'Filtros' + (active ? ' · ' + active : '');
    parts.filtersBtn.setAttribute('aria-expanded', String(filtersOpen || active > 0));
    const label = list.length === rows.length ? list.length + ' registros' : list.length + ' de ' + rows.length + ' registros';
    parts.count.textContent = label;
    const money = cols.find((c) => c.type === 'money');
    const total = money ? list.reduce((t, r) => t + (typeof money.value(r) === 'number' ? money.value(r) : 0), 0) : null;
    parts.foot.textContent = label + (money ? ' · ' + money.label + ': ' + MONEY.format(total) : '');
  }

  function exportCsv() {
    const cols = visibleCols().filter((c) => !c.locked);
    const lines = [cols.map((c) => csvCell(c.label)).join(';')];
    visibleRows().forEach((r) => lines.push(cols.map((c) => csvCell(csvValue(c, r))).join(';')));
    download(fileName + '.csv', '﻿' + lines.join('\r\n') + '\r\n');
  }

  rebuild();

  return {
    setRows(next) { rows = Array.isArray(next) ? next : []; rebuild(); },
    reset() { rows = []; filters = {}; sort = defaultSort ? { key: defaultSort[0], dir: defaultSort[1] } : null; pickerOpen = false; filtersOpen = false; rebuild(); },
    state: () => ({ order: order.slice(), sort: sort && { ...sort }, filters: JSON.parse(JSON.stringify(filters)), shown: visibleRows().length, total: rows.length }),
  };
}
