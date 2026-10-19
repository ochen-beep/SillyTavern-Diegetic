// tests/pipeline.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline, isExcluded } from '../src/pipeline.js';
import { createGenerationCoordinator } from '../src/coordinator.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { contentDigest } from '../src/digest.js';
import { readVerifiedPayload, readRawPayload, stampPayload, writePayload, dgMessageId } from '../src/payload.js';
import { _testSetEntries, readEntry } from '../src/store.js';

const PROSE = 'Она молча взяла телефон и вышла из комнаты.\n\nДверь закрылась.';
const RESP = `<!--DIEGETIC {"type":"phone","anchor":"взяла телефон"}-->\n\`\`\`html\n<body><p>phone</p></body>\n\`\`\``;

beforeEach(() => _testSetEntries({}));

function makeDeps({ raw = RESP, isUser = false, message = PROSE, failGen = false, seedPayload = false } = {}) {
    const msg = { is_user: isUser, mes: message, swipes: [message], swipe_id: 0, swipe_info: [{ send_date: 'd0' }], extra: {}, send_date: 'd0' };
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
        // Автогенерация включена явно: дефолт настроек теперь — выключена.
        settings: { ...DEFAULT_SETTINGS, enabled: true },
        // Дескриптор источника хост собирает из настроек (форма DS-Comments).
        getSourceProfile: () => ({ id: 'source', name: 'Источник', source: 'current', sourceConfig: null }),
        coordinator: createGenerationCoordinator(),
        notify: { ready: (n) => notifications.push(['ready', n]), error: (m) => notifications.push(['error', m]) },
        getContextBlock: () => '',
        resolveTemplate: async () => 'ШАБЛОН {{CONTRACT}}',
    };
    return { deps, msg, notifications, stats: () => ({ saved, rendered }) };
}

test('happy path: payload записан в store, текст не тронут, persist+render', async () => {
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

test('свайп: у нового варианта своя send_date, чужих артефактов нет — генерация идёт', async () => {
    // В файловом хранилище варианты адресуются send_date'ой: новый свайп
    // получает новую дату от ST, запись соседнего варианта ему не видна —
    // прогон обязан генерировать, а не молча выходить.
    const OTHER = 'Другой вариант текста поста.';
    const { deps, msg } = makeDeps();
    msg.swipes = [PROSE, OTHER];
    msg.swipe_info = [{ send_date: 'd0' }, { send_date: 'd1' }];
    writePayload(msg, 1, stampPayload(msg, 1, [
        { id: 'other:0', type: 'note', anchor: 'x', status: 'ok', html: '<b>other</b>', bytes: 11, createdAt: 1, profileId: 'default' },
    ]));
    assert.equal(readRawPayload(msg, 0), null, 'у варианта 0 своих артефактов нет');
    let called = 0;
    deps.generateText = async () => { called++; return RESP; };
    await createPipeline(deps).run(0);
    assert.equal(called, 1, 'запись соседнего варианта не должна гасить автогенерацию');
    const p = readVerifiedPayload(msg, 0);
    assert.ok(p, 'для нового варианта записан свой payload');
    assert.ok(p.artifacts[0].html.includes('<p>phone</p>'));
    assert.ok(readRawPayload(msg, 1), 'payload соседнего варианта цел');
});

test('API упал: тост с ошибкой, payload не записан', async () => {
    const { deps, msg, notifications } = makeDeps({ failGen: true });
    await createPipeline(deps).run(0);
    assert.equal(readRawPayload(msg, 0), null);
    assert.ok(notifications.some(([k]) => k === 'error'));
});

test('якорь не найден: артефакт записан со статусом orphan и ready-уведомлением (рендер ставит в конец поста)', async () => {
    const { deps, msg, notifications } = makeDeps({ raw: RESP.replace('взяла телефон', 'фразы нет в тексте') });
    await createPipeline(deps).run(0);
    const p = readRawPayload(msg, 0);
    assert.equal(p.artifacts[0].status, 'orphan');
    assert.ok(notifications.some(([k, m]) => k === 'ready' && /в конец поста/.test(String(m))));
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

test('частичный отсев: валидная пара записана, битая — тостом, не молча', async () => {
    const { deps, msg, notifications } = makeDeps();
    deps.settings = { ...deps.settings, maxPerMessage: 3 };
    deps.generateText = async () =>
        `<!--DIEGETIC {"type":"phone","anchor":"взяла телефон"}-->\n\`\`\`html\n<body><p>ok</p></body>\n\`\`\`\n`
        + `<!--DIEGETIC {"type": --\>\n\`\`\`html\n<body>broken</body>\n\`\`\``;
    await createPipeline(deps).run(0);
    const p = readVerifiedPayload(msg, 0);
    assert.ok(p, 'валидный артефакт записан');
    assert.equal(p.artifacts.length, 1);
    assert.ok(
        notifications.some(([k, m]) => k === 'error' && /отброшено 1/.test(String(m))),
        'частичный отсев озвучен тостом',
    );
});

test('isExcluded: подстрока без учёта регистра/кавычек, пустые фразы игнорируются', () => {
    assert.equal(isExcluded('Он сказал: «Стой!» и ушёл.', ['стой']), true);
    assert.equal(isExcluded('Спокойная сцена.', ['СТОЙ', '']), false);
    assert.equal(isExcluded('Что-то.', []), false);
});

test('источник profile: generateText получает части system/user и профиль', async () => {
    const { deps, msg } = makeDeps();
    deps.getSourceProfile = () => ({
        id: 'source', name: 'Источник', source: 'profile',
        sourceConfig: { profileId: 'prof-1', profileName: 'Грок' },
    });
    deps.resolveTemplate = async () => 'ШАБЛОН';
    let received = null;
    deps.generateText = async (args) => { received = args; return RESP; };
    await createPipeline(deps).run(0);
    assert.equal(received.profile.sourceConfig.profileId, 'prof-1');
    assert.match(received.system, /ШАБЛОН/);
    assert.match(received.system, /TOOL — DIEGETIC HTML/);
    assert.match(received.user, /^TASK: Design new diegetic HTML object/);
    assert.match(received.user, /Post \(the artifact target\):/);
    assert.equal(typeof received.signal?.aborted, 'boolean');
    assert.ok(readVerifiedPayload(msg, 0));
});

test('прогон: запись в store под dg_id:слот, сообщение чистое', async () => {
    const { deps, msg } = makeDeps();
    await createPipeline(deps).run(0);
    const key = `${dgMessageId(msg)}:0`;
    assert.ok(readEntry(key), 'запись в store под dg_id варианта');
    assert.equal(readEntry(key).contentDigest, contentDigest(PROSE));
    assert.equal(msg.swipe_info[0].extra?.dg, undefined, 'слот extra чист');
    assert.equal(msg.extra?.dg, undefined, 'зеркала больше нет');
});

test('индекс сдвинулся удалением соседа: коммит находит пост по dg_id', async () => {
    // Регрессия: за время генерации удалили соседний пост — индексы сдвинулись,
    // запись по старому индексу ушла бы чужому сообщению или в никуда.
    const { deps, msg, notifications } = makeDeps();
    deps.notify.warn = (m) => notifications.push(['warn', m]);
    const neighbor = { is_user: false, mes: 'сосед', swipes: ['сосед'], swipe_id: 0, swipe_info: [{ send_date: 'dn' }], send_date: 'dn', extra: {} };
    const chat = [neighbor, msg];
    deps.getMessage = (id) => chat[Number(id)] ?? null;
    deps.getMessageByDgId = (dgId) => chat.find((m) => m?.extra?.dg_id === dgId) ?? null;
    deps.generateText = async () => {
        chat.shift(); // сосед удалён во время генерации: msg теперь индекс 0
        return RESP;
    };
    await createPipeline(deps).run(1); // прогон стартовал по индексу 1
    const p = readVerifiedPayload(msg, 0);
    assert.ok(p, 'ответ записан своему сообщению, несмотря на сдвиг индекса');
    assert.equal(p.artifacts[0].status, 'ok');
});

const SLOT_ART = '<body><div class="photo" data-dg-img="img: old prompt" style="position:relative;height:100px"><b>ph</b></div></body>';
const seedSlotPayload = (msg) => writePayload(msg, 0, stampPayload(msg, 0,
    [{ id: 'd:0', type: 'photo', anchor: 'взяла телефон', status: 'ok', html: SLOT_ART, bytes: SLOT_ART.length, createdAt: 1, profileId: 'default' }]));

test('updateSlotPrompt: промпт переписан, persist+render, без регенерации — просто запись', async () => {
    const { deps, msg, stats } = makeDeps();
    seedSlotPayload(msg);
    await createPipeline(deps).updateSlotPrompt(0, 'd:0', 0, { trigger: 'scene', desc: 'rain over the pier', regenerate: false });
    const out = readVerifiedPayload(msg, 0).artifacts[0].html;
    assert.ok(out.includes('data-dg-img="scene: rain over the pier"'));
    assert.ok(stats().saved >= 1 && stats().rendered >= 1);
});

test('updateSlotPrompt: regenerate=true идёт в URIS-мост и меняет фото', async () => {
    const { deps, msg } = makeDeps();
    seedSlotPayload(msg);
    const calls = [];
    globalThis.URIS = {
        ready: Promise.resolve(),
        generate: async (req) => { calls.push(req); return { imagePath: 'user/images/new.png', cardId: 'card-new' }; },
        removeCard: async () => {},
    };
    try {
        await createPipeline(deps).updateSlotPrompt(0, 'd:0', 0, { trigger: 'scene', desc: 'new scene', regenerate: true });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].prompt, 'new scene');
        assert.equal(calls[0].trigger, 'scene');
        const out = readVerifiedPayload(msg, 0).artifacts[0].html;
        assert.ok(out.includes('src="/user/images/new.png"'));
        assert.ok(out.includes('data-dg-img-state="done"'));
    } finally { delete globalThis.URIS; }
});

test('updateSlotPrompt: пустое описание — тост ошибки, payload не тронут', async () => {
    const { deps, msg, notifications } = makeDeps();
    seedSlotPayload(msg);
    await createPipeline(deps).updateSlotPrompt(0, 'd:0', 0, { trigger: null, desc: '   ', regenerate: true });
    assert.ok(notifications.some(([k]) => k === 'error'));
    assert.ok(readVerifiedPayload(msg, 0).artifacts[0].html.includes('img: old prompt'));
});

test('fillImageSlots: аборт прогона (свайп/правка) отменяет генерацию и сбрасывает loading', async () => {
    const { deps, msg } = makeDeps();
    seedSlotPayload(msg);
    let gotSignal = null;
    globalThis.URIS = {
        ready: Promise.resolve(),
        generate: (req, opts) => {
            gotSignal = opts.signal;
            return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))));
        },
        removeCard: async () => {},
    };
    try {
        const p = createPipeline(deps);
        const fill = p.fillImageSlots(0);
        await new Promise(r => setTimeout(r, 10)); // дать заливке дойти до generate
        assert.ok(gotSignal, 'сигнал доходит до URIS-моста');
        deps.coordinator.bumpMessageRevision(msg.extra.dg_id); // свайп/правка поста (ключ прогона — dg_id)
        await fill;
        assert.ok(gotSignal.aborted, 'мост получил аборт');
        assert.ok(!readVerifiedPayload(msg, 0).artifacts[0].html.includes('data-dg-img-state'), 'слот сброшен из loading');
    } finally { delete globalThis.URIS; }
});

// ── Смена текста за время генерации: ответ спасается, а не выбрасывается ──

test('устаревший прогон без смены текста: ответ спасён и показан', async () => {
    const { deps, msg, notifications } = makeDeps();
    deps.notify.warn = (m) => notifications.push(['warn', m]);
    // Транспорт, игнорирующий AbortSignal (напр. CM): ревизия поднялась
    // (свайп туда-обратно, пустая правка), текст слота не менялся.
    deps.generateText = async () => { deps.coordinator.bumpMessageRevision(msg.extra.dg_id); return RESP; };
    await createPipeline(deps).run(0);
    const p = readVerifiedPayload(msg, 0);
    assert.ok(p, 'текст тот же — payload верифицируется');
    assert.equal(p.artifacts[0].type, 'phone');
    assert.ok(notifications.some(([k]) => k === 'ready'), 'оплаченный ответ записан');
});

test('пост изменился за время генерации: payload спасён с исходным дайджестом', async () => {
    const { deps, msg, notifications } = makeDeps();
    deps.generateText = async () => {
        msg.mes = PROSE + ' Дописано.'; // прямая мутация мимо MESSAGE_EDITED
        msg.swipes[0] = msg.mes;
        return RESP;
    };
    await createPipeline(deps).run(0);
    const raw = readRawPayload(msg, 0);
    assert.ok(raw, 'оплаченный ответ не выбрасывается');
    assert.equal(raw.contentDigest, contentDigest(PROSE), 'штамп — исходный текст');
    assert.equal(readVerifiedPayload(msg, 0), null, 'для нового текста он stale — усыновит rebind');
    assert.ok(notifications.some(([k, m]) => k === 'ready' && /пост изменился/.test(String(m))));
});

test('свайп во время генерации: ответ спасается в СВОЙ слот, чужой не тронут', async () => {
    const { deps, msg } = makeDeps();
    deps.generateText = async () => {
        msg.swipes = [PROSE, 'Совсем другой текст поста.'];
        msg.swipe_info = [{}, {}];
        msg.swipe_id = 1;
        deps.coordinator.bumpMessageRevision(msg.extra.dg_id);
        return RESP;
    };
    await createPipeline(deps).run(0);
    const p = readRawPayload(msg, 0);
    assert.ok(p, 'артефакты дождались слота исходного варианта');
    assert.equal(p.contentDigest, contentDigest(PROSE));
    assert.ok(readVerifiedPayload(msg, 0), 'свайп назад показывает их без перегенерации');
    assert.equal(readRawPayload(msg, 1), null, 'вариант 1 не загрязнён');
});

test('поздний ответ старого прогона не затирает свежие артефакты поста', async () => {
    const { deps, msg, notifications } = makeDeps();
    deps.notify.warn = (m) => notifications.push(['warn', m]);
    deps.generateText = async () => {
        // Конкурирующий (более новый) прогон успел закоммитить и сменить текст
        msg.mes = PROSE + ' Дописано.';
        msg.swipes[0] = msg.mes;
        writePayload(msg, 0, stampPayload(msg, 0, [
            { id: 'fresh:0', type: 'note', anchor: 'x', status: 'ok', html: '<body>fresh</body>', bytes: 14, createdAt: 2, profileId: 'p' },
        ]));
        return RESP; // запоздавший ответ прежнего прогона
    };
    await createPipeline(deps).run(0);
    const p = readVerifiedPayload(msg, 0);
    assert.ok(p?.artifacts[0].html.includes('<body>fresh</body>'), 'свежий payload цел');
    assert.ok(notifications.some(([k, m]) => k === 'warn' && /не записан/.test(m)));
});

test('прогон ключуется dg_id: отмена по свежему индексу находит, по сместившемуся индексу — нет', async () => {
    const { deps, msg } = makeDeps();
    let resolveGen;
    deps.generateText = () => new Promise((res) => { resolveGen = res; });
    const runPromise = createPipeline(deps).run(0);
    await new Promise((r) => setTimeout(r, 0)); // dg_id создан, прогон в координаторе
    const dgId = msg.extra.dg_id;
    assert.equal(deps.coordinator.abortKind('0', 'gen'), false, 'индекс — не ключ прогона');
    assert.equal(deps.coordinator.abortKind(dgId, 'gen'), true, 'отмена по dg_id работает');
    resolveGen(RESP); // транспорт, игнорирующий AbortSignal
    await runPromise;
    assert.equal(readRawPayload(msg, 0), null, 'отменённый ответ не коммитится');
});

test('поздний ответ отменённого прогона не записывается (transport ignore-abort)', async () => {
    const { deps, msg } = makeDeps();
    let resolveGen;
    deps.generateText = () => new Promise((res) => { resolveGen = res; });
    const p = createPipeline(deps);
    const runPromise = p.run(0);
    await new Promise((r) => setTimeout(r, 0));
    deps.coordinator.abortKind(msg.extra.dg_id, 'gen'); // клик ◆ = отмена
    resolveGen(RESP);
    await runPromise;
    assert.equal(readRawPayload(msg, 0), null, 'пользователь отказался от результата');
    assert.equal(msg.mes, PROSE, 'текст не тронут');
});

test('артефакт вовсе без якоря — status ok (в конец поста), а не orphan', async () => {
    // Регрессия: слабые модели забывают anchor — такой артефакт не должен
    // пропадать в панель, он рендерится в конец поста (resolveMountBlock)
    const raw = `<!--DIEGETIC {"type":"item","description":"шпильки"}-->\n\`\`\`html\n<body><p>шпильки</p></body>\n\`\`\``;
    const { deps, msg, notifications } = makeDeps({ raw });
    deps.notify.warn = (m) => notifications.push(['warn', m]);
    await createPipeline(deps).run(0);
    const p = readVerifiedPayload(msg, 0);
    assert.equal(p.artifacts[0].status, 'ok', 'без якоря — не orphan');
    assert.ok(notifications.some(([k]) => k === 'ready'), 'готов-тост без жалоб на якорь');
    assert.ok(!notifications.some(([k, m]) => k === 'error' && /якор/.test(m)));
});

test('якорь без markdown-звёздочек матчит выделенную в прозе фразу как ok', async () => {
    const { deps, msg } = makeDeps({
        message: 'Она молча *взяла* **телефон** и вышла из комнаты.',
        raw: RESP,
    });
    await createPipeline(deps).run(0);
    const p = readVerifiedPayload(msg, 0);
    assert.equal(p.artifacts[0].status, 'ok', 'markdown в прозе не мешает привязке якоря');
});
