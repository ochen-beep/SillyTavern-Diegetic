// Оркестрация генерации и фотослотов.
// Артефакты живут в файловом хранилище (payload.js), текст поста не трогается
// никогда — поэтому весь класс гонок «перезаписали чужую правку» сведён
// к commit-гарду: coordinator.isCurrent + сверка digest прозы перед записью.

import { contentDigest, isViableMessageText } from './digest.js';
import { findAnchorInText, findFuzzySpan } from './anchor.js';
import { parseDiegeticResponse } from './parser.js';
import { assemblePromptParts } from './contract.js';
import {
    readRawPayload, readVerifiedPayload, stampPayload, writePayload,
    payloadBelongsToOtherVariant, dgMessageId,
    variantText, digestForVariant,
} from './payload.js';
import {
    parseImageSlots, hasPendingSlots, setSlotState,
    injectSlotImage, replaceSlotImage, generateSlotImage, getUrisBridge,
    setSlotPrompt, slotCardId,
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

    async function _run(messageId, { force = false } = {}) {
        const s = deps.settings;
        // force (панель/оверлей) работает и при выключенном авторежиме
        if (!s.enabled && !force) return;
        const msg = deps.getMessage(messageId);
        if (!msg || msg.is_user || msg.is_system) return;
        const swipeIdx = msg.swipe_id ?? 0;
        const prose = variantText(msg, swipeIdx);
        if (!isViableMessageText(prose)) return;
        // payload уже есть — не дублим (force перезаписывает тот же слот).
        // Чужой payload НЕ блокирует прогон: ST клонирует extra соседнего
        // варианта в слот нового свайпа (script.js:3711) — новый вариант
        // артефактов не имеет, генерируем, а не молча выходим.
        const rawPayload = readRawPayload(msg, swipeIdx);
        if (!force && rawPayload && !payloadBelongsToOtherVariant(msg, swipeIdx, rawPayload)) return;
        const proseDigest = contentDigest(prose);

        const run = deps.coordinator.beginRun(messageId);
        // Стабильная идентичность поста: за время генерации индексы чата
        // могут сдвинуться (удаление соседнего поста) — коммит ищет пост по
        // dg_id, а не по индексу, и пишет результат своему сообщению.
        const runDgId = dgMessageId(msg, { create: true });
        try {
            // Дескриптор источника собирает хост (index.js) из настроек.
            const profile = deps.getSourceProfile();
            // resolveTemplate async: встроенный шаблон тянется fetch'ем (core.js).
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
            if (!deps.coordinator.isCurrent(run)) {
                // Ответ пришёл, а прогон устарел (свайп/правка/новый запуск за
                // время генерации): оплаченный ответ выбрасывается — не молчать.
                notify.warn?.('Diegetic: ответ не записан — прогон устарел (свайп, правка или новый запуск)');
                return;
            }

            const parsed = parseDiegeticResponse(raw, { maxCount: s.maxPerMessage });
            if (parsed.artifacts.length === 0) {
                // Контракт запрещает отказ, так что это именно сбой модели.
                notify.error(`Diegetic: модель не вернула артефакт (${parsed.errors[0] || 'нет пар комментарий+fence'})`);
                return;
            }
            // Часть пар не распарсилась — скажем, а не выкинем молча: по тосту
            // видно, почему при «3 артефакта» в посте оказался один.
            if (parsed.errors.length > 0) {
                notify.error(`Diegetic: отброшено ${parsed.errors.length} из ответа (${parsed.errors.join('; ')})`);
            }

            // Якорная валидация против сырой прозы (и прозы со срезанным markdown:
            // модель часто цитирует чистый текст без */_ из **bold**/*italic*).
            // Якорь задан и не найден — orphan (рендер всё равно поставит в конец
            // поста через resolveMountBlock, а в панели виден статус привязки);
            // якоря нет вовсе — ok, рендер тоже ставит в конец поста.
            const plainProse = prose.replace(/[*_~`#>]/g, '');
            const matchAnchor = (anchor) => {
                const clean = String(anchor ?? '').replace(/[*_~`#>]/g, '').trim();
                if (!clean) return { status: 'ok', span: null };
                const exact = findAnchorInText(prose, anchor) || findAnchorInText(plainProse, clean);
                if (exact) return { status: 'ok', span: exact };
                const fuzzy = findFuzzySpan(prose, anchor) || findFuzzySpan(plainProse, clean);
                if (fuzzy) return { status: 'fuzzy', span: fuzzy };
                return { status: 'orphan', span: null };
            };
            const recorded = parsed.artifacts.map((art, i) => {
                const { status } = matchAnchor(art.anchor);
                return {
                    id: `${proseDigest}:${i}`, type: art.type, anchor: art.anchor, status,
                    html: art.html, bytes: byteLength(art.html), createdAt: Date.now(), profileId: profile.id,
                };
            });

            // Commit-гард: прогон актуален и проза не сменилась за время генерации.
            // Индекс мог сдвинуться (удаление соседа) — пост ищем по dg_id.
            let live = deps.getMessage(messageId);
            if (!live || dgMessageId(live) !== runDgId) live = deps.getMessageByDgId?.(runDgId) ?? null;
            if (!live || !deps.coordinator.isCurrent(run) || digestForVariant(live, swipeIdx) !== proseDigest) {
                // Здесь попадают только завершённые ответы — терять их молча нельзя.
                notify.warn?.(!live
                    ? 'Diegetic: ответ не записан — пост исчез за время генерации'
                    : 'Diegetic: ответ не записан — пост изменился за время генерации');
                return;
            }

            const payload = stampPayload(live, swipeIdx, recorded);
            if (!payload || !writePayload(live, swipeIdx, payload)) return;
            await deps.persistChat();
            deps.notifyRender?.(messageId);

            const orphans = recorded.filter(a => a.status === 'orphan').length;
            if (orphans > 0) {
                notify.ready(`Diegetic: артефакт(ов): ${recorded.length} (${orphans} в конец поста — якорь не найден)`);
            } else {
                notify.ready(`Diegetic: артефакт(ов): ${recorded.length}`);
            }

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
     * Свой прогон координатора: свайп/правка/новая генерация этого поста
     * абортят платную генерацию (сигнал доезжает до URIS-моста), слот при
     * этом сбрасывается из loading обратно в pending.
     * opts.artifactId + opts.onlyOrdinal — точечная перегенерация одного слота;
     * opts.removeCardId — карточка URIS прошлого фото, удаляется после успеха.
     */
    async function _fillImageSlots(messageId, { artifactId = null, onlyOrdinal = null, removeCardId = null } = {}) {
        const s = deps.settings;
        if (s.imageMode === 'off') return;
        const run = deps.coordinator.beginRun(messageId, 'fill');
        try {
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
                    const res = await generateSlotImage(slot, { quality: s.imageQuality, imageSize: '1K', signal: run.ctrl.signal });
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
        } finally {
            deps.coordinator.endRun(run);
        }
    }

    /** Есть ли незаполненные фотослоты у артефактов сообщения (для 📷-кнопки). */
    function hasPendingPhotoSlots(messageId) {
        const m = deps.getMessage(messageId);
        if (!m) return false;
        const p = readVerifiedPayload(m, m.swipe_id ?? 0);
        return !!p?.artifacts.some(a => hasPendingSlots(a.html));
    }

    /**
     * Правка промпта фотослота из редактора (✎ в артефакте). Тот же digest-гард,
     * что у заливки фото: readVerifiedPayload отсекает чужие/протухшие payload'ы.
     * regenerate=true — сразу точечная перегенерация (старая карточка URIS
     * убирается после успеха); false — слот просто ждёт 📷/auto.
     */
    async function _updateSlotPrompt(messageId, artifactId, ordinal, { trigger = null, desc = '', regenerate = false } = {}) {
        const s = deps.settings;
        const msg = deps.getMessage(messageId);
        if (!msg) return;
        const swipeIdx = msg.swipe_id ?? 0;
        const p = readVerifiedPayload(msg, swipeIdx);
        if (!p) return;
        const idx = p.artifacts.findIndex(a => a.id === artifactId);
        if (idx < 0) return;
        const nextHtml = setSlotPrompt(p.artifacts[idx].html, ordinal, { trigger, desc });
        if (nextHtml === null) {
            notify.error('Diegetic: промпт фотослота пуст или слот не найден');
            return;
        }
        const artifacts = p.artifacts.slice();
        artifacts[idx] = { ...p.artifacts[idx], html: nextHtml, bytes: byteLength(nextHtml) };
        if (!writePayload(msg, swipeIdx, { ...p, artifacts })) return;
        await deps.persistChat();
        deps.notifyRender?.(messageId);
        if (regenerate && s.imageMode !== 'off') {
            await _fillImageSlots(messageId, {
                artifactId, onlyOrdinal: ordinal,
                removeCardId: slotCardId(nextHtml, ordinal),
            });
        }
    }

    // run() и fillImageSlots() никогда не реджектятся: обработчики событий fire-and-forget.
    const fillImageSlots = (messageId, opts = {}) =>
        _fillImageSlots(messageId, opts).catch((e) => notify.error(`Diegetic: сбой фотослотов (${e?.message || e})`));

    return {
        run: (messageId, opts = {}) =>
            _run(messageId, opts).catch((e) => notify.error(`Diegetic: сбой (${e?.message || e})`)),
        fillImageSlots,
        updateSlotPrompt: (messageId, artifactId, ordinal, opts = {}) =>
            _updateSlotPrompt(messageId, artifactId, ordinal, opts)
                .catch((e) => notify.error(`Diegetic: сбой промпта слота (${e?.message || e})`)),
        hasPendingPhotoSlots,
    };
}
