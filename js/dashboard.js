// Painel inicial. Texto do servidor entra sempre por textContent. Não importa nada: recebe doc e api por injeção.

const PARTS = ['dash-loading', 'dash-error', 'dash-ready'];

export function createDashboard({ doc, api }) {
  const $ = (id) => doc.getElementById(id);
  let loadId = 0; // cada carregamento tem um número; só o mais recente (e ainda válido) pode mexer na tela

  function show(name) {
    PARTS.forEach((p) => { $(p).hidden = p !== name; });
  }

  function showError(message, reference) {
    $('dash-error-msg').textContent = message;
    $('dash-error-ref').textContent = reference ? 'Código de referência: ' + reference : '';
    show('dash-error');
    $('dash-retry').focus();
  }

  function formatLocal(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch (e) {
      return String(iso);
    }
  }

  function render(data) {
    $('school').textContent = data.escola;
    const production = data.ambiente === 'production';
    $('env').textContent = production ? '' : data.ambiente;
    $('env').hidden = production;
    $('total').textContent = String(data.totalAlunos);
    $('attendance-notice').textContent = data.presenca.aviso;
    $('updated').textContent = 'Atualizado em ' + formatLocal(data.atualizadoEm);

    const list = $('status-list');
    list.textContent = '';
    $('empty').hidden = data.totalAlunos > 0;
    data.alunosPorStatus.forEach((item) => {
      const li = doc.createElement('li');
      const name = doc.createElement('span');
      const count = doc.createElement('strong');
      name.textContent = item.status;
      count.textContent = String(item.total);
      li.appendChild(name);
      li.appendChild(count);
      list.appendChild(li);
    });
    show('dash-ready');
  }

  /** Invalida o carregamento em andamento e apaga tudo o que a tela mostrava (troca ou saída de usuário). */
  function reset() {
    loadId += 1;
    $('school').textContent = 'Sistema Interno';
    $('env').textContent = '';
    $('env').hidden = true;
    $('total').textContent = '0';
    $('empty').hidden = true;
    $('status-list').textContent = '';
    $('attendance-notice').textContent = '';
    $('updated').textContent = '';
    $('dash-error-msg').textContent = '';
    $('dash-error-ref').textContent = '';
    show('dash-loading');
  }

  /** Resolve { ok: true } ou { ok: false, code } (TRANSPORT para falha de rede, STALE se foi substituído); nunca lança. */
  async function load() {
    const mine = ++loadId;
    show('dash-loading');
    try {
      const resp = await api.call('dashboard.obter', []);
      if (mine !== loadId) return { ok: false, code: 'STALE' };
      if (resp.ok) {
        render(resp.data);
        return { ok: true };
      }
      showError(resp.error.message, resp.correlationId);
      return { ok: false, code: resp.error.code };
    } catch (e) {
      if (mine !== loadId) return { ok: false, code: 'STALE' };
      if (e && e.name === 'TransportError') {
        showError(e.message);
        return { ok: false, code: 'TRANSPORT' };
      }
      showError('Não foi possível exibir os dados. Tente novamente.');
      return { ok: false, code: 'CLIENT' };
    }
  }

  $('dash-retry').addEventListener('click', () => { load(); });
  $('dash-refresh').addEventListener('click', () => { load(); });

  return { load, reset };
}
