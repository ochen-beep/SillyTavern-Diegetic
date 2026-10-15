// tests/ui-helpers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRows, esc, describeSource } from '../src/ui.js';
import { stampPayload, writePayload } from '../src/payload.js';

const TEXT = 'Она взяла телефон.\n\nДверь закрылась.';

function chatWithArtifact() {
    const msg = { mes: TEXT, swipes: [TEXT], swipe_id: 0, swipe_info: [{}], extra: {} };
    writePayload(msg, 0, stampPayload(msg, 0, [
        { id: 'x:0', type: 'phone', anchor: 'взяла телефон', status: 'ok', html: '<body><p>phone</p></body>', bytes: 1, createdAt: 5, profileId: 'default' },
    ]));
    return [msg];
}

test('collectRows: артефакты из extra с индексом сообщения как msgId', () => {
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

test('describeSource: человекочитаемая подпись источника профиля', () => {
    assert.match(describeSource({ source: 'current' }), /текущий API/);
    assert.match(describeSource({ source: 'profile', sourceConfig: { profileName: 'Грок' } }), /профиль подключения.*Грок/s);
    assert.match(describeSource({ source: 'profile', sourceConfig: null }), /профиль подключения/);
    assert.match(describeSource({ source: 'custom', sourceConfig: { apiurl: 'https://x/v1' } }), /endpoint.*https:\/\/x\/v1/s);
    assert.match(describeSource({ source: 'custom', sourceConfig: null }), /endpoint/);
    assert.equal(describeSource(null), '');
});
