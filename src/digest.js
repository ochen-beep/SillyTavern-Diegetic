// src/digest.js
/** Стабильный не-криптографический дайджест NFC-нормализованного текста (djb2, 8 hex). */
export function contentDigest(text) {
    const s = String(text ?? '').normalize('NFC');
    if (!s) return '';
    let hash = 5381;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** Ниже этого длины текст считается заглушкой стрима. */
export const MIN_POST_LENGTH = 5;

/** Не пусто, не '...' и не короче минимума — годен как идентичность/источник артефакта. */
export function isViableMessageText(text) {
    const check = (text || '').trim();
    return !!check && check !== '...' && check.length >= MIN_POST_LENGTH;
}
