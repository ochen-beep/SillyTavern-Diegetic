import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIEGETIC_CONTRACT, assemblePrompt, assemblePromptParts } from '../src/contract.js';
import { parseDiegeticResponse } from '../src/parser.js';

test('контракт содержит ключевые правила формата', () => {
    assert.match(DIEGETIC_CONTRACT, /<!--DIEGETIC/);
    assert.match(DIEGETIC_CONTRACT, /anchor/);
    assert.match(DIEGETIC_CONTRACT, /```html/);
    assert.match(DIEGETIC_CONTRACT, /<body/);
});

test('контракт приказывает делать артефакт, а не решать, делать ли', () => {
  // Требование: универсальный шаблон = команда. Никаких лазеек «импульса нет».
  assert.ok(!/pulse/i.test(DIEGETIC_CONTRACT), 'в контракте не должно быть слова pulse вовсе');
  assert.match(DIEGETIC_CONTRACT, /ОБЯЗАТЕЛЕН/u);
  assert.match(DIEGETIC_CONTRACT, /Отказ недопустим/u);
});

test('universal.md — императивный шаблон без отказных формулировок', () => {
  const lens = readFileSync(new URL('../templates/universal.md', import.meta.url), 'utf8');
  assert.ok(!/pulse:?false|"pulse":\s*false/u.test(lens), 'шаблон не должен предлагать pulse:false');
  assert.ok(!/не выдумывай|если импульса нет/iu.test(lens), 'шаблон не должен содержать отказных формулировок');
  assert.match(lens, /ПО КАЖДОМУ ПОСТУ/u);
  assert.match(lens, /это приказ, а не вопрос/u);
  assert.match(lens, /Никогда не отказывайся/u);
  assert.match(lens, /\{\{CONTRACT\}\}/u);
});

test('assemblePrompt подставляет {{CONTRACT}} и {{MAX_COUNT}}', () => {
    const p = assemblePrompt({ templateText: 'Шаблон.\n{{CONTRACT}}', postText: 'ПОСТ', maxCount: 3 });
    assert.ok(!p.includes('{{CONTRACT}}'));
    assert.ok(p.includes('не более 3'));
    assert.ok(p.includes('ПОСТ'));
});

test('assemblePrompt: контекст идёт перед постом', () => {
    const p = assemblePrompt({ templateText: 'x{{CONTRACT}}', postText: 'ПОСТ', contextBlock: 'РАННЕЕ', maxCount: 1 });
    assert.ok(p.indexOf('РАННЕЕ') < p.indexOf('ПОСТ'));
});

test('assemblePrompt: шаблон без маркера — контракт всё равно добавлен', () => {
    const p = assemblePrompt({ templateText: 'просто шаблон', postText: 'P', maxCount: 1 });
    assert.ok(p.includes('<!--DIEGETIC'));
});

test('assemblePromptParts: system = шаблон+контракт, user = пост; контекст перед постом', () => {
    const parts = assemblePromptParts({ templateText: 'Шаблон.\n{{CONTRACT}}', postText: 'ПОСТ', contextBlock: 'РАННЕЕ', maxCount: 2 });
    assert.ok(!parts.system.includes('{{CONTRACT}}'));
    assert.match(parts.system, /не более 2/);
    assert.ok(parts.system.includes('Шаблон.'));
    assert.ok(!parts.system.includes('ПОСТ'));
    assert.ok(!parts.user.includes('TOOL — DIEGETIC'));
    assert.ok(parts.user.indexOf('РАННЕЕ') < parts.user.indexOf('ПОСТ'));
    // assemblePrompt — те же части, склеенные: ничего не теряется
    const joined = assemblePrompt({ templateText: 'Шаблон.\n{{CONTRACT}}', postText: 'ПОСТ', contextBlock: 'РАННЕЕ', maxCount: 2 });
    assert.ok(joined.includes(parts.system) && joined.includes(parts.user));
});

test('round-trip: пара из контракта парсится чисто', () => {
  const pair = '<!--DIEGETIC {"type":"phone","anchor":"взял телефон"}-->\n```html\n<body><p>экран</p></body>\n```';
  const r = parseDiegeticResponse(pair, {});
  assert.equal(r.artifacts.length, 1);
  assert.deepEqual(r.errors, []);
});
