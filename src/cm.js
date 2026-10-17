// Чистая логика источника «профиль Connection Manager»: профили из настроек
// расширения connection-manager, генерация через ConnectionManagerRequestService.
// Хост-обвязка — в host.js.

/**
 * Нормализация списка CM-профилей до [{ id, name }]. Профиль без id и без name
 * пропускается: у него нет стабильного хэндла, CM не смог бы направить запрос.
 */
export function normalizeCmProfiles(list) {
    if (!Array.isArray(list)) return [];
    return list
        .filter(p => p && typeof p === 'object' && (p.id || p.name))
        .map(p => ({ id: String(p.id || p.name), name: String(p.name || p.id) }));
}

/** Сообщения для sendRequest: контракт+шаблон — system, контекст и пост — user. */
export function buildCmMessages({ system, user }) {
    return [
        { role: 'system', content: String(system ?? '') },
        { role: 'user', content: String(user ?? '') },
    ];
}

/**
 * Извлечение текста из ответа sendRequest (extractData: true). Поддержка форм:
 * строка; массив content-блоков [{type:'text',text}]; {content}; {choices[].message.content};
 * {candidates[].content.parts[]}; {text}; {message|message.content}. Не похоже на текст — null.
 */
export function extractCmText(resp) {
    if (resp === null || resp === undefined) return null;
    if (typeof resp === 'string') return resp;
    if (Array.isArray(resp)) {
        const texts = resp.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text);
        return texts.length > 0 ? texts.join('\n') : null;
    }
    if (typeof resp !== 'object') return null;
    if (Array.isArray(resp.content)) {
        const texts = resp.content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text);
        if (texts.length > 0) return texts.join('\n');
    } else if (typeof resp.content === 'string') {
        return resp.content;
    }
    const choice = resp.choices?.[0]?.message?.content;
    if (typeof choice === 'string') return choice;
    const parts = resp.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
        const texts = parts.filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text);
        if (texts.length > 0) return texts.join('');
    }
    if (typeof resp.text === 'string') return resp.text;
    if (typeof resp.message === 'string') return resp.message;
    if (typeof resp.message?.content === 'string') return resp.message.content;
    return null;
}

/** Разбор ошибки sendRequest: CM заворачивает причины в e.cause — достаём человекочитаемое. */
export function cmErrorMessage(e) {
    const cause = e?.cause?.message || e?.cause;
    return String(typeof cause === 'string' ? cause : (cause || e?.message || e));
}
