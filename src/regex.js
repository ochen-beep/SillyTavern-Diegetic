// src/regex.js
// Prompt-strip: наши fenced-блоки не должны уходить в промпт модели.
// ВАЖНО: destination.display=false — display-regex применился бы в messageFormatting
// ДО детекта раннера и сломал рендер. Только prompt.
// Пересечение API: replaceTavernRegexes есть в 4.9.5, updateTavernRegexesWith — только 4.11.3,
// поэтому работаем через get → merge → replace.

export const REGEX_SCRIPT_NAME = 'Diegetic prompt-strip';

export function buildMergedRegexes(existing) {
    const list = Array.isArray(existing) ? existing : [];
    const desired = {
        id: 'diegetic-prompt-strip',
        script_name: REGEX_SCRIPT_NAME,
        enabled: true,
        find_regex: '```html[\\s\\S]*?```',
        replace_string: '[диегетический артефакт]',
        trim_strings: [],
        source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: false, prompt: true },
        run_on_edit: false,
        min_depth: null,
        max_depth: null,
    };
    const at = list.findIndex(r => r && r.script_name === REGEX_SCRIPT_NAME);
    if (at >= 0) {
        const cur = list[at];
        const same = cur.find_regex === desired.find_regex
            && cur.replace_string === desired.replace_string
            && cur.destination?.display === false && cur.destination?.prompt === true
            && cur.enabled === true;
        if (same) return { changed: false, regexes: list };
        const next = list.slice();
        next[at] = { ...cur, ...desired };
        return { changed: true, regexes: next };
    }
    return { changed: true, regexes: [...list, desired] };
}

/** Хост-обёртка: api = { getTavernRegexes, replaceTavernRegexes }. Идемпотентна. */
export async function ensurePromptStripRegex(api) {
    const current = await api.getTavernRegexes({ type: 'global' });
    const { changed, regexes } = buildMergedRegexes(current);
    if (changed) await api.replaceTavernRegexes(regexes, { type: 'global' });
}
