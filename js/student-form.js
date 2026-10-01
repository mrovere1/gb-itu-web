// Formulário de aluno (cadastro e edição). Recebe doc e api por injeção. O servidor decide o que cada perfil
// pode ver e editar; aqui a tela só reflete isso (esconder campo não é segurança). Texto sempre por textContent.

const FIELDS = ['nome_completo', 'nome_social', 'data_nascimento', 'data_matricula', 'status', 'faixa', 'graus', 'cpf',
  'telefone', 'email', 'contato_emergencia', 'telefone_emergencia', 'restricoes_medicas', 'observacoes'];
const SENSITIVE = ['cpf', 'restricoes_medicas'];
const SELECTS = ['status', 'faixa', 'graus'];
const AUTH_CODES = Object.freeze({ NAO_AUTENTICADO: true, ACESSO_NEGADO: true });
const NO_PERM = Object.freeze({ criar: false, editarSensivel: false, confirmarDuplicidade: false });
const NO_REFERENCE = Object.freeze({ VALIDACAO: true, CONFLITO: true, VERSAO_DESATUALIZADA: true });
const MAYBE_DONE = Object.freeze({
  create: 'O cadastro pode ter sido feito: confira a lista antes de tentar de novo.',
  edit: 'A alteração pode ter sido feita: confira o cadastro antes de tentar de novo.',
});
const UNKNOWN_FAILURE = 'Não foi possível concluir. Seus dados continuam no formulário; confira o cadastro antes de tentar de novo.';

export function createStudentForm({ doc, api, hooks }) {
  const $ = (id) => doc.getElementById(id);
  let mode = 'create';
  let detail = null;
  let original = {};
  let perm = NO_PERM;
  let opcoes = null;
  let submitting = false;
  let generation = 0; // reset() invalida o salvamento em andamento

  function todayIso() {
    try {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    } catch (e) {
      return '';
    }
  }

  function brToIso(br) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(br || ''));
    if (!m) return '';
    return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }

  function setOptions(select, values) {
    select.textContent = '';
    values.forEach((v) => {
      const o = doc.createElement('option');
      o.value = v.value;
      o.textContent = v.label;
      select.appendChild(o);
    });
  }

  function buildFaixa(current) {
    const faixa = $('f-faixa');
    faixa.textContent = '';
    const branca = doc.createElement('option');
    branca.value = 'Branca';
    branca.textContent = 'Branca';
    faixa.appendChild(branca);
    const known = ['Branca'];
    [['Adulto', opcoes.faixas.adulto], ['Infantil', opcoes.faixas.infantil]].forEach(([label, faixas]) => {
      const group = doc.createElement('optgroup');
      group.label = label;
      faixas.forEach((f) => {
        if (f === 'Branca') return;
        const o = doc.createElement('option');
        o.value = f;
        o.textContent = f;
        group.appendChild(o);
        known.push(f);
      });
      faixa.appendChild(group);
    });
    if (current && !known.includes(current)) { // valor antigo fora da lista: não perder
      const extra = doc.createElement('option');
      extra.value = current;
      extra.textContent = current + ' (fora da lista)';
      faixa.appendChild(extra);
    }
  }

  function clearErrors() {
    FIELDS.concat(['confirmarDuplicidade']).forEach((f) => {
      const e = $('e-' + f);
      e.textContent = '';
      e.hidden = true;
      $('f-' + f).removeAttribute('aria-invalid');
    });
    $('form-summary').textContent = '';
    $('form-summary').hidden = true;
    $('form-reload').hidden = true;
  }

  function endSubmit() {
    submitting = false;
    $('form-submit').disabled = false;
  }

  function prepare() {
    const today = todayIso();
    $('f-data_nascimento').max = today;
    $('f-data_matricula').max = today;
    $('f-confirmarDuplicidade').checked = false;
    $('confirm-box').hidden = true;
    SENSITIVE.forEach((f) => { $('box-' + f).hidden = !perm.editarSensivel; });
    clearErrors();
    endSubmit();
  }

  function openCreate(args) {
    opcoes = args.opcoes;
    perm = args.perm;
    mode = 'create';
    detail = null;
    original = {};
    $('form-title').textContent = 'Novo aluno';
    $('form-submit').textContent = 'Cadastrar aluno';
    setOptions($('f-status'), opcoes.statusCriacao.map((s) => ({ value: s, label: s })));
    buildFaixa(null);
    FIELDS.forEach((f) => {
      const el = $('f-' + f);
      el.disabled = false;
      if (SELECTS.includes(f)) el.selectedIndex = 0;
      else el.value = '';
    });
    $('f-data_matricula').value = todayIso();
    prepare();
  }

  function openEdit(args) {
    opcoes = args.opcoes;
    perm = args.perm;
    detail = args.detail;
    mode = 'edit';
    const a = detail.aluno;
    const ed = detail.edicao;
    $('form-title').textContent = 'Editar aluno';
    $('form-submit').textContent = 'Salvar alterações';

    const statusOpts = [{ value: a.status, label: a.status || '(sem status)' }];
    ed.statusPermitidos.forEach((s) => { if (s !== a.status) statusOpts.push({ value: s, label: s }); });
    setOptions($('f-status'), statusOpts);
    buildFaixa(a.faixa);

    const values = {
      nome_completo: a.nome_completo, nome_social: a.nome_social,
      data_nascimento: brToIso(a.data_nascimento), data_matricula: brToIso(a.data_matricula),
      status: a.status, faixa: a.faixa, graus: String(a.graus == null ? 0 : a.graus),
      cpf: detail.permissoes.cpf === 'completo' ? a.cpf : '',
      telefone: a.telefone, email: a.email, contato_emergencia: a.contato_emergencia,
      telefone_emergencia: a.telefone_emergencia, restricoes_medicas: a.restricoes_medicas, observacoes: a.observacoes,
    };
    original = {};
    FIELDS.forEach((f) => {
      const el = $('f-' + f);
      const v = values[f] == null ? '' : String(values[f]);
      el.value = v;
      original[f] = v;
      const editable = f === 'status' ? ed.statusPermitidos.length > 0 : ed.campos.includes(f);
      el.disabled = !editable;
    });
    prepare();
  }

  const confirmChecked = () => !$('confirm-box').hidden && $('f-confirmarDuplicidade').checked;

  function collectCreatePayload() {
    const payload = {};
    FIELDS.forEach((f) => {
      if (SENSITIVE.includes(f) && !perm.editarSensivel) return;
      payload[f] = $('f-' + f).value;
    });
    if (confirmChecked()) payload.confirmarDuplicidade = true;
    return payload;
  }

  // Só o que mudou e só o que o perfil pode editar; o servidor revalida tudo.
  function collectChanges() {
    const campos = {};
    let any = false;
    FIELDS.forEach((f) => {
      const el = $('f-' + f);
      if (el.disabled) return;
      if (el.value !== original[f]) { campos[f] = el.value; any = true; }
    });
    return any ? campos : null;
  }

  function showSummary(text) {
    const box = $('form-summary');
    box.textContent = text;
    box.hidden = false;
    box.focus();
  }

  function showFormError(resp) {
    const err = resp.error;
    const general = [];
    (err.fields || []).forEach((x) => {
      const e = $('e-' + x.campo);
      if (!e) { general.push(x.mensagem); return; }
      e.textContent = x.mensagem;
      e.hidden = false;
      const input = $('f-' + x.campo);
      if (input) input.setAttribute('aria-invalid', 'true');
      if (x.campo === 'confirmarDuplicidade') $('confirm-box').hidden = !perm.confirmarDuplicidade;
    });
    let text = err.message + (general.length ? ' ' + general.join(' ') : '');
    if (resp.correlationId && !NO_REFERENCE[err.code]) text += ' (código de referência: ' + resp.correlationId + ')';
    showSummary(text);
    if (err.code === 'VERSAO_DESATUALIZADA') $('form-reload').hidden = false;
  }

  function showTransportFailure(err) {
    const kind = err && err.name === 'TransportError' ? err.kind : null;
    if (kind === 'timeout' || kind === 'invalid-response') {
      showSummary((kind === 'timeout' ? 'O servidor demorou para responder. ' : 'O servidor respondeu de forma inesperada. ') + MAYBE_DONE[mode]);
    } else if (kind) {
      showSummary(err.message + ' Seus dados continuam no formulário.');
    } else {
      showSummary(UNKNOWN_FAILURE);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    let acao;
    let args;
    let notice;
    if (mode === 'edit') {
      const campos = collectChanges();
      if (!campos) { clearErrors(); showSummary('Nenhuma alteração para salvar.'); return; }
      const payload = { versao: detail.versao, campos };
      if (confirmChecked()) payload.confirmarDuplicidade = true;
      acao = 'alunos.atualizar';
      args = [detail.aluno.student_id, payload];
      notice = 'Alterações salvas com sucesso.';
    } else {
      acao = 'alunos.criar';
      args = [collectCreatePayload()];
      notice = 'Aluno cadastrado com sucesso.';
    }
    submitting = true;
    $('form-submit').disabled = true;
    clearErrors();
    const mine = generation;
    let resp;
    try {
      resp = await api.call(acao, args);
    } catch (err) {
      if (mine !== generation) return;
      endSubmit();
      showTransportFailure(err);
      return;
    }
    if (mine !== generation) return;
    endSubmit();
    try {
      if (resp.ok) { hooks.onSaved(resp, notice); return; }
      if (AUTH_CODES[resp.error.code]) { hooks.onAuthFailure(resp.error.code); return; }
      showFormError(resp);
    } catch (err) {
      showSummary(UNKNOWN_FAILURE);
    }
  }

  /** Apaga tudo o que foi digitado ou carregado e invalida salvamento em andamento (troca ou saída de usuário). */
  function reset() {
    generation += 1;
    mode = 'create';
    detail = null;
    original = {};
    opcoes = null;
    perm = NO_PERM;
    FIELDS.forEach((f) => {
      const el = $('f-' + f);
      el.disabled = false;
      if (SELECTS.includes(f)) el.selectedIndex = 0;
      else el.value = '';
    });
    $('f-status').textContent = '';
    $('f-faixa').textContent = '';
    $('form-title').textContent = 'Novo aluno';
    $('form-submit').textContent = 'Cadastrar aluno';
    SENSITIVE.forEach((f) => { $('box-' + f).hidden = true; });
    $('f-confirmarDuplicidade').checked = false;
    $('confirm-box').hidden = true;
    clearErrors();
    endSubmit();
  }

  $('student-form').addEventListener('submit', submit);
  $('form-cancel').addEventListener('click', () => hooks.onCancel(mode));
  $('form-reload').addEventListener('click', () => { if (detail) hooks.onReload(detail.aluno.student_id); });

  return { openCreate, openEdit, reset };
}
