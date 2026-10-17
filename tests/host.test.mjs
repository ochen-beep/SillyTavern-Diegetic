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
            /Connection Manager недоступен/,
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
            /не выбран профиль подключения/,
        );
    } finally { delete globalThis.SillyTavern; }
});
