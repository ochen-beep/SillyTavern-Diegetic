// tests/ui-launcher.test.mjs — жизненный цикл кнопки лаунчера (ensureLauncher).
// Регрессия: QR-бар не существовал/пересобрался — кнопка не выживала.
// ui.js трогает document/MutationObserver только внутри функций, поэтому глобальный
// стаб подставляется до динамического импорта модуля.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── мини-DOM ──
let created = new Set(); // все узлы (getElementById находит только присоединённые — как в DOM)
let observers = [];      // MutationObserver-стабы
let docq = {};           // карта document.querySelector('#селектор' → узел)
let body;

function makeNode(id = '') {
    const n = {
        id, className: '', title: '', innerHTML: '', parentElement: null,
        children: [], _click: null, _q: null, style: {}, attrs: {},
        setAttribute(k, v) { n.attrs[k] = String(v); },
        getAttribute(k) { return n.attrs?.[k] ?? null; },
        appendChild(c) { c.parentElement = n; n.children.push(c); created.add(c); },
        remove() {
            if (n.parentElement) {
                const sibs = n.parentElement.children;
                const i = sibs.indexOf(n);
                if (i >= 0) sibs.splice(i, 1);
            }
            n.parentElement = null;
        },
        addEventListener(type, fn) { if (type === 'click') n._click = fn; },
        querySelector(sel) { return n._q?.[sel] ?? null; },
    };
    created.add(n);
    return n;
}

/** Уничтожить поддерево, как это делает реальный DOM при пересборке контейнера:
 *  узлы исчезают из документа, querySelector по ним больше не находит. */
function destroySubtree(n) {
    const dead = new Set();
    const walk = (x) => { dead.add(x); for (const c of [...x.children]) walk(c); };
    walk(n);
    n.remove();
    for (const d of dead) created.delete(d);
    for (const k of Object.keys(docq)) if (dead.has(docq[k])) delete docq[k];
}

function attachQrBar(buttonsHost = true) {
    const bar = makeNode('qr--bar');
    const host = makeNode('qr--buttons');
    if (buttonsHost) {
        bar.appendChild(host);
        bar._q = { '.qr--buttons': host };
    }
    docq['#send_form #qr--bar'] = bar;
    return buttonsHost ? host : bar;
}

globalThis.document = {
    body: null, documentElement: null,
    createElement: () => makeNode(),
    getElementById(id) {
        if (id === 'send_form') return docq['#send_form'] ?? null;
        for (const n of created) if (n.id === id && (n.parentElement || n === globalThis.document.body)) return n;
        return null;
    },
    querySelector(sel) { return docq[sel] ?? null; },
};
globalThis.MutationObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
};

const { ensureLauncher, clampFabPosition } = await import('../src/ui.js');

const byId = (id) => globalThis.document.getElementById(id);
const fire = (mo) => mo.cb([], () => {});

/** Сброс стаба и module-state ui.js (кнопки + наблюдатель) перед каждым тестом. */
function resetDom() {
    ensureLauncher('post', () => {}); // снять то, что оставил прошлый тест в модуле
    created = new Set();
    observers = [];
    docq = {};
    body = makeNode('body');
    globalThis.document.body = body;
    globalThis.document.documentElement = makeNode('html');
}

test('bar: хоста ещё нет — наблюдатель вооружён, кнопка создаётся, когда бар появился', () => {
    resetDom();
    docq['#send_form'] = makeNode('send_form');
    const clicks = [];
    ensureLauncher('bar', () => clicks.push(1));
    assert.equal(byId('dg-launcher-bar'), null, 'кнопки нет — бара не было');
    assert.equal(observers.length, 1, 'наблюдатель вооружён даже без хоста');

    const host = attachQrBar();
    fire(observers[0]);
    const btn = byId('dg-launcher-bar');
    assert.ok(btn, 'кнопка создана по появлению бара');
    assert.equal(btn.parentElement, host);
    btn._click({ preventDefault() {}, stopPropagation() {} });
    assert.equal(clicks.length, 1);
});

test('bar: пересборка QR-бара уничтожила кнопку — наблюдатель пересоздаёт её в новом контейнере', () => {
    resetDom();
    docq['#send_form'] = makeNode('send_form');
    const host1 = attachQrBar();
    ensureLauncher('bar', () => {});
    fire(observers[0]);
    const oldBtn = byId('dg-launcher-bar');
    assert.equal(oldBtn.parentElement, host1);

    destroySubtree(docq['#send_form #qr--bar']); // QR выкинул старый контейнер вместе с кнопкой
    assert.equal(byId('dg-launcher-bar'), null);
    const host2 = attachQrBar();                 // и нарисовал новый
    fire(observers[0]);

    const btn = byId('dg-launcher-bar');
    assert.ok(btn, 'кнопка пересоздана');
    assert.notEqual(btn, oldBtn);
    assert.equal(btn.parentElement, host2);
});

test('bar: кнопка переехала из корня бара в появившийся .qr--buttons', () => {
    resetDom();
    docq['#send_form'] = makeNode('send_form');
    const barRoot = attachQrBar(false); // бара нет .qr--buttons — фолбэк на корень
    ensureLauncher('bar', () => {});
    fire(observers[0]);
    assert.equal(byId('dg-launcher-bar').parentElement, barRoot);

    const host = makeNode('qr--buttons');
    barRoot.appendChild(host);
    barRoot._q = { '.qr--buttons': host };
    fire(observers[0]);
    assert.equal(byId('dg-launcher-bar').parentElement, host, 'перецеплена в .qr--buttons');
});

test('bar: хост пропал — осиротевшая кнопка не висит в документе', () => {
    resetDom();
    docq['#send_form'] = makeNode('send_form');
    attachQrBar();
    ensureLauncher('bar', () => {});
    fire(observers[0]);
    assert.ok(byId('dg-launcher-bar'));

    destroySubtree(docq['#send_form #qr--bar']); // QR-бар выключили/пересобрали без нового
    fire(observers[0]);
    assert.equal(byId('dg-launcher-bar'), null, 'кнопки в документе нет');
});

test('floating: FAB на body, кнопка бара снята, наблюдатель отключён', () => {
    resetDom();
    docq['#send_form'] = makeNode('send_form');
    attachQrBar();
    ensureLauncher('bar', () => {});
    fire(observers[0]);
    const mo = observers[0];

    ensureLauncher('floating', () => {});
    assert.equal(byId('dg-launcher-bar'), null);
    assert.ok(byId('dg-launcher-fab'));
    assert.equal(byId('dg-launcher-fab').parentElement, body);
    assert.equal(mo.disconnected, true);
});

// ── FAB: позиция (restore из localStorage, клэмп) ──

const storageStub = () => {
    const store = new Map();
    return {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
    };
};

test('floating: сохранённая позиция восстанавливается на mounts', () => {
    resetDom();
    globalThis.localStorage = storageStub();
    try {
        globalThis.localStorage.setItem('diegetic_fab_position', JSON.stringify({ left: 100, top: 200 }));
        ensureLauncher('floating', () => {});
        const fab = byId('dg-launcher-fab');
        assert.equal(fab.style.left, '100px');
        assert.equal(fab.style.top, '200px');
        assert.equal(fab.style.right, 'auto');
    } finally { delete globalThis.localStorage; }
});

test('floating: улетевшая сохранённая позиция → дефолтный угол (вьюпорт-фолбэк 1024×768)', () => {
    resetDom();
    globalThis.localStorage = storageStub();
    try {
        globalThis.localStorage.setItem('diegetic_fab_position', JSON.stringify({ left: 5000, top: 5000 }));
        ensureLauncher('floating', () => {});
        const fab = byId('dg-launcher-fab');
        assert.equal(fab.style.left, '966px', '1024 − 38 − 20');
        assert.equal(fab.style.top, '646px', '768 − 38 − 84');
    } finally { delete globalThis.localStorage; }
});

test('clampFabPosition: клэмп в вьюпорт и под верхнюю панель ST', () => {
    const vp = { width: 800, height: 600 };
    assert.deepEqual(clampFabPosition({ left: -50, top: 9999 }, vp, 38), { left: 0, top: 562 });
    const inset = clampFabPosition({ left: 10, top: 5 }, vp, 38, 60);
    assert.equal(inset.top, 60, 'не выше top-бара');
});

test('post: обе кнопки сняты, вооружённый наблюдатель отключён', () => {
    resetDom();
    docq['#send_form'] = makeNode('send_form');
    attachQrBar();
    ensureLauncher('bar', () => {});
    fire(observers[0]);
    body.appendChild(makeNode('dg-launcher-fab'));

    ensureLauncher('post', () => {});
    assert.equal(byId('dg-launcher-bar'), null);
    assert.equal(byId('dg-launcher-fab'), null);
    assert.equal(observers[0].disconnected, true);
});
