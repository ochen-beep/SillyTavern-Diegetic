// tests/host.test.mjs — мягкий аборт для источника 'current': ctx.generateRaw
// не принимает signal, поэтому аборт разматывает ожидание сразу, а запрос
// догорает в фоне (его результат выбрасывает commit-гард isCurrent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from '../src/host.js';

test('источник current: аборт сигнала разматывает ожидание (AbortError)', async () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            generateRaw: () => new Promise(() => {}), // «реальный» запрос висит до конца
        }),
    };
    try {
        const ctrl = new AbortController();
        const p = generateText({ system: 'S', user: 'U', profile: { source: 'current' }, signal: ctrl.signal });
        ctrl.abort();
        await assert.rejects(p, (e) => e?.name === 'AbortError');
    } finally { delete globalThis.SillyTavern; }
});

test('источник current: без аборта ответ доходит', async () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            substituteParams: (s) => s,
            generateRaw: async ({ prompt }) => `raw:${prompt.length}`,
        }),
    };
    try {
        const ctrl = new AbortController();
        const out = await generateText({ system: 'S', user: 'U', profile: { source: 'current' }, signal: ctrl.signal });
        assert.match(out, /^raw:/);
    } finally { delete globalThis.SillyTavern; }
});
