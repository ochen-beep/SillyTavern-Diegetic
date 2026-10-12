// tests/templates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const files = readdirSync(dir).filter(f => f.endsWith('.md'));
const uni = readFileSync(join(dir, 'universal.md'), 'utf8');

test('в templates/ — ровно один встроенный шаблон', () => {
  assert.deepEqual(files, ['universal.md']);
});

test('universal: {{CONTRACT}} ровно один раз, палитра типов объявлена', () => {
  const markers = uni.split('{{CONTRACT}}').length - 1;
  assert.equal(markers, 1, 'маркер {{CONTRACT}} обязан быть ровно один');
  for (const expected of ['messenger', 'note', 'polaroid', 'newspaper', 'terminal', 'dossier', 'grimoire', 'letter', 'sign']) {
    assert.ok(uni.includes(`type: "${expected}"`), `в палитре нет ${expected}`);
  }
});
