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
// Высота — postMessage-рукопожатие: сниппет дописывается к srcdoc.
const RESIZE_SNIPPET = '<script>(function(){var p=function(){try{parent.postMessage({__dgH:document.documentElement.scrollHeight},"*")}catch(e){}};if(typeof ResizeObserver!=="undefined"){new ResizeObserver(p).observe(document.body)}addEventListener("load",p);p()})()</' + 'script>';
const clampH = (h) => Math.min(Math.max(40, Math.round(h) || 0), 4000);

let _observer = null;
let _debounceId = null;
let _onMessage = null;
let _onClick = null;
let _popup = null;
let _deps = null;
/** Раскрытые в expand-режиме оболочки (shellKey). Рантайм, не настройка. */
const _expanded = new Set();

const shellKey = (a) => `${a.id}|${contentDigest(a.html)}`;

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

function buildShell(artifact, key, msgId) {
    const mode = _deps?.settings?.().displayMode ?? 'inline';
    const shell = document.createElement('div');
    shell.setAttribute(SHELL_ATTR, key);
    shell.setAttribute('data-dg-msg', String(msgId));
    if (mode !== 'inline' && !_expanded.has(key)) {
        // Чип-ряд вместо артефакта (скрин HTML-Inserts): тип + Copy + Delete.
        shell.className = 'dg-shell dg-chiprow';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'dg-chip';
        open.setAttribute('data-dg-open', '');
        open.textContent = String(artifact.type || 'artifact');
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'dg-chip-action';
        copy.setAttribute('data-dg-copy', '');
        copy.textContent = '⧉ Copy HTML';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'dg-chip-action';
        del.setAttribute('data-dg-del', '');
        del.textContent = '✕ Delete';
        shell.append(open, copy, del);
        return shell;
    }
    shell.className = 'dg-shell';
    const frame = document.createElement('iframe');
    frame.className = FRAME_CLASS;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', String(artifact.type || 'artifact'));
    frame.srcdoc = String(artifact.html) + RESIZE_SNIPPET;
    shell.appendChild(frame);
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
    _popup?.remove();
    _popup = null;
}

function openPopup(artifact) {
    closePopup();
    const overlay = document.createElement('div');
    overlay.className = 'dg-popup';
    overlay.innerHTML = `<div class="dg-popup-backdrop" data-dg-close></div><section class="dg-popup-dialog" role="dialog" aria-modal="true"><header><strong>${escAttr(artifact.type || 'artifact')}</strong><button type="button" class="dg-popup-close" data-dg-close aria-label="Закрыть">×</button></header></section>`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = String(artifact.html);
    overlay.querySelector('.dg-popup-dialog').appendChild(frame);
    overlay.addEventListener('click', (e) => { if (e.target.closest('[data-dg-close]')) closePopup(); });
    document.body.appendChild(overlay);
    _popup = overlay;
}

function onKeydown(e) {
    if (e.key === 'Escape') closePopup();
}

/** Кнопки поста в .mes_buttons (форма Glosses): ◆ генерация/реген, 📷 фотослоты. */
function ensureMsgButtons(mesEl, msgId, msg) {
    const btns = mesEl.querySelector('.mes_buttons');
    if (!btns || !msg || msg.is_user || msg.is_system) return;
    const hasPayload = !!readRawPayload(msg, msg.swipe_id ?? 0);
    let gen = btns.querySelector('.dg-gen-btn');
    if (!gen) {
        gen = document.createElement('div');
        gen.className = 'mes_button dg-gen-btn';
        gen.innerHTML = '<i class="fa-solid fa-scroll"></i>';
        gen.addEventListener('click', (e) => { e.stopPropagation(); _deps?.run?.(msgId); });
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
        cam.addEventListener('click', (e) => { e.stopPropagation(); _deps?.fillImageSlots?.(msgId); });
        gen.after(cam);
    } else if (!wantCam && cam) {
        cam.remove();
    }
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
        try { reconcileMes(mesEl); } catch { /* один пост не роняет проход */ }
    }
}

export function reconcileMessage(msgId) {
    reconcile({ only: new Set([Number(msgId)]) });
}

/** Все внутри-сообщенийные клики: чипы (open/copy/delete) и ⟳ фотослота. */
function onDocumentClick(e) {
    const chipShell = e.target.closest?.(`[${SHELL_ATTR}]`);
    if (chipShell) {
        const msgId = Number(chipShell.getAttribute('data-dg-msg'));
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
        if (e.target.closest('[data-dg-open]')) {
            const mode = _deps?.settings?.().displayMode ?? 'inline';
            if (mode === 'popup') {
                const a = artifactByKey(msgId, key);
                if (a) openPopup(a);
            } else {
                _expanded.add(key);
                reconcileMessage(msgId);
            }
            return;
        }
    }
    // ⟳ на заполненном фотослоте внутри артефакта — точечная перегенерация.
    const regen = e.target.closest?.('.dg-slot-regen');
    if (regen) {
        e.preventDefault();
        e.stopPropagation();
        const msgId = Number(regen.closest('.mes')?.getAttribute('mesid'));
        const ordinal = Number(regen.getAttribute('data-ordinal'));
        const shellKeyAttr = regen.closest(`[${SHELL_ATTR}]`)?.getAttribute(SHELL_ATTR) || '';
        const artifactId = shellKeyAttr.split('|')[0] || null;
        const cardId = regen.closest('[data-dg-img]')?.querySelector('img.dg-slot-img')?.getAttribute('data-dg-card') || null;
        if (Number.isFinite(msgId) && Number.isFinite(ordinal)) _deps?.regenSlot?.(msgId, artifactId, ordinal, cardId);
    }
}

export function initRender(deps = {}) {
    if (typeof window === 'undefined') return;
    _deps = deps;
    if (!_onMessage) {
        _onMessage = (e) => {
            const h = e?.data?.__dgH;
            if (typeof h !== 'number') return;
            for (const f of document.querySelectorAll(`iframe.${FRAME_CLASS}`)) {
                if (f.contentWindow === e.source) { f.style.height = `${clampH(h)}px`; break; }
            }
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
    _expanded.clear();
    if (typeof document !== 'undefined') {
        document.querySelectorAll(`[${SHELL_ATTR}]`).forEach(s => s.remove());
        document.querySelectorAll('.dg-gen-btn, .dg-photo-btn').forEach(b => b.remove());
    }
}
