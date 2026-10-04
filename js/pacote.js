// Painel "Registrar pacote" (aba Aluno Full, só Administrador): lança um pacote de vários meses para o aluno,
// com pagamento único (o valor entra uma vez, na data da venda) ou recorrente (o valor entra mês a mês).
// Recebe doc e api por injeção; só importa a lista de meses (month-select). Texto do servidor entra sempre por textContent.
// O resumo na tela é só uma prévia: quem calcula, valida e grava é o servidor.

import { monthChoices, fullLabel } from './month-select.js?v=97019658dd';

const AUTH_CODES = Object.freeze({ NAO_AUTENTICADO: true, ACESSO_NEGADO: true });
const STALE = new Set(['VERSAO_DESATUALIZADA', 'ESTADO_INVALIDO', 'NAO_ENCONTRADO']);
const MODOS = [['', 'Escolha…'], ['unico', 'Pagamento único: o valor entrou de uma vez, na data da venda'], ['recorrente', 'Recorrente: o valor entra mês a mês']];
const MAX_MESES = 24;
const SAVE_ERROR = 'Não foi possível registrar o pacote. Tente novamente.';
const MONEY = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (n) => MONEY.format(n);
const compBR = (c) => c.slice(5) + '/' + c.slice(0, 4);
const dateBR = (iso) => iso.slice(8) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const defaultToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** `n` competências a partir de `inicio` (AAAA-MM): devolve a última. */
function addMonths(inicio, n) {
  const t = Number(inicio.slice(0, 4)) * 12 + Number(inicio.slice(5, 7)) - 1 + n;
  return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
}

/** Parcelas em centavos inteiros; a última absorve a sobra (mesma regra do servidor). */
function installments(total, n) {
  const all = Math.round(total * 100);
  const base = Math.floor(all / n);
  return { base: base / 100, last: (all - base * (n - 1)) / 100 };
}

export function createPacote({ doc, api, today = defaultToday, onSaved = () => {}, onStale = () => {}, onAuthFailure = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  let dialog = null;   // { item, family, opener, familyMode, rows }
  let submitting = false;
  let generation = 0;  // invalida respostas de um painel que já foi fechado ou reiniciado

  function setOptions(select, pairs, selected) {
    select.textContent = '';
    pairs.forEach(([value, label]) => {
      const o = doc.createElement('option');
      o.value = value;
      o.textContent = label;
      select.appendChild(o);
    });
    select.value = selected;
  }

  function showError(messages) {
    const list = Array.isArray(messages) ? messages : [messages];
    const box = $('pk-dialog-error');
    box.textContent = list.filter(Boolean).join(' ');
    box.hidden = !box.textContent;
    if (!box.hidden) box.focus();
  }

  const parseMoney = (text) => (String(text).trim() === '' ? NaN : Number(String(text).trim().replace(',', '.')));
  const round2 = (n) => Math.round(n * 100) / 100;
  const moneyText = (n) => String(round2(n)).replace('.', ',');
  const familyMode = () => !!(dialog && dialog.familyMode);

  /** Motivo pelo qual o membro não entra no pacote (ou '' se pode entrar). */
  function blockedReason(member) {
    const m = member.matricula;
    if (!m) return 'sem matrícula';
    if (m.tipo_isencao) return 'isento (' + m.tipo_isencao + ')';
    if (m.status !== 'Ativa') return 'matrícula inativa';
    return '';
  }

  function mesesValue() {
    const text = $('pk-f-meses').value.trim();
    const n = /^\d+$/.test(text) ? Number(text) : NaN;
    return n >= 1 && n <= MAX_MESES ? n : NaN;
  }

  /** Dados comuns a todos os alunos: tipo, data, primeiro mês, meses, forma e observação. */
  function collectCommon() {
    const errors = [];
    const modo = $('pk-f-modo').value;
    if (modo !== 'unico' && modo !== 'recorrente') errors.push('Escolha se o pagamento é único ou recorrente.');
    const data = $('pk-f-data').value.trim();
    if (!ISO_DATE.test(data)) errors.push('Informe a data da venda.');
    const mes = $('pk-f-mes').value.trim();
    if (!COMPETENCIA.test(mes)) errors.push('Informe o primeiro mês coberto.');
    const meses = mesesValue();
    if (!(meses >= 1)) errors.push('Informe a quantidade de meses, de 1 a ' + MAX_MESES + '.');
    const forma = $('pk-f-forma').value;
    if (!forma) errors.push('Escolha a forma de pagamento.');
    return { errors, value: { modo, data, mes_inicial: mes, meses, forma, observacao: $('pk-f-obs').value.trim() } };
  }

  /** Lê o formulário: { errors, value }. O servidor valida tudo de novo. */
  function collect() {
    const common = collectCommon();
    const errors = common.errors.slice();
    const value = common.value;
    if (!familyMode()) {
      const valor = parseMoney($('pk-f-valor').value);
      if (!isFinite(valor) || valor <= 0) errors.push('Informe o valor total do pacote em reais (ex.: 600 ou 600,50).');
      value.valor_total = valor;
      return { errors, value };
    }
    const chosen = dialog.rows.filter((r) => r.box.checked);
    if (!chosen.length) errors.push('Marque pelo menos um aluno da família.');
    value.membros = chosen.map((r) => {
      const valor = parseMoney(r.valor.value);
      if (!isFinite(valor) || valor <= 0) errors.push('Valor de ' + r.member.nome + ': informe em reais (ex.: 600 ou 600,50).');
      return { student_id: r.member.student_id, versao: r.member.matricula.versao, valor_total: valor };
    });
    return { errors, value };
  }

  function familyTotal() {
    const chosen = dialog.rows.filter((r) => r.box.checked);
    const values = chosen.map((r) => parseMoney(r.valor.value));
    return { count: chosen.length, valid: values.length > 0 && values.every((v) => isFinite(v) && v > 0), total: round2(values.filter((v) => isFinite(v)).reduce((t, v) => t + v, 0)) };
  }

  function updateTotal() {
    if (!familyMode()) { $('pk-total').textContent = ''; return; }
    const t = familyTotal();
    $('pk-total').textContent = t.count ? 'Total da família: ' + money(t.total) + ' (' + t.count + (t.count === 1 ? ' aluno)' : ' alunos)') : '';
  }

  /** Resumo ao vivo; só mostra números quando os campos necessários estão válidos. */
  function updatePreview() {
    const box = $('pk-preview');
    if (!dialog) { box.textContent = ''; return; }
    updateTotal();
    const common = collectCommon().value;
    const okMes = COMPETENCIA.test(common.mes_inicial) && common.meses >= 1;
    const modeOk = common.modo === 'unico' || common.modo === 'recorrente';
    const cobre = okMes ? 'Cobre ' + compBR(common.mes_inicial) + ' a ' + compBR(addMonths(common.mes_inicial, common.meses - 1)) + '.' : '';
    if (familyMode()) {
      const t = familyTotal();
      if (!okMes || !modeOk || !t.valid) { box.textContent = ''; return; }
      box.textContent = common.modo === 'unico'
        ? money(t.total) + ' entram uma única vez' + (ISO_DATE.test(common.data) ? ', em ' + dateBR(common.data) : '') + ', divididos entre ' + t.count + (t.count === 1 ? ' aluno. ' : ' alunos. ') + cobre
        : t.count + (t.count === 1 ? ' aluno' : ' alunos') + ', cada um em ' + common.meses + (common.meses === 1 ? ' parcela' : ' parcelas') + ' mensais (total da família ' + money(t.total) + '). ' + cobre + ' Parcelas futuras ficam previstas e são confirmadas na data de vencimento.';
      return;
    }
    const valor = parseMoney($('pk-f-valor').value);
    if (!okMes || !isFinite(valor) || valor <= 0 || !modeOk) { box.textContent = ''; return; }
    if (common.modo === 'unico') {
      box.textContent = money(valor) + ' entram uma única vez' + (ISO_DATE.test(common.data) ? ', em ' + dateBR(common.data) : '') + '. ' + cobre;
      return;
    }
    const p = installments(valor, common.meses);
    const parts = common.meses === 1
      ? '1 parcela de ' + money(p.last)
      : common.meses + ' parcelas' + (p.base === p.last ? ' de ' + money(p.base) : ': ' + (common.meses - 1) + ' de ' + money(p.base) + ' e a última de ' + money(p.last));
    box.textContent = parts + ', o valor entra mês a mês. ' + cobre + ' Parcelas futuras ficam previstas e são confirmadas na data de vencimento.';
  }

  function suggestedMonth(paidUntil, hoje) {
    const current = hoje.slice(0, 7);
    return COMPETENCIA.test(paidUntil) && paidUntil >= current ? addMonths(paidUntil, 1) : current;
  }

  /** Valor sugerido de um membro: mensalidade × meses (some quando os meses ainda não são válidos). */
  function suggestion(member) {
    const n = mesesValue();
    const v = member.matricula && member.matricula.valor;
    return typeof v === 'number' && v > 0 && n >= 1 ? moneyText(v * n) : '';
  }

  function renderMembers() {
    const box = $('pk-members');
    box.textContent = '';
    dialog.rows = [];
    dialog.family.membros.forEach((member) => {
      const reason = blockedReason(member);
      const row = doc.createElement('div');
      row.className = 'pk-member' + (reason ? ' pk-member-off' : '');
      const label = doc.createElement('label');
      const check = doc.createElement('input');
      check.type = 'checkbox';
      check.checked = !reason;
      check.disabled = !!reason;
      const name = doc.createElement('span');
      name.textContent = member.nome;
      label.appendChild(check);
      label.appendChild(name);
      const valor = doc.createElement('input');
      valor.setAttribute('inputmode', 'decimal');
      valor.setAttribute('aria-label', 'Valor de ' + member.nome + ' (R$)');
      valor.disabled = !!reason;
      valor.value = reason ? '' : suggestion(member);
      const note = doc.createElement('span');
      note.className = 'muted';
      note.textContent = reason;
      row.appendChild(label);
      row.appendChild(valor);
      row.appendChild(note);
      box.appendChild(row);
      const entry = { member, box: check, valor, dirty: false };
      check.addEventListener('change', updatePreview);
      valor.addEventListener('input', () => { entry.dirty = true; updatePreview(); });
      dialog.rows.push(entry);
    });
  }

  /** Meses mudaram: atualiza os valores sugeridos que a pessoa ainda não editou. */
  function refreshSuggestions() {
    if (!familyMode()) return;
    dialog.rows.forEach((r) => { if (!r.dirty && !r.box.disabled) r.valor.value = suggestion(r.member); });
  }

  function setFamilyMode(on) {
    dialog.familyMode = on;
    $('pk-members-box').hidden = !on;
    $('pk-valor-box').hidden = on;
    if (on) renderMembers(); else { dialog.rows = []; $('pk-members').textContent = ''; }
    updatePreview();
  }

  function open({ item = null, opener = null, formas = [], family = null }) {
    const hasItem = !!(item && item.matricula);
    const fam = family && Array.isArray(family.membros) && family.membros.length > 1 ? family : null;
    if (!hasItem && !fam) return;
    generation += 1;
    dialog = { item: hasItem ? item : null, family: fam, opener, familyMode: false, rows: [] };
    const hoje = today();
    $('pk-dialog-title').textContent = hasItem ? 'Registrar pacote · ' + item.nome : 'Pacote da família · ' + fam.nome;
    $('pk-dialog-info').textContent = hasItem
      ? 'Mensalidade atual: ' + (typeof item.matricula.valor === 'number' ? money(item.matricula.valor) : '—') + (COMPETENCIA.test(item.matricula.pago_ate) ? ' · pago até ' + compBR(item.matricula.pago_ate) : '') + '.'
      : 'Escolha os alunos e confira o valor de cada um: cada aluno recebe o seu pagamento.';
    setOptions($('pk-f-modo'), MODOS, '');
    setOptions($('pk-f-forma'), [['', 'Escolha…']].concat(formas.map((f) => [f, f])), '');
    $('pk-f-data').value = hoje;
    $('pk-f-data').max = hoje;
    const eligible = hasItem ? [item] : fam.membros.filter((m) => !blockedReason(m));
    const mes = eligible.map((m) => suggestedMonth(m.matricula && m.matricula.pago_ate, hoje)).sort().pop() || hoje.slice(0, 7);
    setOptions($('pk-f-mes'), monthChoices(hoje, [mes]).map((iso) => [iso, fullLabel(iso)]), mes);
    $('pk-f-meses').value = '1';
    $('pk-f-valor').value = '';
    $('pk-f-obs').value = '';
    $('pk-preview').textContent = '';
    $('pk-total').textContent = '';
    $('pk-f-familia').checked = false;
    $('pk-family-toggle-box').hidden = !(hasItem && fam);
    setFamilyMode(!hasItem);
    showError([]);
    $('pk-save').disabled = false;
    $('pk-dialog').hidden = false;
    $('af-inner').inert = true;
    $('pk-f-modo').focus();
  }

  function close(restoreFocus = true) {
    if (!dialog) return;
    const opener = dialog.opener;
    dialog = null;
    generation += 1;
    submitting = false;
    $('pk-dialog').hidden = true;
    $('af-inner').inert = false;
    if (restoreFocus && opener && opener.focus) opener.focus();
  }

  function reset() {
    close(false);
    ['pk-f-data', 'pk-f-mes', 'pk-f-meses', 'pk-f-valor', 'pk-f-obs'].forEach((id) => { $(id).value = ''; });
    $('pk-preview').textContent = '';
    $('pk-total').textContent = '';
    $('pk-members').textContent = '';
    $('pk-members-box').hidden = true;
    $('pk-valor-box').hidden = false;
    $('pk-family-toggle-box').hidden = true;
    $('pk-f-familia').checked = false;
    showError([]);
  }

  async function submit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!dialog || submitting) return;
    const { errors, value } = collect();
    if (errors.length) { showError(errors); return; }
    submitting = true;
    $('pk-save').disabled = true;
    showError([]);
    const mine = generation;
    const { item, family } = dialog;
    const isFamily = dialog.familyMode;
    let resp;
    try {
      resp = isFamily
        ? await api.call('pacotes.registrarFamilia', [family.id, value])
        : await api.call('pacotes.registrar', [item.student_id, Object.assign({ versao: item.matricula.versao }, value)]);
    } catch (err) {
      if (mine !== generation) return;
      submitting = false;
      $('pk-save').disabled = false;
      showError(err && err.name === 'TransportError' ? err.message : SAVE_ERROR);
      return;
    }
    if (mine !== generation) return; // painel fechado ou sessão trocada: descarta
    submitting = false;
    if (resp.ok) {
      close();
      onSaved(resp.data.resumo);
      return;
    }
    const code = resp.error.code;
    if (AUTH_CODES[code]) { close(false); onAuthFailure(code); return; }
    if (STALE.has(code)) { close(false); onStale(); return; }
    $('pk-save').disabled = false;
    const fields = Array.isArray(resp.error.fields) ? resp.error.fields.map((f) => f.mensagem) : [];
    showError(fields.length ? fields : resp.error.message);
  }

  $('pk-form').addEventListener('submit', submit);
  $('pk-cancel').addEventListener('click', () => close());
  $('pk-dialog-backdrop').addEventListener('click', () => close());
  $('pk-f-familia').addEventListener('change', () => { if (dialog) setFamilyMode($('pk-f-familia').checked); });
  $('pk-f-meses').addEventListener('change', () => { refreshSuggestions(); updatePreview(); });
  ['pk-f-modo', 'pk-f-forma', 'pk-f-mes', 'pk-f-data'].forEach((id) => $(id).addEventListener('change', updatePreview));
  ['pk-f-valor', 'pk-f-meses', 'pk-f-mes', 'pk-f-data'].forEach((id) => $(id).addEventListener('input', () => { if (id === 'pk-f-meses') refreshSuggestions(); updatePreview(); }));
  doc.addEventListener('keydown', (e) => { if (dialog && e && e.key === 'Escape') close(); });

  return { open, close, reset };
}
