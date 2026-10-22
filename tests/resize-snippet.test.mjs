// Регрессия «мигание → пустой блок» на мобилках: fit() мерил ширину через
// rect.width, который уже содержит применённый масштаб — петля разгонала K.
// Харнесс гоняет реальный сниппет на мок-DOM, где scrollWidth честно реагирует
// на zoom, и требует сходимости K (в т.ч. после зума U=2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'render.js'), 'utf8');
const m = src.match(/const RESIZE_SNIPPET =([\s\S]*?\+\s*'script>';)/);
assert.ok(m, 'RESIZE_SNIPPET найден');
const snippet = eval(m[1]);
const body = snippet.replace(/^<script>/, '').replace(/<\/script>$/, '');

/** Мок окна/документа iframe: zoom меняет layout (scrollWidth/scrollHeight),
 *  transform — только rect. clientWidth фиксируем (колонка чата). */
function mockFrame({ clientWidth, contentW, contentH }) {
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
    };
    const bodyEl = {
        style: bodyStyle,
        // zoom применяется к layout-боксам; floor имитирует округление движка.
        get scrollWidth() { return Math.round(contentW * state.zoom); },
        get scrollHeight() { return Math.round(contentH * state.zoom); },
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
    return { win, listeners, state };
}

function runSnippet(mock) {
    new Function('window', 'document', 'parent', 'addEventListener', 'MutationObserver', 'ResizeObserver',
        body)
        .call(mock.win, mock.win, mock.win.document, mock.win.parent,
            (type, fn) => mock.win.addEventListener(type, fn), undefined, undefined);
}
const fire = (mock, type, ev = {}) => (mock.listeners[type] ?? []).forEach((fn) => fn(ev));
/** Прикладной масштаб: zoom-ветка пишет в style.zoom, transform-ветка — в style.transform. */
const applied = (mock) => {
    if (mock.state.transform) return parseFloat(mock.state.transform.replace(/^scale\(|\)$/g, ''));
    return mock.state.zoom;
};

test('fit сходится на узком фрейме и не осциллирует после зума ×2', () => {
    const mock = mockFrame({ clientWidth: 380, contentW: 680, contentH: 440 });
    runSnippet(mock);
    fire(mock, 'load'); fire(mock, 'resize'); fire(mock, 'resize'); fire(mock, 'resize');

    const fitK = applied(mock);
    assert.ok(fitK > 0.5 && fitK < 0.62, `масштаб сошёлся к ~0.56, получено ${fitK}`);
    assert.equal(mock.state.posts.at(-1).__dgH, Math.round(440 * fitK));

    // Двухпальцевый тап → U=2; итерации ResizeObserver-цикла не должны разгонять K.
    fire(mock, 'touchstart', { touches: [{}, {}] });
    fire(mock, 'touchend', { touches: [] });
    fire(mock, 'touchstart', { touches: [{}] });
    fire(mock, 'touchend', { touches: [] }); // одиночный тап — не триггер
    for (let i = 0; i < 5; i++) fire(mock, 'resize');
    const zoomed = applied(mock);
    assert.ok(zoomed > 1.05 && zoomed < 1.2, `в зуме ~K×2≈1.11, получено ${zoomed}`);
    assert.equal(mock.state.posts.at(-1).__dgH, 300); // в зуме высота = вьюпорт фрейма

    // Обратно
    fire(mock, 'touchstart', { touches: [{}, {}] });
    fire(mock, 'touchend', { touches: [] });
    for (let i = 0; i < 5; i++) fire(mock, 'resize');
    assert.ok(Math.abs(applied(mock) - fitK) < 0.01, `возврат к фиту, получено ${applied(mock)}`);
});

test('широкий фрейм — масштаб не применяется, ветка не петалит', () => {
    const mock = mockFrame({ clientWidth: 900, contentW: 680, contentH: 440 });
    runSnippet(mock);
    fire(mock, 'load');
    for (let i = 0; i < 5; i++) fire(mock, 'resize');
    assert.equal(applied(mock), 1);
    assert.equal(mock.state.posts.at(-1).__dgH, 440);
});
