# Contrato da API (Apps Script)

Fonte da verdade: `src/Router.gs`. Este documento e as fixtures em `tests/fixtures/contract/` são copiados para o repositório do portal.

## Endpoint

Uma única URL: o `/exec` da implantação do Apps Script. `GET` devolve `{ "ok": true, "servico": "gb-itu-api" }` (saúde, sem dado nenhum).

## Requisição

`POST` com `Content-Type: text/plain;charset=utf-8` (evita a checagem prévia de CORS). Corpo JSON:

```json
{ "acao": "alunos.listar", "token": "<ID token do Firebase>", "args": [ { "busca": "", "status": "" } ] }
```

- `acao`: texto, uma das ações abaixo.
- `token`: ID token do Firebase (renovado pelo SDK). Sem ele, nenhuma ação roda.
- `args`: lista de argumentos da ação (opcional, padrão `[]`).
- Limites: corpo até 32 KB; token até 4096 caracteres.

## Resposta

HTTP 200 sempre. Envelope: `{ "ok": true|false, "data": ..., "error": { "code", "message", "fields?" } | null, "correlationId": "..." }`.
`fields` (opcional, em `VALIDACAO` e `CONFLITO`): lista `{ "campo", "mensagem" }` com mensagens fixas.

## Ações

| Ação | Argumentos | Permissão |
|---|---|---|
| `sessao` | — | usuário ativo (audita LOGIN) |
| `dashboard.obter` | `[{ competencia? }]` (`AAAA-MM`, padrão: mês de hoje; só vale para `dashboard:completo`) | `dashboard:ver` (visão completa: `dashboard:completo`) |
| `mensalidades.listar` | `[{ competencia?, busca?, status? }]` | `mensalidades:ver` |
| `mensalidades.registrarPagamento` | `[chargeId, { versao, data, forma, conta?, observacao? }]` | `mensalidades:registrar` |
| `mensalidades.editarVencimento` | `[chargeId, { versao, vencimento }]` | `mensalidades:registrar` |
| `mensalidades.cancelar` | `[chargeId, { versao, motivo }]` | `mensalidades:cancelar` |
| `mensalidades.estornar` | `[paymentId, { motivo }]` | `mensalidades:cancelar` |
| `mensalidades.previaGerar` | `[{ competencia }]` | `mensalidades:registrar` |
| `mensalidades.gerar` | `[{ competencia }]` | `mensalidades:registrar` |
| `alunos.listar` | `[params]` | `alunos:listar` |
| `alunos.obter` | `[studentId]` | `alunos:listar` |
| `alunos.criar` | `[payload]` | `alunos:criar` |
| `alunos.atualizar` | `[studentId, { versao, campos, confirmarDuplicidade? }]` | `alunos:editar` |

## Códigos de erro

| Código | Quando | O que o portal faz |
|---|---|---|
| `NAO_AUTENTICADO` | token ausente, malformado, vencido, inválido, de outro projeto ou de usuário desativado | renova o token uma vez e repete; se falhar, volta ao login |
| `ACESSO_NEGADO` | autenticado, mas fora de `Usuarios`, inativo ou sem permissão | mensagem genérica; encerra a sessão se for `sessao` |
| `SERVICO_INDISPONIVEL` | Google inalcançável ou limite de consultas atingido | pede para tentar de novo |
| `VALIDACAO` | pedido ou campos inválidos | mostra os `fields` |
| `CONFLITO` | duplicidade de CPF ou de nome e nascimento | mostra os `fields`; pode pedir confirmação |
| `VERSAO_DESATUALIZADA` | o cadastro mudou desde a leitura | oferece recarregar |
| `ESTADO_INVALIDO` | a operação não cabe no estado atual (ex.: cobrança já paga) | mensagem; recarregar a lista |
| `NAO_ENCONTRADO`, `SISTEMA_OCUPADO`, `AUDITORIA_INDISPONIVEL`, `CONFIG_INVALIDA`, `SCHEMA_INVALIDO`, `PLANILHA_INDISPONIVEL`, `DADOS_INCONSISTENTES`, `ERRO_INTERNO` | ver `ErrorService.SAFE_MESSAGES` | mensagem segura + `correlationId` |

## Segurança

O endpoint é público: toda ação exige token válido e falha fechada. Token inválido nunca grava na planilha. O Apps Script não vê a origem
da página, então não há restrição por origem: a proteção é o token. Exemplos: `tests/fixtures/contract/`.

## Painel (`dashboard.obter`)

Uma única chamada devolve tudo. Todos os perfis recebem a visão básica (`escola`, `ambiente`, `usuario`, `alunosPorStatus`, `totalAlunos`,
`atualizadoEm`, `atualizadoEmLocal`, `presenca`). Quem tem `dashboard:completo` (Administrador) recebe também:
`completo: true`, `competencia`, `hoje`, `indicadores.principais[]` e `indicadores.complementares[]`, `graficos`, `aniversariantes[]` e
`detalhes` (listas dos cartões clicáveis). Competência fora de `AAAA-MM` (2020 até o ano seguinte) devolve `VALIDACAO` com `campo: competencia`.

Cada indicador: `{ id, titulo, estado, formato, valor, secundario, mensagem, ajuda, detalhe }`.
`estado` é `ok`, `aguardando` (falta dado lançado) ou `nao_configurado` (falta módulo). Fora de `ok`, `valor` é sempre `null`
e `mensagem` explica: o portal nunca mostra zero para indicador sem dado. Aniversariantes trazem só `dia`, `mes` e a idade que se completa
(nunca o ano de nascimento). Não há cache no servidor: a resposta contém nomes e é recalculada a cada chamada (uma leitura em lote de `Alunos`).

### Indicadores financeiros (D2)

Lidos de `Cobrancas`, `Pagamentos` e `Matriculas` (valores numéricos, em lote, somente leitura). Sem nenhuma cobrança real, os cartões financeiros ficam
`aguardando` ("Aguardando importação das mensalidades"); em uma competência sem lançamento nenhum, "Sem lançamentos nesta competência" (zero só aparece
quando há lançamento).

| Indicador | Regra |
|---|---|
| Receita prevista | Cobranças da competência com status `Paga`, `Pendente` ou `Coberta por pacote`. Fora: `Isenta`, `Suspensa`, `Cancelada`, aluno inexistente e `tipo_isencao = Assistente`. O secundário informa quanto é de pacote. |
| Receita recebida | Pagamentos `Confirmado` pela **data do pagamento**. Pacote entra de uma vez no mês da venda; estornos e pagamentos sem data ficam fora (sem data gera aviso). Secundário: quantidade e variação sobre o mês anterior. |
| Inadimplentes | Alunos com cobrança `Pendente` da competência, vencimento anterior a hoje, fora de pacote válido (`pago_ate` ≥ competência) e sem isenção. Cobrança sem vencimento não conta (gera aviso). |
| Contas a vencer | Cobranças `Pendente` que vencem de hoje até 7 dias (constante `DIAS_A_VENCER`), de qualquer competência. |
| Ticket médio | Receita recebida ÷ alunos distintos que pagaram na competência. Sem pagamentos: mensagem, nunca divisão por zero. |
| Alunos pagantes | Alunos `Ativo` com `valor_contratado` > 0 e sem `tipo_isencao`. |
| Gráfico | Últimos 6 meses até a competência: prevista e recebida (`meses[]`), variação do recebido sobre o mês anterior (`variacao`, %) e a composição do mês (`mes`: `previsto`, `recebido`, `pacote`, `aVencer`, `emAberto`; `null` em mês sem lançamento). O portal desenha o anel (recebido ÷ previsto), a lista da composição e as colunas comparativas. |

Cartões com comparação (`receitaPrevista`, `receitaRecebida`, `novasMatriculas`) trazem `delta` (`pct` e `sentido`: `alta-boa` ou `alta-ma`, que diz se subir é bom ou ruim) e `anterior` (`rotulo` do mês e `valor`), que o portal desenha como chip ao lado do valor e linha do período anterior; sem base anterior (zero) não há `delta`.

Campos novos na resposta completa: `avisos[]` (problemas de qualidade dos dados), `aniversariantesEstado` (`ok` ou `sem_datas`),
`graficos.receitaPrevistaRecebida.meses[]` e, em `detalhes`, as listas `inadimplentes`, `contasAVencer` (`info`: competência, vencimento, valor e, só em
inadimplentes, telefone) e `receitaRecebida` (data, valor, forma). Valores em reais como número, datas `AAAA-MM-DD`; o portal formata em pt-BR.

## Mensalidades

Perfis: ver = Administrador, Gestor e Financeiro; registrar pagamento, editar vencimento e gerar cobranças = Administrador e Financeiro; cancelar e estornar = Administrador.

- `mensalidades.listar`: cobranças da competência (padrão: mês atual) com `itens[]` (`charge_id`, `nome`, `vencimento`, `vencida`, `valor`, `status`, `versao`, `pagamento`, `acoes`), `totais` (previsto, pago, pendente, vencido), `porStatus`, `permissoes` e `opcoes`. Até 500 itens; `total` informa quantos existem.
- Cada item traz as **pendências do aluno em todas as competências** (`pendencias[]` com `competencia`, `vencimento`, `valor`, `vencida`; `pendenciasValor`, `pendenciasAnteriores` e `pendenciasAnterioresValor`, que contam só os meses antes da competência filtrada), para que a lista de um mês mostre também os meses atrasados anteriores. A resposta traz ainda `competenciaAnterior` e `totaisAnterior` (mesma estrutura de `totais`) para comparar com o mês anterior no mesmo cartão.
- Escritas devolvem o item atualizado. `versao` (concorrência otimista) é obrigatória em registrar pagamento, editar vencimento e cancelar; `VERSAO_DESATUALIZADA` pede para recarregar.
- **Pagamento é sempre integral**: o valor é o da cobrança (um `valor` diferente é recusado). A data não pode ser futura. Forma: PIX, Débito, Crédito, Dinheiro ou Misto.
- **Nada financeiro é apagado.** Cancelar muda a cobrança para `Cancelada` (só `Pendente` ou `Coberta por pacote`; paga exige estorno antes). Estornar muda o pagamento para `Estornado` e a cobrança paga volta a `Pendente`. Motivo obrigatório (3 a 200 caracteres).
- Cada operação é auditada **antes** de gravar, sob lock; se a segunda aba falhar, a primeira é desfeita.
- **Gerar cobranças** só vale para o mês atual e o próximo. Entram matrículas `Ativa` de alunos `Ativo`, com valor maior que zero e sem `tipo_isencao`; quem já tem cobrança na competência (de qualquer status) é pulado. `pago_ate` cobrindo o mês gera `Coberta por pacote`. Sem `dia_vencimento`, vale o dia padrão (`Configuracoes.dia_vencimento_padrao`, padrão 10). **Nenhuma mensagem é enviada a ninguém**: é só o registro interno.

### Área de trabalho dos cartões (portal)

Cada cartão com lista (`detalhes`) abre a sua área de trabalho em tela larga: inadimplentes, contas a vencer, receita recebida, alunos ativos e novas matrículas. Tabela ordenável (`aria-sort`), busca por nome, filtro da lista, seleção de linhas, exportação para planilha (CSV com `;`, BOM e proteção contra fórmulas) e, nos inadimplentes, quadro por faixa de atraso (1–7, 8–30, 31–60 e mais de 60 dias). O CSV é gerado no navegador (nada vai para a rede). A área de trabalho **não altera dados financeiros**: "Ver em Mensalidades" leva à aba já filtrada pelo aluno e pela competência, onde o pagamento é registrado.

## Pacote (aba Aluno Full e Mensalidades)

- `pacotes.registrar` `[studentId, { versao, modo, data, mes_inicial, meses, valor_total, forma, observacao? }]`: `modo` = `unico` ou `recorrente`; `versao` = `matricula.versao`. Resposta `{ resumo }`. Contrato completo no repositório `gb-itu` (`docs/api-contract.md`).
- `pacotes.registrarFamilia` `[familiaId, { modo, data, mes_inicial, meses, forma, observacao?, membros: [{ student_id, versao, valor_total }] }]`: um pacote para a família (cada aluno com o seu valor, mesmo código `PCT-…`; tudo ou nada). Contrato completo no repositório `gb-itu`.
- `pacotes.cancelarPrevisto` `[paymentId, { motivo }]`: cancela parcela `Previsto`. O item de `mensalidades.listar` traz `acoes.cancelarPrevisto`.
- `alunofull.listar` traz `opcoes.formas` (formas de pagamento aceitas).
