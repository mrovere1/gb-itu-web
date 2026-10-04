// Quadro mensal "Pagamentos por aluno" (Aluno Full, só Administrador): uma linha por aluno e uma coluna por mês.
// Clicar numa célula abre um cartão com os detalhes e as ações que o servidor permite; a ação em si abre a mesma janela
// de operação de Mensalidades (injetada em openAction). Texto do servidor entra sempre por textContent.

import { createMonthSelect, fullLabel } from './month-select.js?v=3479483569';
import { csvCell } from './workspace.js?v=3479483569';

const PARTS = ['qd-loading', 'qd-error', 'qd-empty', 'qd-ready'];
const AUTH_CODES = Object.freeze({ NAO_AUTENTICADO: true, ACESSO_NEGADO: true });
const GENERIC_ERROR = 'Não foi possível exibir o quadro. Tente novamente.';
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const shortMonth = (iso) => ABREV[parseInt(iso.slice(5, 7), 10) - 1] + '/' + iso.slice(2, 4);
const dateBR = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const money = (n) => (typeof n === 'number' ? MONEY.format(n) : '—');
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const paidUntil = (v) => (/^\d{4}-\d{2}$/.test(v) ? v.slice(5) + '/' + v.slice(0, 4) : '—');
const NONE = 'Sem registro';
const CLASS = { Pago: 'qd-pago', 'Pago (pacote)': 'qd-pacote', Pendente: 'qd-pend', Isento: 'qd-isento', Férias: 'qd-susp', Lesão: 'qd-susp', Ausente: 'qd-susp', Cancelada: 'qd-canc' };
const SHORT = { 'Pago (pacote)': 'Pacote' };
const LEGEND = [['qd-pago', 'Pago'], ['qd-pacote', 'Pacote (pago antecipado)'], ['qd-pend', 'Pendente'], ['qd-pend qd-venc', 'Pendente vencida'], ['qd-isento', 'Isento'], ['qd-susp', 'Férias, lesão ou ausente'], ['qd-vazio', NONE]];
// [chave em acoes, tipo da janela, rótulo]
const ACTIONS = [
  ['registrar', 'pagar', 'Registrar pagamento'], ['editarVencimento', 'vencimento', 'Alterar vencimento'], ['estornar', 'estornar', 'Estornar pagamento'],
  ['reabrir', 'reabrir', 'Voltar a pendente'], ['cancelarPrevisto', 'cancelarPrevisto', 'Cancelar parcela prevista'], ['desfazerPacote', 'desfazerPacote', 'Desfazer pacote'],
  ['cancelar', 'cancelar', 'Cancelar cobrança'],
];

/** Vencimento sugerido para um mês sem cobrança: o dia de vencimento do aluno (ou 10), limitado ao último dia do mês. */
function suggestedDue(iso, day) {
  const last = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
  return iso + '-' + String(Math.min(typeof day === 'number' && day >= 1 ? day : 10, last)).padStart(2, '0');
}

export function createQuadro({ doc, api, openAction = () => {}, onAuthFailure = () => {}, download = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  let loaded = false;
  let requestId = 0;
  let data = null;
  let competencias = null;   // meses escolhidos; nulo = o servidor escolhe o período padrão
  let statusFilter = 'Ativo';
  let cellDialog = null;     // { opener }

  const monthSelect = createMonthSelect({ doc, id: 'qd-comp', onChange: (list) => { competencias = list; load(); } });

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function show(name) { PARTS.forEach((p) => { $(p).hidden = p !== name; }); }
  function setNotice(text) { $('qd-notice').textContent = text || ''; $('qd-notice').hidden = !text; }

  function showError(message, reference) {
    $('qd-error-msg').textContent = message;
    $('qd-error-ref').textContent = reference ? 'Código de referência: ' + reference : '';
    show('qd-error');
    $('qd-retry').focus();
  }

  // ---------- Tabela ----------
  const visibleRows = () => {
    const q = fold($('qd-q').value);
    const onlyPending = $('qd-pend').checked;
    return data.alunos.filter((a) => (!q || fold(a.nome).includes(q)) && (!statusFilter || a.status === statusFilter) && (!onlyPending || a.totais.pendentes > 0));
  };

  function renderStatusOptions() {
    const select = $('qd-status');
    const present = Array.from(new Set(data.alunos.map((a) => a.status).filter(Boolean))).sort();
    if (statusFilter && present.indexOf(statusFilter) === -1) statusFilter = '';
    select.textContent = '';
    [['', 'Todos os status']].concat(present.map((s) => [s, s])).forEach(([value, label]) => {
      const o = doc.createElement('option');
      o.value = value;
      o.textContent = label;
      select.appendChild(o);
    });
    select.value = statusFilter;
  }

  function cellNode(row, iso) {
    const c = row.cells[iso];
    const month = shortMonth(iso);
    if (!c) {
      if (!row.lancar) return el('span', 'qd-cell qd-vazio qd-off', NONE);
      const b = el('button', 'qd-cell qd-vazio', NONE);
      b.type = 'button';
      b.setAttribute('aria-label', row.nome + ', ' + month + ': ' + NONE + '. Lançar cobrança');
      b.addEventListener('click', () => openCell(row, iso, null, b));
      return b;
    }
    const cls = (CLASS[c.mostrar] || 'qd-isento') + (c.mostrar === 'Pendente' && c.vencida ? ' qd-venc' : '');
    const b = el('button', 'qd-cell ' + cls, SHORT[c.mostrar] || c.mostrar);
    b.type = 'button';
    b.setAttribute('aria-label', row.nome + ', ' + month + ': ' + c.mostrar);
    b.addEventListener('click', () => openCell(row, iso, c, b));
    return b;
  }

  function renderTable() {
    const rows = visibleRows();
    $('qd-count').textContent = rows.length === data.alunos.length ? data.alunos.length + ' alunos' : rows.length + ' de ' + data.alunos.length + ' alunos';
    if (!rows.length) { show('qd-empty'); return; }
    const table = $('qd-table');
    table.textContent = '';
    const thead = doc.createElement('thead');
    const hr = doc.createElement('tr');
    ['Aluno'].concat(data.competencias.map(shortMonth), ['Pagos', 'Pendentes', 'Pago até']).forEach((h, i) => {
      const th = el('th', i === 0 ? 'qd-name' : '', h);
      th.setAttribute('scope', 'col');
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const body = doc.createElement('tbody');
    rows.forEach((row) => {
      const tr = doc.createElement('tr');
      const name = el('td', 'qd-name');
      name.appendChild(el('span', 'qd-student', row.nome));
      const sub = [row.status && row.status !== 'Ativo' ? row.status : '', row.familia].filter(Boolean).join(' · ');
      if (sub) name.appendChild(el('span', 'muted qd-sub', sub));
      tr.appendChild(name);
      data.competencias.forEach((iso) => {
        const td = el('td', 'qd-td');
        td.appendChild(cellNode(row, iso));
        tr.appendChild(td);
      });
      tr.appendChild(el('td', 'dt-num', String(row.totais.pagos)));
      tr.appendChild(el('td', 'dt-num', String(row.totais.pendentes)));
      tr.appendChild(el('td', '', paidUntil(row.pago_ate)));
      body.appendChild(tr);
    });
    table.appendChild(body);
    show('qd-ready');
  }

  function renderLegend() {
    const ul = $('qd-legend');
    ul.textContent = '';
    LEGEND.forEach(([cls, label]) => {
      const li = doc.createElement('li');
      li.appendChild(el('span', 'qd-chip ' + cls, ''));
      li.appendChild(el('span', '', label));
      ul.appendChild(li);
    });
  }

  function render(d) {
    if (!d || !Array.isArray(d.alunos) || !Array.isArray(d.competencias) || !d.opcoes || !Array.isArray(d.opcoes.competencias)) throw new Error('quadro malformado');
    data = d;
    competencias = d.competencias;
    monthSelect.setOptions(d.opcoes.competencias);
    monthSelect.setValue(d.competencias);
    renderStatusOptions();
    renderLegend();
    renderTable();
  }

  // ---------- Cartão da célula ----------
  function closeCell(restoreFocus = true) {
    if (!cellDialog) return;
    const opener = cellDialog.opener;
    cellDialog = null;
    $('qd-cell').hidden = true;
    $('af-inner').inert = false;
    if (restoreFocus && opener && opener.focus) opener.focus();
  }

  function detail(dl, label, value) {
    dl.appendChild(el('dt', '', label));
    dl.appendChild(el('dd', '', value));
  }

  function openCell(row, iso, c, opener) {
    cellDialog = { opener };
    $('qd-cell-title').textContent = row.nome + ' · ' + fullLabel(iso);
    const dl = $('qd-cell-details');
    dl.textContent = '';
    const actions = $('qd-cell-actions');
    actions.textContent = '';
    const ext = { inertId: 'af-inner', hoje: data.hoje, opcoes: { formas: data.opcoes.formas, contas: data.opcoes.contas }, onDone: (message) => { setNotice(message); load(); } };
    let info = '';
    if (!c) {
      info = 'Ainda não há cobrança neste mês.';
      detail(dl, 'Situação', NONE);
      detail(dl, 'Mensalidade', money(row.mensalidade));
      const b = el('button', 'qd-primary', 'Lançar cobrança do mês');
      b.type = 'button';
      b.addEventListener('click', () => {
        closeCell(false);
        openAction('lancar', { student_id: row.student_id, nome: row.nome, competencia: iso, valor: row.mensalidade, vencimento: suggestedDue(iso, row.dia_vencimento) }, opener, ext);
      });
      actions.appendChild(b);
    } else {
      detail(dl, 'Situação', c.mostrar + (c.vencida ? ' (vencida)' : ''));
      detail(dl, 'Valor', money(c.valor));
      if (c.vencimento) detail(dl, 'Vencimento', dateBR(c.vencimento));
      if (c.pagamento) {
        detail(dl, 'Pagamento', c.pagamento.status + (c.pagamento.data ? ' · ' + dateBR(c.pagamento.data) : '') + (c.pagamento.forma ? ' · ' + c.pagamento.forma : '') + ' · ' + money(c.pagamento.valor));
      }
      ACTIONS.forEach(([flag, kind, label]) => {
        if (!c.acoes || !c.acoes[flag]) return;
        const b = el('button', actions.children.length === 0 ? 'qd-primary' : 'secondary', label);
        b.type = 'button';
        b.addEventListener('click', () => {
          closeCell(false);
          openAction(kind, Object.assign({ student_id: row.student_id }, c), opener, ext);
        });
        actions.appendChild(b);
      });
      if (!actions.children.length) info = (c.mostrar === 'Isento' || CLASS[c.mostrar] === 'qd-susp') ? 'Mês sem cobrança por isenção ou suspensão. Para mudar, ajuste a isenção do aluno em Aluno Full.' : 'Nenhuma ação disponível para este mês.';
    }
    $('qd-cell-info').textContent = info;
    $('qd-cell').hidden = false;
    $('af-inner').inert = true;
    (actions.children[0] || $('qd-cell-close')).focus();
  }

  // ---------- Carga ----------
  async function load() {
    const mine = ++requestId;
    show('qd-loading');
    let resp;
    try {
      resp = await api.call('alunofull.quadro', competencias ? [{ competencias }] : []);
    } catch (e) {
      if (mine === requestId) showError(e && e.name === 'TransportError' ? e.message : GENERIC_ERROR);
      return;
    }
    if (mine !== requestId) return;
    try {
      if (resp.ok) { render(resp.data); return; }
      if (AUTH_CODES[resp.error.code]) { onAuthFailure(resp.error.code); return; }
      showError(resp.error.message, resp.correlationId);
    } catch (e) {
      if (mine === requestId) showError(GENERIC_ERROR);
    }
  }

  function activate() {
    if (loaded) return;
    loaded = true;
    load();
  }

  function reset() {
    requestId += 1;
    loaded = false;
    data = null;
    competencias = null;
    statusFilter = 'Ativo';
    closeCell(false);
    monthSelect.reset();
    $('qd-table').textContent = '';
    $('qd-legend').textContent = '';
    $('qd-count').textContent = '';
    $('qd-q').value = '';
    $('qd-pend').checked = false;
    $('qd-status').textContent = '';
    $('qd-error-msg').textContent = '';
    $('qd-error-ref').textContent = '';
    setNotice('');
    show('qd-loading');
    $('qd-loading').hidden = true;
    PARTS.forEach((p) => { $(p).hidden = true; });
  }

  // ---------- CSV ----------
  function exportCsv() {
    if (!data) return;
    const rows = visibleRows();
    const head = ['Aluno', 'Família', 'Status'].concat(data.competencias.map(shortMonth), ['Pagos', 'Pendentes', 'Pago até']);
    const lines = [head.map(csvCell).join(';')];
    rows.forEach((r) => {
      const cells = data.competencias.map((iso) => (r.cells[iso] ? r.cells[iso].mostrar : NONE));
      lines.push([r.nome, r.familia, r.status].concat(cells, [String(r.totais.pagos), String(r.totais.pendentes), r.pago_ate ? paidUntil(r.pago_ate) : '']).map(csvCell).join(';'));
    });
    const first = data.competencias[0];
    const last = data.competencias[data.competencias.length - 1];
    download('quadro-pagamentos-' + first + (last === first ? '' : '-a-' + last) + '.csv', '﻿' + lines.join('\r\n') + '\r\n');
  }

  $('qd-q').addEventListener('input', () => { if (data) renderTable(); });
  $('qd-pend').addEventListener('change', () => { if (data) renderTable(); });
  $('qd-status').addEventListener('change', () => { statusFilter = $('qd-status').value; if (data) renderTable(); });
  $('qd-refresh').addEventListener('click', () => { setNotice(''); load(); });
  $('qd-retry').addEventListener('click', () => { load(); });
  $('qd-csv').addEventListener('click', exportCsv);
  $('qd-cell-close').addEventListener('click', () => closeCell());
  $('qd-cell-backdrop').addEventListener('click', () => closeCell());
  doc.addEventListener('keydown', (e) => { if (cellDialog && e && e.key === 'Escape') closeCell(); });
  monthSelect.setOptions([]);

  return { activate, reset, load };
}
