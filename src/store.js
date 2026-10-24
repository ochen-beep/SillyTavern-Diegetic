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

import { getCtx, chatData, saveChatData, randomId } from './core.js';
import { dgMessageId } from './payload.js';

const warn = (...a) => console.warn('[Diegetic]', ...a);

let _mirror = null;            // { entries: { [sendDate]: payload } } | null до загрузки
let _pending = null;           // записи до первой загрузки: { key: payload|null }
let _writeChain = Promise.resolve();
let _warnedNet = false;
let _rawRemote = null;         // сырое содержимое серверного файла (Б29: бэкап перед перезаписью)
let _needsBackup = false;      // файл на сервере не нашей схемы/битый — спасти перед записью
let _lastError = null;         // последняя ошибка записи (Б20: баннер в панели)

function storeId() {
    const d = chatData();
    if (!d) return null;
    if (!d.storeId) {
        d.storeId = randomId();
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
    const mirror = _mirror = { entries: {} };
    const name = fileName();
    if (name) {
        try {
            const res = await fetch(`/user/files/${encodeURIComponent(name)}`, { headers: stHeaders() });
            if (res.ok) {
                const raw = await res.text();
                let doc = null;
                try { doc = JSON.parse(raw); } catch { doc = null; }
                if (doc?.v === 2 && doc.entries && typeof doc.entries === 'object') {
                    // Мержим, а не заменяем: пока GET был в полёте, в зеркало
                    // мог лечь коммит — локальные записи новее снимка сервера.
                    if (_mirror === mirror) mirror.entries = { ...doc.entries, ...mirror.entries };
                    _needsBackup = false;
                    _rawRemote = null;
                } else if (raw.trim()) {
                    // Б29: файл не нашей схемы (v:3 из будущего) или битый JSON.
                    // Раньше молча читали как пустое зеркало — и следующая запись
                    // затирала его навсегда. Теперь: сырое содержимое бэкапится
                    // на сервер перед первой перезаписью.
                    _rawRemote = raw;
                    _needsBackup = true;
                    warn(`store: файл на сервере не нашей схемы (v=${doc?.v ?? 'битый JSON'}) — перед первой записью сохраним резервную копию`);
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
    broadcast('set', key, payload);
    scheduleWrite();
}

export function deleteEntry(key) {
    if (!_mirror) { (_pending ??= {})[key] = null; return; }
    if (!(key in _mirror.entries)) return;
    delete _mirror.entries[key];
    broadcast('del', key);
    scheduleWrite();
}

// ── Синхронизация вкладок (Б12, решение владельца: тихо, без тостов) ──
// Две вкладки одного чата писали каждый своё зеркало — last-write-wins терял
// артефакты одной из них. Операции рассылаются BroadcastChannel'ом и
// применяются в зеркалах соседних вкладок без повторного upload.
const _bc = (typeof window === 'object' && typeof BroadcastChannel === 'function')
    ? new BroadcastChannel('dg-store')
    : null;
if (_bc) {
    _bc.onmessage = (e) => {
        const m = e?.data;
        if (!m || m.storeId !== (chatData()?.storeId ?? null)) return;
        if (!_mirror) return;
        if (m.type === 'set') _mirror.entries[m.key] = m.payload;
        else if (m.type === 'del') delete _mirror.entries[m.key];
        // конфликты не бывает: операция уже зафиксирована на отправителе,
        // здесь только догоняем зеркало. Тишина — осознанное решение.
    };
}
function broadcast(type, key, payload) {
    if (!_bc) return;
    try { _bc.postMessage({ type, key, payload, storeId: chatData()?.storeId ?? null }); } catch { /* вкладка умирает — не критично */ }
}

function scheduleWrite() {
    // Имя файла и содержимое фиксируются в момент постановки в очередь:
    // upload исполняется позже и без снапшота прочитал бы уже СМЕНИВШЕЕСЯ
    // зеркало (CHAT_CHANGED) и имя чужого чата — коммит текущего потерялся бы.
    const name = fileName();
    const body = _mirror ? JSON.stringify({ v: 2, entries: _mirror.entries }) : null;
    _writeChain = _writeChain.then(() => upload(name, body)).catch((e) => {
        _lastError = String(e?.message || e);
        warn('store: запись:', e);
    });
}

async function upload(name, body) {
    if (!name || !body) return;
    // Б29: перед первой перезаписью чужого/битого файла — его резервная копия.
    if (_needsBackup && _rawRemote) {
        const bakName = name.replace(/\.json$/, '') + '.backup.json';
        try {
            const resBak = await fetch('/api/files/upload', {
                method: 'POST',
                headers: stHeaders(),
                body: JSON.stringify({ name: bakName, data: b64encode(_rawRemote) }),
            });
            if (resBak.ok) { _needsBackup = false; _rawRemote = null; }
        } catch { /* бэкап не удался — ещё попытка при следующей записи */ }
    }
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: stHeaders(),
        body: JSON.stringify({ name, data: b64encode(body) }),
    });
    if (!res.ok) throw new Error(`upload ${res.status}`);
    _lastError = null;
}

/** Состояние записи для панели (Б20): ok — последняя запись прошла. */
export function storeStatus() {
    return { ok: !_lastError, error: _lastError };
}

/** Повторить неудавшуюся запись текущего зеркала (кнопка в панели). */
export function retryWrite() {
    if (_mirror) scheduleWrite();
}

/** GC (Б27): удалить записи, не входящие в живой набор ключей dg_id:слот.
 *  Возвращает число удалённых записей. */
export function pruneEntries(liveKeys) {
    if (!_mirror || !(liveKeys instanceof Set)) return 0;
    let removed = 0;
    for (const key of Object.keys(_mirror.entries)) {
        if (!liveKeys.has(key)) { delete _mirror.entries[key]; removed++; }
    }
    if (removed) scheduleWrite();
    return removed;
}

/** Отделить хранилище чата (Б26): новый storeId, текущие записи копируются
 *  в новый файл; старый остаётся родительскому чату/форкам. */
export function detachStore() {
    const d = chatData();
    if (!d?.storeId) return false;
    const entries = { ...(_mirror?.entries ?? {}) };
    d.storeId = randomId();
    saveChatData();
    _mirror = { entries };
    scheduleWrite();
    return true;
}

/** Импорт записей (Б25): по каждому ключу выигрывает более свежий generatedAt.
 *  Возвращает { added, updated }. */
export function mergeEntries(incoming) {
    if (!_mirror || !incoming || typeof incoming !== 'object') return { added: 0, updated: 0 };
    let added = 0;
    let updated = 0;
    for (const [key, payload] of Object.entries(incoming)) {
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.artifacts)) continue;
        const cur = _mirror.entries[key];
        if (!cur) { _mirror.entries[key] = payload; added++; }
        else if ((Number(payload.generatedAt) || 0) > (Number(cur.generatedAt) || 0)) { _mirror.entries[key] = payload; updated++; }
    }
    if (added || updated) scheduleWrite();
    return { added, updated };
}

/** Скачать файл хранилища чата (Б25). false — файла нет/недоступен. */
export async function exportStoreFile() {
    const name = fileName();
    if (!name) return false;
    try {
        const res = await fetch(`/user/files/${encodeURIComponent(name)}`, { headers: stHeaders() });
        if (!res.ok) return false;
        const text = await res.text();
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return true;
    } catch { return false; }
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

/** Тестовый хук: подменить зеркало без сети (null = «ещё не загружено»). */
export function _testSetEntries(entries) {
    _mirror = entries === null ? null : { entries: entries ?? {} };
    _pending = null;
    _writeChain = Promise.resolve();
    _lastError = null;
    _needsBackup = false;
    _rawRemote = null;
}
