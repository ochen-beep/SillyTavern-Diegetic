// tests/migrate.test.mjs — миграции: legacy-фенсы в extra, перенос ключей
// хранилища send_date → dg_id:слот.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasOwnBlock, stripOwnBlocks, extractLegacyArtifacts } from '../src/migrate.js';

test('hasOwnBlock: детект ```html-фенса', () => {
    assert.equal(hasOwnBlock('текст\n\n```html\n<body>x</body>\n```\n\nещё'), true);
    assert.equal(hasOwnBlock('текст\n\n```js\nlet a=1;\n```'), false);
    assert.equal(hasOwnBlock('просто проза'), false);
});

test('stripOwnBlocks: фенсы вырезаны, стыки схлопнуты', () => {
    const out = stripOwnBlocks('Абзац один.\n\n```html\n<body>x</body>\n```\n\n\n\nАбзац два.');
    assert.equal(out, 'Абзац один.\n\nАбзац два.');
});

test('extractLegacyArtifacts: pos = индекс абзаца перед фенсом', () => {
    const text = 'Первый.\n\nВторой.\n\n```html\n<body>a</body>\n```\n\nТретий.\n\n```html\n<body>b</body>\n```';
    const arts = extractLegacyArtifacts(text);
    assert.equal(arts.length, 2);
    assert.equal(arts[0].pos, 1, 'фенс после второго абзаца');
    assert.equal(arts[1].pos, 2);
    assert.equal(arts[0].html, '<body>a</body>');
    assert.equal(arts[0].status, 'ok');
    assert.equal(arts[0].anchor, '', 'якорь из текста не восстановить — позиционная вставка');
});

test('extractLegacyArtifacts: без фенсов — пусто', () => {
    assert.deepEqual(extractLegacyArtifacts('проза без блоков'), []);
});
