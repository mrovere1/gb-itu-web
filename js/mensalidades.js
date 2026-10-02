// Aba Mensalidades: lista de cobranças da competência e operações financeiras manuais.
// Recebe doc e api por injeção; não importa nada. Texto do servidor entra sempre por textContent.
// A tela só mostra os botões que o servidor permite (`acoes`), mas quem decide é o servidor.

import { deltaChip, deltaInfo, pctChange } from './delta.js?v=459aba66e2';

const PARTS = ['mens-loading', 'mens-error', 'mens-empty', 'mens-ready'];
const AUTH_CODES = Object.freeze({ NAO_AUTENTICADO: true, ACESSO_NEGADO: true });
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const GENERIC_ERROR = 'Não foi possível concluir. Tente novamente.';
const STALE = new Set(['VERSAO_DESATUALIZADA', 'ESTADO_INVALIDO', 'NAO_ENCONTRADO']);
const STATUS_CLASS = {
  Paga: 'chip-paga', Pendente: 'chip-pendente', 'Coberta por pacote': 'chip-pacote', Isenta: 'chip-neutro', Suspensa: 'chip-neutro', Cancelada: 'chip-neutro',
};
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const money = (n) => (typeof n === 'number' ? MONEY.format(n) : '—');
export const dateBR = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const monthLabel = (c) => (/^\d{4}-\d{2}$/.test(c) ? MONTHS[parseInt(c.slice(5), 10) - 1] + '/' + c.slice(2, 4) : String(c));
const compBR = (c) => (/^\d{4}-\d{2}$/.test(c) ? c.slice(5) + '/' + c.slice(0, 4) : c);

export function createMensalidades({ doc, api, onAuthFailure = () => {}, createTable = null }) {
  const $ = (id) => doc.getElementById(id);
  let loaded = false;
  let requestId = 0;
  let competencia = '';
  let data = null;      // última lista
  let dialog = null;    // { kind, item, opener, comps }
  let submitting = false;
  let view = 'cards';   // 'cards' | 'table'
  let table = null;

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function show(name) { PARTS.forEach((p) => { $(p).hidden = p !== name; }); }

  function showError(message, reference) {
    $('mens-error-msg').textContent = message;
    $('mens-error-ref').textContent = reference ? 'Código de referência: ' + reference : '';
    show('mens-error');
    $('mens-retry').focus();
  }

  function setNotice(text) {
    $('mens-notice').textContent = text || '';
    $('mens-notice').hidden = !text;
  }

  const filters = () => ({ competencia, busca: $('mens-q').value, status: $('mens-status').value });

  // ---------- Lista ----------
  function setOptions(select, values, labelFor, keep) {
    const current = keep === undefined ? select.value : keep;
    select.textContent = '';
    values.forEach((v) => {
      const o = doc.createElement('option');
      o.value = v;
      o.textContent = labelFor(v);
      select.appendChild(o);
    });
    select.value = values.includes(current) ? current : values[0];
  }

  // O que é bom: pago e previsto subirem; pendente e vencido caírem.
  const TOTALS = [['Previsto', 'previsto', 'alta-boa'], ['Pago', 'pago', 'alta-boa'], ['Pendente', 'pendente', 'alta-ma'], ['Vencido', 'vencido', 'alta-ma']];

  function renderTotals(t, prev, prevComp) {
    const box = $('mens-totals');
    box.textContent = '';
    TOTALS.forEach(([label, key, sentido]) => {
      const pct = prev ? pctChange(t[key], prev[key]) : null;
      const info = deltaInfo(pct, sentido);
      const card = el('div', 'total-card' + (info ? ' total-' + info.tone : ''));
      card.appendChild(el('span', 'total-label', label));
      const main = el('div', 'total-main');
      main.appendChild(el('strong', '', money(t[key])));
      const chip = deltaChip(doc, pct, sentido, prevComp ? monthLabel(prevComp) : '');
      if (chip) main.appendChild(chip);
      card.appendChild(main);
      if (prev && prevComp) card.appendChild(el('span', 'total-prev', monthLabel(prevComp) + ': ' + money(prev[key])));
      box.appendChild(card);
    });
  }

  function actionButton(label, kind, item, className) {
    const b = el('button', className || 'secondary', label);
    b.type = 'button';
    b.addEventListener('click', () => openDialog(kind, item, b));
    return b;
  }

  /** Todos os meses pendentes do aluno (não só o filtrado), com atalho para ver cada mês. */
  function pendingBlock(item) {
    const list = Array.isArray(item.pendencias) ? item.pendencias : [];
    if (list.length === 0) return null;
    const box = el('div', 'mens-pend');
    box.appendChild(el('span', 'mens-pend-label', item.status === 'Pendente' ? 'Pendências:' : 'Outros meses pendentes:'));
    list.forEach((p) => {
      const b = el('button', 'chip ' + (p.vencida ? 'chip-vencida' : 'chip-pendente') + ' chip-btn', monthLabel(p.competencia));
      b.type = 'button';
      b.title = 'Ver ' + monthLabel(p.competencia) + (typeof p.valor === 'number' ? ' · ' + money(p.valor) : '');
      if (p.competencia === item.competencia) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => openWith({ competencia: p.competencia, busca: item.nome }));
      box.appendChild(b);
    });
    if (item.pendenciasAnteriores > 0) {
      const n = item.pendenciasAnteriores;
      box.appendChild(el('span', 'mens-warn', n + (n === 1 ? ' mês anterior em aberto · ' : ' meses anteriores em aberto · ') + money(item.pendenciasAnterioresValor)));
    }
    return box;
  }

  function renderRow(item) {
    const li = doc.createElement('li');
    const row = el('div', 'mens-row');
    const main = el('div', 'mens-main');
    main.appendChild(el('span', 'student-name', item.nome));
    const parts = [];
    if (item.vencimento) parts.push('vence ' + dateBR(item.vencimento));
    else if (item.status === 'Pendente') parts.push('sem vencimento');
    if (item.pagamento && item.pagamento.status === 'Confirmado') parts.push('pago em ' + dateBR(item.pagamento.data) + (item.pagamento.forma ? ' (' + item.pagamento.forma + ')' : ''));
    if (item.pagamento && item.pagamento.status === 'Estornado') parts.push('pagamento estornado');
    main.appendChild(el('span', 'muted', parts.join(' · ')));
    const pend = pendingBlock(item);
    if (pend) main.appendChild(pend);
    row.appendChild(main);
    row.appendChild(el('strong', 'mens-value', money(item.valor)));
    const chips = el('span', 'mens-chips');
    chips.appendChild(el('span', 'chip ' + (STATUS_CLASS[item.status] || 'chip-neutro'), item.status));
    if (item.vencida) chips.appendChild(el('span', 'chip chip-vencida', 'Vencida'));
    row.appendChild(chips);
    const actions = el('div', 'mens-actions');
    if (item.acoes.registrar) actions.appendChild(actionButton('Registrar pagamento', 'pagar', item, ''));
    if (item.acoes.editarVencimento) actions.appendChild(actionButton('Vencimento', 'vencimento', item));
    if (item.acoes.estornar) actions.appendChild(actionButton('Estornar', 'estornar', item));
    if (item.acoes.cancelar) actions.appendChild(actionButton('Cancelar', 'cancelar', item));
    row.appendChild(actions);
    li.appendChild(row);
    return li;
  }

  function assertShape(d) {
    const ok = d && Array.isArray(d.itens) && d.totais && d.permissoes && d.opcoes && Array.isArray(d.opcoes.formas)
      && Array.isArray(d.opcoes.contas) && Array.isArray(d.opcoes.status) && typeof d.competencia === 'string';
    if (!ok) throw new Error('lista malformada');
  }

  function render(d) {
    assertShape(d);
    data = d;
    competencia = d.competencia;
    $('mens-comp').value = d.competencia;
    setOptions($('mens-status'), ['', ...d.opcoes.status], (v) => (v === '' ? 'Todos os status' : v));
    $('mens-generate').hidden = !d.permissoes.gerar;
    renderTotals(d.totais, d.totaisAnterior, d.competenciaAnterior);
    $('mens-count').textContent = d.total === d.totais.cobrancas ? d.total + ' cobranças' : d.total + ' de ' + d.totais.cobrancas + ' cobranças';
    $('mens-truncated').hidden = d.total <= d.itens.length;
    const list = $('mens-list');
    list.textContent = '';
    d.itens.forEach((i) => list.appendChild(renderRow(i)));
    show(d.itens.length === 0 ? 'mens-empty' : 'mens-ready');
    if (table) table.setRows(d.itens);
    applyView();
  }

  async function load(keepNotice) {
    const mine = ++requestId;
    if (!keepNotice) setNotice('');
    show('mens-loading');
    let resp;
    try {
      resp = await api.call('mensalidades.listar', [filters()]);
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

  // ---------- Janela de operação ----------
  const BOXES = ['mens-f-data-box', 'mens-f-forma-box', 'mens-f-conta-box', 'mens-f-obs-box', 'mens-f-motivo-box', 'mens-f-venc-box', 'mens-f-gcomp-box'];
  const FIELDS = {
    pagar: ['mens-f-data-box', 'mens-f-forma-box', 'mens-f-conta-box', 'mens-f-obs-box'],
    vencimento: ['mens-f-venc-box'],
    cancelar: ['mens-f-motivo-box'],
    estornar: ['mens-f-motivo-box'],
    gerar: ['mens-f-gcomp-box'],
  };
  const TITLES = { pagar: 'Registrar pagamento', vencimento: 'Editar vencimento', cancelar: 'Cancelar cobrança', estornar: 'Estornar pagamento', gerar: 'Gerar cobranças do mês' };
  const SUBMIT = { pagar: 'Registrar pagamento', vencimento: 'Salvar vencimento', cancelar: 'Cancelar cobrança', estornar: 'Estornar pagamento', gerar: 'Gerar cobranças' };

  function showDialogError(messages) {
    const box = $('mens-dialog-error');
    box.textContent = '';
    (Array.isArray(messages) ? messages : [messages]).filter(Boolean).forEach((m) => box.appendChild(el('p', '', m)));
    box.hidden = box.children.length === 0;
    if (!box.hidden) box.focus();
  }

  function dialogInfo(kind, item) {
    if (kind === 'pagar') return item.nome + ' · competência ' + compBR(item.competencia) + ' · ' + money(item.valor) + '. O pagamento é sempre integral.';
    if (kind === 'vencimento') return item.nome + ' · competência ' + compBR(item.competencia) + ' · ' + money(item.valor);
    if (kind === 'cancelar') return 'A cobrança de ' + item.nome + ' (' + compBR(item.competencia) + ', ' + money(item.valor) + ') será marcada como cancelada. Nada é apagado.';
    if (kind === 'estornar') return 'O pagamento de ' + item.nome + ' (' + money(item.pagamento && item.pagamento.valor) + ') será marcado como estornado e a cobrança volta a pendente. Nada é apagado.';
    return '';
  }

  function openDialog(kind, item, opener) {
    dialog = { kind, item, opener };
    BOXES.forEach((id) => { $(id).hidden = !FIELDS[kind].includes(id); });
    $('mens-dialog-title').textContent = TITLES[kind];
    $('mens-dialog-info').textContent = dialogInfo(kind, item);
    $('mens-submit').textContent = SUBMIT[kind];
    $('mens-submit').disabled = false;
    showDialogError([]);
    $('mens-f-data').value = data.hoje;
    $('mens-f-data').max = data.hoje;
    setOptions($('mens-f-forma'), ['', ...data.opcoes.formas], (v) => (v === '' ? 'Escolha…' : v), '');
    setOptions($('mens-f-conta'), ['', ...data.opcoes.contas], (v) => (v === '' ? 'Não informar' : 'Conta ' + v), '');
    $('mens-f-obs').value = '';
    $('mens-f-motivo').value = '';
    $('mens-f-venc').value = item && item.vencimento ? item.vencimento : '';
    $('mens-dialog').hidden = false;
    $('view-mensalidades-inner').inert = true;
    if (kind === 'gerar') openGenerate();
    else focusFirst(kind);
  }

  function focusFirst(kind) {
    const first = { pagar: 'mens-f-data', vencimento: 'mens-f-venc', cancelar: 'mens-f-motivo', estornar: 'mens-f-motivo' }[kind];
    $(first).focus();
  }

  function closeDialog(restoreFocus = true) {
    if (!dialog) return;
    const opener = dialog.opener;
    dialog = null;
    $('mens-dialog').hidden = true;
    $('view-mensalidades-inner').inert = false;
    if (restoreFocus && opener && opener.focus) opener.focus();
  }

  // ---------- Geração mensal ----------
  function generationChoices() {
    const [y, m] = data.hoje.split('-').map(Number);
    const next = m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0');
    return [data.hoje.slice(0, 7), next];
  }

  function summaryText(r) {
    const s = r.resumo;
    const parts = [
      s.elegiveis + (s.elegiveis === 1 ? ' cobrança será criada' : ' cobranças serão criadas') + ' (' + money(s.valorTotal) + ')',
      s.jaExistentes + ' já existiam e serão puladas',
      s.comPacote + ' coberta(s) por pacote',
      s.comDiaPadrao + ' sem dia de vencimento (usarão o dia ' + r.diaPadrao + ')',
      s.ignoradosIsentos + ' isento(s) ignorado(s)',
    ];
    return parts.join(' · ') + '. Isto só cria o registro no sistema: nenhuma mensagem é enviada a ninguém.';
  }

  async function previewGenerate() {
    const mine = dialog;
    $('mens-submit').disabled = true;
    $('mens-dialog-info').textContent = 'Calculando…';
    let resp;
    try {
      resp = await api.call('mensalidades.previaGerar', [{ competencia: $('mens-f-gcomp').value }]);
    } catch (e) {
      if (dialog === mine) showDialogError(e && e.name === 'TransportError' ? e.message : GENERIC_ERROR);
      return;
    }
    if (dialog !== mine) return;
    if (resp.ok) {
      $('mens-dialog-info').textContent = summaryText(resp.data);
      $('mens-submit').disabled = resp.data.resumo.elegiveis === 0;
      if (resp.data.resumo.elegiveis === 0) showDialogError('Não há cobranças novas para esta competência.');
      return;
    }
    if (AUTH_CODES[resp.error.code]) { closeDialog(false); onAuthFailure(resp.error.code); return; }
    $('mens-dialog-info').textContent = '';
    showDialogError(resp.error.message);
  }

  function openGenerate() {
    const choices = generationChoices();
    setOptions($('mens-f-gcomp'), choices, (v) => compBR(v), choices[0]);
    $('mens-f-gcomp').focus();
    previewGenerate();
  }

  // ---------- Envio ----------
  function request() {
    const { kind, item } = dialog;
    if (kind === 'pagar') {
      return ['mensalidades.registrarPagamento', [item.charge_id, {
        versao: item.versao, data: $('mens-f-data').value, forma: $('mens-f-forma').value, conta: $('mens-f-conta').value, observacao: $('mens-f-obs').value,
      }], 'Pagamento registrado.'];
    }
    if (kind === 'vencimento') return ['mensalidades.editarVencimento', [item.charge_id, { versao: item.versao, vencimento: $('mens-f-venc').value }], 'Vencimento atualizado.'];
    if (kind === 'cancelar') return ['mensalidades.cancelar', [item.charge_id, { versao: item.versao, motivo: $('mens-f-motivo').value }], 'Cobrança cancelada.'];
    if (kind === 'estornar') return ['mensalidades.estornar', [item.pagamento.payment_id, { motivo: $('mens-f-motivo').value }], 'Pagamento estornado.'];
    return ['mensalidades.gerar', [{ competencia: $('mens-f-gcomp').value }], null];
  }

  async function submit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!dialog || submitting) return;
    submitting = true;
    $('mens-submit').disabled = true;
    showDialogError([]);
    const mine = dialog;
    const [acao, args, okMessage] = request();
    let resp;
    try {
      resp = await api.call(acao, args);
    } catch (err) {
      submitting = false;
      if (dialog === mine) { $('mens-submit').disabled = false; showDialogError(err && err.name === 'TransportError' ? err.message : GENERIC_ERROR); }
      return;
    }
    submitting = false;
    if (dialog !== mine) return;
    try {
      if (resp.ok) {
        const kind = mine.kind;
        const message = kind === 'gerar'
          ? resp.data.criadas + (resp.data.criadas === 1 ? ' cobrança criada' : ' cobranças criadas') + ' para ' + compBR(resp.data.competencia) + '.'
          : okMessage;
        closeDialog(false);
        if (kind === 'gerar') competencia = resp.data.competencia;
        await load(true);
        setNotice(message);
        return;
      }
      const code = resp.error.code;
      if (AUTH_CODES[code]) { closeDialog(false); onAuthFailure(code); return; }
      $('mens-submit').disabled = false;
      const fields = Array.isArray(resp.error.fields) ? resp.error.fields.map((f) => f.mensagem) : [];
      showDialogError(fields.length ? fields : resp.error.message);
      if (STALE.has(code)) { setNotice(''); load(true); }
    } catch (err) {
      $('mens-submit').disabled = false;
      showDialogError(GENERIC_ERROR);
    }
  }

  /** Abre a lista já na competência e com a busca pedida (usado pela área de trabalho do painel). */
  function openWith(f) {
    loaded = true;
    if (f && COMPETENCIA.test(f.competencia || '')) competencia = f.competencia;
    $('mens-q').value = f && typeof f.busca === 'string' ? f.busca.slice(0, 60) : '';
    $('mens-status').value = '';
    return load();
  }

  // ---------- Tabela configurável ----------
  // API antiga (sem pendências por mês) ainda funciona: os campos ausentes viram colunas vazias.
  const pendOf = (i) => (Array.isArray(i.pendencias) ? i.pendencias : []);
  const numOrNull = (v) => (typeof v === 'number' ? v : null);

  function buildTable() {
    if (!createTable) return null;
    const chip = (cls, text) => el('span', 'chip ' + cls, text);
    const paidOn = (i) => (i.pagamento && i.pagamento.status === 'Confirmado' ? i.pagamento : null);
    return createTable({
      root: $('mens-table-root'), tableId: 'mensalidades', fileName: 'mensalidades', defaultSort: ['nome', 1],
      columns: [
        { key: 'nome', label: 'Aluno', type: 'text', value: (i) => i.nome, filter: 'text' },
        { key: 'competencia', label: 'Competência', type: 'text', value: (i) => i.competencia, text: (i) => compBR(i.competencia), filter: 'text', defaultVisible: false },
        { key: 'vencimento', label: 'Vencimento', type: 'date', value: (i) => i.vencimento, filter: 'date' },
        { key: 'valor', label: 'Valor', type: 'money', value: (i) => i.valor, filter: 'range' },
        { key: 'status', label: 'Status', type: 'chip', value: (i) => i.status, filter: 'select',
          render: (i, td) => { td.appendChild(chip(STATUS_CLASS[i.status] || 'chip-neutro', i.status)); if (i.vencida) td.appendChild(chip('chip-vencida', 'Vencida')); } },
        { key: 'pendMeses', label: 'Meses pendentes', type: 'text', value: (i) => pendOf(i).map((p) => monthLabel(p.competencia)).join(', '), filter: 'text' },
        { key: 'pendQtd', label: 'Qtd. de meses pendentes', type: 'number', value: (i) => (Array.isArray(i.pendencias) ? i.pendencias.length : null), filter: 'range', defaultVisible: false },
        { key: 'atrasadas', label: 'Meses anteriores em aberto', type: 'number', value: (i) => numOrNull(i.pendenciasAnteriores), filter: 'range' },
        { key: 'emAberto', label: 'Em aberto do aluno', type: 'money', value: (i) => numOrNull(i.pendenciasValor), filter: 'range' },
        { key: 'pagoEm', label: 'Pago em', type: 'date', value: (i) => (paidOn(i) ? paidOn(i).data : ''), filter: 'date', defaultVisible: false },
        { key: 'forma', label: 'Forma de pagamento', type: 'text', value: (i) => (paidOn(i) ? paidOn(i).forma : ''), filter: 'select', defaultVisible: false },
        { key: 'acoes', label: 'Ações', locked: true, value: () => '',
          render: (i, td) => {
            const soft = 'btn-soft btn-xs';
            if (i.acoes.registrar) td.appendChild(actionButton('Pagar', 'pagar', i, soft + ' btn-accent'));
            if (i.acoes.editarVencimento) td.appendChild(actionButton('Vencimento', 'vencimento', i, soft));
            if (i.acoes.estornar) td.appendChild(actionButton('Estornar', 'estornar', i, soft));
            if (i.acoes.cancelar) td.appendChild(actionButton('Cancelar', 'cancelar', i, soft));
          } },
      ],
    });
  }

  function applyView() {
    const t = view === 'table' && !!table;
    $('mens-list').hidden = t;
    $('mens-count').hidden = t; // a tabela já mostra a contagem
    $('mens-table-root').hidden = !t;
    $('mens-views').hidden = !table;
    $('mens-view-cards').setAttribute('aria-pressed', String(!t));
    $('mens-view-table').setAttribute('aria-pressed', String(t));
  }

  // ---------- Ciclo de vida ----------
  function activate() {
    if (loaded) return;
    loaded = true;
    load();
  }

  /** Apaga tudo do usuário anterior e invalida respostas pendentes. */
  function reset() {
    requestId += 1;
    loaded = false;
    data = null;
    competencia = '';
    dialog = null;
    submitting = false;
    view = 'cards';
    if (table) table.reset();
    applyView();
    $('mens-dialog').hidden = true;
    $('view-mensalidades-inner').inert = false;
    ['mens-list', 'mens-totals', 'mens-dialog-error', 'mens-error-msg', 'mens-error-ref', 'mens-notice'].forEach((id) => { $(id).textContent = ''; });
    $('mens-notice').hidden = true;
    $('mens-dialog-error').hidden = true;
    $('mens-q').value = '';
    $('mens-comp').value = '';
    $('mens-count').textContent = '';
    $('mens-generate').hidden = true;
    $('mens-truncated').hidden = true;
    show('mens-loading');
  }

  $('mens-filter').addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $('mens-refresh').addEventListener('click', () => { load(); });
  $('mens-retry').addEventListener('click', () => { load(); });
  $('mens-comp').addEventListener('change', () => {
    const v = $('mens-comp').value;
    if (!COMPETENCIA.test(v) || v === competencia) { $('mens-comp').value = competencia; return; }
    competencia = v;
    load();
  });
  $('mens-status').addEventListener('change', () => { load(); });
  $('mens-generate').addEventListener('click', () => { if (data) openDialog('gerar', null, $('mens-generate')); });
  $('mens-view-cards').addEventListener('click', () => { view = 'cards'; applyView(); });
  $('mens-view-table').addEventListener('click', () => { if (table) { view = 'table'; applyView(); } });
  $('mens-form').addEventListener('submit', submit);
  $('mens-cancel').addEventListener('click', () => closeDialog());
  $('mens-dialog-backdrop').addEventListener('click', () => closeDialog());
  $('mens-f-gcomp').addEventListener('change', () => { if (dialog && dialog.kind === 'gerar') previewGenerate(); });
  doc.addEventListener('keydown', (e) => { if (dialog && e && e.key === 'Escape') closeDialog(); });

  table = buildTable();
  applyView();

  return { activate, reset, load, openWith };
}
