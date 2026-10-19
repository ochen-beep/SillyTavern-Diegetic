// tests/store.test.mjs — файловое хранилище: миграция extra-эпохи, перенос
// send_date-ключей, гонки загрузки/записи. Сеть — только через подменённый fetch.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { _testSetEntries, readEntry, writeEntry, deleteEntry, migrateExtraToStore, loadStore } from '../src/store.js';
import { migrateSendDateKeys } from '../src/migrate.js';
import { dgMessageId } from '../src/payload.js';

const P = (digest) => ({ schema: 1, contentDigest: digest, generatedAt: 1, artifacts: [] });
const keyOf = (msg, idx = 0) => `${dgMessageId(msg, { create: true })}:${idx}`;

let savedMeta = 0;
function mockCtx(chat, storeId = 'test-store') {
    globalThis.SillyTavern = {
        getContext: () => ({
            chat,
            chatMetadata: { dg: { storeId } },
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
    assert.ok(readEntry('old-date'), 'старый ключ остаётся безвредной сиротой (не чистим — риск потерять payload при сбое save)');
});

test('loadStore мержит серверный снимок с записями, легшими за время fetch', async () => {
    // Поздний GET не затирает коммит: раньше было _mirror.entries = doc.entries.
    const doc = { v: 2, entries: { server: P('srv') } };
    // delete globalThis.fetch снёс бы встроенный fetch Node навсегда —
    // последующие тесты получили бы sync-ReferenceError вместо отказа сети.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => doc });
    try {
        _testSetEntries(null);
        mockCtx([{ mes: 't', send_date: 'd0' }]);
        const loading = loadStore();
        writeEntry('local', P('local')); // «коммит» пайплайна во время GET
        await loading;
        assert.equal(readEntry('server')?.contentDigest, 'srv', 'серверные записи на месте');
        assert.equal(readEntry('local')?.contentDigest, 'local', 'закоммиченное за fetch не стёрто');
    } finally { globalThis.fetch = realFetch; }
});

test('upload снимает имя и тело в момент постановки: коммит не уедет в файл другого чата', async () => {
    const uploads = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
        if (String(url).includes('/api/files/upload')) {
            const raw = JSON.parse(opts.body);
            uploads.push([raw.name, JSON.parse(Buffer.from(raw.data, 'base64').toString())]);
            return { ok: true };
        }
        return { ok: true, json: async () => null };
    };
    try {
        _testSetEntries({});
        mockCtx([{ mes: 't' }]);
        writeEntry('m1:0', P('commit'));
        mockCtx([], 'other-store'); // CHAT_CHANGED до исполнения upload
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(uploads.length, 1, 'одна запись');
        assert.equal(uploads[0][0], 'dg_test-store.json', 'файл СВОЕГО чата, а не нового');
        assert.ok(uploads[0][1].entries['m1:0'], 'коммит в теле upload, а не новое пустое зеркало');
    } finally { globalThis.fetch = realFetch; }
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
