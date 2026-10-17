// tests/templates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const files = readdirSync(dir).filter(f => f.endsWith('.md'));
const uni = readFileSync(join(dir, 'universal.md'), 'utf8');
const photo = readFileSync(join(dir, 'universal-photo.md'), 'utf8');

test('в templates/ — ровно две встроенные основы', () => {
  assert.deepEqual(files.sort(), ['universal-photo.md', 'universal.md']);
});

test('обе основы: {{CONTRACT}} ровно один раз, без отказных формулировок, на английском', () => {
  for (const [name, text] of [['universal', uni], ['universal-photo', photo]]) {
    assert.equal(text.split('{{CONTRACT}}').length - 1, 1, `${name}: маркер {{CONTRACT}} обязан быть ровно один`);
    assert.ok(!/pulse:?false|"pulse":\s*false/u.test(text), `${name}: без pulse:false`);
    assert.ok(!/не выдумывай|если импульса нет|you may skip|optional to skip/iu.test(text), `${name}: без отказных лазеек`);
    assert.ok(!/\p{Script=Cyrillic}/u.test(text), `${name}: промпт — только английский`);
  }
});

test('universal: скевоморфизм, обязательная интерактивность, русский текст', () => {
  assert.match(uni, /Skeuomorphic/u);
  assert.match(uni, /Mandatory: ≥1 meaningful stateful/u);
  assert.match(uni, /must be in Russian/u);
});

test('universal-photo: фото через data-dg-img слоты с триггерами', () => {
  assert.ok(photo.includes('data-dg-img'), 'фото-вариант использует нашу механику слотов');
  for (const trigger of ['selfie', 'img', 'scene']) {
    assert.ok(photo.includes(`\`${trigger}\``), `нет триггера ${trigger}`);
  }
  assert.ok(photo.includes('CSS-only placeholder'), 'плейсхолдер-фолбэк обязателен');
});
