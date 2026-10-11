// Тексты встроенных линз. Импортируются ТОЛЬКО бандлом (build.mjs: loader '.md' → 'text');
// Node-тесты этот модуль не импортируют.
import universal from '../templates/universal.md';
import note from '../templates/note.md';
import messenger from '../templates/messenger.md';
import polaroid from '../templates/polaroid.md';
import newspaper from '../templates/newspaper.md';
import terminal from '../templates/terminal.md';
import dossier from '../templates/dossier.md';
import grimoire from '../templates/grimoire.md';

export const UNIVERSAL_LENS = universal;

/** Галерея селективных линз для выпадаша «вставить из галереи» в панели. */
export const GALLERY = [
    { name: 'Мессенджер', text: messenger },
    { name: 'Записка', text: note },
    { name: 'Поляроид', text: polaroid },
    { name: 'Газета / статья', text: newspaper },
    { name: 'Терминал', text: terminal },
    { name: 'Досье', text: dossier },
    { name: 'Гримуар', text: grimoire },
];

