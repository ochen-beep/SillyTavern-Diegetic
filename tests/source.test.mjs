import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerateConfig, generationIdFor } from '../src/source.js';

test('профиль current: без custom_api, с историей и id', () => {
  const cfg = buildGenerateConfig({ prompt: 'PROMPT', profile: { id: 'default', source: 'current' }, contextDepth: 3, generationId: 'diegetic:5:1' });
  assert.equal(cfg.user_input, 'PROMPT');
  assert.equal(cfg.max_chat_history, 3);
  assert.equal(cfg.generation_id, 'diegetic:5:1');
  assert.equal(cfg.custom_api, undefined);
  assert.equal(cfg.should_stream, false);
});

test('профиль custom: custom_api из sourceConfig', () => {
  const profile = { id: 'pro', source: 'custom', sourceConfig: { apiurl: 'https://api.example.com/v1', key: 'sk-1', model: 'gpt-x', max_tokens: 4096, temperature: 0.8 } };
  const cfg = buildGenerateConfig({ prompt: 'P', profile, contextDepth: 2, generationId: 'g' });
  assert.deepEqual(cfg.custom_api, { apiurl: 'https://api.example.com/v1', key: 'sk-1', model: 'gpt-x', max_tokens: 4096, temperature: 0.8 });
});

test('custom без конфига деградирует в current', () => {
  const cfg = buildGenerateConfig({ prompt: 'P', profile: { id: 'x', source: 'custom', sourceConfig: null }, contextDepth: 1, generationId: 'g' });
  assert.equal(cfg.custom_api, undefined);
});

test('generationIdFor формат', () => {
  assert.equal(generationIdFor(5, 7), 'diegetic:5:7');
});
