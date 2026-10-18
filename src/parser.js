const COMMENT_RE = /<!--\s*DIEGETIC\s*([\s\S]*?)-->/g;

function tryParse(str) {
    try { return { ok: true, value: JSON.parse(str) }; } catch { return { ok: false }; }
}

/**
 * 4-уровневый repair:
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

/**
 * Извлекает html из ```html-фенса в сегменте текста (от комментария до следующего
 * комментария или конца ответа). Ленивая regex-выборка здесь не годится: содержимое
 * обрезалось бы по первой внутренней тройке бэктиков и проверка "фенс внутри"
 * никогда не срабатывала. Поэтому считаем тройки в сегменте: ровно две — валидный
 * фенс, больше двух — вложенный фенс, меньше двух — фенса нет.
 * Одна тройка с валидным языком — незакрытый фенс (модель забыла ```): контент
 * до конца сегмента восстанавливаем, ответ оплачен и терять его расточительно.
 */
function extractFence(segment) {
    const ticks = [];
    let i = segment.indexOf('```');
    while (i >= 0) {
        ticks.push(i);
        i = segment.indexOf('```', i + 3);
    }
    if (ticks.length > 2) return { error: 'fence inside' };
    if (ticks.length === 0) return { error: 'no fence after comment' };
    const nl = segment.indexOf('\n', ticks[0] + 3);
    const end = ticks.length === 2 ? ticks[1] : segment.length;
    if (nl < 0 || nl > end) return { error: 'no fence after comment' };
    if (segment.slice(ticks[0] + 3, nl).trim().toLowerCase() !== 'html') return { error: 'no fence after comment' };
    return { html: segment.slice(nl + 1, end) };
}

/**
 * Разбор ответа контракта. Возвращает
 * { artifacts: [{type, anchor, html}], errors: string[] }.
 * Контракт запрещает отказ, поэтому «мусорный» ответ — это просто errors
 * без артефактов; отдельной семантики «нет» не существует.
 * Размер артефакта не ограничен: уплаченный ответ обязан сохраняться всегда.
 * Опции: { maxCount = 5 }.
 */
export function parseDiegeticResponse(raw, { maxCount = 5 } = {}) {
    const text = String(raw ?? '');
    const errors = [];
    COMMENT_RE.lastIndex = 0;
    // Не всякий <!--DIEGETIC…--> — заголовок артефакта: модель может оставить
    // служебную пометку внутри HTML (например <!-- DIEGETIC PHOTO SLOT -->).
    // Заголовок обязан чиниться до объекта; нечитаемый текст без '{' — это
    // внутренняя пометка: ни граница сегмента, ни ошибка. Нечитаемый текст
    // со '{' — сломанная попытка заголовка: артефакта из него не будет, но
    // границей сегмента он остаётся, иначе его мусор склеивается с предыдущим
    // сегментом и валит валидный артефакт перед собой.
    const headers = [];
    for (const cm of text.matchAll(COMMENT_RE)) {
        const meta = repairJson(cm[1]);
        if (meta && typeof meta === 'object' && !Array.isArray(meta)) { headers.push({ cm, meta }); continue; }
        if (String(cm[1]).includes('{')) {
            errors.push(`bad meta JSON near index ${cm.index}`);
            headers.push({ cm, meta: null });
        }
    }
    if (headers.length === 0) {
        errors.push('no DIEGETIC comment found');
        return { artifacts: [], errors };
    }
    const artifacts = [];
    for (let hi = 0; hi < headers.length; hi++) {
        const { cm, meta } = headers[hi];
        const segStart = (cm.index ?? 0) + cm[0].length;
        const segEnd = hi + 1 < headers.length ? (headers[hi + 1].cm.index ?? text.length) : text.length;
        if (!meta) continue; // сломанный заголовок: граница есть, артефакта нет
        const fence = extractFence(text.slice(segStart, segEnd));
        if (fence.error) { errors.push(`${fence.error} near index ${cm.index}`); continue; }
        const html = String(fence.html ?? '').trim();
        if (!html) { errors.push(`artifact "${meta.type || '?'}": empty fenced block`); continue; }
        // Фрагмент без <body> (модель отдала style+div) оборачиваем: ответ оплачен,
        // а render-путь с fragment'ами справляется (withImmersiveCss допарсивает).
        const full = /<body/i.test(html) ? html : `<body>\n${html}\n</body>`;
        artifacts.push({ type: String(meta.type || 'unknown'), anchor: String(meta.anchor || ''), html: full });
    }
    // Обрезка сверх лимита — тоже «отброшено»: попадает в errors, чтобы тост
    // показывал, почему при «N артефактов» в ответе их меньше.
    const kept = artifacts.slice(0, Math.max(1, maxCount));
    if (artifacts.length > kept.length) {
        errors.push(`maxCount: ${artifacts.length - kept.length} over limit ${maxCount}`);
    }
    return { artifacts: kept, errors };
}
