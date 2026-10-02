// Dados 100% fictícios do painel completo, compartilhados pelos testes.
export const ok = (data) => ({ ok: true, data, error: null, correlationId: 'c1' });
export const flat = (t) => String(t).replace(/\s/g, ' ');
export const ind = (id, titulo, extra = {}) => ({
  id, titulo, estado: 'aguardando', formato: 'inteiro', valor: null, secundario: null,
  mensagem: 'Aguardando importação das mensalidades', ajuda: 'Como se calcula ' + id, detalhe: null, ...extra,
});

export const ATIVOS = [
  { student_id: 'ALU-1', nome: 'Bruno Ficticio' },
  { student_id: 'ALU-2', nome: 'Ana Ficticia' },
  { student_id: 'ALU-3', nome: 'Érica Ficticia' },
];
export const INADIMPLENTES = [
  { student_id: 'ALU-2', nome: 'Ana Ficticia', info: { competencia: '2026-09', vencimento: '2026-09-28', valor: 250, telefone: '(11) 90000-0001' } },
  { student_id: 'ALU-1', nome: 'Bruno Ficticio', info: { competencia: '2026-08', vencimento: '2026-07-20', valor: 200 } },
  { student_id: 'ALU-3', nome: 'Érica Ficticia', info: { competencia: '2026-09', vencimento: '2026-10-01', valor: 180, telefone: '(11) 90000-0003' } },
  { student_id: 'ALU-4', nome: 'Diego Ficticio', info: { competencia: '2026-09', vencimento: '2026-09-02', valor: 230 } },
];
export const A_VENCER = [
  { student_id: 'ALU-2', nome: 'Ana Ficticia', info: { competencia: '2026-10', vencimento: '2026-10-05', valor: 250 } },
  { student_id: 'ALU-1', nome: 'Bruno Ficticio', info: { competencia: '2026-10', vencimento: '2026-10-09', valor: 200 } },
];
export const RECEBIDOS = [
  { student_id: 'ALU-1', nome: 'Bruno Ficticio', data: '2026-10-02', valor: 200, forma: 'PIX' },
  { student_id: 'ALU-3', nome: 'Érica Ficticia', data: '2026-10-03', valor: 600, forma: 'Crédito' },
  { student_id: 'ALU-2', nome: 'Ana Ficticia', data: '2026-10-01', valor: 250, forma: 'PIX' },
];
export const MATRICULAS = [{ student_id: 'ALU-5', nome: 'Fábio Ficticio', data_matricula: '03/10/2026' }];

export const ADMIN = {
  escola: 'Gracie Barra Itu', ambiente: 'production', usuario: { nome: 'Admin', perfil: 'Administrador' },
  alunosPorStatus: [{ status: 'Ativo', total: 3 }], totalAlunos: 4,
  atualizadoEm: '2026-10-05T15:00:00.000Z', atualizadoEmLocal: '05/10/2026 12:00:00',
  presenca: { fonte: 'physical_card', aviso: 'Presença por cartões.' },
  completo: true, competencia: '2026-10', hoje: '2026-10-05', avisos: [], aniversariantesEstado: 'ok',
  indicadores: {
    principais: [
      ind('alunosAtivos', 'Alunos ativos', { estado: 'ok', valor: 3, secundario: 'de 4 cadastrados', mensagem: null, detalhe: 'alunosAtivos' }),
      ind('inadimplentes', 'Inadimplentes', { estado: 'ok', valor: 4, secundario: 'R$ 860,00 em aberto', mensagem: null, detalhe: 'inadimplentes' }),
      ind('receitaRecebida', 'Receita recebida', { estado: 'ok', formato: 'moeda', valor: 1050, secundario: '3 pagamentos', mensagem: null, detalhe: 'receitaRecebida', delta: { pct: 9.3, sentido: 'alta-boa' }, anterior: { rotulo: 'set/26', valor: 960.6 } }),
      ind('resultadoMensal', 'Resultado mensal', { formato: 'moeda', mensagem: 'Aguardando módulo financeiro' }),
    ],
    complementares: [
      ind('contasAVencer', 'Contas a vencer', { estado: 'ok', valor: 2, secundario: 'R$ 450,00 nos próximos 7 dias', mensagem: null, detalhe: 'contasAVencer' }),
      ind('novasMatriculas', 'Novas matrículas', { estado: 'ok', valor: 1, secundario: null, mensagem: null, detalhe: 'novasMatriculas', delta: { pct: -50, sentido: 'alta-boa' }, anterior: { rotulo: 'set/26', valor: 2 } }),
      ind('leads', 'Leads', { estado: 'nao_configurado', mensagem: 'Módulo ainda não configurado' }),
    ],
  },
  graficos: {
    situacaoAlunos: { estado: 'ok', itens: [{ status: 'Experimental', total: 0 }, { status: 'Ativo', total: 3 }, { status: 'Inativo', total: 1 }] },
    receitaPrevistaRecebida: {
      estado: 'ok', variacao: 9.3,
      meses: [
        { competencia: '2026-05', prevista: 22000, recebida: 16800 }, { competencia: '2026-06', prevista: 24900, recebida: 12500 },
        { competencia: '2026-07', prevista: 25100, recebida: 5400 }, { competencia: '2026-08', prevista: 24500, recebida: 5000 },
        { competencia: '2026-09', prevista: 23500, recebida: 5500 }, { competencia: '2026-10', prevista: 1000, recebida: 1050 },
      ],
      mes: { previsto: 1000, recebido: 1050, pacote: 200, aVencer: 450, emAberto: 860 },
    },
    ocupacaoTurmas: { estado: 'aguardando', mensagem: 'Aguardando lançamento das presenças' },
  },
  aniversariantes: [
    { student_id: 'ALU-2', nome: 'Ana Maria Ficticia', dia: 5, mes: 10, idade: 11, hoje: true, proximos: false },
    { student_id: 'ALU-1', nome: 'Bruno Ficticio', dia: 9, mes: 10, idade: 36, hoje: false, proximos: true },
    { student_id: 'ALU-3', nome: 'Carla', dia: 28, mes: 10, idade: null, hoje: false, proximos: false },
  ],
  detalhes: { alunosAtivos: ATIVOS, novasMatriculas: MATRICULAS, inadimplentes: INADIMPLENTES, contasAVencer: A_VENCER, receitaRecebida: RECEBIDOS },
};
