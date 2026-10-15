// tests/payload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PAYLOAD_KEY, variantText, digestForVariant, readRawPayload, readVerifiedPayload,
    payloadBelongsToOtherVariant, stampPayload, writePayload, clearPayload,
} from '../src/payload.js';
import { contentDigest } from '../src/digest.js';

const TEXT = 'Она взяла телефон.\n\nДверь закрылась.';
const artifacts = [{ id: 'x:0', type: 'phone', anchor: 'взяла телефон', status: 'ok', html: '<body><p>phone</p></body>', bytes: 24, createdAt: 1, profileId: 'default' }];

function makeMsg({ text = TEXT, swipeId = 0, swipes = null } = {}) {
    const msg = { mes: text, swipe_id: swipeId, extra: {} };
    if (swipes) { msg.swipes = swipes; msg.swipe_info = swipes.map(() => ({ extra: {} })); }
    return msg;
}

test('variantText: swipes[idx] важнее mes, нет свайпов — mes', () => {
    const msg = makeMsg({ swipes: ['A', 'B'], swipeId: 1 });
    assert.equal(variantText(msg, 1), 'B');
    assert.equal(variantText(msg, 9), TEXT, 'вне диапазона → mes');
    assert.equal(variantText(makeMsg()), TEXT);
});

test('stamp→write→readVerified: roundtrip со свайп-слотом и зеркалом', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    const p = stampPayload(msg, 0, artifacts);
    assert.equal(p.contentDigest, contentDigest(TEXT));
    writePayload(msg, 0, p);
    assert.equal(msg.swipe_info[0].extra[PAYLOAD_KEY], p);
    assert.equal(msg.extra[PAYLOAD_KEY], p, 'зеркало отражает показанный вариант');
    assert.equal(readVerifiedPayload(msg, 0), p);
});

test('digest-гейт: правка текста делает payload невидимым для verified-чтения', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    msg.swipes[0] = TEXT + ' Тишина.';
    assert.equal(readVerifiedPayload(msg, 0), null);
    assert.ok(readRawPayload(msg, 0), 'raw-чтение для rebind остаётся');
});

test('запись в непоказанный вариант не трогает live-зеркало', () => {
    const msg = makeMsg({ swipes: [TEXT, 'Другой вариант текста.'], swipeId: 1 });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    assert.ok(msg.swipe_info[0].extra[PAYLOAD_KEY]);
    assert.equal(msg.extra[PAYLOAD_KEY], undefined, 'показан вариант 1 — зеркало пусто');
});

test('foreign payload: дайджест другого варианта детектится', () => {
    const a = makeMsg({ swipes: [TEXT] });
    const payload = stampPayload(a, 0, artifacts);
    // ST клонирует extra на новый свайп: тот же payload, другой текст.
    const b = makeMsg({ swipes: [TEXT, 'Совсем другая сцена у окна.'], swipeId: 1 });
    b.swipe_info[1].extra[PAYLOAD_KEY] = payload;
    assert.equal(payloadBelongsToOtherVariant(b, 1, payload), true);
    assert.equal(payloadBelongsToOtherVariant(b, 0, { ...payload }), false, 'свой вариант — не foreign');
    // readRaw на слоте 1 вернёт чужой payload, verified — нет (digest не сошёлся).
    assert.ok(readRawPayload(b, 1));
    assert.equal(readVerifiedPayload(b, 1), null);
});

test('сообщение без свайп-механики: хранилище — msg.extra', () => {
    const msg = makeMsg();
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    assert.ok(msg.extra[PAYLOAD_KEY]);
    assert.equal(readVerifiedPayload(msg, 0).artifacts[0].type, 'phone');
});

test('stampPayload: заглушка стрима не штампуется', () => {
    assert.equal(stampPayload(makeMsg({ text: '...' }), 0, artifacts), null);
    assert.equal(stampPayload(makeMsg({ text: '' }), 0, artifacts), null);
});

test('clearPayload: слот и зеркало очищаются', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    assert.equal(clearPayload(msg, 0), true);
    assert.equal(readRawPayload(msg, 0), null);
    assert.equal(msg.extra[PAYLOAD_KEY], undefined);
    assert.equal(clearPayload(msg, 0), false, 'повторная очистка — false');
});

test('isPayloadShape отсекает мусор и чужие схемы', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    msg.swipe_info[0].extra = {};
    msg.swipe_info[0].extra[PAYLOAD_KEY] = { schema: 99, contentDigest: digestForVariant(msg, 0), artifacts: [] };
    assert.equal(readRawPayload(msg, 0), null);
    msg.swipe_info[0].extra[PAYLOAD_KEY] = { schema: 1, contentDigest: digestForVariant(msg, 0), artifacts: 'oops' };
    assert.equal(readRawPayload(msg, 0), null);
});
