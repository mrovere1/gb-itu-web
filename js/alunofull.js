// Aba "Aluno Full" (só Administrador): alunos agrupados por família, com plano, valor e pendências. SOMENTE LEITURA.
// Recebe doc e api por injeção; não importa nada. Texto do servidor entra sempre por textContent.
// A aba só aparece para o Administrador, mas quem decide é o servidor (`alunofull.listar` nega os demais perfis).

const PARTS = ['af-loading', 'af-error', 'af-empty', 'af-ready'];
const AUTH_CODES = Object.freeze({ NAO_AUTENTICADO: true, ACESSO_NEGADO: true });
const GENERIC_ERROR = 'Não foi possível exibir os dados. Tente novamente.';
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (n) => (typeof n === 'number' ? MONEY.format(n) : '—');
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const PAPEL = { responsavel: 'Responsável', dependente: 'Dependente', sem_responsavel: 'Sem responsável' };
const SEM_FAMILIA = 'Sem responsável';

/** "2027-01" -> "01/2027"; vazio -> "—". */
const paidUntil = (v) => (/^\d{4}-\d{2}$/.test(v) ? v.slice(5) + '/' + v.slice(0, 4) : '—');

export function createAlunoFull({ doc, api, onAuthFailure = () => {}, createTable = null }) {
  const $ = (id) => doc.getElementById(id);
  let loaded = false;
  let requestId = 0;
  let data = null;
  let view = 'families'; // 'families' | 'list'
  let table = null;

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function show(name) { PARTS.forEach((p) => { $(p).hidden = p !== name; }); }

  function showError(message, reference) {
    $('af-error-msg').textContent = message;
    $('af-error-ref').textContent = reference ? 'Código de referência: ' + reference : '';
    show('af-error');
    $('af-retry').focus();
  }

  const valueText = (a) => {
    const m = a.matricula;
    if (!m) return '—';
    if (m.tipo_isencao) return m.tipo_isencao;
    return money(m.valor);
  };
  const pendingText = (a) => (a.pendentes ? a.pendentes + ' · ' + money(a.valorPendente) : '—');

  // ---------- Famílias ----------
  function familyHeader(f) {
    const head = el('header', 'af-head');
    head.appendChild(el('h3', 'af-name', f.nome));
    if (f.tipo === 'aluno') head.appendChild(el('span', 'chip chip-neutro', 'Responsável e aluno'));
    const r = f.resumo;
    const parts = [r.alunos + (r.alunos === 1 ? ' aluno' : ' alunos')];
    if (r.mensal > 0) parts.push(money(r.mensal) + '/mês');
    if (r.pendentes > 0) parts.push(r.pendentes + (r.pendentes === 1 ? ' pendência' : ' pendências') + ' (' + money(r.valorPendente) + ')');
    head.appendChild(el('span', 'muted', parts.join(' · ')));
    return head;
  }

  function memberTable(members) {
    const wrap = el('div', 'ws-table-wrap af-wrap');
    const t = el('table', 'ws-table af-table');
    const thead = doc.createElement('thead');
    const hr = doc.createElement('tr');
    ['Aluno', 'Status', 'Plano', 'Valor', 'Dia', 'Pago até', 'Pendências'].forEach((h, i) => {
      const th = el('th', i === 3 || i === 4 ? 'dt-num' : '', h);
      th.setAttribute('scope', 'col');
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    const body = doc.createElement('tbody');
    members.forEach((a) => {
      const tr = doc.createElement('tr');
      const name = el('td');
      name.appendChild(el('span', 'af-student', a.nome));
      if (a.papel === 'responsavel') name.appendChild(el('span', 'muted', ' · responsável'));
      tr.appendChild(name);
      tr.appendChild(el('td', '', a.status));
      tr.appendChild(el('td', '', a.matricula && a.matricula.plano ? a.matricula.plano : '—'));
      tr.appendChild(el('td', 'dt-num', valueText(a)));
      tr.appendChild(el('td', 'dt-num', a.matricula && a.matricula.dia_vencimento != null ? String(a.matricula.dia_vencimento) : '—'));
      tr.appendChild(el('td', '', a.matricula ? paidUntil(a.matricula.pago_ate) : '—'));
      const pend = el('td', '');
      pend.appendChild(a.vencidas > 0 ? el('span', 'chip chip-vencida', pendingText(a)) : el('span', a.pendentes ? 'chip chip-pendente' : '', pendingText(a)));
      tr.appendChild(pend);
      body.appendChild(tr);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  function renderFamilies() {
    const root = $('af-groups');
    root.textContent = '';
    const q = fold($('af-q').value);
    const byId = {};
    data.alunos.forEach((a) => { byId[a.student_id] = a; });
    let shown = 0;
    data.familias.forEach((f) => {
      const members = f.membros.map((id) => byId[id]).filter(Boolean);
      const familyMatches = !q || fold(f.nome).includes(q);
      const picked = familyMatches ? members : members.filter((a) => fold(a.nome).includes(q));
      if (!picked.length && !(familyMatches && !members.length)) return;
      const section = el('section', 'af-family');
      section.appendChild(familyHeader(f));
      if (picked.length) section.appendChild(memberTable(picked));
      else section.appendChild(el('p', 'muted', 'Nenhum dependente vinculado.'));
      root.appendChild(section);
      shown += picked.length || 0;
    });
    const loose = data.semResponsavel.map((id) => byId[id]).filter((a) => a && (!q || fold(a.nome).includes(q)));
    if (loose.length) {
      const section = el('section', 'af-family');
      const head = el('header', 'af-head');
      head.appendChild(el('h3', 'af-name', SEM_FAMILIA));
      head.appendChild(el('span', 'muted', loose.length + (loose.length === 1 ? ' aluno' : ' alunos')));
      section.appendChild(head);
      section.appendChild(memberTable(loose));
      root.appendChild(section);
      shown += loose.length;
    }
    $('af-count').textContent = q ? shown + ' de ' + data.total + ' alunos' : data.total + ' alunos';
    $('af-nomatch').hidden = shown > 0 || !q;
  }

  // ---------- Lista (tabela configurável) ----------
  function buildTable() {
    if (!createTable) return null;
    return createTable({
      root: $('af-table-root'), tableId: 'alunofull', fileName: 'aluno-full', defaultSort: ['nome', 1],
      columns: [
        { key: 'nome', label: 'Aluno', type: 'text', value: (a) => a.nome, filter: 'text' },
        { key: 'familia', label: 'Família', type: 'text', value: (a) => familyName(a), filter: 'text' },
        { key: 'papel', label: 'Papel', type: 'text', value: (a) => PAPEL[a.papel] || a.papel, filter: 'select' },
        { key: 'status', label: 'Status', type: 'text', value: (a) => a.status, filter: 'select' },
        { key: 'plano', label: 'Plano', type: 'text', value: (a) => (a.matricula ? a.matricula.plano : null), filter: 'select' },
        { key: 'valor', label: 'Valor', type: 'money', value: (a) => (a.matricula ? a.matricula.valor : null), filter: 'range' },
        { key: 'isencao', label: 'Isenção', type: 'text', value: (a) => (a.matricula ? a.matricula.tipo_isencao : ''), filter: 'select', defaultVisible: false },
        { key: 'dia', label: 'Dia', type: 'number', value: (a) => (a.matricula ? a.matricula.dia_vencimento : null), filter: 'range', defaultVisible: false },
        { key: 'pago_ate', label: 'Pago até', type: 'text', value: (a) => (a.matricula && a.matricula.pago_ate ? a.matricula.pago_ate : null), text: (a) => (a.matricula ? paidUntil(a.matricula.pago_ate) : '—'), filter: 'text', defaultVisible: false },
        { key: 'pendentes', label: 'Pendências', type: 'number', value: (a) => a.pendentes, filter: 'range' },
        { key: 'valorPendente', label: 'Valor pendente', type: 'money', value: (a) => a.valorPendente, filter: 'range', defaultVisible: false },
        { key: 'faixa', label: 'Faixa', type: 'text', value: (a) => a.faixa, filter: 'select', defaultVisible: false },
      ],
    });
  }

  const families = {};
  function familyName(a) {
    return a.familia_id && families[a.familia_id] ? families[a.familia_id] : SEM_FAMILIA;
  }

  function applyView() {
    const f = view === 'families' || !table;
    $('af-groups').hidden = !f;
    $('af-table-root').hidden = f;
    $('af-q-box').hidden = !f; // a tabela já tem busca e filtros por coluna
    $('af-count').hidden = !f;
    $('af-nomatch').hidden = true;
    $('af-view-families').setAttribute('aria-pressed', String(f));
    $('af-view-list').setAttribute('aria-pressed', String(!f));
    $('af-views').hidden = !table;
  }

  function render(d) {
    if (!d || !Array.isArray(d.familias) || !Array.isArray(d.alunos) || !Array.isArray(d.semResponsavel) || !Array.isArray(d.avisos)) throw new Error('lista malformada');
    data = d;
    Object.keys(families).forEach((k) => { delete families[k]; });
    d.familias.forEach((f) => { families[f.guardian_id] = f.nome; });
    if (d.total === 0) { show('af-empty'); return; }
    $('af-avisos').textContent = d.avisos.length
      ? 'Há ' + d.avisos.length + (d.avisos.length === 1 ? ' vínculo' : ' vínculos') + ' com inconsistência (responsável ou matrícula). Confira os cadastros na planilha.'
      : '';
    $('af-avisos').hidden = d.avisos.length === 0;
    renderFamilies();
    if (table) table.setRows(d.alunos);
    applyView();
    show('af-ready');
  }

  async function load() {
    const mine = ++requestId;
    show('af-loading');
    let resp;
    try {
      resp = await api.call('alunofull.listar', []);
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

  /** Apaga tudo do usuário anterior e invalida respostas pendentes (troca ou saída de usuário). */
  function reset() {
    requestId += 1;
    loaded = false;
    data = null;
    view = 'families';
    Object.keys(families).forEach((k) => { delete families[k]; });
    if (table) table.reset();
    $('af-q').value = '';
    $('af-groups').textContent = '';
    $('af-count').textContent = '';
    $('af-avisos').textContent = '';
    $('af-avisos').hidden = true;
    $('af-error-msg').textContent = '';
    $('af-error-ref').textContent = '';
    applyView();
    show('af-loading');
  }

  $('af-view-families').addEventListener('click', () => { view = 'families'; applyView(); });
  $('af-view-list').addEventListener('click', () => { if (table) { view = 'list'; applyView(); } });
  $('af-q').addEventListener('input', () => { if (data) renderFamilies(); });
  $('af-refresh').addEventListener('click', () => { loaded = true; load(); });
  $('af-retry').addEventListener('click', () => { load(); });
  table = buildTable();
  applyView();

  return { activate, reset };
}
