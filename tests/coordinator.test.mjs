import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationCoordinator } from '../src/coordinator.js';

test('beginRun→isCurrent→endRun', () => {
  const c = createGenerationCoordinator();
  const run = c.beginRun(5);
  assert.equal(c.isCurrent(run), true);
  assert.equal(c.endRun(run), true);
  assert.equal(c.isCurrent(run), false);
});

test('новый прогон того же сообщения supersedes старый', () => {
  const c = createGenerationCoordinator();
  const r1 = c.beginRun(1);
  const r2 = c.beginRun(1);
  assert.equal(c.isCurrent(r1), false);
  assert.equal(c.isCurrent(r2), true);
  assert.equal(r1.ctrl.signal.aborted, true);
});

test('правка/свайп сообщения инвалидирует только его', () => {
  const c = createGenerationCoordinator();
  const a = c.beginRun(1);
  const b = c.beginRun(2);
  c.bumpMessageRevision(1);
  assert.equal(c.isCurrent(a), false);
  assert.equal(c.isCurrent(b), true);
});

test('invalidateAll инвалидирует всё (смена чата)', () => {
  const c = createGenerationCoordinator();
  const a = c.beginRun(1);
  c.invalidateAll();
  assert.equal(c.isCurrent(a), false);
  assert.equal(a.ctrl.signal.aborted, true);
});

test('endRun сменённого прогона не трогает слот преемника', () => {
  const c = createGenerationCoordinator();
  const r1 = c.beginRun(1);
  const r2 = c.beginRun(1);
  assert.equal(c.endRun(r1), false);
  assert.equal(c.isCurrent(r2), true);
  assert.equal(c.endRun(r2), true);
  assert.equal(c.isCurrent(r2), false);
});
