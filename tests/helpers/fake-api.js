// API falsa com respostas controladas pelo teste (para exercitar ordem de chegada e respostas atrasadas).
import { flush } from './dom-env.js';

export const okEnv = (data) => ({ ok: true, data, error: null, correlationId: 'c-ok' });
export const failEnv = (code, message = 'Falha', fields) => ({
  ok: false, data: null, error: fields ? { code, message, fields } : { code, message }, correlationId: 'c-fail',
});
export const transportError = (kind) => Object.assign(new Error('transporte ' + kind), { name: 'TransportError', kind });

export function createFakeApi() {
  const calls = [];
  const api = {
    call(acao, args = []) {
      return new Promise((resolve, reject) => {
        calls.push({ acao, args: JSON.parse(JSON.stringify(args)), resolve, reject });
      });
    },
  };
  const last = () => calls[calls.length - 1];
  return {
    api, calls, last,
    byAcao: (acao) => calls.filter((c) => c.acao === acao),
    async resolve(value, call = last()) { call.resolve(value); await flush(); },
    async reject(error, call = last()) { call.reject(error); await flush(); },
  };
}
