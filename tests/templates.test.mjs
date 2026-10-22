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
const testDie = readFileSync(join(dir, 'test.md'), 'utf8');

test('в templates/ — три встроенные основы', () => {
  assert.deepEqual(files.sort(), ['test.md', 'universal-photo.md', 'universal.md']);
});

test('все встроенные основы: {{CONTRACT}} ровно один раз, без отказных формулировок, на английском', () => {
  for (const [name, text] of [['universal', uni], ['universal-photo', photo], ['TestDie', testDie]]) {
    assert.equal(text.split('{{CONTRACT}}').length - 1, 1, `${name}: маркер {{CONTRACT}} обязан быть ровно один`);
    assert.ok(!/pulse:?false|"pulse":\s*false/u.test(text), `${name}: без pulse:false`);
    assert.ok(!/не выдумывай|если импульса нет|you may skip|optional to skip/iu.test(text), `${name}: без отказных лазеек`);
    assert.ok(!/\p{Script=Cyrillic}/u.test(text), `${name}: промпт — только английский`);
  }
});

test('universal: скевоморфизм, обязательная интерактивность, русский текст', () => {
  assert.match(uni, /skeuomorphic/iu);
  assert.match(uni, /Mandatory: ≥1 stateful/u);
  assert.match(uni, /Russian for all in-universe text/u);
});

test('TestDie: законченная деятельность и narrative pulse', () => {
  assert.match(testDie, /Build a finished thing/iu);
  assert.match(testDie, /NARRATIVE PULSE/iu);
  assert.match(testDie, /PRIVATE CANDIDATE PASS/iu);
  assert.match(testDie, /causal state that persists and changes/iu);
  assert.match(testDie, /slide index, step index/iu);
  assert.match(testDie, /materially different states/iu);
  assert.match(testDie, /must never be the whole interaction/iu);
  assert.match(testDie, /implement its actual activity/iu);
  assert.match(testDie, /ANTI-TEMPLATE RULES/iu);
  assert.match(testDie, /top HUD\/metrics strip and a bottom commentary\/readout box/iu);
  assert.match(testDie, /reader-facing instructions/iu);
  assert.match(testDie, /prefers-reduced-motion/iu);
  assert.match(testDie, /close local fallback/iu);
  assert.match(testDie, /\{\{CONTRACT\}\}/u);
});

test('universal-photo: фото через data-dg-img слоты с триггерами', () => {
  assert.ok(photo.includes('data-dg-img'), 'фото-вариант использует нашу механику слотов');
  for (const trigger of ['selfie', 'img', 'scene']) {
    assert.ok(photo.includes(`\`${trigger}\``), `нет триггера ${trigger}`);
  }
  assert.ok(photo.includes('CSS placeholder'), 'плейсхолдер-фолбэк обязателен');
});
