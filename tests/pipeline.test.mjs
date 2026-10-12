// tests/pipeline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline, isExcluded } from '../src/pipeline.js';
import { createGenerationCoordinator } from '../src/coordinator.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { META_KEY } from '../src/meta.js';
import { contentDigest } from '../src/digest.js';

const PROSE = 'Она молча взяла телефон и вышла из комнаты.\n\nДверь закрылась.';
const RESP = `<!--DIEGETIC {"pulse":true,"type":"phone","anchor":"взяла телефон"}-->\n\`\`\`html\n<body><p>phone</p></body>\n\`\`\``;

function makeDeps({ raw = RESP, role = 'assistant', message = PROSE, failGen = false } = {}) {
    const messages = { 0: { message_id: 0, role, message, swipes: [message], swipe_id: 0 } };
    const chatVars = {};
    const notifications = [];
    // insertOrAssignVariables реального раннера — глубокий merge (lodash mergeWith):
    // объекты сливаются рекурсивно, массивы заменяются целиком, отсутствующие ключи сохраняются.
    const deepAssign = (target, source) => {
        for (const [k, v] of Object.entries(source)) {
            const cur = target[k];
            if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) deepAssign(cur, v);
            else target[k] = v; // массивы и скаляры → rhs
        }
        return target;
    };
    const api = {
        getChatMessages: (range) => {
            if (String(range) === '0') return [messages[0]];
            if (String(range) === '-1') return [messages[0]];
            return [];
        },
        setChatMessages: async (updates) => {
            for (const u of updates) messages[u.message_id] = { ...messages[u.message_id], ...u };
        },
        generateRaw: async (cfg) => { if (failGen) throw new Error('api down'); return raw; },
        getVariables: () => chatVars,
        insertOrAssignVariables: (vars) => deepAssign(chatVars, vars),
    };
    const deps = {
        api,
        settings: { ...DEFAULT_SETTINGS },
        coordinator: createGenerationCoordinator(),
        notify: { ready: (n) => notifications.push(['ready', n]), error: (m) => notifications.push(['error', m]) },
        getContextBlock: () => '',
    };
    return { deps, messages, chatVars, notifications, api };
}

test('happy path: артефакт вставлен, метаданные под digest прозы, refresh affected', () => {
  const { deps, messages, chatVars, notifications } = makeDeps();
  const p = createPipeline(deps);
  return p.run(0).then(() => {
    assert.match(messages[0].message, /```html\n<body><p>phone<\/p><\/body>\n```/);
    assert.match(messages[0].message, /взяла телефон[\s\S]*```html/);
    const meta = chatVars[META_KEY];
    const proseDigest = contentDigest(PROSE);
    assert.ok(meta[proseDigest].artifacts.length === 1);
    assert.equal(meta[proseDigest].artifacts[0].status, 'ok');
    assert.ok(notifications.some(([k]) => k === 'ready'));
  });
});

test('pulse=false: текст не тронут, уведомлений нет', async () => {
  const { deps, messages, notifications } = makeDeps({ raw: '<!--DIEGETIC {"pulse":false}-->' });
  await createPipeline(deps).run(0);
  assert.equal(messages[0].message, PROSE);
  assert.equal(notifications.length, 0);
});

test('role != assistant: выход без вызова', async () => {
  const { deps, api } = makeDeps({ role: 'user' });
  let called = false;
  deps.api = { ...api, generateRaw: async () => { called = true; return ''; } };
  await createPipeline(deps).run(0);
  assert.equal(called, false);
});

test('уже есть наш блок: идемпотентный выход', async () => {
  const { deps, messages, api } = makeDeps({ message: PROSE + '\n\n```html\n<body>old</body>\n```' });
  let called = false;
  deps.api = { ...api, generateRaw: async () => { called = true; return RESP; } };
  await createPipeline(deps).run(0);
  assert.equal(called, false);
  assert.ok(messages[0].message.includes('<body>old</body>'));
});

test('API упал: тост с ошибкой, текст не тронут', async () => {
  const { deps, messages, notifications } = makeDeps({ failGen: true });
  await createPipeline(deps).run(0);
  assert.equal(messages[0].message, PROSE);
  assert.ok(notifications.some(([k]) => k === 'error'));
});

test('якорь не найден: orphan-метаданные, текст не тронут', async () => {
  const { deps, chatVars } = makeDeps();
  const badRaw = RESP.replace('взяла телефон', 'фразы нет в тексте');
  deps.api = { ...deps.api, generateRaw: async () => badRaw };
  await createPipeline(deps).run(0);
  const meta = chatVars[META_KEY][contentDigest(PROSE)];
  assert.equal(meta.artifacts[0].status, 'orphan');
});

test('выключено настройкой: выход', async () => {
  const { deps, api } = makeDeps();
  let called = false;
  deps.settings = { ...DEFAULT_SETTINGS, enabled: false };
  deps.api = { ...api, generateRaw: async () => { called = true; return RESP; } };
  await createPipeline(deps).run(0);
  assert.equal(called, false);
});

test('выключено + force: ручная генерация работает, артефакт вставлен', async () => {
  const { deps, messages, chatVars, api } = makeDeps();
  let called = false;
  deps.settings = { ...DEFAULT_SETTINGS, enabled: false };
  deps.api = { ...api, generateRaw: async () => { called = true; return RESP; } };
  await createPipeline(deps).run(0, { force: true });
  assert.equal(called, true);
  assert.match(messages[0].message, /```html\n<body><p>phone<\/p><\/body>\n```/);
  assert.ok(chatVars[META_KEY][contentDigest(PROSE)].artifacts.length === 1);
});

test('регенерация: старые блоки сняты, новые вставлены', async () => {
  const { deps, messages } = makeDeps();
  const p = createPipeline(deps);
  await p.run(0);
  const withOld = messages[0].message;
  deps.api.generateRaw = async () => `<!--DIEGETIC {"pulse":true,"type":"note","anchor":"вышла из комнаты"}-->\n\`\`\`html\n<body>new</body>\n\`\`\``;
  await p.run(0, { force: true });
  assert.notEqual(messages[0].message, withOld);
  assert.ok(messages[0].message.includes('<body>new</body>'));
  assert.ok(!messages[0].message.includes('<p>phone</p>'));
});

test('force + pulse=false: старые блоки сняты, уведомление', async () => {
  const { deps, messages, chatVars, notifications } = makeDeps();
  const p = createPipeline(deps);
  await p.run(0);
  assert.ok(messages[0].message.includes('<body>'));
  deps.api.generateRaw = async () => '<!--DIEGETIC {"pulse":false}-->';
  await p.run(0, { force: true });
  assert.equal(messages[0].message, PROSE);
  assert.ok(notifications.some(([, m]) => m.includes('сняты')));
  // глубокий merge раннера не удаляет ключи: запись очищается (artifacts: []), а не исчезает
  const cleared = chatVars[META_KEY][contentDigest(PROSE)];
  assert.ok(cleared, 'digest-запись должна остаться в карте');
  assert.deepEqual(cleared.artifacts, []);
});

test('force + pulse=false без старых блоков: честный тост вместо тишины', async () => {
  const { deps, messages, notifications } = makeDeps({ raw: '<!--DIEGETIC {"pulse":false}-->' });
  await createPipeline(deps).run(0, { force: true });
  assert.equal(messages[0].message, PROSE);
  assert.ok(notifications.some(([, m]) => m.includes('модель отказалась от артефакта')));
});

test('abort mid-flight: stopGenerationById вызван с generation_id прогона', async () => {
  const { deps, messages, api } = makeDeps();
  const stopIds = [];
  let resolveGen;
  deps.api = {
    ...api,
    generateRaw: () => new Promise((res) => { resolveGen = res; }),
    stopGenerationById: (id) => stopIds.push(id),
  };
  const p = createPipeline(deps);
  const runPromise = p.run(0);
  await new Promise((r) => setTimeout(r, 0)); // даём прогону дойти до generateRaw
  deps.coordinator.bumpMessageRevision(0);   // абортит контроллер текущего прогона
  assert.equal(stopIds.length, 1);
  assert.match(stopIds[0], /^diegetic:0:\d+$/);
  resolveGen(RESP);                          // завершаем висящий вызов, прогон увидит не-current
  await runPromise;
  assert.equal(messages[0].message, PROSE);  // абортнутый прогон ничего не записал
});

test('happy path: setChatMessages получает refresh=affected', async () => {
  const { deps, api } = makeDeps();
  const calls = [];
  deps.api = { ...api, setChatMessages: async (...args) => { calls.push(args); } };
  await createPipeline(deps).run(0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { refresh: 'affected' });
});

test('isExcluded: подстрока без учёта регистра/кавычек, пустые фразы игнорируются', () => {
  assert.equal(isExcluded('Он сказал: «Стой!» и ушёл.', ['стой']), true);
  assert.equal(isExcluded('Спокойная сцена.', ['СТОЙ', '']), false);
  assert.equal(isExcluded('Что-то.', []), false);
});

test('источник profile: генерация через cmGenerate, generateRaw не вызывается', async () => {
  const { deps, messages, chatVars, notifications, api } = makeDeps();
  let cmCalled = 0;
  let rawCalled = 0;
  let received = null;
  deps.settings = {
    ...DEFAULT_SETTINGS,
    profiles: [{ id: 'cm1', name: 'CM', source: 'profile', sourceConfig: { profileId: 'prof-1', profileName: 'Грок' }, lensText: '' }],
    activeProfile: 'cm1',
  };
  deps.lensResolver = (p) => `ЛИНЗА[${p?.lensText ?? ''}]`;
  deps.api = {
    ...api,
    generateRaw: async () => { rawCalled++; return RESP; },
    cmGenerate: async (args) => { cmCalled++; received = args; return RESP; },
  };
  await createPipeline(deps).run(0);
  assert.equal(cmCalled, 1);
  assert.equal(rawCalled, 0);
  assert.equal(received.profile.sourceConfig.profileId, 'prof-1');
  assert.match(received.system, /ЛИНЗА\[\]/);
  assert.match(received.system, /TOOL — DIEGETIC HTML/);
  assert.match(received.user, /Пост \(создай по нему артефакт\)/);
  assert.ok(messages[0].message.includes('<body><p>phone</p></body>'));
  assert.ok(notifications.some(([k]) => k === 'ready'));
});

test('источник profile: ошибка cmGenerate — тост с ошибкой, текст не тронут', async () => {
  const { deps, messages, notifications, api } = makeDeps();
  deps.settings = {
    ...DEFAULT_SETTINGS,
    profiles: [{ id: 'cm1', name: 'CM', source: 'profile', sourceConfig: { profileId: 'prof-1' }, lensText: '' }],
    activeProfile: 'cm1',
  };
  deps.api = { ...api, generateRaw: async () => RESP, cmGenerate: async () => { throw new Error('CM недоступен'); } };
  await createPipeline(deps).run(0);
  assert.equal(messages[0].message, PROSE);
  assert.ok(notifications.some(([, m]) => m.includes('CM недоступен')));
});
