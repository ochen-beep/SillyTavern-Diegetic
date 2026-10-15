// tests/images.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseImageSlots, parseSlotValue, hasPendingSlots, setSlotState,
    injectSlotImage, replaceSlotImage, publicImageSrc,
} from '../src/images.js';

const SLOT = '<div class="photo" data-dg-img="img: a cat on a windowsill" style="position:relative;height:120px"><b>ph</b></div>';

test('parseSlotValue: trigger + описание', () => {
    assert.deepEqual(parseSlotValue('selfie: girl at sunset'), { trigger: 'selfie', desc: 'girl at sunset' });
});

test('parseSlotValue: без триггера — всё описание', () => {
    assert.deepEqual(parseSlotValue('a cat'), { trigger: null, desc: 'a cat' });
});

test('parseSlotValue: ё нормализуется, регистр схлопывается', () => {
    assert.equal(parseSlotValue('СЁЛФИ: x').trigger, 'селфи');
});

test('parseSlotValue: пустое значение и пустое описание → null', () => {
    assert.equal(parseSlotValue(''), null);
    assert.equal(parseSlotValue('img:  '), null);
});

test('parseImageSlots: один слот, порядковый номер и состояние', () => {
    const slots = parseImageSlots(`<body>${SLOT}</body>`);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].ordinal, 0);
    assert.equal(slots[0].trigger, 'img');
    assert.equal(slots[0].desc, 'a cat on a windowsill');
    assert.equal(slots[0].state, null);
});

test('parseImageSlots: несколько слотов по порядку, чужие теги не мешают', () => {
    const html = `<body><p>hi</p>${SLOT}<span data-dg-img="scene: city at night"></span></body>`;
    const slots = parseImageSlots(html);
    assert.deepEqual(slots.map(s => s.trigger), ['img', 'scene']);
    assert.deepEqual(slots.map(s => s.ordinal), [0, 1]);
});

test('parseImageSlots: ">" внутри другого атрибута слот не ломает', () => {
    const html = `<div style="content:'>'" data-dg-img="img: still life"></div>`;
    const slots = parseImageSlots(html);
    assert.equal(slots.length, 1);
    assert.equal(slots[0].desc, 'still life');
});

test('parseImageSlots: текст без слотов → []', () => {
    assert.deepEqual(parseImageSlots('<body><p>ничего</p></body>'), []);
    assert.deepEqual(parseImageSlots(null), []);
});

test('hasPendingSlots: нет состояния или error → ждёт; done → нет', () => {
    assert.ok(hasPendingSlots(`<body>${SLOT}</body>`));
    assert.ok(hasPendingSlots('<div data-dg-img="img: x" data-dg-img-state="error"></div>'));
    assert.ok(!hasPendingSlots('<div data-dg-img="img: x" data-dg-img-state="done"></div>'));
});

test('setSlotState: добавляет атрибут в тег слота', () => {
    const out = setSlotState(`<body>${SLOT}</body>`, 0, 'loading');
    assert.match(out, /data-dg-img-state="loading"/);
    assert.ok(out.includes('<b>ph</b>'), 'содержимое слота не тронуто');
});

test('setSlotState: заменяет существующее состояние, null — снимает атрибут', () => {
    const loading = setSlotState(SLOT, 0, 'loading');
    const done = setSlotState(loading, 0, 'done');
    assert.match(done, /data-dg-img-state="done"/);
    assert.ok(!done.includes('loading'));
    const cleared = setSlotState(done, 0, null);
    assert.ok(!cleared.includes('data-dg-img-state'));
});

test('setSlotState: нет такого ordinal — текст как есть', () => {
    const html = `<body>${SLOT}</body>`;
    assert.equal(setSlotState(html, 5, 'error'), html);
});

test('injectSlotImage: img и кнопка — первые дети слота, состояние done, src с ведущим слэшем', () => {
    const out = injectSlotImage(`<body>${SLOT}</body>`, 0, 'user/images/URIS/cat.png', 'card-1');
    assert.ok(out);
    assert.match(out, /data-dg-img-state="done"/);
    assert.match(out, /<img class="dg-slot-img" data-dg-card="card-1" src="\/user\/images\/URIS\/cat\.png"/);
    assert.match(out, /<span class="dg-slot-regen" data-ordinal="0"/);
    // img вставлен сразу после открывающего тега — до плейсхолдера
    assert.ok(out.indexOf('dg-slot-img') < out.indexOf('<b>ph</b>'));
});

test('injectSlotImage: нет слота → null', () => {
    assert.equal(injectSlotImage('<body></body>', 0, 'user/images/x.png'), null);
});

test('replaceSlotImage: меняет src и card, сохраняет плейсхолдер и кнопку', () => {
    const filled = injectSlotImage(`<body>${SLOT}</body>`, 0, 'user/images/URIS/old.png', 'card-old');
    const out = replaceSlotImage(filled, 0, 'user/images/URIS/new.png', 'card-new');
    assert.ok(out);
    assert.ok(out.includes('src="/user/images/URIS/new.png"'));
    assert.ok(out.includes('data-dg-card="card-new"'));
    assert.ok(!out.includes('old.png'));
    assert.ok(!out.includes('card-old'));
    assert.ok(out.includes('<b>ph</b>'));
    assert.match(out, /data-dg-img-state="done"/);
    // ровно один img: замена, а не вставка второго
    assert.equal(out.split('dg-slot-img').length - 1, 1);
});

test('replaceSlotImage: слот без img → null (фолбэк на inject)', () => {
    assert.equal(replaceSlotImage(`<body>${SLOT}</body>`, 0, 'user/images/x.png'), null);
});

test('хирургия не меняет число слотов: ordinal стабилен между записями', () => {
    const html = `<body>${SLOT}<span data-dg-img="scene: night city"></span></body>`;
    const filled = injectSlotImage(html, 0, 'user/images/URIS/a.png');
    const slots = parseImageSlots(filled);
    assert.deepEqual(slots.map(s => s.ordinal), [0, 1]);
    assert.equal(slots[0].state, 'done');
    assert.equal(slots[1].state, null);
    assert.equal(slots[1].desc, 'night city');
});

test('publicImageSrc: ведущий слэш, мусорные слэши схлопываются', () => {
    assert.equal(publicImageSrc('user/images/a.png'), '/user/images/a.png');
    assert.equal(publicImageSrc('//user/images/a.png'), '/user/images/a.png');
    assert.equal(publicImageSrc(''), '');
});
