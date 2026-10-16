// src/images.js
// Фотослоты внутри артефактов: <div data-dg-img="trigger: описание">…CSS-плейсхолдер…</div>.
// Модуль разделён на чистую часть (парсинг и строковая хирургия — покрыты тестами в node)
// и обёртку над мостом URIS (globalThis.URIS — то же окно, что и мы).

export const SLOT_ATTR = 'data-dg-img';
export const SLOT_STATE_ATTR = 'data-dg-img-state';
export const SLOT_IMG_CLASS = 'dg-slot-img';
export const SLOT_CARD_ATTR = 'data-dg-card';
export const SLOT_STATES = Object.freeze(['loading', 'done', 'error']);
export const BRIDGE_CALLER = 'sthtml';

// Токенизатор открывающих тегов: значения атрибутов в кавычках обходятся целиком,
// поэтому '>' внутри style="…" слот не ломает. Кавычки внутри значения data-dg-img
// запрещены контрактом (см. contract.js) — для него хватает "([^"]*)".
const TAG_RE = /<[a-zA-Z][\w-]*(?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;

function attrValue(tag, name) {
    const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
    return m ? m[1] : null;
}

/** Значение data-dg-img: "trigger: описание" или просто "описание" (trigger = null). */
export function parseSlotValue(raw) {
    const value = String(raw ?? '');
    if (!value.trim()) return null;
    // Regex по нетриммленному значению: «img:  » обязан распарситься как trigger
    // с пустым описанием (→ null), а не как описание «img:» без триггера.
    const m = /^\s*([a-zа-яё0-9_-]{1,24})\s*:\s*([\s\S]+)$/i.exec(value);
    if (m) {
        const desc = m[2].trim();
        if (!desc) return null;
        return { trigger: m[1].toLowerCase().replaceAll('ё', 'е'), desc: desc.slice(0, 4000) };
    }
    return { trigger: null, desc: value.trim().slice(0, 4000) };
}

function normalizeState(raw) {
    return SLOT_STATES.includes(raw) ? raw : null;
}

/**
 * Все фотослоты текста (сообщения целиком или одного артефакта), по порядку в тексте.
 * ordinal — стабильный ключ слота в пределах одной версии текста: хирургия не меняет
 * ни количество слотов, ни их порядок.
 * @returns {Array<{ordinal:number, trigger:string|null, desc:string, state:string|null,
 *                  start:number, end:number, tag:string}>}
 */
export function parseImageSlots(text) {
    const s = String(text ?? '');
    if (!s.includes(SLOT_ATTR)) return [];
    const out = [];
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(s)) !== null) {
        const raw = attrValue(m[0], SLOT_ATTR);
        if (raw === null) continue;
        const parsed = parseSlotValue(raw);
        if (!parsed) continue;
        out.push({
            ordinal: out.length,
            trigger: parsed.trigger,
            desc: parsed.desc,
            state: normalizeState(attrValue(m[0], SLOT_STATE_ATTR)),
            start: m.index,
            end: m.index + m[0].length,
            tag: m[0],
        });
    }
    return out;
}

/** Есть ли слоты, ждущие генерации (нет состояния или ошибка). */
export function hasPendingSlots(text) {
    return parseImageSlots(text).some(sl => sl.state !== 'done');
}

function withState(tag, state) {
    const re = new RegExp(`\\s${SLOT_STATE_ATTR}\\s*=\\s*"[^"]*"`, 'i');
    if (state === null) return tag.replace(re, '');
    const attr = `${SLOT_STATE_ATTR}="${state}"`;
    if (re.test(tag)) return tag.replace(re, ` ${attr}`);
    return tag.replace(/\s*(\/?)>$/, ` ${attr}$1>`);
}

function findSlot(text, ordinal) {
    return parseImageSlots(text).find(sl => sl.ordinal === ordinal) || null;
}

/** Проставить состояние слоту (loading/done/error; null — убрать атрибут состояния).
 *  Текст без слота возвращается как есть. */
export function setSlotState(text, ordinal, state) {
    const slot = findSlot(text, ordinal);
    if (!slot) return String(text ?? '');
    const s = String(text ?? '');
    return s.slice(0, slot.start) + withState(slot.tag, state) + s.slice(slot.end);
}

const escapeAttr = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Нативный путь URIS (user/images/…) → src для <img> в документе таверны. */
export function publicImageSrc(imagePath) {
    const p = String(imagePath ?? '').trim().replace(/^\/+/, '');
    return p ? '/' + p : '';
}

function slotImgHtml(imagePath, cardId) {
    const src = escapeAttr(publicImageSrc(imagePath));
    const card = cardId ? ` ${SLOT_CARD_ATTR}="${escapeAttr(cardId)}"` : '';
    const img = `<img class="${SLOT_IMG_CLASS}"${card} src="${src}" alt="" `
        + 'style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:10;"/>';
    // Контролы (⟳/✎) в хранилище не живут — их рисует display-патч render.js
    // (withSlotControls): сохранённый .html остаётся чистым артефактом.
    // Плейсхолдер отработал — прячем его слои (модели любят z-index:2 на декоре
    // плейсхолдера, которое иначе перекрывает фото с z-index:10... и z-index:1).
    return img + '<style>.css-placeholder{display:none!important}</style>';
}

/**
 * Вставить сгенерированное фото в слот: <img> первым ребёнком слота
 * (поверх CSS-плейсхолдера), состояние → done.
 * Возвращает новый текст или null, если слота нет.
 */
export function injectSlotImage(text, ordinal, imagePath, cardId = null) {
    const slot = findSlot(text, ordinal);
    if (!slot) return null;
    const s = String(text ?? '');
    return s.slice(0, slot.start) + withState(slot.tag, 'done')
        + slotImgHtml(imagePath, cardId) + s.slice(slot.end);
}

const SLOT_IMG_RE = /<img\b[^>]*\bdg-slot-img\b[^>]*>/;

/** id карточки URIS заполненного слота (для removeCard при перегенерации). */
export function slotCardId(text, ordinal) {
    const slot = findSlot(text, ordinal);
    if (!slot) return null;
    const m = SLOT_IMG_RE.exec(String(text ?? '').slice(slot.end));
    return m ? attrValue(m[0], SLOT_CARD_ATTR) : null;
}

/**
 * Переписать промпт слота: data-dg-img="trigger: desc" (без trigger — голое desc).
 * Пустое описание или отсутствующий слот → null. Состояние слота не трогаем:
 * его ставит вызывающий (перегенерация → loading, отложенная — null).
 */
export function setSlotPrompt(text, ordinal, { trigger = null, desc } = {}) {
    const slot = findSlot(text, ordinal);
    if (!slot) return null;
    // Атрибут парсится по "([^"]*)": кавычки/скобки/амперсанд в описании ломают его.
    const cleanDesc = String(desc ?? '').replace(/["<>&]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!cleanDesc) return null;
    const tr = trigger ? String(trigger).trim().toLowerCase().replaceAll('ё', 'е') : '';
    const value = tr ? `${tr}: ${cleanDesc}` : cleanDesc;
    const tag = slot.tag.replace(new RegExp(`\\s${SLOT_ATTR}\\s*=\\s*"[^"]*"`, 'i'), ` ${SLOT_ATTR}="${value}"`);
    const s = String(text ?? '');
    return s.slice(0, slot.start) + tag + s.slice(slot.end);
}

/**
 * Заменить фото в уже заполненном слоте (перегенерация): src и data-dg-card у
 * существующего <img>, состояние → done. Null, если слота или <img> в нём нет —
 * тогда вызывающий падает обратно на injectSlotImage.
 */
export function replaceSlotImage(text, ordinal, imagePath, cardId = null) {
    const slot = findSlot(text, ordinal);
    if (!slot) return null;
    const s = String(text ?? '');
    const rest = s.slice(slot.end);
    const m = SLOT_IMG_RE.exec(rest);
    if (!m) return null;
    const src = escapeAttr(publicImageSrc(imagePath));
    let img = m[0].replace(/\bsrc="[^"]*"/, `src="${src}"`);
    if (cardId) {
        img = new RegExp(`\\s${SLOT_CARD_ATTR}\\s*=\\s*"[^"]*"`, 'i').test(img)
            ? img.replace(new RegExp(`\\s${SLOT_CARD_ATTR}\\s*=\\s*"[^"]*"`, 'i'), ` ${SLOT_CARD_ATTR}="${escapeAttr(cardId)}"`)
            : img.replace(/\s*\/?>$/, ` ${SLOT_CARD_ATTR}="${escapeAttr(cardId)}"$&`);
    }
    return s.slice(0, slot.start) + withState(slot.tag, 'done')
        + img + rest.slice(m.index + m[0].length);
}

// ── Мост URIS (не чистая часть: трогает globalThis) ──
// Нативный режим: одно окно с UR Image Studio, window.parent-хоп больше не нужен.

export function getUrisBridge() {
    try { return globalThis.URIS ?? null; } catch { return null; }
}

const BRIDGE_WAIT_MS = 3000;
const BRIDGE_POLL_MS = 100;

/** Дождаться публикации globalThis.URIS. Сам факт публикации у URIS тихий
 *  (window-событие uris:bridge уходит только на ready и генерациях), а порядок
 *  активации расширений не наш — панель монтируется раньше, чем URIS активируется. */
function waitForBridge(waitMs, pollMs) {
    return new Promise((resolve) => {
        const deadline = Date.now() + waitMs;
        const tick = () => {
            if (getUrisBridge() || Date.now() >= deadline) resolve();
            else setTimeout(tick, pollMs);
        };
        tick();
    });
}

/**
 * Снимок доступности моста для панели. Никогда не бросает. Если глобала ещё
 * нет — до waitMs ждёт его появления, затем (если появился) читает getStatus.
 */
export async function urisStatus({ waitMs = BRIDGE_WAIT_MS, pollMs = BRIDGE_POLL_MS } = {}) {
    let b = getUrisBridge();
    if (!b && waitMs > 0) {
        await waitForBridge(waitMs, pollMs);
        b = getUrisBridge();
    }
    if (!b) return { available: false, accepting: false, connection: null };
    try {
        await Promise.race([
            b.ready,
            new Promise((_, rej) => setTimeout(() => rej(new Error('ready timeout')), 3000)),
        ]);
        const st = await b.getStatus();
        return { available: true, accepting: st?.accepting === true, connection: st?.connection || null };
    } catch {
        return { available: true, accepting: false, connection: null };
    }
}

/**
 * Одна платная генерация через мост. trigger из слота резолвится в реестре URIS
 * (пресет пользователя: aspect, prefix/suffix); useSceneRefs подтягивает референсы
 * персонажа из пула URIS. Ошибки приходят структурированные (err.code/category).
 */
export async function generateSlotImage(slot, { quality = 'medium', imageSize = '1K', signal, onStatus } = {}) {
    const b = getUrisBridge();
    if (!b) throw new Error('UR Image Studio не найден: расширение не установлено или выключено');
    await b.ready;
    const req = { prompt: slot.desc, imageSize, quality, useSceneRefs: true };
    if (slot.trigger) req.trigger = slot.trigger;
    const res = await b.generate(req, { caller: BRIDGE_CALLER, signal, onStatus });
    if (!res?.imagePath) throw new Error('URIS вернул ответ без imagePath');
    return res;
}
