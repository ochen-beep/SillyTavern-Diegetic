// src/context.js — доп. контекст генерации (форма DS-Comments: persona /
// character card / активированный лор через dry-run скан ST). Чистая сборка
// блоков вынесена в formatContextParts — покрыта node-тестами; сбор данных —
// collectContext, живёт у хоста и никогда не бросает.
//
// КОНТРАКТ DRY-RUN (как в DS lorebooks.js): ctx.getWorldInfoPrompt вызывается
// ТОЛЬКО с isDryRun=true — обычный скан переэмиссил бы WORLD_INFO_ACTIVATED и
// писал sticky/cooldown-эффекты в chat_metadata вне цикла генерации ST.

export const LORE_SCAN_MAX_CONTEXT = 100000;

/**
 * Чистая: склеить блоки контекста в один user-блок. Порядок фиксирован:
 * персона → персонаж → мир → история чата → пост (пост добавляет pipeline).
 * @param {{ persona?: string, character?: string, world?: string, earlier?: string }} parts
 */
export function formatContextParts(parts) {
    const blocks = [];
    if (parts.persona) blocks.push(`[Persona of {{user}}:\n${parts.persona}]`);
    if (parts.character) blocks.push(`[Character card (canon, do not contradict):\n${parts.character}]`);
    if (parts.world) blocks.push(`[World lore (canon details of the setting):\n${parts.world}]`);
    if (parts.earlier) blocks.push(`[Earlier messages — background, not the artifact target:\n${parts.earlier}]`);
    return blocks.join('\n\n');
}

/**
 * Сбор контекста с хоста. Возвращает строку для user-сообщения ('' когда
 * выключено/нечего). Ни одна секция не роняет остальные.
 */
export async function collectContext(ctx, { persona = true, character = true, world = true, earlierBlock = '' } = {}) {
    if (!ctx) return earlierBlock || '';
    const parts = { earlier: earlierBlock };

    if (persona) {
        try {
            const pd = ctx.powerUserSettings?.persona_description;
            if (typeof pd === 'string' && pd.trim()) parts.persona = pd.trim();
        } catch { /* секция пропускается */ }
    }

    if (character) {
        try {
            const ch = ctx.characterId !== undefined ? ctx.characters?.[ctx.characterId] : null;
            const bits = [];
            if (ch?.name) bits.push(ch.name);
            if (typeof ch?.description === 'string' && ch.description.trim()) bits.push(ch.description.trim());
            if (typeof ch?.personality === 'string' && ch.personality.trim()) bits.push(`Personality: ${ch.personality.trim()}`);
            if (typeof ch?.scenario === 'string' && ch.scenario.trim()) bits.push(`Scenario: ${ch.scenario.trim()}`);
            if (bits.length) parts.character = bits.join('\n');
        } catch { /* секция пропускается */ }
    }

    if (world && typeof ctx.getWorldInfoPrompt === 'function') {
        try {
            const chatMessages = (ctx.chat || [])
                .filter(m => m && !m.is_system && !m.is_hidden)
                .map(m => `${m.is_user ? (ctx.name1 || 'User') : (m.name || ctx.name2 || 'Character')}: ${String(m.mes || '')}`)
                .reverse();
            const globalScanData = { trigger: 'quiet' };
            const ch = ctx.characterId !== undefined ? ctx.characters?.[ctx.characterId] : null;
            if (ch?.description) globalScanData.characterDescription = ch.description;
            if (ch?.personality) globalScanData.characterPersonality = ch.personality;
            if (ch?.scenario) globalScanData.scenario = ch.scenario;
            const pd = ctx.powerUserSettings?.persona_description;
            if (pd) globalScanData.personaDescription = pd;
            const result = await ctx.getWorldInfoPrompt(chatMessages, LORE_SCAN_MAX_CONTEXT, true, globalScanData);
            const text = typeof result?.worldInfoString === 'string' ? result.worldInfoString.trim() : '';
            if (text) parts.world = text;
        } catch { /* секция пропускается */ }
    }

    return formatContextParts(parts);
}
