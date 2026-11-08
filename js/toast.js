// Aviso curto e não bloqueante. Recebe doc e temporizadores por injeção (testável sem navegador).
// Nunca usa innerHTML: o texto entra por textContent.

const HIDE_AFTER_MS = 5000;

export function createToast({ doc, setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = (id) => globalThis.clearTimeout(id) }) {
  const box = doc.getElementById('toast');
  let timer = null;

  function hide() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    box.hidden = true;
    box.textContent = '';
    box.removeAttribute('data-kind');
  }

  /** kind: 'ok' (padrão) ou 'error'. */
  function show(text, kind) {
    if (!text) { hide(); return; }
    if (timer !== null) clearTimer(timer);
    box.textContent = String(text);
    const error = kind === 'error';
    box.setAttribute('data-kind', error ? 'error' : 'ok');
    box.setAttribute('role', error ? 'alert' : 'status');
    box.setAttribute('aria-live', error ? 'assertive' : 'polite');
    box.hidden = false;
    timer = setTimer(hide, HIDE_AFTER_MS);
  }

  return { show, hide };
}
