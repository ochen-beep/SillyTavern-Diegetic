// tests/digest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDigest, isViableMessageText, MIN_POST_LENGTH } from '../src/digest.js';

test('contentDigest: 8 hex chars, stable', () => {
  const d1 = contentDigest('Привет, мир');
  const d2 = contentDigest('Привет, мир');
  assert.match(d1, /^[0-9a-f]{8}$/);
  assert.equal(d1, d2);
});

test('contentDigest: NFC-normalizes (комбинированная == прекомпозированная ё)', () => {
  assert.equal(contentDigest('е\u0308'), contentDigest('ё'));
});

test('contentDigest: empty → empty string', () => {
  assert.equal(contentDigest(''), '');
  assert.equal(contentDigest(null), '');
});

test('isViableMessageText: отсекает пустое, "..." и короче минимума', () => {
  assert.equal(isViableMessageText(''), false);
  assert.equal(isViableMessageText('   '), false);
  assert.equal(isViableMessageText('...'), false);
  assert.equal(isViableMessageText('ок'), false);
  assert.equal(isViableMessageText('а'), false);
  assert.equal(MIN_POST_LENGTH >= 4, true);
  assert.equal(isViableMessageText('Она молча кивнула и вышла.'), true);
});
