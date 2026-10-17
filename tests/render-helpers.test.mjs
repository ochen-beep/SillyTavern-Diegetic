// tests/render-helpers.test.mjs — display-патчи и кнопки постов из render.js.
// Регрессия: min-height/height: 100vh внутри iframe (vh = высота iframe) раздувал
// рукопожатие до капа и не давал артефакту сжаться после внутреннего сворачивания —
// под ним оставалась пустая область.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIntrinsicHeight, ensureMsgButtons, initRender, shutdownRender, withSlotControls, withImmersiveCss } from '../src/render.js';

test('withImmersiveCss: документ с <head> — CSS после <head>', () => {
    const out = withImmersiveCss('<html><head><title>t</title></head><body></body></html>');
    assert.ok(/<head><style>/.test(out));
});

test('withImmersiveCss: без <head>, но с <html> — head синтезируется', () => {
    const out = withImmersiveCss('<html lang="ru"><body>x</body></html>');
    assert.ok(/<html lang="ru"><head><style>/.test(out));
});

test('withImmersiveCss: фрагмент без html/head — CSS в начало (регрессия: раньше терялся)', () => {
    const out = withImmersiveCss('<div class="scene">x</div>');
    assert.ok(out.startsWith('<style>'), 'иммерсивный CSS вставлен');
    assert.ok(out.includes('<div class="scene">'), 'контент сохранён');
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

test('normalizeIntrinsicHeight: прочие размеры не страдают', () => {
    const html = '<style>a{height:50vh}b{min-height:320px}c{max-height:100%}</style>';
    assert.equal(normalizeIntrinsicHeight(html), html);
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
