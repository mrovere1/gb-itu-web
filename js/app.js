// Fluxo da página: inicializando -> login -> sessão -> painel. Não importa nada: recebe tudo por injeção.
// Regras: o sistema só aparece depois de `sessao` responder ok; sessao roda uma vez por sessão;
// ACESSO_NEGADO e NAO_AUTENTICADO encerram a sessão; respostas de sessões antigas são descartadas.

const VIEWS = ['view-boot', 'view-login', 'view-session', 'view-app'];
const AUTH_FAILURES = Object.freeze({
  ACESSO_NEGADO: 'Esta conta não tem acesso ao sistema. Procure a administração.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
});
const IDLE_MESSAGE = 'Sessão encerrada por inatividade. Entre novamente.';
const GENERIC_LOGIN_ERROR = 'Não foi possível entrar. Tente novamente.';
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'touchstart', 'scroll'];

export function createApp({ doc, auth, api, dashboard }) {
  const $ = (id) => doc.getElementById(id);
  let busy = false;           // login em andamento
  let signedIn = false;       // já há usuário do Firebase (evita carregar a sessão duas vezes)
  let generation = 0;         // invalida respostas de sessões que já terminaram
  let pendingMessage = '';    // aviso a mostrar quando voltar ao login

  function show(view) {
    VIEWS.forEach((v) => { $(v).hidden = v !== view; });
  }

  function showLogin(message) {
    $('login-password').value = '';
    $('login-error').textContent = message || '';
    $('login-error').hidden = !message;
    show('view-login');
    $('login-email').focus();
  }

  function showSessionError(message, reference) {
    $('session-error-msg').textContent = message;
    $('session-error-ref').textContent = reference ? 'Código de referência: ' + reference : '';
    $('session-loading').hidden = true;
    $('session-error-box').hidden = false;
    show('view-session');
    $('session-retry').focus();
  }

  function toLogin() {
    generation += 1;
    signedIn = false;
    const message = pendingMessage;
    pendingMessage = '';
    showLogin(message);
  }

  async function endSession(message) {
    pendingMessage = message;
    generation += 1;
    await auth.logout();
    if (pendingMessage) toLogin();
  }

  async function loadSession() {
    const mine = ++generation;
    $('session-loading').hidden = false;
    $('session-error-box').hidden = true;
    show('view-session');
    let resp;
    try {
      resp = await api.call('sessao');
    } catch (e) {
      if (mine !== generation) return;
      showSessionError(e && e.name === 'TransportError' ? e.message : 'Não foi possível entrar. Tente novamente.');
      return;
    }
    if (mine !== generation) return;
    if (resp.ok) {
      $('user-line').textContent = resp.data.usuario.nome + ' · ' + resp.data.usuario.perfil;
      show('view-app');
      const result = await dashboard.load();
      if (mine === generation && !result.ok && AUTH_FAILURES[result.code]) await endSession(AUTH_FAILURES[result.code]);
      return;
    }
    const code = resp.error && resp.error.code;
    if (AUTH_FAILURES[code]) {
      await endSession(AUTH_FAILURES[code]);
      return;
    }
    showSessionError(resp.error.message, resp.correlationId);
  }

  function handleUser(user) {
    if (!user) {
      toLogin();
      return;
    }
    if (signedIn) return;
    signedIn = true;
    loadSession();
  }

  async function onLoginSubmit(e) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    $('login-submit').disabled = true;
    $('login-error').hidden = true;
    try {
      await auth.login($('login-email').value, $('login-password').value);
    } catch (err) {
      showLogin(err && err.name === 'AuthError' ? err.message : GENERIC_LOGIN_ERROR);
    } finally {
      busy = false;
      $('login-submit').disabled = false;
      $('login-password').value = '';
    }
  }

  async function onLogout() {
    pendingMessage = '';
    generation += 1;
    await auth.logout();
    toLogin();
  }

  /** Chamado pela autenticação logo antes de encerrar por inatividade. */
  function onIdle() {
    pendingMessage = IDLE_MESSAGE;
  }

  function start() {
    show('view-boot');
    ACTIVITY_EVENTS.forEach((name) => doc.addEventListener(name, () => auth.touch()));
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) auth.checkIdle(); });
    $('login-form').addEventListener('submit', onLoginSubmit);
    $('logout').addEventListener('click', onLogout);
    $('session-logout').addEventListener('click', onLogout);
    $('session-retry').addEventListener('click', () => { loadSession(); });
    auth.start(handleUser);
  }

  return { start, onIdle };
}
