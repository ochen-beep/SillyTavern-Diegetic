// src/pipeline.js — оркестрация генерации и фотослотов.
// Нативная модель: артефакты живут в extra сообщения (payload.js), текст поста
// не трогается никогда. Commit-гард — coordinator.isCurrent + digest прозы.
// Текст не перезаписываем, поэтому весь класс гонок «перезаписали чужую правку»
// сведён к сверке digest перед записью payload.

import { contentDigest, isViableMessageText } from './digest.js';
import { findAnchorInText, findFuzzySpan } from './anchor.js';
import { parseDiegeticResponse } from './parser.js';
import { assemblePromptParts } from './contract.js';
import {
    readRawPayload, readVerifiedPayload, stampPayload, writePayload,
    variantText, digestForVariant,
} from './payload.js';
import {
    parseImageSlots, hasPendingSlots, setSlotState,
    injectSlotImage, replaceSlotImage, generateSlotImage, getUrisBridge,
} from './images.js';

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
    // Хост-функции — через deps (тест-шов), реализация — src/host.js.
    // Обращение — в точке вызова, не деструктуризацией: тесты подменяют
    // deps.generateText между прогонами.
    const { notify } = deps;
    const activeProfile = () => deps.settings.profiles.find(p => p.id === deps.settings.activeProfile) || deps.settings.profiles[0];

    async function _run(messageId, { force = false } = {}) {
        const s = deps.settings;
        // force (панель/оверлей) работает и при выключенном авторежиме
        if (!s.enabled && !force) return;
        const msg = deps.getMessage(messageId);
        if (!msg || msg.is_user || msg.is_system) return;
        const swipeIdx = msg.swipe_id ?? 0;
        const prose = variantText(msg, swipeIdx);
        if (!isViableMessageText(prose)) return;
        // payload уже есть — не дублим (force перезаписывает тот же слот)
        if (!force && readRawPayload(msg, swipeIdx)) return;
        const proseDigest = contentDigest(prose);

        const run = deps.coordinator.beginRun(messageId);
        try {
            const profile = activeProfile();
            // resolveTemplate async: встроенный шаблон тянется fetch'ем (core.js)
            const templateText = await deps.resolveTemplate(profile);
            const { system, user } = assemblePromptParts({
                templateText, postText: prose,
                contextBlock: deps.getContextBlock ? await deps.getContextBlock(messageId, s.contextDepth) : '',
                maxCount: s.maxPerMessage,
            });
            let raw;
            try {
                raw = await deps.generateText({ system, user, profile, signal: run.ctrl.signal });
            } catch (e) {
                if (e?.name !== 'AbortError') notify.error(`Diegetic: генерация не удалась (${e?.message || e})`);
                return;
            }
            if (!deps.coordinator.isCurrent(run)) return;

            const parsed = parseDiegeticResponse(raw, { maxBytes: s.maxArtifactBytes, maxCount: s.maxPerMessage });
            if (parsed.artifacts.length === 0) {
                // Контракт запрещает отказ, так что это именно сбой модели.
                notify.error(`Diegetic: модель не вернула артефакт (${parsed.errors[0] || 'нет пар комментарий+fence'})`);
                return;
            }

            // Якорная валидация против сырой прозы — как раньше.
            const recorded = parsed.artifacts.map((art, i) => {
                let status = 'ok';
                let span = art.anchor ? findAnchorInText(prose, art.anchor) : null;
                if (!span && art.anchor) { span = findFuzzySpan(prose, art.anchor); if (span) status = 'fuzzy'; }
                if (!span) status = 'orphan';
                return {
                    id: `${proseDigest}:${i}`, type: art.type, anchor: art.anchor, status,
                    html: art.html, bytes: byteLength(art.html), createdAt: Date.now(), profileId: profile.id,
                };
            });

            // Commit-гард: прогон актуален и проза не сменилась за время генерации.
            const live = deps.getMessage(messageId);
            if (!live || !deps.coordinator.isCurrent(run) || digestForVariant(live, swipeIdx) !== proseDigest) return;

            const payload = stampPayload(live, swipeIdx, recorded);
            if (!payload || !writePayload(live, swipeIdx, payload)) return;
            await deps.persistChat();
            deps.notifyRender?.(messageId);

            const orphans = recorded.filter(a => a.status === 'orphan').length;
            if (orphans > 0) notify.error(`Diegetic: ${orphans} артефакт(ов) не нашли якорь — см. панель`);
            else notify.ready(`Diegetic: артефакт(ов): ${recorded.length}`);

            if (s.imageMode === 'auto' && recorded.some(a => hasPendingSlots(a.html))) fillImageSlots(messageId);
        } finally {
            deps.coordinator.endRun(run);
        }
    }

    /**
     * Заполнить фотослоты артефактов сообщения через мост URIS. Payload
     * перечитывается перед каждым слотом и каждой записью: свайп/правка
     * (digest сменился) прерывают заливку — платный результат не вписывается
     * в чужой текст. Оплаченный слот (done) не откатывается.
     * opts.artifactId + opts.onlyOrdinal — точечная перегенерация одного слота;
     * opts.removeCardId — карточка URIS прошлого фото, удаляется после успеха.
     */
    async function _fillImageSlots(messageId, { artifactId = null, onlyOrdinal = null, removeCardId = null } = {}) {
        const s = deps.settings;
        if (s.imageMode === 'off') return;
        const read = () => {
            const m = deps.getMessage(messageId);
            if (!m) return null;
            return readVerifiedPayload(m, m.swipe_id ?? 0);
        };
        const write = (payload) => {
            const m = deps.getMessage(messageId);
            if (!m || !writePayload(m, m.swipe_id ?? 0, payload)) return false;
            deps.persistChat();
            deps.notifyRender?.(messageId);
            return true;
        };
        const mutateArtifact = (baseDigest, aid, fn) => {
            const p = read();
            if (!p || p.contentDigest !== baseDigest) return false;
            const idx = p.artifacts.findIndex(a => a.id === aid);
            if (idx < 0) return false;
            const html = fn(p.artifacts[idx].html);
            if (html === null || html === undefined) return false;
            const artifacts = p.artifacts.slice();
            artifacts[idx] = { ...p.artifacts[idx], html, bytes: byteLength(html) };
            return write({ ...p, artifacts });
        };

        const base = read();
        if (!base) return;
        const baseDigest = base.contentDigest;
        const targets = [];
        base.artifacts.forEach((a, ai) => {
            if (artifactId !== null && a.id !== artifactId) return;
            for (const sl of parseImageSlots(a.html)) {
                if (onlyOrdinal === null ? sl.state !== 'done' : sl.ordinal === onlyOrdinal) {
                    targets.push({ artifactId: a.id, slot: sl });
                }
            }
        });
        if (!targets.length) return;

        let firstError = null;
        for (const { artifactId: aid, slot } of targets) {
            if (!mutateArtifact(baseDigest, aid, (html) => setSlotState(html, slot.ordinal, 'loading'))) return;
            try {
                const res = await generateSlotImage(slot, { quality: s.imageQuality, imageSize: '1K' });
                const ok = mutateArtifact(baseDigest, aid, (html) =>
                    replaceSlotImage(html, slot.ordinal, res.imagePath, res.cardId)
                    ?? injectSlotImage(html, slot.ordinal, res.imagePath, res.cardId));
                if (!ok) return; // digest ушёл или слот исчез — платный результат не пишем в чужое
                if (removeCardId) {
                    try { await getUrisBridge()?.removeCard(removeCardId, { caller: 'sthtml' }); } catch { /* галерея — некритично */ }
                }
            } catch (e) {
                if (e?.code === 'ABORTED' || e?.name === 'AbortError') {
                    mutateArtifact(baseDigest, aid, (html) => setSlotState(html, slot.ordinal, null));
                    return;
                }
                if (!mutateArtifact(baseDigest, aid, (html) => setSlotState(html, slot.ordinal, 'error'))) return;
                firstError = firstError || e;
            }
        }
        if (firstError) notify.error(`Diegetic: фото не сгенерировано (${firstError?.message || firstError})`);
        else notify.ready('Diegetic: фото готово');
    }

    /** Есть ли незаполненные фотослоты у артефактов сообщения (для 📷-кнопки). */
    function hasPendingPhotoSlots(messageId) {
        const m = deps.getMessage(messageId);
        if (!m) return false;
        const p = readVerifiedPayload(m, m.swipe_id ?? 0);
        return !!p?.artifacts.some(a => hasPendingSlots(a.html));
    }

    // run() и fillImageSlots() никогда не реджектятся: обработчики событий fire-and-forget.
    const fillImageSlots = (messageId, opts = {}) =>
        _fillImageSlots(messageId, opts).catch((e) => notify.error(`Diegetic: сбой фотослотов (${e?.message || e})`));

    return {
        run: (messageId, opts = {}) =>
            _run(messageId, opts).catch((e) => notify.error(`Diegetic: сбой (${e?.message || e})`)),
        fillImageSlots,
        hasPendingPhotoSlots,
    };
}
