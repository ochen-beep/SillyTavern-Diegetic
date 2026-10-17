// src/payload.js — адресация артефактов к варианту сообщения.
// Хранилище — файловое (src/store.js), ключ = send_date свайпа. В сообщениях
// артефакты не живут: файл чата не раздувается, клон extra при свайпе не может
// подсунуть чужой payload, правка текста артефакт не теряет.
//
// ИНВАРИАНТ: payload используется, только когда его contentDigest совпадает с
// дайджестом текущего текста варианта. Расхождение (правка текста) читается
// как «нет проверенных артефактов»; сырой readRawPayload — для rebind-пути,
// который перепривязывает якоря к новому тексту и обновляет дайджест.

import { contentDigest, isViableMessageText } from './digest.js';
import { readEntry, writeEntry, deleteEntry } from './store.js';

// Остался для миграции/clean: старое хранилище жило под этим ключом в extra.
export const PAYLOAD_KEY = 'dg';
export const PAYLOAD_SCHEMA = 1;

/** Текст варианта по правилу самого ST (swipes[idx] ?? mes). '' для отсутствующего. */
export function variantText(msg, swipeIdx = 0) {
    if (!msg) return '';
    const idx = Number(swipeIdx) || 0;
    const swipes = Array.isArray(msg.swipes) ? msg.swipes : null;
    const candidate = swipes && swipes[idx] !== undefined ? swipes[idx] : msg.mes;
    return String(candidate ?? '');
}

export function digestForVariant(msg, swipeIdx = 0) {
    return contentDigest(variantText(msg, swipeIdx));
}

function isPayloadShape(value) {
    return !!value && typeof value === 'object'
        && Number(value.schema) === PAYLOAD_SCHEMA
        && typeof value.contentDigest === 'string' && value.contentDigest.length > 0
        && Array.isArray(value.artifacts);
}

/** Ключ варианта: send_date его swipe-слота; несвайповым — send_date сообщения. */
function keyFor(msg, swipeIdx = 0) {
    if (!msg) return null;
    const idx = Number(swipeIdx) || 0;
    return msg.swipe_info?.[idx]?.send_date ?? msg.send_date ?? null;
}

/** Payload без digest-гейта — только для rebind/инспекции. */
export function readRawPayload(msg, swipeIdx = 0) {
    const key = keyFor(msg, swipeIdx);
    if (!key) return null;
    const candidate = readEntry(key);
    return isPayloadShape(candidate) ? candidate : null;
}

/**
 * true, если дайджест payload совпадает с текстом ДРУГОГО варианта этого же
 * сообщения. В файловом хранилище «чужой payload» через клон extra не возникает;
 * гард оставлен на экзотический случай «пользователь выровнял текст двух
 * свайпов» — rebind тогда не должен молча переприсваивать чужую привязку.
 */
export function payloadBelongsToOtherVariant(msg, swipeIdx, payload) {
    if (!msg || !isPayloadShape(payload)) return false;
    const idx = Number(swipeIdx) || 0;
    const swipes = Array.isArray(msg.swipes) ? msg.swipes : null;
    if (!swipes) return false;
    for (let i = 0; i < swipes.length; i++) {
        if (i === idx) continue;
        if (contentDigest(String(swipes[i] ?? '')) === payload.contentDigest) return true;
    }
    return false;
}

/** Единственное чтение, которому доверяют display/generation-пути. */
export function readVerifiedPayload(msg, swipeIdx = 0) {
    const raw = readRawPayload(msg, swipeIdx);
    if (!raw) return null;
    if (!isViableMessageText(variantText(msg, swipeIdx))) return null;
    if (raw.contentDigest !== digestForVariant(msg, swipeIdx)) return null;
    return raw;
}

/** Собрать payload, проштампованный дайджестом ТЕКУЩЕГО текста варианта.
 *  null на заглушке стрима — payload на '...' не пишем никогда. */
export function stampPayload(msg, swipeIdx, artifacts) {
    const text = variantText(msg, swipeIdx);
    if (!isViableMessageText(text)) return null;
    return {
        schema: PAYLOAD_SCHEMA,
        contentDigest: contentDigest(text),
        generatedAt: Date.now(),
        artifacts: Array.isArray(artifacts) ? artifacts : [],
    };
}

/**
 * Записать payload за вариант. Адресован send_date'ой варианта: асинхронная
 * генерация, пришедшая после свайпа пользователя, пишется в слот СВОЕГО
 * варианта и показанный не загрязняет. Дайджест уже должен совпадать с текстом
 * (stampPayload / rebind-проверенный payload).
 */
export function writePayload(msg, swipeIdx, payload) {
    if (!msg || !isPayloadShape(payload)) return null;
    const key = keyFor(msg, swipeIdx);
    if (!key) return null;
    writeEntry(key, payload);
    return payload;
}

/** Удалить payload варианта. */
export function clearPayload(msg, swipeIdx = 0) {
    const key = keyFor(msg, swipeIdx);
    if (!key || !readEntry(key)) return false;
    deleteEntry(key);
    return true;
}
