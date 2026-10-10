/**
 * Владение прогоном генерации (порт Glosses generation-coordinator).
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
 * активен. Commit-гард пайплайна требует isCurrent(run), чтобы устаревший
 * прогон (например, с транспортом, игнорирующим AbortSignal) не перезаписал
 * более новый.
 */

/**
 * @returns {{
 *   beginRun(messageId: number|string): { id: string, token: number, ctrl: AbortController, revision: number, epoch: number },
 *   isCurrent(run: { id: string, ctrl: AbortController, revision: number, epoch: number } | null | undefined): boolean,
 *   endRun(run: { id: string, ctrl: AbortController } | null | undefined): boolean,
 *   bumpMessageRevision(messageId: number|string): void,
 *   invalidateAll(): void,
 * }}
 */
export function createGenerationCoordinator() {
    /** @type {Record<string, number>} per-message revision counters */
    const revisions = {};
    /** @type {Record<string, AbortController>} per-message run slots */
    const controllers = {};
    let epoch = 0;
    let tokenSeq = 0;

    const revisionOf = (id) => revisions[id] ?? 0;

    /**
     * Инвалидация ОДНОГО сообщения: поднять revision и абортить его текущий
     * прогон. Чужие сообщения не затрагиваются. Вызывать из onMsgSwiped /
     * onMsgEdited (и regenerate).
     * @param {number|string} messageId
     */
    function bumpMessageRevision(messageId) {
        const id = String(messageId);
        revisions[id] = revisionOf(id) + 1;
        controllers[id]?.abort();
    }

    /**
     * Инвалидация всего: поднять chatEpoch и абортить все активные прогоны.
     * Вызывать из onChatChanged / disable.
     */
    function invalidateAll() {
        epoch++;
        for (const ctrl of Object.values(controllers)) ctrl.abort();
    }

    /**
     * Начать прогон сообщения. Новый прогон того же сообщения сменяет
     * предыдущий (его контроллер абортится, слот замещается).
     * @param {number|string} messageId
     */
    function beginRun(messageId) {
        const id = String(messageId);
        controllers[id]?.abort();
        const ctrl = new AbortController();
        controllers[id] = ctrl;
        return { id, token: ++tokenSeq, ctrl, revision: revisionOf(id), epoch };
    }

    /**
     * Всё ещё владеет ли этот прогон сообщением? Единственный предикат
     * устаревания: после каждого await и прямо перед commit.
     * @param {{ id: string, ctrl: AbortController, revision: number, epoch: number } | null | undefined} run
     */
    function isCurrent(run) {
        if (!run) return false;
        return controllers[run.id] === run.ctrl
            && revisionOf(run.id) === run.revision
            && run.epoch === epoch;
    }

    /**
     * Очистить слот прогона — но только если прогон всё ещё владелец.
     * finally-блок сменённого прогона не должен тронуть слот прогона,
     * который его заменил. Возвращает true, если прогон был владельцем.
     * @param {{ id: string, ctrl: AbortController } | null | undefined} run
     */
    function endRun(run) {
        if (!run) return false;
        if (controllers[run.id] !== run.ctrl) return false;
        delete controllers[run.id];
        return true;
    }

    return { beginRun, isCurrent, endRun, bumpMessageRevision, invalidateAll };
}
