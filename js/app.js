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
const SIGNOUT_FAILED_MESSAGE = 'Não foi possível encerrar a sessão com segurança. Feche esta aba do navegador antes de deixar o computador.';
const UNEXPECTED_RESPONSE = 'O servidor respondeu de forma inesperada. Tente novamente em instantes.';
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'touchstart', 'scroll'];

export function createApp({ doc, auth, api, dashboard, students }) {
  const $ = (id) => doc.getElementById(id);
  let busy = false;           // login em andamento
  let signedIn = false;       // já há usuário do Firebase (evita carregar a sessão duas vezes)
  let generation = 0;         // invalida respostas de sessões que já terminaram
  let pendingMessage = '';    // aviso a mostrar quando voltar ao login

  function show(view) {
    VIEWS.forEach((v) => { $(v).hidden = v !== view; });
  }

  function showTab(view) {
    const onStudents = view === 'students';
    $('view-dashboard').hidden = onStudents;
    $('view-students').hidden = !onStudents;
    [['dashboard', 'tab-dashboard'], ['students', 'tab-students']].forEach(([name, id]) => {
      if (name === view) $(id).setAttribute('aria-current', 'page');
      else $(id).removeAttribute('aria-current');
    });
    if (onStudents) students.activate();
  }

  /** Abre o cadastro de um aluno a partir do painel. */
  function openStudent(id) {
    students.open(id);
    showTab('students');
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
    dashboard.reset();
    students.reset();
    showTab('dashboard');
    $('user-line').textContent = '';
    const message = pendingMessage;
    pendingMessage = '';
    showLogin(message);
  }

  async function endSession(message) {
    pendingMessage = message;
    generation += 1;
    const signedOut = await auth.logout();
    if (!signedOut) pendingMessage = (pendingMessage ? pendingMessage + ' ' : '') + SIGNOUT_FAILED_MESSAGE;
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
    try {
      if (resp.ok) {
        const usuario = resp.data.usuario;
        $('user-line').textContent = usuario.nome + ' · ' + usuario.perfil;
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
    } catch (e) {
      // Resposta com formato inesperado: nunca deixar a tela presa em "Entrando…".
      if (mine === generation) showSessionError(UNEXPECTED_RESPONSE);
    }
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
    const signedOut = await auth.logout();
    if (!signedOut) pendingMessage = SIGNOUT_FAILED_MESSAGE;
    toLogin();
  }

  /** Chamado pela autenticação logo antes de encerrar por inatividade. */
  function onIdle() {
    pendingMessage = IDLE_MESSAGE;
  }

  /** Chamado pela autenticação quando a saída por inatividade não foi confirmada pelo Firebase. */
  function onSignOutFailed() {
    pendingMessage = (pendingMessage ? pendingMessage + ' ' : '') + SIGNOUT_FAILED_MESSAGE;
    toLogin();
  }

  /** Chamado pelas telas de Alunos quando o servidor recusa a sessão. */
  function onAuthFailure(code) {
    if (signedIn && AUTH_FAILURES[code]) endSession(AUTH_FAILURES[code]);
  }

  function start() {
    show('view-boot');
    ACTIVITY_EVENTS.forEach((name) => doc.addEventListener(name, () => auth.touch()));
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) auth.checkIdle(); });
    $('login-form').addEventListener('submit', onLoginSubmit);
    $('tab-dashboard').addEventListener('click', () => showTab('dashboard'));
    $('tab-students').addEventListener('click', () => showTab('students'));
    $('logout').addEventListener('click', onLogout);
    $('session-logout').addEventListener('click', onLogout);
    $('session-retry').addEventListener('click', () => { loadSession(); });
    auth.start(handleUser);
  }

  return { start, onIdle, onSignOutFailed, onAuthFailure, openStudent };
}
