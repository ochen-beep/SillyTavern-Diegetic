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

test('abortKind: отменяет только свой вид, слот чистится сразу', () => {
  const c = createGenerationCoordinator();
  const gen = c.beginRun(1, 'gen');
  assert.equal(c.abortKind(1, 'fill'), false, 'чужой вид не трогается');
  assert.equal(gen.ctrl.signal.aborted, false);
  assert.equal(c.abortKind(1, 'gen'), true);
  assert.equal(gen.ctrl.signal.aborted, true);
  assert.equal(gen.canceled, true, 'пользователь отказался от результата');
  assert.equal(c.isCurrent(gen), false, 'отменённый прогон больше не current');
  assert.equal(c.abortKind(1, 'gen'), true, 'повторный клик в окне размотки — снова отмена');
  assert.equal(c.endRun(gen), true, 'слот у владельца — размотка снимет его');
  assert.equal(c.abortKind(1, 'gen'), false, 'после размотки клик стартует новый прогон');
});

test('abortKind ставит canceled, bumpMessageRevision — нет (отмена ≠ правка)', () => {
  const c = createGenerationCoordinator();
  const canceled = c.beginRun(1);
  c.abortKind(1, 'gen');
  const edited = c.beginRun(2);
  c.bumpMessageRevision(2);
  assert.equal(canceled.canceled, true);
  assert.equal(edited.canceled, false, 'правка — не отказ от результата: поздний ответ спасается');
  assert.equal(edited.ctrl.signal.aborted, true);
});

test('abortKind: заливка фото отменяется независимо от генерации', () => {
  const c = createGenerationCoordinator();
  const fill = c.beginRun(1, 'fill');
  assert.equal(c.abortKind(1, 'gen'), false);
  assert.equal(fill.ctrl.signal.aborted, false, '◆ не убивает заливку');
  assert.equal(c.abortKind(1, 'fill'), true);
  assert.equal(fill.ctrl.signal.aborted, true);
});

test('bumpMessageRevision абортит прогон любого вида', () => {
  const c = createGenerationCoordinator();
  const fill = c.beginRun(1, 'fill');
  c.bumpMessageRevision(1);
  assert.equal(fill.ctrl.signal.aborted, true);
});
