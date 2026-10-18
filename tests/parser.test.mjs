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

test('размер артефакта не ограничен: больше прежних 32 КБ — сохраняется', () => {
  // Регрессия «33937 bytes > maxBytes»: уплаченный ответ не должен отбрасываться
  const big = `<!--DIEGETIC {"type":"dashboard","anchor":"x"}-->\n\`\`\`html\n<body>${'x'.repeat(33937)}</body>\n\`\`\``;
  const r = parseDiegeticResponse(big, {});
  assert.equal(r.artifacts.length, 1);
  assert.equal(r.errors.length, 0);
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

test('служебная пометка <!-- DIEGETIC PHOTO SLOT --> внутри HTML — не разделитель артефактов', () => {
  const withMarker = `<!--DIEGETIC {"type":"phone","anchor":"взял телефон"}-->\n\`\`\`html\n<body>\n<!-- DIEGETIC PHOTO SLOT -->\n<div data-dg-img="img: снимок"></div>\n</body>\n\`\`\``;
  const r = parseDiegeticResponse(withMarker, {});
  assert.deepEqual(r.errors, []);
  assert.equal(r.artifacts.length, 1);
  assert.equal(r.artifacts[0].type, 'phone');
  assert.ok(r.artifacts[0].html.includes('PHOTO SLOT'));
});

test('несколько артефактов, у каждого внутренняя пометка PHOTO SLOT', () => {
  const mk = (t, body) => `<!--DIEGETIC {"type":"${t}","anchor":"x"}-->\n\`\`\`html\n<body>${body}<!-- DIEGETIC PHOTO SLOT --></body>\n\`\`\``;
  const r = parseDiegeticResponse(mk('phone', '1') + '\n' + mk('note', '2'), {});
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.artifacts.map(a => a.type), ['phone', 'note']);
});

test('нечитаемая DIEGETIC-пометка без { не даёт ни ошибки, ни разрыва сегмента', () => {
  const withNoise = `<!--DIEGETIC заметка для себя-->\n\`\`\`html\n<body>ok</body>\n\`\`\`\n<!--DIEGETIC {"type":"phone","anchor":"x"}-->\n\`\`\`html\n<body>2</body>\n\`\`\``;
  const r = parseDiegeticResponse(withNoise, {});
  assert.deepEqual(r.errors, []);
  assert.equal(r.artifacts.length, 1);
  assert.equal(r.artifacts[0].type, 'phone');
});

test('сломанная мета с { по-прежнему даёт bad meta JSON', () => {
  const bad = `<!--DIEGETIC {"type": --\>\n\`\`\`html\n<body>1</body>\n\`\`\``;
  const r = parseDiegeticResponse(bad, {});
  assert.equal(r.artifacts.length, 0);
  assert.ok(r.errors.some(e => e.startsWith('bad meta JSON')));
});

test('битая пара не валит валидную перед собой (граница сегмента сохраняется)', () => {
  const raw = `<!--DIEGETIC {"type":"phone","anchor":"взял телефон"}-->\n\`\`\`html\n<body><p>ok</p></body>\n\`\`\`\n`
    + `<!--DIEGETIC {"type": --\>\n\`\`\`html\n<body>broken</body>\n\`\`\``;
  const r = parseDiegeticResponse(raw, {});
  assert.equal(r.artifacts.length, 1, 'валидный артефакт выжил');
  assert.equal(r.artifacts[0].type, 'phone');
  assert.ok(r.errors.some(e => e.startsWith('bad meta JSON')));
});

test('валидная пара после битой тоже парсится', () => {
  const raw = `<!--DIEGETIC {"type": --\>\n\`\`\`html\n<body>broken</body>\n\`\`\`\n`
    + `<!--DIEGETIC {"type":"note","anchor":"x"}-->\n\`\`\`html\n<body>2</body>\n\`\`\``;
  const r = parseDiegeticResponse(raw, {});
  assert.deepEqual(r.artifacts.map(a => a.type), ['note']);
  assert.ok(r.errors.some(e => e.startsWith('bad meta JSON')));
});

test('maxCount-обрезка не молчалива: error-запись с числом лишних', () => {
  const three = okPair + '\n' + `<!--DIEGETIC {"type":"b","anchor":"x"}-->\n\`\`\`html\n<body>2</body>\n\`\`\``
      + '\n' + `<!--DIEGETIC {"type":"c","anchor":"x"}-->\n\`\`\`html\n<body>3</body>\n\`\`\``;
  const r = parseDiegeticResponse(three, { maxCount: 1 });
  assert.equal(r.artifacts.length, 1);
  assert.ok(r.errors.some(e => /maxCount: 2 over limit 1/.test(e)), 'обрезанные артефакты видны в errors');
});
