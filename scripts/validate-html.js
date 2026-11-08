#!/usr/bin/env node
// Validador de estrutura do HTML, sem dependências: tags balanceadas e ids únicos.
// Motivo: o index.html já teve duas tags de fechamento faltando. O navegador "conserta" sozinho e o defeito
// passa despercebido — inclusive mudando onde os drawers ficam no DOM. Isso roda no validate.sh e nos testes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);

function tagEnd(source, from) {
  let quote = null;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** Devolve a lista de problemas encontrados (vazia quando está tudo certo). */
export function validateHtml(source) {
  const errors = [];
  const stack = [];
  const ids = new Map();
  const text = String(source == null ? '' : source);
  let i = 0;

  while ((i = text.indexOf('<', i)) !== -1) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<!', i)) {
      const end = tagEnd(text, i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    const end = tagEnd(text, i);
    if (end === -1) break;
    const raw = text.slice(i, end + 1);
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*)$/.exec(raw);
    i = end + 1;
    if (!m) continue;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = m[3];
    const selfClosing = /\/\s*>$/.test(raw);

    if (closing) {
      if (VOID.has(name)) { errors.push(`</${name}> não é uma tag de fechamento válida`); continue; }
      const index = stack.map((e) => e.name).lastIndexOf(name);
      if (index === -1) { errors.push(`</${name}> sem abertura correspondente`); continue; }
      const fechados = stack.splice(index);
      fechados.slice(0, -1).forEach((e) => {
        errors.push(`<${e.name}${e.id ? ' id=' + e.id : ''}> (linha ${e.line}) fechado implicitamente por </${name}>`);
      });
      continue;
    }

    const idm = /\sid\s*=\s*"([^"]*)"/.exec(attrs);
    if (idm) {
      const id = idm[1];
      if (ids.has(id)) errors.push(`id duplicado: "${id}" (linhas ${ids.get(id)} e ${lineOf(text, i)})`);
      else ids.set(id, lineOf(text, i));
    }
    if (VOID.has(name) || selfClosing) continue;
    stack.push({ name, id: idm ? idm[1] : '', line: lineOf(text, i) });

    if (RAW.has(name)) {
      const close = text.toLowerCase().indexOf('</' + name, i);
      if (close === -1) { errors.push(`<${name}> sem fechamento`); break; }
      i = close;
    }
  }

  stack.forEach((e) => errors.push(`<${e.name}${e.id ? ' id=' + e.id : ''}> (linha ${e.line}) nunca foi fechado`));
  return errors;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || 'index.html';
  const errors = validateHtml(readFileSync(file, 'utf8'));
  if (errors.length) {
    errors.forEach((e) => console.error(`${file}: ${e}`));
    process.exit(1);
  }
  console.log(`OK: ${file} com tags balanceadas e ids únicos.`);
}
