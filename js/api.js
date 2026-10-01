// Transporte para a API (Apps Script). Respostas do servidor, mesmo de erro, voltam no envelope e NÃO lançam;
// só falhas de transporte lançam TransportError, cuja mensagem já é o texto para o usuário.

export const TRANSPORT_MESSAGES = Object.freeze({
  timeout: 'O servidor demorou para responder. Verifique a conexão e tente novamente.',
  network: 'Não foi possível contatar o servidor. Verifique a conexão e tente novamente.',
  'invalid-response': 'O servidor respondeu de forma inesperada. Tente novamente em instantes.',
});

export class TransportError extends Error {
  constructor(kind) {
    super(TRANSPORT_MESSAGES[kind] || TRANSPORT_MESSAGES.network);
    this.name = 'TransportError';
    this.kind = kind;
  }
}

const NOT_AUTHENTICATED = Object.freeze({
  ok: false,
  data: null,
  error: Object.freeze({ code: 'NAO_AUTENTICADO', message: 'Sessão inválida ou expirada. Entre novamente.' }),
  correlationId: null,
});

/**
 * deps: { apiUrl, timeoutMs, fetch, getIdToken(force) -> Promise<string|null>, AbortController, setTimeout, clearTimeout }
 * call(acao, args): em NAO_AUTENTICADO renova o token UMA vez e repete; sem token nunca chama a rede.
 */
export function createApi(deps) {
  async function post(acao, args, token) {
    const controller = new deps.AbortController();
    const timer = deps.setTimeout(() => controller.abort(), deps.timeoutMs);
    try {
      const resp = await deps.fetch(deps.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ acao, token, args }),
        signal: controller.signal,
        redirect: 'follow',
      });
      let text;
      try {
        text = await resp.text();
      } catch (e) {
        throw new TransportError(controller.signal.aborted ? 'timeout' : 'network');
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch (e) {
        throw new TransportError('invalid-response');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.ok !== 'boolean') {
        throw new TransportError('invalid-response');
      }
      return body;
    } catch (e) {
      if (e && e.name === 'TransportError') throw e;
      throw new TransportError(controller.signal.aborted ? 'timeout' : 'network');
    } finally {
      deps.clearTimeout(timer);
    }
  }

  async function token(force) {
    try {
      return await deps.getIdToken(force);
    } catch (e) {
      throw new TransportError('network');
    }
  }

  async function call(acao, args = []) {
    const first = await token(false);
    if (!first) return NOT_AUTHENTICATED;
    let body = await post(acao, args, first);
    if (!body.ok && body.error && body.error.code === 'NAO_AUTENTICADO') {
      const renewed = await token(true);
      if (renewed) body = await post(acao, args, renewed);
    }
    return body;
  }

  return { call };
}
