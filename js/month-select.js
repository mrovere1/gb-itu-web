// Seletor de meses (competências) em lista suspensa, com vários meses e "Todos os meses".
// Recebe doc por injeção; não importa nada. O servidor decide quais meses existem (setOptions); aqui só se escolhe.
// O painel abre com uma cópia da seleção: Aplicar confirma, Cancelar/Escape/fundo descartam.

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const NONE = 'Escolha o mês';

export const fullLabel = (iso) => MESES[parseInt(iso.slice(5), 10) - 1] + '/' + iso.slice(0, 4);
const shortLabel = (iso) => ABREV[parseInt(iso.slice(5), 10) - 1] + '/' + iso.slice(2, 4);
const sorted = (list) => list.slice().sort();

function contiguous(list) {
  for (let i = 1; i < list.length; i += 1) {
    const [y0, m0] = list[i - 1].split('-').map(Number);
    const [y1, m1] = list[i].split('-').map(Number);
    if (y1 * 12 + m1 !== y0 * 12 + m0 + 1) return false;
  }
  return true;
}

/** Texto do botão: "Setembro/2026", "jul/26–set/26 (3 meses)", "jun/26, ago/26", "4 meses selecionados" ou "Todos os meses (9)". */
export function describeSelection(selected, options) {
  const list = sorted(selected);
  if (list.length === 0) return NONE;
  if (list.length === 1) return fullLabel(list[0]);
  if (options.length > 1 && list.length === options.length) return 'Todos os meses (' + list.length + ')';
  if (contiguous(list)) return shortLabel(list[0]) + '–' + shortLabel(list[list.length - 1]) + ' (' + list.length + ' meses)';
  if (list.length <= 3) return list.map(shortLabel).join(', ');
  return list.length + ' meses selecionados';
}

/** Hoje (AAAA-MM-DD) em America/Sao_Paulo. */
export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Meses para listas de um mês só: de janeiro do ano anterior a 36 meses à frente, mais os `include` que ficarem de fora. */
export function monthChoices(today, include = []) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out = new Set();
  for (let t = (y - 1) * 12; t <= y * 12 + (m - 1) + 36; t += 1) out.add(Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0'));
  include.filter((v) => COMPETENCIA.test(v)).forEach((v) => out.add(v));
  return Array.from(out).sort();
}

export function createMonthSelect({ doc, id, onChange = () => {} }) {
  const $ = (suffix) => doc.getElementById(id + suffix);
  let options = [];
  let selected = [];
  let draft = new Set();
  let isOpen = false;

  function renderButton() {
    $('-btn').textContent = describeSelection(selected, options);
  }

  function syncAll() {
    $('-all').checked = options.length > 0 && options.every((iso) => draft.has(iso));
  }

  function showMessage(text) {
    $('-msg').textContent = text || '';
    $('-msg').hidden = !text;
  }

  function renderList() {
    const list = $('-list');
    list.textContent = '';
    options.slice().reverse().forEach((iso) => { // mais recente primeiro
      const label = doc.createElement('label');
      label.className = 'ms-item';
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.value = iso;
      box.checked = draft.has(iso);
      box.addEventListener('change', () => {
        if (box.checked) draft.add(iso); else draft.delete(iso);
        syncAll();
        showMessage('');
      });
      const text = doc.createElement('span');
      text.textContent = fullLabel(iso);
      label.appendChild(box);
      label.appendChild(text);
      list.appendChild(label);
    });
  }

  function open() {
    draft = new Set(selected);
    renderList();
    syncAll();
    showMessage('');
    isOpen = true;
    $('-panel').hidden = false;
    $('-backdrop').hidden = false;
    $('-btn').setAttribute('aria-expanded', 'true');
    const first = $('-list').children[0];
    if (first && first.children[0] && first.children[0].focus) first.children[0].focus();
  }

  function close(restoreFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    $('-panel').hidden = true;
    $('-backdrop').hidden = true;
    $('-btn').setAttribute('aria-expanded', 'false');
    if (restoreFocus) $('-btn').focus();
  }

  function apply() {
    const chosen = sorted(Array.from(draft));
    if (chosen.length === 0) { showMessage('Escolha pelo menos um mês.'); return; }
    const changed = chosen.length !== selected.length || chosen.some((iso, i) => iso !== sorted(selected)[i]);
    selected = chosen;
    renderButton();
    close();
    if (changed) onChange(chosen.slice());
  }

  /** Meses oferecidos (AAAA-MM). Se a seleção atual tiver um mês fora da lista, ele é mantido. */
  function setOptions(list) {
    options = sorted(Array.from(new Set((Array.isArray(list) ? list : []).filter((v) => COMPETENCIA.test(v)))));
    keepSelectedInOptions();
    renderButton();
  }

  function keepSelectedInOptions() {
    const extra = selected.filter((iso) => options.indexOf(iso) === -1);
    if (extra.length) options = sorted(options.concat(extra));
  }

  /** Seleção confirmada (vinda do servidor ou de quem abriu a tela). */
  function setValue(list) {
    selected = sorted((Array.isArray(list) ? list : []).filter((v) => COMPETENCIA.test(v)));
    keepSelectedInOptions();
    renderButton();
  }

  function getValue() { return selected.slice(); }

  function reset() {
    close(false);
    options = [];
    selected = [];
    draft = new Set();
    $('-list').textContent = '';
    showMessage('');
    renderButton();
  }

  $('-btn').addEventListener('click', () => { if (isOpen) close(); else open(); });
  $('-all').addEventListener('change', () => {
    draft = $('-all').checked ? new Set(options) : new Set();
    $('-list').children.forEach((label) => { label.children[0].checked = draft.has(label.children[0].value); });
    showMessage('');
  });
  $('-apply').addEventListener('click', apply);
  $('-cancel').addEventListener('click', () => close());
  $('-backdrop').addEventListener('click', () => close());
  doc.addEventListener('keydown', (e) => { if (isOpen && e && e.key === 'Escape') close(); });
  $('-btn').setAttribute('aria-expanded', 'false');
  renderButton();

  return { setOptions, setValue, getValue, reset, close };
}
