// src/payload.js — хранилище артефактов ВНУТРИ сообщения (форма: Glosses
// src/domain/footnote-payload.js, урезанная под один массив артефактов).
//
//   swipe_info[swipe_id].extra.dg  — каноничная копия варианта (per-swipe)
//   msg.extra.dg                   — live-зеркало показанного варианта
//
// Связку «какой вариант на экране» держит сам ST (syncMesToSwipe/syncSwipeToMes
// переносят extra целиком), мы её не пересчитываем.
//
// ИНВАРИАНТ: payload используется, только когда его contentDigest совпадает с
// дайджестом текущего текста варианта. Любое расхождение (унаследованный extra
// на свежем свайпе, правка текста, восстановленный старый чат) читается как
// «артефактов нет», а не как чужие артефакты. Сырой (без гейта) readRawPayload —
// только для rebind-пути, которому устаревший payload нужен, чтобы его починить.

import { contentDigest, isViableMessageText } from './digest.js';

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

/**
 * Payload без digest-гейта — только для rebind/инспекции. Для сообщений без
 * свайп-механики (user-посты, экзотика) хранилище одно: msg.extra — фолбэк на
 * зеркало существует только для них: у свайповых сообщений зеркало отражает
 * ПОКАЗАННЫЙ вариант, и фолбэк на него подсунул бы чужой payload.
 */
export function readRawPayload(msg, swipeIdx = 0) {
    if (!msg) return null;
    const idx = Number(swipeIdx) || 0;
    const candidate = Array.isArray(msg.swipe_info)
        ? msg.swipe_info[idx]?.extra?.[PAYLOAD_KEY] ?? null
        : msg.extra?.[PAYLOAD_KEY] ?? null;
    return isPayloadShape(candidate) ? candidate : null;
}

/**
 * true, если дайджест payload совпадает с текстом ДРУГОГО варианта этого же
 * сообщения: payload попал в слот через клонирование extra самим ST при создании
 * свайпа, а не через правку текста. Такой payload — чужой: его очищают, а не
 * перепривязывают.
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

function ensureSlot(msg, swipeIdx) {
    if (!Array.isArray(msg.swipe_info)) return null;
    const idx = Number(swipeIdx) || 0;
    if (!msg.swipe_info[idx] || typeof msg.swipe_info[idx] !== 'object') msg.swipe_info[idx] = {};
    const slot = msg.swipe_info[idx];
    if (!slot.extra || typeof slot.extra !== 'object') slot.extra = {};
    return slot;
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
 * Записать payload за вариант. Слот swipe_info пишется ВСЕГДА (адресован
 * вариантом), live-зеркало — только пока сообщение показывает этот вариант:
 * асинхронная генерация, пришедшая после свайпа пользователя, не должна
 * загрязнить свежепоказанный вариант. Дайджест уже должен совпадать с текстом
 * (stampPayload / rebind-проверенный payload) — функция только раскладывает.
 */
export function writePayload(msg, swipeIdx, payload) {
    if (!msg || !isPayloadShape(payload)) return null;
    const idx = Number(swipeIdx) || 0;
    const slot = ensureSlot(msg, idx);
    if (slot) slot.extra[PAYLOAD_KEY] = payload;
    if ((msg.swipe_id ?? 0) === idx) {
        if (!msg.extra || typeof msg.extra !== 'object') msg.extra = {};
        msg.extra[PAYLOAD_KEY] = payload;
    }
    return payload;
}

/** Удалить payload варианта (и зеркало, если оно его отражает). */
export function clearPayload(msg, swipeIdx = 0) {
    if (!msg) return false;
    const idx = Number(swipeIdx) || 0;
    let removed = false;
    const slot = Array.isArray(msg.swipe_info) ? msg.swipe_info[idx] : null;
    if (slot?.extra && PAYLOAD_KEY in slot.extra) {
        delete slot.extra[PAYLOAD_KEY];
        removed = true;
    }
    if ((msg.swipe_id ?? 0) === idx && msg.extra && PAYLOAD_KEY in msg.extra) {
        delete msg.extra[PAYLOAD_KEY];
        removed = true;
    }
    return removed;
}
