/**
 * Владение прогоном генерации.
 *
 * Identity model (state self-contained — свой счётчик и слоты вместо общих):
 *   - chatEpoch (epoch) — счётчик «жизни чата», растёт ТОЛЬКО на смену чата /
 *     выключение (invalidateAll). После него все прежние прогоны устаревают.
 *   - messageRevision (revisions) — счётчик на сообщение; растёт при правке /
 *     свайпе / удалении ЭТОГО сообщения (bumpMessageRevision). Чужие прогоны
 *     не трогаются — свайп сообщения A не убивает генерацию сообщения B.
 *   - runToken (token) — уникальный id прогона; новый прогон того же сообщения
 *     сменяет прежний: его контроллер абортится, слот замещается.
 *
 * Прогон CURRENT ⇔ все три условия: он всё ещё владеет слотом контроллера
 * своего сообщения (identity), его revision не изменился, его снапшот epoch
 * активен и прогон не отменён пользователем (canceled).
 *
 * Ключ слота — СТАБИЛЬНЫЙ dg_id сообщения (не индекс mesid): ST перенумеровывает
 * mesid при удалении/перемещении постов, и клик отмены по свежему индексу не
 * находил бы прогон, запущенный под старым.
 */

/**
 * @returns {{
 *   beginRun(messageId: number|string, kind?: 'gen'|'fill'): { id: string, token: number, ctrl: AbortController, revision: number, epoch: number, kind: 'gen'|'fill', canceled: boolean },
 *   isCurrent(run: { id: string, ctrl: AbortController, revision: number, epoch: number } | null | undefined): boolean,
 *   endRun(run: { id: string, ctrl: AbortController } | null | undefined): boolean,
 *   abortKind(messageId: number|string, kind: 'gen'|'fill'): boolean,
 *   bumpMessageRevision(messageId: number|string): void,
 *   invalidateAll(): void,
 * }}
 */
export function createGenerationCoordinator() {
    /** @type {Record<string, number>} per-message revision counters */
    const revisions = {};
    /** @type {Record<string, object>} слот = сам объект прогона (kind, canceled живут в нём) */
    const controllers = {};
    let epoch = 0;
    let tokenSeq = 0;

    const revisionOf = (id) => revisions[id] ?? 0;

    /**
     * Инвалидация ОДНОГО сообщения: поднять revision и абортить его текущий
     * прогон (любого вида — свайп убивает и генерацию, и заливку фото).
     * Чужие сообщения не затрагиваются. Вызывать из onMsgSwiped / onMsgEdited
     * (и regenerate). Не ставит canceled: правка — не отказ от результата,
     * поздний ответ такого прогона пайплайн спасает.
     * @param {number|string} messageId
     */
    function bumpMessageRevision(messageId) {
        const id = String(messageId);
        revisions[id] = revisionOf(id) + 1;
        controllers[id]?.ctrl.abort();
    }

    /**
     * Инвалидация всего: поднять chatEpoch и абортить все активные прогоны.
     * Вызывать из onChatChanged / disable.
     */
    function invalidateAll() {
        epoch++;
        for (const rec of Object.values(controllers)) rec.ctrl.abort();
    }

    /**
     * Начать прогон сообщения. Новый прогон того же сообщения сменяет
     * предыдущий (его контроллер абортится, слот замещается).
     * kind — вид работ: 'gen' (генерация артефактов) или 'fill' (заливка фото):
     * один слот на оба вида, но abortKind отменяет только свой вид.
     * @param {number|string} messageId
     * @param {'gen'|'fill'} [kind]
     */
    function beginRun(messageId, kind = 'gen') {
        const id = String(messageId);
        controllers[id]?.ctrl.abort();
        const run = {
            id, token: ++tokenSeq, ctrl: new AbortController(),
            revision: revisionOf(id), epoch, kind, canceled: false,
        };
        controllers[id] = run;
        return run;
    }

    /**
     * Всё ещё владеет ли этот прогон сообщением? Единственный предикат
     * устаревания: после каждого await и прямо перед commit.
     * @param {{ id: string, ctrl: AbortController, revision: number, epoch: number } | null | undefined} run
     */
    function isCurrent(run) {
        if (!run) return false;
        const rec = controllers[run.id];
        return rec === run && !rec.canceled
            && revisionOf(run.id) === run.revision && run.epoch === epoch;
    }

    /**
     * Очистить слот прогона — но только если прогон всё ещё владелец.
     * finally-блок сменённого/отменённого прогона не должен тронуть слот
     * прогона, который его заменил. Возвращает true, если прогон был владельцем.
     * @param {{ id: string, ctrl: AbortController } | null | undefined} run
     */
    function endRun(run) {
        if (!run) return false;
        if (controllers[run.id] !== run) return false;
        delete controllers[run.id];
        return true;
    }

    /**
     * Отменить прогон заданного вида (повторный клик по кнопке = отмена).
     * true — был живой прогон ЭТОГО вида. Слот НЕ чистится: остаётся до
     * размотки прогона с флагом canceled — клики в этом окне остаются
     * отменой (идемпотентно), а не незаметным запуском новой генерации;
     * endRun снимет слот. Прогон другого вида не трогается: ◆ во время
     * заливки фото не убивает её.
     * @param {number|string} messageId
     * @param {'gen'|'fill'} kind
     */
    function abortKind(messageId, kind) {
        const id = String(messageId);
        const rec = controllers[id];
        if (!rec || rec.kind !== kind) return false;
        rec.canceled = true;
        rec.ctrl.abort();
        return true;
    }

    return { beginRun, isCurrent, endRun, abortKind, bumpMessageRevision, invalidateAll };
}
