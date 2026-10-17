// tests/payload.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    variantText, digestForVariant, readRawPayload, readVerifiedPayload,
    payloadBelongsToOtherVariant, stampPayload, writePayload, clearPayload,
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

beforeEach(() => _testSetEntries({}));

test('variantText: swipes[idx] важнее mes, нет свайпов — mes', () => {
    const msg = makeMsg({ swipes: ['A', 'B'], swipeId: 1 });
    assert.equal(variantText(msg, 1), 'B');
    assert.equal(variantText(msg, 9), TEXT, 'вне диапазона → mes');
    assert.equal(variantText(makeMsg()), TEXT);
});

test('stamp→write→readVerified: roundtrip, сообщение не трогается', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    const p = stampPayload(msg, 0, artifacts);
    assert.equal(p.contentDigest, contentDigest(TEXT));
    writePayload(msg, 0, p);
    assert.equal(readEntry('d0'), p, 'запись ушла в store под send_date слота');
    assert.equal(msg.swipe_info[0].extra.dg, undefined, 'extra сообщения чистое');
    assert.equal(msg.extra.dg, undefined, 'зеркала больше нет');
    assert.equal(readVerifiedPayload(msg, 0), p);
});

test('digest-гейт: правка текста делает payload невидимым для verified-чтения', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    msg.swipes[0] = TEXT + ' Тишина.';
    assert.equal(readVerifiedPayload(msg, 0), null);
    assert.ok(readRawPayload(msg, 0), 'raw-чтение для rebind остаётся');
});

test('варианты адресуются своей send_date: запись в один не видна из другого', () => {
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
    _testSetEntries({ d1: payload });
    assert.ok(readRawPayload(b, 1));
    assert.equal(readVerifiedPayload(b, 1), null, 'digest не сошёлся — verified null');
});

test('сообщение без свайп-механики: ключ — send_date сообщения', () => {
    const msg = makeMsg();
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    assert.ok(readEntry('d0'));
    assert.equal(readVerifiedPayload(msg, 0).artifacts[0].type, 'phone');
});

test('сообщение вообще без send_date: запись отклоняется', () => {
    const msg = { mes: TEXT, extra: {} };
    assert.equal(writePayload(msg, 0, stampPayload(msg, 0, artifacts)), null);
});

test('stampPayload: заглушка стрима не штампуется', () => {
    assert.equal(stampPayload(makeMsg({ text: '...' }), 0, artifacts), null);
    assert.equal(stampPayload(makeMsg({ text: '' }), 0, artifacts), null);
});

test('clearPayload: запись удаляется', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    writePayload(msg, 0, stampPayload(msg, 0, artifacts));
    assert.equal(clearPayload(msg, 0), true);
    assert.equal(readRawPayload(msg, 0), null);
    assert.equal(clearPayload(msg, 0), false, 'повторная очистка — false');
});

test('isPayloadShape отсекает мусор и чужие схемы', () => {
    const msg = makeMsg({ swipes: [TEXT] });
    _testSetEntries({ d0: { schema: 99, contentDigest: digestForVariant(msg, 0), artifacts: [] } });
    assert.equal(readRawPayload(msg, 0), null);
    _testSetEntries({ d0: { schema: 1, contentDigest: digestForVariant(msg, 0), artifacts: 'oops' } });
    assert.equal(readRawPayload(msg, 0), null);
});
