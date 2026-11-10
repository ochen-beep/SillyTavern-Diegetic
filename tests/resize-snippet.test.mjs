// Регрессии RESIZE_SNIPPET на мок-DOM:
// 1) fit по ширине не петалит ни на одной модели движка;
// 2) «пруд»: scrollWidth не реагирует на zoom — K не схлопывается;
// 3) contain от лайтбокса: сцена влезает и в ширину, и в высоту бокса.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'render.js'), 'utf8');
const m = src.match(/const RESIZE_SNIPPET =([\s\S]*?\+\s*'script>';)/);
assert.ok(m, 'RESIZE_SNIPPET найден');
const snippet = eval(m[1]);
// Plain slices instead of a tag-stripping regexp (CodeQL flags tag-filter
// regexps as sanitizer-shaped): the wrapper is our own constant.
const body = snippet.slice('<script>'.length, snippet.length - '</script>'.length);

/** Мок окна/документа iframe: zoom меняет layout (scrollWidth/scrollHeight),
 *  transform — только rect. clientWidth фиксируем (колонка чата). */
function mockFrame({ clientWidth, contentW, contentH, zoomAffectsScroll = true }) {
    const listeners = {};
    const state = { zoom: 1, transform: '', posts: [] };
    const docEl = {
        style: {},
        clientWidth,
        clientHeight: 300,
        scrollHeight: contentH,
    };
    // style с настоящими accessors: запись style.zoom/transform меняет «layout»
    // (в реальном движке именно так — через это замыкается контур fit→apply).
    const bodyStyle = {
        set zoom(v) { state.zoom = v === '' ? 1 : parseFloat(v); },
        get zoom() { return state.zoom === 1 ? '' : String(state.zoom); },
        set transform(v) { state.transform = v; },
        get transform() { return state.transform; },
        transformOrigin: '',
        width: '',
    };
    const bodyEl = {
        style: bodyStyle,
        // zoomAffectsScroll=true: zoom меняет layout-боксы (Chromium-стандарт).
        // false — как на «пруде»: scrollWidth остаётся натуральным под zoom.
        get scrollWidth() { return Math.round(contentW * (zoomAffectsScroll ? state.zoom : 1)); },
        get scrollHeight() { return Math.round(contentH * (zoomAffectsScroll ? state.zoom : 1)); },
        getBoundingClientRect() {
            const t = state.transform ? parseFloat(state.transform.replace(/^scale\(|\)$/g, '')) : state.zoom;
            return { width: contentW * t, height: contentH * t };
        },
    };
    const doc = {
        documentElement: docEl,
        body: bodyEl,
        head: { appendChild() {} },
        getElementById: () => null,
        createElement: () => ({ id: '', textContent: '' }),
        querySelectorAll: () => [],
    };
    const win = {
        innerWidth: clientWidth,
        document: doc,
        parent: { postMessage: (d) => state.posts.push(d) },
        addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    };
    return { win, listeners, state, frameBodyStyle: () => bodyStyle };
}

function runSnippet(mock) {
    new Function('window', 'document', 'parent', 'addEventListener', 'MutationObserver', 'ResizeObserver',
        body)
        .call(mock.win, mock.win, mock.win.document, mock.win.parent,
            (type, fn) => mock.win.addEventListener(type, fn), undefined, undefined);
}

/** Вариант с настоящими стабами наблюдателей: сниппет получает классы,
 *  тест — ссылки на их колбэки (мутационный шторм из артефакта). */
function runSnippetObserved(mock) {
    const observers = { ro: [], mo: [] };
    class RO { constructor(cb) { observers.ro.push(cb); } observe() {} }
    class MO { constructor(cb) { observers.mo.push(cb); } observe() {} }
    new Function('window', 'document', 'parent', 'addEventListener', 'MutationObserver', 'ResizeObserver',
        body)
        .call(mock.win, mock.win, mock.win.document, mock.win.parent,
            (type, fn) => mock.win.addEventListener(type, fn), MO, RO);
    return observers;
}
const flush = (ms) => new Promise((r) => setTimeout(r, ms));
const fire = (mock, type, ev = {}) => (mock.listeners[type] ?? []).forEach((fn) => fn(ev));
/** Прикладной масштаб: zoom-ветка пишет в style.zoom, transform-ветка — в style.transform. */
const applied = (mock) => {
    if (mock.state.transform) return parseFloat(mock.state.transform.replace(/^scale\(|\)$/g, ''));
    return mock.state.zoom;
};

test('fit сходится на узком фрейме и держится на ресайзах', () => {
    const mock = mockFrame({ clientWidth: 380, contentW: 680, contentH: 440 });
    runSnippet(mock);
    fire(mock, 'load');
    for (let i = 0; i < 5; i++) fire(mock, 'resize');
    const k = applied(mock);
    assert.ok(k > 0.5 && k < 0.62, `масштаб сошёлся к ~0.56, получено ${k}`);
    assert.equal(mock.state.posts.at(-1).__dgH, Math.round(440 * k));
});

test('широкий фрейм — масштаб не применяется, ветка не петалит', () => {
    const mock = mockFrame({ clientWidth: 900, contentW: 680, contentH: 440 });
    runSnippet(mock);
    fire(mock, 'load');
    for (let i = 0; i < 5; i++) fire(mock, 'resize');
    assert.equal(applied(mock), 1);
    assert.equal(mock.state.posts.at(-1).__dgH, 440);
});

test('пруд-регрессия: scrollWidth не реагирует на zoom — K НЕ схлопывается', () => {
    // На canvas-артефакте деление scrollWidth/K дважды учитывало масштаб,
    // K экспоненциально уходил к нулю — артефакт мигал и исчезал.
    const mock = mockFrame({ clientWidth: 390, contentW: 660, contentH: 450, zoomAffectsScroll: false });
    runSnippet(mock);
    fire(mock, 'load');
    for (let i = 0; i < 12; i++) fire(mock, 'resize'); // гоняем петлю
    const k = applied(mock);
    assert.ok(k > 0.55 && k < 0.63, `K сошёлся к ~0.59 и держится, получено ${k}`);
});

test('contain: лайтбоксный бокс ужимает сцену и по ширине, и по высоте', () => {
    const mock = mockFrame({ clientWidth: 380, contentW: 680, contentH: 440 });
    runSnippet(mock);
    fire(mock, 'load');
    // Лайтбокс: бокс 380×200 — высота жёстче (440 > 200) → k = 200/440 ≈ 0.4545.
    fire(mock, 'message', { data: { __dgContain: { w: 380, h: 200 } } });
    for (let i = 0; i < 4; i++) fire(mock, 'resize');
    const k = applied(mock);
    assert.ok(Math.abs(k - 200 / 440) < 0.01, `contain по высоте ~0.4545, получено ${k}`);
    // Отчёт о высоте не выше бокса: вся сцена видима, края не обрезаны.
    assert.ok(mock.state.posts.at(-1).__dgH <= 200, `высота ${mock.state.posts.at(-1).__dgH} влезает в 200`);
    // Бокс ушёл (закрыли лайтбокс / новый размер) → возврат к фиту по ширине.
    fire(mock, 'message', { data: { __dgContain: { w: 380, h: 0 } } });
    for (let i = 0; i < 3; i++) fire(mock, 'resize');
    assert.ok(Math.abs(applied(mock) - 380 / 680) < 0.01, `обратно к фиту по ширине, получено ${applied(mock)}`);
});

test('шторм мутаций: гейт по высоте и коалесинг в окно 150 мс', async () => {
    const mock = mockFrame({ clientWidth: 380, contentW: 680, contentH: 440 });
    const obs = runSnippetObserved(mock);
    fire(mock, 'load');
    const base = mock.state.posts.length;
    // 60 «кадров» самоанимации с НЕизменной высотой: гейт — ни одного поста
    for (let i = 0; i < 60; i++) obs.mo[0]([], mock.win.document);
    await flush(250);
    assert.equal(mock.state.posts.length, base, 'неизменная высота — постов нет');

    // высота реально меняется на каждом «кадре»: 20 мутаций подряд быстрее окна
    // коалирования → максимум один пост (плюс возможный хвост первого окна)
    const body = mock.win.document.body;
    let h2 = 440;
    Object.defineProperty(body, 'scrollHeight', { get: () => h2, configurable: true });
    Object.defineProperty(body, 'getBoundingClientRect', { value: () => ({ width: 680, height: h2 }), configurable: true });
    for (let i = 0; i < 20; i++) { h2 += 10; obs.mo[0]([], mock.win.document); }
    await flush(250);
    const grew = mock.state.posts.length - base;
    assert.ok(grew >= 1 && grew <= 2, `20 растущих мутаций → ${grew} пост(ов), ожидалось 1-2`);
});
