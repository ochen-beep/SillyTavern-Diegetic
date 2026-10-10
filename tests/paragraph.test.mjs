import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasOwnBlock, stripOwnBlocks, paragraphEndAfter, applyInsertions, removeOwnBlocks } from '../src/paragraph.js';

const ART = '```html\n<body><p>x</p></body>\n```';

test('hasOwnBlock: находит наш fenced-блок', () => {
  assert.equal(hasOwnBlock(`абзац.\n\n${ART}\n\nдальше.`), true);
  assert.equal(hasOwnBlock('просто текст.'), false);
});

test('stripOwnBlocks: убирает блоки, схлопывает лишние пустые строки, дайджест прозы стабилен', () => {
  const prose = 'Первый абзац.\n\nВторой абзац.';
  const withArt = `Первый абзац.\n\n${ART}\n\nВторой абзац.`;
  assert.equal(stripOwnBlocks(withArt), prose);
});

test('paragraphEndAfter: конец абзаца = ближайший \\n\\n после матча, иначе конец текста', () => {
  const text = 'первый\n\nвторой абзац здесь\n\nтретий';
  assert.equal(paragraphEndAfter(text, text.indexOf('второй')), text.indexOf('\n\nтретий'));
  const tail = 'абзац с якорем в конце';
  assert.equal(paragraphEndAfter(tail, tail.indexOf('якорем')), tail.length);
});

test('applyInsertions: вставляет после абзаца, отделяя пустыми строками', () => {
  const text = 'Первый абзац.\n\nВторой абзац.';
  const at = text.indexOf('Второй');
  const point = paragraphEndAfter(text, at);
  const res = applyInsertions(text, [{ at: point, html: '<body><p>x</p></body>' }]);
  assert.equal(res.text, `Первый абзац.\n\nВторой абзац.\n\n\`\`\`html\n<body><p>x</p></body>\n\`\`\``);
});

test('applyInsertions: несколько вставок одним проходом, порядок сохраняется', () => {
  const text = 'А.\n\nБ.\n\nВ.';
  const p1 = paragraphEndAfter(text, 0);
  const p2 = paragraphEndAfter(text, text.indexOf('В.'));
  const res = applyInsertions(text, [{ at: p2, html: '<body>b</body>' }, { at: p1, html: '<body>a</body>' }]);
  assert.ok(res.text.indexOf('<body>a</body>') < res.text.indexOf('<body>b</body>'));
});

test('applyInsertions: вставки в одну точку сохраняют порядок массива в итоговом тексте', () => {
  const res = applyInsertions('X.', [{ at: 2, html: '<body>a</body>' }, { at: 2, html: '<body>b</body>' }]);
  assert.ok(res.text.indexOf('<body>a</body>') < res.text.indexOf('<body>b</body>'));
});

test('applyInsertions: null если блок уже есть (идемпотентность)', () => {
  assert.equal(applyInsertions(`текст\n\n${ART}`, [{ at: 5, html: '<body>x</body>' }]), null);
});

test('removeOwnBlocks: чистит текст от наших блоков', () => {
  assert.equal(removeOwnBlocks(`до\n\n${ART}\n\nпосле`), 'до\n\nпосле');
});
