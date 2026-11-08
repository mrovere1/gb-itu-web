// Adaptador fino sobre o SDK do Firebase (versão fixada em vendor/). É o único arquivo que o importa.
// Iniciado SEM resolvedor de popup: login só por e-mail e senha. A persistência é escolhida no login:
// por aba (padrão, bom para computador compartilhado) ou local ("lembrar-me", para o aparelho do dono).
import { initializeApp } from '../vendor/firebase/12.19.0/firebase-app.js';
import {
  initializeAuth, browserSessionPersistence, browserLocalPersistence, setPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
} from '../vendor/firebase/12.19.0/firebase-auth.js';

export function loadFirebase(config) {
  const auth = initializeAuth(initializeApp(config), { persistence: browserSessionPersistence });
  return {
    onChange: (callback) => onAuthStateChanged(auth, (user) => callback(user ? { email: user.email } : null)),
    setRemember: (remember) => setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password).then(() => undefined),
    signOut: () => signOut(auth),
    hasUser: () => auth.currentUser !== null,
    getIdToken: (force) => auth.currentUser.getIdToken(force),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
  };
}
