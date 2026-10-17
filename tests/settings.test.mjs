import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, loadSettings, saveSettings } from '../src/settings.js';

test('normalizeSettings: валидный ввод сохраняется, мусор — дефолты', () => {
  const s = normalizeSettings({ enabled: false, maxPerMessage: 3, contextDepth: 5, appearance: 'silent', source: 'custom' });
  assert.equal(s.enabled, false);
  assert.equal(s.maxPerMessage, 3);
  assert.equal(s.contextDepth, 5);
  assert.equal(s.appearance, 'silent');
  assert.equal(s.source, 'custom');

  const d = normalizeSettings({ maxPerMessage: 99, contextDepth: -1, appearance: 'kek', source: 'kek' });
  assert.equal(d.maxPerMessage, DEFAULT_SETTINGS.maxPerMessage);
  assert.equal(d.contextDepth, DEFAULT_SETTINGS.contextDepth);
  assert.equal(d.appearance, DEFAULT_SETTINGS.appearance);
  assert.equal(d.source, 'profile');
});

test('источник по умолчанию — profile; legacy "current" мигрирует в profile', () => {
  const s = normalizeSettings({});
  assert.equal(s.source, 'profile');
  assert.equal(normalizeSettings({ source: 'current' }).source, 'profile');
  assert.deepEqual(s.cmProfile, { profileId: '', profileName: '' }, 'профильный источник — пустая заготовка, не null');
  assert.deepEqual(s.custom, { apiurl: '', model: '' });
  assert.deepEqual(s.httpAllowList, []);
  assert.equal(s.customExtraBody, '');
});

test('load/save через абстрактное хранилище', () => {
  const backing = {};
  const storage = { get: () => backing.s, set: (v) => { backing.s = v; } };
  const s = loadSettings(storage);
  s.enabled = false;
  saveSettings(storage, s);
  assert.equal(loadSettings(storage).enabled, false);
});

test('loadSettings переживает битый JSON в хранилище', () => {
  const storage = { get: () => '{oops', set: () => {} };
  const s = loadSettings(storage);
  assert.equal(s.enabled, DEFAULT_SETTINGS.enabled);
});

test('round-trip: свой endpoint с http-allowlist', () => {
  const backing = {};
  const storage = { get: () => backing.s, set: (v) => { backing.s = v; } };
  const s = normalizeSettings({
    source: 'custom',
    custom: { apiurl: 'http://127.0.0.1:5000/v1', model: 'gemini' },
    customExtraBody: '{"reasoning_effort":"none"}',
    httpAllowList: ['http://127.0.0.1:5000'],
  });
  saveSettings(storage, s);
  const loaded = loadSettings(storage);
  assert.equal(loaded.source, 'custom');
  assert.equal(loaded.custom.apiurl, 'http://127.0.0.1:5000/v1');
  assert.equal(loaded.custom.model, 'gemini');
  assert.equal(loaded.customExtraBody, '{"reasoning_effort":"none"}');
  assert.deepEqual(loaded.httpAllowList, ['http://127.0.0.1:5000']);
});

test('round-trip: профиль CM', () => {
  const backing = {};
  const storage = { get: () => backing.s, set: (v) => { backing.s = v; } };
  saveSettings(storage, normalizeSettings({ source: 'profile', cmProfile: { profileId: 'p1', profileName: 'Грок' } }));
  const loaded = loadSettings(storage);
  assert.equal(loaded.source, 'profile');
  assert.deepEqual(loaded.cmProfile, { profileId: 'p1', profileName: 'Грок' });
});

test('миграция: профильный список → один источник (CM)', () => {
  const s = normalizeSettings({
    profiles: [{ id: 'cm', name: 'CM', source: 'profile', sourceConfig: { profileId: 'p1', profileName: 'Грок' } }],
    activeProfile: 'cm',
  });
  assert.equal(s.source, 'profile');
  assert.deepEqual(s.cmProfile, { profileId: 'p1', profileName: 'Грок' });
  assert.deepEqual(s.templates, {}, 'текстовых шаблонов из профиля не было');
  // Повторная нормализация уже нормализованных — источник не переезжает второй раз
  const again = normalizeSettings(s);
  assert.equal(again.source, 'profile');
  assert.deepEqual(again.cmProfile, { profileId: 'p1', profileName: 'Грок' });
});

test('миграция: профильный список → custom endpoint', () => {
  const s = normalizeSettings({
    profiles: [{ id: 'c', name: 'C', source: 'custom', sourceConfig: { apiurl: 'https://x/v1', model: 'm1' } }],
    activeProfile: 'c',
  });
  assert.equal(s.source, 'custom');
  assert.deepEqual(s.custom, { apiurl: 'https://x/v1', model: 'm1' });
  assert.equal(s.cmProfile, null);
});

test('миграция: legacy lensText старых профилей переезжает в именованные шаблоны', () => {
  const s = normalizeSettings({ profiles: [
    { id: 'old1', name: 'O1', lensText: '@universal' },
    { id: 'old2', name: 'O2', lensText: '{{CONTRACT}}\nкастом' },
  ] });
  assert.deepEqual(s.templates, { O2: '{{CONTRACT}}\nкастом' }, 'сентинел @universal не импортируется');
  assert.equal(s.activeTemplate, 'universal');
});

test('миграция: профильные templateText переезжают в именованные шаблоны один раз', () => {
  const s = normalizeSettings({
    profiles: [
      { id: 'a', name: 'Стиль А', source: 'current', templateText: '{{CONTRACT}}\nА' },
      { id: 'b', name: 'Пустой', templateText: '' },
    ],
  });
  assert.deepEqual(s.templates, { 'Стиль А': '{{CONTRACT}}\nА' });
  const again = normalizeSettings(s);
  assert.deepEqual(again.templates, { 'Стиль А': '{{CONTRACT}}\nА' });
});

test('enabled: автогенерация выключена по умолчанию, включается только явно', () => {
  assert.equal(normalizeSettings({}).enabled, false, 'нет значения → выключена');
  assert.equal(normalizeSettings({ enabled: 'yes' }).enabled, false, 'мусор → выключена');
  assert.equal(normalizeSettings({ enabled: false }).enabled, false);
  assert.equal(normalizeSettings({ enabled: true }).enabled, true, 'явное включение сохраняется');
});

test('ctxHistory: тумблер истории чата, включён по умолчанию', () => {
  assert.equal(normalizeSettings({}).ctxHistory, true);
  assert.equal(normalizeSettings({ ctxHistory: false }).ctxHistory, false);
  assert.equal(normalizeSettings({ ctxHistory: 'no' }).ctxHistory, true, 'мусор → дефолт');
});

test('templates: мусор отбрасывается, активное имя по умолчанию', () => {
  const s = normalizeSettings({ templates: { 'Мой': 'текст', '': 'безымянный', universal: 'тень встроенного', ok: 7 } });
  assert.deepEqual(s.templates, { 'Мой': 'текст' }, 'пустые имена, тени встроенных и не-строки — вон');
  assert.equal(s.activeTemplate, 'universal');
  assert.deepEqual(normalizeSettings({ templates: 'мусор' }).templates, {});
  assert.equal(normalizeSettings({ activeTemplate: 'Мой' }).activeTemplate, 'Мой');
});

test('displayMode: валидный сохраняется, мусор — inline', () => {
  assert.equal(normalizeSettings({ displayMode: 'popup' }).displayMode, 'popup');
  assert.equal(normalizeSettings({ displayMode: 'expand' }).displayMode, 'expand');
  assert.equal(normalizeSettings({ displayMode: 'fullscreen' }).displayMode, 'inline');
  assert.equal(normalizeSettings({}).displayMode, 'inline');
});
