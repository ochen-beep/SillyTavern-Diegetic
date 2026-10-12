import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiegeticResponse, repairJson } from '../src/parser.js';

const ART = '<body><p>телефон</p></body>';
const okPair = `<!--DIEGETIC {"type":"phone","anchor":"взял телефон"}-->\n\`\`\`html\n${ART}\n\`\`\``;

test('валидная пара: артефакт с метой', () => {
  const r = parseDiegeticResponse(okPair, {});
  assert.equal(r.artifacts.length, 1);
  assert.equal(r.artifacts[0].type, 'phone');
  assert.equal(r.artifacts[0].anchor, 'взял телефон');
  assert.equal(r.artifacts[0].html, ART);
});

test('маркер со старым полем pulse переживается (лишнее поле игнорируется)', () => {
  const legacy = okPair.replace('"type"', '"pulse":true,"type"');
  const r = parseDiegeticResponse(legacy, {});
  assert.equal(r.artifacts.length, 1);
  assert.equal(r.artifacts[0].type, 'phone');
});

test('несколько артефактов по порядку', () => {
  const two = okPair + '\n' + `<!--DIEGETIC {"type":"note","anchor":"записка"}-->\n\`\`\`html\n<body>2</body>\n\`\`\``;
  const r = parseDiegeticResponse(two, {});
  assert.deepEqual(r.artifacts.map(a => a.type), ['phone', 'note']);
});

test('repairJson: прямой JSON', () => {
  assert.deepEqual(repairJson('{"type":"phone"}'), { type: 'phone' });
});

test('repairJson: лишний текст вокруг объекта', () => {
  assert.deepEqual(repairJson('Вот результат:\n{"type":"phone","anchor":"x"} — готово'), { type: 'phone', anchor: 'x' });
});

test('repairJson: умные кавычки и хвостовая запятая', () => {
  assert.deepEqual(repairJson('{“type”: “map”, “anchor”: “стук”, }'), { type: 'map', anchor: 'стук' });
});

test('repairJson: regex-фолбэк по полям', () => {
  const v = repairJson('type: "map", anchor: "карта мира"');
  assert.equal(v.type, 'map');
  assert.equal(v.anchor, 'карта мира');
});

test('валидации: без <body — ошибка, артефакт отброшен', () => {
  const bad = `<!--DIEGETIC {"anchor":"x"}-->\n\`\`\`html\n<div>no body</div>\n\`\`\``;
  const r = parseDiegeticResponse(bad, {});
  assert.equal(r.artifacts.length, 0);
  assert.ok(r.errors.length >= 1);
});

test('валидации: размер > maxBytes — отброшен', () => {
  const big = `<!--DIEGETIC {"anchor":"x"}-->\n\`\`\`html\n<body>${'x'.repeat(100)}</body>\n\`\`\``;
  const r = parseDiegeticResponse(big, { maxBytes: 50 });
  assert.equal(r.artifacts.length, 0);
});

test('валидации: ``` внутри — отброшен', () => {
  const bad = `<!--DIEGETIC {"anchor":"x"}-->\n\`\`\`html\n<body>\`\`\`</body>\n\`\`\``;
  const r = parseDiegeticResponse(bad, {});
  assert.equal(r.artifacts.length, 0);
});

test('maxCount режет количество', () => {
  const two = okPair + '\n' + `<!--DIEGETIC {"type":"note","anchor":"записка"}-->\n\`\`\`html\n<body>2</body>\n\`\`\``;
  const r = parseDiegeticResponse(two, { maxCount: 1 });
  assert.equal(r.artifacts.length, 1);
});

test('мусор вместо ответа — errors без артефактов', () => {
  const r = parseDiegeticResponse('Привет, я модель, вот ваш артефакт!', {});
  assert.equal(r.artifacts.length, 0);
  assert.ok(r.errors.length >= 1);
});

test('CRLF: фенс с \\r\\n парсится', () => {
  const crlf = '<!--DIEGETIC {"type":"phone","anchor":"x"}-->\r\n```html\r\n<body><p>1</p></body>\r\n```';
  const r = parseDiegeticResponse(crlf, {});
  assert.equal(r.artifacts.length, 1);
  assert.equal(r.artifacts[0].html, '<body><p>1</p></body>');
});
