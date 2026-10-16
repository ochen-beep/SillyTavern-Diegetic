// tests/endpoint-policy.test.mjs — политика кастомного эндпоинта
// (форма HTML-Inserts endpoint-policy.test.mjs): нормализация, userinfo,
// plain-HTTP и allowlist по origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEndpoint, isOriginAllowed, addToAllowList } from '../src/endpoint-policy.js';

test('classifyEndpoint: пустой и битый URL отклонены', () => {
  assert.equal(classifyEndpoint('').ok, false);
  assert.equal(classifyEndpoint('   ').ok, false);
  assert.equal(classifyEndpoint('not a url').ok, false);
});

test('classifyEndpoint: только http/https', () => {
  assert.equal(classifyEndpoint('ftp://x/v1').ok, false);
  assert.equal(classifyEndpoint('ws://x/v1').ok, false);
});

test('classifyEndpoint: учётные данные в URL запрещены', () => {
  assert.equal(classifyEndpoint('https://user:pass@api.example.com/v1').ok, false);
  assert.equal(classifyEndpoint('https://user@api.example.com/v1').ok, false);
});

test('classifyEndpoint: нормализация хвостов до .../v1/chat/completions', () => {
  const a = classifyEndpoint('https://api.example.com');
  const b = classifyEndpoint('https://api.example.com/');
  const c = classifyEndpoint('https://api.example.com/v1');
  const d = classifyEndpoint('https://api.example.com/v1/chat/completions');
  assert.ok(a.ok && b.ok && c.ok && d.ok);
  assert.equal(a.normalized, 'https://api.example.com/v1/chat/completions');
  assert.equal(b.normalized, a.normalized);
  assert.equal(c.normalized, a.normalized);
  assert.equal(d.normalized, a.normalized);
});

test('classifyEndpoint: query сохраняется, hash отбрасывается', () => {
  const r = classifyEndpoint('https://api.example.com/v1?x=1#frag');
  assert.ok(r.ok);
  assert.equal(r.normalized, 'https://api.example.com/v1/chat/completions?x=1');
});

test('classifyEndpoint: kind — https / loopback-http / insecure-http', () => {
  assert.equal(classifyEndpoint('https://api.example.com/v1').kind, 'https');
  assert.equal(classifyEndpoint('http://localhost:5000/v1').kind, 'loopback-http');
  assert.equal(classifyEndpoint('http://127.0.0.1:5000/v1').kind, 'loopback-http');
  assert.equal(classifyEndpoint('http://192.168.1.10:5000/v1').kind, 'insecure-http');
});

test('isOriginAllowed: сверка протокола, хоста и порта', () => {
  const list = ['http://192.168.1.10:5000'];
  assert.equal(isOriginAllowed('http://192.168.1.10:5000', list), true);
  assert.equal(isOriginAllowed('http://192.168.1.10:5001', list), false, 'другой порт');
  assert.equal(isOriginAllowed('https://192.168.1.10:5000', list), false, 'другой протокол');
  assert.equal(isOriginAllowed('мусор', list), false);
  assert.equal(isOriginAllowed('http://192.168.1.10:5000', null), false);
});

test('addToAllowList: без дублей, не мутирует исходник', () => {
  const orig = ['http://a:1'];
  const next = addToAllowList('http://b:2', orig);
  assert.deepEqual(next, ['http://a:1', 'http://b:2']);
  assert.deepEqual(orig, ['http://a:1']);
  assert.deepEqual(addToAllowList('http://b:2', next), next, 'дубль не добавляется');
  assert.deepEqual(addToAllowList('', orig), ['http://a:1']);
});
