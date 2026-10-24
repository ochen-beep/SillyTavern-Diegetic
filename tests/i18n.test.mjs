// tests/i18n.test.mjs — полнота локализации (по образцу DS-Comments):
// 1) tr делегирует фолбэк+ключ хостовому translate и не падает без него;
// 2) каждый ключ, использованный в коде, есть в ru-ru словаре;
// 3) в словаре нет мёртвых ключей (нигде не используется);
// 4) плейсхолдеры {x} в фолбэке совпадают с плейсхолдерами перевода.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dict from '../src/i18n/ru-ru.json' with { type: 'json' };
import { tr } from '../src/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcFiles = ['index.js', ...readdirSync(join(root, 'src')).filter(f => f.endsWith('.js')).map(f => join('src', f))];
const sources = Object.fromEntries(srcFiles.map(f => [f, readFileSync(join(root, f), 'utf8')]));
const usedKeys = new Map(); // key → fallback (для проверки плейсхолдеров)
{
    // Мини-токенизатор строковых литералов: регекс по сырому тексту ломается
    // на запятых/кавычках внутри фолбэков. Заменяем каждый '…'/"…" литерал
    // плейсхолдером §N и матчим структурный шаблон tr(§a, §b). Бэктики не
    // трогаем: вложенные template literal ломают их границы, а для поиска
    // достаточно обычных литералов.
    const strings = [];
    const placeholder = (s) => `§${strings.push(s) - 1}§`;
    const tokenize = (src) => src
        .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => placeholder(m.slice(1, -1).replace(/\\'/g, "'")));
    const CALL_RE = /(?<![.\w])tr\s*\(§(\d+)§\s*,\s*§(\d+)§\s*[,)]/g;
    for (const text of Object.values(sources)) {
        const tpl = tokenize(text);
        for (const m of tpl.matchAll(CALL_RE)) {
            usedKeys.set(strings[Number(m[2])], strings[Number(m[1])]);
        }
    }
}

beforeEach(() => {
    globalThis.SillyTavern = { getContext: () => ({ translate: undefined }) };
});
afterEach(() => { delete globalThis.SillyTavern; });

test('tr: без хостового translate возвращает английский фолбэк', () => {
    assert.equal(tr('Save', 'diegetic.panel.template.save'), 'Save');
});

test('tr: делегирует фолбэк и ключ SillyTavern translate', () => {
    const calls = [];
    globalThis.SillyTavern.getContext = () => ({ translate: (...a) => { calls.push(a); return 'Сохранить'; } });
    assert.equal(tr('Save', 'diegetic.panel.template.save'), 'Сохранить');
    assert.deepEqual(calls, [['Save', 'diegetic.panel.template.save']]);
});

test('tr: недоступный контекст/ошибка хоста не роняет вызов', () => {
    delete globalThis.SillyTavern;
    assert.equal(tr('Save', 'diegetic.panel.template.save'), 'Save');
});

test('в коде вообще используются ключи tr() — иначе тест ничего не проверяет', () => {
    assert.ok(usedKeys.size > 100, `ожидается >100 ключей, найдено ${usedKeys.size}`);
});

test('каждый ключ из кода имеет перевод в ru-ru словаре', () => {
    const missing = [...usedKeys.keys()].filter(k => !(k in dict));
    assert.deepEqual(missing, [], `ключи без перевода: ${missing.join(', ')}`);
});

test('в словаре нет мёртвых ключей', () => {
    const dead = Object.keys(dict).filter(k => !usedKeys.has(k));
    assert.deepEqual(dead, [], `переводы без использования: ${dead.join(', ')}`);
});

test('плейсхолдеры фолбэка и перевода совпадают', () => {
    const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort().join(',');
    const bad = [];
    for (const [key, fallback] of usedKeys) {
        const translation = dict[key];
        if (!translation) continue;
        if (ph(fallback) !== ph(translation)) bad.push(`${key}: код [${ph(fallback)}] vs словарь [${ph(translation)}]`);
    }
    assert.deepEqual(bad, [], bad.join('; '));
});
