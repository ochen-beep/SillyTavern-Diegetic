// tests/ui-helpers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectArtifacts } from '../src/ui.js';

test('collectArtifacts: собирает (digest, artifacts) из переменных чата', () => {
  const vars = { dg_meta: { abcd1234: { artifacts: [{ id: 'a', type: 'phone', status: 'ok' }], generatedAt: 1 } } };
  const rows = collectArtifacts(vars);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'phone');
  assert.equal(rows[0].digest, 'abcd1234');
});
