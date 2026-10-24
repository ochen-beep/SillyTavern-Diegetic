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

test('custom: таймаут 5 мин — не AbortError пользовательской отмены, а понятный сбой', async () => {
    let aborted = false;
    globalThis.SillyTavern = { getContext: () => ({ substituteParams: (s) => s }) };
    globalThis.fetch = async (_url, opts) => new Promise((_, rej) => {
        const fail = () => { aborted = true; rej(opts.signal.reason); };
        if (opts.signal.aborted) { fail(); return; }
        opts.signal.addEventListener('abort', fail);
    });
    // Подменить 5 минут на 20мс: таймер — деталь реализации, проверяем семантику
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => origSetTimeout(fn, Math.min(ms, 20));
    try {
        await assert.rejects(
            generateText({
                system: 'S', user: 'U',
                profile: { source: 'custom', sourceConfig: { apiurl: 'http://127.0.0.1:9/v1' } },
            }),
            /5 min timeout/,
        );
        assert.equal(aborted, true);
    } finally {
        delete globalThis.SillyTavern;
        delete globalThis.fetch;
        globalThis.setTimeout = origSetTimeout;
    }
});
