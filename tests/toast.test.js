import test from 'node:test';
import assert from 'node:assert/strict';
import { createToast } from '../js/toast.js';
import { createDom } from './helpers/dom-env.js';

function setup() {
  const dom = createDom();
  let fire = null;
  let cleared = 0;
  const toast = createToast({
    doc: dom.doc,
    setTimer: (fn, ms) => { fire = fn; assert.equal(ms, 5000); return 1; },
    clearTimer: () => { cleared += 1; },
  });
  return { dom, toast, fire: () => fire(), cleared: () => cleared };
}

test('toast: aparece, troca o tipo e some sozinho depois de 5 s', () => {
  const { dom, toast, fire } = setup();
  toast.show('Alterações salvas.');
  assert.equal(dom.$('toast').hidden, false);
  assert.equal(dom.$('toast').textContent, 'Alterações salvas.');
  assert.equal(dom.$('toast').getAttribute('data-kind'), 'ok');
  toast.show('Falhou.', 'error');
  assert.equal(dom.$('toast').getAttribute('data-kind'), 'error');
  fire();
  assert.equal(dom.$('toast').hidden, true);
  assert.equal(dom.$('toast').textContent, '');
});

test('toast: texto vazio esconde e limpa o temporizador anterior', () => {
  const { dom, toast, cleared } = setup();
  toast.show('Um');
  toast.show('');
  assert.equal(dom.$('toast').hidden, true);
  assert.ok(cleared() >= 1);
});

test('toast: novo aviso reinicia o relógio e não deixa o anterior apagar o novo', () => {
  const { dom, toast, fire } = setup();
  toast.show('Primeiro');
  toast.show('Segundo');
  assert.equal(dom.$('toast').textContent, 'Segundo');
  fire();
  assert.equal(dom.$('toast').hidden, true);
});
