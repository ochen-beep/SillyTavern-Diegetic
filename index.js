// index.js — точка входа нативного расширения Diegetic.
// Тонкий оркестратор (форма Glosses/index.js): manifest-хуки + порядок init +
// полный cleanup. Вся логика — в src/.
//
// Хуки (manifest.json): activate → init (загрузка страницы), enable → init,
// disable → cleanup, clean → cleanup + стереть данные расширения.

import { loadSettings, saveSettings } from './src/settings.js';
import {
    getCtx, settingsStorage, getBuiltinTemplate, chatData, saveChatData,
    setApiKey,
} from './src/core.js';
import { getChat, getMessage, listCmProfiles, persistChat, generateText } from './src/host.js';
import { createPipeline, isExcluded } from './src/pipeline.js';
import { createGenerationCoordinator } from './src/coordinator.js';
import { createInitializationController } from './src/lifecycle.js';
import { mountPanel, unmountUi, collectRows } from './src/ui.js';
import { initRender, shutdownRender, reconcile, reconcileMessage, setGenerating } from './src/render.js';
import { migrateCurrentChat } from './src/migrate.js';
import { clearPayload, variantText, PAYLOAD_KEY } from './src/payload.js';
import { urisStatus } from './src/images.js';
import { collectContext } from './src/context.js';

const log = (...a) => console.log('[Diegetic]', ...a);
const warn = (...a) => console.warn('[Diegetic]', ...a);

let settings = null;
let coordinator = null;
let pipeline = null;
let panelApi = null;
/** @type {Array<[string, Function]>} карта подписок для cleanup */
let boundEvents = [];

const save = () => { saveSettings(settingsStorage, settings); };

// Одноразовый вынос ключей legacy-настроек (sourceConfig.key) в localforage.
async function migrateApiKeys() {
    for (const p of settings.profiles) {
        const legacy = String(p?.sourceConfig?.key ?? '');
        if (!legacy) continue;
        await setApiKey(p.id, legacy);
        p.sourceConfig.key = '';
        p.sourceConfig.hasKey = true;
    }
    save();
}

async function getContextBlock(messageId, depth) {
    const ctx = getCtx();
    const chat = getChat();
    const from = Math.max(0, Number(messageId) - depth);
    const to = Number(messageId) - 1;
    const lines = [];
    for (let i = from; i <= to; i++) {
        const m = chat[i];
        if (!m) continue;
        // Проза — это и есть весь текст: артефакты в тексте не живут (extra).
        lines.push(`${m.is_user ? (m.name || ctx?.name1 || 'Пользователь') : (m.name || ctx?.name2 || 'ИИ')}: ${String(m.mes ?? '').slice(0, 400)}`);
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
function runBusy(id, opts = {}) {
    _generating++;
    setGenerating(true);
    return pipeline.run(id, opts).finally(() => {
        _generating--;
        if (_generating <= 0) setGenerating(false);
    });
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
        error: (m) => toastr?.error(m),
    };

    pipeline = createPipeline({
        notify,
        getMessage,
        generateText,
        persistChat,
        getContextBlock,
        get settings() { return settings; },
        coordinator,
        notifyRender: (id) => { reconcileMessage(id); panelApi?.render(); },
        // templateText '' у профиля → встроенный шаблон профиля (fetch, core.js)
        resolveTemplate: async (p) => String(p?.templateText ?? '').trim() || await getBuiltinTemplate(p?.builtin),
    });
    if (isCancelled()) return;

    // Ленивый перенос legacy-ключей из настроек в localforage — до первого UI.
    migrateApiKeys().catch(() => {});
    getBuiltinTemplate().catch((e) => warn('шаблон:', e)); // прогрев кэша

    const $ = globalThis.jQuery ?? globalThis.$;
    const panelDeps = {
        $,
        settings: () => settings,
        setEnabled: (v) => { settings.enabled = v; save(); },
        setActiveProfile: (id) => { settings.activeProfile = id; save(); },
        setTemplateText: (text) => {
            const p = settings.profiles.find(x => x.id === settings.activeProfile) || settings.profiles[0];
            if (p) p.templateText = String(text ?? '');
            save();
        },
        setBuiltin: (id) => {
            const p = settings.profiles.find(x => x.id === settings.activeProfile) || settings.profiles[0];
            if (p) p.builtin = id === 'universal-photo' ? 'universal-photo' : 'universal';
            save();
        },
        addProfile: ({ name, source, apiurl, key, model, profileId, profileName }) => {
            const id = `p${Date.now().toString(36)}`;
            const src = source === 'custom' ? 'custom' : source === 'profile' ? 'profile' : 'current';
            const hasKey = !!key;
            settings.profiles.push({
                id,
                name: String(name ?? '').trim() || 'Профиль',
                source: src,
                sourceConfig: src === 'custom'
                    ? { apiurl: String(apiurl ?? ''), key: '', hasKey, model: String(model ?? '') }
                    : src === 'profile' ? { profileId: String(profileId ?? ''), profileName: String(profileName ?? '') } : null,
                templateText: '',
            });
            if (hasKey) setApiKey(id, key).catch(() => {});
            settings.activeProfile = id;
            save(); // saveSettings прогоняет через normalizeSettings — форма записи канонизируется
        },
        setProfileSource: ({ source, apiurl, key, model, profileId, profileName }) => {
            const p = settings.profiles.find(x => x.id === settings.activeProfile) || settings.profiles[0];
            if (!p) return;
            p.source = source === 'custom' ? 'custom' : source === 'profile' ? 'profile' : 'current';
            if (p.source === 'custom') {
                const keep = p.sourceConfig?.hasKey || !!p.sourceConfig?.key;
                p.sourceConfig = { apiurl: String(apiurl ?? ''), key: '', hasKey: keep || !!key, model: String(model ?? '') };
                if (key) { setApiKey(p.id, key).catch(() => {}); p.sourceConfig.hasKey = true; }
            } else {
                p.sourceConfig = p.source === 'profile'
                    ? { profileId: String(profileId ?? ''), profileName: String(profileName ?? '') } : null;
            }
            save();
        },
        getBuiltinTemplate,
        listCmProfiles,
        // Лаунчер и панельные кнопки идут через runBusy — busy-анимация на всех.
        runLatest: () => {
            const id = getLatestAssistantId();
            if (id !== null) runBusy(id, { force: true });
        },
        runId: (id) => { if (Number.isFinite(id)) runBusy(id, { force: true }); },
        listArtifacts: () => collectRows(getChat()),
        regen: (msgId) => runBusy(msgId, { force: true }),
        removeArtifacts: (msgId) => {
            const msg = getMessage(msgId);
            if (msg && clearPayload(msg, msg.swipe_id ?? 0)) {
                persistChat();
                reconcileMessage(msgId);
            }
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
        setCtxPersona: (v) => { settings.ctxPersona = v; save(); },
        setCtxCharacter: (v) => { settings.ctxCharacter = v; save(); },
        setCtxWorld: (v) => { settings.ctxWorld = v; save(); },
        urisStatus,
    };

    try {
        panelApi = mountPanel(panelDeps);
    } catch (e) { warn('UI:', e); }
    if (isCancelled()) return;

    initRender({
        settings: () => settings,
        run: (id) => runBusy(id, { force: true }),
        fillImageSlots: (id) => pipeline.fillImageSlots(id),
        hasPending: (id) => pipeline.hasPendingPhotoSlots(id),
        regenSlot: (id, artifactId, ordinal, cardId) =>
            pipeline.fillImageSlots(id, { artifactId, onlyOrdinal: ordinal, removeCardId: cardId }),
    });

    // Настройки редкие, но debounce хоста может не дожить до закрытия вкладки.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') getCtx()?.saveSettingsDebounced?.();
    });

    bindEvents(ctx);
    if (isCancelled()) return;

    // Текущий чат: миграция legacy-фенсов → reconcile.
    migrateCurrentChat().then(() => reconcile()).catch((e) => warn('миграция:', e));

    log('готов');
}

function onMessageReceived(id) {
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
        [t.MESSAGE_SWIPED, (id) => coordinator?.bumpMessageRevision(Number(id))],
        [t.MESSAGE_EDITED, (id) => coordinator?.bumpMessageRevision(Number(id))],
        [t.CHAT_CHANGED, () => {
            coordinator?.invalidateAll();
            migrateCurrentChat().then(() => reconcile()).catch(() => {});
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
    // Стереть данные расширения: payload'ы из всех сообщений, chat-данные,
    // настройки, ключи из localforage. Хук гоняется хостом с таймаутом —
    // локальные стирания синхронны, сеть не трогаем.
    try {
        const ctx = getCtx();
        for (const msg of ctx?.chat ?? []) {
            if (!msg || typeof msg !== 'object') continue;
            if (msg.extra && PAYLOAD_KEY in msg.extra) delete msg.extra[PAYLOAD_KEY];
            for (const slot of Array.isArray(msg.swipe_info) ? msg.swipe_info : []) {
                if (slot?.extra && PAYLOAD_KEY in slot.extra) delete slot.extra[PAYLOAD_KEY];
            }
        }
        if (ctx?.chatMetadata?.dg) delete ctx.chatMetadata.dg;
        const profileIds = (settings?.profiles ?? []).map(p => p.id);
        if (ctx?.extensionSettings) delete ctx.extensionSettings.diegetic;
        ctx?.saveSettingsDebounced?.();
        ctx?.saveMetadataDebounced?.();
        await persistChat();
        await Promise.allSettled(profileIds.map(id => setApiKey(id, '')));
    } catch (e) { warn('clean error:', e); }
}
