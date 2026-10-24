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
import { stashForUndo } from './undo.js';
import { tr } from './i18n.js';

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
        // Скрытый пост без force не генерим (см. onMessageReceived); force —
        // явный клик пользователя, ему разрешаем.
        if (!force && msg.is_hidden) return;
        const swipeIdx = msg.swipe_id ?? 0;
        const prose = variantText(msg, swipeIdx);
        if (!isViableMessageText(prose)) return;
        const proseDigest = contentDigest(prose);
        // Свежий payload (дайджест совпадает с текстом) — не дублим (force
        // перезаписывает тот же слот). Устаревший не блокирует: его содержание
        // принадлежит прежнему тексту, этот пост своих артефактов ещё не имел.
        // Чужой payload НЕ блокирует прогон: ST клонирует extra соседнего
        // варианта в слот нового свайпа — новый вариант артефактов не имеет,
        // генерируем, а не молча выходим.
        const rawPayload = readRawPayload(msg, swipeIdx);
        if (!force && rawPayload && !payloadBelongsToOtherVariant(msg, swipeIdx, rawPayload)
            && rawPayload.contentDigest === proseDigest) return;

        // Прогон ключуется стабильным dg_id, не индексом mesid (см. payload.js);
        // тот же dg_id — идентичность поста для коммита, который ищет его по dg_id.
        const runDgId = dgMessageId(msg, { create: true });
        const run = deps.coordinator.beginRun(runDgId);
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
                if (e?.name !== 'AbortError') {
                    // Б37: «Повторить» прямо из тоста ошибки.
                    notify.error(tr('Diegetic: generation failed ({error})', 'diegetic.toast.genFailed').replace('{error}', e?.message || e),
                        deps.retry ? { timeOut: 10_000, onclick: () => deps.retry(messageId) } : undefined);
                }
                return;
            }
            if (run.canceled) {
                // Транспорт, игнорирующий AbortSignal, всё же принёс ответ:
                // пользователь отказался от результата — не записываем.
                console.info('[Diegetic] ответ не записан: генерация отменена');
                return;
            }

            const parsed = parseDiegeticResponse(raw);
            if (parsed.artifacts.length === 0) {
                // Контракт запрещает отказ, так что это именно сбой модели.
                // Б37: «Повторить» из тоста — как и у сетевых ошибок.
                notify.error(parsed.errors[0]
                        ? tr('Diegetic: model returned no artifact ({error})', 'diegetic.toast.noArtifact').replace('{error}', parsed.errors[0])
                        : tr('Diegetic: model returned no artifact (no comment+fence pair)', 'diegetic.toast.noArtifactPlain'),
                    deps.retry ? { timeOut: 10_000, onclick: () => deps.retry(messageId) } : undefined);
                return;
            }
            // Часть пар не распарсилась — скажем, а не выкинем молча: по тосту
            // видно, почему при «3 артефакта» в посте оказался один.
            if (parsed.errors.length > 0) {
                notify.error(tr('Diegetic: discarded {n} from the reply ({errors})', 'diegetic.toast.discarded').replace('{n}', parsed.errors.length).replace('{errors}', parsed.errors.join('; ')));
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
                const bytes = byteLength(art.html);
                // Б20: огромный артефакт — предупреждение (b64-файл хранилища
                // растёт вдвое от размера HTML), но не отбраковка: ответ оплачен.
                if (bytes > 500_000) console.warn('[Diegetic] артефакт очень большой:', bytes, 'байт');
                return {
                    id: `${proseDigest}:${i}`, type: art.type, anchor: art.anchor, status,
                    html: art.html, bytes, createdAt: Date.now(), profileId: profile.id,
                };
            });
            const oversized = recorded.filter(a => a.bytes > 500_000).length;

            // Commit: пост ищем по dg_id — индексы чата сдвигаются (удаление
            // соседа). Ответ оплачен и не выбрасывается: если текст слота уехал
            // за время генерации (правка/свайп/новый прогон), payload пишется
            // с ИСХОДНЫМ дайджестом — рендер перепривяжет якоря сам
            // (rebindPayload), панель покажет запись как stale, а свайп назад
            // покажет артефакты без перегенерации.
            let live = deps.getMessage(messageId);
            if (!live || dgMessageId(live) !== runDgId) live = deps.getMessageByDgId?.(runDgId) ?? null;
            if (!live) {
                console.info('[Diegetic] ответ не записан: пост исчез за время генерации');
                notify.warn?.(tr('Diegetic: reply not recorded — the post disappeared while generating', 'diegetic.toast.notRecordedGone'));
                return;
            }
            const liveDigest = digestForVariant(live, swipeIdx);
            // Поздний ответ устаревшего прогона не затирает свежие артефакты,
            // уже показанные для текущего текста.
            const existing = readRawPayload(live, swipeIdx);
            if (existing && liveDigest === existing.contentDigest && liveDigest !== proseDigest) {
                console.info('[Diegetic] ответ не записан: у поста уже есть свежие артефакты');
                notify.warn?.(tr('Diegetic: reply not recorded — the post already has fresh artifacts', 'diegetic.toast.notRecordedFresh'));
                return;
            }
            const payload = stampPayload(live, swipeIdx, recorded, { digest: proseDigest });
            if (!payload || !writePayload(live, swipeIdx, payload)) {
                console.info('[Diegetic] ответ не записан: слот недоступен для записи');
                return;
            }
            // Перезапись существующего payload'а — обратима в течение окна (Б24):
            // прежние артефакты прячутся, тост успеха получает «Отменить».
            const undo = existing ? stashForUndo(live, swipeIdx, existing) : null;
            await deps.persistChat();
            deps.notifyRender?.(messageId);

            const drifted = liveDigest !== proseDigest;
            const orphans = recorded.filter(a => a.status === 'orphan').length;
            const over = recorded.length > s.maxPerMessage
                ? tr(' (model returned {n} when {m} were requested)', 'diegetic.toast.overCount').replace('{n}', recorded.length).replace('{m}', s.maxPerMessage) : '';
            const notes = [];
            if (drifted) notes.push(tr('the post changed during generation — anchors rebound', 'diegetic.toast.noteDrifted'));
            if (orphans > 0) notes.push(tr('{n} moved to the end of the post — anchor not found', 'diegetic.toast.noteOrphan').replace('{n}', orphans));
            if (oversized > 0) notes.push(tr('{n} huge — storage will grow', 'diegetic.toast.noteOversized').replace('{n}', oversized));
            console.info(`[Diegetic] записано артефакт(ов): ${recorded.length}${drifted ? ' (спасены: текст уехал за время генерации)' : ''}`);
            notify.ready(tr('Diegetic: artifacts: {n}', 'diegetic.toast.recorded').replace('{n}', recorded.length) + over + (notes.length ? ' — ' + notes.join(', ') : ''),
                undo
                    ? {
                        timeOut: 10_000,
                        onclick: () => {
                            if (undo()) {
                                void deps.persistChat?.();
                                deps.notifyRender?.(messageId);
                                notify.ready(tr('Diegetic: regeneration undone — previous artifacts restored', 'diegetic.toast.regenUndone'));
                            }
                        },
                    }
                    : undefined);

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
        const msg0 = deps.getMessage(messageId);
        if (!msg0) return;
        const run = deps.coordinator.beginRun(dgMessageId(msg0, { create: true }), 'fill');
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
            if (firstError) notify.error(tr('Diegetic: photo not generated ({error})', 'diegetic.toast.photoFailed').replace('{error}', firstError?.message || firstError));
            else notify.ready(tr('Diegetic: photo ready', 'diegetic.toast.photoReady'));
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
            notify.error(tr('Diegetic: photo slot prompt is empty or slot not found', 'diegetic.toast.slotPromptEmpty'));
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
        _fillImageSlots(messageId, opts).catch((e) => notify.error(tr('Diegetic: photo slots failure ({error})', 'diegetic.toast.photoCrash').replace('{error}', e?.message || e)));

    return {
        run: (messageId, opts = {}) =>
            _run(messageId, opts).catch((e) => notify.error(tr('Diegetic: failure ({error})', 'diegetic.toast.genCrash').replace('{error}', e?.message || e))),
        fillImageSlots,
        updateSlotPrompt: (messageId, artifactId, ordinal, opts = {}) =>
            _updateSlotPrompt(messageId, artifactId, ordinal, opts)
                .catch((e) => notify.error(tr('Diegetic: slot prompt failure ({error})', 'diegetic.toast.slotPromptCrash').replace('{error}', e?.message || e))),
        hasPendingPhotoSlots,
    };
}
