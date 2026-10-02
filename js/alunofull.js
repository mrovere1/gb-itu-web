// Aba "Aluno Full" (só Administrador): alunos agrupados por família, com plano, valor e pendências.
// Ao clicar num aluno abre um painel para definir o responsável da família e editar plano, valor, dia, isenção e pago até.
// Recebe doc e api por injeção; não importa nada. Texto do servidor entra sempre por textContent.
// A aba só aparece para o Administrador, mas quem decide é o servidor (nega os demais perfis e valida tudo de novo).
// Cobranças já geradas não mudam ao editar o valor: o painel avisa que vale para as próximas.

const PARTS = ['af-loading', 'af-error', 'af-empty', 'af-ready'];
const AUTH_CODES = Object.freeze({ NAO_AUTENTICADO: true, ACESSO_NEGADO: true });
const GENERIC_ERROR = 'Não foi possível exibir os dados. Tente novamente.';
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (n) => (typeof n === 'number' ? MONEY.format(n) : '—');
const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const PAPEL = { responsavel: 'Responsável', dependente: 'Dependente', sem_responsavel: 'Sem responsável' };
const SEM_FAMILIA = 'Sem responsável';
const STALE = new Set(['VERSAO_DESATUALIZADA', 'ESTADO_INVALIDO', 'NAO_ENCONTRADO']);
const MODOS = [['proprio', 'É o próprio responsável'], ['aluno', 'Outro aluno é o responsável'], ['externo', 'Responsável externo'], ['nenhum', 'Sem responsável']];
const NOVO = '__novo';
const STALE_MESSAGE = 'Este cadastro foi alterado por outra pessoa. Os dados foram recarregados: abra o aluno de novo e refaça a alteração.';
const SAVE_ERROR = 'Não foi possível salvar. Tente novamente.';

/** "2027-01" -> "01/2027"; vazio -> "—". */
const paidUntil = (v) => (/^\d{4}-\d{2}$/.test(v) ? v.slice(5) + '/' + v.slice(0, 4) : '—');

export function createAlunoFull({ doc, api, onAuthFailure = () => {}, createTable = null, openStudent = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  let loaded = false;
  let requestId = 0;
  let data = null;
  let view = 'families'; // 'families' | 'list'
  let table = null;
  let dialog = null;     // { item, opener }
  let submitting = false;

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

  // ---------- Painel de edição ----------
  const canEdit = () => !!(data && data.permissoes && data.permissoes.editar);

  function nameControl(a) {
    if (!canEdit()) return el('span', 'af-student', a.nome);
    const b = el('button', 'dt-link af-student', a.nome);
    b.type = 'button';
    b.setAttribute('aria-label', 'Editar ' + a.nome);
    b.addEventListener('click', () => openEditor(a, b));
    return b;
  }

  function setOptions(select, pairs, selected) {
    select.textContent = '';
    pairs.forEach(([value, label]) => {
      const o = doc.createElement('option');
      o.value = value;
      o.textContent = label;
      select.appendChild(o);
    });
    select.value = pairs.some(([v]) => v === selected) ? selected : (pairs[0] ? pairs[0][0] : '');
  }

  const familyOf = (id) => data.familias.find((f) => f.guardian_id === id) || null;

  /** O que o servidor tem hoje para o aluno, no mesmo vocabulário do formulário. */
  function currentChoice(item) {
    if (item.papel === 'responsavel') return { modo: 'proprio' };
    if (item.papel === 'dependente') {
      const f = familyOf(item.familia_id);
      if (f && f.tipo === 'aluno') return { modo: 'aluno', aluno: f.aluno_id };
      if (f) return { modo: 'externo', guardian: f.guardian_id };
    }
    return { modo: 'nenhum' };
  }

  const money2 = (n) => (typeof n === 'number' ? String(n).replace('.', ',') : '');

  function fillStudentOptions(item, selected) {
    const q = fold($('af-f-aluno-q').value);
    const candidates = data.alunos.filter((a) => a.student_id !== item.student_id && a.papel !== 'dependente' && (!q || fold(a.nome).includes(q) || a.student_id === selected))
      .map((a) => [a.student_id, a.nome + (a.papel === 'responsavel' ? ' (responsável)' : '')]);
    setOptions($('af-f-aluno'), [['', 'Escolha o aluno…']].concat(candidates), selected);
  }

  function updateModeBoxes() {
    const modo = $('af-f-modo').value;
    $('af-f-aluno-box').hidden = modo !== 'aluno';
    $('af-f-ext-box').hidden = modo !== 'externo';
    $('af-f-novo-box').hidden = !(modo === 'externo' && $('af-f-ext').value === NOVO);
    $('af-f-parent-box').hidden = modo !== 'aluno' && modo !== 'externo';
  }

  function showDialogError(messages) {
    const list = Array.isArray(messages) ? messages : [messages];
    const box = $('af-dialog-error');
    box.textContent = list.filter(Boolean).join(' ');
    box.hidden = !box.textContent;
    if (!box.hidden) box.focus();
  }

  function fillEditor(item) {
    $('af-dialog-title').textContent = item.nome;
    const f = familyOf(item.familia_id);
    $('af-dialog-info').textContent = item.papel === 'responsavel'
      ? 'Hoje: responsável' + (f ? ' pela família ' + f.nome : '')
      : (item.papel === 'dependente' && f ? 'Hoje: dependente de ' + f.nome : 'Hoje: sem responsável');
    const cur = currentChoice(item);
    setOptions($('af-f-modo'), MODOS, cur.modo);
    $('af-f-aluno-q').value = '';
    fillStudentOptions(item, cur.aluno || '');
    const externos = data.familias.filter((x) => x.tipo === 'externo').map((x) => [x.guardian_id, x.nome]);
    setOptions($('af-f-ext'), [['', 'Escolha o responsável…']].concat(externos, [[NOVO, 'Novo responsável…']]), cur.guardian || '');
    ['af-f-nome', 'af-f-tel', 'af-f-email', 'af-f-parent'].forEach((id) => { $(id).value = ''; });
    updateModeBoxes();

    const m = item.matricula;
    const active = data.planos.filter((p) => p.status === 'Ativo' || (m && p.plan_id === m.plan_id));
    setOptions($('af-f-plano'), active.map((p) => [p.plan_id, p.nome]), m ? m.plan_id : (active.find((p) => p.nome === 'Custom') || active[0] || { plan_id: '' }).plan_id);
    $('af-f-valor').value = m ? money2(m.valor) : '';
    $('af-f-dia').value = m && m.dia_vencimento != null ? String(m.dia_vencimento) : '';
    const isencoes = (data.opcoes && data.opcoes.isencoes) || [];
    const current = m ? m.tipo_isencao : '';
    setOptions($('af-f-isencao'), [['', 'Nenhuma']].concat(isencoes.concat(current && !isencoes.includes(current) ? [current] : []).map((v) => [v, v])), current);
    $('af-f-pago').value = m ? m.pago_ate : '';
    $('af-dialog-hint').textContent = m ? 'Mudar o valor vale a partir das próximas cobranças: as já geradas não mudam (corrija em Mensalidades, se precisar).' : 'Este aluno ainda não tem matrícula: preencha o valor para criá-la.';
  }

  function openEditor(item, opener) {
    if (!data || !canEdit()) return;
    dialog = { item, opener };
    fillEditor(item);
    showDialogError([]);
    $('af-save').disabled = false;
    $('af-dialog').hidden = false;
    $('af-inner').inert = true;
    $('af-f-modo').focus();
  }

  function closeEditor(restoreFocus = true) {
    if (!dialog) return;
    const opener = dialog.opener;
    dialog = null;
    $('af-dialog').hidden = true;
    $('af-inner').inert = false;
    if (restoreFocus && opener && opener.focus) opener.focus();
  }

  function setNotice(text) {
    $('af-notice').textContent = text || '';
    $('af-notice').hidden = !text;
  }

  /** Lê o formulário e devolve só o que mudou: { errors, family, enrollment }. O servidor valida tudo de novo. */
  function collect(item) {
    const errors = [];
    let family = null;
    let enrollment = null;
    const modo = $('af-f-modo').value;
    const cur = currentChoice(item);
    const parentesco = $('af-f-parent').value.trim();
    if (modo === 'aluno') {
      const id = $('af-f-aluno').value;
      if (!id) errors.push('Escolha o aluno responsável.');
      else if (!(cur.modo === 'aluno' && cur.aluno === id)) family = { modo, responsavel_aluno_id: id, parentesco };
    } else if (modo === 'externo') {
      const g = $('af-f-ext').value;
      if (g === NOVO) {
        const nome = $('af-f-nome').value.trim();
        if (nome.length < 2) errors.push('Informe o nome do novo responsável.');
        else family = { modo, novo: { nome, telefone: $('af-f-tel').value.trim(), email: $('af-f-email').value.trim() }, parentesco };
      } else if (!g) errors.push('Escolha o responsável externo.');
      else if (!(cur.modo === 'externo' && cur.guardian === g)) family = { modo, guardian_id: g, parentesco };
    } else if (modo !== cur.modo) {
      family = { modo };
    }

    const m = item.matricula;
    const planId = $('af-f-plano').value;
    const valorText = $('af-f-valor').value.trim();
    const diaText = $('af-f-dia').value.trim();
    const isencao = $('af-f-isencao').value;
    const pago = $('af-f-pago').value.trim();
    const changed = m
      ? planId !== m.plan_id || valorText !== money2(m.valor) || diaText !== (m.dia_vencimento != null ? String(m.dia_vencimento) : '') || isencao !== m.tipo_isencao || pago !== m.pago_ate
      : valorText !== '' || diaText !== '' || isencao !== '' || pago !== '';
    if (changed) {
      const valor = Number(valorText.replace(',', '.'));
      if (valorText === '' || !isFinite(valor)) errors.push('Informe o valor em reais (ex.: 200 ou 200,50).');
      else enrollment = { plan_id: planId, valor, dia_vencimento: diaText === '' ? '' : Number(diaText), tipo_isencao: isencao, pago_ate: pago };
    }
    return { errors, family, enrollment };
  }

  /** Mostra o erro de uma chamada; devolve true se a sessão caiu ou os dados ficaram velhos (o painel já foi tratado). */
  function handleFailure(resp) {
    const code = resp.error.code;
    if (AUTH_CODES[code]) { closeEditor(false); onAuthFailure(code); return true; }
    if (STALE.has(code)) {
      closeEditor(false);
      setNotice(STALE_MESSAGE);
      load();
      return true;
    }
    const fields = Array.isArray(resp.error.fields) ? resp.error.fields.map((f) => f.mensagem) : [];
    showDialogError(fields.length ? fields : resp.error.message);
    return false;
  }

  async function submit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!dialog || submitting) return;
    const mine = dialog;
    const item = mine.item;
    const { errors, family, enrollment } = collect(item);
    if (errors.length) { showDialogError(errors); return; }
    if (!family && !enrollment) { closeEditor(); return; }
    submitting = true;
    $('af-save').disabled = true;
    showDialogError([]);
    const generationAtStart = requestId;
    let last = null;
    try {
      const steps = [];
      if (family) steps.push(['alunofull.definirResponsavel', [item.student_id, Object.assign({ versao: item.versaoFamilia }, family)]]);
      if (enrollment) steps.push(['alunofull.salvarMatricula', [item.student_id, Object.assign({ versao: item.matricula ? item.matricula.versao : 'nova' }, enrollment)]]);
      for (const [acao, args] of steps) {
        const resp = await api.call(acao, args);
        if (generationAtStart !== requestId || dialog !== mine) return; // sessão encerrada ou painel fechado: descarta
        if (!resp.ok) {
          if (last) { data = last; render(last); } // o primeiro passo já gravou: mostra o que ficou salvo
          if (handleFailure(resp)) return;
          $('af-save').disabled = false;
          if (last) showDialogError(['A família foi salva, mas a matrícula não.'].concat(Array.isArray(resp.error.fields) && resp.error.fields.length ? resp.error.fields.map((f) => f.mensagem) : [resp.error.message]));
          return;
        }
        last = resp.data;
        const updated = last.alunos.find((a) => a.student_id === item.student_id);
        if (updated) mine.item = updated; // as próximas leituras do painel usam as versões novas
      }
      render(last);
      closeEditor();
      setNotice('Alterações salvas.');
    } catch (err) {
      if (dialog === mine) {
        $('af-save').disabled = false;
        showDialogError(err && err.name === 'TransportError' ? err.message : SAVE_ERROR);
      }
    } finally {
      submitting = false;
    }
  }

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
      name.appendChild(nameControl(a));
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
        { key: 'nome', label: 'Aluno', type: 'text', value: (a) => a.nome, filter: 'text', render: (a, td) => { td.appendChild(nameControl(a)); } },
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
    if (!d || !Array.isArray(d.familias) || !Array.isArray(d.alunos) || !Array.isArray(d.semResponsavel) || !Array.isArray(d.avisos) || !Array.isArray(d.planos)) throw new Error('lista malformada');
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
    submitting = false;
    closeEditor(false);
    setNotice('');
    applyView();
    show('af-loading');
  }

  $('af-view-families').addEventListener('click', () => { view = 'families'; applyView(); });
  $('af-view-list').addEventListener('click', () => { if (table) { view = 'list'; applyView(); } });
  $('af-q').addEventListener('input', () => { if (data) renderFamilies(); });
  $('af-refresh').addEventListener('click', () => { loaded = true; setNotice(''); load(); });
  $('af-form').addEventListener('submit', submit);
  $('af-cancel').addEventListener('click', () => closeEditor());
  $('af-dialog-backdrop').addEventListener('click', () => closeEditor());
  $('af-open-student').addEventListener('click', () => { if (!dialog) return; const id = dialog.item.student_id; closeEditor(false); openStudent(id); });
  $('af-f-modo').addEventListener('change', updateModeBoxes);
  $('af-f-ext').addEventListener('change', updateModeBoxes);
  $('af-f-aluno-q').addEventListener('input', () => { if (dialog) fillStudentOptions(dialog.item, $('af-f-aluno').value); });
  doc.addEventListener('keydown', (e) => { if (dialog && e && e.key === 'Escape') closeEditor(); });
  $('af-retry').addEventListener('click', () => { load(); });
  table = buildTable();
  applyView();

  return { activate, reset };
}
