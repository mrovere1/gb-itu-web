// Liga as peças ao navegador. Único arquivo (com api.js) que menciona fetch.
import { CONFIG } from './config.js?v=ae409220ed';
import { loadFirebase } from './firebase.js?v=ae409220ed';
import { createApi } from './api.js?v=ae409220ed';
import { createAuth } from './auth.js?v=ae409220ed';
import { createDashboard } from './dashboard.js?v=ae409220ed';
import { createApp } from './app.js?v=ae409220ed';

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
