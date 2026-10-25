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
    // Живой объект контекста (как в реальном ST): мутации chatMetadata из
    // detachStore и пр. обязаны быть видны через повторный getContext().
    const ctx = {
        chat,
        chatMetadata: { dg: { storeId } },
        saveMetadataDebounced: () => { savedMeta++; },
        getRequestHeaders: () => ({}),
    };
    globalThis.SillyTavern = { getContext: () => ctx };
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
    globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(doc) });
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
        return { ok: true, text: async () => 'not json at all' };
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

test('a corrupt-file backup never travels into another chat file', async () => {
    // Chat A loaded a non-v2 file (backup state) and its backup POST failed;
    // after switching to chat B, a write there must not drag A's raw content
    // into dg_B.backup.json.
    const uploads = [];
    const realFetch = globalThis.fetch;
    let backupFails = true;
    globalThis.fetch = async (url, opts = {}) => {
        if (String(url).includes('/api/files/upload')) {
            const raw = JSON.parse(opts.body);
            uploads.push([raw.name, Buffer.from(raw.data, 'base64').toString()]);
            if (raw.name.endsWith('.backup.json') && backupFails) return { ok: false };
            return { ok: true };
        }
        return { ok: true, text: async () => 'not our schema' };
    };
    try {
        _testSetEntries(null);
        mockCtx([{ mes: 't' }], 'store-A');
        await loadStore();                 // server returned non-v2 → backup marked (file A)
        writeEntry('k', P('x'));           // snapshot takes the backup; upload fails → state returns
        await new Promise((r) => setTimeout(r, 10));
        mockCtx([{ mes: 't' }], 'store-B'); // CHAT_CHANGED
        writeEntry('k2', P('y'));          // owner is file A: the backup is not taken along
        await new Promise((r) => setTimeout(r, 10));
        const baks = uploads.filter(([n]) => n.endsWith('.backup.json'));
        assert.ok(baks.every(([n]) => n === 'dg_store-A.backup.json'), 'backups of the owner file A only');
        assert.ok(uploads.some(([n]) => n === 'dg_store-B.json'), 'chat B wrote under its own file');
    } finally { globalThis.fetch = realFetch; }
});

test('deleteEntry остаётся рабочим для clearPayload-пути', () => {
    _testSetEntries({ k: P('x') });
    deleteEntry('k');
    assert.equal(readEntry('k'), null);
});

// ── a failed load forbids the blind overwrite ──

test('read 500 defers writes; a control 404 proves the empty base', async () => {
    const uploads = [];
    const realFetch = globalThis.fetch;
    let state = 'down'; // down | missing
    globalThis.fetch = async (url, opts = {}) => {
        if (String(url).includes('/api/files/upload')) {
            uploads.push(JSON.parse(Buffer.from(JSON.parse(opts.body).data, 'base64').toString()));
            return { ok: true };
        }
        if (state === 'down') return { ok: false, status: 500 };
        return { ok: false, status: 404 };
    };
    try {
        _testSetEntries(null);
        mockCtx([{ mes: 't' }]);
        await loadStore();            // server said 500 — file existence unproven
        writeEntry('local', P('x'));
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(uploads.length, 0, 'слепой перезаписи нет');
        assert.equal(storeStatus().ok, false, 'панель видит отложенную запись');

        state = 'missing';
        retryWrite();                 // control read: 404 — the base was empty
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(uploads.length, 1, 'запись прошла после доказательства');
        assert.ok(uploads[0].entries.local, 'локальная запись в теле');
    } finally { globalThis.fetch = realFetch; }
});

test('control read finds a valid file — server entries merge, not wipe', async () => {
    const uploads = [];
    const realFetch = globalThis.fetch;
    let up = false;
    globalThis.fetch = async (url, opts = {}) => {
        if (String(url).includes('/api/files/upload')) {
            uploads.push(JSON.parse(Buffer.from(JSON.parse(opts.body).data, 'base64').toString()));
            return { ok: true };
        }
        if (!up) throw new Error('network down');
        return { ok: true, text: async () => JSON.stringify({ v: 2, entries: { srv: P('server') } }) };
    };
    try {
        _testSetEntries(null);
        mockCtx([{ mes: 't' }]);
        await loadStore();            // network died on the base read
        writeEntry('local', P('x'));
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(uploads.length, 0, 'отложено');

        up = true;
        retryWrite();                 // file reads and is valid → merge instead of wipe
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(uploads.length, 1);
        assert.ok(uploads[0].entries.srv, 'серверная запись выжила');
        assert.ok(uploads[0].entries.local, 'локальная запись доехала');
    } finally { globalThis.fetch = realFetch; }
});

test('a mutation burst during upload coalesces into one file upload', async () => {
    const uploads = [];
    const realFetch = globalThis.fetch;
    let gateOpen = false;
    globalThis.fetch = async (url, opts = {}) => {
        if (String(url).includes('/api/files/upload')) {
            uploads.push(JSON.parse(Buffer.from(JSON.parse(opts.body).data, 'base64').toString()));
            if (!gateOpen) { gateOpen = true; await new Promise((r) => setTimeout(r, 5)); } // first upload in flight
            return { ok: true };
        }
        return { ok: false, status: 404 };
    };
    try {
        _testSetEntries(null);
        mockCtx([{ mes: 't' }]);
        await loadStore();            // 404 → clean base
        writeEntry('a', P('1'));
        writeEntry('b', P('2'));
        writeEntry('c', P('3'));      // all three — while upload 'a' is in flight
        await new Promise((r) => setTimeout(r, 30));
        assert.ok(uploads.length <= 2, `схлопнулось (upload'ов: ${uploads.length}), а не по одной на мутацию`);
        const last = uploads[uploads.length - 1];
        assert.ok(last.entries.a && last.entries.b && last.entries.c, 'финальная загрузка несёт все записи');
    } finally { globalThis.fetch = realFetch; }
});

// ── Б25/Б26/Б27/Б20: инструментарий хранилища ──
import { pruneEntries, detachStore, mergeEntries, storeStatus, retryWrite } from '../src/store.js';

test('Б27: pruneEntries сносит сирот, живые ключи не трогает', () => {
    _testSetEntries({ 'live:0': P('a'), 'dead:1': P('b'), 'dead:2': P('c') });
    const removed = pruneEntries(new Set(['live:0']));
    assert.equal(removed, 2);
    assert.equal(readEntry('live:0').contentDigest, 'a');
    assert.equal(readEntry('dead:1'), null);
    assert.equal(storeStatus().ok, true, 'после записи ошибки нет');
});

test('Б27: pruneEntries без зеркала или с мусором — 0, без падений', () => {
    _testSetEntries(null);
    assert.equal(pruneEntries(new Set(['x'])), 0);
    _testSetEntries({ a: P('a') });
    assert.equal(pruneEntries('мусор'), 0);
});

test('Б26: detachStore — новый storeId, записи копируются, метаданные сохраняются', () => {
    savedMeta = 0;
    _testSetEntries({ 'm1:0': P('a') });
    mockCtx([{ mes: 't' }], 'old-store');
    assert.equal(detachStore(), true);
    assert.notEqual(globalThis.SillyTavern.getContext().chatMetadata.dg.storeId, 'old-store');
    assert.equal(readEntry('m1:0').contentDigest, 'a', 'записи переехали в новое зеркало');
    assert.ok(savedMeta > 0, 'метаданные сохранены');
});

test('Б25: mergeEntries — новые добавляются, по generatedAt выигрывает свежее', () => {
    _testSetEntries({
        'k1': P('old1'),
        'k2': { schema: 1, contentDigest: 'cur2', generatedAt: 100, artifacts: [] },
    });
    const res = mergeEntries({
        'k1': { schema: 1, contentDigest: 'new1', generatedAt: 200, artifacts: [] },
        'k2': { schema: 1, contentDigest: 'stale2', generatedAt: 50, artifacts: [] },
        'k3': { schema: 1, contentDigest: 'add3', generatedAt: 1, artifacts: [] },
        'bad': { мусор: true },
    });
    assert.deepEqual(res, { added: 1, updated: 1 });
    assert.equal(readEntry('k1').contentDigest, 'new1', 'входящее свежее — заменило');
    assert.equal(readEntry('k2').contentDigest, 'cur2', 'текущее свежее — сохранено');
    assert.equal(readEntry('k3').contentDigest, 'add3');
    assert.equal(readEntry('bad'), null);
    _testSetEntries(null);
    assert.deepEqual(mergeEntries({ k: P('x') }), { added: 0, updated: 0 }, 'без зеркала — no-op');
});

test('Б20: storeStatus отражает последнюю ошибку записи, retryWrite не падает', () => {
    _testSetEntries({ k: P('a') });
    assert.deepEqual(storeStatus(), { ok: true, error: null });
    retryWrite();
    assert.equal(storeStatus().ok, true);
});

test('chunked b64: a 70 KB body reaches the upload without loss', async () => {
    const uploads = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
        if (String(url).includes('/api/files/upload')) {
            uploads.push(JSON.parse(Buffer.from(JSON.parse(opts.body).data, 'base64').toString()));
            return { ok: true };
        }
        return { ok: false, status: 404 };
    };
    try {
        _testSetEntries(null);
        mockCtx([{ mes: 't' }]);
        await loadStore();
        const big = 'y'.repeat(70_000); // > 2×0x8000 — crosses chunk boundaries
        writeEntry('big', { ...P('d'), artifacts: [{ html: big }] });
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(uploads[0].entries.big.artifacts[0].html, big, '70 КБ через чанки без потерь');
    } finally { globalThis.fetch = realFetch; }
});
