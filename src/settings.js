// src/settings.js
export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    maxPerMessage: 1,          // 1..5 — сколько артефактов контракт может вернуть за вызов
    contextDepth: 3,           // сколько предыдущих сообщений идут в вызов контекстом
    maxArtifactBytes: 32768,
    appearance: 'toast',       // 'silent' | 'toast'
    imageMode: 'button',       // 'off' | 'button' | 'auto' — фотослоты через мост URIS
    imageQuality: 'medium',    // 'low' | 'medium' | 'high' — quality для URIS generate()
    displayMode: 'inline',     // 'inline' | 'expand' | 'popup' — как артефакт показан в посте
    activeProfile: 'default',
    profiles: [
        { id: 'default', name: 'Универсальный', source: 'current', sourceConfig: null, templateText: '', builtin: 'universal' },
    ],
});

const APPEARANCES = new Set(['silent', 'toast']);
const SOURCES = new Set(['current', 'custom', 'profile']);
const IMAGE_MODES = new Set(['off', 'button', 'auto']);
const IMAGE_QUALITIES = new Set(['low', 'medium', 'high']);
const DISPLAY_MODES = new Set(['inline', 'expand', 'popup']);
const BUILTINS = new Set(['universal', 'universal-photo']);
// «Мусор — дефолты»: нечисловое или выходящее за [lo, hi] значение даёт дефолт, а не границу диапазона.
const bounded = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};

// templateText '' = встроенный универсальный шаблон (резолвится через core.getUniversalTemplate).
// Миграция: lensText старых сохранённых профилей (включая сентинел '@universal') переезжает в templateText.
const migrateTemplate = (p) => {
    if (typeof p.templateText === 'string') return p.templateText;
    if (typeof p.lensText === 'string') return p.lensText === '@universal' ? '' : p.lensText;
    return '';
};

export function normalizeSettings(input) {
    const raw = input && typeof input === 'object' ? input : {};
    // profiles не могут остаться пустыми: мусорные элементы отбрасываются,
    // а если валидных не осталось — возвращается дефолтный набор.
    const cleaned = Array.isArray(raw.profiles)
        ? raw.profiles.filter(p => p && typeof p === 'object' && p.id).map(p => ({
            id: String(p.id), name: String(p.name || p.id),
            source: SOURCES.has(p.source) ? p.source : 'current',
            sourceConfig: p.sourceConfig && typeof p.sourceConfig === 'object' ? { ...p.sourceConfig } : null,
            templateText: migrateTemplate(p),
            builtin: BUILTINS.has(p.builtin) ? p.builtin : 'universal',
        }))
        : [];
    const profiles = cleaned.length > 0 ? cleaned : DEFAULT_SETTINGS.profiles.map(p => ({ ...p }));
    // Тест-спека требует сохранять переданный activeProfile даже если такого id ещё нет
    // (профили могли быть изменены позже); фолбэк — только для отсутствующего/мусорного значения.
    const activeProfile = typeof raw.activeProfile === 'string' && raw.activeProfile
        ? raw.activeProfile
        : profiles[0].id;
    return {
        enabled: raw.enabled === false ? false : true,
        maxPerMessage: bounded(raw.maxPerMessage, 1, 5, DEFAULT_SETTINGS.maxPerMessage),
        contextDepth: bounded(raw.contextDepth, 1, 20, DEFAULT_SETTINGS.contextDepth),
        maxArtifactBytes: bounded(raw.maxArtifactBytes, 1024, 131072, DEFAULT_SETTINGS.maxArtifactBytes),
        appearance: APPEARANCES.has(raw.appearance) ? raw.appearance : DEFAULT_SETTINGS.appearance,
        imageMode: IMAGE_MODES.has(raw.imageMode) ? raw.imageMode : DEFAULT_SETTINGS.imageMode,
        imageQuality: IMAGE_QUALITIES.has(raw.imageQuality) ? raw.imageQuality : DEFAULT_SETTINGS.imageQuality,
        displayMode: DISPLAY_MODES.has(raw.displayMode) ? raw.displayMode : DEFAULT_SETTINGS.displayMode,
        profiles,
        activeProfile,
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
