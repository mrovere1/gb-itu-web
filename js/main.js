// Liga as peças ao navegador. Único arquivo (com api.js) que menciona fetch.
import { CONFIG } from './config.js?v=62458f9d62';
import { loadFirebase } from './firebase.js?v=62458f9d62';
import { createApi } from './api.js?v=62458f9d62';
import { createAuth } from './auth.js?v=62458f9d62';
import { createDashboard } from './dashboard.js?v=62458f9d62';
import { createStudentForm } from './student-form.js?v=62458f9d62';
import { createStudents } from './students.js?v=62458f9d62';
import { createMensalidades } from './mensalidades.js?v=62458f9d62';
import { createAlunoFull } from './alunofull.js?v=62458f9d62';
import { createPacote } from './pacote.js?v=62458f9d62';
import { createQuadro } from './quadro.js?v=62458f9d62';
import { createDataTable } from './data-table.js?v=62458f9d62';
import { createToast } from './toast.js?v=62458f9d62';
import { createGlobalSearch } from './global-search.js?v=62458f9d62';
import { createApp } from './app.js?v=62458f9d62';

const firebase = loadFirebase(CONFIG.firebase);
let app = null;

// localStorage guarda só preferências deste navegador (colunas da tabela e "lembrar-me"), nunca dados de aluno.
let storage = null;
try { storage = window.localStorage; } catch (e) { storage = null; }

const REMEMBER_KEY = 'gbitu.lembrar';
const remember = {
  get() { try { return !!storage && storage.getItem(REMEMBER_KEY) === '1'; } catch (e) { return false; } },
  set(on) {
    try {
      if (!storage) return;
      if (on) storage.setItem(REMEMBER_KEY, '1');
      else storage.removeItem(REMEMBER_KEY);
    } catch (e) { /* sem armazenamento: segue só com a sessão da aba */ }
  },
};

const toast = createToast({ doc: document });
const notify = (text, kind) => toast.show(text, kind);

const auth = createAuth({
  firebase,
  now: () => Date.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
  idleMs: CONFIG.idleLogoutMs,
  checkEveryMs: 30000,
  onIdle: () => app.onIdle(),
  onSignOutFailed: () => app.onSignOutFailed(),
  remember,
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
const createTable = (opts) => createDataTable({ doc: document, storage, download, ...opts });
const dashboard = createDashboard({
  doc: document,
  api,
  openStudent: (id) => app.openStudent(id),
  openMensalidade: (f) => app.openMensalidade(f),
  openNewStudent: () => app.openNewStudent(),
  download,
});
const students = createStudents({
  doc: document,
  api,
  createForm: createStudentForm,
  onAuthFailure: (code) => app.onAuthFailure(code),
  createTable,
});
const mensalidades = createMensalidades({
  doc: document,
  api,
  onAuthFailure: (code) => app.onAuthFailure(code),
  createTable,
  download,
  notify,
});
const PACOTE_STALE = 'Este cadastro foi alterado por outra pessoa. Os dados foram recarregados: abra o aluno de novo e refaça o pacote.';
let alunofull;
const pacote = createPacote({
  doc: document,
  api,
  onAuthFailure: (code) => app.onAuthFailure(code),
  notify,
  onSaved: (r) => {
    const msg = r.familia
      ? 'Pacote da família registrado: ' + r.membros + (r.membros === 1 ? ' aluno, ' : ' alunos, ') + new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor_total) + ' em ' + r.meses + (r.meses === 1 ? ' mês.' : ' meses.')
      : 'Pacote registrado: ' + r.meses + (r.meses === 1 ? ' mês' : ' meses') + ', pago até ' + r.pago_ate.slice(5) + '/' + r.pago_ate.slice(0, 4)
      + (r.previstos ? ' (' + r.previstos + (r.previstos === 1 ? ' parcela prevista' : ' parcelas previstas') + ').' : '.');
    notify(msg);
    alunofull.refresh(msg);
  },
  onStale: () => { notify(PACOTE_STALE, 'error'); alunofull.refresh(PACOTE_STALE); },
  onTimeout: (msg) => alunofull.refresh(msg),
});
const quadro = createQuadro({
  doc: document,
  api,
  onAuthFailure: (code) => app.onAuthFailure(code),
  openAction: (kind, item, opener, ext) => mensalidades.openAction(kind, item, opener, ext),
  download,
});
alunofull = createAlunoFull({
  doc: document,
  api,
  onAuthFailure: (code) => app.onAuthFailure(code),
  createTable,
  openStudent: (id) => app.openStudent(id),
  openPackage: pacote.open,
  closePackage: pacote.close,
  quadro,
  notify,
  initialView: 'grid',
});
app = createApp({
  doc: document,
  auth,
  api,
  dashboard,
  students,
  mensalidades,
  alunofull,
  restoreSession: remember.get(),
});
createGlobalSearch({
  doc: document,
  api,
  openStudent: (id) => app.openStudent(id),
  openMensalidades: (f) => app.openMensalidade(f),
  hasPay: () => app.canRegisterPayment(),
  onAuthFailure: (code) => app.onAuthFailure(code),
});
app.start();
