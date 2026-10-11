// tests/ui-helpers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectArtifacts, esc, describeSource } from '../src/ui.js';

test('collectArtifacts: собирает (digest, artifacts) из переменных чата', () => {
  const vars = { dg_meta: { abcd1234: { artifacts: [{ id: 'a', type: 'phone', status: 'ok' }], generatedAt: 1 } } };
  const rows = collectArtifacts(vars);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'phone');
  assert.equal(rows[0].digest, 'abcd1234');
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
