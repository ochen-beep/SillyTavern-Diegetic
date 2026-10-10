// tests/templates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const files = readdirSync(dir).filter(f => f.endsWith('.md'));

test('галерея: ровно 7 стартовых линз', () => {
  assert.equal(files.length, 7);
});

test('каждая линза: {{CONTRACT}} ровно один раз и type объявлен', () => {
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const markers = text.split('{{CONTRACT}}').length - 1;
    assert.equal(markers, 1, `${f}: маркер {{CONTRACT}} обязан быть ровно один`);
    assert.match(text, /type:\s*"/, `${f}: должен объявлять type`);
  }
});

test('типы линз уникальны и покрывают ядро галереи', () => {
  const types = files.map(f => (readFileSync(join(dir, f), 'utf8').match(/type:\s*"([^"]+)"/) || [])[1]);
  assert.equal(new Set(types).size, 7);
  for (const expected of ['note', 'messenger', 'polaroid', 'newspaper', 'terminal', 'dossier', 'grimoire']) {
    assert.ok(types.includes(expected), `нет линзы ${expected}`);
  }
});
