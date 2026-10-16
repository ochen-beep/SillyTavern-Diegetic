// src/templates.js — именованные шаблоны в настройках расширения (форма
// DS-Comments settings-sync): { name: text } внутри extension settings —
// синк сервером, переживают перезагрузки страницы/сервера и видны во всех
// браузерах. Встроенные основы (templates/*.md) под замком: их нельзя
// перезаписать или удалить, только «сохранить как». Чистые функции над
// объектом настроек — мутации возвращают новый объект, save() у вызывающего.

export const BUILTIN_TEMPLATES = Object.freeze({
    universal: 'Универсальный',
    'universal-photo': 'Универсальный · фото',
});

export const DEFAULT_TEMPLATE = 'universal';

export const isBuiltinTemplate = (name) => Object.hasOwn(BUILTIN_TEMPLATES, name);

/** Хранилище пользовательских шаблонов настроек (всегда объект). */
export function userTemplates(settings) {
    const t = settings?.templates;
    return (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
}

/** Имена пользовательских шаблонов, отсортированные по-русски. */
export function listTemplateNames(settings) {
    return Object.keys(userTemplates(settings)).sort((a, b) => String(a).localeCompare(String(b), 'ru'));
}

/**
 * Текст шаблона по имени. Пользовательский — из хранилища (hasOwn, не
 * truthiness: пустой сохранённый шаблон должен показаться пустым, а не
 * молча подмениться встроенным). Встроенный резолвит вызывающий (fetch).
 */
export function templateContent(settings, name) {
    if (!name || isBuiltinTemplate(name)) return '';
    const all = userTemplates(settings);
    return Object.hasOwn(all, name) ? String(all[name] ?? '') : null; // null — имя висит (шаблона нет)
}

/** Перезаписать текст шаблона. Встроенные не перезаписываются → null. */
export function saveTemplate(settings, name, text) {
    if (!name || isBuiltinTemplate(name)) return null;
    return { ...settings, templates: { ...userTemplates(settings), [name]: String(text ?? '') } };
}

/** Сохранить как новое имя и сразу выбрать его (DS savePromptAs). */
export function saveTemplateAs(settings, name, text) {
    const clean = String(name ?? '').trim();
    if (!clean || isBuiltinTemplate(clean)) return null;
    return { ...saveTemplate(settings, clean, text), activeTemplate: clean };
}

/** Удалить пользовательский шаблон; активное имя улетевшее — фолбэк на встроенный. */
export function deleteTemplate(settings, name) {
    if (!name || isBuiltinTemplate(name)) return null;
    const rest = { ...userTemplates(settings) };
    delete rest[name];
    const activeTemplate = settings.activeTemplate === name ? DEFAULT_TEMPLATE : settings.activeTemplate;
    return { ...settings, templates: rest, activeTemplate };
}

/** Выбрать шаблон по имени (любое: висящее показывается в UI как «нет текста»). */
export function selectTemplate(settings, name) {
    return { ...settings, activeTemplate: String(name ?? '') || DEFAULT_TEMPLATE };
}
