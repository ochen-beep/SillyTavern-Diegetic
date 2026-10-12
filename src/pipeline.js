// src/pipeline.js
import { contentDigest, isViableMessageText } from './digest.js';
import { findAnchorInText, findFuzzySpan } from './anchor.js';
import { hasOwnBlock, stripOwnBlocks, paragraphEndAfter, applyInsertions } from './paragraph.js';
import { parseDiegeticResponse } from './parser.js';
import { assemblePrompt, assemblePromptParts } from './contract.js';
import { buildGenerateConfig, generationIdFor } from './source.js';
import { META_KEY, recordArtifacts, removeDigest } from './meta.js';

const byteLength = (s) => new TextEncoder().encode(s).length;

/** Чистая: true, если хоть одна фраза-исключение встречена в прозе (нормализованно, подстрокой). */
export function isExcluded(prose, phrases) {
    const norm = String(prose ?? '').normalize('NFC').toLowerCase();
    return (Array.isArray(phrases) ? phrases : []).some(p => {
        const needle = String(p ?? '').trim().normalize('NFC').toLowerCase();
        return needle.length > 0 && norm.includes(needle);
    });
}

export function createPipeline(deps) {
    const { api, notify, getContextBlock } = deps;

    const chatVars = () => api.getVariables() || {};
    const writeVars = (vars) => api.insertOrAssignVariables({ [META_KEY]: vars[META_KEY] });
    const activeProfile = () => deps.settings.profiles.find(p => p.id === deps.settings.activeProfile) || deps.settings.profiles[0];
    const getMsg = async (id) => {
        const list = await api.getChatMessages(String(id));
        return Array.isArray(list) ? list[0] : null;
    };

    async function _run(messageId, { force = false } = {}) {
        const s = deps.settings;
        // force (панель/оверлей) работает и при выключенном авторежиме — спека §10
        if (!s.enabled && !force) return;
        const msg = await getMsg(messageId);
        if (!msg || msg.role !== 'assistant') return;
        const text = String(msg.message ?? '');
        if (!isViableMessageText(text)) return;
        if (hasOwnBlock(text) && !force) return;
        const prose = stripOwnBlocks(text);
        const proseDigest = contentDigest(prose);

        const run = deps.coordinator.beginRun(messageId);
        try {
            const genId = generationIdFor(messageId, run.token);
            run.ctrl.signal.addEventListener('abort', () => api.stopGenerationById?.(genId));
            const profile = activeProfile();
            // lensResolver (main.js) резолвит '@universal' в текст встроенной линзы;
            // без него — линза профиля как есть (тесты).
            const lensText = deps.lensResolver ? deps.lensResolver(profile) : (profile?.lensText ?? '');
            let raw;
            try {
                if (profile?.source === 'profile') {
                    // Источник «профиль подключения» (Connection Manager, как в DS-Comments):
                    // sendRequest принимает сообщения ролями, generateRaw здесь не участвует.
                    const { system, user } = assemblePromptParts({
                        lensText, postText: prose,
                        contextBlock: getContextBlock ? await getContextBlock(messageId, s.contextDepth) : '',
                        maxCount: s.maxPerMessage,
                    });
                    raw = await api.cmGenerate({ system, user, profile, signal: run.ctrl.signal });
                } else {
                    const prompt = assemblePrompt({
                        lensText,
                        postText: prose,
                        // await: провайдер контекста может быть асинхронным; на синхронном await безвреден
                        contextBlock: getContextBlock ? await getContextBlock(messageId, s.contextDepth) : '',
                        maxCount: s.maxPerMessage,
                    });
                    raw = await api.generateRaw(buildGenerateConfig({ prompt, profile, contextDepth: s.contextDepth, generationId: genId }));
                }
            } catch (e) {
                notify.error(`Diegetic: генерация не удалась (${e?.message || e})`);
                return;
            }
            if (!deps.coordinator.isCurrent(run)) return;

            const parsed = parseDiegeticResponse(raw, { maxBytes: s.maxArtifactBytes, maxCount: s.maxPerMessage });
            if (parsed.pulse === false) {
                if (force) {
                    // явная регенерация + отказ модели (контракт запрещает отказ, но
                    // модель могла его нарушить): снимаем устаревшие артефакты
                    const live = await getMsg(messageId);
                    if (!deps.coordinator.isCurrent(run)) return;
                    const liveText = String(live?.message ?? '');
                    if (hasOwnBlock(liveText)) {
                        const stripped = stripOwnBlocks(liveText);
                        // живой recheck прозы: изменилась, пока шла генерация — отменяем
                        if (contentDigest(stripped) !== proseDigest) return;
                        // insertOrAssignVariables раннера — глубокий merge БЕЗ удаления ключей,
                        // поэтому «снимаем» запись, перезаписывая её пустым списком артефактов.
                        const vars = chatVars();
                        const next = recordArtifacts(vars, contentDigest(stripped), []);
                        writeVars(next);
                        await api.setChatMessages([{ message_id: Number(messageId), message: stripped }], { refresh: 'affected' });
                        notify.ready('Diegetic: модель отказалась (нарушение контракта) — артефакт(ы) сняты');
                    } else {
                        // ручная генерация с отказом: молчание выглядит как поломку —
                        // честно сообщаем, что модель отказалась и пост не тронут
                        notify.ready('Diegetic: модель отказалась от артефакта — пост не тронут');
                    }
                }
                return;
            }
            if (parsed.artifacts.length === 0) {
                notify.error(`Diegetic: модель не вернула артефактов (${parsed.errors[0] || 'нет пар комментарий+fence'})`);
                return;
            }

            const insertions = [];
            const recorded = [];
            for (const art of parsed.artifacts) {
                let span = art.anchor ? findAnchorInText(prose, art.anchor) : null;
                let status = 'ok';
                if (!span && art.anchor) { span = findFuzzySpan(prose, art.anchor); if (span) status = 'fuzzy'; }
                if (!span) { recorded.push({ type: art.type, anchor: art.anchor, status: 'orphan', html: art.html }); continue; }
                insertions.push({ at: paragraphEndAfter(prose, span.end), html: art.html });
                recorded.push({ type: art.type, anchor: art.anchor, status, html: art.html });
            }

            const live = await getMsg(messageId);
            const liveText = String(live?.message ?? '');
            const liveProse = hasOwnBlock(liveText) ? stripOwnBlocks(liveText) : liveText;
            if (!deps.coordinator.isCurrent(run) || liveProse !== prose) return;

            const baseText = force ? stripOwnBlocks(liveText) : liveText;
            let newMessage = baseText;
            if (insertions.length > 0) {
                const applied = applyInsertions(baseText, insertions);
                if (!applied) return;
                newMessage = applied.text;
            }

            // read-modify-write без await: синхронный блок, атомарен в JS-однопоточности.
            // Пишем ТОЛЬКО наш ключ: insertOrAssignVariables делает глубокий merge,
            // чужие ключи других расширений сохраняются, а их устаревшие сиблинги не воскресают.
            let vars = chatVars();
            if (force) vars = removeDigest(vars, proseDigest);
            vars = recordArtifacts(vars, proseDigest, recorded.map((a, i) => ({
                id: `${proseDigest}:${i}`, type: a.type, anchor: a.anchor, status: a.status,
                bytes: byteLength(a.html), createdAt: Date.now(), profileId: profile.id,
            })));
            writeVars(vars);

            if (newMessage !== liveText) {
                await api.setChatMessages([{ message_id: Number(messageId), message: newMessage }], { refresh: 'affected' });
            }
            const orphans = recorded.filter(a => a.status === 'orphan').length;
            if (orphans > 0) notify.error(`Diegetic: ${orphans} артефакт(ов) не нашли якорь — см. панель`);
            else notify.ready(`Diegetic: артефакт(ов): ${recorded.length}`);
        } finally {
            deps.coordinator.endRun(run);
        }
    }

    // run() никогда не реджектится: обработчики событий fire-and-forget —
    // необработанный rejection из getMsg/setChatMessages умер бы молча.
    return { run: (messageId, opts = {}) =>
        _run(messageId, opts).catch((e) => notify.error(`Diegetic: сбой (${e?.message || e})`)) };
}
