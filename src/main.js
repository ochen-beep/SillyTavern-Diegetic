// src/main.js
import { createPipeline, isExcluded } from './pipeline.js';
import { createGenerationCoordinator } from './coordinator.js';
import { loadSettings, saveSettings } from './settings.js';
import { ensurePromptStripRegex } from './regex.js';
import { metaFor, recordArtifacts, readMetaMap } from './meta.js';
import { stripOwnBlocks } from './paragraph.js';
import { contentDigest } from './digest.js';
import { mountPanel, attachOverlay } from './ui.js';

(function init() {
    const g = globalThis;
    const need = ['getChatMessages', 'setChatMessages', 'generateRaw', 'getVariables',
        'insertOrAssignVariables', 'getTavernRegexes', 'replaceTavernRegexes', 'eventOn'];
    const missing = need.filter(k => typeof g[k] !== 'function');
    if (missing.length) {
        console.warn(`[Diegetic] JS-Slash-Runner API не найден: ${missing.join(', ')}`);
        return;
    }
    const api = {
        getChatMessages: (...a) => g.getChatMessages(...a),
        setChatMessages: (...a) => g.setChatMessages(...a),
        generateRaw: (...a) => g.generateRaw(...a),
        stopGenerationById: (id) => g.stopGenerationById?.(id),
        getVariables: () => g.getVariables({ type: 'chat' }),
        insertOrAssignVariables: (vars) => g.insertOrAssignVariables(vars, { type: 'chat' }),
        getTavernRegexes: (...a) => g.getTavernRegexes(...a),
        replaceTavernRegexes: (...a) => g.replaceTavernRegexes(...a),
        getGlobalVariables: () => g.getVariables({ type: 'global' }),
        setGlobalVariables: (vars) => g.insertOrAssignVariables(vars, { type: 'global' }),
    };
    const settingsStorage = {
        get: () => api.getGlobalVariables().dg_settings,
        set: (v) => api.setGlobalVariables({ dg_settings: v }),
    };
    let settings = loadSettings(settingsStorage);
    const save = () => { saveSettings(settingsStorage, settings); };

    const coordinator = createGenerationCoordinator();
    const toastr = g.toastr;
    const notify = {
        ready: (m) => { if (settings.appearance !== 'silent') toastr?.success(m); },
        error: (m) => toastr?.error(m),
    };

    const getContextBlock = (messageId, depth) => {
        const from = Math.max(0, Number(messageId) - depth);
        const to = Number(messageId) - 1;
        if (to < from) return '';
        const list = api.getChatMessages(`${from}-${to}`) || [];
        // proseOf: убираем наши ```html-блоки — иначе прошлые артефакты дублируются
        // в max_chat_history и загрязняют вызов контракта
        return list.map(m => `${m.role === 'assistant' ? 'ИИ' : m.name || 'Пользователь'}: ${proseOf(m).slice(0, 400)}`).join('\n---\n');
    };

    const pipeline = createPipeline({
        api, notify, getContextBlock,
        get settings() { return settings; },
        coordinator,
    });

    const chatVars = () => api.getVariables();
    const proseOf = (msg) => stripOwnBlocks(String(msg?.message ?? ''));
    const metaForMessage = (id) => {
        const list = api.getChatMessages(String(id));
        const msg = Array.isArray(list) ? list[0] : null;
        if (!msg) return null;
        return metaFor(chatVars(), contentDigest(proseOf(msg)));
    };

    const panelDeps = {
        $: g.jQuery ?? g.$,
        getChatVars: chatVars,
        settings: () => settings,
        setEnabled: (v) => { settings.enabled = v; save(); },
        setActiveProfile: (id) => { settings.activeProfile = id; save(); },
        setLensText: (text) => {
            const p = settings.profiles.find(x => x.id === settings.activeProfile) || settings.profiles[0];
            if (p) p.lensText = String(text ?? '');
            save();
        },
        addProfile: ({ name, source, apiurl, key, model }) => {
            const id = `p${Date.now().toString(36)}`;
            settings.profiles.push({
                id,
                name: String(name ?? '').trim() || 'Профиль',
                source: source === 'custom' ? 'custom' : 'current',
                sourceConfig: source === 'custom' ? { apiurl: String(apiurl ?? ''), key: String(key ?? ''), model: String(model ?? '') } : null,
                lensText: '',
            });
            settings.activeProfile = id;
            save(); // saveSettings прогоняет через normalizeSettings — форма записи канонизируется
        },
        pipeline,
        regenByDigest: (digest) => {
            const list = api.getChatMessages('0-9999') || [];
            const hit = list.find(m => contentDigest(proseOf(m)) === digest);
            if (hit) pipeline.run(Number(hit.message_id), { force: true });
        },
        // ВАЖНО: удаление = очищенная запись (recordArtifacts с пустым списком),
        // НЕ delete-ключа: insertOrAssignVariables — глубокий merge без удаления.
        deleteByDigest: (digest) => {
            api.insertOrAssignVariables(recordArtifacts(chatVars(), digest, []), { type: 'chat' });
        },
        getExclusions: () => String(chatVars().dg_exclusions ?? ''),
        setExclusions: (text) => { api.insertOrAssignVariables({ dg_exclusions: String(text) }, { type: 'chat' }); },
        metaForMessage,
    };

    try {
        const ui = mountPanel(panelDeps);
        attachOverlay(panelDeps);
        console.log('[Diegetic] UI смонтирован');
    } catch (e) { console.warn('[Diegetic] UI:', e); }

    const ensureRegex = () => ensurePromptStripRegex(api).catch((e) => console.warn('[Diegetic] regex:', e));
    ensureRegex();

    g.eventOn(g.tavern_events.MESSAGE_RECEIVED, (id) => {
        const numId = Number(id);
        try {
            // Исключения: фраза (строка на строку) найдена в прозе → авторежим молчит
            const list = api.getChatMessages(String(numId));
            const msg = Array.isArray(list) ? list[0] : null;
            const prose = proseOf(msg);
            const phrases = String(chatVars().dg_exclusions ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (isExcluded(prose, phrases)) return;
        } catch { /* не смогли прочитать — пусть пайплайн сам разбирается */ }
        pipeline.run(numId);
    });
    g.eventOn(g.tavern_events.MESSAGE_SWIPED, (id) => coordinator.bumpMessageRevision(Number(id)));
    g.eventOn(g.tavern_events.MESSAGE_UPDATED, (id) => coordinator.bumpMessageRevision(Number(id)));
    g.eventOn(g.tavern_events.CHAT_CHANGED, () => { coordinator.invalidateAll(); ensureRegex(); });

    console.log('[Diegetic] инициализирован');
})();
