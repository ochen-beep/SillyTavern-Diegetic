// tests/render-helpers.test.mjs — display-патчи и кнопки постов из render.js.
// Регрессия: min-height/height: 100vh внутри iframe (vh = высота iframe) раздувал
// рукопожатие до капа и не давал артефакту сжаться после внутреннего сворачивания —
// под ним оставалась пустая область.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeIntrinsicHeight, ensureMsgButtons, initRender, shutdownRender, withSlotControls, withImmersiveCss } from '../src/render.js';

const renderSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'render.js'), 'utf8');

test('withImmersiveCss: документ с <head> — CSP-мета и CSS сразу после <head>', () => {
    const out = withImmersiveCss('<html><head><title>t</title></head><body></body></html>');
    assert.ok(/<head><meta http-equiv="Content-Security-Policy"[^>]*><style>/.test(out));
});

test('withImmersiveCss: без <head>, но с <html> — head синтезируется с CSP', () => {
    const out = withImmersiveCss('<html lang="ru"><body>x</body></html>');
    assert.ok(/<html lang="ru"><head><meta http-equiv="Content-Security-Policy"[^>]*><style>/.test(out));
});

test('withImmersiveCss: фрагмент без html/head — CSP-мета и CSS в начало (регрессия: раньше терялся)', () => {
    const out = withImmersiveCss('<div class="scene">x</div>');
    assert.ok(out.startsWith('<meta http-equiv="Content-Security-Policy"'), 'CSP-мета первой — в синтезированном head она обязана быть');
    assert.ok(out.includes('<style>'), 'иммерсивный CSS вставлен');
    assert.ok(out.includes('<div class="scene">'), 'контент сохранён');
});

test('withImmersiveCss: CSP закрывает сеть, но оставляет inline и шрифты Google (Б17)', () => {
    const out = withImmersiveCss('<p>x</p>');
    const csp = /content="([^"]+)"/.exec(out)?.[1] ?? '';
    assert.ok(csp.includes('connect-src data: blob:'), 'fetch/XHR наружу запрещён (только data:/blob:)');
    assert.ok(csp.includes("frame-src 'none'"), 'вложенные фреймы запрещены');
    assert.ok(csp.includes("object-src 'none'"), 'плагинные объекты запрещены');
    assert.ok(csp.includes("base-uri 'none'"), 'базовая подмена URI запрещена');
    assert.ok(csp.includes("script-src 'unsafe-inline'"), 'inline-скрипты артефакта живы');
    assert.ok(csp.includes('https://fonts.googleapis.com'), 'шрифты шаблона universal.md не сломаны');
});

test('normalizeIntrinsicHeight: vh-ловушки высоты срезаются в auto', () => {
    const html = '<style>body{min-height:100vh}.stage{height:100svh}.cap{max-height:100dvh}</style>';
    const out = normalizeIntrinsicHeight(html);
    assert.ok(!/100[ sld]*vh/i.test(out));
    assert.ok(out.includes('min-height:auto'));
    assert.ok(out.includes('height:auto'));
    assert.ok(out.includes('max-height:auto'));
});

test('normalizeIntrinsicHeight: translate/ширина с vh не трогаются', () => {
    const html = '<style>a{transform:translateY(100vh)}b{width:100vh? nope}</style>';
    const out = normalizeIntrinsicHeight(html);
    assert.ok(out.includes('translateY(100vh)'), 'transform не затронут');
});

test('normalizeIntrinsicHeight: вариации регистра и пробелов', () => {
    const out = normalizeIntrinsicHeight('body{MIN-HEIGHT : 100vh}div{height:100VH}');
    assert.ok(!/100vh/i.test(out));
});

test('normalizeIntrinsicHeight: ЛЮБОЙ vh в высоте — петля (H→N%H→…), не только 100', () => {
    // 94vh/50vh схлопывали артефакт и лайтбокс до минимума («скукожило»).
    const out = normalizeIntrinsicHeight('<style>a{height:94vh}b{min-height:50vh}</style>');
    assert.ok(out.includes('height:auto') && out.includes('min-height:auto'));
});

test('normalizeIntrinsicHeight: с refH vh переводится в стабильные px', () => {
    const out = normalizeIntrinsicHeight('<style>.s{height:94vh;max-height:100svh}</style>', 700);
    assert.ok(out.includes('height:658px'), out);
    assert.ok(out.includes('max-height:700px'), out);
});

test('normalizeIntrinsicHeight: прочие размеры не страдают', () => {
    const html = '<style>b{min-height:320px}c{max-height:100%}d{width:96vw}</style>';
    assert.equal(normalizeIntrinsicHeight(html, 700), html);
});

// ── Контролы фотослотов (✎/⟳): display-патч, payload не хранит кнопок ──

const SLOT_HTML = '<body><div class="photo" data-dg-img="img: a cat" style="position:relative;height:100px"><b>ph</b></div></body>';

test('withSlotControls: слот получает ✎+⟳ с командами, стили пришиты к артефакту', () => {
    const out = withSlotControls(SLOT_HTML);
    assert.match(out, /dg-slot-edit" data-dg-cmd="slot-edit" data-ordinal="0"/);
    assert.match(out, /dg-slot-regen" data-dg-cmd="slot-regen" data-ordinal="0"/);
    assert.ok(out.includes('.dg-slot-ctl'), 'стили контролов живут внутри артефакта (sandbox-iframe)');
    assert.ok(out.indexOf('dg-slot-ctl') < out.indexOf('<b>ph</b>'), 'контролы — до плейсхолдера');
});

test('withSlotControls: loading-слот показывает ⏹ отмены вместо ⟳', () => {
    const loading = SLOT_HTML.replace('style=', 'data-dg-img-state="loading" style=');
    const out = withSlotControls(loading);
    assert.match(out, /dg-slot-cancel" data-dg-cmd="slot-cancel" data-ordinal="0"/);
    assert.ok(!out.includes('dg-slot-regen" data-dg-cmd'), '⟳ во время заливки нет');
});

test('withSlotControls: два слота — ordinal соответствует порядку', () => {
    const html = `<body>${SLOT_HTML.slice(6, -7)}<div data-dg-img="scene: night" style="position:relative"></div></body>`;
    const out = withSlotControls(html);
    assert.match(out, /data-dg-cmd="slot-edit" data-ordinal="1"/);
});

test('withSlotControls: legacy-⟳ из хранилища срезается, дублей нет', () => {
    const legacy = '<body><div data-dg-img="img: x" style="position:relative"><span class="dg-slot-regen" data-ordinal="0" title="Перегенерировать фото">⟳</span><i></i></div></body>';
    const out = withSlotControls(legacy);
    assert.ok(!/<span class="dg-slot-regen"/.test(out), 'старый зашитый ⟳ удалён');
    assert.equal(out.split('class="dg-slot-ctl dg-slot-regen"').length - 1, 1, 'ровно одна свежая ⟳');
    assert.ok(out.indexOf('dg-slot-ctl') < out.indexOf('<i></i>'));
});

test('withSlotControls: без слотов текст не меняется', () => {
    const html = '<body><p>plain</p></body>';
    assert.equal(withSlotControls(html), html);
});

// ── мини-DOM: кнопки поста (регрессия клика по устаревшему mesid) ──
function makeEl(className = '') {
    const n = {
        className, title: '', innerHTML: '', children: [], parentElement: null,
        attrs: {}, _click: null,
        setAttribute(k, v) { n.attrs[k] = String(v); },
        getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
        appendChild(c) { c.parentElement = n; n.children.push(c); },
        prepend(c) { n.children.unshift(c); c.parentElement = n; },
        remove() {
            if (n.parentElement) {
                const s = n.parentElement.children;
                const i = s.indexOf(n);
                if (i >= 0) s.splice(i, 1);
            }
            n.parentElement = null;
        },
        addEventListener(type, fn) { if (type === 'click') n._click = fn; },
        querySelector(sel) {
            const walk = (x) => {
                for (const c of x.children) {
                    if (String(c.className).split(/\s+/).includes(sel.slice(1))) return c;
                    const f = walk(c);
                    if (f) return f;
                }
                return null;
            };
            return walk(n);
        },
    };
    return n;
}

test('кнопка поста читает mesid в момент клика, а не при создании', () => {
    // Регрессия (баг-репорт): ST перенумеровывает mesid у живых DOM-узлов
    // (updateViewMessageIds после удаления/скрытия/переноса постов), замыкание
    // продолжало держать старый id — клик молча уходил в чужое сообщение
    // (у тестера — в юзерский пост), перезагрузка чата чинила.
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    const chatEl = makeEl('chat');
    chatEl.querySelectorAll = () => [];
    globalThis.document = {
        getElementById: (id) => (id === 'chat' ? chatEl : null),
        addEventListener() {}, removeEventListener() {},
        createElement: () => makeEl(),
        querySelectorAll: () => [],
        body: makeEl('body'),
    };
    globalThis.MutationObserver = class { observe() {} disconnect() {} };
    try {
        const ran = [];
        initRender({
            settings: () => ({ buttonMode: 'post', imageMode: 'off' }),
            run: (id) => ran.push(id),
            fillImageSlots: (id) => ran.push(`cam:${id}`),
            hasPending: () => false,
        });

        const mesEl = makeEl('mes');
        mesEl.setAttribute('mesid', '5');
        const btns = makeEl('mes_buttons');
        mesEl.appendChild(btns);
        const msg = { is_user: false, is_system: false, swipe_id: 0, extra: {} };

        ensureMsgButtons(mesEl, 5, msg);
        const gen = btns.querySelector('.dg-gen-btn');
        assert.ok(gen, 'кнопка ◆ создана');
        gen._click({ stopPropagation() {} });
        assert.deepEqual(ran, [5]);

        // ST сдвинул нумерацию: у того же узла теперь другой mesid — клик идёт по нему
        mesEl.setAttribute('mesid', '4');
        gen._click({ stopPropagation() {} });
        assert.deepEqual(ran, [5, 4]);
    } finally {
        shutdownRender();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.MutationObserver;
    }
});

// ── resolveMountBlock: якорь валиден по прозе, но по блокам DOM не находится ──
// Регрессия «артефакт записан, а в посте его нет»: цитата через границу абзацев
// проходит валидацию в пайплайне (нормализация схлопывает \n\n), а в рендере
// абзацы — разные узлы; locateBlock давал null и оболочка молча не монтировалась.
import { resolveMountBlock } from '../src/render.js';

const textEl = { tagName: 'DIV', textContent: 'весь пост' };
const blocks = [
    { tagName: 'P', textContent: 'Первый абзац кончается этими словами.' },
    { tagName: 'P', textContent: 'Второй абзац начинается вот так.' },
];

test('resolveMountBlock: обычный якорь — свой блок', () => {
    const art = { anchor: 'начинается вот так' };
    assert.equal(resolveMountBlock(blocks, art, textEl), blocks[1]);
});

test('resolveMountBlock: межабзацный якорь — фолбэк в конец поста, не null', () => {
    const art = { anchor: 'кончается этими словами. Второй абзац начинается' };
    assert.equal(resolveMountBlock(blocks, art, textEl), textEl);
});

test('resolveMountBlock: пустой/невалидный якорь — фолбэк в конец поста', () => {
    assert.equal(resolveMountBlock(blocks, { anchor: '  ' }, textEl), textEl);
    assert.equal(resolveMountBlock(blocks, { anchor: 'такого текста в посте нет вовсе' }, textEl), textEl);
});

test('Б1: CMD_SNIPPET слушает Esc внутри артефакта и шлёт __dgEsc родителю', () => {
    const m = renderSrc.match(/const CMD_SNIPPET = ('[\s\S]*?' \+ 'script>';)/);
    assert.ok(m, 'CMD_SNIPPET найден');
    const snippet = eval(m[1]);
    assert.ok(snippet.includes('"keydown"'), 'keydown-слушатель в сниппете');
    assert.ok(snippet.includes('__dgEsc'), 'сообщение __dgEsc уходит родителю');
    assert.ok(renderSrc.includes('__dgEsc'), 'родитель обрабатывает __dgEsc');
    assert.ok(renderSrc.includes('_returnFocus'), 'возврат фокуса после закрытия лайтбокса');
});

test('Б28: watchdog — 4 c и не более одной перезагрузки на монтаж', () => {
    assert.ok(renderSrc.includes(', 4000)'), 'порог поднят с 2.5 c');
    assert.ok(renderSrc.includes('dgReloaded'), 'флаг однократной перезагрузки');
});

test('Б34/Б18/Б38/Б2/Б3/Б14: source-ассерты фиксов волны P1', () => {
    // Ленивые iframe: плейсхолдер + IntersectionObserver + ключ с ленью
    assert.ok(renderSrc.includes('.dg-lazy'), 'плейсхолдер .dg-lazy');
    assert.ok(renderSrc.includes('IntersectionObserver'), 'ленивый обсервер');
    assert.ok(/shellKey = [^;]*lazyActive/.test(renderSrc), 'ключ оболочки учитывает лень');
    assert.ok(renderSrc.includes('_heightCache.clear()'), 'кэш высот чистится при смене чата');
    // Б18: высота применяется не чаще кадра
    assert.ok(renderSrc.includes('requestAnimationFrame'), 'rAF-троттлинг высоты');
    // Б38: orphan-метка на чипе
    assert.ok(renderSrc.includes("' ⚠'"), 'orphan-метка на чипе');
    // Б2: share-фолбэк перед a[download]
    assert.ok(renderSrc.includes('navigator.share'), 'iOS share-путь');
    // Б14: visualViewport у contain-лайтбокса
    assert.ok(/visualViewport\?\.addEventListener/.test(renderSrc), 'visualViewport-пересчёт contain');
    // Б39: reduced motion внутри артефактов
    assert.ok(renderSrc.includes('prefers-reduced-motion'), 'reduced-motion в IMMERSIVE_CSS');
});

test('Б19: fuzzy отключается на сверхдлинных текстах, exact живёт', async () => {
    const { findFuzzySpan, findAnchorInText } = await import('../src/anchor.js');
    const huge = 'слово '.repeat(60_000) + 'цельная фраза для поиска'; // > 200K символов
    assert.equal(findFuzzySpan(huge, 'целная фраза'), null, 'fuzzy заглушен бюджетом');
    assert.ok(findAnchorInText(huge, 'цельная фраза'), 'exact работает на любом объёме');
    const small = 'она взяла телефон и вышла';
    assert.ok(findFuzzySpan(small, 'взяла телифон'), 'на обычных текстах fuzzy жив');
});

test('Б34-регресс: baseKeyOfKey отрезает и старый, и ленивый хвост ключа', async () => {
    const { baseKeyOfKey } = await import('../src/render.js');
    assert.equal(baseKeyOfKey('abc12:0|deadbeef|o'), 'abc12:0|deadbeef', 'старый формат без ленивости');
    assert.equal(baseKeyOfKey('abc12:0|deadbeef|o|l'), 'abc12:0|deadbeef', 'ленивый мобильный ключ');
    assert.equal(baseKeyOfKey('abc12:0|deadbeef|c|e'), 'abc12:0|deadbeef', 'десктопный свёрнутый');
    assert.equal(baseKeyOfKey(null), '', 'мусорный вход не падает');
    // в onDocumentClick больше нет регекс-обрезки (она и ломала expand на мобиле)
    assert.ok(!renderSrc.includes('_expanded.add(String(key)') && !renderSrc.includes('_expanded.delete(String(key)'), 'обрезка идёт через baseKeyOfKey, а не регекс');
});
