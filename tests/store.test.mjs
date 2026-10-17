// tests/store.test.mjs — файловое хранилище: миграция extra-эпохи и GC.
// Сеть не ходит: fetch не вызывается, т.к. загрузку не делаем (только зеркало).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { _testSetEntries, readEntry, writeEntry, deleteEntry, migrateExtraToStore, gcStore } from '../src/store.js';

const P = (digest) => ({ schema: 1, contentDigest: digest, generatedAt: 1, artifacts: [] });

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

test('миграция: слоты уходят в store под send_date, сообщения чистятся', () => {
    const slot = P('a1');
    const chat = [{
        mes: 't', swipes: ['t'], swipe_id: 0, send_date: 'd0',
        swipe_info: [{ send_date: 'd0', extra: { dg: slot } }],
        extra: { dg: slot },
    }];
    mockCtx(chat);
    assert.equal(migrateExtraToStore(), true);
    assert.equal(readEntry('d0'), slot);
    assert.equal(chat[0].swipe_info[0].extra.dg, undefined);
    assert.equal(chat[0].extra.dg, undefined);
    assert.equal(migrateExtraToStore(), false, 'идемпотентна');
});

test('миграция: зеркало без слота подхватывается по send_date активного свайпа', () => {
    const chat = [{ mes: 't', send_date: 'd9', extra: { dg: P('m') } }];
    mockCtx(chat);
    migrateExtraToStore();
    assert.equal(readEntry('d9').contentDigest, 'm');
});

test('миграция: существующая запись не перезаписывается старой из extra', () => {
    _testSetEntries({ d0: P('fresh') });
    const chat = [{ mes: 't', send_date: 'd0', extra: { dg: P('stale') } }];
    mockCtx(chat);
    migrateExtraToStore();
    assert.equal(readEntry('d0').contentDigest, 'fresh');
    assert.equal(chat[0].extra.dg, undefined, 'legacy всё равно вычищен');
});

test('gcStore: записи, не привязанные ни к одному свайпу, удаляются', () => {
    _testSetEntries({ d0: P('a'), orphan: P('b') });
    const chat = [{ mes: 't', send_date: 'd0', swipe_info: [{ send_date: 'd0' }] }];
    mockCtx(chat);
    gcStore();
    assert.ok(readEntry('d0'));
    assert.equal(readEntry('orphan'), null);
});

test('writeEntry до загрузки — в pending, после loadStore применяется', async () => {
    _testSetEntries(null);
    mockCtx([{ mes: 't', send_date: 'd0' }]);
    writeEntry('k', P('p'));
    assert.equal(readEntry('k'), null, 'до загрузки sync-чтение пустое');
    await new Promise((r) => setTimeout(r, 10)); // loadStore без сети: fetch упадёт → catch
    assert.equal(readEntry('k').contentDigest, 'p', 'pending применился после загрузки');
});
