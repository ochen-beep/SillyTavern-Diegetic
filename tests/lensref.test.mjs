// tests/lensref.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLensText } from '../src/lensref.js';

const UNI = '# Универсальная линза\n{{CONTRACT}}';

test('resolveLensText: пусто и сентинел — встроенная линза', () => {
  assert.equal(resolveLensText('', UNI), UNI);
  assert.equal(resolveLensText('   ', UNI), UNI);
  assert.equal(resolveLensText('@universal', UNI), UNI);
  assert.equal(resolveLensText('  @universal  ', UNI), UNI);
  assert.equal(resolveLensText(null, UNI), UNI);
  assert.equal(resolveLensText(undefined, UNI), UNI);
});

test('resolveLensText: кастомный текст возвращается как есть', () => {
  assert.equal(resolveLensText('# Линза: записка\n{{CONTRACT}}', UNI), '# Линза: записка\n{{CONTRACT}}');
});

test('resolveLensText: без универсального текста пустой lensText даёт пустую строку', () => {
  assert.equal(resolveLensText('', ''), '');
});
