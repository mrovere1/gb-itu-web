// Alunos: lista, detalhe e navegação do formulário. Recebe doc, api e a fábrica do formulário por injeção.
// Texto do servidor entra sempre por textContent. Respostas de requisições substituídas (ou de uma sessão que
// já terminou) são descartadas por um contador, como no painel.

const PARTS = ['students-loading', 'students-error', 'students-empty', 'students-ready', 'student-detail', 'student-form-section'];
const AUTH_CODES = Object.freeze({ NAO_AUTENTICADO: true, ACESSO_NEGADO: true });
const NO_PERM = Object.freeze({ criar: false, editarSensivel: false, confirmarDuplicidade: false });
const GENERIC_ERROR = 'Não foi possível exibir os dados. Tente novamente.';
const LABELS = {
  status: 'Status', faixa: 'Faixa', graus: 'Graus', idade: 'Idade', categoria: 'Categoria',
  data_nascimento: 'Nascimento', data_matricula: 'Matrícula', turma_principal_id: 'Turma',
  cpf: 'CPF', telefone: 'Telefone', email: 'E-mail',
  contato_emergencia: 'Contato de emergência', telefone_emergencia: 'Telefone de emergência',
  restricoes_medicas: 'Restrições médicas', observacoes: 'Observações', updated_at: 'Atualizado em',
};
const ORDER = ['status', 'faixa', 'graus', 'idade', 'categoria', 'data_nascimento', 'data_matricula', 'turma_principal_id',
  'cpf', 'telefone', 'email', 'contato_emergencia', 'telefone_emergencia', 'restricoes_medicas', 'observacoes', 'updated_at'];
const WARNINGS = { FAIXA_INCOMPATIVEL_COM_IDADE: 'A faixa cadastrada não combina com a categoria da idade. Confira com o professor.' };

export function createStudents({ doc, api, createForm, onAuthFailure }) {
  const $ = (id) => doc.getElementById(id);
  let loaded = false;      // a lista já foi pedida nesta sessão
  let dirty = false;       // houve cadastro/edição: a lista precisa ser recarregada
  let listPart = 'students-ready';
  let perm = NO_PERM;
  let opcoes = null;
  let detail = null;       // último detalhe aberto
  let requestId = 0;       // só a requisição mais nova (e ainda válida) pode mexer na tela

  const form = createForm({
    doc,
    api,
    hooks: {
      onSaved(resp, notice) {
        try {
          dirty = true;
          renderDetail(resp.data, notice);
        } catch (e) {
          showError(GENERIC_ERROR);
        }
      },
      onCancel(mode, info) {
        if (info && info.savePending) dirty = true;
        if (mode === 'edit' && detail) showPart('student-detail');
        else backToList();
      },
      onReload(id, info) {
        if (info && info.savePending) dirty = true;
        openDetail(id);
      },
      onAuthFailure(code) { onAuthFailure(code); },
    },
  });

  function showPart(name) {
    PARTS.forEach((p) => { $(p).hidden = p !== name; });
  }

  function showError(message, reference) {
    $('students-error-msg').textContent = message;
    $('students-error-ref').textContent = reference ? 'Código de referência: ' + reference : '';
    showPart('students-error');
    $('students-retry').focus();
  }

  // Uma chamada de leitura: carregando -> render(data). Nunca deixa a tela presa em "Carregando".
  async function request(acao, args, render) {
    const mine = ++requestId;
    showPart('students-loading');
    let resp;
    try {
      resp = await api.call(acao, args);
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

  // ---------- Lista ----------
  const currentFilter = () => ({ busca: $('students-q').value, status: $('students-status').value });

  // Refaz as opções do filtro a cada lista (e no reset): nada de uma sessão anterior sobra no DOM.
  function setStatusOptions(values) {
    const select = $('students-status');
    const keep = select.value;
    select.textContent = '';
    ['', ...values].forEach((v) => {
      const o = doc.createElement('option');
      o.value = v;
      o.textContent = v === '' ? 'Todos' : v;
      select.appendChild(o);
    });
    select.value = values.includes(keep) ? keep : '';
  }

  const displayName = (a) => (a.nome_social ? a.nome_social + ' (' + a.nome_completo + ')' : a.nome_completo);

  function renderList(d) {
    const nextPerm = d.permissoes;
    const nextOpcoes = d.opcoes;
    const itens = d.itens;
    const faixas = nextOpcoes && nextOpcoes.faixas;
    const opcoesOk = !!nextOpcoes && Array.isArray(nextOpcoes.statusCriacao) && !!faixas
      && Array.isArray(faixas.adulto) && Array.isArray(faixas.infantil);
    if (!nextPerm || !opcoesOk || !Array.isArray(itens) || !Array.isArray(d.statusDisponiveis)) throw new Error('lista malformada');
    perm = nextPerm;
    opcoes = nextOpcoes;
    $('students-new').hidden = !perm.criar;
    setStatusOptions(d.statusDisponiveis);
    if (d.total === 0) { listPart = 'students-empty'; showPart(listPart); return; }

    $('students-count').textContent = d.total === d.totalGeral ? d.total + ' alunos' : d.total + ' de ' + d.totalGeral + ' alunos';
    const list = $('students-list');
    list.textContent = '';
    itens.forEach((a) => {
      const li = doc.createElement('li');
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'student-row';
      const name = doc.createElement('span');
      name.className = 'student-name';
      name.textContent = displayName(a);
      const meta = doc.createElement('span');
      meta.className = 'muted';
      meta.textContent = [a.status, a.faixa ? 'Faixa ' + a.faixa : '', a.idade != null ? a.idade + ' anos' : ''].filter(Boolean).join(' · ');
      btn.appendChild(name);
      btn.appendChild(meta);
      btn.addEventListener('click', () => openDetail(a.student_id));
      li.appendChild(btn);
      list.appendChild(li);
    });
    listPart = 'students-ready';
    showPart(listPart);
  }

  function loadList() {
    dirty = false;
    return request('alunos.listar', [currentFilter()], renderList);
  }

  function backToList() {
    if (dirty) loadList();
    else showPart(listPart);
  }

  // ---------- Detalhe ----------
  function renderDetail(d, notice) {
    if (!d || !d.aluno || !Array.isArray(d.avisos)) throw new Error('detalhe malformado');
    detail = d;
    const a = d.aluno;
    $('detail-name').textContent = displayName(a);
    $('detail-notice').textContent = notice || '';
    $('detail-notice').hidden = !notice;
    $('detail-edit').hidden = !(d.edicao && d.edicao.podeEditar);

    const warnings = $('detail-warnings');
    warnings.textContent = '';
    d.avisos.forEach((code) => {
      const li = doc.createElement('li');
      li.textContent = WARNINGS[code] || code;
      warnings.appendChild(li);
    });

    const dl = $('detail-fields');
    dl.textContent = '';
    ORDER.forEach((key) => {
      if (!(key in a)) return;
      const dt = doc.createElement('dt');
      const dd = doc.createElement('dd');
      dt.textContent = LABELS[key];
      dd.textContent = a[key] == null || a[key] === '' ? '—' : String(a[key]);
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    showPart('student-detail');
    $('detail-name').focus();
  }

  function openDetail(id) {
    return request('alunos.obter', [id], (d) => renderDetail(d, null));
  }

  // ---------- Formulário ----------
  function openCreate() {
    if (!opcoes) return;
    form.openCreate({ opcoes, perm });
    showPart('student-form-section');
    $('form-title').focus();
  }

  function openEdit() {
    if (!detail || !detail.edicao || !detail.edicao.podeEditar || !opcoes) return;
    form.openEdit({ detail, opcoes, perm });
    showPart('student-form-section');
    $('form-title').focus();
  }

  /** Mostra a lista na primeira vez (e depois de um reset). */
  function activate() {
    if (loaded) return;
    loaded = true;
    loadList();
  }

  /** Abre o detalhe de um aluno a partir de outra tela (painel). A lista é carregada antes, para o perfil e as opções de edição. */
  async function open(id) {
    loaded = true;
    await loadList();
    await openDetail(id);
  }

  /** Apaga tudo do usuário anterior e invalida respostas pendentes (troca ou saída de usuário). */
  function reset() {
    requestId += 1;
    loaded = false;
    dirty = false;
    listPart = 'students-ready';
    perm = NO_PERM;
    opcoes = null;
    detail = null;
    $('students-q').value = '';
    setStatusOptions([]);
    $('students-new').hidden = true;
    $('students-count').textContent = '';
    $('students-list').textContent = '';
    $('students-error-msg').textContent = '';
    $('students-error-ref').textContent = '';
    $('detail-name').textContent = '';
    $('detail-notice').textContent = '';
    $('detail-notice').hidden = true;
    $('detail-warnings').textContent = '';
    $('detail-fields').textContent = '';
    $('detail-edit').hidden = true;
    form.reset();
    showPart('students-loading');
  }

  $('students-filter').addEventListener('submit', (e) => { e.preventDefault(); loadList(); });
  $('students-retry').addEventListener('click', () => { loadList(); });
  $('students-new').addEventListener('click', openCreate);
  $('detail-back').addEventListener('click', backToList);
  $('detail-edit').addEventListener('click', openEdit);

  return { activate, open, reset };
}
