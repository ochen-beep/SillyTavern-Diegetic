// Оболочки артефактов и кнопки постов в чате.
// Reconcile: data-ключ, MutationObserver + debounce, точечные проходы.
// Режимы показа (settings.displayMode):
//   inline — iframe сразу в посте;
//   expand — чип-ряд [тип][Copy HTML][Delete]; клик по типу раскрывает iframe в посте;
//   popup  — тот же чип-ряд, клик открывает лайтбокс поверх чата.
// Развёрнутые чипы (expand) запоминаются в _expanded до перезагрузки страницы.
//
// Кнопки поста — в штатном ряду .mes_buttons:
// ◆ сгенерировать/перегенерировать, 📷 заполнить фотослоты (режим «по кнопке»).

import { getMessage, persistChat } from './host.js';
import { parseImageSlots, slotCardId, SLOT_ATTR } from './images.js';
import {
    readVerifiedPayload, readRawPayload, writePayload, clearPayload,
    payloadBelongsToOtherVariant, digestForVariant, variantText,
} from './payload.js';
import { normalizeAnchorKey, findAnchorInText, findFuzzySpan } from './anchor.js';
import { contentDigest } from './digest.js';
import { stashForUndo } from './undo.js';
import { tr } from './i18n.js';

export const SHELL_ATTR = 'data-dg-shell';
const FRAME_CLASS = 'dg-frame';
const DEBOUNCE_MS = 250;

// Якорь модели цитирует сырую прозу с markdown-символами; в отрендеренном
// тексте их нет — срезаем перед матчем.
const stripMd = (s) => String(s ?? '').replace(/[*_~`#>]/g, '');

// Артефакт — полноценный документ со скриптами; песочница opaque-origin,
// allow-same-origin НЕ давать (иначе скрипт артефакта достаёт parent DOM).
// CSP-мета (Б17): опорный ST CSP хоста отключён, а blob-документ наследует
// пустую политику — без неё LLM-артефакт может ходить в сеть (fetch/WebSocket/
// <img src> наружу = канал экфильтрации). Политика: всё inline (артефакт
// самодостаточен), сеть закрыта (connect-src только data:/blob:), внешние
// ресурсы — только шрифты Google (шаблон universal.md их требует; font-хосты
// канала утечки данных не дают). wasm/eval разрешены: LLM-код их использует,
// изоляцию они не ослабляют.
// Высота — postMessage-рукопожатие; html принудительно прозрачный и без
// скроллбаров (иммерсивная вставка — скролл внутри артефакта не трогаем).
// html/body — нулевой min-height: иначе 100vh-ловушка на body раздувает
// iframe и после сворачивания артефакта внутри себя высота не сжимается
// обратно — внизу висит чёрная пустота.
// body>*{flex-shrink:0}: у flex-центрированных сцен фиксированная ширина
// (680px) сжималась flex-shrink'ом до ширины фрейма — переполнения нет, fit не
// срабатывал, а внутри сжатого контейнера абсолютно спозиционированные детали
// обрезались (шпильки уходили за край). С shrink:0 сцена остаётся натуральной
// ширины и масштабируется целиком.
// touch-action:none: свайп-механики артефакта не должны зависеть от того,
// вспомнила ли модель про preventDefault (пруд глушил жест сам, шпильки — нет).
// Иначе жест цепляется к странице (iframe переполнению скроллить нечего),
// а артефакту прилетает touchcancel — механика обрывается на полпути.
// Цена: по площади артефакта чат не листается — скролл на тексте вокруг.
const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; img-src data: blob:; media-src data: blob:; connect-src data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
// prefers-reduced-motion (Б39): модели любят вечные анимации — для пользователей
// с настроенной чувствительностью к движению гасим их в самом артефакте.
const IMMERSIVE_CSS = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"><style>html,body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;background:transparent!important}html{overflow:hidden!important}body>*{flex-shrink:0!important}html,body{touch-action:none}@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}</style>`;
// Рантайм-высота меряется по body, а не по documentElement.scrollHeight:
// у корневого скроллера scrollHeight не опускается ниже вьюпорта фрейма,
// поэтому после роста (раскрытие «слоя») iframe никогда не сжимался обратно —
// замкнутый круг «высота фрейма = вьюпорт ≥ scrollHeight». Плюс MutationObserver
// срезает рантайм-правки min-height:100vh (та же ловушка, что чинит
// normalizeIntrinsicHeight, но уже после монтажа).
// Модель любит сцены с жёсткой px-шириной (680px и т.п.), а iframe в посте —
// 100% колонки сообщения: на телефоне контент молча обрезался по бокам
// (overflow:hidden из IMMERSIVE_CSS, рукопожатие меряет только высоту).
// Авто-фит: контент шире вьюпорта фрейма → сжимаем body через zoom (меняет
// layout, scrollHeight масштабируется сам); где zoom нет — transform:scale,
// и m() домножает scrollHeight на K (rect.height уже включает трансформ).
//
// ДВА ПРАВИЛА ПРОТИВ ПЕТЕЛЬ (каждая правка здесь чинилась воспроизведением):
// 1) Естественные размеры (N/NH) меряем ТОЛЬКО в немасштабированном состоянии
//    (K≈1): поведение scrollWidth под применённым zoom разнится по движкам
//    (у canvas-артефакта оставался натуральным → деление на K дважды учитывало
//    масштаб → K схлопывался к нулю, артефакт «мигал и исчезал»).
// 2) Измерений «под действием собственного эффекта» нет вообще: contain-бокс
//    (BX/BY) приходит от родителя postMessage'ом (лайтбокс: вся сцена обязана
//    влезать и в ширину, и в высоту), сам по себе фрейм свою целевую высоту
//    не вычисляет из clientHeight (храповик на полосе прокрутки).
const RESIZE_SNIPPET = '<script>(function(){var K=1,N=0,NH=0,BX=0,BY=0;var Z=document.body&&("zoom" in document.body.style);'
    + 'var ap=function(){var b=document.body;if(!b)return;'
    + 'if(Z){b.style.zoom=(K<0.999)?String(K):""}'
    + 'else{b.style.transformOrigin="top center";b.style.transform=(K<0.999)?"scale("+K+")":""}};'
    + 'var fit=function(){var b=document.body;if(!b)return;'
    + 'var w=BX||document.documentElement.clientWidth||window.innerWidth;if(!w)return;'
    + 'if(K>0.99){N=b.scrollWidth||N;NH=Math.max(b.getBoundingClientRect().height,b.scrollHeight)||NH}'
    + 'if(!N)return;'
    + 'var k=(N>w+1)?w/N:1;'
    + 'if(BY&&NH>0&&NH*k>BY)k=BY/NH;'
    + 'if(Math.abs(k-K)>=0.005){K=k;ap()}};'
    + 'var m=function(){var b=document.body;if(!b)return document.documentElement.scrollHeight;'
    + 'return Z?Math.max(b.getBoundingClientRect().height,b.scrollHeight)'
    + ':Math.max(b.getBoundingClientRect().height,b.scrollHeight*K)};'
    + 'var p=function(){fit();try{parent.postMessage({__dgH:m()},"*")}catch(e){}};'
    // Лайтбокс шлёт доступный бокс {w,h}: contain — вся сцена влезает без
    // обрезки по краям. Повторная отправка при повороте/ресайзе окна.
    + 'addEventListener("message",function(e){var d=e&&e.data;if(d&&d.__dgContain){BX=d.__dgContain.w||0;BY=d.__dgContain.h||0;p()}});'
    + 'var fix=function(){document.querySelectorAll("[style*=vh]").forEach(function(el){var s=el.getAttribute("style");var t=String(s).replace(/(min-height|max-height|height)\\s*:\\s*[\\d.]+(?:s|l|d)?vh/gi,"$1:auto");if(t!==s)el.setAttribute("style",t)})};'
    + 'if(typeof ResizeObserver!=="undefined"){new ResizeObserver(p).observe(document.body)}'
    + 'if(typeof MutationObserver!=="undefined"){new MutationObserver(function(){fix();p()}).observe(document.documentElement,{attributes:true,attributeFilter:["style"],subtree:true})}'
    + 'addEventListener("load",p);addEventListener("resize",p);fix();p()})()</' + 'script>';
// Клики внутри sandbox-iframe (opaque origin) до родительского document не доходят —
// команды контролов (✎/⟳) уходят postMessage'ом, по образцу рукопожатия высоты.
// Capture + stopPropagation: клик по контролу не должен будить JS самого артефакта.
// Esc (Б1) — тоже postMessage: keydown из iframe до родителя не доходит, и
// лайтбокс не закрывался после клика в артефакт. Родитель реагирует, только
// если у него открыт попап/редактор — Esc-механики самого артефакта не трогаем.
const CMD_SNIPPET = '<script>document.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest("[data-dg-cmd]"):null;if(!t)return;e.preventDefault();e.stopPropagation();try{parent.postMessage({__dgCmd:String(t.getAttribute("data-dg-cmd")),ordinal:Number(t.getAttribute("data-ordinal"))},"*")}catch(x){}},true);document.addEventListener("keydown",function(e){if(e.key==="Escape"){try{parent.postMessage({__dgEsc:1},"*")}catch(x){}}},true)</' + 'script>';
// Фрагменты без <head>/<html> (модель отдала кусок документа) проходили бы
// мимо обеих замен — стили в начало строки: браузер допарсит фрагмент
// и подхватит их.
export const withImmersiveCss = (html) => {
    const s = String(html);
    if (/<head[^>]*>/i.test(s)) return s.replace(/<head[^>]*>/i, (m) => m + IMMERSIVE_CSS);
    if (/<html[^>]*>/i.test(s)) return s.replace(/<html[^>]*>/i, (m) => m + '<head>' + IMMERSIVE_CSS + '</head>');
    return IMMERSIVE_CSS + s;
};
const clampH = (h) => Math.min(Math.max(40, Math.round(h) || 0), 4000);

/**
 * Высота артефакта должна быть «естественной» (по контенту): модель любит
 * min-height:100vh/100svh на body или сцене — внутри iframe vh = высота самого
 * iframe, поэтому рукопожатие растит его до капа 4000, а при внутреннем
 * сворачивании артефакта высота не возвращается. То же и с ЛЮБЫМ Nvh, только
 * наоборот: сцена {height:94vh} = 0.94 от высоты фрейма → рукопожатие
 * H→0.94H→0.88H… схлопывало артефакт и лайтбокс до минимума («скукожило»,
 * «не загружается»). Любой vh в height-свойствах — петля, величина не важна.
 * С refH (вьюпорт хоста, кап 700) vh переводится в стабильные px: сцена
 * получает экраноподобный размер и не зависит от высоты собственного фрейма.
 * Анимации вида translateY(100vh) и width:100vw не трогаем: ширина фрейма
 * от его высоты не зависит — петли нет.
 */
export function normalizeIntrinsicHeight(html, refH = 0) {
    return String(html ?? '').replace(
        /\b(min-height|max-height|height)\s*:\s*([\d.]+)(?:s|l|d)?vh\b/gi,
        (m, prop, num) => refH
            ? `${prop}:${Math.round(parseFloat(num) / 100 * refH)}px`
            : `${prop}:auto`,
    );
}

let _observer = null;
let _debounceId = null;
let _retryId = null;
let _active = false;
let _onMessage = null;
let _onClick = null;
let _popup = null;
let _deps = null;
/** Раскрытые в expand-режиме оболочки (baseKey). Рантайм, не настройка. */
const _expanded = new Set();
/** path → dataUrl (фото /user/images проксируются в data: — CORP: same-origin
 *  хоста не даёт opaque-iframe грузить их напрямую); null = загрузка идёт. */
const _imgCache = new Map();

/** Сброс кэша фото при смене чата — data:-URL привязаны к чату, расти дальше не должны.
 *  Рядом чистится кэш высот (Б34) — ключи включают dg_id чужого чата. */
export function clearImageCache() { _imgCache.clear(); _heightCache.clear(); }

const baseKey = (a) => `${a.id}|${contentDigest(a.html)}`;
// Полный ключ оболочки: id|digest|open/closed|lazy/eager. id и digest не
// содержат '|', поэтому baseKey из полного ключа — первые два сегмента.
// Регресс Б34: обрезка старым регексом /\|[oc]$/ не цепляла хвост ленивости
// — на мобильном профиле «развернуть/свернуть» молча не работало.
export const baseKeyOfKey = (key) => String(key ?? '').split('|').slice(0, 2).join('|');
/** inline — всегда iframe; expand — по памяти раскрытий; popup — всегда чип. */
const isOpen = (a) => {
    const mode = _deps?.settings?.().displayMode ?? 'inline';
    if (mode === 'inline') return true;
    if (mode === 'expand') return _expanded.has(baseKey(a));
    return false;
};
// Б34: ленивые фреймы — часть ключа оболочки, чтобы смена режима вызывала
// честную перестройку (iframe ↔ плейсхолдер), а не «как повезёт».
const shellKey = (a) => `${baseKey(a)}|${isOpen(a) ? 'o' : 'c'}|${lazyActive() ? 'l' : 'e'}`;

// ── Ленивые iframe (Б34) ─────────────────────────────────────────────
// Десятки живых iframe в длинном чате — CPU/батарея и мобильные фризы
// (ST#5703), а хосты с виртуализацией DOM (TauriTavern 2.2+) сняли бы их сами.
// Вне вьюпорта (±600px) iframe снимается и остаётся равновысотный
// плейсхолдер (высота — из рукопожатия; приём JSR PR #86 — без прыжков
// скролла). Состояние артефакта при снятии теряется — потому настройка.
// popup-фреймы ленивыми не бывают.
const _heightCache = new Map(); // baseKey → px последнего рукопожатия
let _lazyIO = null;

function lazyActive() {
    const mode = _deps?.settings?.().lazyFrames ?? 'auto';
    if (mode === 'off' || typeof IntersectionObserver === 'undefined') return false;
    if (mode === 'on') return true;
    return (globalThis.window?.innerWidth ?? 1024) < 768;
}

function ensureLazyIO() {
    if (_lazyIO || !lazyActive()) return _lazyIO;
    _lazyIO = new IntersectionObserver((entries) => {
        for (const en of entries) {
            const shell = en.target;
            if (!shell?.hasAttribute?.(SHELL_ATTR)) continue;
            if (en.isIntersecting) mountFrameInShell(shell);
            else unmountToPlaceholder(shell);
        }
    }, { rootMargin: '600px 0px' });
    return _lazyIO;
}

/** Собрать iframe артефакта и вставить вместо плейсхолдера. */
function mountFrameInShell(shell) {
    if (shell.querySelector(`iframe.${FRAME_CLASS}`)) return;
    const key = shell.getAttribute(SHELL_ATTR) ?? '';
    const msgId = Number(shell.getAttribute('data-dg-msg'));
    const artifact = artifactByKey(Number.isFinite(msgId) ? msgId : null, key);
    if (!artifact) return;
    const ph = shell.querySelector('.dg-lazy');
    const frame = document.createElement('iframe');
    frame.className = FRAME_CLASS;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', String(artifact.type || 'artifact'));
    const html = patchStoredArtifact(artifact.html);
    const frameHtml = () => frameDoc(withCachedImages(withImmersiveCss(html)) + RESIZE_SNIPPET + CMD_SNIPPET);
    mountFrameHtml(frame, frameHtml());
    if (/src="(\/user\/images\/[^"]+)"/.test(html)) {
        warmImages(html).then(() => { if (frame.isConnected) mountFrameHtml(frame, frameHtml()); });
    }
    if (ph) ph.replaceWith(frame);
    else shell.prepend(frame);
}

/** Снять iframe, оставив плейсхолдер той же высоты (скролл не прыгает). */
function unmountToPlaceholder(shell) {
    const frame = shell.querySelector(`iframe.${FRAME_CLASS}`);
    if (!frame) return;
    const key = shell.getAttribute(SHELL_ATTR) ?? '';
    const h = parseFloat(frame.style.height) || _heightCache.get(key) || 80;
    const ph = document.createElement('div');
    ph.className = 'dg-lazy';
    ph.style.height = `${Math.max(40, Math.round(h))}px`;
    frame.replaceWith(ph);
}

// Контролы фотослота (✎ промпт, ⟳ перегенерация) — display-only: payload кнопок
// не хранит, сохранённый .html остаётся чистым артефактом. Стили лежат здесь же —
// родительский CSS в sandbox-iframe не проникает.
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
    // refH — вьюпорт хоста с капом: vh сцены переводится в px до монтажа,
    // чтобы её высота не зависела от высоты собственного фрейма.
    const refH = Math.min(globalThis.window?.innerHeight || 0, 700);
    let out = normalizeIntrinsicHeight(String(html ?? ''), refH);
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

/**
 * Блок-владелец для монтажа. Якорь уже валидирован по сырой прозе пайплайном,
 * но по блокам отрендеренного текста может не найтись: цитата через границу
 * абзацев (нормализация схлопывает \n\n, а в DOM абзацы — разные узлы),
 * markdown-перекраска фрагмента. Прятать оплаченный артефакт молча нельзя —
 * фолбэк: конец поста.
 */
export function resolveMountBlock(blocks, artifact, textEl) {
    return locateBlock(blocks, artifact) ?? textEl;
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
        fold.textContent = tr('▾ Collapse', 'diegetic.action.collapse');
        row.appendChild(fold);
    }
    const pop = document.createElement('button');
    pop.type = 'button';
    pop.className = 'dg-chip-action';
    pop.setAttribute('data-dg-pop', '');
    pop.title = tr('Open over the chat', 'diegetic.action.pop');
    pop.textContent = '⤢';
    row.appendChild(pop);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'dg-chip-action';
    copy.setAttribute('data-dg-copy', '');
    copy.title = tr('Copy HTML', 'diegetic.action.copy');
    copy.textContent = '⧉';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'dg-chip-action';
    save.setAttribute('data-dg-save', '');
    save.title = tr('Save as .html — open it in a browser and poke it', 'diegetic.action.save');
    save.textContent = '⤓';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'dg-chip-action';
    del.setAttribute('data-dg-del', '');
    del.title = tr('Remove the artifact from the post', 'diegetic.action.delete');
    del.textContent = '✕';
    row.append(copy, save, del);
    return row;
}

// Артефакты рендерим через blob: URL — не собираемый srcdoc и не зависит
// от frame-src хоста (в опорном ST CSP отключён: helmet contentSecurityPolicy: false).
// Всегда с <!DOCTYPE html>: без него документ уходит в quirks-режим, где
// body{height:100%} = высоте вьюпорта фрейма — высота подпитывает сама себя
// через рукопожатие и раздувает iframe до капа 4000 (артефакт «исчезает»).
// Дубль doctype парсер игнорирует безболезненно, первый wins.
function frameDoc(html) {
    return '<!DOCTYPE html>' + html;
}
// Старый blob отзываем ТОЛЬКО после загрузки нового документа: синхронный revoke
// до load на медленных движках (мобильная Opera) через раз убивал фрейм в полёте —
// «пустой лайтбокс/фрейм». Страховка: если за 4 c не пришло рукопожатие высоты
// (загрузка умерла молча), перезагружаем тот же blob — он гарантированно жив.
// Одна перезагрузка на монтаж (флаг dgReloaded): ранее медленный фрейм
// перезагружался повторно, и скрипты артефакта исполнялись дважды (Б28) —
// у артефактов с сайд-эффектами (счётчики, запросы) дублировалось состояние.
function mountFrameHtml(frame, html) {
    const prev = frame.dataset.dgBlob;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    frame.dataset.dgBlob = url;
    frame.dataset.dgHSeen = '';
    frame.dataset.dgReloaded = '';
    frame.src = url;
    if (prev) frame.addEventListener('load', () => URL.revokeObjectURL(prev), { once: true });
    setTimeout(() => {
        if (!frame.dataset.dgHSeen && frame.isConnected && !frame.dataset.dgReloaded) {
            frame.dataset.dgReloaded = '1';
            frame.src = frame.dataset.dgBlob;
        }
    }, 4000);
}

function buildShell(artifact, key, msgId) {
    const open = isOpen(artifact);
    const shell = document.createElement('div');
    shell.setAttribute(SHELL_ATTR, key);
    shell.setAttribute('data-dg-msg', String(msgId));
    if (!open) {
        // Чип-ряд вместо артефакта: тип + Copy + Delete. Orphan помечен ⚠ (Б38):
        // читатель чата видит, что артефакт «в конце поста» — не случайность.
        shell.className = 'dg-shell dg-chiprow';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'dg-chip';
        open.setAttribute('data-dg-open', '');
        open.textContent = String(artifact.type || 'artifact') + (artifact.status === 'orphan' ? ' ⚠' : '');
        if (artifact.status === 'orphan') open.title = tr('Anchor not found — the artifact is shown at the end of the post', 'diegetic.orphan.title');
        shell.append(open, ...buildActionRow().children);
        return shell;
    }
    shell.className = 'dg-shell';
    // Б34: в ленивом режиме вместо iframe — равновысотный плейсхолдер; реальный
    // фрейм монтирует IntersectionObserver, когда оболочка подошла к экрану.
    if (lazyActive()) {
        const ph = document.createElement('div');
        ph.className = 'dg-lazy';
        ph.style.height = `${Math.max(40, _heightCache.get(key) || 80)}px`;
        shell.appendChild(ph);
        ensureLazyIO()?.observe(shell);
        const modeLazy = _deps?.settings?.().displayMode ?? 'inline';
        shell.appendChild(buildActionRow({ collapse: modeLazy === 'expand' }));
        return shell;
    }
    const frame = document.createElement('iframe');
    frame.className = FRAME_CLASS;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', String(artifact.type || 'artifact'));
    const html = patchStoredArtifact(artifact.html);
    const frameHtml = () => frameDoc(withCachedImages(withImmersiveCss(html)) + RESIZE_SNIPPET + CMD_SNIPPET);
    mountFrameHtml(frame, frameHtml());
    shell.appendChild(frame);
    // Догреть кэш фото и перелить в iframe, когда data: готовы. Без картинок
    // перемонтаж не нужен: повторный mount = revoke+новый blob = мигание.
    if (/src="(\/user\/images\/[^"]+)"/.test(html)) {
        warmImages(html).then(() => {
            if (frame.isConnected) mountFrameHtml(frame, frameHtml());
        });
    }
    // Меню живёт вместе с показанным артефактом в любом режиме — скопировать /
    // сохранить / удалить; «Свернуть» добавляется только в expand-режиме.
    const mode = _deps?.settings?.().displayMode ?? 'inline';
    shell.appendChild(buildActionRow({ collapse: mode === 'expand' }));
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

/** Сохранить артефакт как standalone .html: Blob + a[download], без сервера;
 *  файл открывается двойным кликом в любом браузере — артефакт и есть
 *  полноценный документ по контракту. Сгенерированные фото (/user/images)
 *  встраиваются data:-URL'ами: вне таверны по пути хоста они бы не открылись.
 *  Б2: iOS Safari игнорирует download у blob:URL — там первичен share-sheet
 *  («Сохранить в Файлы»), a[download] остаётся фолбэком. */
async function saveArtifactFile(artifact) {
    const raw = String(artifact.html);
    await warmImages(raw); // промах кэша — src остаётся путём, файл всё равно сохраняем
    const html = withCachedImages(raw);
    const safe = (s) => String(s ?? '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'artifact';
    const fileName = `diegetic-${safe(artifact.type)}-${safe(artifact.id)}.html`;
    const canShareFiles = typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
        && (() => { try { return navigator.canShare({ files: [new File([''], 'x.html', { type: 'text/html' })] }); } catch { return false; } })();
    if (canShareFiles) {
        try {
            const file = new File([html], fileName, { type: 'text/html;charset=utf-8' });
            await navigator.share({ files: [file] });
            return; // share-лист отработал (отмена пользователем — не ошибка)
        } catch (e) {
            if (e?.name === 'AbortError') return;
            // иная ошибка share — падаем в путь a[download]
        }
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Удалить артефакт из payload; пустой payload снимается целиком.
 *  Отмена — кликом по тосту в течение окна (Б24): прежний payload прячется
 *  в память, confirm-трение не нужно. Оплаченный контент не теряется от
 *  случайного клика.
 *  Экспорт — панельный список артефактов (ui.js) удаляет через index.js. */
export function deleteArtifact(msgId, artifactId) {
    const msg = getMessage(msgId);
    if (!msg) return;
    const swipeIdx = msg.swipe_id ?? 0;
    const payload = readRawPayload(msg, swipeIdx);
    if (!payload) return;
    const rest = payload.artifacts.filter(a => a.id !== artifactId);
    if (rest.length === payload.artifacts.length) return;
    const undo = stashForUndo(msg, swipeIdx, payload);
    if (rest.length) writePayload(msg, swipeIdx, { ...payload, artifacts: rest });
    else clearPayload(msg, swipeIdx);
    persistChat();
    reconcileMessage(msgId);
    if (undo) {
        globalThis.toastr?.success(tr('Diegetic: artifact deleted — click here to undo', 'diegetic.toast.deleted'), 'Diegetic', {
            timeOut: 10_000,
            onclick: () => {
                if (undo()) {
                    persistChat();
                    reconcile();
                    globalThis.toastr?.success(tr('Diegetic: deletion undone — artifact restored', 'diegetic.toast.deleteUndone'));
                }
            },
        });
    }
}

function closePopup() {
    if (_popup) {
        if (_popup.onResize) {
            window.removeEventListener('resize', _popup.onResize);
            // Б14: скрытие/появление URL-бара мобильного браузера меняет
            // вьюпорт без window.resize — contain надо пересчитывать и тут.
            globalThis.visualViewport?.removeEventListener?.('resize', _popup.onResize);
        }
        _popup.el.remove();
        _popup = null;
    }
    document.documentElement?.classList.remove('dg-lock');
    // Вернуть фокус туда, откуда лайтбокс открыли (клавиатурный сценарий).
    if (_returnFocus) {
        try { _returnFocus.focus?.(); } catch { /* элемент уже мёртв */ }
        _returnFocus = null;
    }
}

/** Куда вернуть фокус после закрытия лайтбокса (Б1/a11y). */
let _returnFocus = null;

/** Панельная библиотека (ui.js): открыть артефакт в лайтбоксе по msgId + id. */
export function openArtifactPopup(msgId, artifactId) {
    const a = artifactByKey(msgId, artifactId);
    if (a) openPopup(a, Number(msgId));
}

/** Панельная библиотека (ui.js): сохранить артефакт файлом по msgId + id. */
export async function saveArtifactById(msgId, artifactId) {
    const a = artifactByKey(msgId, artifactId);
    if (!a) return;
    await saveArtifactFile(a);
    globalThis.toastr?.success(tr('Diegetic: file saved — open it in your browser', 'diegetic.toast.savedFile'));
}

function openPopup(artifact, msgId = null) {
    closePopup();
    const overlay = document.createElement('div');
    overlay.className = 'dg-popup';
    overlay.innerHTML = `<div class="dg-popup-backdrop" data-dg-close></div><section class="dg-popup-dialog" role="dialog" aria-modal="true"><header><strong>${escAttr(artifact.type || 'artifact')}</strong><button type="button" class="dg-popup-close" data-dg-close aria-label="${tr('Close', 'diegetic.slot.close')}">×</button></header></section>`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    const html = withImmersiveCss(patchStoredArtifact(String(artifact.html)));
    const frameHtml = () => frameDoc(withCachedImages(html) + RESIZE_SNIPPET + CMD_SNIPPET);
    mountFrameHtml(frame, frameHtml());
    if (/src="(\/user\/images\/[^"]+)"/.test(html)) {
        warmImages(html).then(() => {
            if (overlay.isConnected) mountFrameHtml(frame, frameHtml());
        });
    }
    overlay.querySelector('.dg-popup-dialog').appendChild(frame);
    overlay.addEventListener('click', (e) => { if (e.target.closest('[data-dg-close]')) closePopup(); });
    document.body.appendChild(overlay);
    // Фокус в диалог сразу: клавиатурный пользователь уже «внутри», Esc сработает
    // без лишнего клика; после закрытия фокус вернётся на инициатора.
    _returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.querySelector('.dg-popup-close')?.focus();
    // Скролл-лок фона: чат под оверлеем не крутится колесом/тачем (YARL-паттерн).
    document.documentElement.classList.add('dg-lock');
    // Contain: весь артефакт влезает в видимый бокс лайтбокса без обрезки —
    // фрейм сам масштабируется под присланный размер (см. RESIZE_SNIPPET).
    // Переотправка при повороте телефона/ресайзе окна.
    const sendContain = () => {
        const dlg = overlay.querySelector('.dg-popup-dialog');
        const header = overlay.querySelector('.dg-popup-dialog > header');
        if (!dlg) return;
        const w = Math.round(dlg.clientWidth);
        const h = Math.round(Math.min(window.innerHeight * 0.86, 900) - (header?.offsetHeight ?? 40));
        try { frame.contentWindow?.postMessage({ __dgContain: { w, h } }, '*'); } catch { /* фрейм ещё не проснулся */ }
    };
    frame.addEventListener('load', sendContain);
    const onResize = () => sendContain();
    window.addEventListener('resize', onResize);
    globalThis.visualViewport?.addEventListener?.('resize', onResize);
    // Команды из iframe попапа (✎/⟳) маппятся на артефакт через это описание —
    // у popup-iframe нет shell-предка в посте.
    _popup = { el: overlay, frame, msgId, artifactId: artifact.id ?? null, onResize };
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
        + '<header><strong>' + tr('Photo slot prompt', 'diegetic.slot.editorTitle') + '</strong>'
        + '<button type="button" class="dg-popup-close" data-dg-close aria-label="' + tr('Close', 'diegetic.slot.close') + '">×</button></header>'
        + '<label class="dg-editor-row">' + tr('Trigger', 'diegetic.slot.trigger') + '<select data-f="trigger">'
        + '<option value="">' + tr('— no trigger —', 'diegetic.slot.noTrigger') + '</option>'
        + '<option value="selfie">' + tr('selfie — character in frame, vertical shot', 'diegetic.slot.triggerSelfie') + '</option>'
        + '<option value="img">' + tr('img — object, document', 'diegetic.slot.triggerImg') + '</option>'
        + '<option value="scene">' + tr('scene — place, panorama, interior', 'diegetic.slot.triggerScene') + '</option>'
        + '</select></label>'
        + '<textarea data-f="desc" rows="5" placeholder="' + tr('Shot description in English: who/what, angle, light', 'diegetic.slot.descPlaceholder') + '"></textarea>'
        + '<footer class="dg-editor-actions">'
        + '<button type="button" class="dg-chip-action" data-f="save">' + tr('Save', 'diegetic.slot.save') + '</button>'
        + '<button type="button" class="dg-chip-action" data-f="regen">' + tr('Save and regenerate', 'diegetic.slot.saveRegen') + '</button>'
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

/** Кнопки поста в .mes_buttons: ◆ генерация/реген, 📷 фотослоты.
 *  Видны только в режиме buttonMode 'post'; busy-класс вешает setGenerating.
 *  Экспорт — для тестов: регрессия «клик по устаревшему mesid». */
export function ensureMsgButtons(mesEl, msgId, msg) {
    const btns = mesEl.querySelector('.mes_buttons');
    if (!btns) return;
    // Б4: bar-режим без найденного QR-хоста — runtime-флаг barFallback держит
    // ◆ у постов (ставит index.js через 3 c после init + тост).
    const st = _deps?.settings?.();
    const keepPost = st?.buttonMode === 'post' || (st?.buttonMode === 'bar' && st?.barFallback);
    if (!keepPost) {
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
    // Не перетирать тултип «Отменить генерацию», пока кнопка в busy.
    if (!gen.classList?.contains('dg-busy')) {
        gen.title = hasPayload ? tr('Regenerate artifacts', 'diegetic.btn.regenerate') : tr('Generate an artifact', 'diegetic.btn.generate');
    }
    // 📷 — только когда есть что заполнять и режим «по кнопке».
    let cam = btns.querySelector('.dg-photo-btn');
    const wantCam = _deps?.settings?.().imageMode === 'button' && _deps?.hasPending?.(msgId);
    if (wantCam && !cam) {
        cam = document.createElement('div');
        cam.className = 'mes_button dg-photo-btn';
        cam.title = tr('Generate photos for slots (URIS)', 'diegetic.btn.photo');
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

/** Индикатор занятости на всех кнопках генерации (пост/QR-бар/FAB).
 *  Пока крутится — тултип меняется на «Отменить»: повторный клик абортирует
 *  прогон, иначе про отмену знает только читатель README. */
export function setGenerating(on) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.dg-gen-btn, .dg-launcher-btn').forEach(b => {
        b.classList.toggle('dg-busy', on);
        if (on) {
            if (!b.dataset.dgTitle) b.dataset.dgTitle = b.title || '';
            b.title = tr('Cancel generation', 'diegetic.btn.cancel');
        } else if (b.dataset.dgTitle) {
            b.title = b.dataset.dgTitle;
            delete b.dataset.dgTitle;
        }
    });
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
    const plainProse = stripMd(prose);
    const artifacts = raw.artifacts.map((a) => {
        const clean = stripMd(a.anchor).trim();
        if (!clean) return a; // позиционные (миграция) или без якоря — без изменений
        if (findAnchorInText(prose, a.anchor) || findAnchorInText(plainProse, clean)) return { ...a, status: 'ok' };
        if (findFuzzySpan(prose, a.anchor) || findFuzzySpan(plainProse, clean)) return { ...a, status: 'fuzzy' };
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
        if (a && a.html) desired.set(shellKey(a), a);
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
        mountShell(resolveMountBlock(blocks, artifact, textEl), artifact, key, textEl, msgId);
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
    // После shutdownRender обсервер не пересоздаём: иначе retry-интервал мог
    // вернуть reconcileMes с устаревшими _deps уже после disable.
    if (!_active || _observer || typeof MutationObserver === 'undefined') return;
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
        try { reconcileMes(mesEl); } catch (e) { console.warn('[Diegetic] reconcile:', e); }
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
        if (e.target.closest('[data-dg-pop]')) {
            const a = artifactByKey(msgId, key);
            if (a) openPopup(a, msgId);
            return;
        }
        if (e.target.closest('[data-dg-copy]')) {
            const a = artifactByKey(msgId, key);
            if (a) copyText(a.html).then((ok) => globalThis.toastr?.[ok ? 'success' : 'error'](ok ? tr('Diegetic: HTML copied', 'diegetic.toast.copied') : tr('Diegetic: copying failed', 'diegetic.toast.copyFailed')));
            return;
        }
        if (e.target.closest('[data-dg-save]')) {
            const a = artifactByKey(msgId, key);
            if (a) saveArtifactFile(a).then(
                () => globalThis.toastr?.success(tr('Diegetic: file saved — open it in your browser', 'diegetic.toast.savedFile')),
                () => globalThis.toastr?.error(tr('Diegetic: file not saved', 'diegetic.toast.saveFailed')),
            );
            return;
        }
        if (e.target.closest('[data-dg-collapse]')) {
            _expanded.delete(baseKeyOfKey(key));
            reconcileMessage(msgId);
            return;
        }
        if (e.target.closest('[data-dg-open]')) {
            const mode = _deps?.settings?.().displayMode ?? 'inline';
            if (mode === 'popup') {
                const a = artifactByKey(msgId, key);
                if (a) openPopup(a, msgId);
            } else {
                _expanded.add(baseKeyOfKey(key));
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
    _active = true;
    // Отладочный хук (стенд): window.__diegetic.reconcile() вручную.
    try { globalThis.__diegetic = { reconcile, setGenerating, deps: () => _deps }; } catch { /* не критично */ }
    if (!_onMessage) {
        let _hRafPending = false;
        let _hRafFrame = null;
        let _hRafValue = 0;
        _onMessage = (e) => {
            const h = e?.data?.__dgH;
            if (typeof h === 'number') {
                // Лайтбокс: высота диалога по контенту артефакта (+ шапка),
                // иначе фиксированная высота обрезает артефакт в ландшафте.
                if (_popup?.frame?.contentWindow === e.source) {
                    _popup.frame.dataset.dgHSeen = '1';
                    const dlg = _popup.el.querySelector('.dg-popup-dialog');
                    if (dlg) dlg.style.height = `${Math.min(clampH(h) + 40, Math.round(window.innerHeight * 0.86))}px`;
                    return;
                }
                for (const f of document.querySelectorAll(`iframe.${FRAME_CLASS}`)) {
                    if (f.contentWindow === e.source) {
                        f.dataset.dgHSeen = '1';
                        const shellKeyAttr = f.closest(`[${SHELL_ATTR}]`)?.getAttribute(SHELL_ATTR);
                        if (shellKeyAttr) _heightCache.set(shellKeyAttr, clampH(h));
                        // Б18: флуд {__dgH} (1044 сооб./2 c в прогоне) на каждое
                        // сообщение ставил style.height = сотни layout/с.
                        // Применяем ПОСЛЕДНЮЮ высоту не чаще кадра.
                        if (typeof requestAnimationFrame === 'function') {
                            _hRafValue = clampH(h);
                            _hRafFrame = f;
                            if (_hRafPending) return;
                            _hRafPending = true;
                            requestAnimationFrame(() => {
                                _hRafPending = false;
                                if (_hRafFrame?.isConnected) _hRafFrame.style.height = `${_hRafValue}px`;
                            });
                        } else {
                            f.style.height = `${clampH(h)}px`;
                        }
                        break;
                    }
                }
                return;
            }
            if (e?.data?.__dgEsc) {
                // Esc из артефакта (Б1): закрыть наш оверлей, если он открыт;
                // иначе Esc — дело самого артефакта, не мешаем.
                if (_popup) closePopup();
                else if (_editor) closeEditor();
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
        // id в модуле: shutdownRender обязан гасить ретрай, иначе он пересоздаст
        // обсервер уже после disable.
        _retryId = setInterval(() => {
            ensureObserver();
            if (_observer || ++tries >= 10) { clearInterval(_retryId); _retryId = null; }
        }, 500);
    }
    reconcile();
}

export function shutdownRender() {
    _active = false;
    if (_retryId) { clearInterval(_retryId); _retryId = null; }
    if (_observer) { try { _observer.disconnect(); } catch { /* уже снят */ } _observer = null; }
    if (_debounceId) { clearTimeout(_debounceId); _debounceId = null; }
    if (_lazyIO) { try { _lazyIO.disconnect(); } catch { /* ок */ } _lazyIO = null; }
    _heightCache.clear();
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
    _imgCache.clear();
    if (typeof document !== 'undefined') {
        document.querySelectorAll(`[${SHELL_ATTR}]`).forEach(s => s.remove());
        document.querySelectorAll('.dg-gen-btn, .dg-photo-btn').forEach(b => b.remove());
    }
}
