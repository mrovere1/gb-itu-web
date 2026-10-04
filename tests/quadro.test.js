import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuadro } from '../js/quadro.js';
import { createDom, flush } from './helpers/dom-env.js';

const ok = (data) => ({ ok: true, data, error: null, correlationId: 'c1' });
const fail = (code, message) => ({ ok: false, data: null, error: { code, message }, correlationId: 'c2' });
const flat = (t) => String(t).replace(/\s/g, ' ');

const OPCOES = { competencias: ['2026-07', '2026-08', '2026-09', '2026-10'], formas: ['PIX', 'Crédito'], contas: ['PF', 'PJ'], status: ['Paga', 'Pendente'] };
const ACOES = { registrar: false, editarVencimento: false, cancelar: false, estornar: false, cancelarPrevisto: false, reabrir: false, desfazerPacote: false };
const cell = (over) => ({
  charge_id: 'COB-1', competencia: '2026-09', nome: 'Bruno Ficticio', status: 'Pendente', mostrar: 'Pendente', valor: 200, vencimento: '2026-09-10', vencida: true, versao: 'v1',
  pagamento: null, acoes: { ...ACOES, registrar: true, editarVencimento: true, cancelar: true }, ...over,
});
const pago = (id, comp, nome) => cell({ charge_id: id, competencia: comp, nome, status: 'Paga', mostrar: 'Pago', vencida: false, pagamento: { payment_id: 'PAG-' + id, data: comp + '-10', forma: 'PIX', valor: 200, status: 'Confirmado', pacote: false }, acoes: { ...ACOES, estornar: true } });
const ROWS = () => [
  { student_id: 'ALU-1', nome: 'Ana Ficticia', status: 'Ativo', familia: 'Bruno Ficticio', isencao: '', pago_ate: '2026-09', mensalidade: 150, dia_vencimento: 10, lancar: true, totais: { pagos: 2, pendentes: 1 },
    cells: {
      '2026-07': cell({ charge_id: 'COB-A7', competencia: '2026-07', nome: 'Ana Ficticia', valor: 150, vencimento: '2026-07-10' }),
      '2026-08': cell({ charge_id: 'COB-A8', competencia: '2026-08', nome: 'Ana Ficticia', status: 'Coberta por pacote', mostrar: 'Pago (pacote)', vencida: false, acoes: { ...ACOES, reabrir: true } }),
      '2026-09': cell({ charge_id: 'COB-A9', competencia: '2026-09', nome: 'Ana Ficticia', status: 'Coberta por pacote', mostrar: 'Pago (pacote)', vencida: false, pagamento: { payment_id: 'PAG-P', data: '2026-10-10', forma: 'Crédito', valor: 150, status: 'Previsto', pacote: true }, acoes: { ...ACOES, cancelarPrevisto: true, desfazerPacote: true } }),
    } },
  { student_id: 'ALU-2', nome: 'Bruno Ficticio', status: 'Ativo', familia: 'Bruno Ficticio', isencao: '', pago_ate: '', mensalidade: 200, dia_vencimento: 10, lancar: true, totais: { pagos: 2, pendentes: 1 },
    cells: { '2026-07': pago('COB-B7', '2026-07', 'Bruno Ficticio'), '2026-08': pago('COB-B8', '2026-08', 'Bruno Ficticio'), '2026-09': cell({ charge_id: 'COB-B9' }) } },
  { student_id: 'ALU-3', nome: 'Carlos Ficticio', status: 'Inativo', familia: '', isencao: 'Férias', pago_ate: '', mensalidade: 100, dia_vencimento: 10, lancar: false, totais: { pagos: 0, pendentes: 0 },
    cells: { '2026-08': cell({ charge_id: 'COB-C8', competencia: '2026-08', nome: 'Carlos Ficticio', status: 'Suspensa', mostrar: 'Férias', valor: 0, vencida: false, acoes: ACOES }) } },
  { student_id: 'ALU-4', nome: 'Daniela Ficticia', status: 'Ativo', familia: '', isencao: '', pago_ate: '', mensalidade: null, dia_vencimento: null, lancar: false, totais: { pagos: 0, pendentes: 0 }, cells: {} },
];
const DATA = (over = {}) => ({ competencias: ['2026-07', '2026-08', '2026-09'], periodoRotulo: 'jul/26–set/26', alunos: ROWS(), total: 4, opcoes: OPCOES, permissoes: { registrar: true, cancelar: true, gerar: true }, hoje: '2026-09-30', ...over });

function setup(respond = () => ok(DATA())) {
  const dom = createDom();
  const calls = [];
  const auth = [];
  const opened = [];
  const downloads = [];
  const api = { call: async (acao, args) => { calls.push({ acao, args }); return respond(acao, args, calls.length); } };
  const openAction = (kind, item, opener, ext) => opened.push({ kind, item, opener, ext });
  const quadro = createQuadro({ doc: dom.doc, api, openAction, onAuthFailure: (c) => auth.push(c), download: (n, t) => downloads.push([n, t]) });
  const tbody = () => dom.$('qd-table').children[1];
  const thead = () => dom.$('qd-table').children[0];
  const names = () => tbody().children.map((tr) => tr.children[0].children[0].textContent);
  const cellAt = (r, c) => tbody().children[r].children[c];
  const press = (key) => (dom.docListeners.keydown || []).forEach((fn) => fn({ key }));
  const load = async () => { quadro.activate(); await flush(); };
  const pick = (isos) => {
    dom.click('qd-comp-btn');
    dom.$('qd-comp-list').children.forEach((l) => { l.children[0].checked = isos.includes(l.children[0].value); l.children[0].listeners.change(); });
    dom.click('qd-comp-apply');
  };
  return { dom, calls, auth, opened, downloads, quadro, tbody, thead, names, cellAt, press, load, pick };
}
const texts = (node) => [node._t, ...(node.children || []).flatMap(texts)].filter(Boolean);

test('activate carrega uma vez e mostra só os alunos Ativos por padrão, em ordem de nome, com a legenda', async () => {
  const { dom, calls, names, quadro, load } = setup();
  await load();
  quadro.activate();
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { acao: 'alunofull.quadro', args: [] });
  assert.deepEqual(names(), ['Ana Ficticia', 'Bruno Ficticio', 'Daniela Ficticia']);
  assert.equal(dom.$('qd-ready').hidden, false);
  assert.equal(dom.$('qd-loading').hidden, true);
  assert.equal(flat(dom.$('qd-count').textContent), '3 de 4 alunos');
  assert.ok(dom.$('qd-legend').children.length >= 5);
  assert.equal(dom.$('qd-comp-btn').textContent, 'jul/26–set/26 (3 meses)');
});

test('cabeçalho: Aluno, um mês por coluna, Pagos, Pendentes e Pago até', async () => {
  const { thead, load } = setup();
  await load();
  assert.deepEqual(thead().children[0].children.map((th) => th.textContent), ['Aluno', 'jul/26', 'ago/26', 'set/26', 'Pagos', 'Pendentes', 'Pago até']);
});

test('células: texto curto por situação, classe de cor, vencida em destaque e "Sem registro" onde não há cobrança', async () => {
  const { cellAt, load } = setup();
  await load();
  const rowAna = (c) => cellAt(0, c).children[0];
  assert.equal(rowAna(1).textContent, 'Pendente');
  assert.match(rowAna(1).className, /qd-pend/);
  assert.match(rowAna(1).className, /qd-venc/);
  assert.equal(rowAna(2).textContent, 'Pacote');
  assert.match(rowAna(2).className, /qd-pacote/);
  assert.equal(rowAna(2).getAttribute('aria-label'), 'Ana Ficticia, ago/26: Pago (pacote)');
  assert.equal(cellAt(1, 1).children[0].textContent, 'Pago');
  assert.match(cellAt(1, 1).children[0].className, /qd-pago/);
  assert.equal(cellAt(2, 1).children[0].textContent, 'Sem registro', 'Daniela não tem cobrança');
});

test('totais por aluno: pagos, pendentes e "pago até" (mm/aaaa)', async () => {
  const { cellAt, load } = setup();
  await load();
  assert.deepEqual([4, 5, 6].map((c) => cellAt(0, c).textContent), ['2', '1', '09/2026']);
  assert.equal(cellAt(1, 6).textContent, '—');
});

test('filtros: busca sem acento, status Todos mostra o inativo, só com pendência esconde quem não deve', async () => {
  const { dom, names, load } = setup();
  await load();
  dom.$('qd-q').value = 'FÍCT';
  dom.$('qd-q').listeners.input();
  assert.equal(names().length, 3);
  dom.$('qd-q').value = 'bruno';
  dom.$('qd-q').listeners.input();
  assert.deepEqual(names(), ['Bruno Ficticio']);
  dom.$('qd-q').value = '';
  dom.$('qd-q').listeners.input();
  dom.$('qd-status').value = '';
  dom.$('qd-status').listeners.change();
  assert.deepEqual(names(), ['Ana Ficticia', 'Bruno Ficticio', 'Carlos Ficticio', 'Daniela Ficticia']);
  dom.$('qd-pend').checked = true;
  dom.$('qd-pend').listeners.change();
  assert.deepEqual(names(), ['Ana Ficticia', 'Bruno Ficticio']);
  dom.$('qd-q').value = 'zzz';
  dom.$('qd-q').listeners.input();
  assert.equal(dom.$('qd-empty').hidden, false);
  assert.equal(dom.$('qd-ready').hidden, true);
});

test('escolher outros meses recarrega o quadro com a lista de meses', async () => {
  const { dom, calls, pick, load } = setup((a, args) => ok(DATA(args[0] ? { competencias: args[0].competencias } : {})));
  await load();
  pick(['2026-09']);
  await flush();
  assert.deepEqual(calls[1], { acao: 'alunofull.quadro', args: [{ competencias: ['2026-09'] }] });
  assert.equal(dom.$('qd-comp-btn').textContent, 'Setembro/2026');
});

test('clicar numa célula pendente abre o cartão com detalhes e as ações permitidas (Registrar pagamento primeiro)', async () => {
  const { dom, cellAt, load } = setup();
  await load();
  cellAt(1, 3).children[0].listeners.click(); // Bruno, set/26
  assert.equal(dom.$('qd-cell').hidden, false);
  assert.equal(dom.$('qd-cell-title').textContent, 'Bruno Ficticio · Setembro/2026');
  const details = flat(texts(dom.$('qd-cell-details')).join(' '));
  assert.match(details, /Pendente/);
  assert.match(details, /R\$\s?200,00/);
  assert.match(details, /10\/09\/2026/);
  assert.deepEqual(dom.$('qd-cell-actions').children.map((b) => b.textContent), ['Registrar pagamento', 'Alterar vencimento', 'Cancelar cobrança']);
  assert.equal(dom.$('qd-cell-actions').children[0].className.includes('qd-primary'), true);
  assert.ok(dom.$('qd-cell-close').focused > 0 || dom.$('qd-cell-actions').children[0].focused > 0);
});

test('escolher uma ação fecha o cartão e abre a janela de operação do mesmo jeito que em Mensalidades', async () => {
  const { dom, opened, cellAt, load } = setup();
  await load();
  const btn = cellAt(1, 3).children[0];
  btn.listeners.click();
  dom.$('qd-cell-actions').children[0].listeners.click();
  assert.equal(dom.$('qd-cell').hidden, true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].kind, 'pagar');
  assert.equal(opened[0].item.charge_id, 'COB-B9');
  assert.equal(opened[0].item.versao, 'v1');
  assert.equal(opened[0].opener, btn);
  assert.equal(opened[0].ext.inertId, 'af-inner');
  assert.equal(opened[0].ext.hoje, '2026-09-30');
  assert.deepEqual(opened[0].ext.opcoes.formas, ['PIX', 'Crédito']);
});

test('terminada a ação, o quadro recarrega e mostra o aviso', async () => {
  const { dom, calls, opened, cellAt, load } = setup();
  await load();
  cellAt(1, 3).children[0].listeners.click();
  dom.$('qd-cell-actions').children[0].listeners.click();
  opened[0].ext.onDone('Pagamento registrado.');
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(dom.$('qd-notice').textContent, 'Pagamento registrado.');
  assert.equal(dom.$('qd-notice').hidden, false);
});

test('ações por situação: pago estorna; pacote volta a pendente/desfaz; parcela prevista cancela; isento não tem ação', async () => {
  const { dom, cellAt, load } = setup();
  await load();
  const actionsOf = (r, c) => { cellAt(r, c).children[0].listeners.click(); return dom.$('qd-cell-actions').children.map((b) => b.textContent); };
  assert.deepEqual(actionsOf(1, 1), ['Estornar pagamento']);
  assert.deepEqual(actionsOf(0, 2), ['Voltar a pendente']);
  assert.deepEqual(actionsOf(0, 3), ['Cancelar parcela prevista', 'Desfazer pacote']);
  assert.match(flat(texts(dom.$('qd-cell-details')).join(' ')), /Previsto/);
});

test('célula isenta mostra detalhes e orienta, sem botões de ação', async () => {
  const { dom, names, cellAt, load } = setup();
  await load();
  dom.$('qd-status').value = '';
  dom.$('qd-status').listeners.change();
  assert.equal(names()[2], 'Carlos Ficticio');
  cellAt(2, 2).children[0].listeners.click(); // Carlos, ago/26 (Férias)
  assert.equal(dom.$('qd-cell-actions').children.length, 0);
  assert.match(dom.$('qd-cell-info').textContent, /Aluno Full|isen/i);
});

test('"Sem registro" de aluno com matrícula ativa oferece "Lançar cobrança do mês", com valor e vencimento sugeridos', async () => {
  const rows = ROWS().map((r) => (r.student_id === 'ALU-2' ? { ...r, cells: { '2026-07': r.cells['2026-07'] } } : r)); // Bruno sem cobrança em ago e set
  const { dom, opened, cellAt, load } = setup(() => ok(DATA({ alunos: rows })));
  await load();
  cellAt(1, 2).children[0].listeners.click(); // Bruno, ago/26 sem registro
  assert.equal(dom.$('qd-cell-title').textContent, 'Bruno Ficticio · Agosto/2026');
  assert.deepEqual(dom.$('qd-cell-actions').children.map((b) => b.textContent), ['Lançar cobrança do mês']);
  dom.$('qd-cell-actions').children[0].listeners.click();
  assert.equal(opened[0].kind, 'lancar');
  assert.deepEqual({ ...opened[0].item }, { student_id: 'ALU-2', nome: 'Bruno Ficticio', competencia: '2026-08', valor: 200, vencimento: '2026-08-10' });
  assert.equal(dom.$('qd-cell').hidden, true);
});

test('"Sem registro" de aluno sem matrícula ativa não é clicável', async () => {
  const { cellAt, load } = setup();
  await load();
  const sem = cellAt(2, 1).children[0]; // Daniela
  assert.equal(sem.textContent, 'Sem registro');
  assert.equal(sem.tag, 'span');
  assert.equal(sem.listeners.click, undefined);
});

test('vencimento sugerido respeita o fim do mês (dia 31 em fevereiro vira 28)', async () => {
  const rows = ROWS().map((r) => (r.student_id === 'ALU-2' ? { ...r, dia_vencimento: 31, cells: {} } : r));
  const { dom, opened, cellAt, load } = setup(() => ok(DATA({ competencias: ['2026-02'], alunos: rows })));
  await load();
  cellAt(1, 1).children[0].listeners.click();
  dom.$('qd-cell-actions').children[0].listeners.click();
  assert.equal(opened[0].item.vencimento, '2026-02-28');
});

test('Escape, Fechar e o fundo fecham o cartão e devolvem o foco à célula', async () => {
  for (const how of ['escape', 'fechar', 'fundo']) {
    const { dom, cellAt, press, load } = setup();
    await load();
    const btn = cellAt(1, 3).children[0];
    btn.listeners.click();
    const before = btn.focused;
    if (how === 'escape') press('Escape');
    if (how === 'fechar') dom.click('qd-cell-close');
    if (how === 'fundo') dom.click('qd-cell-backdrop');
    assert.equal(dom.$('qd-cell').hidden, true, how);
    assert.equal(dom.$('af-inner').inert, false, how);
    assert.equal(btn.focused, before + 1, how);
  }
});

test('o cartão isola o quadro (inert) enquanto está aberto', async () => {
  const { dom, cellAt, load } = setup();
  await load();
  cellAt(1, 3).children[0].listeners.click();
  assert.equal(dom.$('af-inner').inert, true);
});

test('falhas: rede mostra a mensagem e Tentar novamente; sessão caída avisa o aplicativo; erro do servidor mostra a referência', async () => {
  const net = Object.assign(new Error('Sem conexão com o servidor.'), { name: 'TransportError' });
  const a = setup(() => { throw net; });
  await a.load();
  assert.equal(a.dom.$('qd-error').hidden, false);
  assert.match(a.dom.$('qd-error-msg').textContent, /Sem conexão/);
  const b = setup(() => fail('NAO_AUTENTICADO', 'x'));
  await b.load();
  assert.deepEqual(b.auth, ['NAO_AUTENTICADO']);
  const c = setup(() => fail('ERRO_INTERNO', 'Ocorreu um erro inesperado.'));
  await c.load();
  assert.match(c.dom.$('qd-error-msg').textContent, /inesperado/);
  assert.match(c.dom.$('qd-error-ref').textContent, /c2/);
  c.dom.click('qd-retry');
  await flush();
  assert.equal(c.calls.length, 2);
});

test('resposta com formato inesperado vira erro genérico (nunca tela presa)', async () => {
  const { dom, load } = setup(() => ok({ alunos: 'x' }));
  await load();
  assert.equal(dom.$('qd-error').hidden, false);
});

test('reset apaga tudo e descarta resposta que chegar depois', async () => {
  let release;
  const { dom, quadro, tbody, load } = setup(() => new Promise((r) => { release = () => r(ok(DATA())); }));
  quadro.activate();
  await flush();
  quadro.reset();
  release();
  await flush();
  assert.equal(tbody() ? tbody().children.length : 0, 0);
  assert.equal(dom.$('qd-ready').hidden, true);
  assert.equal(dom.$('qd-cell').hidden, true);
  assert.equal(dom.$('qd-comp-btn').textContent, 'Escolha o mês');
  void load;
});

test('exportar CSV: cabeçalho, uma linha por aluno filtrado e células seguras', async () => {
  const rows = ROWS();
  rows[0].nome = '=SOMA(A1)';
  const { dom, downloads, load } = setup(() => ok(DATA({ alunos: rows })));
  await load();
  dom.click('qd-csv');
  assert.equal(downloads.length, 1);
  assert.match(downloads[0][0], /^quadro-pagamentos-jul-26-set-26|^quadro-pagamentos-/);
  const lines = downloads[0][1].replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Aluno;Família;Status;jul/26;ago/26;set/26;Pagos;Pendentes;Pago até');
  assert.equal(lines.length, 4, 'cabeçalho + 3 alunos ativos');
  assert.match(lines.find((l) => l.includes('SOMA')), /^'=SOMA\(A1\)/);
  assert.match(lines.find((l) => l.includes('Daniela')), /Sem registro;Sem registro;Sem registro/);
});

test('nada do servidor entra como HTML (nome com tag aparece como texto)', async () => {
  const rows = ROWS();
  rows[1].nome = '<img src=x onerror=alert(1)>';
  const { names, load } = setup(() => ok(DATA({ alunos: rows })));
  await load();
  assert.ok(names().includes('<img src=x onerror=alert(1)>'));
});
