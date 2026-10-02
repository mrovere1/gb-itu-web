// Liga as peças ao navegador. Único arquivo (com api.js) que menciona fetch.
import { CONFIG } from './config.js?v=1137cff686';
import { loadFirebase } from './firebase.js?v=1137cff686';
import { createApi } from './api.js?v=1137cff686';
import { createAuth } from './auth.js?v=1137cff686';
import { createDashboard } from './dashboard.js?v=1137cff686';
import { createStudentForm } from './student-form.js?v=1137cff686';
import { createStudents } from './students.js?v=1137cff686';
import { createMensalidades } from './mensalidades.js?v=1137cff686';
import { createApp } from './app.js?v=1137cff686';

const firebase = loadFirebase(CONFIG.firebase);
let app = null;

const auth = createAuth({
  firebase,
  now: () => Date.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
  idleMs: CONFIG.idleLogoutMs,
  checkEveryMs: 30000,
  onIdle: () => app.onIdle(),
  onSignOutFailed: () => app.onSignOutFailed(),
});

const api = createApi({
  apiUrl: CONFIG.apiUrl,
  timeoutMs: CONFIG.requestTimeoutMs,
  fetch: (...args) => window.fetch(...args),
  getIdToken: (force) => auth.getIdToken(force),
  AbortController: window.AbortController,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
});

// Exportação CSV: gera o arquivo no navegador (nada sai para a rede).
function download(filename, text) {
  const url = window.URL.createObjectURL(new window.Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
const dashboard = createDashboard({ doc: document, api, openStudent: (id) => app.openStudent(id), openMensalidade: (f) => app.openMensalidade(f), download });
const students = createStudents({
  doc: document,
  api,
  createForm: createStudentForm,
  onAuthFailure: (code) => app.onAuthFailure(code),
});
const mensalidades = createMensalidades({ doc: document, api, onAuthFailure: (code) => app.onAuthFailure(code) });
app = createApp({ doc: document, auth, api, dashboard, students, mensalidades });
app.start();
