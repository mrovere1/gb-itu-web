// Busca global (Ctrl+K): acha o aluno por nome, CPF ou telefone e leva ao cadastro ou às mensalidades.
// Recebe doc, api e callbacks por injeção. O servidor decide o que cada perfil pode buscar.
// Texto do servidor entra sempre por textContent.

const MIN_CHARS = 2;
const MAX_RESULTS = 8;
const DEBOUNCE_MS = 250;

export function createGlobalSearch({
  doc, api, openStudent = () => {}, openMensalidades = () => {}, hasPay = () => false,
  onAuthFailure = () => {}, setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = (id) => globalThis.clearTimeout(id),
}) {
  const $ = (id) => doc.getElementById(id);
  let isOpen = false;
  let results = [];
  let buttons = [];
  let selected = -1;
  let requestId = 0;
  let timer = null;
  let opener = null;

  function setEmpty(text) {
    const box = $('search-empty');
    box.textContent = text || '';
    box.hidden = !text;
  }

  function clearResults(hint) {
    requestId += 1;
    results = [];
    buttons = [];
    selected = -1;
    $('search-results').textContent = '';
    $('search-mens').hidden = true;
    $('search-loading').hidden = true;
    $('search-q').removeAttribute('aria-activedescendant');
    setEmpty('');
    if (hint) $('search-hint').textContent = hint;
  }

  function highlight() {
    buttons.forEach((b, i) => b.setAttribute('aria-selected', String(i === selected)));
    if (selected >= 0) $('search-q').setAttribute('aria-activedescendant', 'search-opt-' + selected);
    else $('search-q').removeAttribute('aria-activedescendant');
  }

  function renderResults(items) {
    results = items;
    buttons = [];
    selected = items.length ? 0 : -1;
    const list = $('search-results');
    list.textContent = '';
    items.forEach((a, i) => {
      const li = doc.createElement('li');
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'search-item';
      b.id = 'search-opt-' + i;
      b.setAttribute('role', 'option');
      const nome = doc.createElement('span');
      nome.className = 'student-name';
      nome.textContent = a.nome_social ? a.nome_social + ' (' + a.nome_completo + ')' : a.nome_completo;
      const meta = doc.createElement('span');
      meta.className = 'muted';
      meta.textContent = [a.status, a.faixa ? 'Faixa ' + a.faixa : '', a.idade != null ? a.idade + ' anos' : ''].filter(Boolean).join(' · ');
      b.appendChild(nome);
      b.appendChild(meta);
      b.addEventListener('click', () => choose(a));
      li.appendChild(b);
      list.appendChild(li);
      buttons.push(b);
    });
    highlight();
    setEmpty(items.length ? '' : 'Nenhum aluno encontrado.');
    $('search-mens').hidden = !(items.length && hasPay());
  }

  async function run(termo) {
    const mine = ++requestId;
    $('search-loading').hidden = false;
    setEmpty('');
    let resp;
    try {
      resp = await api.call('alunos.listar', [{ busca: termo, status: '' }]);
    } catch (e) {
      if (mine !== requestId) return;
      $('search-loading').hidden = true;
      clearResults('Digite pelo menos 2 letras ou 4 números.');
      setEmpty(e && e.name === 'TransportError' ? e.message : 'Não foi possível buscar agora. Tente de novo.');
      return;
    }
    if (mine !== requestId) return;
    $('search-loading').hidden = true;
    if (resp.ok) {
      renderResults((resp.data && Array.isArray(resp.data.itens) ? resp.data.itens : []).slice(0, MAX_RESULTS));
      return;
    }
    if (resp.error && (resp.error.code === 'NAO_AUTENTICADO' || resp.error.code === 'ACESSO_NEGADO')) {
      close(false);
      onAuthFailure(resp.error.code);
      return;
    }
    setEmpty(resp.error ? resp.error.message : 'Não foi possível buscar agora. Tente de novo.');
  }

  function choose(aluno) {
    if (!aluno) return;
    close(false);
    openStudent(aluno.student_id);
  }

  function paySelected() {
    const aluno = results[selected];
    if (!aluno) return;
    close(false);
    openMensalidades({ busca: aluno.nome_completo });
  }

  function move(delta) {
    if (!results.length) return;
    selected = (selected + delta + results.length) % results.length;
    highlight();
  }

  function open(termo) {
    if (isOpen) return;
    isOpen = true;
    opener = doc.activeElement || null;
    $('search').hidden = false;
    const app = $('view-app');
    if (app) app.inert = true;
    $('search-hint').textContent = 'Digite pelo menos 2 letras ou 4 números. Use ↑ ↓ e Enter.';
    clearResults('');
    $('search-q').value = termo == null ? '' : String(termo);
    $('search-q').focus();
    const q = $('search-q').value.trim();
    if (q.length >= MIN_CHARS) run(q);
  }

  function close(restoreFocus) {
    if (!isOpen) return;
    isOpen = false;
    if (timer !== null) { clearTimer(timer); timer = null; }
    clearResults('');
    $('search').hidden = true;
    const app = $('view-app');
    if (app) app.inert = false;
    $('search-q').value = '';
    if (restoreFocus && opener && opener.focus) opener.focus();
    opener = null;
  }

  function reset() {
    close(false);
  }

  $('search-q').addEventListener('input', () => {
    const q = $('search-q').value.trim();
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (q.length < MIN_CHARS) { clearResults('Digite pelo menos 2 letras ou 4 números.'); return; }
    timer = setTimer(() => { timer = null; run(q); }, DEBOUNCE_MS);
  });
  $('open-search').addEventListener('click', () => open(''));
  $('open-search-top').addEventListener('click', () => open(''));
  $('search-close').addEventListener('click', () => close(true));
  $('search-backdrop').addEventListener('click', () => close(true));
  $('search-mens').addEventListener('click', paySelected);

  // Atalho e navegação por teclado. Ignora eventos sem key (testes e eventos sintéticos).
  doc.addEventListener('keydown', (e) => {
    if (!e || typeof e.key !== 'string') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      if (e.preventDefault) e.preventDefault();
      if (isOpen) close(true); else open('');
      return;
    }
    if (!isOpen) return;
    if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); close(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.preventDefault) e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter') {
      if (e.preventDefault) e.preventDefault();
      choose(results[selected]);
    }
  });

  return { open, close, reset };
}
