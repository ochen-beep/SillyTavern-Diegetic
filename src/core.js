// src/core.js — доступ к хосту ST, хранилище настроек, кэш шаблона, ключ API.
// Нативный режим: расширение живёт в главном окне, контекст — через
// SillyTavern.getContext(). Никаких обращений к ядру по относительным путям.

export const MODULE_NAME = 'diegetic';

export function getCtx() {
    try { return globalThis.SillyTavern?.getContext?.() ?? null; } catch { return null; }
}

// Шов хранения для settings.js: extensionSettings.diegetic (JSON-строка —
// интерфейс {get,set} settings.js намеренно не менялся при переезде).
export const settingsStorage = {
    get() {
        try { return getCtx()?.extensionSettings?.[MODULE_NAME]; } catch { return undefined; }
    },
    set(v) {
        const ctx = getCtx();
        if (!ctx?.extensionSettings) return;
        ctx.extensionSettings[MODULE_NAME] = v;
        ctx.saveSettingsDebounced?.();
    },
};

// Ключ custom-эндпоинта — в localforage, не в settings.json (форма Glosses/DS):
// settings.json читается сервером, localforage не покидает браузер.
const lf = () => { try { return globalThis.SillyTavern?.libs?.localforage ?? null; } catch { return null; } };

export async function getApiKey(profileId) {
    const store = lf();
    if (!store || !profileId) return '';
    try { return String(await store.getItem(`diegetic_key_${profileId}`) ?? ''); } catch { return ''; }
}

export async function setApiKey(profileId, key) {
    const store = lf();
    if (!store || !profileId) return;
    try {
        const k = String(key ?? '');
        if (k) await store.setItem(`diegetic_key_${profileId}`, k);
        else await store.removeItem(`diegetic_key_${profileId}`);
    } catch { /* ключ просто не сохранится */ }
}

// Встроенные шаблоны: файлы расширения, отдаются хостом статикой.
// Путь от import.meta.url — не зависит от схемы монтирования third-party.
const BUILTIN_FILES = { universal: 'universal.md', 'universal-photo': 'universal-photo.md' };
const _templates = new Map();

export async function getBuiltinTemplate(id = 'universal') {
    const file = BUILTIN_FILES[id] ?? BUILTIN_FILES.universal;
    if (!_templates.has(file)) {
        const res = await fetch(new URL(`../templates/${file}`, import.meta.url));
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        _templates.set(file, await res.text());
    }
    return _templates.get(file);
}

// Chat-scoped данные расширения (исключения, флаг миграции): chatMetadata.dg.
export function chatData() {
    const ctx = getCtx();
    const md = ctx?.chatMetadata;
    if (!md || typeof md !== 'object') return null;
    if (!md.dg || typeof md.dg !== 'object') md.dg = {};
    return md.dg;
}

export function saveChatData() {
    getCtx()?.saveMetadataDebounced?.();
}
