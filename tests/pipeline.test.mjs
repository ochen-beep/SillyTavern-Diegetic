// tests/pipeline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline, isExcluded } from '../src/pipeline.js';
import { createGenerationCoordinator } from '../src/coordinator.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { contentDigest } from '../src/digest.js';
import { readVerifiedPayload, readRawPayload, stampPayload, writePayload } from '../src/payload.js';

const PROSE = 'Она молча взяла телефон и вышла из комнаты.\n\nДверь закрылась.';
const RESP = `<!--DIEGETIC {"type":"phone","anchor":"взяла телефон"}-->\n\`\`\`html\n<body><p>phone</p></body>\n\`\`\``;

function makeDeps({ raw = RESP, isUser = false, message = PROSE, failGen = false, seedPayload = false } = {}) {
    const msg = { is_user: isUser, mes: message, swipes: [message], swipe_id: 0, swipe_info: [{}], extra: {} };
    if (seedPayload) writePayload(msg, 0, stampPayload(msg, 0, [{ id: 'old:0', type: 'note', anchor: 'взяла телефон', status: 'ok', html: '<body>old</body>', bytes: 16, createdAt: 1, profileId: 'default' }]));
    const chat = [msg];
    const notifications = [];
    let saved = 0;
    let rendered = 0;
    const deps = {
        getMessage: (id) => chat[Number(id)] ?? null,
        generateText: async () => { if (failGen) throw new Error('api down'); return raw; },
        persistChat: () => { saved++; },
        notifyRender: () => { rendered++; },
        settings: { ...DEFAULT_SETTINGS, profiles: DEFAULT_SETTINGS.profiles.map(p => ({ ...p })) },
        coordinator: createGenerationCoordinator(),
        notify: { ready: (n) => notifications.push(['ready', n]), error: (m) => notifications.push(['error', m]) },
        getContextBlock: () => '',
        resolveTemplate: async () => 'ШАБЛОН {{CONTRACT}}',
    };
    return { deps, msg, notifications, stats: () => ({ saved, rendered }) };
}

test('happy path: payload записан в extra, текст не тронут, persist+render', async () => {
    const { deps, msg, notifications, stats } = makeDeps();
    await createPipeline(deps).run(0);
    assert.equal(msg.mes, PROSE, 'текст поста не меняется никогда');
    const p = readVerifiedPayload(msg, 0);
    assert.ok(p, 'payload читается через digest-гейт');
    assert.equal(p.artifacts.length, 1);
    assert.equal(p.artifacts[0].status, 'ok');
    assert.equal(p.artifacts[0].contentDigest, undefined);
    assert.ok(p.artifacts[0].html.includes('<p>phone</p>'));
    assert.ok(stats().saved >= 1 && stats().rendered >= 1);
    assert.ok(notifications.some(([k]) => k === 'ready'));
});

test('мусорный ответ: payload не записан, тост ошибки', async () => {
    const { deps, msg, notifications } = makeDeps({ raw: 'мусор' });
    await createPipeline(deps).run(0);
    assert.equal(readRawPayload(msg, 0), null);
    assert.ok(notifications.some(([k]) => k === 'error'));
});

test('user-пост: выход без вызова генерации', async () => {
    const { deps } = makeDeps({ isUser: true });
    let called = false;
    deps.generateText = async () => { called = true; return ''; };
    await createPipeline(deps).run(0);
    assert.equal(called, false);
});

test('payload уже есть: идемпотентный выход без генерации', async () => {
    const { deps } = makeDeps({ seedPayload: true });
    let called = false;
    deps.generateText = async () => { called = true; return RESP; };
    await createPipeline(deps).run(0);
    assert.equal(called, false);
});

test('API упал: тост с ошибкой, payload не записан', async () => {
    const { deps, msg, notifications } = makeDeps({ failGen: true });
    await createPipeline(deps).run(0);
    assert.equal(readRawPayload(msg, 0), null);
    assert.ok(notifications.some(([k]) => k === 'error'));
});

test('якорь не найден: артефакт записан со статусом orphan', async () => {
    const { deps, msg } = makeDeps({ raw: RESP.replace('взяла телефон', 'фразы нет в тексте') });
    await createPipeline(deps).run(0);
    const p = readRawPayload(msg, 0);
    assert.equal(p.artifacts[0].status, 'orphan');
});

test('выключено настройкой: выход; force: генерация работает', async () => {
    const { deps, msg } = makeDeps();
    let called = 0;
    deps.settings = { ...deps.settings, enabled: false };
    deps.generateText = async () => { called++; return RESP; };
    const p = createPipeline(deps);
    await p.run(0);
    assert.equal(called, 0);
    await p.run(0, { force: true });
    assert.equal(called, 1);
    assert.ok(readVerifiedPayload(msg, 0));
});

test('регенерация: payload перезаписан, старый артефакт замещён', async () => {
    const { deps, msg } = makeDeps();
    const p = createPipeline(deps);
    await p.run(0);
    deps.generateText = async () => `<!--DIEGETIC {"type":"note","anchor":"вышла из комнаты"}-->\n\`\`\`html\n<body>new</body>\n\`\`\``;
    await p.run(0, { force: true });
    const pl = readVerifiedPayload(msg, 0);
    assert.equal(pl.artifacts.length, 1);
    assert.ok(pl.artifacts[0].html.includes('<body>new</body>'));
});

test('мусорный ответ при force: старый payload не тронут', async () => {
    const { deps, msg, notifications } = makeDeps();
    const p = createPipeline(deps);
    await p.run(0);
    const before = readVerifiedPayload(msg, 0);
    deps.generateText = async () => 'простите, не могу';
    await p.run(0, { force: true });
    assert.equal(readVerifiedPayload(msg, 0), before, 'сбой модели не должен удалять существующие артефакты');
    assert.ok(notifications.some(([k]) => k === 'error'));
});

test('abort mid-flight: устаревший прогон ничего не пишет', async () => {
    const { deps, msg } = makeDeps();
    let resolveGen;
    deps.generateText = () => new Promise((res) => { resolveGen = res; });
    const p = createPipeline(deps);
    const runPromise = p.run(0);
    await new Promise((r) => setTimeout(r, 0)); // даём прогону дойти до generateText
    deps.coordinator.bumpMessageRevision(0);   // абортит контроллер текущего прогона
    resolveGen(RESP);                          // транспорт, игнорирующий AbortSignal
    await runPromise;
    assert.equal(readRawPayload(msg, 0), null, 'commit-гард: не-current прогон не пишет');
});

test('правка прозы во время генерации: digest-гард не даёт записать', async () => {
    const { deps, msg } = makeDeps();
    let resolveGen;
    deps.generateText = () => new Promise((res) => { resolveGen = res; });
    const p = createPipeline(deps);
    const runPromise = p.run(0);
    await new Promise((r) => setTimeout(r, 0));
    msg.swipes[0] = PROSE + ' Тишина.'; // пользовательская правка под ногами
    resolveGen(RESP);
    await runPromise;
    assert.equal(readRawPayload(msg, 0), null);
});

test('isExcluded: подстрока без учёта регистра/кавычек, пустые фразы игнорируются', () => {
    assert.equal(isExcluded('Он сказал: «Стой!» и ушёл.', ['стой']), true);
    assert.equal(isExcluded('Спокойная сцена.', ['СТОЙ', '']), false);
    assert.equal(isExcluded('Что-то.', []), false);
});

test('источник profile: generateText получает части system/user и профиль', async () => {
    const { deps, msg } = makeDeps();
    deps.settings = {
        ...deps.settings,
        profiles: [{ id: 'cm1', name: 'CM', source: 'profile', sourceConfig: { profileId: 'prof-1', profileName: 'Грок' }, templateText: '' }],
        activeProfile: 'cm1',
    };
    deps.resolveTemplate = async (p) => `ШАБЛОН[${p?.templateText ?? ''}]`;
    let received = null;
    deps.generateText = async (args) => { received = args; return RESP; };
    await createPipeline(deps).run(0);
    assert.equal(received.profile.sourceConfig.profileId, 'prof-1');
    assert.match(received.system, /ШАБЛОН\[\]/);
    assert.match(received.system, /TOOL — DIEGETIC HTML/);
    assert.match(received.user, /Пост \(создай по нему артефакт\)/);
    assert.equal(typeof received.signal?.aborted, 'boolean');
    assert.ok(readVerifiedPayload(msg, 0));
});

test('прогон по чужому digest: запись в swipe-слот и зеркало', async () => {
    const { deps, msg } = makeDeps();
    await createPipeline(deps).run(0);
    assert.ok(msg.swipe_info[0].extra.dg, 'каноничная копия в слоте варианта');
    assert.equal(msg.extra.dg, msg.swipe_info[0].extra.dg, 'зеркало показанного варианта');
    assert.equal(msg.extra.dg.contentDigest, contentDigest(PROSE));
});
