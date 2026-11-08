// Painel inicial. Texto do servidor entra sempre por textContent. Não importa nada: recebe doc e api por injeção.

import { createAdminDashboard } from './dashboard-admin.js?v=63e14653d0';
import { createMonthSelect } from './month-select.js?v=63e14653d0';

const PARTS = ['dash-loading', 'dash-error', 'dash-ready'];

export function createDashboard({ doc, api, openStudent = () => {}, openMensalidade = () => {}, openNewStudent = () => {}, download = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  let perfil = '';
  const admin = createAdminDashboard({ doc, openStudent, openMensalidade, download });
  let competencias = null; // lista de meses (AAAA-MM); só o Administrador escolhe; nos demais perfis fica nula
  const monthSelect = createMonthSelect({ doc, id: 'dash-comp', onChange: (list) => { competencias = list; load(); } });
  let loadId = 0; // cada carregamento tem um número; só o mais recente (e ainda válido) pode mexer na tela

  function show(name) {
    PARTS.forEach((p) => { $(p).hidden = p !== name; });
  }

  /** Ações rápidas por perfil. Só a vitrine: o servidor autoriza cada operação. */
  function renderActions() {
    const canCreate = ['Administrador', 'Gestor', 'Recepcao'].includes(perfil);
    const canPay = ['Administrador', 'Financeiro'].includes(perfil);
    const canSeeMoney = ['Administrador', 'Gestor', 'Financeiro'].includes(perfil);
    $('home-new-student').hidden = !canCreate;
    $('home-pay').hidden = !canPay;
    $('home-mensalidades').hidden = !canSeeMoney;
    $('home-actions').hidden = !(canCreate || canSeeMoney);
  }

  function setPerfil(p) {
    perfil = p || '';
    renderActions();
  }

  /** Resumo curto do que precisa de atenção (só para quem tem o painel completo). */
  function renderAttention(data) {
    const box = $('home-attention');
    const list = $('home-attention-list');
    list.textContent = '';
    if (data.completo !== true) { box.hidden = true; return; }
    const items = [];
    const inds = data.indicadores
      ? [].concat(data.indicadores.principais || [], data.indicadores.complementares || [])
      : [];
    const inad = inds.find((i) => i.id === 'inadimplentes');
    if (inad && inad.estado === 'ok' && inad.valor > 0) {
      items.push(inad.valor + (inad.valor === 1 ? ' aluno em atraso' : ' alunos em atraso') + (inad.secundario ? ' · ' + inad.secundario : ''));
    }
    const hoje = (Array.isArray(data.aniversariantes) ? data.aniversariantes : []).filter((a) => a && a.hoje).length;
    if (hoje) items.push(hoje + (hoje === 1 ? ' aniversariante hoje' : ' aniversariantes hoje'));
    (Array.isArray(data.avisos) ? data.avisos : []).slice(0, 2).forEach((a) => items.push(a));
    items.forEach((text) => {
      const li = doc.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    box.hidden = items.length === 0;
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

    const full = data.completo === true;
    $('dash-basic').hidden = full;
    $('dash-comp-box').hidden = !full;
    if (full) {
      competencias = Array.isArray(data.competencias) && data.competencias.length ? data.competencias : [data.competencia];
      monthSelect.setOptions(data.opcoes && Array.isArray(data.opcoes.competencias) ? data.opcoes.competencias : competencias);
      monthSelect.setValue(competencias);
      admin.render(data);
    } else {
      competencias = null;
      monthSelect.reset();
      admin.reset();
    }

    renderAttention(data);
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
    competencias = null;
    monthSelect.reset();
    $('dash-comp-box').hidden = true;
    $('home-attention').hidden = true;
    $('home-attention-list').textContent = '';
    $('home-actions').hidden = true;
    admin.reset(); // antes de restaurar o quadro básico: a área de trabalho devolve as partes que escondeu
    $('dash-basic').hidden = false;
    show('dash-loading');
  }

  function busy(on) {
    $('dash-refresh').disabled = on;
    $('dash-refresh').textContent = on ? 'Atualizando…' : 'Atualizar';
  }

  /** Resolve { ok: true } ou { ok: false, code } (TRANSPORT para falha de rede, STALE se foi substituído); nunca lança. */
  async function load() {
    const mine = ++loadId;
    const refreshing = !$('dash-ready').hidden; // atualização com o painel já na tela: mantém o conteúdo
    if (refreshing) busy(true);
    else show('dash-loading');
    try {
      const resp = await api.call('dashboard.obter', competencias ? [{ competencias }] : []);
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
    } finally {
      if (mine === loadId) busy(false);
    }
  }

  $('home-new-student').addEventListener('click', () => { openNewStudent(); });
  $('home-pay').addEventListener('click', () => { openMensalidade({ status: 'Pendente' }); });
  $('home-mensalidades').addEventListener('click', () => { openMensalidade({}); });
  $('dash-retry').addEventListener('click', () => { load(); });
  $('dash-refresh').addEventListener('click', () => { load(); });

  return { load, reset, setPerfil };
}
