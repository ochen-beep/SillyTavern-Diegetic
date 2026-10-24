// Одноуровневая отмена деструктивных операций над payload (Б24).
// Перед удалением артефакта или перезаписью payload'а новой генерацией прежний
// payload прячется в память; в течение окна его можно вернуть кликом по тосту.
// Заменяет confirm-диалоги: осознанные действия не тормозим, случайные —
// обратимы. Второй stash вытесняет первый (отменяется только последнее
// действие). Если сообщение к моменту отмены покинуло чат, запись всё равно
// восстанавливается в хранилище (станет сиротой — безвредно, GC почистит).
//
// Payload копируется вглубь: после stash вызывающий пишет новый payload в тот
// же объектный слот — копия должна остаться прежней.

import { writePayload } from './payload.js';

export const UNDO_WINDOW_MS = 10_000;

let _stash = null; // { msg, swipeIdx, payload, timer }

/**
 * Спрятать прежний payload перед деструктивной операцией.
 * @returns {() => boolean} undo-замыкание (true — восстановлено) или null.
 * Замыкание привязано к СВОЕМУ stash: пришедший позже stash его вытесняет,
 * и старое undo честно возвращает false, а не откатывает чужое действие.
 */
export function stashForUndo(msg, swipeIdx, payload) {
    clearStash();
    if (!msg || !payload) return null;
    let copy;
    try { copy = JSON.parse(JSON.stringify(payload)); } catch { return null; }
    const stash = {
        msg,
        swipeIdx: Number(swipeIdx) || 0,
        payload: copy,
        timer: setTimeout(() => { if (_stash === stash) _stash = null; }, UNDO_WINDOW_MS),
    };
    _stash = stash;
    return () => restoreStash(stash);
}

/** Вернуть payload, если его stash до сих пор актуален. true — восстановлен. */
export function restoreStash(stash = _stash) {
    if (!stash || _stash !== stash) return false;
    _stash = null;
    if (stash.timer) clearTimeout(stash.timer);
    return writePayload(stash.msg, stash.swipeIdx, stash.payload) != null;
}

/** Окончательно снять возможность отмены (окно истекло / пришёл новый stash). */
export function clearStash() {
    if (_stash?.timer) clearTimeout(_stash.timer);
    _stash = null;
}

/** Тестовый шов: снять stash без таймерных побочек. */
export function _resetUndo() { _stash = null; }
