// DOM mínimo para os testes: ids e estado inicial `hidden` vêm do index.html real; getElementById devolve null
// para id inexistente (como no navegador), então qualquer id usado pelo código e ausente da página quebra o teste.
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const PAGE = {};
for (const m of HTML.matchAll(/<([a-z0-9]+)\b[^>]*>/gi)) {
  const id = /\sid="([^"]+)"/.exec(m[0]);
  if (id) PAGE[id[1]] = { tag: m[1].toLowerCase(), hidden: /\shidden(\s|>|=|\/)/.test(m[0]) };
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));

export function createDom() {
  const els = {};
  const docListeners = {};

  function make(id, tag) {
    const listeners = {};
    const attrs = {};
    return {
      id, tag, hidden: false, value: '', checked: false, disabled: false, selectedIndex: 0, max: '', label: '', type: '',
      className: '', children: [], options: [], listeners, attrs, focused: 0, _t: '',
      set textContent(v) {
        this._t = String(v);
        if (v === '') { this.children = []; if (tag === 'select') this.options = []; }
      },
      get textContent() { return this._t; },
      appendChild(c) { this.children.push(c); if (tag === 'select') this.options.push(c); return c; },
      addEventListener(ev, fn) { listeners[ev] = fn; },
      focus() { this.focused += 1; },
      setAttribute(k, v) { attrs[k] = String(v); },
      removeAttribute(k) { delete attrs[k]; },
      getAttribute(k) { return attrs[k] === undefined ? null : attrs[k]; },
    };
  }

  const getElementById = (id) => {
    if (!PAGE[id]) return null;
    if (!els[id]) {
      els[id] = make(id, PAGE[id].tag);
      els[id].hidden = PAGE[id].hidden;
      if (id === 'students-status') els[id].options.push({ value: '' }); // opção "Todos" já vem no HTML
      if (id === 'f-graus') els[id].options.push({ value: '0' });
    }
    return els[id];
  };

  const doc = {
    hidden: false,
    getElementById,
    createElement: (tag) => make('novo-' + tag, tag),
    addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
  };

  return {
    doc,
    $: getElementById,
    click: (id) => getElementById(id).listeners.click(),
    submit(id) {
      let prevented = false;
      getElementById(id).listeners.submit({ preventDefault() { prevented = true; } });
      return prevented;
    },
    docEvent: (ev) => (docListeners[ev] || []).forEach((fn) => fn({})),
    docListeners,
    visible: (ids) => ids.filter((i) => !getElementById(i).hidden),
  };
}
