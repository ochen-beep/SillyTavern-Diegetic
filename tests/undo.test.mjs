// tests/undo.test.mjs — одноуровневая отмена деструктивных операций (Б24).
// Регрессия: ✕/⟳ теряли оплаченный payload безвозвратно.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stashForUndo, restoreStash, clearStash, _resetUndo, UNDO_WINDOW_MS } from '../src/undo.js';
import { stampPayload, writePayload, clearPayload } from '../src/payload.js';
import { readEntry, _testSetEntries } from '../src/store.js';

const TEXT = 'Она взяла телефон.\n\nДверь закрылась.';

beforeEach(() => { _testSetEntries({}); _resetUndo(); });

function msgWith(text = TEXT) {
    return { mes: text, swipes: [text], swipe_id: 0, extra: {} };
}

function payloadFor(msg, html = '<body><p>old</p></body>') {
    const p = stampPayload(msg, 0, [
        { id: 'x:0', type: 'записка', anchor: '', status: 'ok', html, bytes: 1, createdAt: 1, profileId: 't' },
    ]);
    writePayload(msg, 0, p);
    return p;
}

const keyOf = (msg, idx = 0) => `${msg.extra.dg_id}:${idx}`;

test('stash → деструктивная операция → restore возвращает прежний payload', () => {
    const msg = msgWith();
    const original = payloadFor(msg);
    const undo = stashForUndo(msg, 0, original);
    assert.equal(typeof undo, 'function');

    clearPayload(msg, 0); // имитация удаления
    assert.equal(readEntry(keyOf(msg)), null, 'после удаления записи нет');

    assert.equal(restoreStash(), true, 'отмена восстановила запись');
    const restored = readEntry(keyOf(msg));
    assert.equal(restored.contentDigest, original.contentDigest);
    assert.equal(restored.artifacts[0].html, '<body><p>old</p></body>');
});

test('второй stash вытесняет первый; замыкание срабатывает один раз', () => {
    const msg = msgWith();
    const p1 = payloadFor(msg);
    const undo1 = stashForUndo(msg, 0, p1);
    const p2 = stampPayload(msg, 0, [
        { id: 'y:0', type: 'фото', anchor: '', status: 'ok', html: '<body><p>new</p></body>', bytes: 1, createdAt: 2, profileId: 't' },
    ]);
    const undo2 = stashForUndo(msg, 0, p2);
    assert.equal(undo1(), false, 'первый stash вытеснен вторым');
    assert.equal(undo2(), true);
    assert.equal(undo2(), false, 'повторная отмена невозможна — stash снят');
});

test('stashForUndo: null на пустом входе; окно экспортировано', () => {
    const msg = msgWith();
    assert.equal(stashForUndo(null, 0, { a: 1 }), null);
    assert.equal(stashForUndo(msg, 0, null), null);
    assert.equal(UNDO_WINDOW_MS, 10_000);
});

test('копия вглубь: мутация объекта-источника после stash не портит откат', () => {
    const msg = msgWith();
    const p = payloadFor(msg);
    stashForUndo(msg, 0, p);
    p.artifacts[0].html = '<body><p>PORTED</p></body>';
    restoreStash();
    assert.equal(readEntry(keyOf(msg)).artifacts[0].html, '<body><p>old</p></body>');
});

test('clearStash снимает возможность отмены', () => {
    const msg = msgWith();
    const p = payloadFor(msg);
    stashForUndo(msg, 0, p);
    clearStash();
    assert.equal(restoreStash(), false);
});
