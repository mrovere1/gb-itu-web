import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const { firebase: firebaseConfig, apiUrl } = window.SPIKE_CONFIG;
const auth = getAuth(initializeApp(firebaseConfig));
const $ = (id) => document.getElementById(id);
const log = (msg) => { $('log').textContent += msg + '\n'; };

document.addEventListener('securitypolicyviolation', (e) => {
  log(`CSP BLOQUEOU: ${e.blockedURI} (${e.violatedDirective})`);
});

$('hosts').addEventListener('click', () => {
  const hosts = new Set(performance.getEntriesByType('resource').map((r) => new URL(r.name).host));
  log('Servidores contatados: ' + [...hosts].sort().join(', '));
});

await setPersistence(auth, browserSessionPersistence);

onAuthStateChanged(auth, (user) => {
  $('estado').textContent = user ? 'Logado como ' + user.email : 'Sem sessão';
  ['chamar', 'adulterado', 'forjado', 'sair'].forEach((id) => { $(id).disabled = !user; });
});

$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await signInWithEmailAndPassword(auth, $('email').value, $('senha').value);
    $('senha').value = '';
  } catch (err) {
    log('Login falhou: ' + err.code);
  }
});

async function chamar(token, rotulo) {
  const t0 = performance.now();
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ acao: 'eco', token, args: [] }),
    });
    const texto = await resp.text();
    log(`[${rotulo}] ${Math.round(performance.now() - t0)} ms -> ${texto}`);
  } catch (err) {
    log(`[${rotulo}] FALHA de rede/CORS: ${err}`);
  }
}

$('chamar').addEventListener('click', async () => chamar(await auth.currentUser.getIdToken(), 'token válido'));
$('adulterado').addEventListener('click', async () => {
  const t = await auth.currentUser.getIdToken();
  chamar(t.slice(0, -4) + (t.endsWith('AAAA') ? 'BBBB' : 'AAAA'), 'assinatura adulterada');
});
$('forjado').addEventListener('click', async () => {
  const [h, p] = (await auth.currentUser.getIdToken()).split('.');
  chamar([h, p, 'assinaturaforjada'].join('.'), 'token forjado');
});
$('lixo').addEventListener('click', () => chamar('isto-nao-e-um-token', 'lixo'));
$('sair').addEventListener('click', () => signOut(auth));
