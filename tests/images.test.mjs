// tests/images.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseImageSlots, parseSlotValue, hasPendingSlots, setSlotState,
    injectSlotImage, replaceSlotImage, publicImageSrc, urisStatus,
    setSlotPrompt, slotCardId,
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

test('injectSlotImage: img — первый ребёнок слота, состояние done, src с ведущим слэшем', () => {
    const out = injectSlotImage(`<body>${SLOT}</body>`, 0, 'user/images/URIS/cat.png', 'card-1');
    assert.ok(out);
    assert.match(out, /data-dg-img-state="done"/);
    assert.match(out, /<img class="dg-slot-img" data-dg-card="card-1" src="\/user\/images\/URIS\/cat\.png"/);
    assert.ok(!out.includes('dg-slot-regen'), 'контролы в хранилище не живут — их рисует display-патч render.js');
    // img вставлен сразу после открывающего тега — до плейсхолдера
    assert.ok(out.indexOf('dg-slot-img') < out.indexOf('<b>ph</b>'));
});

test('injectSlotImage: нет слота → null', () => {
    assert.equal(injectSlotImage('<body></body>', 0, 'user/images/x.png'), null);
});

test('replaceSlotImage: меняет src и card, сохраняет плейсхолдер', () => {
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

test('slotCardId: карточка заполненного слота, pending → null', () => {
    const filled = injectSlotImage(`<body>${SLOT}</body>`, 0, 'user/images/a.png', 'card-1');
    assert.equal(slotCardId(filled, 0), 'card-1');
    assert.equal(slotCardId(`<body>${SLOT}</body>`, 0), null);
    assert.equal(slotCardId('<body></body>', 0), null);
});

test('setSlotPrompt: переписывает значение, состояние слота не трогает', () => {
    const html = `<body>${setSlotState(SLOT, 0, 'loading')}</body>`;
    const out = setSlotPrompt(html, 0, { trigger: 'scene', desc: 'night city, rain' });
    assert.ok(out.includes('data-dg-img="scene: night city, rain"'));
    assert.ok(out.includes('data-dg-img-state="loading"'));
    const [sl] = parseImageSlots(out);
    assert.equal(sl.trigger, 'scene');
    assert.equal(sl.desc, 'night city, rain');
});

test('setSlotPrompt: без триггера — голое описание; кавычки и скобки санитизируются', () => {
    const out = setSlotPrompt(`<body>${SLOT}</body>`, 0, { trigger: null, desc: 'a "cat" <on> a & sill' });
    const [sl] = parseImageSlots(out);
    assert.equal(sl.trigger, null);
    assert.equal(sl.desc, 'a cat on a sill');
    assert.ok(!out.includes('"cat"'), 'кавычки из значения атрибута убраны');
});

test('setSlotPrompt: пустое описание или нет слота → null', () => {
    assert.equal(setSlotPrompt(`<body>${SLOT}</body>`, 0, { desc: '   ' }), null);
    assert.equal(setSlotPrompt('<body></body>', 0, { desc: 'x' }), null);
});

// ── Мост: urisStatus (панель монтируется раньше публикации globalThis.URIS) ──

const fakeBridge = ({ ready = Promise.resolve(), accepting = true, connection = { label: 'test' } } = {}) => ({
    ready,
    getStatus: async () => ({ accepting, connection }),
});

test('urisStatus: моста нет и не появляется → not available, ожидание ограничено', async () => {
    delete globalThis.URIS;
    const st = await urisStatus({ waitMs: 40, pollMs: 10 });
    assert.deepEqual(st, { available: false, accepting: false, connection: null });
});

test('urisStatus: глобал публикуется во время ожидания → available', async () => {
    delete globalThis.URIS;
    setTimeout(() => { globalThis.URIS = fakeBridge(); }, 40);
    try {
        const st = await urisStatus({ waitMs: 2000, pollMs: 15 });
        assert.equal(st.available, true);
        assert.equal(st.accepting, true);
        assert.equal(st.connection.label, 'test');
    } finally { delete globalThis.URIS; }
});

test('urisStatus: мост есть, ready отклонён → available, но не accepting', async () => {
    const ready = Promise.reject(new Error('init failed'));
    ready.catch(() => {});
    globalThis.URIS = fakeBridge({ ready });
    try {
        assert.deepEqual(await urisStatus({ waitMs: 0 }),
            { available: true, accepting: false, connection: null });
    } finally { delete globalThis.URIS; }
});

test('urisStatus: ready висит → по таймауту available, но не accepting', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.URIS = fakeBridge({ ready: new Promise(() => {}) });
    try {
        const p = urisStatus({ waitMs: 0 });
        t.mock.timers.tick(3000);
        assert.deepEqual(await p, { available: true, accepting: false, connection: null });
    } finally {
        delete globalThis.URIS;
        t.mock.timers.reset();
    }
});
