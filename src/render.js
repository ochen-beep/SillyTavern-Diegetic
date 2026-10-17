// src/render.js — оболочки артефактов и кнопки постов в чате.
// Форма reconcile: URIS src/inline/render.js (data-ключ, MutationObserver +
// debounce, точечные проходы). Режимы показа (settings.displayMode):
//   inline — iframe сразу в посте;
//   expand — чип-ряд [тип][Copy HTML][Delete]; клик по типу раскрывает iframe в посте;
//   popup  — тот же чип-ряд, клик открывает лайтбокс поверх чата.
// Развёрнутые чипы (expand) запоминаются в _expanded до перезагрузки страницы.
//
// Кнопки поста — в штатном ряду .mes_buttons (форма Glosses addRegenButton):
// ◆ сгенерировать/перегенерировать, 📷 заполнить фотослоты (режим «по кнопке»).

import { getMessage, persistChat } from './host.js';
import { parseImageSlots, slotCardId, SLOT_ATTR } from './images.js';
import {
    readVerifiedPayload, readRawPayload, writePayload, clearPayload,
    payloadBelongsToOtherVariant, digestForVariant, variantText,
} from './payload.js';
import { normalizeAnchorKey, findAnchorInText, findFuzzySpan } from './anchor.js';
import { contentDigest } from './digest.js';

export const SHELL_ATTR = 'data-dg-shell';
const FRAME_CLASS = 'dg-frame';
const DEBOUNCE_MS = 250;

// Якорь модели цитирует сырую прозу с markdown-символами; в отрендеренном
// тексте их нет — срезаем перед матчем.
const stripMd = (s) => String(s ?? '').replace(/[*_~`#>]/g, '');

// Артефакт — полноценный документ со скриптами; песочница opaque-origin,
// allow-same-origin НЕ давать (иначе скрипт артефакта достаёт parent DOM).
// Высота — postMessage-рукопожатие; html принудительно прозрачный и без
// скроллбаров (иммерсивная вставка — скролл внутри артефакта не трогаем).
// html/body — нулевой min-height (форма HTML-Inserts normalizeDocument): иначе
// 100vh-ловушка на body раздувает iframe и после сворачивания артефакта внутри
// себя высота не сжимается обратно — внизу висит чёрная пустота.
const IMMERSIVE_CSS = '<style>html,body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;background:transparent!important}html{overflow:hidden!important}</style>';
const RESIZE_SNIPPET = '<script>(function(){var p=function(){try{parent.postMessage({__dgH:document.documentElement.scrollHeight},"*")}catch(e){}};if(typeof ResizeObserver!=="undefined"){new ResizeObserver(p).observe(document.body)}addEventListener("load",p);p()})()</' + 'script>';
// Клики внутри sandbox-iframe (opaque origin) до родительского document не доходят —
// команды контролов (✎/⟳) уходят postMessage'ом, по образцу рукопожатия высоты.
// Capture + stopPropagation: клик по контролу не должен будить JS самого артефакта.
const CMD_SNIPPET = '<script>document.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("[data-dg-cmd]"):null;if(!t)return;e.preventDefault();e.stopPropagation();try{parent.postMessage({__dgCmd:String(t.getAttribute("data-dg-cmd")),ordinal:Number(t.getAttribute("data-ordinal"))},"*")}catch(x){}},true)</' + 'script>';
const withImmersiveCss = (html) => /<head[^>]*>/i.test(String(html))
    ? String(html).replace(/<head[^>]*>/i, (m) => m + IMMERSIVE_CSS)
    : String(html).replace(/<html[^>]*>/i, (m) => m + '<head>' + IMMERSIVE_CSS + '</head>');
const clampH = (h) => Math.min(Math.max(40, Math.round(h) || 0), 4000);

/**
 * Высота артефакта должна быть «естественной» (по контенту): модель любит
 * min-height:100vh/100svh на body или сцене — внутри iframe vh = высота самого
 * iframe, поэтому рукопожатие растит его до капа 4000, а при внутреннем
 * сворачивании артефакта высота не возвращается. Срезаем vh из height-свойств
 * (анимации вида translateY(100vh) не трогаем).
 */
export function normalizeIntrinsicHeight(html) {
    return String(html ?? '').replace(
        /\b(min-height|max-height|height)\s*:\s*100(?:s|l|d)?vh\b/gi,
        (m, prop) => `${prop}:auto`,
    );
}

let _observer = null;
let _debounceId = null;
let _onMessage = null;
let _onClick = null;
let _popup = null;
let _deps = null;
/** Раскрытые в expand-режиме оболочки (baseKey). Рантайм, не настройка. */
const _expanded = new Set();
/** path → dataUrl (фото /user/images проксируются в data: — CORP: same-origin
 *  хоста не даёт opaque-iframe грузить их напрямую); null = загрузка идёт. */
const _imgCache = new Map();

const baseKey = (a) => `${a.id}|${contentDigest(a.html)}`;
/** inline — всегда iframe; expand — по памяти раскрытий; popup — всегда чип. */
const isOpen = (a) => {
    const mode = _deps?.settings?.().displayMode ?? 'inline';
    if (mode === 'inline') return true;
    if (mode === 'expand') return _expanded.has(baseKey(a));
    return false;
};
const shellKey = (a) => `${baseKey(a)}|${isOpen(a) ? 'o' : 'c'}`;

// Контролы фотослота (✎ промпт, ⟳ перегенерация) — display-only: payload кнопок
// не хранит, сохранённый .html остаётся чистым артефактом. Стили лежат здесь же —
// родительский CSS в sandbox-iframe не проникает (старый блок в ui.js был мёртвым).
const SLOT_CTL_CSS = '<style>'
    + '.dg-slot-ctl{position:absolute;top:6px;z-index:30;width:22px;height:22px;border-radius:50%;'
    + 'background:rgba(0,0,0,.55);color:#fff;font-size:13px;line-height:22px;text-align:center;'
    + 'cursor:pointer;border:1px solid rgba(255,255,255,.3);user-select:none;font-family:system-ui,sans-serif;'
    + 'opacity:0;transition:opacity .15s}'
    + '.dg-slot-regen{right:6px}.dg-slot-edit{right:32px}.dg-slot-cancel{right:6px}'
    + '[data-dg-img]:hover .dg-slot-ctl{opacity:1}'
    + '[data-dg-img-state="loading"]::after{content:"";position:absolute;inset:0;z-index:20;'
    + 'background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.16) 50%,transparent 70%);'
    + 'background-size:200% 100%;animation:dgShimmer 1.4s linear infinite}'
    + '@keyframes dgShimmer{from{background-position:200% 0}to{background-position:-200% 0}}'
    + '[data-dg-img-state="error"]{outline:1px dashed rgba(255,120,120,.55);outline-offset:-1px}'
    + '</style>';
// Старые payload'ы несут в себе зашитый ⟳ из slotImgHtml — срезаем перед показом.
const LEGACY_CTL_RE = /<span class="dg-slot-regen"[^>]*>[^<]*<\/span>/g;

const slotControls = (ordinal, state) =>
    `<span class="dg-slot-ctl dg-slot-edit" data-dg-cmd="slot-edit" data-ordinal="${ordinal}" title="Промпт фото">✎</span>`
    // Во время заливки ⟳ превращается в ⏹: клик отменяет генерацию (abortKind
    // 'fill'), после аборта слот откатится в pending и контролы вернутся к ⟳.
    + (state === 'loading'
        ? `<span class="dg-slot-ctl dg-slot-cancel" data-dg-cmd="slot-cancel" data-ordinal="${ordinal}" title="Отменить генерацию фото">⏹</span>`
        : `<span class="dg-slot-ctl dg-slot-regen" data-dg-cmd="slot-regen" data-ordinal="${ordinal}" title="Перегенерировать фото">⟳</span>`);

/** Дорисовать контролы каждому фотослоту (сразу после открывающего тега слота). */
export function withSlotControls(html) {
    let s = String(html ?? '').replace(LEGACY_CTL_RE, '');
    const slots = parseImageSlots(s);
    if (!slots.length) return s;
    for (let i = slots.length - 1; i >= 0; i--) {
        const sl = slots[i];
        s = s.slice(0, sl.end) + slotControls(sl.ordinal, sl.state) + s.slice(sl.end);
    }
    return /<\/body>/i.test(s)
        ? s.replace(/<\/body>/i, SLOT_CTL_CSS + '</body>')
        : s + SLOT_CTL_CSS;
}

/**
 * Display-патч хранённых артефактов (текст extra не переписываем): старые
 * инжекты фото шли с z-index:1 и без скрытия плейсхолдера — модели кладут декор
 * плейсхолдера на z-index:2+, и он перекрывал фото. Новые инжекты (images.js)
 * пишут z-index:10 + hide-style сразу. Здесь же срез vh-ловушек высоты и
 * дорисовка контролов фотослотов.
 */
function patchStoredArtifact(html) {
    let out = normalizeIntrinsicHeight(String(html ?? ''));
    if (/dg-slot-img/.test(out)) {
        out = out.replace(/(dg-slot-img[^>]*z-index:\s*)1\s*;/g, '$110;');
        if (/\.css-placeholder/.test(out) && !out.includes('css-placeholder{display:none')) {
            out = out.replace(/<\/body>/i, '<style>.css-placeholder{display:none!important}</style></body>');
        }
    }
    return withSlotControls(out);
}

/** Подставить закэшированные фото (data:) в html оболочки. */
function withCachedImages(html) {
    return String(html).replace(/src="(\/user\/images\/[^"]+)"/g, (m, p) => {
        const d = _imgCache.get(p);
        return d ? `src="${d}"` : m;
    });
}

/**
 * Фото из /user/images недоступны opaque-iframe напрямую (CORP: same-origin
 * хоста) — тянем их из родительского окна в data: и переливаем в готовый
 * iframe. Ошибка загрузки — исходный src остаётся (не наш хост — не чиним).
 * Возвращает промис: resolves, когда все пути html прогреты (успешно или нет).
 */
function warmImages(html) {
    const paths = [...new Set([...String(html).matchAll(/src="(\/user\/images\/[^"]+)"/g)].map(m => m[1]))]
        .filter(p => !_imgCache.has(p));
    return Promise.all(paths.map(p => {
        _imgCache.set(p, null);
        return fetch(p)
            .then(r => r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(blob => new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onload = () => res(fr.result);
                fr.onerror = rej;
                fr.readAsDataURL(blob);
            }))
            .then(dataUrl => { _imgCache.set(p, dataUrl); })
            .catch(() => { _imgCache.delete(p); });
    }));
}

/** Блоки-абзацы сообщения. У plain-текста без <p> весь .mes_text — один блок. */
function blocksOf(textEl) {
    const kids = [...textEl.children].filter(el =>
        /^(P|DIV|UL|OL|BLOCKQUOTE|PRE|TABLE|H[1-6]|HR|FIGURE)$/.test(el.tagName)
        && !el.hasAttribute(SHELL_ATTR));
    return kids.length ? kids : [textEl];
}

/** Абзац для вставки: точный матч якоря → fuzzy → позиция pos (миграция). */
function locateBlock(blocks, artifact) {
    const anchor = stripMd(artifact.anchor);
    if (anchor.trim()) {
        const needle = normalizeAnchorKey(anchor);
        if (needle) {
            for (const b of blocks) {
                if (normalizeAnchorKey(b.textContent).includes(needle)) return b;
            }
        }
        for (const b of blocks) {
            if (findFuzzySpan(b.textContent, anchor)) return b;
        }
    }
    if (Number.isFinite(artifact.pos)) return blocks[Math.min(artifact.pos, blocks.length - 1)];
    return null;
}

const escAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Строка действий чипа: Collapse виден только у развёрнутого (expand). */
function buildActionRow({ collapse = false } = {}) {
    const row = document.createElement('div');
    row.className = 'dg-chiprow dg-chiprow-attached';
    if (collapse) {
        const fold = document.createElement('button');
        fold.type = 'button';
        fold.className = 'dg-chip';
        fold.setAttribute('data-dg-collapse', '');
        fold.textContent = '▾ Свернуть';
        row.appendChild(fold);
    }
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'dg-chip-action';
    copy.setAttribute('data-dg-copy', '');
    copy.textContent = '⧉ Copy HTML';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'dg-chip-action';
    save.setAttribute('data-dg-save', '');
    save.title = 'Сохранить как .html — открыть в браузере и потыкать';
    save.textContent = '⤓ Файл';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'dg-chip-action';
    del.setAttribute('data-dg-del', '');
    del.textContent = '✕ Delete';
    row.append(copy, save, del);
    return row;
}

// SillyTavern отдаёт страницу с CSP, под которым srcdoc-iframe не грузится
// (about:srcdoc не попадает в frame-src) — рендерим артефакты через blob: URL.
function mountFrameHtml(frame, html) {
    if (frame.dataset.dgBlob) URL.revokeObjectURL(frame.dataset.dgBlob);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    frame.dataset.dgBlob = url;
    frame.src = url;
}

function buildShell(artifact, key, msgId) {
    const open = isOpen(artifact);
    const shell = document.createElement('div');
    shell.setAttribute(SHELL_ATTR, key);
    shell.setAttribute('data-dg-msg', String(msgId));
    if (!open) {
        // Чип-ряд вместо артефакта: тип + Copy + Delete.
        shell.className = 'dg-shell dg-chiprow';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'dg-chip';
        open.setAttribute('data-dg-open', '');
        open.textContent = String(artifact.type || 'artifact');
        shell.append(open, ...buildActionRow().children);
        return shell;
    }
    shell.className = 'dg-shell';
    const frame = document.createElement('iframe');
    frame.className = FRAME_CLASS;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', String(artifact.type || 'artifact'));
    const html = patchStoredArtifact(artifact.html);
    const frameHtml = () => withCachedImages(withImmersiveCss(html)) + RESIZE_SNIPPET + CMD_SNIPPET;
    mountFrameHtml(frame, frameHtml());
    shell.appendChild(frame);
    // Догреть кэш фото и перелить в iframe, когда data: готовы.
    warmImages(html).then(() => {
        if (frame.isConnected) mountFrameHtml(frame, frameHtml());
    });
    // Expand-режим: меню живёт вместе с развёрнутым артефактом — свернуть /
    // скопировать / сохранить / удалить, а не исчезать после раскрытия.
    if ((_deps?.settings?.().displayMode ?? 'inline') === 'expand') {
        shell.appendChild(buildActionRow({ collapse: true }));
    }
    return shell;
}

function mountShell(block, artifact, key, textEl, msgId) {
    const shell = buildShell(artifact, key, msgId);
    if (block === textEl) textEl.appendChild(shell);
    else block.insertAdjacentElement('afterend', shell);
}

/** Артефакт по ключу оболочки: id до '|', payload читаем сырым (чип удалить можно и у stale). */
function artifactByKey(msgId, key) {
    const msg = getMessage(msgId);
    if (!msg) return null;
    const payload = readRawPayload(msg, msg.swipe_id ?? 0);
    const id = String(key).split('|')[0];
    return payload?.artifacts.find(a => a.id === id) ?? null;
}

async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* фолбэк ниже */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* совсем старый движок */ }
    ta.remove();
    return ok;
}

/** Сохранить артефакт как standalone .html (Blob + a[download], без сервера):
 *  файл открывается двойным кликом в любом браузере — артефакт и есть
 *  полноценный документ по контракту. */
function saveArtifactFile(artifact) {
    const blob = new Blob([String(artifact.html)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = (s) => String(s ?? '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'artifact';
    a.download = `diegetic-${safe(artifact.type)}-${safe(artifact.id)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Удалить артефакт из payload; пустой payload снимается целиком. */
function deleteArtifact(msgId, artifactId) {
    const msg = getMessage(msgId);
    if (!msg) return;
    const swipeIdx = msg.swipe_id ?? 0;
    const payload = readRawPayload(msg, swipeIdx);
    if (!payload) return;
    const rest = payload.artifacts.filter(a => a.id !== artifactId);
    if (rest.length === payload.artifacts.length) return;
    if (rest.length) writePayload(msg, swipeIdx, { ...payload, artifacts: rest });
    else clearPayload(msg, swipeIdx);
    persistChat();
    reconcileMessage(msgId);
}

function closePopup() {
    _popup?.el.remove();
    _popup = null;
}

function openPopup(artifact, msgId = null) {
    closePopup();
    const overlay = document.createElement('div');
    overlay.className = 'dg-popup';
    overlay.innerHTML = `<div class="dg-popup-backdrop" data-dg-close></div><section class="dg-popup-dialog" role="dialog" aria-modal="true"><header><strong>${escAttr(artifact.type || 'artifact')}</strong><button type="button" class="dg-popup-close" data-dg-close aria-label="Закрыть">×</button></header></section>`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    const html = withImmersiveCss(patchStoredArtifact(String(artifact.html)));
    const frameHtml = () => withCachedImages(html) + CMD_SNIPPET;
    mountFrameHtml(frame, frameHtml());
    warmImages(html).then(() => {
        if (overlay.isConnected) mountFrameHtml(frame, frameHtml());
    });
    overlay.querySelector('.dg-popup-dialog').appendChild(frame);
    overlay.addEventListener('click', (e) => { if (e.target.closest('[data-dg-close]')) closePopup(); });
    document.body.appendChild(overlay);
    // Команды из iframe попапа (✎/⟳) маппятся на артефакт через это описание —
    // у popup-iframe нет shell-предка в посте.
    _popup = { el: overlay, frame, msgId, artifactId: artifact.id ?? null };
}

let _editor = null;
function closeEditor() { _editor?.remove(); _editor = null; }

/** Редактор промпта фотослота: триггер + описание, сохранить или сразу перегенерировать. */
function openSlotEditor(msgId, artifactId, ordinal) {
    const msg = getMessage(msgId);
    const payload = msg ? readRawPayload(msg, msg.swipe_id ?? 0) : null;
    const art = payload?.artifacts.find(a => a.id === artifactId);
    const slot = art ? parseImageSlots(art.html).find(s => s.ordinal === ordinal) : null;
    if (!slot) return;
    closeEditor();
    const overlay = document.createElement('div');
    overlay.className = 'dg-popup dg-slot-editor';
    overlay.innerHTML = '<div class="dg-popup-backdrop" data-dg-close></div>'
        + '<section class="dg-popup-dialog dg-editor-dialog" role="dialog" aria-modal="true">'
        + '<header><strong>Промпт фотослота</strong>'
        + '<button type="button" class="dg-popup-close" data-dg-close aria-label="Закрыть">×</button></header>'
        + '<label class="dg-editor-row">Триггер<select data-f="trigger">'
        + '<option value="">— без триггера —</option>'
        + '<option value="selfie">selfie — персонаж в кадре, вертикальный кадр</option>'
        + '<option value="img">img — предмет, документ</option>'
        + '<option value="scene">scene — место, панорама, интерьер</option>'
        + '</select></label>'
        + '<textarea data-f="desc" rows="5" placeholder="Описание кадра на английском: кто/что, ракурс, свет"></textarea>'
        + '<footer class="dg-editor-actions">'
        + '<button type="button" class="dg-chip-action" data-f="save">Сохранить</button>'
        + '<button type="button" class="dg-chip-action" data-f="regen">Сохранить и перегенерировать</button>'
        + '</footer></section>';
    const sel = overlay.querySelector('[data-f="trigger"]');
    const ta = overlay.querySelector('[data-f="desc"]');
    sel.value = ['selfie', 'img', 'scene'].includes(slot.trigger) ? slot.trigger : '';
    ta.value = slot.desc;
    const submit = (regenerate) => {
        const v = { trigger: sel.value || null, desc: ta.value, regenerate };
        closeEditor();
        _deps?.editSlotPrompt?.(msgId, artifactId, ordinal, v);
    };
    overlay.addEventListener('click', (e) => {
        if (e.target.closest('[data-dg-close]')) { closeEditor(); return; }
        if (e.target.closest('[data-f="save"]')) submit(false);
        else if (e.target.closest('[data-f="regen"]')) submit(true);
    });
    document.body.appendChild(overlay);
    _editor = overlay;
}

/** iframe → артефакт: источник команды изнутри sandbox-iframe. msgId читаем в
 *  момент события — ST перенумеровывает mesid у живых узлов. */
function findCmdSource(source) {
    for (const f of document.querySelectorAll(`iframe.${FRAME_CLASS}`)) {
        if (f.contentWindow !== source) continue;
        const shell = f.closest(`[${SHELL_ATTR}]`);
        const msgId = Number(f.closest('.mes')?.getAttribute('mesid'));
        const artifactId = String(shell?.getAttribute(SHELL_ATTR) ?? '').split('|')[0] || null;
        return Number.isFinite(msgId) && artifactId ? { msgId, artifactId } : null;
    }
    if (_popup?.frame?.contentWindow === source && _popup.msgId !== null) {
        return { msgId: _popup.msgId, artifactId: _popup.artifactId };
    }
    return null;
}

function handleSlotCmd(e) {
    const cmd = e?.data?.__dgCmd;
    const ordinal = Number(e?.data?.ordinal);
    if (typeof cmd !== 'string' || !Number.isFinite(ordinal)) return;
    const src = findCmdSource(e.source);
    if (!src) return;
    if (cmd === 'slot-edit') { openSlotEditor(src.msgId, src.artifactId, ordinal); return; }
    if (cmd === 'slot-cancel') { _deps?.cancelFill?.(src.msgId); return; }
    if (cmd === 'slot-regen') {
        const msg = getMessage(src.msgId);
        const payload = msg ? readRawPayload(msg, msg.swipe_id ?? 0) : null;
        const art = payload?.artifacts.find(a => a.id === src.artifactId);
        _deps?.regenSlot?.(src.msgId, src.artifactId, ordinal, art ? slotCardId(art.html, ordinal) : null);
    }
}

function onKeydown(e) {
    if (e.key === 'Escape') { closePopup(); closeEditor(); }
}

/** Кнопки поста в .mes_buttons (форма Glosses): ◆ генерация/реген, 📷 фотослоты.
 *  Видны только в режиме buttonMode 'post'; busy-класс вешает setGenerating.
 *  Экспорт — для тестов: регрессия «клик по устаревшему mesid». */
export function ensureMsgButtons(mesEl, msgId, msg) {
    const btns = mesEl.querySelector('.mes_buttons');
    if (!btns) return;
    if (_deps?.settings?.().buttonMode !== 'post') {
        btns.querySelector('.dg-gen-btn')?.remove();
        btns.querySelector('.dg-photo-btn')?.remove();
        return;
    }
    if (!msg || msg.is_user || msg.is_system) return;
    const hasPayload = !!readRawPayload(msg, msg.swipe_id ?? 0);
    let gen = btns.querySelector('.dg-gen-btn');
    if (!gen) {
        gen = document.createElement('div');
        gen.className = 'mes_button dg-gen-btn';
        gen.innerHTML = '<i class="fa-solid fa-scroll"></i>';
        // id читаем в момент клика: ST перенумеровывает mesid у живых DOM-узлов
        // (updateViewMessageIds после удаления/скрытия/переноса постов), и
        // захваченный при создании id начинает указывать на чужое сообщение.
        gen.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = Number(mesEl.getAttribute('mesid'));
            if (Number.isFinite(id)) _deps?.run?.(id);
        });
        const hint = btns.querySelector('.extraMesButtonsHint');
        if (hint) btns.insertBefore(gen, hint);
        else btns.prepend(gen);
    }
    gen.title = hasPayload ? 'Перегенерировать артефакты' : 'Сгенерировать артефакт';
    // 📷 — только когда есть что заполнять и режим «по кнопке».
    let cam = btns.querySelector('.dg-photo-btn');
    const wantCam = _deps?.settings?.().imageMode === 'button' && _deps?.hasPending?.(msgId);
    if (wantCam && !cam) {
        cam = document.createElement('div');
        cam.className = 'mes_button dg-photo-btn';
        cam.title = 'Сгенерировать фото для слотов (URIS)';
        cam.textContent = '📷';
        cam.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = Number(mesEl.getAttribute('mesid'));
            if (Number.isFinite(id)) _deps?.fillImageSlots?.(id);
        });
        gen.after(cam);
    } else if (!wantCam && cam) {
        cam.remove();
    }
}

/** Индикатор занятости на всех кнопках генерации (пост/QR-бар/FAB). */
export function setGenerating(on) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.dg-gen-btn, .dg-launcher-btn').forEach(b => b.classList.toggle('dg-busy', on));
}

/**
 * Rebind устаревшего payload к текущему тексту варианта. Возвращает свежий
 * payload (уже записанный) или null (payload чужой/непригоден — очищен).
 */
function rebindPayload(msg, swipeIdx, raw) {
    if (payloadBelongsToOtherVariant(msg, swipeIdx, raw)) {
        clearPayload(msg, swipeIdx);
        persistChat();
        return null;
    }
    const prose = variantText(msg, swipeIdx);
    const artifacts = raw.artifacts.map((a) => {
        if (!a.anchor || !String(a.anchor).trim()) return a; // позиционные (миграция) — без изменений
        if (findAnchorInText(prose, a.anchor)) return { ...a, status: 'ok' };
        if (findFuzzySpan(prose, a.anchor)) return { ...a, status: 'fuzzy' };
        return { ...a, status: 'orphan' };
    });
    const next = { ...raw, contentDigest: digestForVariant(msg, swipeIdx), artifacts };
    return writePayload(msg, swipeIdx, next) && (persistChat(), next);
}

function reconcileMes(mesEl) {
    const idRaw = mesEl.getAttribute('mesid');
    if (idRaw == null || idRaw === '') return;
    const msgId = Number(idRaw);
    if (!Number.isFinite(msgId)) return;
    let shells = [...mesEl.querySelectorAll(`[${SHELL_ATTR}]`)];
    const msg = getMessage(msgId);
    if (!msg) { shells.forEach(s => s.remove()); return; }
    ensureMsgButtons(mesEl, msgId, msg);
    const swipeIdx = msg.swipe_id ?? 0;
    let payload = readVerifiedPayload(msg, swipeIdx);
    if (!payload) {
        const raw = readRawPayload(msg, swipeIdx);
        if (raw) payload = rebindPayload(msg, swipeIdx, raw);
    }
    const desired = new Map();
    for (const a of payload?.artifacts ?? []) {
        if (a && a.status !== 'orphan' && a.html) desired.set(shellKey(a), a);
    }
    // Fast-path: ни артефактов, ни оболочек — DOM дальше не трогаем.
    if (!desired.size && !shells.length) return;
    const textEl = mesEl.querySelector('.mes_text');
    if (!textEl) return;
    for (const s of shells) {
        if (!desired.has(s.getAttribute(SHELL_ATTR))) s.remove();
    }
    const have = new Set([...mesEl.querySelectorAll(`[${SHELL_ATTR}]`)].map(s => s.getAttribute(SHELL_ATTR)));
    const blocks = blocksOf(textEl);
    for (const [key, artifact] of desired) {
        if (have.has(key)) continue;
        const block = locateBlock(blocks, artifact);
        if (block) mountShell(block, artifact, key, textEl, msgId);
    }
}

/** Точечный проход по затронутым мутацией постам; null → полный обход. */
function collectAffectedMes(mutations) {
    const ids = new Set();
    for (const m of mutations || []) {
        for (const node of [...(m.addedNodes || []), ...(m.removedNodes || [])]) {
            let el = null;
            if (node && node.nodeType === 1 && node.closest) el = node.closest('.mes');
            if (!el && m.target && m.target.closest) el = m.target.closest('.mes');
            if (!el) return null;
            const idRaw = el.getAttribute('mesid');
            if (idRaw == null || idRaw === '') continue;
            ids.add(Number(idRaw));
        }
    }
    return ids;
}

function ensureObserver() {
    if (_observer || typeof MutationObserver === 'undefined') return;
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    _observer = new MutationObserver((mutations) => {
        if (_debounceId) clearTimeout(_debounceId);
        _debounceId = setTimeout(() => {
            _debounceId = null;
            try {
                const targets = collectAffectedMes(mutations);
                if (targets === null) reconcile();
                else if (targets.size) reconcile({ only: targets });
                ensureObserver(); // #chat мог быть пересоздан хостом
            } catch { /* реконсиляция не роняет чат */ }
        }, DEBOUNCE_MS);
    });
    _observer.observe(chatEl, { childList: true, subtree: true });
}

export function reconcile({ only = null } = {}) {
    if (typeof document === 'undefined') return;
    ensureObserver();
    const scope = document.getElementById('chat');
    if (!scope) return;
    for (const mesEl of scope.querySelectorAll('.mes')) {
        if (only && !only.has(Number(mesEl.getAttribute('mesid')))) continue;
        try { reconcileMes(mesEl); } catch (e) { try { globalThis.__dgErr = String(e?.stack || e); } catch { /* игнорируем */ } }
    }
}

export function reconcileMessage(msgId) {
    reconcile({ only: new Set([Number(msgId)]) });
}

/** Все внутри-сообщенийные клики: чипы (open/copy/delete) и ⟳ фотослота. */
function onDocumentClick(e) {
    const chipShell = e.target.closest?.(`[${SHELL_ATTR}]`);
    if (chipShell) {
        // mesid берём здесь, а не из запечённого data-dg-msg: ST перенумеровывает
        // mesid у живых узлов, и записанный при монтаже id устаревает.
        const msgId = Number(chipShell.closest('.mes')?.getAttribute('mesid') ?? chipShell.getAttribute('data-dg-msg'));
        const key = chipShell.getAttribute(SHELL_ATTR);
        if (e.target.closest('[data-dg-del]')) {
            deleteArtifact(msgId, String(key).split('|')[0]);
            return;
        }
        if (e.target.closest('[data-dg-copy]')) {
            const a = artifactByKey(msgId, key);
            if (a) copyText(a.html).then((ok) => globalThis.toastr?.[ok ? 'success' : 'error'](ok ? 'Diegetic: HTML скопирован' : 'Diegetic: копирование не удалось'));
            return;
        }
        if (e.target.closest('[data-dg-save]')) {
            const a = artifactByKey(msgId, key);
            if (a) { saveArtifactFile(a); globalThis.toastr?.success('Diegetic: файл сохранён — открой его в браузере'); }
            return;
        }
        if (e.target.closest('[data-dg-collapse]')) {
            _expanded.delete(String(key).replace(/\|[oc]$/, ''));
            reconcileMessage(msgId);
            return;
        }
        if (e.target.closest('[data-dg-open]')) {
            const mode = _deps?.settings?.().displayMode ?? 'inline';
            if (mode === 'popup') {
                const a = artifactByKey(msgId, key);
                if (a) openPopup(a, msgId);
            } else {
                _expanded.add(String(key).replace(/\|[oc]$/, ''));
                reconcileMessage(msgId);
            }
            return;
        }
    }
    // Клики по контролам фотослотов (✎/⟳) приходят postMessage'ом из iframe —
    // см. handleSlotCmd; в родительском document их целей нет.
}

export function initRender(deps = {}) {
    if (typeof window === 'undefined') return;
    _deps = deps;
    // Отладочный хук (стенд): window.__diegetic.reconcile() вручную.
    try { globalThis.__diegetic = { reconcile, setGenerating, deps: () => _deps }; } catch { /* не критично */ }
    if (!_onMessage) {
        _onMessage = (e) => {
            const h = e?.data?.__dgH;
            if (typeof h === 'number') {
                for (const f of document.querySelectorAll(`iframe.${FRAME_CLASS}`)) {
                    if (f.contentWindow === e.source) { f.style.height = `${clampH(h)}px`; break; }
                }
                return;
            }
            if (e?.data?.__dgCmd !== undefined) handleSlotCmd(e);
        };
        window.addEventListener('message', _onMessage);
    }
    if (!_onClick) {
        _onClick = onDocumentClick;
        document.addEventListener('click', _onClick);
        document.addEventListener('keydown', onKeydown);
    }
    // #chat может ещё не существовать к моменту хука activate — короткий ретрай.
    ensureObserver();
    if (!_observer) {
        let tries = 0;
        const t = setInterval(() => {
            ensureObserver();
            if (_observer || ++tries >= 10) clearInterval(t);
        }, 500);
    }
    reconcile();
}

export function shutdownRender() {
    if (_observer) { try { _observer.disconnect(); } catch { /* уже снят */ } _observer = null; }
    if (_debounceId) { clearTimeout(_debounceId); _debounceId = null; }
    if (_onMessage && typeof window !== 'undefined') {
        window.removeEventListener('message', _onMessage);
        _onMessage = null;
    }
    if (_onClick && typeof document !== 'undefined') {
        document.removeEventListener('click', _onClick);
        document.removeEventListener('keydown', onKeydown);
        _onClick = null;
    }
    closePopup();
    closeEditor();
    _expanded.clear();
    if (typeof document !== 'undefined') {
        document.querySelectorAll(`[${SHELL_ATTR}]`).forEach(s => s.remove());
        document.querySelectorAll('.dg-gen-btn, .dg-photo-btn').forEach(b => b.remove());
    }
}
