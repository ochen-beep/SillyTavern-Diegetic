// tests/context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatContextParts, collectContext } from '../src/context.js';

test('formatContextParts: порядок персона → персонаж → мир → история, пустые пропускаются', () => {
    const out = formatContextParts({
        persona: 'P', character: 'C', world: 'W', earlier: 'E',
    });
    const i = (s) => out.indexOf(s);
    assert.ok(i('[Persona') < i('[Character') && i('[Character') < i('[World') && i('[World') < i('[Earlier'));
    assert.equal(formatContextParts({}), '');
});

test('collectContext: persona+character+lore собираются из ctx', async () => {
    const ctx = {
        powerUserSettings: { persona_description: 'Анна, 27 лет' },
        characterId: 0,
        characters: [{ name: 'Дамиен', description: 'Наследник клана', personality: 'холодный', scenario: 'Манчестер' }],
        chat: [{ is_user: false, name: 'Дамиен', mes: 'Привет' }],
        getWorldInfoPrompt: async (msgs, max, isDryRun) => {
            assert.equal(isDryRun, true, 'скан лора обязан быть dry-run');
            assert.ok(msgs[0].includes('Дамиен: Привет'));
            return { worldInfoString: 'Уроборос — знак клана.' };
        },
    };
    const out = await collectContext(ctx, { earlierBlock: 'ИИ: привет' });
    assert.match(out, /\[Persona of \{\{user\}\}:\nАнна, 27 лет\]/);
    assert.match(out, /\[Character card[^\n]*:\nДамиен\nНаследник клана/);
    assert.match(out, /\[World lore[^\n]*:\nУроборос/);
    assert.match(out, /\[Earlier messages[^\n]*:\nИИ: привет\]/);
});

test('collectContext: выключенные секции отсутствуют, сломанный лор не роняет остальное', async () => {
    const ctx = {
        powerUserSettings: { persona_description: 'P' },
        getWorldInfoPrompt: async () => { throw new Error('boom'); },
    };
    const out = await collectContext(ctx, { persona: true, character: true, world: true });
    assert.match(out, /\[Persona/);
    assert.ok(!out.includes('[World'));
    assert.ok(!out.includes('[Character'));
});

test('collectContext: без ctx — только переданный earlier', async () => {
    assert.equal(await collectContext(null, { earlierBlock: 'x' }), 'x');
    assert.equal(await collectContext(undefined, {}), '');
});
