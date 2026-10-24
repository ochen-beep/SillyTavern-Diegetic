// Настройки в разделе «Расширения» таверны (inline-drawer) +
// лаунчер кнопки генерации (QR-бар / плавающая, режим buttonMode).
// Панель: одна колонка на переменных темы ST, подписи над контролами,
// один primary на секцию.
// Делегированные обработчики — на document в namespace .diegetic и scoped к
// #dg-ext: старый runner-скрипт рисует панель с теми же id — наши обработчики
// не должны на него срабатывать.
import { readRawPayload, digestForVariant } from './payload.js';
import { tr } from './i18n.js';

/** Чистая: строки списка артефактов для панели — скан payload'ов всего чата.
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

/* Вертикальная форма (свой endpoint): подпись над полем на всю ширину —
   иначе длинные URL/ключи зажимаются в узкую правую колонку грида dg-row */
#dg-ext .dg-fields { display: flex; flex-direction: column; gap: 3px; padding: 6px 0 2px; }
#dg-ext .dg-fields label { font-size: 12px; opacity: .6; margin-top: 5px; cursor: pointer; }
#dg-ext .dg-fields label:first-child { margin-top: 0; }
#dg-ext .dg-fields .text_pole { width: 100%; min-width: 0; box-sizing: border-box; }

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

	/* Сегментный выбор источника */
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

/* Список артефактов чата: скролл внутри секции, окно настроек не растягивается.
   overscroll-behavior не отпускает прокрутку наружу, когда список кончился. */
#dg-ext #dg-art-list { max-height: 300px; overflow-y: auto; overscroll-behavior: contain;
  padding-right: 4px; }
#dg-ext .dg-art-row { display: flex; align-items: center; gap: 8px; padding: 5px 0;
  border-top: 1px solid var(--black30a, rgba(128,128,128,.14)); font-size: 12.5px; }
#dg-ext .dg-art-row:first-of-type { border-top: none; }
#dg-ext .dg-art-status { flex: none; width: 10px; text-align: center; }
#dg-ext .dg-art-type { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer; }
#dg-ext .dg-art-type:hover { color: var(--SmartThemeEmColor, #c9a86a); }
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
/* Иконочные действия артефакта — компактнее текстовых чипов */
.dg-chip-action { padding: 6px 10px; }
.dg-chip { font-weight: 600; }
.dg-chip:hover, .dg-chip-action:hover { border-color: var(--SmartThemeEmColor, #c9a86a); }

/* ── Лайтбокс: иммерсивный — только затемнение и сам артефакт ──────── */
/* Опорный пункт: НЕ полагаться на inset:0 для размеров. В некоторых
   сборках хоста боксы html/body схлопываются (body fixed + transform-
   обёртки других расширений), и fixed-оверлей с auto-высотой получает
   0px — диалог уезжает центр-верх за экран. Явные lvw/lvh снимают
   зависимость от бокса корня; vh-фолбэк для старых движков. */
/* z-index выше #top-settings-holder (3005/4005): из «Библиотеки» в настройках
   попап иначе открывается ЗА панелью настроек. */
.dg-popup { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center;
  justify-content: center; width: 100vw; height: 100vh; width: 100lvw; height: 100lvh;
  width: 100dvw; height: 100dvh; }
/* d-единицы последними: следуют за скрытием URL-бара мобильного браузера,
   lvh застыл бы на «большом» вьюпорте. Старые движки берут lvh/vh выше. */
/* Скролл-лок чата под открытым лайтбоксом (класс вешает render.js openPopup).
   Б3: overflow:hidden не держит тач-скролл на WebKit — touch-action:none на
   body гасит сам жест; жесты внутри iframe артефакта не затронуты (другой документ). */
html.dg-lock, html.dg-lock body { overflow: hidden; overscroll-behavior: none; }
html.dg-lock body { touch-action: none; }
/* Б34: равновысотный плейсхолдер снятого вне экрана артефакта. */
.dg-lazy { width: 100%; border: 1px dashed var(--SmartThemeBorderColor, rgba(255,255,255,.25)); border-radius: 8px; opacity: .35; box-sizing: border-box; }
/* Б39:Reduced motion — пульс busy-кнопок отключаем. */
@media (prefers-reduced-motion: reduce) {
  .dg-gen-btn.dg-busy i, .dg-launcher-btn.dg-busy { animation: none; }
  #dg-ext .dg-switch i, #dg-ext .dg-switch i::after { transition: none; }
}
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

/* ── Кнопки генерации: анимация занятости ───────────────────────────── */
/* Кнопка в посте и лаунчеры (QR-бар/FAB) — медленный зелёный пульс:
   только color/opacity/filter, геометрия строки не трогается. */
.dg-gen-btn.dg-busy i,
.dg-launcher-btn.dg-busy { animation: dgPulse 2.4s ease-in-out infinite; }
@keyframes dgPulse {
  0%, 100% { color: #5bbf6e; opacity: .7; filter: drop-shadow(0 0 2px rgba(95,191,110,.3)); }
  50% { color: #9ff0ae; opacity: 1; filter: drop-shadow(0 0 9px rgba(120,230,140,.75)); }
}

/* Лаунчер: QR-бар — как родная кнопка бара, но строго квадратная (fa-scroll
   уже соседних иконок, без фикса кнопка выглядит кособокой) */
.dg-launcher-btn { position: relative; cursor: pointer; }
#dg-launcher-bar { justify-content: center; flex-shrink: 0; }
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

const DISPLAY_LABELS = {
    inline: () => tr('Inline in the post', 'diegetic.panel.display.inline'),
    expand: () => tr('Chip → expand in post', 'diegetic.panel.display.expand'),
    popup: () => tr('Chip → popup window', 'diegetic.panel.display.popup'),
};
const BUTTON_LABELS = {
    post: () => tr('On each post', 'diegetic.panel.button.post'),
    bar: () => tr('In the quick bar', 'diegetic.panel.button.bar'),
    floating: () => tr('Floating', 'diegetic.panel.button.floating'),
};

/** Статусы привязки артефакта для панельного списка: точка-цвет + пояснение. */
const ART_STATUS = {
    ok: { color: '#9c9', label: () => tr('bound to anchor', 'diegetic.status.ok') },
    fuzzy: { color: '#fc6', label: () => tr('imprecise binding (fuzzy)', 'diegetic.status.fuzzy') },
    orphan: { color: '#f88', label: () => tr('anchor not found — shown at the end of the post', 'diegetic.status.orphan') },
    stale: { color: '#9cf', label: () => tr('post text changed — will rebind on render', 'diegetic.status.stale') },
};

/** Дата артефакта для панели: дд.мм чч:мм по локали, без года и секунд. */
const artDate = (ts) => {
    const d = Number(ts);
    if (!Number.isFinite(d) || d <= 0) return '';
    try {
        return new Date(d).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
};

/** Чистая: HTML строк панельного списка артефактов чата. */
export function artifactListHtml(rows) {
    if (!rows?.length) return `<p class="dg-hint">${tr('no artifacts in this chat yet', 'diegetic.panel.library.empty')}</p>`;
    return rows.map((a) => {
        const st = ART_STATUS[a.status] ?? ART_STATUS.ok;
        const date = artDate(a.createdAt);
        return `<div class="dg-art-row" data-msg="${Number(a.msgId)}" data-art="${esc(a.id)}">`
            + `<span class="dg-art-status" style="color:${st.color}" title="${esc(st.label())}">●</span>`
            + `<span class="dg-art-type" data-art-open title="${tr('Preview', 'diegetic.panel.preview')}">${esc(a.type || 'artifact')}</span>`
            + `<span class="dg-art-meta">пост #${Number(a.msgId)}${date ? ` · ${date}` : ''}</span>`
            + `<button type="button" class="dg-art-btn" data-art-open title="${tr('Open in a popup', 'diegetic.panel.openPopup')}">👁</button>`
            + `<button type="button" class="dg-art-btn" data-art-save title="${tr('Save as .html', 'diegetic.panel.saveFile')}">⤓</button>`
            + `<button type="button" class="dg-art-btn" data-art-regen title="${tr('Regenerate post artifacts', 'diegetic.panel.regenPost')}">⟳</button>`
            + `<button type="button" class="dg-art-btn" data-art-del title="${tr('Delete artifact', 'diegetic.panel.deleteArtifact')}">✕</button>`
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

// ── Плавающая кнопка: драг + запоминание позиции ──
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
        ? tr('Diegetic: generate an artifact for the last post (draggable)', 'diegetic.panel.fabTitleDrag')
        : tr('Diegetic: generate an artifact for the last post', 'diegetic.panel.fabTitle');
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

/** Создать/перецепить кнопку бара в текущий хост. false — хоста ещё нет.
 *  Б11: при живой прицепленной кнопке функция не читает offsetHeight
 *  (forced reflow на каждой мутации #send_form при стриминге) — размер
 *  считается один раз при создании/перецеплении кнопки. */
function syncBarButton() {
    const host = getLauncherHost();
    if (!host) return false;
    const btn = document.getElementById('dg-launcher-bar')
        || makeLauncherButton('dg-launcher-bar', 'qr--button menu_button interactable dg-launcher-btn');
    let moved = false;
    if (btn.parentElement !== host) { host.appendChild(btn); moved = true; }
    // Квадрат по фактической высоте бара: в flex-ряду aspect-ratio проигрывает
    // content-ширине, а fa-scroll уже соседних иконок — кнопка выглядит кособоко.
    if (moved || btn.getAttribute?.('data-dg-sized') !== '1') {
        const h = btn.offsetHeight;
        if (h) {
            btn.style.width = `${h}px`;
            btn.setAttribute?.('data-dg-sized', '1');
        }
    }
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
        // Дешевизна на мутациях (Б11): сам syncBarButton при живой прицепленной
        // кнопке не читает offsetHeight (forced reflow на каждом стриминг-токене).
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
        // Б13: клавиатура мобильного меняет visualViewport без window.resize.
        if (!_fabResizeBound && typeof window !== 'undefined') {
            _fabResizeBound = true;
            window.addEventListener('resize', onFabResize);
            globalThis.visualViewport?.addEventListener?.('resize', onFabResize);
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
            tr('The old «Diegetic» script is still enabled in the 酒馆助手 script library — it duplicates settings and generation. Disable or remove it there.', 'diegetic.warn.legacyRunner'),
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
        .map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${esc(DISPLAY_LABELS[s]())}</option>`).join('');
    const buttonOpts = (sel) => ['post', 'bar', 'floating']
        .map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${esc(BUTTON_LABELS[s]())}</option>`).join('');

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
          <label for="dg-enabled">${tr('<b>Auto-generate</b> — artifact after each post', 'diegetic.panel.auto.label')}
            <div class="dg-hint">${tr('off — run with the ◆ button on a post or from the quick bar', 'diegetic.panel.auto.hint')}</div></label>
          <span class="dg-switch"><input type="checkbox" id="dg-enabled" ${st.enabled ? 'checked' : ''}/><i></i></span>
        </div>
      </div>
      <div class="dg-section">
        <p class="dg-title">${tr('Show and button', 'diegetic.panel.show')}</p>
        <div class="dg-row"><label for="dg-display-mode">${tr('Artifact in post', 'diegetic.panel.display')}</label>
          <select id="dg-display-mode" class="text_pole">${displayOpts(st.displayMode)}</select></div>
        <div class="dg-row"><label for="dg-button-mode">${tr('Generate button', 'diegetic.panel.button')}</label>
          <select id="dg-button-mode" class="text_pole">${buttonOpts(st.buttonMode)}</select></div>
        <div class="dg-row"><label for="dg-appearance">${tr('Success notifications', 'diegetic.panel.appearance')}</label>
          <select id="dg-appearance" class="text_pole">
            <option value="toast" ${st.appearance !== 'silent' ? 'selected' : ''}>${tr('show toasts', 'diegetic.panel.appearance.toast')}</option>
            <option value="silent" ${st.appearance === 'silent' ? 'selected' : ''}>${tr('silent', 'diegetic.panel.appearance.silent')}</option>
          </select></div>
        <div class="dg-row"><label for="dg-lazy">${tr('Off-screen artifacts', 'diegetic.panel.lazy')}</label>
          <select id="dg-lazy" class="text_pole">
            <option value="auto" ${st.lazyFrames === 'auto' ? 'selected' : ''}>${tr('auto — unload on phones', 'diegetic.panel.lazy.auto')}</option>
            <option value="on" ${st.lazyFrames === 'on' ? 'selected' : ''}>${tr('unload off-screen', 'diegetic.panel.lazy.on')}</option>
            <option value="off" ${st.lazyFrames === 'off' ? 'selected' : ''}>${tr('keep running', 'diegetic.panel.lazy.off')}</option>
          </select>
          <div class="dg-sub">${tr('saves battery and CPU in long chats; an unloaded artifact loses its state', 'diegetic.panel.lazy.hint')}</div>
        </div>
      </div>
      <div class="dg-section">
        <p class="dg-title">${tr('Template', 'diegetic.panel.template')}</p>
        <select id="dg-template-select" class="text_pole dg-wide"></select>
        <textarea id="dg-template-text" class="text_pole dg-wide" rows="10" style="margin-top:8px" spellcheck="false"></textarea>
        <div class="dg-btnrow">
          <button class="menu_button dg-btn-primary" id="dg-tpl-save">${tr('Save', 'diegetic.panel.template.save')}</button>
          <button class="menu_button" id="dg-tpl-saveas">${tr('Save as…', 'diegetic.panel.template.saveAs')}</button>
          <button class="menu_button" id="dg-tpl-reset">${tr('Reset to builtin', 'diegetic.panel.template.reset')}</button>
          <button class="menu_button dg-btn-danger" id="dg-tpl-del">${tr('Delete', 'diegetic.panel.template.delete')}</button>
        </div>
        <div class="dg-btnrow" id="dg-tpl-saveas-row" style="display:none">
          <input id="dg-tpl-saveas-name" class="text_pole" style="flex:1" placeholder="${tr('new template name', 'diegetic.panel.template.namePlaceholder')}"/>
          <button class="menu_button dg-btn-primary" id="dg-tpl-saveas-ok">${tr('Save', 'diegetic.panel.template.save')}</button>
        </div>
        <div class="dg-row" style="margin-top:8px">
          <label for="dg-max-count">${tr('Artifacts per post', 'diegetic.panel.maxCount')}</label>
          <input id="dg-max-count" type="number" class="text_pole" min="1" max="5" value="${st.maxPerMessage}"/>
        </div>
      </div>
      <div class="dg-section">
        <p class="dg-title">${tr('Generation source', 'diegetic.panel.source')}</p>
        <div class="dg-seg" role="group" aria-label="${tr('Generation source', 'diegetic.panel.source')}">
          <button type="button" class="dg-seg-btn" data-src="profile">${tr('Connection profile', 'diegetic.panel.source.profile')}</button>
          <button type="button" class="dg-seg-btn" data-src="custom">${tr('Custom endpoint', 'diegetic.panel.source.custom')}</button>
        </div>
        <div id="dg-src-profile" hidden>
          ${cmOptions
            ? `<div class="dg-row"><label for="dg-cm-profile">${tr('Connection profile', 'diegetic.panel.source.profile')}</label>
               <select id="dg-cm-profile" class="text_pole">${cmOptions}</select></div>
               <p class="dg-hint">${tr('The choice is saved immediately.', 'diegetic.panel.source.savedImmediately')}</p>`
            : `<p class="dg-hint">${tr('connection-manager not found or has no profiles.', 'diegetic.panel.source.profileMissing')}</p>`}
        </div>
        <div id="dg-src-custom" hidden>
          <div class="dg-fields">
            <label for="dg-apiurl">URL</label>
            <input id="dg-apiurl" type="text" class="text_pole" value="${esc(deps.getCustom().apiurl)}" placeholder="https://…/v1"/>
            <label for="dg-model">${tr('Model', 'diegetic.panel.source.model')}</label>
            <input id="dg-model" type="text" class="text_pole" value="${esc(deps.getCustom().model)}" placeholder="${tr('optional', 'diegetic.panel.source.modelOptional')}"/>
            <label for="dg-key">${tr('API key', 'diegetic.panel.source.key')}</label>
            <input id="dg-key" type="password" class="text_pole" value="" placeholder="sk-… (${tr('stored in the browser', 'diegetic.panel.source.keyStoredIn')})"/>
          </div>
          <div class="dg-btnrow"><button class="menu_button" id="dg-test-source">${tr('Test connection', 'diegetic.panel.source.test')}</button><button class="menu_button dg-btn-primary" id="dg-save-source">${tr('Apply', 'diegetic.panel.source.apply')}</button></div>
        </div>
        <div class="dg-row"><label for="dg-extrabody">${tr('Extra request params (JSON)', 'diegetic.panel.extraBody')}</label>
          <input id="dg-extrabody" type="text" class="text_pole" value="${esc(deps.getCustom().extraBody)}" placeholder='{"reasoning_effort":"none"}' style="min-width:230px"/></div>
      </div>
      <div class="dg-section">
        <p class="dg-title">${tr('Generation context', 'diegetic.panel.ctx')}</p>
        <div class="dg-row">
          <label for="dg-ctx-history">${tr('Chat history', 'diegetic.panel.ctx.history')}</label>
          <span style="display:flex; align-items:center; gap:8px">
            <input id="dg-ctx-depth" type="number" class="text_pole" min="1" max="20" value="${st.contextDepth}" ${st.ctxHistory ? '' : 'disabled'} title="${tr('depth, messages', 'diegetic.panel.ctx.depthTitle')}"/>
            <span class="dg-switch"><input type="checkbox" id="dg-ctx-history" ${st.ctxHistory ? 'checked' : ''}/><i></i></span>
          </span>
        </div>
        <div class="dg-row"><label for="dg-ctx-persona">${tr('Persona {{user}}', 'diegetic.panel.ctx.persona')}</label>
          <span class="dg-switch"><input type="checkbox" id="dg-ctx-persona" class="checkbox" ${st.ctxPersona ? 'checked' : ''}/><i></i></span></div>
        <div class="dg-row"><label for="dg-ctx-character">${tr('Character card', 'diegetic.panel.ctx.character')}</label>
          <span class="dg-switch"><input type="checkbox" id="dg-ctx-character" class="checkbox" ${st.ctxCharacter ? 'checked' : ''}/><i></i></span></div>
        <div class="dg-row"><label for="dg-ctx-world">${tr('Lorebooks — activated entries', 'diegetic.panel.ctx.world')}</label>
          <span class="dg-switch"><input type="checkbox" id="dg-ctx-world" class="checkbox" ${st.ctxWorld ? 'checked' : ''}/><i></i></span></div>
      </div>
      <div class="dg-section">
        <details>
          <summary><span class="dg-title" style="display:inline">${tr('Artifact library', 'diegetic.panel.library')}</span></summary>
          <div id="dg-art-list"></div>
          <div class="dg-btnrow">
            <button class="menu_button" id="dg-store-export" title="${tr('Download this chat\'s artifact file', 'diegetic.panel.library.exportTitle')}">${tr('⤓ Export', 'diegetic.panel.library.export')}</button>
            <button class="menu_button" id="dg-store-import" title="${tr('Merge an artifact file (freshest wins)', 'diegetic.panel.library.importTitle')}">${tr('⤒ Import', 'diegetic.panel.library.import')}</button>
            <button class="menu_button" id="dg-store-gc" title="${tr('Remove entries of deleted posts and swipes', 'diegetic.panel.library.gcTitle')}">${tr('🧹 Clean orphans', 'diegetic.panel.library.gc')}</button>
            <button class="menu_button dg-btn-danger" id="dg-store-detach" title="${tr('Copies entries to a new file: the chat stops sharing artifacts with forks', 'diegetic.panel.library.detachTitle')}">${tr('Detach storage', 'diegetic.panel.library.detach')}</button>
            <input type="file" id="dg-store-import-file" accept="application/json,.json" style="display:none"/>
          </div>
          <div class="dg-btnrow" id="dg-store-retry-row" hidden>
            <button class="menu_button dg-btn-danger" id="dg-store-retry">${tr('Retry storage write', 'diegetic.panel.library.retry')}</button>
          </div>
          <p class="dg-hint" id="dg-store-status"></p>
          <p class="dg-hint">${tr('👁 — open, ⤓ — file, ⟳ — regenerate post, ✕ — delete.', 'diegetic.panel.library.hint')}
            ${tr('Status <b>orphan</b>: anchor not found, shown at the end of the post.', 'diegetic.panel.library.orphanHint')}</p>
        </details>
      </div>
      <div class="dg-section">
        <details>
          <summary><span class="dg-title" style="display:inline">${tr('Photos via URIS', 'diegetic.panel.photo')}</span></summary>
          <div class="dg-row"><label for="dg-img-mode">${tr('Mode', 'diegetic.panel.photo.mode')}</label>
            <select id="dg-img-mode" class="text_pole">
              <option value="off" ${st.imageMode === 'off' ? 'selected' : ''}>${tr('off', 'diegetic.panel.photo.mode.off')}</option>
              <option value="button" ${st.imageMode === 'button' ? 'selected' : ''}>${tr('via the 📷 button on a post', 'diegetic.panel.photo.mode.button')}</option>
              <option value="auto" ${st.imageMode === 'auto' ? 'selected' : ''}>${tr('auto (paid, per slot)', 'diegetic.panel.photo.mode.auto')}</option>
            </select></div>
          <div class="dg-row"><label for="dg-img-quality">${tr('Quality', 'diegetic.panel.photo.quality')}</label>
            <select id="dg-img-quality" class="text_pole">
              <option value="low" ${st.imageQuality === 'low' ? 'selected' : ''}>low</option>
              <option value="medium" ${st.imageQuality === 'medium' ? 'selected' : ''}>medium</option>
              <option value="high" ${st.imageQuality === 'high' ? 'selected' : ''}>high</option>
            </select></div>
          <p class="dg-hint" id="dg-uris-status">${tr('checking bridge…', 'diegetic.panel.photo.checking')}</p>
          <p class="dg-hint">${tr('Artifact slots (<code>data-dg-img</code>) are filled with photos from UR Image Studio: polaroids, selfies, article shots. The CSS placeholder is the fallback.', 'diegetic.panel.photo.hint')}</p>
        </details>
      </div>
      <div class="dg-section">
        <details>
          <summary><span class="dg-title" style="display:inline">${tr('Auto-mode exclusions', 'diegetic.panel.excl')}</span></summary>
          <textarea id="dg-excl" class="text_pole dg-wide" rows="3">${esc(deps.getExclusions())}</textarea>
          <div class="dg-btnrow"><button class="menu_button" id="dg-save-excl">${tr('Save exclusions', 'diegetic.panel.excl.save')}</button></div>
          <p class="dg-hint">${tr('one phrase per line — auto mode stays silent on posts containing it', 'diegetic.panel.excl.hint')}</p>
        </details>
      </div>`);
            refreshUrisStatus();
            syncTemplateEditor();
            syncSourceSection();
            fillCustomKeyField();
            renderArtifactList();
            ensureLauncher(deps.settings().buttonMode, deps.runLatest);
        };

    // ── Список артефактов чата: ⟳ регенерация / ✕ удаление ──
    const renderArtifactList = () => {
        const box = doc.getElementById('dg-art-list');
        if (box && deps.listArtifacts) {
            const rows = deps.listArtifacts();
            // Б40: объём хранилища — видим, что чат растёт.
            const kb = (rows.reduce((acc, r) => acc + (Number(r.bytes) || 0), 0) / 1024).toFixed(1);
            const counter = tr('{n} artifact(s) · {kb} KB', 'diegetic.panel.library.counter')
                .replace('{n}', rows.length).replace('{kb}', kb);
            box.innerHTML = (rows.length ? `<p class="dg-hint">${counter}</p>` : '') + artifactListHtml(rows);
        }
        // Б20: след неудавшейся записи — кнопка повтора рядом.
        const st = deps.storeStatus?.();
        const statusEl = doc.getElementById('dg-store-status');
        const retryRow = doc.getElementById('dg-store-retry-row');
        if (statusEl && st) statusEl.textContent = st.ok ? '' : tr('⚠ Last storage write failed ({error})', 'diegetic.panel.library.writeFailed').replace('{error}', st.error ?? '');
        if (retryRow) retryRow.hidden = !(st && !st.ok);
    };

    // ── Источник: сегментный выбор ──
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

    // ── Редактор шаблонов: список + edit-on-place ──
    // Monotonic-request guard: быстрые переключения дают несколько async-
    // загрузок; отставшая не должна перезаписать textarea.
    let _tplReq = 0;
    // Б30: несохранённый черновик переживает перерисовки панели (смена
    // buttonMode дёргает полный render() и раньше стирала ввод). Снимается
    // сменой шаблона и всеми сохраняющими действиями.
    let _tplDraft = null;
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
            // Выбор есть, а текста нет (чищеный браузер / другой сервер):
            // выбор молча не переписываем.
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
            const draft = (!dangling && _tplDraft != null && select.value === cur) ? _tplDraft : null;
            textarea.value = draft ?? (dangling
                ? `Шаблон «${cur}» пока недоступен. Выбор сохранён; текст появится, когда шаблон существует.`
                : String(content ?? ''));
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
                    ? tr('bridge not found — UR Image Studio is not installed or disabled', 'diegetic.panel.photo.bridgeMissing')
                    : st.accepting
                        ? (st.connection
                            ? tr('bridge active, connection: {label}', 'diegetic.panel.photo.bridgeConn').replace('{label}', st.connection.label ?? '')
                            : tr('bridge active — but no image connection selected in this chat', 'diegetic.panel.photo.bridgeNoConn'))
                        : tr('bridge found, but URIS is off or still initializing', 'diegetic.panel.photo.bridgeOff');
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
    // Б30: черновик textarea живёт между перерисовками панели.
    $(doc).on('input.diegetic', '#dg-ext #dg-template-text', (e) => { _tplDraft = String(e.target.value ?? ''); });
    const dropTplDraft = () => { _tplDraft = null; };
    // .val() на селекте без выбранной опции — null; String(null) записал бы
    // строку "null" в activeTemplate.
    $(doc).on('change.diegetic', '#dg-ext #dg-template-select', (e) => {
        const v = $(e.target).val();
        dropTplDraft();
        deps.selectTemplate(v == null ? '' : String(v));
        tplResync();
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-tpl-save', () => {
        dropTplDraft();
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
        // молчаливая замена необратимо теряла старый текст. «Сохранить» в
        // редакторе не трогаем — там намеренная правка активного шаблона.
        if (deps.listTemplates().includes(name) && deps.confirmDanger) {
            const ok = await deps.confirmDanger(tr('Template «{name}» already exists. Overwrite its text?', 'diegetic.confirm.templateOverwrite').replace('{name}', name));
            if (!ok) return; // диалог «Сохранить как…» остаётся открытым
        }
        if (deps.saveTemplateAs(name, text)) {
            dropTplDraft();
            $('#dg-tpl-saveas-row').hide();
            $('#dg-tpl-saveas-name').val('');
        } else {
            // Имя занято встроенной основой — сказать, а не молча закрыть диалог.
            globalThis.toastr?.error(tr('«{name}» is taken by a builtin template', 'diegetic.toast.templateNameTaken').replace('{name}', name));
        }
        tplResync();
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-tpl-reset', async () => {
        dropTplDraft();
        await deps.resetTemplateToBuiltin();
        tplResync();
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-tpl-del', async () => {
        const name = deps.getActiveTemplate();
        const ok = deps.confirmDanger
            ? await deps.confirmDanger(tr('Delete template «{name}»? Its text will be lost forever.', 'diegetic.confirm.templateDelete').replace('{name}', name))
            : true;
        if (!ok) return;
        dropTplDraft();
        deps.deleteActiveTemplate();
        tplResync();
    });

    // Источник: сегментный переключатель сохраняет сразу, поля endpoint — по «Применить».
    $(doc).on('click.diegetic', '#dg-ext .dg-seg-btn', (e) => {
        deps.setSourceKind(String($(e.currentTarget).data('src')));
        syncSourceSection();
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-cm-profile', (e) => {
        deps.setCmProfile(String($(e.target).val() || ''), String($(e.target).find('option:selected').text() || ''));
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-appearance', (e) => { deps.setAppearance?.(String(e.target.value)); });

    // Ключ: тост по фактическому результату записи (Б16) — в приватном режиме
    // или при переполнении хранилища «ключ сохранён» был бы ложью.
    $(doc).on('change.diegetic', '#dg-ext #dg-key', function () {
        const val = String($(this).val() || '');
        deps.setCustomKey(val).then((ok) => {
            $(this).val('');
            if (!ok) { globalThis.toastr?.error(tr('Diegetic: key NOT saved — browser storage unavailable (private mode? full quota?)', 'diegetic.toast.keyNoStore')); return; }
            $(this).attr('placeholder', val ? tr('saved — type to replace', 'diegetic.panel.source.keySaved') : `sk-… (${tr('stored in the browser', 'diegetic.panel.source.keyStoredIn')})`);
            globalThis.toastr?.success(val ? tr('Diegetic: key saved', 'diegetic.toast.keySaved') : tr('Diegetic: key removed', 'diegetic.toast.keyRemoved'));
        }).catch(() => globalThis.toastr?.error(tr('Diegetic: key not saved', 'diegetic.toast.keyFailed')));
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-save-source', async () => {
        const res = await deps.applyCustom?.({
            apiurl: String($('#dg-apiurl').val() || ''),
            model: String($('#dg-model').val() || ''),
        });
        if (!res) return;
        if (res.ok) globalThis.toastr?.success(tr('Diegetic: endpoint applied', 'diegetic.toast.endpointApplied'));
        else globalThis.toastr?.error(`Diegetic: ${res.error}`);
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-extrabody', function () {
        const res = deps.setCustomExtraBody?.(String($(this).val() || ''));
        if (res && !res.ok) globalThis.toastr?.error(`Diegetic: ${res.error}`);
    });
    // Числовые поля: мусор/выход за диапазон приводим к сохранённому значению
    // сразу на месте (Б33), а не после перерендера панели.
    $(doc).on('change.diegetic', '#dg-ext #dg-max-count', (e) => {
        const el = e.target;
        const n = Math.round(Number(el.value));
        const ok = Number.isFinite(n) && n >= 1 && n <= 5;
        deps.setMaxPerMessage?.(ok ? n : (deps.settings?.().maxPerMessage ?? 1));
        if (!ok) el.value = deps.settings?.().maxPerMessage ?? 1;
    });

    // Контекст: каждая секция — тумблер, глубина при истории.
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-history', (e) => {
        deps.setCtxHistory?.(e.target.checked);
        $('#dg-ctx-depth').prop('disabled', !e.target.checked);
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-depth', (e) => {
        const el = e.target;
        const n = Math.round(Number(el.value));
        const ok = Number.isFinite(n) && n >= 1 && n <= 20;
        deps.setContextDepth?.(ok ? n : (deps.settings?.().contextDepth ?? 3));
        if (!ok) el.value = deps.settings?.().contextDepth ?? 3;
    });
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

    // Ленивые фреймы (Б34): смена режима перестраивает оболочки (ключ включает
    // лень) — в index.js setLazyFrames зовёт reconcile.
    $(doc).on('change.diegetic', '#dg-ext #dg-lazy', (e) => { deps.setLazyFrames?.(String(e.target.value)); });

    // Б36: проверка источника до первого платного поста.
    $(doc).on('click.diegetic', '#dg-ext #dg-test-source', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = tr('Testing…', 'diegetic.panel.source.testing');
        try {
            const res = await deps.testSource?.();
            if (res?.ok) globalThis.toastr?.success(tr('Diegetic: connection works — the model responds', 'diegetic.toast.testOk'));
            else if (res?.empty) globalThis.toastr?.error(tr('Diegetic: connection works — but the model answered with emptiness', 'diegetic.toast.testEmpty'));
            else globalThis.toastr?.error(tr('Diegetic: connection does not work — {error}', 'diegetic.toast.testFail').replace('{error}', res?.error ?? ''));
        } finally {
            btn.disabled = false;
            btn.textContent = prev;
        }
    });

    // Б25/Б26/Б27/Б20: инструментарий хранилища.
    $(doc).on('click.diegetic', '#dg-ext #dg-store-export', async () => {
        const ok = await deps.exportArtifacts?.();
        globalThis.toastr?.[ok ? 'success' : 'error'](ok ? tr('Diegetic: storage file downloaded', 'diegetic.toast.storeExported') : tr('Diegetic: storage file unavailable', 'diegetic.toast.storeExportFail'));
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-store-import', () => { doc.getElementById('dg-store-import-file')?.click(); });
    $(doc).on('change.diegetic', '#dg-ext #dg-store-import-file', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const res = await deps.importArtifacts?.(await file.text());
            if (res?.ok) {
                globalThis.toastr?.success(tr('Diegetic: import done — added: {added}, updated: {updated}', 'diegetic.toast.importDone')
                    .replace('{added}', res.added).replace('{updated}', res.updated));
                renderArtifactList();
            } else {
                globalThis.toastr?.error(tr('Diegetic: import failed — {error}', 'diegetic.toast.importFail').replace('{error}', res?.error ?? ''));
            }
        } catch (err) {
            globalThis.toastr?.error(tr('Diegetic: file could not be read ({error})', 'diegetic.toast.importReadFail').replace('{error}', err?.message ?? err));
        }
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-store-gc', () => {
        const removed = deps.gcStore?.() ?? 0;
        globalThis.toastr?.success(removed
            ? tr('Diegetic: orphaned entries removed: {n}', 'diegetic.toast.gcDone').replace('{n}', removed)
            : tr('Diegetic: no orphaned entries', 'diegetic.toast.gcEmpty'));
        renderArtifactList();
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-store-detach', async () => {
        const ok = deps.confirmDanger
            ? await deps.confirmDanger(tr('Detach storage? Current artifacts will be copied into a new file of this chat; forks and the parent keep their own copy.', 'diegetic.confirm.detach'))
            : true;
        if (!ok) return;
        if (deps.detachStore?.()) {
            globalThis.toastr?.success(tr('Diegetic: storage detached — entries copied to a new file', 'diegetic.toast.detached'));
            renderArtifactList();
        }
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-store-retry', () => { deps.retryStore?.(); });

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
        try {
            globalThis.window?.removeEventListener?.('resize', onFabResize);
            globalThis.visualViewport?.removeEventListener?.('resize', onFabResize);
        } catch { /* ок */ }
        _fabResizeBound = false;
    }
    for (const id of ['dg-style-native', 'dg-ext', 'dg-launcher-bar', 'dg-launcher-fab']) {
        document.getElementById(id)?.remove();
    }
}
