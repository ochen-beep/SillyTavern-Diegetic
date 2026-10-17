// src/ui.js — настройки в разделе «Расширения» таверны (inline-drawer) +
// лаунчер кнопки генерации (QR-бар / плавающая, режим buttonMode).
// Панель: сдержанная типографика на переменных темы ST, одна колонка,
// подписи над контролами, один primary на секцию. Шаблоны и контекст —
// по форме DS-Comments (edit-on-place, тумблеры секций).
// Делегированные обработчики — на document в namespace .diegetic и scoped к
// #dg-ext: старый runner-скрипт рисует панель с теми же id — наши обработчики
// не должны на него срабатывать.
import { readRawPayload, digestForVariant } from './payload.js';

/** Чистая: строки списка артефактов для панели — скан extra всего чата.
 *  msgId — это индекс в массиве chat. Статус stale: digest payload разошёлся
 *  с текстом (правка/свайп) — render.js перепривяжет при следующей отрисовке. */
export function collectRows(chat) {
    const rows = [];
    (Array.isArray(chat) ? chat : []).forEach((msg, msgId) => {
        if (!msg || typeof msg !== 'object') return;
        const idx = msg.swipe_id ?? 0;
        const payload = readRawPayload(msg, idx);
        if (!payload) return;
        const stale = payload.contentDigest !== digestForVariant(msg, idx);
        for (const a of payload.artifacts) {
            rows.push({ ...a, msgId, status: stale ? 'stale' : a.status });
        }
    });
    rows.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    return rows;
}

const CSS = `
/* ── Панель настроек #dg-ext ─────────────────────────────────────────── */
#dg-ext { font-size: 13px; line-height: 1.5; color: var(--SmartThemeBodyColor, #ddd); }
/* Свои поля: у inline-drawer-content хоста паддингов нет, и секции липли к краям */
#dg-ext .inline-drawer-content { padding: 2px 10px 10px; box-sizing: border-box; }
#dg-ext .dg-body > .dg-section { border-top: 1px solid var(--black30a, rgba(128,128,128,.18));
  padding: 14px 0 6px; margin: 0; }
#dg-ext .dg-body > .dg-section:first-child { border-top: none; padding-top: 2px; }
#dg-ext .dg-title { font-size: 11.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .07em; opacity: .65; margin: 0 0 10px; }
#dg-ext .dg-hint { opacity: .55; font-size: 12px; margin: 8px 0 0; line-height: 1.45; }
#dg-ext .dg-hint b { opacity: 1; font-weight: 600; }

/* Строка настройки: подпись слева, контрол справа, ровные колонки */
#dg-ext .dg-row { display: grid; grid-template-columns: 1fr auto; align-items: center;
  gap: 4px 12px; padding: 7px 0; }
#dg-ext .dg-row > label { cursor: pointer; }
#dg-ext .dg-row .text_pole { width: auto; min-width: 190px; }
#dg-ext .dg-row input[type=number].text_pole { min-width: 72px; text-align: right; }
#dg-ext .dg-sub { grid-column: 1 / -1; padding-left: 42px; opacity: .55; font-size: 12px; }

/* Свитч: мгновенное действие, состояние видно без сохранения */
#dg-ext .dg-switch { position: relative; width: 34px; height: 19px; flex: none; cursor: pointer; }
#dg-ext .dg-switch input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
#dg-ext .dg-switch i { position: absolute; inset: 0; border-radius: 19px; transition: background .15s;
  background: var(--black30, rgba(0,0,0,.4)); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  pointer-events: none; /* иначе <i> перекрывает input и свитч никогда не кликается */ }
#dg-ext .dg-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px;
  border-radius: 50%; background: var(--SmartThemeBodyColor, #ddd); transition: left .15s; }
#dg-ext .dg-switch input:checked + i { background: var(--SmartThemeEmColor, #c9a86a); }
#dg-ext .dg-switch input:checked + i::after { left: 17px; background: var(--black300, #16161a); }
#dg-ext .dg-switch input:focus-visible + i { outline: 2px solid var(--SmartThemeEmColor, #c9a86a); outline-offset: 2px; }

/* Широкие контролы и кнопочные ряды */
#dg-ext .dg-wide { width: 100%; }
#dg-ext .dg-btnrow { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
#dg-ext .dg-btnrow .menu_button { background: var(--black30, rgba(0,0,0,.25)); border-radius: 8px; }
#dg-ext .dg-btn-primary { border: 1px solid var(--SmartThemeEmColor, #c9a86a);
  color: var(--SmartThemeEmColor, #c9a86a); font-weight: 600; }
#dg-ext .dg-btn-danger { color: #ff8b8b; }
#dg-ext .menu_button:disabled { opacity: .4; cursor: not-allowed; }
#dg-ext .menu_button:not(:disabled):hover { border-color: var(--SmartThemeEmColor, #c9a86a); }
#dg-ext details { margin-top: 6px; }
#dg-ext details > summary { cursor: pointer; padding: 7px 0; list-style-position: inside; }
#dg-ext details[open] > summary { margin-bottom: 4px; }

/* Сегментный выбор источника (форма DS-Comments) */
#dg-ext .dg-seg { display: flex; gap: 3px; margin-bottom: 10px; padding: 3px;
  background: var(--black30, rgba(0,0,0,.25));
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.15)); border-radius: 10px; }
#dg-ext .dg-seg-btn { flex: 1; border: none; background: transparent; cursor: pointer;
  color: var(--SmartThemeBodyColor, #ccc); opacity: .6; border-radius: 8px;
  padding: 6px 8px; font-size: 12.5px; transition: background .15s, opacity .15s; }
#dg-ext .dg-seg-btn:hover { opacity: 1; }
#dg-ext .dg-seg-btn.dg-seg-active { background: var(--SmartThemeEmColor, #c9a86a);
  color: var(--black300, #16161a); opacity: 1; font-weight: 600; }
#dg-ext .dg-seg-btn:focus-visible { outline: 2px solid var(--SmartThemeEmColor, #c9a86a); outline-offset: 1px; }

/* Список артефактов чата */
#dg-ext .dg-art-row { display: flex; align-items: center; gap: 8px; padding: 5px 0;
  border-top: 1px solid var(--black30a, rgba(128,128,128,.14)); font-size: 12.5px; }
#dg-ext .dg-art-row:first-of-type { border-top: none; }
#dg-ext .dg-art-status { flex: none; width: 10px; text-align: center; }
#dg-ext .dg-art-type { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#dg-ext .dg-art-meta { flex: 1; opacity: .55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#dg-ext .dg-art-btn { flex: none; cursor: pointer; padding: 2px 8px; font-size: 12px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2)); border-radius: 6px;
  background: var(--black30, rgba(0,0,0,.25)); color: inherit; }
#dg-ext .dg-art-btn:hover { border-color: var(--SmartThemeEmColor, #c9a86a); }

/* ── Артефакты в посте: по центру, без швов и скроллбаров ───────────── */
.dg-shell { margin: 10px 0; position: relative; display: flex; flex-direction: column;
  align-items: center; }
.dg-shell.dg-chiprow { flex-direction: row; flex-wrap: wrap; }
.dg-shell > iframe, .dg-shell > .dg-chiprow { width: 100%; }
.dg-shell.dg-chiprow > .dg-chip, .dg-shell.dg-chiprow > .dg-chip-action { width: auto; }
.dg-frame { border: 0; display: block; min-height: 80px; background: transparent;
  color-scheme: normal; }
.dg-chiprow { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.dg-chiprow-attached { margin-top: 6px; }
.dg-chip, .dg-chip-action { cursor: pointer; border-radius: 8px; padding: 6px 14px; font-size: 13px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  background: var(--black30, rgba(0,0,0,.25)); color: var(--SmartThemeBodyColor, #ddd); }
.dg-chip { font-weight: 600; }
.dg-chip:hover, .dg-chip-action:hover { border-color: var(--SmartThemeEmColor, #c9a86a); }

/* ── Лайтбокс: иммерсивный — только затемнение и сам артефакт ──────── */
/* Опорный пункт: НЕ полагаться на inset:0 для размеров. В некоторых
   сборках хоста боксы html/body схлопываются (body fixed + transform-
   обёртки других расширений), и fixed-оверлей с auto-высотой получает
   0px — диалог уезжает центр-верх за экран. Явные lvw/lvh снимают
   зависимость от бокса корня; vh-фолбэк для старых движков. */
.dg-popup { position: fixed; inset: 0; z-index: 2999; display: flex; align-items: center;
  justify-content: center; width: 100vw; height: 100vh; width: 100lvw; height: 100lvh; }
.dg-popup-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.72); }
/* Колонка: шапка сверху во всю ширину, артефакт ниже. Без column iframe на
   100% ширины сплющивает header в узкую полоску сбоку. */
.dg-popup-dialog { position: relative; width: min(820px, 94vw); height: min(86vh, 900px);
  display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; }
.dg-popup-dialog > header { flex: none; display: flex; justify-content: space-between;
  align-items: center; padding: 6px 12px; color: #fff; font-size: 13px; opacity: .85; }
.dg-popup-dialog > header .dg-popup-close { position: static; }
.dg-popup-dialog iframe { flex: 1; min-height: 0; width: 100%; border: 0; background: transparent; }
.dg-popup-close { position: absolute; top: 10px; right: 14px; z-index: 2; cursor: pointer;
  background: rgba(0,0,0,.55); color: #fff; border: 1px solid rgba(255,255,255,.3);
  border-radius: 50%; width: 34px; height: 34px; font-size: 16px; }

/* ── Редактор промпта фотослота (рендерится в родительском документе) ──
   Стили самих слотов/контролов живут внутри артефакта (render.js SLOT_CTL_CSS):
   родительский CSS в sandbox-iframe не проникает. */
.dg-editor-dialog { height: auto; width: min(520px, 92vw); display: block;
  background: var(--SmartThemeBlurTintColor, rgba(20,20,24,.96));
  border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 10px; padding: 14px 16px; }
.dg-editor-dialog header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.dg-editor-dialog .dg-popup-close { position: static; }
.dg-editor-row { display: block; margin-bottom: 10px; font-size: 13px; }
.dg-editor-row select { width: 100%; margin-top: 4px; padding: 6px 8px; border-radius: 6px;
  background: var(--SmartThemeInputBg, #1e1e22); color: inherit; border: 1px solid var(--SmartThemeBorderColor, #444); }
.dg-editor-dialog textarea { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 6px;
  background: var(--SmartThemeInputBg, #1e1e22); color: inherit; border: 1px solid var(--SmartThemeBorderColor, #444);
  font: inherit; resize: vertical; }
.dg-editor-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }

/* ── Кнопки генерации: анимация занятости (пост/QR-бар/FAB) ─────────── */
.dg-gen-btn.dg-busy i, .dg-launcher-btn.dg-busy i { animation: dgSpin 1s linear infinite; }
.dg-launcher-btn.dg-busy { color: var(--SmartThemeEmColor, #c9a86a); }
.dg-launcher-btn.dg-busy::after { content: ''; position: absolute; inset: 2px; border-radius: 50%;
  border: 2px solid var(--SmartThemeEmColor, #c9a86a); border-top-color: transparent;
  animation: dgSpin 0.9s linear infinite; }
@keyframes dgSpin { to { transform: rotate(360deg); } }

/* Лаунчер: QR-бар — как родная кнопка бара; плавающая — фиксированный угол */
.dg-launcher-btn { position: relative; cursor: pointer; }
#dg-launcher-fab { position: fixed; right: 20px; bottom: 84px; z-index: 2999; width: 38px; height: 38px;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--SmartThemeBlurTintColor, #1e1e22); color: var(--SmartThemeEmColor, #c9a86a);
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  box-shadow: 0 6px 18px rgba(0,0,0,.4); opacity: .85; }
#dg-launcher-fab:hover { opacity: 1; }
#dg-launcher-fab.dg-fab-dragging { opacity: 1; cursor: grabbing; }
`;

// type/status приходят из вывода модели, name/id — из настроек, исключения пишет
// пользователь: всё это попадает в документ через .html() — только через esc.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DISPLAY_LABELS = { inline: 'Сразу в посте', expand: 'Кнопка → развернуть в посте', popup: 'Кнопка → во всплывающем окне' };
const BUTTON_LABELS = { post: 'У каждого поста', bar: 'В квик-баре', floating: 'Плавающая' };

/** Статусы привязки артефакта для панельного списка: точка-цвет + пояснение. */
const ART_STATUS = {
    ok: { color: '#9c9', label: 'привязан к якорю' },
    fuzzy: { color: '#fc6', label: 'привязка неточная (fuzzy)' },
    orphan: { color: '#f88', label: 'якорь не найден — в посте не показывается' },
    stale: { color: '#9cf', label: 'текст поста менялся — перепривяжется при отрисовке' },
};

/** Чистая: HTML строк панельного списка артефактов чата. */
export function artifactListHtml(rows) {
    if (!rows?.length) return '<p class="dg-hint">в этом чате артефактов пока нет</p>';
    return rows.map((a) => {
        const st = ART_STATUS[a.status] ?? ART_STATUS.ok;
        return `<div class="dg-art-row" data-msg="${Number(a.msgId)}" data-art="${esc(a.id)}">`
            + `<span class="dg-art-status" style="color:${st.color}" title="${esc(st.label)}">●</span>`
            + `<span class="dg-art-type">${esc(a.type || 'artifact')}</span>`
            + `<span class="dg-art-meta">пост #${Number(a.msgId)}</span>`
            + '<button type="button" class="dg-art-btn" data-art-open title="Открыть во всплывающем окне">👁</button>'
            + '<button type="button" class="dg-art-btn" data-art-save title="Сохранить как .html">⤓</button>'
            + '<button type="button" class="dg-art-btn" data-art-regen title="Перегенерировать артефакты поста">⟳</button>'
            + '<button type="button" class="dg-art-btn" data-art-del title="Удалить артефакт">✕</button>'
            + '</div>';
    }).join('');
}

// ── Лаунчер кнопки генерации (режим buttonMode) ──

let _launcherObserver = null;
let _onLauncherClick = null;
let _launcherMode = null;
/** window-слушатель событий моста URIS (вешается в mountPanel, живёт до unmountUi). */
let _onUrisBridgeEvent = null;
let _fabResizeBound = false;

// ── Плавающая кнопка: драг + запоминание позиции (форма DS-Comments FAB) ──
// Pointer Events + setPointerCapture: мышь и тач одним кодом; порог 6px отделяет
// клик от драга; позиция пишется в localStorage только на отпускании.

const FAB_ID = 'dg-launcher-fab';
const FAB_POSITION_KEY = 'diegetic_fab_position';
const FAB_SIZE = 38;
const DRAG_THRESHOLD_PX = 6;

/** Чистая: дефолтный угол. На мобильных выше — низ съедают send_form/клавиатура. */
export function defaultFabPosition(viewport, size, isMobile) {
    const right = isMobile ? 16 : 20;
    const bottom = isMobile ? 120 : 84;
    return {
        left: Math.max(0, viewport.width - size - right),
        top: Math.max(0, viewport.height - size - bottom),
    };
}

/** Чистая: клэмп в вьюпорт; topInset (верхняя панель ST) не даёт спрятаться под ней. */
export function clampFabPosition(pos, viewport, size, topInset = 0) {
    const left = Math.max(0, Math.min(pos.left, viewport.width - size));
    const top = Math.max(0, Math.min(pos.top, viewport.height - size));
    return topInset > 0 ? { left, top: Math.min(Math.max(top, topInset), viewport.height - size) } : { left, top };
}

/** Чистая: сохранённая позиция, если ещё целиком во вьюпорте, иначе дефолт. */
export function computeRestoredFabPosition(saved, viewport, size, isMobile) {
    if (saved
        && Number.isFinite(saved.left) && Number.isFinite(saved.top)
        && saved.left >= 0 && saved.top >= 0
        && saved.left + size <= viewport.width
        && saved.top + size <= viewport.height) {
        return { left: saved.left, top: saved.top };
    }
    return defaultFabPosition(viewport, size, isMobile);
}

const fabViewport = () => ({
    width: globalThis.window?.innerWidth ?? 1024,
    height: globalThis.window?.innerHeight ?? 768,
});
const isMobileViewport = () => (globalThis.window?.innerWidth ?? 1024) < 768;

// Верхняя панель ST рисуется поверх FAB (z-index выше) — клэмпим позицию под ней,
// иначе кнопка, брошенная в верхнюю полосу, навсегда уезжает под бар.
function stTopBarInset() {
    const bar = globalThis.document?.getElementById?.('top-bar');
    if (!bar?.getBoundingClientRect) return 0;
    try {
        const bottom = bar.getBoundingClientRect().bottom;
        return Number.isFinite(bottom) && bottom > 0 ? Math.min(bottom, globalThis.window.innerHeight) : 0;
    } catch { return 0; }
}

function readSavedFabPosition() {
    try {
        const raw = globalThis.localStorage?.getItem?.(FAB_POSITION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function persistFabPosition(icon) {
    try {
        globalThis.localStorage?.setItem?.(FAB_POSITION_KEY, JSON.stringify({
            left: parseFloat(icon.style.left),
            top: parseFloat(icon.style.top),
        }));
    } catch { /* приватный режим — позиция просто не переживёт рестарт */ }
}

function placeFab(icon, pos) {
    icon.style.left = `${pos.left}px`;
    icon.style.top = `${pos.top}px`;
    icon.style.right = 'auto';
    icon.style.bottom = 'auto';
}

function restoreFabPosition(icon) {
    placeFab(icon, clampFabPosition(
        computeRestoredFabPosition(readSavedFabPosition(), fabViewport(), FAB_SIZE, isMobileViewport()),
        fabViewport(), FAB_SIZE, stTopBarInset()));
}

function onFabResize() {
    const icon = globalThis.document?.getElementById?.(FAB_ID);
    const left = parseFloat(icon?.style?.left);
    const top = parseFloat(icon?.style?.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    placeFab(icon, clampFabPosition({ left, top }, fabViewport(), FAB_SIZE, stTopBarInset()));
}

function makeFabDraggable(icon) {
    let dragging = false;
    let offsetX = 0, offsetY = 0, startX = 0, startY = 0;
    icon.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragging = false;
        const r = icon.getBoundingClientRect();
        offsetX = e.clientX - r.left;
        offsetY = e.clientY - r.top;
        startX = r.left;
        startY = r.top;
        try { icon.setPointerCapture?.(e.pointerId); } catch { /* указатель уже отпущен */ }
        e.preventDefault();
    });
    icon.addEventListener('pointermove', (e) => {
        if (!icon.hasPointerCapture?.(e.pointerId)) return;
        const rawX = e.clientX - offsetX;
        const rawY = e.clientY - offsetY;
        if (!dragging && Math.hypot(rawX - startX, rawY - startY) > DRAG_THRESHOLD_PX) {
            dragging = true;
            icon.classList.add('dg-fab-dragging');
        }
        placeFab(icon, clampFabPosition({ left: rawX, top: rawY }, fabViewport(), FAB_SIZE, stTopBarInset()));
    });
    icon.addEventListener('pointerup', (e) => {
        if (icon.hasPointerCapture?.(e.pointerId)) icon.releasePointerCapture?.(e.pointerId);
        const wasDragging = dragging;
        dragging = false;
        icon.classList.remove('dg-fab-dragging');
        if (wasDragging) persistFabPosition(icon);
        else _onLauncherClick?.(); // клик — здесь: отдельный click-слушатель дал бы двойной вызов
    });
    icon.addEventListener('pointercancel', () => {
        dragging = false;
        icon.classList.remove('dg-fab-dragging');
    });
    icon.style.touchAction = 'none'; // тач двигает кнопку, а не скроллит страницу
}

function getQuickReplyBar() {
    return document.querySelector('#send_form #qr--bar')
        || document.getElementById('qr--bar')
        || document.querySelector('#send_form .qr--bar');
}
function getLauncherHost() {
    const qrBar = getQuickReplyBar();
    return qrBar ? (qrBar.querySelector('.qr--buttons') || qrBar) : null;
}

function makeLauncherButton(id, cls, { fab = false } = {}) {
    const b = document.createElement('div');
    b.id = id;
    b.className = cls;
    b.title = fab
        ? 'Diegetic: сгенерировать артефакт для последнего поста (перетаскивается)'
        : 'Diegetic: сгенерировать артефакт для последнего поста';
    b.innerHTML = '<i class="fa-solid fa-scroll"></i>';
    if (fab) {
        b.setAttribute('role', 'button');
        b.tabIndex = 0;
        b.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onLauncherClick?.(); }
        });
        makeFabDraggable(b);
        restoreFabPosition(b);
    } else {
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _onLauncherClick?.(); });
    }
    return b;
}

/** Создать/перецепить кнопку бара в текущий хост. false — хоста ещё нет. */
function syncBarButton() {
    const host = getLauncherHost();
    if (!host) return false;
    const btn = document.getElementById('dg-launcher-bar')
        || makeLauncherButton('dg-launcher-bar', 'qr--button menu_button interactable dg-launcher-btn');
    if (btn.parentElement !== host) host.appendChild(btn);
    return true;
}

function disconnectLauncherObserver() {
    if (_launcherObserver) { try { _launcherObserver.disconnect(); } catch { /* ок */ } _launcherObserver = null; }
}

/** Снять подписку на события моста URIS (disable/clean и повторный mount). */
function disconnectUrisBridgeListener() {
    if (!_onUrisBridgeEvent) return;
    try {
        window.removeEventListener('uris:bridge', _onUrisBridgeEvent);
        window.removeEventListener('uris:bridge-destroyed', _onUrisBridgeEvent);
    } catch { /* ок */ }
    _onUrisBridgeEvent = null;
}

/** Сколько после «моста нет» не повторять ожидание его появления: молча глобал
 *  опубликоваться не может (публикация тихая и происходит только при enable
 *  URIS, а готовность ловится событием ready). */
const URIS_ABSENT_GRACE_MS = 30_000;

export function ensureLauncher(mode, onClick) {
    const barBtn = document.getElementById('dg-launcher-bar');
    const fab = document.getElementById('dg-launcher-fab');
    _launcherMode = mode;
    _onLauncherClick = onClick;
    if (mode !== 'bar' && mode !== 'floating') {
        barBtn?.remove();
        fab?.remove();
        disconnectLauncherObserver();
        return;
    }
    if (mode === 'bar') {
        fab?.remove();
        // К нашему init QR-бара ещё не существует (QR инициализируется позже),
        // а при смене чата/настроек пересобирает контейнер — кнопка гибнет
        // вместе с ним. Поэтому наблюдатель вешаем всегда: он создаст кнопку,
        // когда хост появится, и пересоздаст её после пересборки.
        const target = document.getElementById('send_form') || document.documentElement;
        if (!_launcherObserver) {
            _launcherObserver = new MutationObserver(() => {
                if (_launcherMode === 'bar') syncBarButton();
            });
            _launcherObserver.observe(target, { childList: true, subtree: true });
        }
        if (!syncBarButton()) barBtn?.remove();
    } else {
        barBtn?.remove();
        disconnectLauncherObserver();
        if (!fab) document.body.appendChild(makeLauncherButton('dg-launcher-fab', 'dg-launcher-btn interactable', { fab: true }));
        // Вьюпорт сжался — вернуть кнопку внутрь (позиция в localStorage не трогается).
        if (!_fabResizeBound && typeof window !== 'undefined') {
            _fabResizeBound = true;
            window.addEventListener('resize', onFabResize);
        }
    }
}

// ── Панель настроек ──

export function mountPanel(deps) {
    const $ = deps.$;
    const doc = document;

    // Idempotent-remount + зачистка DOM старого runner-скрипта (он рисует
    // панель/FAB с теми же id и дублирует настройки). ВАЖНО: наш <style> —
    // под отдельным id (dg-style-native): старый скрипт монтируется позже и
    // подменяет #dg-style своим CSS, убивая стили drawer и попапа.
    for (const id of ['dg-style-native', 'dg-ext', 'dg-panel', 'dg-fab', 'dg-qr-btn']) {
        doc.getElementById(id)?.remove();
    }
    // Живой старый скрипт Diegetic ещё в раннере? — предупредить один раз.
    if (!mountPanel._legacyWarned && doc.querySelector('iframe[id^="TH-script--Diegetic"]')) {
        mountPanel._legacyWarned = true;
        doc.defaultView?.toastr?.warning?.(
            'В библиотеке скриптов 酒馆助手 всё ещё включён старый скрипт «Diegetic» — он дублирует настройки и генерацию. Отключите или удалите его там.',
            'Diegetic', { timeOut: 12000 });
    }

    const style = doc.createElement('style');
    style.id = 'dg-style-native';
    style.textContent = CSS;
    doc.head.appendChild(style);

    // Секция в «Расширения» — стандартный inline-drawer.
    const container = doc.createElement('div');
    container.id = 'dg-ext';
    container.className = 'extension_block';
    container.innerHTML = `
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>◆ Diegetic</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content"><div class="dg-body"></div></div>
      </div>`;
    const hostEl = doc.getElementById('extensions_settings');
    if (!hostEl) return { render() {} };
    hostEl.appendChild(container);
    const panel = container.querySelector('.dg-body');

    const displayOpts = (sel) => ['inline', 'expand', 'popup']
        .map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${DISPLAY_LABELS[s]}</option>`).join('');
    const buttonOpts = (sel) => ['post', 'bar', 'floating']
        .map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${BUTTON_LABELS[s]}</option>`).join('');

    const render = () => {
        const st = deps.settings();
        const cmProfiles = deps.listCmProfiles ? deps.listCmProfiles() : [];
        const cmSel = deps.getCmProfile?.()?.profileId || '';
        const cmOptions = cmProfiles
            .map(p => `<option value="${esc(p.id)}" ${p.id === cmSel ? 'selected' : ''}>${esc(p.name)}</option>`)
            .join('');

        $(panel).html(`
      <div class="dg-section">
        <div class="dg-row">
          <label for="dg-enabled"><b>Автогенерация</b> — артефакт после каждого поста
            <div class="dg-hint">выключена — запуск кнопкой ◆ у поста или из квик-бара</div></label>
          <span class="dg-switch"><input type="checkbox" id="dg-enabled" ${st.enabled ? 'checked' : ''}/><i></i></span>
        </div>
      </div>
      <div class="dg-section">
        <p class="dg-title">Показ и кнопка</p>
        <div class="dg-row"><label for="dg-display-mode">Артефакт в посте</label>
          <select id="dg-display-mode" class="text_pole">${displayOpts(st.displayMode)}</select></div>
        <div class="dg-row"><label for="dg-button-mode">Кнопка генерации</label>
          <select id="dg-button-mode" class="text_pole">${buttonOpts(st.buttonMode)}</select></div>
      </div>
      <div class="dg-section">
        <p class="dg-title">Шаблон</p>
        <select id="dg-template-select" class="text_pole dg-wide"></select>
        <textarea id="dg-template-text" class="text_pole dg-wide" rows="10" style="margin-top:8px" spellcheck="false"></textarea>
        <div class="dg-btnrow">
          <button class="menu_button dg-btn-primary" id="dg-tpl-save">Сохранить</button>
          <button class="menu_button" id="dg-tpl-saveas">Сохранить как…</button>
          <button class="menu_button" id="dg-tpl-reset">Вернуть встроенный</button>
          <button class="menu_button dg-btn-danger" id="dg-tpl-del">Удалить</button>
        </div>
        <div class="dg-btnrow" id="dg-tpl-saveas-row" style="display:none">
          <input id="dg-tpl-saveas-name" class="text_pole" style="flex:1" placeholder="имя нового шаблона"/>
          <button class="menu_button dg-btn-primary" id="dg-tpl-saveas-ok">Сохранить</button>
        </div>
        <div class="dg-row" style="margin-top:8px">
          <label for="dg-max-count">Артефактов на пост</label>
          <input id="dg-max-count" type="number" class="text_pole" min="1" max="5" value="${st.maxPerMessage}"/>
        </div>
      </div>
      <div class="dg-section">
        <p class="dg-title">Источник генерации</p>
        <div class="dg-seg" role="group" aria-label="Источник генерации">
          <button type="button" class="dg-seg-btn" data-src="profile">Профиль подключения</button>
          <button type="button" class="dg-seg-btn" data-src="custom">Свой endpoint</button>
        </div>
        <div id="dg-src-profile" hidden>
          ${cmOptions
            ? `<div class="dg-row"><label for="dg-cm-profile">Профиль подключения</label>
               <select id="dg-cm-profile" class="text_pole">${cmOptions}</select></div>
               <p class="dg-hint">Выбор сохраняется сразу.</p>`
            : '<p class="dg-hint">Расширение connection-manager не найдено или в нём нет профилей.</p>'}
        </div>
        <div id="dg-src-custom" hidden>
          <div class="dg-row"><label for="dg-apiurl">URL</label>
            <input id="dg-apiurl" type="text" class="text_pole" value="${esc(deps.getCustom().apiurl)}" placeholder="https://…/v1"/></div>
          <div class="dg-row"><label for="dg-model">Модель</label>
            <input id="dg-model" type="text" class="text_pole" value="${esc(deps.getCustom().model)}" placeholder="необязательно"/></div>
          <div class="dg-row"><label for="dg-key">Ключ</label>
            <input id="dg-key" type="password" class="text_pole" value="" placeholder="sk-… (хранится в браузере)"/></div>
          <div class="dg-btnrow"><button class="menu_button dg-btn-primary" id="dg-save-source">Применить</button></div>
          <p class="dg-hint">https — свободно; plain-HTTP вне localhost спросит подтверждение
            и попадёт в список разрешённых. Ключ живёт в localforage браузера, не в settings.json.</p>
        </div>
        <div class="dg-row"><label for="dg-extrabody">Доп. параметры запроса (JSON)</label>
          <input id="dg-extrabody" type="text" class="text_pole" value="${esc(deps.getCustom().extraBody)}" placeholder='{"reasoning_effort":"none"}' style="min-width:230px"/></div>
      </div>
      <div class="dg-section">
        <p class="dg-title">Контекст генерации</p>
        <div class="dg-row">
          <label for="dg-ctx-history">История чата</label>
          <span style="display:flex; align-items:center; gap:8px">
            <input id="dg-ctx-depth" type="number" class="text_pole" min="1" max="20" value="${st.contextDepth}" ${st.ctxHistory ? '' : 'disabled'} title="глубина, сообщений"/>
            <span class="dg-switch"><input type="checkbox" id="dg-ctx-history" ${st.ctxHistory ? 'checked' : ''}/><i></i></span>
          </span>
        </div>
        <div class="dg-row"><label for="dg-ctx-persona">Персона {{user}}</label>
          <span class="dg-switch"><input type="checkbox" id="dg-ctx-persona" class="checkbox" ${st.ctxPersona ? 'checked' : ''}/><i></i></span></div>
        <div class="dg-row"><label for="dg-ctx-character">Описание персонажа</label>
          <span class="dg-switch"><input type="checkbox" id="dg-ctx-character" class="checkbox" ${st.ctxCharacter ? 'checked' : ''}/><i></i></span></div>
        <div class="dg-row"><label for="dg-ctx-world">Лорбуки — активированные записи</label>
          <span class="dg-switch"><input type="checkbox" id="dg-ctx-world" class="checkbox" ${st.ctxWorld ? 'checked' : ''}/><i></i></span></div>
      </div>
      <div class="dg-section">
        <details>
          <summary><span class="dg-title" style="display:inline">Библиотека артефактов</span></summary>
          <div id="dg-art-list"></div>
          <p class="dg-hint">👁 — открыть, ⤓ — файл, ⟳ — регенерация поста, ✕ — удалить.
            Статус <b>orphan</b>: якорь потерян, в посте не показывается.</p>
        </details>
      </div>
      <div class="dg-section">
        <details>
          <summary><span class="dg-title" style="display:inline">Фото через URIS</span></summary>
          <div class="dg-row"><label for="dg-img-mode">Режим</label>
            <select id="dg-img-mode" class="text_pole">
              <option value="off" ${st.imageMode === 'off' ? 'selected' : ''}>выключено</option>
              <option value="button" ${st.imageMode === 'button' ? 'selected' : ''}>по кнопке 📷 на посте</option>
              <option value="auto" ${st.imageMode === 'auto' ? 'selected' : ''}>авто (платно, за каждый слот)</option>
            </select></div>
          <div class="dg-row"><label for="dg-img-quality">Качество</label>
            <select id="dg-img-quality" class="text_pole">
              <option value="low" ${st.imageQuality === 'low' ? 'selected' : ''}>low</option>
              <option value="medium" ${st.imageQuality === 'medium' ? 'selected' : ''}>medium</option>
              <option value="high" ${st.imageQuality === 'high' ? 'selected' : ''}>high</option>
            </select></div>
          <p class="dg-hint" id="dg-uris-status">проверка моста…</p>
          <p class="dg-hint">Слоты в артефактах (<code>data-dg-img</code>) заполняются фото из
            UR Image Studio: поляроиды, селфи, снимки к статьям. CSS-плейсхолдер — фолбэк.</p>
        </details>
      </div>
      <div class="dg-section">
        <details>
          <summary><span class="dg-title" style="display:inline">Исключения авторежима</span></summary>
          <textarea id="dg-excl" class="text_pole dg-wide" rows="3">${esc(deps.getExclusions())}</textarea>
          <div class="dg-btnrow"><button class="menu_button" id="dg-save-excl">Сохранить исключения</button></div>
          <p class="dg-hint">фраза на строку — на постах с такой фразой авторежим молчит</p>
        </details>
      </div>`);
            refreshUrisStatus();
            syncTemplateEditor();
            syncSourceSection();
            fillCustomKeyField();
            renderArtifactList();
            ensureLauncher(deps.settings().buttonMode, deps.runLatest);
        };

    // ── Список артефактов чата (README обещает: ⟳ регенерация / ✕ удаление) ──
    const renderArtifactList = () => {
        const box = doc.getElementById('dg-art-list');
        if (box && deps.listArtifacts) box.innerHTML = artifactListHtml(deps.listArtifacts());
    };

    // ── Источник: сегментный выбор (форма DS-Comments) ──
    const syncSourceSection = () => {
        const kind = deps.getSourceKind();
        doc.querySelectorAll('#dg-ext .dg-seg-btn').forEach((b) => {
            const on = b.dataset.src === kind;
            b.classList.toggle('dg-seg-active', on);
            b.setAttribute('aria-pressed', String(on));
        });
        const prof = doc.getElementById('dg-src-profile');
        const cust = doc.getElementById('dg-src-custom');
        if (prof) prof.hidden = kind !== 'profile';
        if (cust) cust.hidden = kind !== 'custom';
    };
    const fillCustomKeyField = () => {
        const el = doc.getElementById('dg-key');
        if (!el || !deps.getCustomKey) return;
        deps.getCustomKey().then((k) => { if (el.isConnected && !el.value) el.placeholder = k ? 'сохранён — введи для замены' : 'sk-… (хранится в браузере)'; }).catch(() => {});
    };

    // ── Редактор шаблонов (форма DS-Comments: список + edit-on-place) ──
    // Monotonic-request guard: быстрые переключения дают несколько async-
    // загрузок; отставшая не должна перезаписать textarea.
    let _tplReq = 0;
    async function syncTemplateEditor() {
        const req = ++_tplReq;
        const st = deps.settings();
        const select = doc.getElementById('dg-template-select');
        const textarea = doc.getElementById('dg-template-text');
        const bSave = doc.getElementById('dg-tpl-save');
        const bReset = doc.getElementById('dg-tpl-reset');
        const bDel = doc.getElementById('dg-tpl-del');
        if (!select) return;
        const cur = deps.getActiveTemplate();
        const builtin = deps.isBuiltinTemplate(cur);

        select.innerHTML = '';
        for (const [id, label] of Object.entries(deps.builtinTemplateList())) {
            const o = doc.createElement('option');
            o.value = id;
            o.textContent = `${label} 🔒`;
            select.appendChild(o);
        }
        for (const name of deps.listTemplates()) {
            const o = doc.createElement('option');
            // Сырое имя: присваивание value не парсит HTML, а esc() дал бы
            // «a&amp;b» — сравнение select.value с активным именем промахивалось.
            o.value = name;
            o.textContent = name;
            select.appendChild(o);
        }
        select.value = cur;
        let dangling = false;
        if (cur && !builtin && select.value !== cur) {
            // Выбор есть, а текста нет (чищеный браузер / другой сервер): выбор
            // молча не переписываем — DS syncPromptEditor.
            dangling = true;
            const missing = doc.createElement('option');
            missing.value = cur;
            missing.textContent = `${cur} · нет текста`;
            select.appendChild(missing);
            select.value = cur;
        }
        const content = dangling ? null : await deps.loadTemplateContent(cur);
        if (req !== _tplReq) return;
        if (textarea) {
            textarea.value = dangling
                ? `Шаблон «${cur}» пока недоступен. Выбор сохранён; текст появится, когда шаблон существует.`
                : String(content ?? '');
            textarea.disabled = dangling;
        }
        // Встроенные под замком: Save/Reset/Delete неактивны, путь — «Сохранить как…».
        if (bSave) bSave.disabled = builtin || dangling;
        if (bReset) bReset.disabled = builtin || dangling;
        if (bDel) bDel.disabled = builtin || dangling;
    }

    // Статус моста URIS — живой, не одноразовый снимок: панель монтируется
    // раньше, чем URIS активируется (порядок загрузки расширений — не наш),
    // а URIS включают/выключают на ходу. urisStatus сама дожидается публикации
    // глобала; событие ready и открытие секции настроек дёргают перечитывание.
    //
    // Дешёвость по построению:
    //  - ожидание глобала — чтение свойства не чаще 10 раз/с, максимум 3 с
    //    и только пока моста нет (цикл самооканчивается);
    //  - single-flight: триггеры, пришедшие пачкой (render + клик + ready),
    //    схлопываются — выполняется один запрос, остальные просятся одним
    //    повтором после его завершения (getStatus моста — async-чтение
    //    хранилища подключений, пачками его дёргать не нужно);
    //  - grace после «моста нет»: повторные триггеры не повторяют
    //    трёхсекундное ожидание (см. URIS_ABSENT_GRACE_MS);
    //  - режим фото «выключено» (imageMode off): мост не нужен — ожидание
    //    не запускается вовсе, ответы мгновенные (по наличию глобала);
    //    переключение режима в button/auto перечитывает статус с ожиданием.
    let _urisBusy = false;
    let _urisDirty = false;
    let _urisAbsentAt = 0;
    const refreshUrisStatus = (opts) => {
        if (!deps.urisStatus) return;
        if (_urisBusy) { _urisDirty = true; return; }
        _urisBusy = true;
        const off = deps.settings?.().imageMode === 'off';
        const effective = opts
            ?? (off || Date.now() - _urisAbsentAt < URIS_ABSENT_GRACE_MS ? { waitMs: 0 } : undefined);
        deps.urisStatus(effective).then((st) => {
            _urisAbsentAt = st.available ? 0 : Date.now();
            const node = doc.getElementById('dg-uris-status');
            if (node) {
                node.textContent = !st.available
                    ? 'мост не найден — UR Image Studio не установлен или выключен'
                    : st.accepting
                        ? `мост активен${st.connection ? `, подключение: ${st.connection.label}` : ' — но в чате не выбрано image-подключение'}`
                        : 'мост найден, но URIS выключен или ещё инициализируется';
            }
        }).catch(() => { /* urisStatus не бросает; на всякий случай не роняем панель */ }).finally(() => {
            _urisBusy = false;
            if (_urisDirty) { _urisDirty = false; refreshUrisStatus(); }
        });
    };
    // uris:bridge уходит в общее окно и на жизненный цикл генераций
    // (generation:*, prompt:*, gallery:*) — статус от них не зависит,
    // перечитываемся только на ready и на снос моста (disable).
    disconnectUrisBridgeListener();
    _onUrisBridgeEvent = (e) => {
        if (e?.type === 'uris:bridge-destroyed') refreshUrisStatus({ waitMs: 0 });
        else if (e?.detail?.type === 'ready') refreshUrisStatus();
    };
    window.addEventListener('uris:bridge', _onUrisBridgeEvent);
    window.addEventListener('uris:bridge-destroyed', _onUrisBridgeEvent);

    // Делегированные обработчики — scoped к нашему drawer: панель старого
    // runner-скрипта использует те же id, наши хендлеры на неё не должны влиять.
    $(doc).off('.diegetic');
    $(doc).on('change.diegetic', '#dg-ext #dg-enabled', (e) => { deps.setEnabled(e.target.checked); });
    $(doc).on('change.diegetic', '#dg-ext #dg-display-mode', (e) => { deps.setDisplayMode(String(e.target.value)); });
    $(doc).on('change.diegetic', '#dg-ext #dg-button-mode', (e) => { deps.setButtonMode(String(e.target.value)); });

    // Шаблоны: локальная пересинхронизация редактора — полный render() закрыл бы
    // details и сбросил бы прокрутку.
    const tplResync = () => syncTemplateEditor();
    // .val() на селекте без выбранной опции — null; String(null) записал бы
    // строку "null" в activeTemplate.
    $(doc).on('change.diegetic', '#dg-ext #dg-template-select', (e) => {
        const v = $(e.target).val();
        deps.selectTemplate(v == null ? '' : String(v));
        tplResync();
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-tpl-save', () => {
        const text = String($('#dg-template-text').val() ?? '');
        deps.saveTemplate(text);
        tplResync();
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-tpl-saveas', function () {
        $('#dg-tpl-saveas-row').toggle();
        $('#dg-tpl-saveas-name').trigger('focus');
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-tpl-saveas-ok', async () => {
        const name = String($('#dg-tpl-saveas-name').val() ?? '').trim();
        if (!name) return;
        const text = String($('#dg-template-text').val() ?? '');
        // Перезапись существующего пользовательского шаблона — под подтверждением:
        // молчаливая замена необратимо теряла старый текст (Ф-10, найдено на
        // живом стенде). «Сохранить» в редакторе не трогаем — там намеренная
        // правка активного шаблона.
        if (deps.listTemplates().includes(name) && deps.confirmDanger) {
            const ok = await deps.confirmDanger(`Шаблон «${name}» уже есть. Перезаписать его текст новым?`);
            if (!ok) return; // диалог «Сохранить как…» остаётся открытым
        }
        if (deps.saveTemplateAs(name, text)) {
            $('#dg-tpl-saveas-row').hide();
            $('#dg-tpl-saveas-name').val('');
        } else {
            // Имя занято встроенной основой (или не подтвердилось) — сказать,
            // а не молча закрыть диалог без результата (Ф-4).
            globalThis.toastr?.error(`Diegetic: «${name}» — имя занято встроенной основой`);
        }
        tplResync();
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-tpl-reset', async () => {
        await deps.resetTemplateToBuiltin();
        tplResync();
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-tpl-del', async () => {
        const name = deps.getActiveTemplate();
        const ok = deps.confirmDanger
            ? await deps.confirmDanger(`Удалить шаблон «${name}»? Его текст пропадёт безвозвратно.`)
            : true;
        if (!ok) return;
        deps.deleteActiveTemplate();
        tplResync();
    });

    // Источник: сегментный переключатель сохраняет сразу (DS), поля endpoint — по «Применить».
    $(doc).on('click.diegetic', '#dg-ext .dg-seg-btn', (e) => {
        deps.setSourceKind(String($(e.currentTarget).data('src')));
        syncSourceSection();
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-cm-profile', (e) => {
        deps.setCmProfile(String($(e.target).val() || ''), String($(e.target).find('option:selected').text() || ''));
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-key', function () {
        const val = String($(this).val() || '');
        deps.setCustomKey(val).then(() => {
            $(this).val('');
            $(this).attr('placeholder', val ? 'сохранён — введи для замены' : 'sk-… (хранится в браузере)');
            globalThis.toastr?.success(val ? 'Diegetic: ключ сохранён' : 'Diegetic: ключ удалён');
        }).catch(() => globalThis.toastr?.error('Diegetic: ключ не сохранился'));
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-save-source', async () => {
        const res = await deps.applyCustom?.({
            apiurl: String($('#dg-apiurl').val() || ''),
            model: String($('#dg-model').val() || ''),
        });
        if (!res) return;
        if (res.ok) globalThis.toastr?.success('Diegetic: endpoint применён');
        else globalThis.toastr?.error(`Diegetic: ${res.error}`);
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-extrabody', function () {
        const res = deps.setCustomExtraBody?.(String($(this).val() || ''));
        if (res && !res.ok) globalThis.toastr?.error(`Diegetic: ${res.error}`);
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-max-count', (e) => { deps.setMaxPerMessage?.(Number(e.target.value)); });

    // Контекст (форма DS-Comments: каждая секция — тумблер, глубина при истории)
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-history', (e) => {
        deps.setCtxHistory?.(e.target.checked);
        $('#dg-ctx-depth').prop('disabled', !e.target.checked);
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-depth', (e) => { deps.setContextDepth?.(Number(e.target.value)); });
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-persona', (e) => deps.setCtxPersona?.(e.target.checked));
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-character', (e) => deps.setCtxCharacter?.(e.target.checked));
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-world', (e) => deps.setCtxWorld?.(e.target.checked));

    // Фото и исключения
    // Смена режима фото: 'off' → button/auto снова разрешает ожидание моста —
    // статус перечитывается с ним (мост мог появиться, пока режим был off).
    $(doc).on('change.diegetic', '#dg-ext #dg-img-mode', (e) => {
        deps.setImageMode?.(String(e.target.value));
        refreshUrisStatus();
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-img-quality', (e) => deps.setImageQuality?.(String(e.target.value)));
    $(doc).on('click.diegetic', '#dg-ext #dg-save-excl', () => { deps.setExclusions(String($('#dg-excl').val())); });

    // Список артефактов: 👁 открыть, ⤓ файл, ⟳ — регенерация всего поста,
    // ✕ — удалить один артефакт.
    const artRowRef = (e) => {
        const row = e.target.closest('.dg-art-row');
        const msgId = Number(row?.dataset.msg);
        const id = row?.dataset.art;
        return Number.isFinite(msgId) && id != null ? { msgId, id } : null;
    };
    $(doc).on('click.diegetic', '#dg-ext [data-art-open]', (e) => {
        const ref = artRowRef(e);
        if (ref) deps.openArtifact?.(ref.msgId, ref.id);
    });
    $(doc).on('click.diegetic', '#dg-ext [data-art-save]', (e) => {
        const ref = artRowRef(e);
        if (ref) deps.saveArtifact?.(ref.msgId, ref.id);
    });
    $(doc).on('click.diegetic', '#dg-ext [data-art-regen]', (e) => {
        const msgId = Number(e.target.closest('.dg-art-row')?.dataset.msg);
        if (Number.isFinite(msgId)) deps.runFor?.(msgId);
    });
    $(doc).on('click.diegetic', '#dg-ext [data-art-del]', (e) => {
        const row = e.target.closest('.dg-art-row');
        const msgId = Number(row?.dataset.msg);
        const id = row?.dataset.art;
        if (Number.isFinite(msgId) && id != null) {
            deps.removeArtifact?.(msgId, id);
            renderArtifactList();
        }
    });
    // Открытие drawer'а/секций — свежий статус моста (мог включить URIS, пока
    // панель была закрыта; опрос дешёвый, глобал уже опубликован) и свежий
    // список артефактов (панель монтируется до загрузки чата).
    $(doc).on('click.diegetic', '#dg-ext .inline-drawer-toggle, #dg-ext summary', () => {
        refreshUrisStatus();
        renderArtifactList();
    });

    ensureLauncher(deps.settings().buttonMode, deps.runLatest);
    render();
    // refreshArtifacts — точечное обновление списка артефактов без полной
    // пересборки панели (полный render() восстановил бы textarea из хранилища
    // и стёр несохранённый ввод пользователя).
    return { render, refreshArtifacts: renderArtifactList };
}

/** Снять всё, что навесил ui.js (disable/clean). */
export function unmountUi(deps) {
    const $ = deps?.$ ?? globalThis.jQuery ?? globalThis.$;
    try { $?.(document).off('.diegetic'); } catch { /* ок */ }
    disconnectLauncherObserver();
    disconnectUrisBridgeListener();
    if (_fabResizeBound) {
        try { globalThis.window?.removeEventListener?.('resize', onFabResize); } catch { /* ок */ }
        _fabResizeBound = false;
    }
    for (const id of ['dg-style-native', 'dg-ext', 'dg-launcher-bar', 'dg-launcher-fab']) {
        document.getElementById(id)?.remove();
    }
}
