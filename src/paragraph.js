/** Наш собственный вставленный блок. Детект раннера: любой fence с <body внутри (is_frontend). */
export const OWN_FENCE_RE = /```[ \t]*html[ \t]*\r?\n([\s\S]*?)```/g;

export function hasOwnBlock(text) {
    OWN_FENCE_RE.lastIndex = 0;
    return OWN_FENCE_RE.test(String(text ?? ''));
}

/** Текст без наших блоков; пустые строки по стыкам схлопываются до \n\n. */
export function stripOwnBlocks(text) {
    OWN_FENCE_RE.lastIndex = 0;
    return String(text ?? '').replace(OWN_FENCE_RE, '').replace(/\n{3,}/gu, '\n\n').trim();
}

/** Удаление наших блоков с сохранением окружения (для панели/регенерации). */
export function removeOwnBlocks(text) {
    OWN_FENCE_RE.lastIndex = 0;
    return String(text ?? '').replace(OWN_FENCE_RE, '').replace(/\n{3,}/gu, '\n\n').replace(/^\n+|\n+$/g, '');
}

/** Конец абзаца, содержащего позицию `from`: ближайший \n\n после неё, иначе конец текста. */
export function paragraphEndAfter(text, from) {
    const s = String(text ?? '');
    const idx = s.indexOf('\n\n', Math.max(0, Number(from) || 0));
    return idx === -1 ? s.length : idx;
}

/**
 * Вставить html-блоки в точки `at` одним проходом (точки сортируются по убыванию,
 * вставки в одну точку сохраняют порядок массива В ИТОГОВОМ ТЕКСТЕ (равные точки
 * обходятся в обратном порядке массива)). Возвращает
 * { text, points } или null, если наши блоки уже в тексте (идемпотентность).
 */
export function applyInsertions(text, insertions) {
    const s = String(text ?? '');
    if (!Array.isArray(insertions) || insertions.length === 0) return { text: s, points: [] };
    if (hasOwnBlock(s)) return null;
    const fenceOf = (html) => '```html\n' + String(html).trim() + '\n```';
    const sorted = insertions
        .map((ins, order) => ({ ...ins, order }))
        .sort((a, b) => (b.at - a.at) || (b.order - a.order));
    let out = s;
    for (const ins of sorted) {
        const block = '\n\n' + fenceOf(ins.html);
        out = out.slice(0, ins.at) + block + out.slice(ins.at);
    }
    return { text: out, points: sorted.map(x => x.at) };
}
