// Painel "Registrar pacote" (aba Aluno Full, só Administrador): lança um pacote de vários meses para o aluno,
// com pagamento único (o valor entra uma vez, na data da venda) ou recorrente (o valor entra mês a mês).
// Recebe doc e api por injeção; só importa a lista de meses (month-select). Texto do servidor entra sempre por textContent.
// O resumo na tela é só uma prévia: quem calcula, valida e grava é o servidor.

import { monthChoices, fullLabel } from './month-select.js?v=580d072e4f';

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
  let dialog = null;   // { item, opener }
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

  /** Lê o formulário: { errors, value }. O servidor valida tudo de novo. */
  function collect() {
    const errors = [];
    const modo = $('pk-f-modo').value;
    if (modo !== 'unico' && modo !== 'recorrente') errors.push('Escolha se o pagamento é único ou recorrente.');
    const data = $('pk-f-data').value.trim();
    if (!ISO_DATE.test(data)) errors.push('Informe a data da venda.');
    const mes = $('pk-f-mes').value.trim();
    if (!COMPETENCIA.test(mes)) errors.push('Informe o primeiro mês coberto.');
    const mesesText = $('pk-f-meses').value.trim();
    const meses = /^\d+$/.test(mesesText) ? Number(mesesText) : NaN;
    if (!(meses >= 1 && meses <= MAX_MESES)) errors.push('Informe a quantidade de meses, de 1 a ' + MAX_MESES + '.');
    const valor = Number($('pk-f-valor').value.trim().replace(',', '.'));
    if (!$('pk-f-valor').value.trim() || !isFinite(valor) || valor <= 0) errors.push('Informe o valor total do pacote em reais (ex.: 600 ou 600,50).');
    const forma = $('pk-f-forma').value;
    if (!forma) errors.push('Escolha a forma de pagamento.');
    return {
      errors,
      value: { modo, data, mes_inicial: mes, meses, valor_total: valor, forma, observacao: $('pk-f-obs').value.trim() },
    };
  }

  /** Resumo ao vivo; só mostra números quando os campos necessários estão válidos. */
  function updatePreview() {
    const box = $('pk-preview');
    const { value: v } = collect();
    const okMes = COMPETENCIA.test(v.mes_inicial) && v.meses >= 1 && v.meses <= MAX_MESES;
    const okValor = isFinite(v.valor_total) && v.valor_total > 0 && $('pk-f-valor').value.trim() !== '';
    if (!okMes || !okValor || (v.modo !== 'unico' && v.modo !== 'recorrente')) { box.textContent = ''; return; }
    const cobre = 'Cobre ' + compBR(v.mes_inicial) + ' a ' + compBR(addMonths(v.mes_inicial, v.meses - 1)) + '.';
    if (v.modo === 'unico') {
      box.textContent = money(v.valor_total) + ' entram uma única vez' + (ISO_DATE.test(v.data) ? ', em ' + dateBR(v.data) : '') + '. ' + cobre;
      return;
    }
    const p = installments(v.valor_total, v.meses);
    const parts = v.meses === 1
      ? '1 parcela de ' + money(p.last)
      : v.meses + ' parcelas' + (p.base === p.last ? ' de ' + money(p.base) : ': ' + (v.meses - 1) + ' de ' + money(p.base) + ' e a última de ' + money(p.last));
    box.textContent = parts + ', o valor entra mês a mês. ' + cobre + ' Parcelas futuras ficam previstas e são confirmadas na data de vencimento.';
  }

  function suggestedMonth(paidUntil, hoje) {
    const current = hoje.slice(0, 7);
    return COMPETENCIA.test(paidUntil) && paidUntil >= current ? addMonths(paidUntil, 1) : current;
  }

  function open({ item, opener = null, formas = [] }) {
    if (!item || !item.matricula) return;
    generation += 1;
    dialog = { item, opener };
    const hoje = today();
    $('pk-dialog-title').textContent = 'Registrar pacote · ' + item.nome;
    $('pk-dialog-info').textContent = 'Mensalidade atual: ' + (typeof item.matricula.valor === 'number' ? money(item.matricula.valor) : '—')
      + (COMPETENCIA.test(item.matricula.pago_ate) ? ' · pago até ' + compBR(item.matricula.pago_ate) : '') + '.';
    setOptions($('pk-f-modo'), MODOS, '');
    setOptions($('pk-f-forma'), [['', 'Escolha…']].concat(formas.map((f) => [f, f])), '');
    $('pk-f-data').value = hoje;
    $('pk-f-data').max = hoje;
    const mes = suggestedMonth(item.matricula.pago_ate, hoje);
    setOptions($('pk-f-mes'), monthChoices(hoje, [mes]).map((iso) => [iso, fullLabel(iso)]), mes);
    $('pk-f-meses').value = '1';
    $('pk-f-valor').value = '';
    $('pk-f-obs').value = '';
    $('pk-preview').textContent = '';
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
    const item = dialog.item;
    let resp;
    try {
      resp = await api.call('pacotes.registrar', [item.student_id, Object.assign({ versao: item.matricula.versao }, value)]);
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
  ['pk-f-modo', 'pk-f-forma', 'pk-f-mes', 'pk-f-meses', 'pk-f-data'].forEach((id) => $(id).addEventListener('change', updatePreview));
  ['pk-f-valor', 'pk-f-meses', 'pk-f-mes', 'pk-f-data'].forEach((id) => $(id).addEventListener('input', updatePreview));
  doc.addEventListener('keydown', (e) => { if (dialog && e && e.key === 'Escape') close(); });

  return { open, close, reset };
}
