// tests/templates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const files = readdirSync(dir).filter(f => f.endsWith('.md'));

test('галерея: 7 селективных линз + universal', () => {
  assert.equal(files.length, 8);
  for (const expected of ['note.md', 'messenger.md', 'polaroid.md', 'newspaper.md', 'terminal.md', 'dossier.md', 'grimoire.md', 'universal.md']) {
    assert.ok(files.includes(expected), `нет линзы ${expected}`);
  }
});

test('каждая линза: {{CONTRACT}} ровно один раз и type объявлен', () => {
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const markers = text.split('{{CONTRACT}}').length - 1;
    assert.equal(markers, 1, `${f}: маркер {{CONTRACT}} обязан быть ровно один`);
    assert.match(text, /type:\s*"/, `${f}: должен объявлять type`);
  }
});

test('селективные линзы: типы уникальны и покрывают ядро галереи; universal выбирает тип динамически', () => {
  const selective = files.filter(f => f !== 'universal.md');
  const types = selective.map(f => (readFileSync(join(dir, f), 'utf8').match(/type:\s*"([^"]+)"/) || [])[1]);
  assert.equal(new Set(types).size, selective.length);
  for (const expected of ['note', 'messenger', 'polaroid', 'newspaper', 'terminal', 'dossier', 'grimoire']) {
    assert.ok(types.includes(expected), `нет линзы ${expected}`);
  }
  const uni = readFileSync(join(dir, 'universal.md'), 'utf8');
  assert.match(uni, /type:\s*"[^"]*"[^—]*—/, 'universal: тип выбирается из палитры');
  for (const expected of ['messenger', 'note', 'polaroid', 'newspaper', 'terminal', 'dossier', 'grimoire']) {
    assert.ok(uni.includes(`type: "${expected}"`), `universal: в палитре нет ${expected}`);
  }
});
