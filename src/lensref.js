// Чистая логика линз профиля (Node-тестируемая). Сам текст универсальной линзы
// живёт в templates/universal.md и попадает в бандл через build (loader '.md' → text);
// сюда он приходит аргументом, чтобы модуль оставался тестируемым без esbuild.

/** Резолв lensText профиля: пусто или сентинел — встроенная универсальная линза. */
export function resolveLensText(lensText, universalText) {
    const t = String(lensText ?? '').trim();
    return (!t || t === '@universal') ? String(universalText ?? '') : String(lensText ?? '');
}
