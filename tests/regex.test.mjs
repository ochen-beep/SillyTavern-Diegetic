// tests/regex.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGEX_SCRIPT_NAME, buildMergedRegexes, ensurePromptStripRegex } from '../src/regex.js';

const ours = () => buildMergedRegexes([]).regexes.find(r => r.script_name === REGEX_SCRIPT_NAME);

test('создаёт prompt-only скрипт с нужными полями (snake_case раннера)', () => {
  const r = ours();
  assert.equal(r.find_regex, '/```html[\\s\\S]*?```/g');
  assert.equal(r.replace_string, '[диегетический артефакт]');
  assert.equal(r.destination.display, false);
  assert.equal(r.destination.prompt, true);
  assert.equal(r.source.ai_output, true);
  assert.equal(r.enabled, true);
});

test('идемпотентность: наш скрипт уже есть и корректен → changed=false', () => {
  const first = buildMergedRegexes([]);
  assert.equal(first.changed, true);
  const second = buildMergedRegexes(first.regexes);
  assert.equal(second.changed, false);
});

test('наш устаревший скрипт обновляется, чужие не трогаются', () => {
  const first = buildMergedRegexes([]);
  const stale = first.regexes.map(r => r.script_name === REGEX_SCRIPT_NAME ? { ...r, replace_string: 'old' } : r);
  const other = { id: 'x', script_name: 'чужой', enabled: true, find_regex: 'a', replace_string: 'b', trim_strings: [], source: { user_input: true, ai_output: true, slash_command: false, world_info: false, reasoning: false }, destination: { display: true, prompt: false }, run_on_edit: true, min_depth: null, max_depth: null };
  const res = buildMergedRegexes([...stale, other]);
  assert.equal(res.changed, true);
  const fixed = res.regexes.find(r => r.script_name === REGEX_SCRIPT_NAME);
  assert.equal(fixed.replace_string, '[диегетический артефакт]');
  assert.ok(res.regexes.includes(other));
});

test('ensurePromptStripRegex: пишет только при changed', async () => {
  const calls = { get: 0, replace: 0 };
  let stored = []; // как реальный хост: изначально нашего скрипта в глобальном списке нет
  const api = {
    getTavernRegexes: async () => { calls.get++; return stored; },
    replaceTavernRegexes: async (r) => { calls.replace++; stored = r; return r; },
  };
  await ensurePromptStripRegex(api);
  assert.equal(calls.get, 1);
  assert.equal(calls.replace, 1);
  await ensurePromptStripRegex(api);
  assert.equal(calls.get, 2);
  assert.equal(calls.replace, 1, 'второй вызов не пишет — changed=false');
});
