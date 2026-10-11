import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings, loadSettings, saveSettings } from '../src/settings.js';

test('normalizeSettings: валидный ввод сохраняется, мусор — дефолты', () => {
  const s = normalizeSettings({ enabled: false, maxPerMessage: 3, contextDepth: 5, appearance: 'silent', activeProfile: 'pro' });
  assert.equal(s.enabled, false);
  assert.equal(s.maxPerMessage, 3);
  assert.equal(s.contextDepth, 5);
  assert.equal(s.appearance, 'silent');
  assert.equal(s.activeProfile, 'pro');

  const d = normalizeSettings({ maxPerMessage: 99, contextDepth: -1, appearance: 'kek' });
  assert.equal(d.maxPerMessage, DEFAULT_SETTINGS.maxPerMessage);
  assert.equal(d.contextDepth, DEFAULT_SETTINGS.contextDepth);
  assert.equal(d.appearance, DEFAULT_SETTINGS.appearance);
});

test('нормализация не даёт потерять дефолтный профиль', () => {
  const s = normalizeSettings({});
  assert.ok(Array.isArray(s.profiles) && s.profiles.length >= 1);
  assert.ok(s.profiles.some(p => p.id === 'default'));
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

test('round-trip кастомного профиля через save/load', () => {
  const backing = {};
  const storage = { get: () => backing.s, set: (v) => { backing.s = v; } };
  const s = normalizeSettings({ profiles: [{ id: 'pro', name: 'Pro', source: 'custom', sourceConfig: { apiurl: 'https://x/v1', key: 'sk-1', model: 'm' } }], activeProfile: 'pro' });
  saveSettings(storage, s);
  const loaded = loadSettings(storage);
  const p = loaded.profiles.find(x => x.id === 'pro');
  assert.ok(p, 'профиль пережил round-trip');
  assert.equal(p.source, 'custom');
  assert.equal(p.sourceConfig.key, 'sk-1');
  assert.equal(loaded.activeProfile, 'pro');
});

test('lensText переживает normalizeSettings и save/load round-trip', () => {
  const backing = {};
  const storage = { get: () => backing.s, set: (v) => { backing.s = v; } };
  const s = normalizeSettings({ profiles: [{ id: 'a', name: 'A', source: 'current', lensText: '{{CONTRACT}}\nСтиль линзы' }], activeProfile: 'a' });
  assert.equal(s.profiles[0].lensText, '{{CONTRACT}}\nСтиль линзы');
  assert.equal(normalizeSettings({ profiles: [{ id: 'b', name: 'B' }] }).profiles[0].lensText, '', 'без lensText → пустая строка');
  saveSettings(storage, s);
  const loaded = loadSettings(storage);
  assert.equal(loaded.profiles[0].lensText, '{{CONTRACT}}\nСтиль линзы');
});

test('дефолтный профиль: источник current, линза — сентинел встроенной универсальной', () => {
  const s = normalizeSettings({});
  const d = s.profiles.find(p => p.id === 'default');
  assert.ok(d, 'дефолтный профиль на месте');
  assert.equal(d.source, 'current');
  assert.equal(d.lensText, '@universal');
  assert.equal(d.name, 'Универсальный');
});

test('источник profile (Connection Manager): сохраняется с sourceConfig.profileId', () => {
  const backing = {};
  const storage = { get: () => backing.s, set: (v) => { backing.s = v; } };
  const s = normalizeSettings({
    profiles: [{ id: 'cm', name: 'CM', source: 'profile', sourceConfig: { profileId: 'p1', profileName: 'Грок' } }],
    activeProfile: 'cm',
  });
  assert.equal(s.profiles[0].source, 'profile');
  assert.equal(s.profiles[0].sourceConfig.profileId, 'p1');
  saveSettings(storage, s);
  const p = loadSettings(storage).profiles[0];
  assert.equal(p.source, 'profile');
  assert.equal(p.sourceConfig.profileName, 'Грок');
});

test('мусорный source деградирует в current', () => {
  const s = normalizeSettings({ profiles: [{ id: 'x', name: 'X', source: 'kek' }] });
  assert.equal(s.profiles[0].source, 'current');
});
