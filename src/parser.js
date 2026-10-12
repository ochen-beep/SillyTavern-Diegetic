const COMMENT_RE = /<!--\s*DIEGETIC\s*([\s\S]*?)-->/g;

function tryParse(str) {
    try { return { ok: true, value: JSON.parse(str) }; } catch { return { ok: false }; }
}

/**
 * 4-уровневый repair (идея — Glosses/src/parser.js, схема проще):
 * 1) JSON.parse как есть; 2) сбалансированный {...} внутри текста;
 * 3) умные кавычки + хвостовые запятые; 4) regex-достаём type/anchor.
 * Возвращает объект или null.
 */
export function repairJson(raw) {
    const s = String(raw ?? '').trim();
    const direct = tryParse(s);
    if (direct.ok) return direct.value;
    const start = s.indexOf('{');
    if (start >= 0) {
        let from = start;
        while (from >= 0) {
            let depth = 0, inStr = false, esc = false, end = -1;
            for (let i = from; i < s.length; i++) {
                const ch = s[i];
                if (esc) { esc = false; continue; }
                if (ch === '\\') { esc = true; continue; }
                if (ch === '"') inStr = !inStr;
                if (inStr) continue;
                if (ch === '{') depth++;
                else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
            }
            if (end === -1) break;
            const slice = tryParse(s.slice(from, end + 1));
            if (slice.ok) return slice.value;
            from = s.indexOf('{', end + 1);
        }
    }
    const cleaned = s
        .replace(/[\u00AB\u00BB\u201C\u201D\u201E]/gu, '"')
        .replace(/[\u2018\u2019]/gu, "'")
        .replace(/,\s*([}\]])/gu, '$1');
    const c2 = tryParse(cleaned);
    if (c2.ok) return c2.value;
    const type = (s.match(/["']?type["']?\s*[:=]\s*["']([^"']*)["']/i) || [])[1];
    if (type !== undefined) {
        return {
            type,
            // (?:[},]|$): значение anchor в конце строки не имеет хвостового разделителя
            anchor: (s.match(/["']?anchor["']?\s*[:=]\s*["']([\s\S]*?)["']\s*(?:[},]|$)/i) || [])[1] || '',
        };
    }
    return null;
}

function byteLength(str) {
    return new TextEncoder().encode(str).length;
}

/**
 * Извлекает html из ```html-фенса в сегменте текста (от комментария до следующего
 * комментария или конца ответа). Ленивая regex-выборка здесь не годится: содержимое
 * обрезалось бы по первой внутренней тройке бэктиков и проверка "фенс внутри"
 * никогда не срабатывала. Поэтому считаем тройки в сегменте: ровно две — валидный
 * фенс, больше двух — вложенный фенс, меньше двух — фенса нет.
 */
function extractFence(segment) {
    const ticks = [];
    let i = segment.indexOf('```');
    while (i >= 0) {
        ticks.push(i);
        i = segment.indexOf('```', i + 3);
    }
    if (ticks.length > 2) return { error: 'fence inside' };
    if (ticks.length < 2) return { error: 'no fence after comment' };
    const nl = segment.indexOf('\n', ticks[0] + 3);
    if (nl < 0 || nl > ticks[1]) return { error: 'no fence after comment' };
    if (segment.slice(ticks[0] + 3, nl).trim() !== 'html') return { error: 'no fence after comment' };
    return { html: segment.slice(nl + 1, ticks[1]) };
}

/**
 * Разбор ответа контракта. Возвращает
 * { artifacts: [{type, anchor, html}], errors: string[] }.
 * Контракт запрещает отказ, поэтому «мусорный» ответ — это просто errors
 * без артефактов; отдельной семантики «нет» не существует.
 * Опции: { maxBytes = 32768, maxCount = 5 }.
 */
export function parseDiegeticResponse(raw, { maxBytes = 32768, maxCount = 5 } = {}) {
    const text = String(raw ?? '');
    const errors = [];
    COMMENT_RE.lastIndex = 0;
    const comments = [...text.matchAll(COMMENT_RE)];
    if (comments.length === 0) {
        errors.push('no DIEGETIC comment found');
        return { artifacts: [], errors };
    }
    const artifacts = [];
    for (let ci = 0; ci < comments.length; ci++) {
        const cm = comments[ci];
        const meta = repairJson(cm[1]);
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) { errors.push(`bad meta JSON near index ${cm.index}`); continue; }
        const segStart = (cm.index ?? 0) + cm[0].length;
        const segEnd = ci + 1 < comments.length ? (comments[ci + 1].index ?? text.length) : text.length;
        const fence = extractFence(text.slice(segStart, segEnd));
        if (fence.error) { errors.push(`${fence.error} near index ${cm.index}`); continue; }
        const html = String(fence.html ?? '').trim();
        if (!/<body/i.test(html)) { errors.push(`artifact "${meta.type || '?'}": no <body>`); continue; }
        if (byteLength(html) > maxBytes) { errors.push(`artifact "${meta.type || '?'}": ${byteLength(html)} bytes > maxBytes`); continue; }
        artifacts.push({ type: String(meta.type || 'unknown'), anchor: String(meta.anchor || ''), html });
    }
    const kept = artifacts.slice(0, Math.max(1, maxCount));
    return { artifacts: kept, errors };
}
