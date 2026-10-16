// src/settings.js
import { isBuiltinTemplate as isBuiltinName, DEFAULT_TEMPLATE } from './templates.js';

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,            // автогенерация — только явным включением
    maxPerMessage: 1,          // 1..5 — сколько артефактов контракт может вернуть за вызов
    contextDepth: 3,           // сколько предыдущих сообщений идут в вызов контекстом
    maxArtifactBytes: 32768,
    appearance: 'toast',       // 'silent' | 'toast'
    imageMode: 'button',       // 'off' | 'button' | 'auto' — фотослоты через мост URIS
    imageQuality: 'medium',    // 'low' | 'medium' | 'high' — quality для URIS generate()
    displayMode: 'inline',     // 'inline' | 'expand' | 'popup' — как артефакт показан в посте
    buttonMode: 'post',        // 'post' | 'bar' | 'floating' — где кнопка генерации
    ctxHistory: true,          // блок истории чата в контексте (глубина — contextDepth)
    ctxPersona: true,          // персона {{user}} в контексте генерации
    ctxCharacter: true,        // описание персонажа в контексте
    ctxWorld: true,            // активированные лорбуки (dry-run скан ST) в контексте
    templates: {},             // именованные шаблоны { name: text } — сервер-синк (форма DS-Comments)
    activeTemplate: DEFAULT_TEMPLATE,
    // Источник генерации (форма DS-Comments): один выбор, без списка профилей.
    source: 'current',         // 'current' | 'profile' | 'custom'
    cmProfile: null,           // { profileId, profileName } — профиль Connection Manager
    custom: { apiurl: '', model: '' }, // свой endpoint; ключ — в localforage, не здесь
    customExtraBody: '',       // JSON-примесь в тело запроса (напр., отключение reasoning)
    httpAllowList: [],         // origin'ы plain-HTTP, разрешённые явно
});

const APPEARANCES = new Set(['silent', 'toast']);
const SOURCES = new Set(['current', 'custom', 'profile']);
const IMAGE_MODES = new Set(['off', 'button', 'auto']);
const IMAGE_QUALITIES = new Set(['low', 'medium', 'high']);
const DISPLAY_MODES = new Set(['inline', 'expand', 'popup']);
const BUTTON_MODES = new Set(['post', 'bar', 'floating']);
// «Мусор — дефолты»: нечисловое или выходящее за [lo, hi] значение даёт дефолт, а не границу диапазона.
const bounded = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};

// templateText '' = встроенный универсальный шаблон (резолвится через core.getUniversalTemplate).
// Миграция: lensText старых сохранённых профилей (включая сентинел '@universal') переезжает в templateText.
// Профильные templateText/builtin — legacy: шаблоны переехали в именованное хранилище settings.templates,
// поле остаётся в нормализации ради старых сохранений и больше нигде не читается.
const migrateTemplate = (p) => {
    if (typeof p.templateText === 'string') return p.templateText;
    if (typeof p.lensText === 'string') return p.lensText === '@universal' ? '' : p.lensText;
    return '';
};

// Одноразовый переезд: текст из профильных templateText → именованные шаблоны.
// Условие «raw.templates ещё нет» делает миграцию идемпотентной: после первого
// save в нормализованных настройках templates уже есть, повторов не будет.
const legacyTemplatesFromProfiles = (raw) => {
    if (raw.templates !== undefined || !Array.isArray(raw.profiles)) return {};
    const out = {};
    for (const p of raw.profiles) {
        if (!p || typeof p !== 'object' || !p.id) continue;
        const text = migrateTemplate(p);
        if (text.trim()) out[String(p.name || p.id)] = text;
    }
    return out;
};

// Переезд источника: профильный список (activeProfile + sourceConfig) →
// одна тройка source/cmProfile/custom (форма DS-Comments).
const legacySourceFromProfiles = (raw) => {
    if (raw.source !== undefined || !Array.isArray(raw.profiles) || !raw.profiles.length) return null;
    const p = raw.profiles.find(x => x && x.id === raw.activeProfile) || raw.profiles[0];
    if (!p || typeof p !== 'object') return null;
    const sc = (p.sourceConfig && typeof p.sourceConfig === 'object') ? p.sourceConfig : {};
    return {
        source: SOURCES.has(p.source) ? p.source : 'current',
        cmProfile: p.source === 'profile'
            ? { profileId: String(sc.profileId ?? ''), profileName: String(sc.profileName ?? '') }
            : null,
        custom: p.source === 'custom'
            ? { apiurl: String(sc.apiurl ?? ''), model: String(sc.model ?? '') }
            : { apiurl: '', model: '' },
    };
};

const sanitizeTemplates = (t) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return {};
    const out = {};
    for (const [k, v] of Object.entries(t)) {
        // Ключи-имена: непустая строка, не занятая встроенной основой
        // (встроенные не из хранилища — записи под их именами недостижимы).
        if (typeof k === 'string' && k && !isBuiltinName(k) && typeof v === 'string') out[k] = v;
    }
    return out;
};

export function normalizeSettings(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const legacySource = legacySourceFromProfiles(raw);
    const src = legacySource?.source ?? (SOURCES.has(raw.source) ? raw.source : DEFAULT_SETTINGS.source);
    const cm = legacySource ? legacySource.cmProfile
        : (raw.cmProfile && typeof raw.cmProfile === 'object' && raw.cmProfile.profileId)
            ? { profileId: String(raw.cmProfile.profileId), profileName: String(raw.cmProfile.profileName ?? '') }
            : null;
    const customRaw = legacySource ? legacySource.custom
        : (raw.custom && typeof raw.custom === 'object') ? raw.custom : {};
    const allowList = Array.isArray(raw.httpAllowList)
        ? [...new Set(raw.httpAllowList.filter(v => typeof v === 'string' && v))] : [];
    return {
        // Автогенерация включена только если пользователь явно включил (=== true);
        // мусор/отсутствие — выключено.
        enabled: raw.enabled === true,
        maxPerMessage: bounded(raw.maxPerMessage, 1, 5, DEFAULT_SETTINGS.maxPerMessage),
        contextDepth: bounded(raw.contextDepth, 1, 20, DEFAULT_SETTINGS.contextDepth),
        maxArtifactBytes: bounded(raw.maxArtifactBytes, 1024, 131072, DEFAULT_SETTINGS.maxArtifactBytes),
        appearance: APPEARANCES.has(raw.appearance) ? raw.appearance : DEFAULT_SETTINGS.appearance,
        imageMode: IMAGE_MODES.has(raw.imageMode) ? raw.imageMode : DEFAULT_SETTINGS.imageMode,
        imageQuality: IMAGE_QUALITIES.has(raw.imageQuality) ? raw.imageQuality : DEFAULT_SETTINGS.imageQuality,
        displayMode: DISPLAY_MODES.has(raw.displayMode) ? raw.displayMode : DEFAULT_SETTINGS.displayMode,
        buttonMode: BUTTON_MODES.has(raw.buttonMode) ? raw.buttonMode : DEFAULT_SETTINGS.buttonMode,
        ctxHistory: raw.ctxHistory === false ? false : true,
        ctxPersona: raw.ctxPersona === false ? false : true,
        ctxCharacter: raw.ctxCharacter === false ? false : true,
        ctxWorld: raw.ctxWorld === false ? false : true,
        templates: sanitizeTemplates(raw.templates !== undefined ? raw.templates : legacyTemplatesFromProfiles(raw)),
        activeTemplate: typeof raw.activeTemplate === 'string' && raw.activeTemplate ? raw.activeTemplate : DEFAULT_SETTINGS.activeTemplate,
        source: src,
        cmProfile: src === 'profile' ? (cm ?? { profileId: '', profileName: '' }) : null,
        custom: {
            apiurl: String(customRaw.apiurl ?? ''),
            model: String(customRaw.model ?? ''),
        },
        customExtraBody: typeof raw.customExtraBody === 'string' ? raw.customExtraBody : '',
        httpAllowList: allowList,
    };
}

export function loadSettings(storage) {
    let raw = null;
    try {
        const v = storage.get();
        raw = typeof v === 'string' ? JSON.parse(v) : v;
    } catch { raw = null; }
    return normalizeSettings(raw);
}

export function saveSettings(storage, settings) {
    storage.set(JSON.stringify(normalizeSettings(settings)));
}
