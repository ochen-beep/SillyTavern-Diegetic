// tests/payload.test.mjs — адресация payload'ов: ключ dg_id:слот, digest-гейт,
// стабильность адресации при регенерациях и свайпах.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    variantText, digestForVariant, readRawPayload, readVerifiedPayload,
    payloadBelongsToOtherVariant, stampPayload, writePayload, clearPayload,
    dgMessageId,
} from '../src/payload.js';
import { _testSetEntries, readEntry } from '../src/store.js';
import { contentDigest } from '../src/digest.js';

const TEXT = 'Она взяла телефон.\n\nДверь закрылась.';
const artifacts = [{ id: 'x:0', type: 'phone', anchor: 'взяла телефон', status: 'ok', html: '<body><p>phone</p></body>', bytes: 24, createdAt: 1, profileId: 'default' }];

function makeMsg({ text = TEXT, swipeId = 0, swipes = null } = {}) {
    const msg = { mes: text, swipe_id: swipeId, extra: {}, send_date: 'd0' };
    if (swipes) { msg.swipes = swipes; msg.swipe_info = swipes.map((_, i) => ({ extra: {}, send_date: `d${i}` })); }
    return msg;
}

/** Ключ варианта как его считает keyFor: dg_id:слот (id создаётся при записи). */
const keyOf = (msg, idx = 0) => `${dgMessageId(msg, { create: true })}:${idx}`;

beforeEach(() => _testSetEntries({}));

test('variantText: swipes[idx] важнее mes, нет свайпов — mes', () => {
    const msg = makeMsg({ swipes: ['A', 'B'], swipeId: 1 });
    assert.equal(variantText(msg, 1), 'B');
    assert.equal(variantText(msg, 9), TEXT, 'вне диапазона → mes');
    assert.equal(variantText(makeMsg()), TEXT);
});

test('stamp→write→readVerified: roundtrip, запись под dg_id:слот', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    const p = stampPayload(msg, 0, artifacts);
    assert.equal(p.contentDigest, contentDigest(TEXT));
    writePayload(msg, 0, p);
    assert.equal(readEntry(keyOf(msg, 0)), p, 'запись ушла в store под dg_id:слот');
    assert.equal(msg.swipe_info[0].extra.dg, undefined, 'extra слота чистое');
    assert.equal(msg.extra.dg, undefined, 'зеркала больше нет');
    assert.equal(readVerifiedPayload(msg, 0), p);
});

test('ключ стабилен при регенерации свайпа/continue: send_date переставлена — пейлоад жив', () => {
    // Регрессия: ST переставляет send_date при регенерации текущего свайпа и
    // continue (script.js:6679/6704) — адресация по дате теряла пейлоад.
    const msg = makeMsg({ swipes: [TEXT] });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    const stamp = 'October 18, 2026 10:05am';
    msg.send_date = stamp;
    msg.swipe_info[0] = { send_date: stamp, gen_started: '', gen_finished: '', extra: structuredClone(msg.extra) };
    assert.ok(readVerifiedPayload(msg, 0), 'проза не менялась — артефакт обязан остаться');
});

test('чтение не мутирует сообщение: без dg_id — null, extra чистое', () => {
    const msg = makeMsg();
    assert.equal(readRawPayload(msg, 0), null);
    assert.equal(msg.extra.dg_id, undefined, 'id не создан чтением');
});

test('digest-гейт: правка текста делает payload невидимым для verified-чтения', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    msg.swipes[0] = TEXT + ' Тишина.';
    assert.equal(readVerifiedPayload(msg, 0), null);
    assert.ok(readRawPayload(msg, 0), 'raw-чтение для rebind остаётся');
});

test('варианты адресуются индексом слота: запись в один не видна из другого', () => {
    const msg = makeMsg({ swipes: [TEXT, 'Другой вариант текста.'], swipeId: 1 });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    assert.ok(readRawPayload(msg, 0));
    assert.equal(readRawPayload(msg, 1), null, 'показанный вариант 1 не загрязнён');
});

test('foreign payload: дайджест другого варианта детектится', () => {
    const a = makeMsg({ swipes: [TEXT] });
    const payload = stampPayload(a, 0, artifacts);
    const b = makeMsg({ swipes: [TEXT, 'Совсем другая сцена у окна.'], swipeId: 1 });
    assert.equal(payloadBelongsToOtherVariant(b, 1, payload), true);
    assert.equal(payloadBelongsToOtherVariant(b, 0, { ...payload }), false, 'свой вариант — не foreign');
    _testSetEntries({ [keyOf(b, 1)]: payload });
    assert.ok(readRawPayload(b, 1));
    assert.equal(readVerifiedPayload(b, 1), null, 'digest не сошёлся — verified null');
});

test('сообщение без свайп-механики: ключ dg_id:0', () => {
    const msg = makeMsg();
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    assert.ok(readEntry(keyOf(msg, 0)));
    assert.equal(readVerifiedPayload(msg, 0).artifacts[0].type, 'phone');
});

test('isPayloadShape отсекает мусор и чужие схемы', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    _testSetEntries({ [keyOf(msg, 0)]: { schema: 99, contentDigest: digestForVariant(msg, 0), artifacts: [] } });
    assert.equal(readRawPayload(msg, 0), null);
    _testSetEntries({ [keyOf(msg, 0)]: { schema: 1, contentDigest: digestForVariant(msg, 0), artifacts: 'oops' } });
    assert.equal(readRawPayload(msg, 0), null);
});

test('clearPayload: запись удаляется', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    assert.equal(clearPayload(msg, 0), true);
    assert.equal(readRawPayload(msg, 0), null);
    assert.equal(clearPayload(msg, 0), false, 'повторная очистка — false');
});

test('dg_id создаётся и без crypto.randomUUID (plain-http Safari: secure context)', () => {
    // Safari вне secure context не имеет randomUUID — генерация падала с «сбой».
    const realCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) }, configurable: true });
    try {
        const msg = makeMsg();
        const id = dgMessageId(msg, { create: true });
        assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'UUID v4 из getRandomValues');
        assert.equal(id, dgMessageId(msg), 'идемпотентно — id уже записан');
    } finally {
        Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });
    }
});
