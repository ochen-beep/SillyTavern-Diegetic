// tests/host.test.mjs — источник 'current' выпилен: generateRaw хоста больше
// не используется, генерация идёт только через CM-профиль или свой endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../src/host.js';

test('источник current не существует: generateRaw не вызывается, ошибка понятная', async () => {
    let rawCalled = false;
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            generateRaw: () => { rawCalled = true; return new Promise(() => {}); },
        }),
    };
    try {
        await assert.rejects(
            generateText({ system: 'S', user: 'U', profile: { source: 'current' } }),
            /Connection Manager unavailable/,
        );
        assert.equal(rawCalled, false);
    } finally { delete globalThis.SillyTavern; }
});

test('источник profile без выбранного профиля — явная ошибка', async () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            ConnectionManagerRequestService: { sendRequest: async () => ({}) },
        }),
    };
    try {
        await assert.rejects(
            generateText({ system: 'S', user: 'U', profile: { source: 'profile', sourceConfig: {} } }),
            /No connection profile selected/,
        );
    } finally { delete globalThis.SillyTavern; }
});

// ── Повторный клик = отмена: сигнал доезжает до обоих транспортов ──

test('CM: наш AbortSignal передаётся в sendRequest, аборт даёт AbortError', async () => {
    const ctrl = new AbortController();
    let seen = null;
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            extensionSettings: { connectionManager: { profiles: [{ id: 'p1', name: 'P1' }] } },
            ConnectionManagerRequestService: {
                sendRequest: async (_id, _msgs, _max, opts) => {
                    seen = opts?.signal ?? null;
                    // Транспорт, висящий до аборта (как реальный fetch)
                    return new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))));
                },
            },
        }),
    };
    try {
        const p = generateText({
            system: 'S', user: 'U', signal: ctrl.signal,
            profile: { source: 'profile', sourceConfig: { profileId: 'p1', profileName: 'P1' } },
        });
        ctrl.abort();
        await assert.rejects(p, (e) => e?.name === 'AbortError');
        assert.equal(seen, ctrl.signal, 'сигнал координатора доходит до CM sendRequest');
    } finally { delete globalThis.SillyTavern; }
});

test('CM: AbortError, завёрнутый хостом в cause, разворачивается в AbortError', async () => {
    const ctrl = new AbortController();
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            extensionSettings: { connectionManager: { profiles: [{ id: 'p1', name: 'P1' }] } },
            ConnectionManagerRequestService: {
                // CM заворачивает причины: new Error('API request failed', { cause: DOMException })
                sendRequest: async () => { throw new Error('API request failed', { cause: new DOMException('Aborted', 'AbortError') }); },
            },
        }),
    };
    try {
        await assert.rejects(
            generateText({
                system: 'S', user: 'U', signal: ctrl.signal,
                profile: { source: 'profile', sourceConfig: { profileId: 'p1', profileName: 'P1' } },
            }),
            (e) => e?.name === 'AbortError',
        );
    } finally { delete globalThis.SillyTavern; }
});

test('custom: аборт внешнего сигнала рвёт fetch и даёт AbortError', async () => {
    const ctrl = new AbortController();
    globalThis.SillyTavern = { getContext: () => ({ substituteParams: (s) => s }) };
    // fetch прерывается сигналом и когда он уже abort-нут (реальный fetch так умеет)
    globalThis.fetch = async (_url, opts) => new Promise((_, rej) => {
        const fail = () => rej(opts.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        if (opts.signal.aborted) { fail(); return; }
        opts.signal.addEventListener('abort', fail);
    });
    try {
        const p = generateText({
            system: 'S', user: 'U', signal: ctrl.signal,
            profile: { source: 'custom', sourceConfig: { apiurl: 'http://127.0.0.1:9/v1' } },
        });
        // Аборт в окне до fetch'а (getApiKey/шаблон в пайплайне) — регрессия:
        // слушатель вешался на уже-аборченный сигнал и отмена терялась
        ctrl.abort();
        await assert.rejects(p, (e) => e?.name === 'AbortError');
    } finally {
        delete globalThis.SillyTavern;
        delete globalThis.fetch;
    }
});

// ── Стриминг: тумблер доезжает до транспортов, мусор SSE диких прокси не роняет ──

const sseBody = (chunks) => new ReadableStream({
    start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
    },
});

test('custom stream:true: тело просит стрим, SSE копится, мусор прокси пропускается', async () => {
    let sentBody = null;
    globalThis.SillyTavern = { getContext: () => ({ substituteParams: (s) => s }) };
    globalThis.fetch = async (_url, opts) => {
        sentBody = JSON.parse(opts.body);
        // Дикая смесь реальных прокси: role-чанк, keep-alive комментарий, пустая
        // delta, usage-чанк с пустым choices, reasoning_content, [DONE].
        return { ok: true, body: sseBody([
            'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"Пост"}}]}\n\n',
            ': keep-alive\n\n',
            'data: {"choices":[{"delta":{}}]}\n\n',
            'data: {"choices":[],"usage":{"total_tokens":10}}\n\n',
            'data: {"choices":[{"delta":{"content":" готов"}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":"думал"}}]}\n\n',
            'data: [DONE]\n\n',
        ]) };
    };
    try {
        const text = await generateText({
            system: 'S', user: 'U', stream: true,
            profile: { source: 'custom', sourceConfig: { apiurl: 'https://x.example/v1' } },
        });
        assert.equal(sentBody.stream, true, 'stream:true в теле запроса');
        assert.equal(text, 'Пост готов', 'delta.content копится; role/пустые/usage/reasoning — мимо');
    } finally { delete globalThis.SillyTavern; delete globalThis.fetch; }
});

test('custom без stream (тумблер выкл): тело stream:false, ответ — цельный JSON', async () => {
    let sentBody = null;
    globalThis.SillyTavern = { getContext: () => ({ substituteParams: (s) => s }) };
    globalThis.fetch = async (_url, opts) => {
        sentBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'JSON-путь' } }] }) };
    };
    try {
        const text = await generateText({
            system: 'S', user: 'U',
            profile: { source: 'custom', sourceConfig: { apiurl: 'https://x.example/v1' } },
        });
        assert.equal(sentBody.stream, false);
        assert.equal(text, 'JSON-путь');
    } finally { delete globalThis.SillyTavern; delete globalThis.fetch; }
});

test('custom stream:true: пустой поток (только [DONE]) — явная ошибка, не тихий пустой текст', async () => {
    globalThis.SillyTavern = { getContext: () => ({ substituteParams: (s) => s }) };
    globalThis.fetch = async () => ({ ok: true, body: sseBody(['data: [DONE]\n\n']) });
    try {
        await assert.rejects(
            generateText({
                system: 'S', user: 'U', stream: true,
                profile: { source: 'custom', sourceConfig: { apiurl: 'https://x.example/v1' } },
            }),
            /could not extract text/,
        );
    } finally { delete globalThis.SillyTavern; delete globalThis.fetch; }
});

test('extraBody с ключом stream — явная ошибка до fetch (им управляет тумблер)', async () => {
    let fetched = false;
    globalThis.SillyTavern = { getContext: () => ({ substituteParams: (s) => s }) };
    globalThis.fetch = async () => { fetched = true; return { ok: true, json: async () => ({}) }; };
    try {
        await assert.rejects(
            generateText({
                system: 'S', user: 'U', stream: true,
                profile: { source: 'custom', sourceConfig: { apiurl: 'https://x.example/v1', extraBody: '{"stream":true}' } },
            }),
            /stream/i,
        );
        assert.equal(fetched, false, 'запрос не ушёл');
    } finally { delete globalThis.SillyTavern; delete globalThis.fetch; }
});

test('CM stream:true: генератор вычитывается, extraBody уходит и топ-уровнем, и в custom_include_body', async () => {
    let seenOpts = null, seenOverride = null;
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            extensionSettings: { connectionManager: { profiles: [{ id: 'p1', name: 'P1' }] } },
            ConnectionManagerRequestService: {
                sendRequest: async (_id, _msgs, _max, opts, override) => {
                    seenOpts = opts; seenOverride = override;
                    return async function* () { yield { text: 'Часть' }; yield { text: 'Часть два' }; };
                },
            },
        }),
    };
    try {
        const text = await generateText({
            system: 'S', user: 'U', stream: true,
            profile: { source: 'profile', sourceConfig: { profileId: 'p1', profileName: 'P1', extraBody: '{"reasoning_effort":"none"}' } },
        });
        assert.equal(seenOpts.stream, true, 'стрим в опциях sendRequest');
        assert.equal(text, 'Часть два', 'финальный накопленный текст генератора');
        assert.equal(seenOverride.reasoning_effort, 'none', 'топ-левел — для нативных источников');
        assert.deepEqual(seenOverride.custom_include_body, { reasoning_effort: 'none' }, 'обход whitelist сервера ST для CUSTOM');
    } finally { delete globalThis.SillyTavern; }
});

test('CM stream:true, сервис вернул объект вместо генератора — читается как JSON', async () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            extensionSettings: { connectionManager: { profiles: [{ id: 'p1', name: 'P1' }] } },
            ConnectionManagerRequestService: {
                sendRequest: async () => ({ choices: [{ message: { content: 'fallback' } }] }),
            },
        }),
    };
    try {
        const text = await generateText({
            system: 'S', user: 'U', stream: true,
            profile: { source: 'profile', sourceConfig: { profileId: 'p1', profileName: 'P1' } },
        });
        assert.equal(text, 'fallback');
    } finally { delete globalThis.SillyTavern; }
});

test('CM stream:true: cancel посреди потока даёт AbortError, а не «generation failed»', async () => {
    const ctrl = new AbortController();
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            extensionSettings: { connectionManager: { profiles: [{ id: 'p1', name: 'P1' }] } },
            ConnectionManagerRequestService: {
                sendRequest: async () => async function* () {
                    yield { text: 'начало' };
                    await new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))));
                },
            },
        }),
    };
    try {
        const p = generateText({
            system: 'S', user: 'U', signal: ctrl.signal, stream: true,
            profile: { source: 'profile', sourceConfig: { profileId: 'p1', profileName: 'P1' } },
        });
        await new Promise(r => setTimeout(r, 5)); // дать стриму начаться
        ctrl.abort();
        await assert.rejects(p, (e) => e?.name === 'AbortError');
    } finally { delete globalThis.SillyTavern; }
});

test('CM extraBody с ключом stream — явная ошибка, sendRequest не зовётся', async () => {
    let called = false;
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            extensionSettings: { connectionManager: { profiles: [{ id: 'p1', name: 'P1' }] } },
            ConnectionManagerRequestService: {
                sendRequest: async () => { called = true; return {}; },
            },
        }),
    };
    try {
        await assert.rejects(
            generateText({
                system: 'S', user: 'U', stream: true,
                profile: { source: 'profile', sourceConfig: { profileId: 'p1', profileName: 'P1', extraBody: '{"stream":false}' } },
            }),
            /stream/i,
        );
        assert.equal(called, false, 'запрос не ушёл');
    } finally { delete globalThis.SillyTavern; }
});
