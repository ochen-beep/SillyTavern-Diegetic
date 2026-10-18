// Хранилище артефактов ВНЕ файла чата: один JSON-файл на чат на сервере ST
// (user-files API), зеркало в памяти для синхронных чтений.
//
//   файл:  data/<user>/user/files/dg_<storeId>.json
//   ключ записи: send_date свайпа (per-swipe идентичность, которую ведёт сам
//     ST: правка текста её не трогает, новый свайп получает новую)
//   storeId: chatMetadata.dg.storeId (uuid один раз) — стабилен при
//     переименовании файла чата; форк чата наследует метаданные и артефакты.
//
// Чтения синхронны (зеркало). Записи мутируют зеркало синхронно и ставят
// полную перезапись файла в сериализованную цепочку — одна мутация = одна
// запись, по порядку. Объёмы мелкие (сотни КБ), дельты не нужны.
//
// Осиротевшие записи (удалённый свайп без события) не чистятся — растут
// медленно и безвредны; если файл раздуется, добавить GC по кнопке.

import { getCtx, chatData, saveChatData } from './core.js';
import { dgMessageId } from './payload.js';

const warn = (...a) => console.warn('[Diegetic]', ...a);

let _mirror = null;            // { entries: { [sendDate]: payload } } | null до загрузки
let _pending = null;           // записи до первой загрузки: { key: payload|null }
let _writeChain = Promise.resolve();
let _warnedNet = false;

function storeId() {
    const d = chatData();
    if (!d) return null;
    if (!d.storeId) {
        d.storeId = crypto.randomUUID();
        saveChatData();
    }
    return d.storeId;
}

function fileName() {
    const id = storeId();
    return id ? `dg_${id}.json` : null;
}

function stHeaders() {
    const h = getCtx()?.getRequestHeaders?.();
    return h && typeof h === 'object' ? h : { 'Content-Type': 'application/json' };
}

function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}

/** Загрузить зеркало чата. Зовётся на init и CHAT_CHANGED до reconcile. */
export async function loadStore() {
    _mirror = { entries: {} };
    const name = fileName();
    if (name) {
        try {
            const res = await fetch(`/user/files/${encodeURIComponent(name)}`, { headers: stHeaders() });
            if (res.ok) {
                const doc = await res.json().catch(() => null);
                if (doc?.v === 2 && doc.entries && typeof doc.entries === 'object') {
                    _mirror.entries = doc.entries;
                }
            }
            // 404 = первый запуск на этом чате — пустое зеркало, не ошибка.
        } catch (e) {
            if (!_warnedNet) { _warnedNet = true; warn('store: файл недоступен, артефакты живут до перезагрузки:', e); }
        }
    }
    if (_pending) {
        for (const [k, v] of Object.entries(_pending)) {
            if (v === null) delete _mirror.entries[k]; else _mirror.entries[k] = v;
        }
        _pending = null;
        scheduleWrite();
    }
}

/** Синхронное чтение из зеркала. До загрузки/без чата — null. */
export function readEntry(key) {
    return _mirror?.entries?.[key] ?? null;
}

export function writeEntry(key, payload) {
    if (!_mirror) { (_pending ??= {})[key] = payload; void loadStore(); return; }
    _mirror.entries[key] = payload;
    scheduleWrite();
}

export function deleteEntry(key) {
    if (!_mirror) { (_pending ??= {})[key] = null; return; }
    if (!(key in _mirror.entries)) return;
    delete _mirror.entries[key];
    scheduleWrite();
}

function scheduleWrite() {
    _writeChain = _writeChain.then(upload).catch((e) => warn('store: запись:', e));
}

async function upload() {
    const name = fileName();
    if (!name || !_mirror) return;
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: stHeaders(),
        body: JSON.stringify({ name, data: b64encode(JSON.stringify({ v: 2, entries: _mirror.entries })) }),
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
}

/** Хук clean: стереть файл чата. Отсутствующий файл — не ошибка. */
export async function deleteStoreFile() {
    const name = fileName();
    _mirror = null;
    _pending = null;
    if (!name) return;
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: stHeaders(),
            body: JSON.stringify({ path: `user/files/${name}` }),
        });
    } catch (e) { warn('store: удаление:', e); }
}

/**
 * Разовая миграция: перенести payload'ы из extra.dg (слоты swipe_info +
 * зеркала) в файловое хранилище под send_date каждого слота и убрать их из
 * сообщений. Идемпотентна; зовётся после loadStore. true = чат изменён
 * (вызывающий делает persistChat).
 */
export function migrateExtraToStore() {
    const chat = getCtx()?.chat;
    if (!Array.isArray(chat) || !_mirror) return false;
    let changed = false;
    for (const msg of chat) {
        if (!msg || typeof msg !== 'object') continue;
        const seen = new Set();
        const slots = Math.max(
            Array.isArray(msg.swipes) ? msg.swipes.length : 0,
            Array.isArray(msg.swipe_info) ? msg.swipe_info.length : 0,
            1,
        );
        const keyAt = (idx) => `${dgMessageId(msg, { create: true })}:${idx}`;
        if (Array.isArray(msg.swipe_info)) {
            for (let idx = 0; idx < msg.swipe_info.length; idx++) {
                const p = msg.swipe_info[idx]?.extra?.dg;
                if (!p) continue;
                const key = keyAt(idx);
                if (!_mirror.entries[key]) {
                    _mirror.entries[key] = p;
                    seen.add(JSON.stringify(p));
                }
                delete msg.swipe_info[idx].extra.dg;
                changed = true;
            }
        }
        const p = msg.extra?.dg;
        if (p) {
            const key = keyAt(msg.swipe_id ?? 0);
            if (!_mirror.entries[key] && !seen.has(JSON.stringify(p))) _mirror.entries[key] = p;
            delete msg.extra.dg;
            changed = true;
        }
    }
    if (changed) scheduleWrite();
    return changed;
}

/** MESSAGE_DELETED (приходит ПОСЛЕ удаления): выкинуть записи, на которые
 *  больше не ссылается ни одно сообщение чата. Ключи — dg_id:слот; у сообщений
 *  без dg_id записей быть не может (id создаётся только записью/миграцией). */
export function gcStore() {
    const chat = getCtx()?.chat;
    if (!Array.isArray(chat) || !_mirror) return;
    const valid = new Set();
    for (const m of chat) {
        const id = m?.extra?.dg_id;
        if (typeof id !== 'string' || !id) continue;
        const slots = Math.max(
            Array.isArray(m.swipes) ? m.swipes.length : 0,
            Array.isArray(m.swipe_info) ? m.swipe_info.length : 0,
            1,
        );
        for (let i = 0; i < slots; i++) valid.add(`${id}:${i}`);
    }
    for (const k of Object.keys(_mirror.entries)) {
        if (!valid.has(k)) deleteEntry(k);
    }
}

/** Тестовый хук: подменить зеркало без сети (null = «ещё не загружено»). */
export function _testSetEntries(entries) {
    _mirror = entries === null ? null : { entries: entries ?? {} };
    _pending = null;
    _writeChain = Promise.resolve();
}
