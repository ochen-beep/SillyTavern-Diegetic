// index.js — точка входа нативного расширения Diegetic.
// Тонкий оркестратор (форма Glosses/index.js): manifest-хуки + порядок init +
// полный cleanup. Вся логика — в src/.
//
// Хуки (manifest.json): activate → init (загрузка страницы), enable → init,
// disable → cleanup, clean → cleanup + стереть данные расширения.

import { loadSettings, saveSettings } from './src/settings.js';
import {
    getCtx, settingsStorage, getBuiltinTemplate, chatData, saveChatData,
    setApiKey, getApiKey,
} from './src/core.js';
import {
    BUILTIN_TEMPLATES, isBuiltinTemplate, userTemplates, listTemplateNames,
    templateContent, saveTemplate, saveTemplateAs, deleteTemplate,
    selectTemplate, DEFAULT_TEMPLATE,
} from './src/templates.js';
import { getChat, getMessage, listCmProfiles, persistChat, generateText } from './src/host.js';
import { createPipeline, isExcluded } from './src/pipeline.js';
import { createGenerationCoordinator } from './src/coordinator.js';
import { createInitializationController } from './src/lifecycle.js';
import { mountPanel, unmountUi, collectRows } from './src/ui.js';
import { initRender, shutdownRender, reconcile, reconcileMessage, setGenerating, deleteArtifact, clearImageCache, openArtifactPopup, saveArtifactById } from './src/render.js';
import { migrateCurrentChat, migrateSendDateKeys } from './src/migrate.js';
import { loadStore, migrateExtraToStore, deleteStoreFile } from './src/store.js';
import { variantText, PAYLOAD_KEY, dgMessageId } from './src/payload.js';
import { urisStatus } from './src/images.js';
import { collectContext } from './src/context.js';
import { stripReasoning } from './src/contract.js';
import { classifyEndpoint, isOriginAllowed, addToAllowList } from './src/endpoint-policy.js';

const log = (...a) => console.log('[Diegetic]', ...a);
const warn = (...a) => console.warn('[Diegetic]', ...a);

let settings = null;
let coordinator = null;
let pipeline = null;
let panelApi = null;
/** @type {Array<[string, Function]>} карта подписок для cleanup */
let boundEvents = [];

const save = () => { saveSettings(settingsStorage, settings); };

async function getContextBlock(messageId, depth) {
    const ctx = getCtx();
    const chat = getChat();
    // Форма DS-Comments: история чата — отдельный тумблер, глубина задаётся числом.
    const from = settings.ctxHistory ? Math.max(0, Number(messageId) - depth) : Number(messageId);
    const to = Number(messageId) - 1;
    const lines = [];
    for (let i = from; i <= to; i++) {
        const m = chat[i];
        if (!m) continue;
        // Проза — это и есть весь текст: артефакты в тексте не живут (extra).
        // Reasoning RP-модели в mes не нужен контексту артефакта — только шум.
        lines.push(`${m.is_user ? (m.name || ctx?.name1 || 'Пользователь') : (m.name || ctx?.name2 || 'ИИ')}: ${stripReasoning(String(m.mes ?? '')).slice(0, 400)}`);
    }
    return collectContext(ctx, {
        persona: settings.ctxPersona,
        character: settings.ctxCharacter,
        world: settings.ctxWorld,
        earlierBlock: lines.join('\n'),
    });
}

// Обёртка запуска генерации: busy-индикатор на всех кнопках (пост/QR/FAB).
let _generating = 0;
function busyEnd() {
    _generating = Math.max(0, _generating - 1);
    if (_generating <= 0) setGenerating(false);
}
function runBusy(id, opts = {}) {
    _generating++;
    setGenerating(true);
    return pipeline.run(id, opts).finally(busyEnd);
}

// Ключ прогона координатора — dg_id: индекс mesid у живых узлов ST сдвигается
// при удалении/перемещении постов, и отмена по свежему mesid не находила бы
// прогон, запущенный под старым индексом (молча стартуя вторую генерацию).
function dgIdOf(id) {
    const msg = getMessage(Number(id));
    return (msg && dgMessageId(msg)) || null;
}

/** Клик по busy-кнопке ◆ = отмена. Слот прогона держится до размотки, так что
 *  клики в этом окне остаются отменой (идемпотентно), а не новым запуском. */
function cancelGen(id) {
    const dg = dgIdOf(id);
    if (!dg || !coordinator?.abortKind(dg, 'gen')) return false;
    busyEnd(); // кнопка гаснет сразу; размотка прогона учтёт счётчик корректно
    globalThis.toastr?.info?.('Diegetic: генерация отменена');
    return true;
}

function getLatestAssistantId() {
    const chat = getChat();
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i] && !chat[i].is_user && !chat[i].is_system) return i;
    }
    return null;
}

async function init(isCancelled = () => false) {
    const ctx = getCtx();
    if (!ctx) { warn('контекст ST недоступен'); return; }

    settings = loadSettings(settingsStorage);
    coordinator = createGenerationCoordinator();

    const toastr = globalThis.toastr;
    const notify = {
        ready: (m) => { if (settings.appearance !== 'silent') toastr?.success(m); },
        // Потеря оплаченного ответа — не шум: warning показывается и в silent-режиме.
        warn: (m) => toastr?.warning(m),
        error: (m) => toastr?.error(m),
    };

    pipeline = createPipeline({
        notify,
        getMessage,
        // Индексы чата сдвигаются при удалении постов — коммит генерации ищет
        // своё сообщение по стабильному dg_id (см. payload.dgMessageId).
        getMessageByDgId: (dgId) => {
            const found = getChat().find((m) => m?.extra?.dg_id === dgId);
            return found ?? null;
        },
        generateText,
        persistChat,
        getContextBlock,
        get settings() { return settings; },
        coordinator,
        // Дескриптор источника для хоста: единственный профиль «source»,
        // собранный из настроек (форма DS-Comments, без списка профилей).
        // extraBody примешивается к запросу и для CM, и для custom —
        // например, отключение reasoning у провайдера.
        getSourceProfile: () => ({
            id: 'source',
            name: 'Источник',
            source: settings.source,
            sourceConfig: settings.source === 'custom'
                ? { ...settings.custom, extraBody: settings.customExtraBody || '' }
                : { ...settings.cmProfile, extraBody: settings.customExtraBody || '' },
            httpAllowList: settings.httpAllowList,
        }),
        notifyRender: (id) => { reconcileMessage(id); panelApi?.refreshArtifacts?.(); },
        // Шаблон резолвится по activeTemplate: встроенная основа — fetch, своя —
        // из именованного хранилища настроек (форма DS-Comments).
        resolveTemplate: async () => {
            const name = settings.activeTemplate;
            if (isBuiltinTemplate(name)) return getBuiltinTemplate(name);
            return String(userTemplates(settings)[name] ?? '');
        },
    });
    if (isCancelled()) return;

    // Ленивый перенос legacy-ключей из настроек в localforage — до первого UI.
    getBuiltinTemplate().catch((e) => warn('шаблон:', e)); // прогрев кэша

    const $ = globalThis.jQuery ?? globalThis.$;
    // Шаблонные мутации возвращают новый объект настроек — подменяем и пишем.
    const mutateTemplates = (fn) => {
        const next = fn(settings);
        if (next) { settings = next; save(); return true; }
        return false;
    };
    // Подтверждение опасного действия (plain-HTTP endpoint) — штатный попап ST.
    async function confirmDanger(text) {
        const ctx = getCtx();
        try {
            if (typeof ctx?.callGenericPopup === 'function') {
                // Второй аргумент — числовой POPUP_TYPE (строка попадает в
                // default-ветку и рисует generic OK/Cancel).
                const res = await ctx.callGenericPopup(text, ctx.POPUP_TYPE?.CONFIRM ?? 2);
                return res === (ctx.POPUP_RESULT?.AFFIRMATIVE ?? 1) || res === true || res?.result === true;
            }
        } catch { /* фолбэк ниже */ }
        try { return globalThis.window?.confirm?.(text) === true; } catch { return false; }
    }
    const panelDeps = {
        $,
        settings: () => settings,
        setEnabled: (v) => { settings.enabled = v; save(); },
        // ── Источник генерации (форма DS-Comments: сегментный выбор) ──
        getSourceKind: () => settings.source,
        setSourceKind: (kind) => {
            settings.source = ['profile', 'custom'].includes(kind) ? kind : 'profile';
            save();
        },
        listCmProfiles,
        getCmProfile: () => settings.cmProfile,
        setCmProfile: (profileId, profileName) => {
            settings.cmProfile = { profileId: String(profileId ?? ''), profileName: String(profileName ?? '') };
            save();
        },
        getCustom: () => ({ ...settings.custom, extraBody: settings.customExtraBody || '' }),
        // Сохранить свой endpoint: политика (без userinfo, https/loopback, иначе
        // подтверждение → allowlist). Возвращает { ok, error }.
        applyCustom: async ({ apiurl, model }) => {
            const ep = classifyEndpoint(apiurl);
            if (!ep.ok) return { ok: false, error: ep.error };
            if (ep.kind === 'insecure-http' && !isOriginAllowed(ep.origin, settings.httpAllowList)) {
                const ok = await confirmDanger(
                    `Разрешить незащищённый endpoint ${ep.origin}?\n\n` +
                    'Plain-HTTP вне localhost передаёт ключ и тексты в открытом виде. ' +
                    'Origin будет добавлен в список разрешённых (настройки расширения).');
                if (!ok) return { ok: false, error: 'подтверждение не дано' };
                settings.httpAllowList = addToAllowList(ep.origin, settings.httpAllowList);
            }
            settings.custom = { apiurl: String(apiurl ?? '').trim(), model: String(model ?? '').trim() };
            save();
            return { ok: true };
        },
        // Доп. параметры запроса (JSON-объект) — для CM и custom; сохраняется сразу.
        setCustomExtraBody: (extraBody) => {
            const extra = String(extraBody ?? '').trim();
            if (extra) {
                try {
                    const v = JSON.parse(extra);
                    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('должен быть JSON-объект');
                } catch (e) { return { ok: false, error: `«Доп. параметры»: ${e.message}` }; }
            }
            settings.customExtraBody = extra;
            save();
            return { ok: true };
        },
        getCustomKey: () => getApiKey('source'),
        setCustomKey: (key) => setApiKey('source', String(key ?? '')),
        // ── Шаблоны (форма DS-Comments: встроенные под замком + именованные) ──
        getActiveTemplate: () => settings.activeTemplate,
        isBuiltinTemplate,
        builtinTemplateList: () => BUILTIN_TEMPLATES,
        listTemplates: () => listTemplateNames(settings),
        loadTemplateContent: async (name) =>
            isBuiltinTemplate(name) ? getBuiltinTemplate(name) : templateContent(settings, name),
        selectTemplate: (name) => { mutateTemplates((s) => selectTemplate(s, name)); },
        saveTemplate: (text) => { mutateTemplates((s) => saveTemplate(s, s.activeTemplate, text)); },
        saveTemplateAs: (name, text) => mutateTemplates((s) => saveTemplateAs(s, name, text)),
        resetTemplateToBuiltin: async () => {
            const text = await getBuiltinTemplate(DEFAULT_TEMPLATE);
            mutateTemplates((s) => saveTemplate(s, s.activeTemplate, text));
        },
        deleteActiveTemplate: () => { mutateTemplates((s) => deleteTemplate(s, s.activeTemplate)); },
        // Лаунчер и панельные кнопки идут через runBusy — busy-анимация на всех.
        runLatest: () => {
            const id = getLatestAssistantId();
            if (id === null) { toastr?.info?.('Diegetic: в чате нет поста ИИ'); return; }
            if (!cancelGen(id)) runBusy(id, { force: true });
        },
        getExclusions: () => String(chatData()?.exclusions ?? ''),
        setExclusions: (text) => {
            const d = chatData();
            if (d) { d.exclusions = String(text); saveChatData(); }
        },
        setImageMode: (v) => { settings.imageMode = v; save(); },
        setImageQuality: (v) => { settings.imageQuality = v; save(); },
        setDisplayMode: (v) => { settings.displayMode = v; save(); reconcile(); },
        setButtonMode: (v) => {
            settings.buttonMode = v;
            save();
            reconcile(); // пересмотр кнопок в постах
            panelApi?.render(); // лаунчер перерисовывает ui.js по готовности
        },
        setMaxPerMessage: (v) => { settings.maxPerMessage = Number(v); save(); },
        setCtxHistory: (v) => { settings.ctxHistory = !!v; save(); },
        setContextDepth: (v) => { settings.contextDepth = Number(v); save(); },
        setCtxPersona: (v) => { settings.ctxPersona = v; save(); },
        setCtxCharacter: (v) => { settings.ctxCharacter = v; save(); },
        setCtxWorld: (v) => { settings.ctxWorld = v; save(); },
        urisStatus,
        // Подтверждение опасных действий панели (plain-HTTP endpoint, удаление шаблона).
        confirmDanger,
        // Панельный список артефактов чата: скан extra + регенерация/удаление.
        listArtifacts: () => collectRows(getChat()),
        openArtifact: openArtifactPopup,
        saveArtifact: saveArtifactById,
        runFor: (id) => {
            if (!cancelGen(id)) runBusy(id, { force: true });
        },
        removeArtifact: (msgId, artifactId) => { deleteArtifact(msgId, artifactId); },
    };

    try {
        panelApi = mountPanel(panelDeps);
    } catch (e) { warn('UI:', e); }
    if (isCancelled()) return;

    initRender({
        settings: () => settings,
        // Повторный ◆ на посте с идущей генерацией = отмена (без нового запуска).
        run: (id) => {
            if (!cancelGen(id)) runBusy(id, { force: true });
        },
        // 📷 во время заливки фото = отмена заливки; во время генерации —
        // как раньше: новый прогон затирает её.
        fillImageSlots: (id) => {
            const dg = dgIdOf(id);
            if (dg && coordinator.abortKind(dg, 'fill')) return;
            pipeline.fillImageSlots(id);
        },
        // ⏹ на слоте во время заливки — отмена той же заливки.
        cancelFill: (id) => {
            const dg = dgIdOf(id);
            if (dg) coordinator.abortKind(dg, 'fill');
        },
        hasPending: (id) => pipeline.hasPendingPhotoSlots(id),
        regenSlot: (id, artifactId, ordinal, cardId) =>
            pipeline.fillImageSlots(id, { artifactId, onlyOrdinal: ordinal, removeCardId: cardId }),
        editSlotPrompt: (id, artifactId, ordinal, opts) =>
            pipeline.updateSlotPrompt(id, artifactId, ordinal, opts),
    });

    // Настройки редкие, но debounce хоста может не дожить до закрытия вкладки.
    document.addEventListener('visibilitychange', onVisibilityHidden);

    bindEvents(ctx);
    if (isCancelled()) return;

    // Текущий чат: миграция legacy-фенсов → загрузка хранилища → перенос
    // extra-эпохи и send_date-ключей в файл → reconcile.
    prepareChat().catch((e) => warn('миграция:', e));

    log('готов');
}

/** Миграции + загрузка хранилища + reconcile. Общий путь init и CHAT_CHANGED. */
async function prepareChat() {
    await migrateCurrentChat();
    await loadStore();
    if (migrateExtraToStore() || migrateSendDateKeys()) await persistChat();
    reconcile();
}

// Служебные MESSAGE_RECEIVED (script.js: emit(..., id, type)): слэш-команды,
// автовложения расширений, приветствия — не повод для автогенерации артефактов.
// 'swipe'/'continue'/'append'/undefined — обычная генерация, их пропускаем.
const SKIP_AUTOGEN_TYPES = new Set(['command', 'extension', 'impersonate', 'first_message']);

// Именованный хендлер: cleanup() снимает его по ссылке, иначе каждый init()
// добавлял бы ещё один слушатель (инвариант «полный cleanup»).
function onVisibilityHidden() {
    if (document.visibilityState === 'hidden') getCtx()?.saveSettingsDebounced?.();
}

function onMessageReceived(id, type) {
    if (SKIP_AUTOGEN_TYPES.has(type)) return;
    try {
        const msg = getMessage(id);
        const prose = msg ? variantText(msg, msg.swipe_id ?? 0) : '';
        const phrases = String(chatData()?.exclusions ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (isExcluded(prose, phrases)) return;
    } catch { /* не смогли прочитать — пусть пайплайн сам разбирается */ }
    if (pipeline && settings?.enabled) runBusy(Number(id));
}

function bindEvents(ctx) {
    const t = ctx.event_types;
    const pairs = [
        [t.MESSAGE_RECEIVED, onMessageReceived],
        // Ключ инваллидации — dg_id (совпадает с ключом прогона координатора).
        [t.MESSAGE_SWIPED, (id) => { const dg = dgIdOf(id); if (dg) coordinator?.bumpMessageRevision(dg); }],
        [t.MESSAGE_EDITED, (id) => { const dg = dgIdOf(id); if (dg) coordinator?.bumpMessageRevision(dg); }],
        [t.CHAT_CHANGED, () => {
            coordinator?.invalidateAll();
            clearImageCache(); // кэш data:-URL фото привязан к чату — не тащим в новый
            prepareChat().catch(() => {});
        }],
    ];
    // Дозагрузка истории длинных чатов — ресинк оболочек (есть не во всех хостах).
    if (t.MORE_MESSAGES_LOADED) pairs.push([t.MORE_MESSAGES_LOADED, () => reconcile()]);
    for (const [ev, fn] of pairs) {
        try { ctx.eventSource.on(ev, fn); boundEvents.push([ev, fn]); } catch { /* хост без события */ }
    }
}

function unbindEvents() {
    const ctx = getCtx();
    for (const [ev, fn] of boundEvents) {
        try { ctx?.eventSource?.removeListener?.(ev, fn); } catch { /* хост может быть уже недоступен */ }
    }
    boundEvents = [];
}

function cleanup() {
    coordinator?.invalidateAll();
    unbindEvents();
    document.removeEventListener('visibilitychange', onVisibilityHidden);
    try { unmountUi({ $: globalThis.jQuery ?? globalThis.$ }); } catch (e) { warn('ui cleanup:', e); }
    try { shutdownRender(); } catch (e) { warn('render cleanup:', e); }
}

const _runtime = createInitializationController(init);

export async function onActivate() {
    try { await _runtime.start(); } catch (e) { warn('init error:', e); }
}

export async function onEnable() {
    try { await _runtime.start(); } catch (e) { warn('init error:', e); }
}

export async function onDisable() {
    _runtime.stop();
    try { cleanup(); } catch (e) { warn('cleanup error:', e); }
}

export async function onUpdate() {
    // Зарезервировано под миграции схемы payload.
}

export async function onClean() {
    _runtime.stop();
    try { cleanup(); } catch (e) { warn('cleanup error:', e); }
    // Стереть данные расширения: серверный файл артефактов чата, legacy
    // payload'ы из сообщений (extra-эпоха), chat-данные, настройки, ключи.
    // Хук гоняется хостом с таймаутом — сеть только одним быстрым delete.
    try {
        const ctx = getCtx();
        await deleteStoreFile();
        for (const msg of ctx?.chat ?? []) {
            if (!msg || typeof msg !== 'object') continue;
            if (msg.extra && PAYLOAD_KEY in msg.extra) delete msg.extra[PAYLOAD_KEY];
            for (const slot of Array.isArray(msg.swipe_info) ? msg.swipe_info : []) {
                if (slot?.extra && PAYLOAD_KEY in slot.extra) delete slot.extra[PAYLOAD_KEY];
            }
        }
        if (ctx?.chatMetadata?.dg) delete ctx.chatMetadata.dg;
        if (ctx?.extensionSettings) delete ctx.extensionSettings.diegetic;
        ctx?.saveSettingsDebounced?.();
        ctx?.saveMetadataDebounced?.();
        await persistChat();
        await setApiKey('source', '');
    } catch (e) { warn('clean error:', e); }
}
