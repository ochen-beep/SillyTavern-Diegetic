// @ts-check
/** Общая политика точного матча якоря по нормализованному тексту. */

function normalizeChar(ch) {
    return ch
        .normalize('NFC')
        .replace(/[Ёё]/gu, 'е')
        .replace(/[\u2018\u2019\u201A\u201B']/gu, "'")
        .replace(/[\u201C\u201D\u201E\u201F«»"]/gu, '"')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212-]/gu, '-');
}

export function normalizeAnchorKey(value) {
    return String(value ?? '')
        .normalize('NFC')
        .trim()
        .toLowerCase()
        .replace(/ё/gu, 'е')
        .replace(/[\u2018\u2019\u201A\u201B']/gu, "'")
        .replace(/[\u201C\u201D\u201E\u201F«»"]/gu, '"')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212-]/gu, '-')
        .replace(/\s+/gu, ' ');
}

export function isWordChar(ch) {
    if (!ch) return false;
    try { return /[\p{L}\p{N}_]/u.test(ch); }
    catch { return /[A-Za-z0-9_А-Яа-яЁё]/u.test(ch); }
}

/**
 * Нормализация с учётом графем и картой позиций обратно в исходную строку.
 * Общая для плоского матчера и fuzzy-резолвера: все поверхности применяют
 * одну политику нормализации (NFC, регистр, кавычки/тире, схлопывание
 * пробелов), а общая валюта — UTF-16-спаны исходника.
 */
export function normalizedWithMap(value) {
    const source = String(value ?? '');
    const pieces = [];
    let segmenter;
    try { segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); } catch { /* старый движок */ }
    if (segmenter) {
        for (const part of segmenter.segment(source)) pieces.push({ text: part.segment, start: part.index, end: part.index + part.segment.length });
    } else {
        for (let i = 0; i < source.length; i++) pieces.push({ text: source[i], start: i, end: i + 1 });
    }

    const units = [];
    let pendingSpace = null;
    for (const part of pieces) {
        const normalized = normalizeChar(part.text).toLowerCase();
        if (/^\s+$/u.test(normalized)) {
            if (units.length && !pendingSpace) pendingSpace = part;
            continue;
        }
        if (pendingSpace) {
            units.push({ ch: ' ', start: pendingSpace.start, end: pendingSpace.end });
            pendingSpace = null;
        }
        // Астральные символы расходятся по code unit'ам — карта совпадает
        // со смещениями indexOf.
        for (const ch of normalized) {
            for (let u = 0; u < ch.length; u++) units.push({ ch: ch[u], start: part.start, end: part.end });
        }
    }
    return { source, normalized: units.map(x => x.ch).join(''), map: units };
}

/** Первый матч фразы целиком (по границам слов) в нормализованном тексте;
 *  возвращает кусок исходной строки. */
export function findAnchorInText(text, anchor, fromIndex = 0) {
    const needle = normalizeAnchorKey(anchor);
    if (!needle) return null;
    const mapped = normalizedWithMap(text);
    let pos = mapped.normalized.indexOf(needle);
    const floor = Number.isFinite(Number(fromIndex)) ? Math.max(0, Number(fromIndex)) : 0;
    while (pos >= 0) {
        const endNorm = pos + needle.length;
        const first = mapped.map[pos];
        const last = mapped.map[endNorm - 1];
        if (first && last) {
            const start = first.start;
            const end = last.end;
            if (start >= floor && !isWordChar(mapped.source[start - 1]) && !isWordChar(mapped.source[end])) {
                return { text: mapped.source.slice(start, end), start, end };
            }
        }
        pos = mapped.normalized.indexOf(needle, pos + 1);
    }
    return null;
}

export function findAllAnchorSpans(text, anchor) {
    const spans = [];
    let from = 0;
    for (;;) {
        const hit = findAnchorInText(text, anchor, from);
        if (!hit) return spans;
        spans.push(hit);
        from = hit.end > hit.start ? hit.end : hit.start + 1;
    }
}

/** Разобрать по одной непустой цели на строку, сохраняя первое написание и порядок. */
export function normalizeLineTargets(value, limit = 20) {
    const targets = [];
    const seen = new Set();
    let duplicateCount = 0;
    let truncatedCount = 0;
    for (const line of String(value ?? '').split(/\r?\n/u)) {
        const target = line.trim();
        if (!target) continue;
        const key = normalizeAnchorKey(target);
        if (seen.has(key)) { duplicateCount++; continue; }
        seen.add(key);
        if (targets.length >= limit) { truncatedCount++; continue; }
        targets.push(target);
    }
    return { targets, duplicateCount, truncatedCount };
}

/** Позиции слов в строке, схлопнутой до одинарных пробелов. */
function tokenizeWords(str) {
    const words = [];
    let i = 0;
    while (i < str.length) {
        while (i < str.length && str[i] === ' ') i++;
        if (i >= str.length) break;
        const start = i;
        while (i < str.length && str[i] !== ' ') i++;
        words.push({ start, end: i });
    }
    return words;
}

/** Расстояние Левенштейна с ранним выходом, как только превышен `cap`. */
function levenshtein(a, b, cap) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > cap) return cap + 1;
        prev = cur;
    }
    return prev[b.length];
}

/**
 * Fuzzy-поиск `anchor` в `text` с выравниванием по словам. Возвращает лучший
 * исходный спан целых слов ({text, start, end, distance}) или null. Каждое
 * слово якоря ложится ровно на одно подряд идущее слово источника; слова
 * ≤ 4 символов обязаны совпасть точно, более длинные терпят ≤ 34% правок,
 * суммарное расстояние ограничено `maxRatio` от якоря (минимум 2 — чтобы
 * выжила одна словоизменительная приставка/суффикс).
 */
export function findFuzzySpan(text, anchor, { maxRatio = 0.25, maxWords = 12 } = {}) {
    const needle = normalizeAnchorKey(anchor);
    if (needle.length < 4) return null;
    const needleWords = tokenizeWords(needle);
    if (!needleWords.length || needleWords.length > maxWords) return null;
    const totalCap = Math.max(2, Math.floor(needle.length * maxRatio));

    const mapped = normalizedWithMap(text);
    // Бюджет (Б19): скользящее окно Levenshtein по всем словам — O(позиции ×
    // слова якоря). На постах 100K+ символов это джанк главного потока при
    // каждом rebind. На сверхдлинных текстах fuzzy отключаем: exact-путь
    // (indexOf по нормализованному тексту) остаётся быстрым и непререкаемым.
    if (mapped.source.length > 200_000) return null;
    const sourceWords = tokenizeWords(mapped.normalized);
    let best = null;
    for (let p = 0; p + needleWords.length <= sourceWords.length; p++) {
        let total = 0;
        let ok = true;
        for (let i = 0; i < needleWords.length; i++) {
            const a = needle.slice(needleWords[i].start, needleWords[i].end);
            const b = mapped.normalized.slice(sourceWords[p + i].start, sourceWords[p + i].end);
            if (a === b) continue;
            const wordCap = a.length <= 4 ? 0 : Math.max(1, Math.round(a.length * 0.34));
            const wordBudget = Math.min(wordCap, totalCap - total);
            const d = levenshtein(a, b, wordBudget);
            if (d > wordBudget) { ok = false; break; }
            total += d;
        }
        if (!ok || total > totalCap) continue;
        const nStart = sourceWords[p].start;
        const nEnd = sourceWords[p + needleWords.length - 1].end;
        const first = mapped.map[nStart];
        const last = mapped.map[nEnd - 1];
        if (!first || !last) continue;
        const start = first.start;
        const end = last.end;
        if (isWordChar(mapped.source[start - 1]) || isWordChar(mapped.source[end])) continue;
        if (!best || total < best.distance) {
            best = { text: mapped.source.slice(start, end), start, end, distance: total };
        }
    }
    return best;
}
