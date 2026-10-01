// Liga as peças ao navegador. Único arquivo (com api.js) que menciona fetch.
import { CONFIG } from './config.js?v=e08bce1c73';
import { loadFirebase } from './firebase.js?v=e08bce1c73';
import { createApi } from './api.js?v=e08bce1c73';
import { createAuth } from './auth.js?v=e08bce1c73';
import { createDashboard } from './dashboard.js?v=e08bce1c73';
import { createStudentForm } from './student-form.js?v=e08bce1c73';
import { createStudents } from './students.js?v=e08bce1c73';
import { createApp } from './app.js?v=e08bce1c73';

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

const dashboard = createDashboard({ doc: document, api });
const students = createStudents({
  doc: document,
  api,
  createForm: createStudentForm,
  onAuthFailure: (code) => app.onAuthFailure(code),
});
app = createApp({ doc: document, auth, api, dashboard, students });
app.start();
