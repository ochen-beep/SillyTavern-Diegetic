// src/migrate.js — одноразовая миграция legacy-формата (фенсы ```html в тексте
// сообщения) в extra-модель. Идемпотентна: флаг chatMetadata.dg.migrated.
//
// Здесь же живут strip-хелперы бывшего paragraph.js — больше они нигде не нужны:
// в нативной модели текст сообщения чист по построению.

import { getCtx, chatData, saveChatData } from './core.js';
import { persistChat } from './host.js';
import { contentDigest } from './digest.js';

const OWN_FENCE_RE = /```[ \t]*html[ \t]*\r?\n([\s\S]*?)```/g;

export function hasOwnBlock(text) {
    OWN_FENCE_RE.lastIndex = 0;
    return OWN_FENCE_RE.test(String(text ?? ''));
}

/** Текст без наших блоков; пустые строки по стыкам схлопываются до \n\n. */
export function stripOwnBlocks(text) {
    OWN_FENCE_RE.lastIndex = 0;
    return String(text ?? '').replace(OWN_FENCE_RE, '').replace(/\n{3,}/gu, '\n\n').trim();
}

const byteLength = (s) => new TextEncoder().encode(s).length;

/**
 * Извлечь legacy-фенсы из текста варианта. Якорь из текста не восстановить
 * (вставлялись в конец абзаца за якорем), поэтому запоминаем pos — индекс
 * абзаца, после которого стоял фенс; render.js ставит такие артефакты по pos.
 */
export function extractLegacyArtifacts(text) {
    const s = String(text ?? '');
    // Свой экземпляр: stripOwnBlocks внутри цикла делит OWN_FENCE_RE и сбрасывал
    // бы lastIndex под exec — вечный цикл (поймано OOM'ом теста).
    const re = new RegExp(OWN_FENCE_RE.source, 'g');
    const out = [];
    let m;
    while ((m = re.exec(s)) !== null) {
        // pos — индекс абзаца, ПОСЛЕ которого стоял фенс, в СТРИПНУТОМ тексте:
        // предыдущие фенсы исчезают из текста, их абзацы не считаем.
        const pre = stripOwnBlocks(s.slice(0, m.index));
        const pos = pre === '' ? 0 : pre.split('\n\n').length - 1;
        const html = m[1].trim();
        out.push({
            id: `migrated:${out.length}`, type: 'migrated', anchor: '', status: 'ok',
            html, pos, bytes: byteLength(html), createdAt: Date.now(), profileId: 'legacy',
        });
    }
    return out;
}

/** Старый prompt-strip regex умер вместе с fence-моделью — убрать, если остался. */
function cleanupLegacyRegex(ctx) {
    const list = ctx?.extensionSettings?.regex;
    if (!Array.isArray(list)) return;
    const next = list.filter(r => r?.script_name !== 'Diegetic prompt-strip');
    if (next.length !== list.length) {
        ctx.extensionSettings.regex = next;
        ctx.saveSettingsDebounced?.();
    }
}

/** Один проход по чату. true, если что-то мигрировано. */
export async function migrateCurrentChat() {
    const ctx = getCtx();
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || !chat.length) return false;
    const data = chatData();
    if (!data) return false;
    if (data.migrated) { cleanupLegacyRegex(ctx); return false; }

    let changed = false;
    chat.forEach((msg, i) => {
        if (!msg || typeof msg !== 'object') return;
        // updateMessageBlock — только для реально мигрированного сообщения:
        // общий changed после первого же фенса дёргал бы re-render всего хвоста чата.
        let msgChanged = false;
        const variants = Array.isArray(msg.swipes) && msg.swipes.length ? msg.swipes.length : 0;
        if (variants > 0) {
            for (let v = 0; v < variants; v++) {
                const text = String(msg.swipes[v] ?? '');
                if (!hasOwnBlock(text)) continue;
                const artifacts = extractLegacyArtifacts(text);
                const stripped = stripOwnBlocks(text);
                msg.swipes[v] = stripped;
                if (!msg.swipe_info) msg.swipe_info = [];
                if (!msg.swipe_info[v] || typeof msg.swipe_info[v] !== 'object') msg.swipe_info[v] = {};
                const slot = msg.swipe_info[v];
                if (!slot.extra || typeof slot.extra !== 'object') slot.extra = {};
                slot.extra.dg = {
                    schema: 1, contentDigest: contentDigest(stripped),
                    generatedAt: Date.now(), artifacts,
                };
                if ((msg.swipe_id ?? 0) === v) {
                    msg.mes = stripped;
                    if (!msg.extra || typeof msg.extra !== 'object') msg.extra = {};
                    msg.extra.dg = slot.extra.dg;
                }
                changed = true;
                msgChanged = true;
            }
        } else if (hasOwnBlock(msg.mes)) {
            const artifacts = extractLegacyArtifacts(msg.mes);
            const stripped = stripOwnBlocks(msg.mes);
            msg.mes = stripped;
            if (!msg.extra || typeof msg.extra !== 'object') msg.extra = {};
            msg.extra.dg = {
                schema: 1, contentDigest: contentDigest(stripped),
                generatedAt: Date.now(), artifacts,
            };
            changed = true;
            msgChanged = true;
        }
        if (msgChanged) {
            try { ctx.updateMessageBlock?.(i, msg); } catch { /* перерендер не критичен */ }
        }
    });

    cleanupLegacyRegex(ctx);
    data.migrated = true;
    saveChatData();
    if (changed) await persistChat();
    return changed;
}
