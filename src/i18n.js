// Словарь расширения регистрируется хостом через manifest ("i18n": {"ru-ru": "src/i18n/ru-ru.json"}), строки в коде —
// английские фолбэки с ключом diegetic.*, перевод идёт через ctx.translate.
// Параметры подставляются после перевода: tr('Profile {name}', k).replace('{name}', …).
// Файл говорит только «как»; словарь — src/i18n/ru-ru.json.

import { getCtx } from './core.js';

/** Перевод строки UI: фолбэк — английский текст прямо в коде. */
export function tr(fallback, key) {
    try {
        const translated = getCtx()?.translate?.(fallback, key);
        return translated === undefined || translated === null ? fallback : String(translated);
    } catch {
        return fallback;
    }
}
