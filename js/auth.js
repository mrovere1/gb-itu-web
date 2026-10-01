// Login, logout e inatividade. Não conhece o SDK: recebe um adaptador `firebase` (ver js/firebase.js).

const GENERIC_LOGIN_ERROR = 'Não foi possível entrar. Tente novamente.';
// Mesmo texto para senha errada, usuário inexistente e credencial inválida: não revela se o e-mail existe.
const WRONG_CREDENTIALS = 'E-mail ou senha incorretos.';

const LOGIN_MESSAGES = Object.freeze({
  'auth/invalid-credential': WRONG_CREDENTIALS,
  'auth/wrong-password': WRONG_CREDENTIALS,
  'auth/user-not-found': WRONG_CREDENTIALS,
  'auth/invalid-email': 'Informe um e-mail válido.',
  'auth/user-disabled': 'Esta conta está desativada. Procure a administração.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão. Verifique a internet e tente de novo.',
});

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export function loginErrorMessage(code) {
  return LOGIN_MESSAGES[code] || GENERIC_LOGIN_ERROR;
}

/**
 * deps: { firebase, now(), setInterval(fn, ms), clearInterval(id), idleMs, checkEveryMs, onIdle() }
 * firebase: { onChange(cb), signIn(email, password), signOut(), hasUser(), getIdToken(force) }
 */
export function createAuth(deps) {
  let signedIn = false;
  let lastActivity = deps.now();
  let timer = null;

  function stopTimer() {
    if (timer !== null) {
      deps.clearInterval(timer);
      timer = null;
    }
  }

  async function safeSignOut() {
    try {
      await deps.firebase.signOut();
    } catch (e) {
      // sem ação: a interface já trata como desconectado
    }
  }

  // Compara com o relógio (e não só com o temporizador): em aba em segundo plano o temporizador congela.
  async function checkIdle() {
    if (!signedIn) return false;
    if (deps.now() - lastActivity < deps.idleMs) return false;
    signedIn = false;
    stopTimer();
    deps.onIdle();
    await safeSignOut();
    return true;
  }

  function start(onUser) {
    deps.firebase.onChange((user) => {
      signedIn = !!user;
      if (signedIn) {
        lastActivity = deps.now();
        if (timer === null) timer = deps.setInterval(() => { checkIdle(); }, deps.checkEveryMs);
      } else {
        stopTimer();
      }
      onUser(user);
    });
  }

  async function login(email, password) {
    const cleanEmail = String(email == null ? '' : email).trim();
    const pass = String(password == null ? '' : password);
    if (!cleanEmail || !pass.trim()) throw new AuthError('Informe e-mail e senha.');
    try {
      await deps.firebase.signIn(cleanEmail, pass);
    } catch (e) {
      throw new AuthError(loginErrorMessage(e && e.code));
    }
  }

  async function logout() {
    signedIn = false;
    stopTimer();
    await safeSignOut();
  }

  async function getIdToken(force) {
    if (!deps.firebase.hasUser()) return null;
    return deps.firebase.getIdToken(!!force);
  }

  function touch() {
    if (signedIn) lastActivity = deps.now();
  }

  return { start, login, logout, getIdToken, touch, checkIdle };
}
