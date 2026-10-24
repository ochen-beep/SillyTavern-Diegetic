// tests/contract.test.mjs — машинный контракт и сборка промпта: контракт
// вставляется ровно один раз, задача — первой строкой.
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

test('контракт описывает только технический протокол', () => {
  assert.match(DIEGETIC_CONTRACT, /Return exactly \{\{MAX_COUNT\}\} artifact/iu);
  assert.match(DIEGETIC_CONTRACT, /exactly the keys "type" and "anchor"/iu);
  assert.match(DIEGETIC_CONTRACT, /one ```html fenced block per artifact/iu);
  assert.match(DIEGETIC_CONTRACT, /verbatim 2–6-word phrase/iu);
  assert.match(DIEGETIC_CONTRACT, /use "" if no suitable anchor/iu);
  assert.doesNotMatch(DIEGETIC_CONTRACT, /MANDATORY|Refusal is not allowed|retelling|physical object/iu);
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

test('контракт сохраняет сигнатуру и защищает границы парсера', () => {
    assert.match(DIEGETIC_CONTRACT, /^### TOOL — DIEGETIC HTML \(response contract\)/u);
    assert.match(DIEGETIC_CONTRACT, /Do not place .*inside the artifact HTML/iu);
    assert.match(DIEGETIC_CONTRACT, /Return the artifact pair\(s\) only/iu);
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

// ── Reasoning RP-модели не должен утекать в промпт артефакта ──
// Регрессия «получаю перепечатанный пост вместо артефакта»: пост приходит
// с <think>-блоком RP-модели, модель артефакта читала его как задачу
// «очисти текст от think» и пересказывала пост.

import { stripReasoning } from '../src/contract.js';

test('stripReasoning: закрытый <think> вырезается, проза целая', () => {
    const post = '<think>\n1. Камера и голос (POV): Анри...\n</think>**18 августа 1147 года**\n\nПроза.';
    assert.equal(stripReasoning(post), '**18 августа 1147 года**\n\nПроза.');
});

test('stripReasoning: незакрытый <think> после текста срезается до конца', () => {
    const post = 'До Think текст.\n<think>мысли оборвались на полуслове';
    assert.equal(stripReasoning(post), 'До Think текст.');
});

test('stripReasoning: сиротский <think> в самом начале не стирает весь пост', () => {
    // Регрессия: ST выносит reasoning в extra.reasoning, оставляя открывающий
    // <think> в начале mes без </think>. Срез до конца давал пустой <post>.
    const post = '<think>**12 июня 1025 года**\n\nПодъем к западным амбарам шел по пологой дуге.';
    assert.equal(stripReasoning(post), '**12 июня 1025 года**\n\nПодъем к западным амбарам шел по пологой дуге.');
});

test('stripReasoning: несколько блоков и без think не меняет текст', () => {
    assert.equal(stripReasoning('<think>a</think>mid<think>b</think>end'), 'midend');
    assert.equal(stripReasoning('обычный пост'), 'обычный пост');
    assert.equal(stripReasoning(''), '');
});

test('assemblePromptParts: пост обёрнут в <post>, хвост — напоминание задачи', () => {
    const { user } = assemblePromptParts({
        templateText: 'T {{CONTRACT}}',
        postText: '<think>рассуждения</think>Текст поста.',
        maxCount: 1,
    });
    assert.ok(!user.includes('рассуждения'), 'reasoning не утекает в user');
    assert.match(user, /<post>\nТекст поста\.\n<\/post>/);
    assert.match(user, /Respond ONLY with the artifact pair/);
    assert.match(user, /Do not retell, clean up or reformat/);
    assert.match(user, /Prefer a context-specific living object or environment with causal, tactile interaction/);
});

test('assemblePromptParts: напоминание на английском (кириллицы нет в служебных строках)', () => {
    const { user } = assemblePromptParts({ templateText: 'x', postText: 'Текст.', maxCount: 1 });
    const tail = user.slice(user.indexOf('</post>'));
    assert.ok(!/\p{Script=Cyrillic}/u.test(tail), 'служебное напоминание — только английский');
});

test('контракт показывает ровно одну пару и закрытый fence', () => {
    const example = DIEGETIC_CONTRACT.slice(DIEGETIC_CONTRACT.indexOf('For each artifact'));
    assert.match(example, /<!--DIEGETIC \{"type":"<type>","anchor":"<anchor>"\}-->/);
    assert.match(example, /```html\n<html>\.\.\.<body>\.\.\.<\/body>\.\.\.<\/html>\n```/);
});

test('assemblePromptParts: задача — первой строкой user-сообщения', () => {
    const withCtx = assemblePromptParts({ templateText: 'T {{CONTRACT}}', postText: 'P', contextBlock: 'ctx', maxCount: 2 });
    assert.match(withCtx.user, /^TASK: Design new diegetic HTML object/);
    assert.ok(!/Create \d+ artifact pair/.test(withCtx.user), 'количество не дублируется в user — дубль провоцировал «нарежь пост на части»');
    assert.ok(!/from the post at the bottom/.test(withCtx.user), '«from the post» читалось как «переработай пост»');
    assert.match(withCtx.user, /Post \(the artifact target\):/);
    const noCtx = assemblePromptParts({ templateText: 'T', postText: 'P', maxCount: 1 });
    assert.match(noCtx.user, /^TASK: Design new diegetic HTML object/);
});
