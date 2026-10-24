// tests/ui-helpers.test.mjs — панельные хелперы: collectRows, artifactListHtml, esc.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { collectRows, esc } from '../src/ui.js';
import { stampPayload, writePayload } from '../src/payload.js';
import { _testSetEntries } from '../src/store.js';

const TEXT = 'Она взяла телефон.\n\nДверь закрылась.';

beforeEach(() => _testSetEntries({}));

function chatWithArtifact() {
    const msg = { mes: TEXT, swipes: [TEXT], swipe_id: 0, swipe_info: [{ send_date: 'd0' }], extra: {}, send_date: 'd0' };
    writePayload(msg, 0, stampPayload(msg, 0, [
        { id: 'x:0', type: 'phone', anchor: 'взяла телефон', status: 'ok', html: '<body><p>phone</p></body>', bytes: 1, createdAt: 5, profileId: 'default' },
    ]));
    return [msg];
}

test('collectRows: артефакты из хранилища с индексом сообщения как msgId', () => {
    const rows = collectRows(chatWithArtifact());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'phone');
    assert.equal(rows[0].msgId, 0);
    assert.equal(rows[0].status, 'ok');
});

test('collectRows: расхождение digest → статус stale', () => {
    const chat = chatWithArtifact();
    chat[0].swipes[0] = TEXT + ' Тишина.';
    const rows = collectRows(chat);
    assert.equal(rows[0].status, 'stale');
});

test('collectRows: чужие/пустые сообщения пропускаются', () => {
    assert.deepEqual(collectRows([{ mes: 'hi' }, null, { mes: TEXT }]), []);
});

test('esc: экранирует &<>"\'', () => {
    assert.equal(esc('<img src=x onerror=1>&"\''), '&lt;img src=x onerror=1&gt;&amp;&quot;&#39;');
});
