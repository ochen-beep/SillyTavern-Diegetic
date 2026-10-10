import { test } from 'node:test';
import assert from 'node:assert/strict';
import { META_KEY, readMetaMap, metaFor, recordArtifacts, removeDigest } from '../src/meta.js';

const D = 'abcd1234';
const arts = [{ id: 'a1', type: 'phone', anchor: 'взял телефон', status: 'ok', bytes: 10, createdAt: 1, profileId: 'default' }];

test('readMetaMap: отсутствие/мусор → пустая map', () => {
  assert.deepEqual(readMetaMap(undefined), {});
  assert.deepEqual(readMetaMap({ [META_KEY]: 'trash' }), {});
});

test('metaFor: ключ = digest, промах → null', () => {
  const vars = recordArtifacts({}, D, arts);
  assert.deepEqual(metaFor(vars, D).artifacts, arts);
  assert.equal(metaFor(vars, 'ffffffff'), null);
});

test('recordArtifacts: не мутирует вход, ограничивает размер map (вытеснение старых)', () => {
  let vars = {};
  for (let i = 0; i < 250; i++) {
    vars = recordArtifacts(vars, String(i).padStart(8, '0'), arts);
  }
  const map = readMetaMap(vars);
  assert.equal(Object.keys(map).length, 200);
  assert.ok(!('00000000' in map), 'самая старая запись вытеснена');
});

test('removeDigest удаляет запись', () => {
  let vars = recordArtifacts({}, D, arts);
  vars = removeDigest(vars, D);
  assert.equal(metaFor(vars, D), null);
});

test('metaFor: кривая запись под ключом → null; повторная запись заменяет', () => {
  const bad = { [META_KEY]: { abcd1234: { nope: 1 } } };
  assert.equal(metaFor(bad, 'abcd1234'), null);
  const re = recordArtifacts(recordArtifacts({}, D, arts), D, [{ id: 'a2', type: 'note', anchor: 'x', status: 'ok', bytes: 1, createdAt: 2, profileId: 'p' }]);
  const e = metaFor(re, D);
  assert.equal(e.artifacts.length, 1);
  assert.equal(e.artifacts[0].id, 'a2');
});
