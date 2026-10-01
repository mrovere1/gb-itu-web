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
