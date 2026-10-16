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
  assert.match(DIEGETIC_CONTRACT, /MANDATORY/iu);
  assert.match(DIEGETIC_CONTRACT, /Refusal is not allowed/iu);
});

test('промпты на английском: контракт и склейка без кириллицы', () => {
  assert.ok(!/\p{Script=Cyrillic}/u.test(DIEGETIC_CONTRACT), 'контракт — только английский');
  const p = assemblePrompt({ templateText: 'x{{CONTRACT}}', postText: 'P', maxCount: 1 });
  assert.ok(!/\p{Script=Cyrillic}/u.test(p), 'служебные строки склейки — только английский');
});

test('universal.md — императивный шаблон без отказных формулировок', () => {
  const lens = readFileSync(new URL('../templates/universal.md', import.meta.url), 'utf8');
  assert.ok(!/pulse:?false|"pulse":\s*false/u.test(lens), 'шаблон не должен предлагать pulse:false');
  assert.ok(!/не выдумывай|если импульса нет|you may skip|optional to skip/iu.test(lens), 'шаблон не должен содержать отказных формулировок');
  assert.match(lens, /mandatory/iu);
  assert.match(lens, /\{\{CONTRACT\}\}/u);
});

test('assemblePrompt подставляет {{CONTRACT}} и {{MAX_COUNT}}', () => {
    const p = assemblePrompt({ templateText: 'Шаблон.\n{{CONTRACT}}', postText: 'ПОСТ', maxCount: 3 });
    assert.ok(!p.includes('{{CONTRACT}}'));
    assert.ok(p.includes('exactly 3'));
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

test('assemblePrompt: контракт не дублируется (регрессия «дважды отправляется»)', () => {
    // Старый шаблон с контрактом, вписанным целиком и без {{CONTRACT}}:
    // повторная вставка давала два экземпляра в одном запросе.
    const legacy = 'Мои правила.\n\n### TOOL — DIEGETIC HTML (контракт ответа)\nСтарый текст контракта.';
    const p = assemblePrompt({ templateText: legacy, postText: 'P', maxCount: 1 });
    assert.equal(p.split('### TOOL — DIEGETIC HTML').length - 1, 1, 'сигнатура контракта встречается один раз');
    const parts = assemblePromptParts({ templateText: legacy, postText: 'P', maxCount: 1 });
    assert.equal(parts.system.split('### TOOL — DIEGETIC HTML').length - 1, 1);
    // С плейсхолдером — по-прежнему ровно одна вставка
    const withPlaceholder = assemblePrompt({ templateText: 'x\n{{CONTRACT}}', postText: 'P', maxCount: 1 });
    assert.equal(withPlaceholder.split('### TOOL — DIEGETIC HTML').length - 1, 1);
});

test('контракт: библиотеки не запрещены целиком — только неоправданные', () => {
    // Замечание тестеров: «без гигантских библиотек» ограничивало модель.
    assert.ok(!/гигантских библиотек|giant libraries/i.test(DIEGETIC_CONTRACT));
    assert.match(DIEGETIC_CONTRACT, /external libraries only when the medium truly requires/iu);
});

test('assemblePromptParts: system = шаблон+контракт, user = пост; контекст перед постом', () => {
    const parts = assemblePromptParts({ templateText: 'Шаблон.\n{{CONTRACT}}', postText: 'ПОСТ', contextBlock: 'РАННЕЕ', maxCount: 2 });
    assert.ok(!parts.system.includes('{{CONTRACT}}'));
    assert.match(parts.system, /exactly 2/);
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
