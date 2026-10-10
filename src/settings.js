export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    maxPerMessage: 1,          // 1..5 — сколько артефактов контракт может вернуть за вызов
    contextDepth: 3,           // сколько предыдущих сообщений идут в вызов контекстом
    maxArtifactBytes: 32768,
    appearance: 'toast',       // 'silent' | 'toast' | 'toast+sound'
    activeProfile: 'default',
    profiles: [
        { id: 'default', name: 'Базовый', source: 'current', sourceConfig: null },
    ],
});

const APPEARANCES = new Set(['silent', 'toast', 'toast+sound']);
// «Мусор — дефолты»: нечисловое или выходящее за [lo, hi] значение даёт дефолт, а не границу диапазона.
const bounded = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};

export function normalizeSettings(input) {
    const raw = input && typeof input === 'object' ? input : {};
    // profiles не могут остаться пустыми: мусорные элементы отбрасываются,
    // а если валидных не осталось — возвращается дефолтный набор.
    const cleaned = Array.isArray(raw.profiles)
        ? raw.profiles.filter(p => p && typeof p === 'object' && p.id).map(p => ({
            id: String(p.id), name: String(p.name || p.id),
            source: p.source === 'custom' ? 'custom' : 'current',
            sourceConfig: p.sourceConfig && typeof p.sourceConfig === 'object' ? { ...p.sourceConfig } : null,
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
