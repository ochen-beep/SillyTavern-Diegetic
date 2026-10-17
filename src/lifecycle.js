// Сериализация init-прогонов + токен отмены. ST ждёт промисы хуков,
// но сигнала отмены расширению не даёт — токен локальный.
export function createInitializationController(run) {
    let generation = 0;
    let active = false;
    let currentPromise = null;
    let queued = false;

    function start() {
        const wasActive = active;
        active = true;
        if (currentPromise) {
            if (!wasActive) queued = true;
            return currentPromise;
        }
        const runGeneration = ++generation;
        currentPromise = Promise.resolve()
            .then(() => run(() => !active || runGeneration !== generation))
            .finally(() => {
                currentPromise = null;
                if (queued && active) {
                    queued = false;
                    start();
                }
            });
        return currentPromise;
    }

    function stop() {
        active = false;
        queued = false;
        generation++;
    }

    async function whenIdle() {
        while (currentPromise) await currentPromise;
    }

    return { start, stop, whenIdle, isActive: () => active };
}
