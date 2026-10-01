// Adaptador fino sobre o SDK do Firebase (versão fixada em vendor/). É o único arquivo que o importa.
// Iniciado SEM resolvedor de popup: login só por e-mail e senha, sessão por aba.
import { initializeApp } from '../vendor/firebase/12.19.0/firebase-app.js';
import {
  initializeAuth, browserSessionPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from '../vendor/firebase/12.19.0/firebase-auth.js';

export function loadFirebase(config) {
  const auth = initializeAuth(initializeApp(config), { persistence: browserSessionPersistence });
  return {
    onChange: (callback) => onAuthStateChanged(auth, (user) => callback(user ? { email: user.email } : null)),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password).then(() => undefined),
    signOut: () => signOut(auth),
    hasUser: () => auth.currentUser !== null,
    getIdToken: (force) => auth.currentUser.getIdToken(force),
  };
}
