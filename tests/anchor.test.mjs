// tests/anchor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnchorKey, findAnchorInText, findAllAnchorSpans, findFuzzySpan } from '../src/anchor.js';

test('normalizeAnchorKey: кавычки/тире/регистр/пробелы', () => {
  assert.equal(normalizeAnchorKey('  «Не входи» —  он сказал '), '"не входи" - он сказал');
});

test('findAnchorInText: точный матч с word-boundary и офсетами в ИСХОДНОЙ строке', () => {
  const text = 'Она молча кивнула и вышла из комнаты.';
  const hit = findAnchorInText(text, 'вышла из комнаты');
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end), 'вышла из комнаты');
});

test('findAnchorInText: нормализует кавычки при поиске', () => {
  const text = 'Он сказал: «Не входи», и запер дверь.';
  const hit = findAnchorInText(text, '"не входи"');
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end), '«Не входи»');
});

test('findAnchorInText: без word-boundary не матчит часть слова', () => {
  assert.equal(findAnchorInText('повышенный', 'вышен'), null);
});

test('findAllAnchorSpans: все вхождения', () => {
  assert.equal(findAllAnchorSpans('стук. пауза. стук.', 'стук').length, 2);
});

test('findFuzzySpan: typo в одном длинном слове находится', () => {
  const text = 'Она открыла разбитый тлефон и вздохнула.';
  const hit = findFuzzySpan(text, 'разбитый телефон');
  assert.ok(hit, 'fuzzy должен найти тлефон→телефон');
  assert.equal(hit.distance, 1);
});

test('findFuzzySpan: короткие слова (≤4) точны', () => {
  assert.equal(findFuzzySpan('стал он у двери', 'стал рядом'), null);
});

test('findAnchorInText: астральные символы (эмодзи) до якоря не ломают оффсеты', () => {
  const text = 'Он 👍 взял телефон и вышел.';
  const hit = findAnchorInText(text, 'взял телефон');
  assert.ok(hit, 'эмодзи перед якорем не должен ломать матч');
  assert.equal(text.slice(hit.start, hit.end), 'взял телефон');
});

test('findAnchorInText: офсеты в исходной строке точны', () => {
  const text = 'Она молча кивнула и вышла из комнаты.';
  assert.equal(findAnchorInText(text, 'вышла из комнаты').start, 20);
});

test('findAnchorInText: якорь в начале строки', () => {
  assert.ok(findAnchorInText('вышла из комнаты быстро', 'вышла из комнаты'));
});

test('findFuzzySpan: при равном расстоянии побеждает первое вхождение', () => {
  const text = 'разбитый тлефон и снова тлефон';
  const hit = findFuzzySpan(text, 'разбитый телефон');
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end), 'разбитый тлефон');
});
