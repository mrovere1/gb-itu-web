// Liga as peças ao navegador. Único arquivo (com api.js) que menciona fetch.
import { CONFIG } from './config.js?v=40fce1a7a1';
import { loadFirebase } from './firebase.js?v=40fce1a7a1';
import { createApi } from './api.js?v=40fce1a7a1';
import { createAuth } from './auth.js?v=40fce1a7a1';
import { createDashboard } from './dashboard.js?v=40fce1a7a1';
import { createStudentForm } from './student-form.js?v=40fce1a7a1';
import { createStudents } from './students.js?v=40fce1a7a1';
import { createApp } from './app.js?v=40fce1a7a1';

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
