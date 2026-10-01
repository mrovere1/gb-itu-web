// Liga as peças ao navegador. Único arquivo (com api.js) que menciona fetch.
import { CONFIG } from './config.js?v=2c6c10efff';
import { loadFirebase } from './firebase.js?v=2c6c10efff';
import { createApi } from './api.js?v=2c6c10efff';
import { createAuth } from './auth.js?v=2c6c10efff';
import { createDashboard } from './dashboard.js?v=2c6c10efff';
import { createApp } from './app.js?v=2c6c10efff';

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
app = createApp({ doc: document, auth, api, dashboard });
app.start();
