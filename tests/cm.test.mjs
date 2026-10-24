// tests/cm.test.mjs — чистая логика CM-источника: нормализация профилей,
// сообщения для sendRequest, извлечение текста из форм ответа.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCmProfiles, buildCmMessages, extractCmText, cmErrorMessage } from '../src/cm.js';

test('normalizeCmProfiles: id/name, пропуск пустых, не-массив → []', () => {
  assert.deepEqual(normalizeCmProfiles([
    { id: 'a', name: 'Alpha' },
    { name: 'Beta' },
    { id: 'c' },
    {},
    null,
  ]), [{ id: 'a', name: 'Alpha' }, { id: 'Beta', name: 'Beta' }, { id: 'c', name: 'c' }]);
  assert.deepEqual(normalizeCmProfiles(undefined), []);
  assert.deepEqual(normalizeCmProfiles('x'), []);
});

test('buildCmMessages: system + user, строковое приведение', () => {
  assert.deepEqual(buildCmMessages({ system: 'S', user: 'U' }), [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U' },
  ]);
  assert.deepEqual(buildCmMessages({}), [
    { role: 'system', content: '' },
    { role: 'user', content: '' },
  ]);
});

test('extractCmText: строка, content-блоки, choices, candidates, text/message', () => {
  assert.equal(extractCmText('привет'), 'привет');
  assert.equal(extractCmText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(extractCmText({ content: [{ type: 'text', text: 'x' }] }), 'x');
  assert.equal(extractCmText({ content: 'plain' }), 'plain');
  assert.equal(extractCmText({ choices: [{ message: { content: 'ch' } }] }), 'ch');
  assert.equal(extractCmText({ candidates: [{ content: { parts: [{ text: 'p1' }, { text: 'p2', thought: true }] } }] }), 'p1');
  assert.equal(extractCmText({ text: 't' }), 't');
  assert.equal(extractCmText({ message: 'm' }), 'm');
  assert.equal(extractCmText({ message: { content: 'mc' } }), 'mc');
});

test('extractCmText: не текст → null', () => {
  assert.equal(extractCmText(null), null);
  assert.equal(extractCmText(undefined), null);
  assert.equal(extractCmText(42), null);
  assert.equal(extractCmText({}), null);
  assert.equal(extractCmText([{ type: 'image', url: 'x' }]), null);
});

test('cmErrorMessage: cause-объект, cause-строка, e.message, сам e', () => {
  assert.equal(cmErrorMessage({ cause: { message: 'inner' } }), 'inner');
  assert.equal(cmErrorMessage({ cause: 'string-cause' }), 'string-cause');
  assert.equal(cmErrorMessage(new Error('top')), 'top');
  assert.equal(cmErrorMessage('raw'), 'raw');
});
