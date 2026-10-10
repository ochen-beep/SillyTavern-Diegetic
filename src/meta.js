// Метаданные артефактов: chat-переменные, map digest(проза) → { artifacts, generatedAt }.
// Digest-гейт встроен: ключ существует ⇔ текст прозы совпадает с текстом на момент записи.
// Ограничение размера map: не более 200 digest-ключей, вытеснение самых старых.
// Примечание: 8-hex digest-ключи, состоящие только из цифр, после JSON round-trip могут
// переупорядочиться вперёд — влияет только на порядок вытеснения.

export const META_KEY = 'dg_meta';
const MAX_ENTRIES = 200;

export function readMetaMap(vars) {
    const raw = vars?.[META_KEY];
    return raw && typeof raw === 'object' ? raw : {};
}

export function metaFor(vars, proseDigest) {
    const entry = readMetaMap(vars)[proseDigest];
    return entry && Array.isArray(entry.artifacts) ? entry : null;
}

export function recordArtifacts(vars, proseDigest, artifacts) {
    const map = { ...readMetaMap(vars) };
    map[proseDigest] = { artifacts: artifacts.map(a => ({ ...a })), generatedAt: Date.now() };
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => (map[a].generatedAt || 0) - (map[b].generatedAt || 0));
        for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
    }
    return { ...vars, [META_KEY]: map };
}

export function removeDigest(vars, proseDigest) {
    const map = { ...readMetaMap(vars) };
    delete map[proseDigest];
    return { ...vars, [META_KEY]: map };
}
