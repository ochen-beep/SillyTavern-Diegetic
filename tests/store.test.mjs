// tests/store.test.mjs — файловое хранилище: миграция extra-эпохи, перенос
// send_date-ключей и GC. Сеть не ходит: fetch не вызывается (только зеркало).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { _testSetEntries, readEntry, writeEntry, deleteEntry, migrateExtraToStore, gcStore } from '../src/store.js';
import { migrateSendDateKeys } from '../src/migrate.js';
import { dgMessageId } from '../src/payload.js';

const P = (digest) => ({ schema: 1, contentDigest: digest, generatedAt: 1, artifacts: [] });
const keyOf = (msg, idx = 0) => `${dgMessageId(msg, { create: true })}:${idx}`;

let savedMeta = 0;
function mockCtx(chat) {
    globalThis.SillyTavern = {
        getContext: () => ({
            chat,
            chatMetadata: { dg: { storeId: 'test-store' } },
            saveMetadataDebounced: () => { savedMeta++; },
            getRequestHeaders: () => ({}),
        }),
    };
}

beforeEach(() => { savedMeta = 0; _testSetEntries({}); });
afterEach(() => { delete globalThis.SillyTavern; _testSetEntries({}); });

test('миграция: слоты уходят в store под dg_id:слот, сообщения чистятся', () => {
    const slot = P('a1');
    const chat = [{
        mes: 't', swipes: ['t'], swipe_id: 0, send_date: 'd0',
        swipe_info: [{ send_date: 'd0', extra: { dg: slot } }],
        extra: { dg: slot },
    }];
    mockCtx(chat);
    assert.equal(migrateExtraToStore(), true);
    assert.equal(readEntry(keyOf(chat[0], 0)), slot);
    assert.equal(chat[0].swipe_info[0].extra.dg, undefined);
    assert.equal(chat[0].extra.dg, undefined);
    assert.equal(migrateExtraToStore(), false, 'идемпотентна');
});

test('миграция: зеркало без слота подхватывается в активный свайп', () => {
    const chat = [{ mes: 't', send_date: 'd9', extra: { dg: P('m') } }];
    mockCtx(chat);
    migrateExtraToStore();
    assert.equal(readEntry(keyOf(chat[0], 0)).contentDigest, 'm');
});

test('миграция: существующая запись не перезаписывается старой из extra', () => {
    const chat = [{ mes: 't', send_date: 'd0', extra: { dg: P('stale') } }];
    _testSetEntries({ [keyOf(chat[0], 0)]: P('fresh') });
    mockCtx(chat);
    migrateExtraToStore();
    assert.equal(readEntry(keyOf(chat[0], 0)).contentDigest, 'fresh');
    assert.equal(chat[0].extra.dg, undefined, 'legacy всё равно вычищен');
});

test('перенос send_date-ключей: регенерация переставила дату — пейлоад переезжает на dg_id', () => {
    const chat = [{
        mes: 't', swipes: ['t'], swipe_id: 0, send_date: 'new-date',
        // swipe_info уже с НОВОЙ датой (ST переставил), запись лежит под старой
        swipe_info: [{ send_date: 'new-date' }],
        extra: {},
    }];
    mockCtx(chat);
    _testSetEntries({ 'old-date': P('saved') });
    // имитируем «старый ключ» через swipe_info прежнего вида
    chat[0].swipe_info[0].send_date = 'old-date';
    assert.equal(migrateSendDateKeys(), true);
    const id = dgMessageId(chat[0]);
    assert.equal(readEntry(`${id}:0`).contentDigest, 'saved', 'запись переехала на dg_id:0');
    assert.equal(readEntry('old-date'), null, 'старый ключ вычищен');
    assert.equal(migrateSendDateKeys(), false, 'идемпотентна');
});

test('перенос: занятый новый ключ не перезаписывается', () => {
    const chat = [{
        mes: 't', swipes: ['t'], swipe_id: 0, send_date: 'old-date',
        swipe_info: [{ send_date: 'old-date' }], extra: {},
    }];
    mockCtx(chat);
    const id = dgMessageId(chat[0], { create: true });
    _testSetEntries({ 'old-date': P('old'), [`${id}:0`]: P('new') });
    assert.equal(migrateSendDateKeys(), false, 'перенос не нужен');
    assert.equal(readEntry(`${id}:0`).contentDigest, 'new', 'свежая запись цела');
    assert.ok(readEntry('old-date'), 'старый ключ оставлен — подберёт gcStore');
});

test('gcStore: записи без живого сообщения (по dg_id) удаляются', () => {
    const keep = { mes: 't', swipes: ['a', 'b'], swipe_id: 0, extra: {} };
    const keepId = dgMessageId(keep, { create: true });
    _testSetEntries({
        [`${keepId}:0`]: P('a'),
        [`${keepId}:1`]: P('slot1'),
        'gone': P('b'),
        'old-date': P('legacy'),
    });
    mockCtx([keep]);
    gcStore();
    assert.ok(readEntry(`${keepId}:0`), 'живой слот цел');
    assert.ok(readEntry(`${keepId}:1`), 'слот в пределах swipes.length цел');
    assert.equal(readEntry('gone'), null, 'запись без сообщения удалена');
    assert.equal(readEntry('old-date'), null, 'legacy-ключ после переноса удалён');
});

test('writeEntry до загрузки — в pending, после loadStore применяется', async () => {
    _testSetEntries(null);
    mockCtx([{ mes: 't', send_date: 'd0' }]);
    writeEntry('k', P('p'));
    assert.equal(readEntry('k'), null, 'до загрузки sync-чтение пустое');
    await new Promise((r) => setTimeout(r, 10)); // loadStore без сети: fetch упадёт → catch
    assert.equal(readEntry('k').contentDigest, 'p', 'pending применился после загрузки');
});

test('deleteEntry остаётся рабочим для clearPayload-пути', () => {
    _testSetEntries({ k: P('x') });
    deleteEntry('k');
    assert.equal(readEntry('k'), null);
});
