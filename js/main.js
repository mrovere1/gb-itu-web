// Liga as peças ao navegador. Único arquivo (com api.js) que menciona fetch.
import { CONFIG } from './config.js?v=97019658dd';
import { loadFirebase } from './firebase.js?v=97019658dd';
import { createApi } from './api.js?v=97019658dd';
import { createAuth } from './auth.js?v=97019658dd';
import { createDashboard } from './dashboard.js?v=97019658dd';
import { createStudentForm } from './student-form.js?v=97019658dd';
import { createStudents } from './students.js?v=97019658dd';
import { createMensalidades } from './mensalidades.js?v=97019658dd';
import { createAlunoFull } from './alunofull.js?v=97019658dd';
import { createPacote } from './pacote.js?v=97019658dd';
import { createDataTable } from './data-table.js?v=97019658dd';
import { createApp } from './app.js?v=97019658dd';

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
// Preferências de colunas ficam só neste navegador (localStorage), sem dados de alunos.
let storage = null;
try { storage = window.localStorage; } catch (e) { storage = null; }
const createTable = (opts) => createDataTable({ doc: document, storage, download, ...opts });
const dashboard = createDashboard({ doc: document, api, openStudent: (id) => app.openStudent(id), openMensalidade: (f) => app.openMensalidade(f), download });
const students = createStudents({
  doc: document,
  api,
  createForm: createStudentForm,
  onAuthFailure: (code) => app.onAuthFailure(code),
  createTable,
});
const mensalidades = createMensalidades({ doc: document, api, onAuthFailure: (code) => app.onAuthFailure(code), createTable });
const PACOTE_STALE = 'Este cadastro foi alterado por outra pessoa. Os dados foram recarregados: abra o aluno de novo e refaça o pacote.';
let alunofull;
const pacote = createPacote({
  doc: document,
  api,
  onAuthFailure: (code) => app.onAuthFailure(code),
  onSaved: (r) => alunofull.refresh(r.familia
    ? 'Pacote da família registrado: ' + r.membros + (r.membros === 1 ? ' aluno, ' : ' alunos, ') + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor_total) + ' em ' + r.meses + (r.meses === 1 ? ' mês.' : ' meses.')
    : 'Pacote registrado: ' + r.meses + (r.meses === 1 ? ' mês' : ' meses') + ', pago até ' + r.pago_ate.slice(5) + '/' + r.pago_ate.slice(0, 4)
    + (r.previstos ? ' (' + r.previstos + (r.previstos === 1 ? ' parcela prevista' : ' parcelas previstas') + ').' : '.')),
  onStale: () => alunofull.refresh(PACOTE_STALE),
});
alunofull = createAlunoFull({ doc: document, api, onAuthFailure: (code) => app.onAuthFailure(code), createTable, openStudent: (id) => app.openStudent(id), openPackage: pacote.open, closePackage: pacote.close });
app = createApp({ doc: document, auth, api, dashboard, students, mensalidades, alunofull });
app.start();
