import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIEGETIC_CONTRACT, assemblePrompt } from '../src/contract.js';
import { parseDiegeticResponse } from '../src/parser.js';

test('контракт содержит ключевые правила формата', () => {
    assert.match(DIEGETIC_CONTRACT, /<!--DIEGETIC/);
    assert.match(DIEGETIC_CONTRACT, /pulse/);
    assert.match(DIEGETIC_CONTRACT, /anchor/);
    assert.match(DIEGETIC_CONTRACT, /```html/);
    assert.match(DIEGETIC_CONTRACT, /<body/);
});

test('assemblePrompt подставляет {{CONTRACT}} и {{MAX_COUNT}}', () => {
    const p = assemblePrompt({ lensText: 'Линза.\n{{CONTRACT}}', postText: 'ПОСТ', maxCount: 3 });
    assert.ok(!p.includes('{{CONTRACT}}'));
    assert.ok(p.includes('не более 3'));
    assert.ok(p.includes('ПОСТ'));
});

test('assemblePrompt: контекст идёт перед постом', () => {
    const p = assemblePrompt({ lensText: 'x{{CONTRACT}}', postText: 'ПОСТ', contextBlock: 'РАННЕЕ', maxCount: 1 });
    assert.ok(p.indexOf('РАННЕЕ') < p.indexOf('ПОСТ'));
});

test('assemblePrompt: линза без маркера — контракт всё равно добавлен', () => {
    const p = assemblePrompt({ lensText: 'просто линза', postText: 'P', maxCount: 1 });
    assert.ok(p.includes('<!--DIEGETIC'));
});

test('round-trip: пара из контракта парсится чисто', () => {
  const pair = '<!--DIEGETIC {"pulse":true,"type":"phone","anchor":"взял телефон"}-->\n```html\n<body><p>экран</p></body>\n```';
  const r = parseDiegeticResponse(pair, {});
  assert.equal(r.pulse, true);
  assert.equal(r.artifacts.length, 1);
  assert.deepEqual(r.errors, []);
});

test('round-trip: литерал pulse:false из контракта → pulse false', () => {
  const r = parseDiegeticResponse('<!--DIEGETIC {"pulse":false}-->', {});
  assert.equal(r.pulse, false);
  assert.equal(r.artifacts.length, 0);
});

test('round-trip: pulse:false литерал ИЗ контракта парсится', () => {
  const m = DIEGETIC_CONTRACT.match(/<!--DIEGETIC \{"pulse":false\}-->/);
  assert.ok(m, 'в контракте обязан быть литерал pulse:false');
  const r = parseDiegeticResponse(m[0], {});
  assert.equal(r.pulse, false);
  assert.equal(r.artifacts.length, 0);
});
