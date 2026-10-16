// tests/template-store.test.mjs — именованное хранилище шаблонов (форма
// DS-Comments): встроенные под замком, мутации иммутабельны, висячий выбор
// не падает, удаление активного откатывает на встроенный.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BUILTIN_TEMPLATES, DEFAULT_TEMPLATE, isBuiltinTemplate, userTemplates,
    listTemplateNames, templateContent, saveTemplate, saveTemplateAs,
    deleteTemplate, selectTemplate,
} from '../src/templates.js';

const base = () => ({ templates: { 'Мой': 'текст-1', 'Аскет': 'текст-2' }, activeTemplate: 'Мой' });

test('встроенные имена: universal и universal-photo под замком, дефолт — universal', () => {
    assert.deepEqual(Object.keys(BUILTIN_TEMPLATES).sort(), ['universal', 'universal-photo']);
    assert.ok(isBuiltinTemplate('universal') && isBuiltinTemplate('universal-photo'));
    assert.ok(!isBuiltinTemplate('Мой'));
    assert.equal(DEFAULT_TEMPLATE, 'universal');
});

test('userTemplates/listTemplateNames: всегда объект, имена по-русски', () => {
    assert.deepEqual(userTemplates(null), {});
    assert.deepEqual(userTemplates({ templates: 'мусор' }), {});
    assert.deepEqual(listTemplateNames(base()), ['Аскет', 'Мой']);
});

test('templateContent: hasOwn — пустой сохранённый показывается пустым, встроенный резолвит вызывающий', () => {
    const s = { templates: { 'Пустой': '' } };
    assert.equal(templateContent(s, 'Пустой'), '');
    assert.equal(templateContent(s, 'Нет'), null, 'висячее имя → null');
    assert.equal(templateContent(s, 'universal'), '', 'встроенный не из хранилища');
});

test('saveTemplate: перезапись своего, отказ на встроенном и безымянном', () => {
    const next = saveTemplate(base(), 'Мой', 'новый');
    assert.equal(next.templates['Мой'], 'новый');
    assert.equal(next.activeTemplate, 'Мой', 'мутация не трогает выбор');
    assert.equal(saveTemplate(base(), 'universal', 'хак'), null);
    assert.equal(saveTemplate(base(), '', 'хак'), null);
    const orig = base();
    saveTemplate(orig, 'Мой', 'новый');
    assert.equal(orig.templates['Мой'], 'текст-1', 'исходник не мутируется');
});

test('saveTemplateAs: новое имя + сразу выбор; встроенное имя занято', () => {
    const next = saveTemplateAs(base(), 'Свежий', 'тело');
    assert.equal(next.templates['Свежий'], 'тело');
    assert.equal(next.activeTemplate, 'Свежий');
    assert.equal(saveTemplateAs(base(), 'universal', 'хак'), null);
    assert.equal(saveTemplateAs(base(), '  ', 'хак'), null);
});

test('deleteTemplate: свой удаляется, встроенный нельзя, активный откатывается на universal', () => {
    const next = deleteTemplate(base(), 'Мой');
    assert.deepEqual(next.templates, { 'Аскет': 'текст-2' });
    assert.equal(next.activeTemplate, 'universal');
    assert.equal(deleteTemplate(base(), 'universal-photo'), null);
    const keep = deleteTemplate(base(), 'Аскет');
    assert.equal(keep.activeTemplate, 'Мой', 'удаление неактивного выбор не трогает');
});

test('selectTemplate: пустое/мусорное имя → дефолт', () => {
    assert.equal(selectTemplate(base(), 'Аскет').activeTemplate, 'Аскет');
    assert.equal(selectTemplate(base(), '').activeTemplate, 'universal');
    assert.equal(selectTemplate(base(), null).activeTemplate, 'universal');
});
