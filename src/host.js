// Транспортный слой поверх ctx SillyTavern.
// Всё общение с хостом (чат, генерация, CM, custom-endpoint) — только здесь;
// pipeline/ui/render видят узкие функции и не знают про SillyTavern.getContext.

import { getCtx, getApiKey } from './core.js';
import { normalizeCmProfiles, buildCmMessages, extractCmText, cmErrorMessage } from './cm.js';
import { classifyEndpoint, isOriginAllowed } from './endpoint-policy.js';

export function getMessage(id) {
    return getCtx()?.chat?.[Number(id)] ?? null;
}

export function getChat() {
    return getCtx()?.chat ?? [];
}

/** Запись чата на диск после мутации extra. Коммиты редки — коалесцер не нужен. */
export function persistChat() {
    return getCtx()?.saveChat?.();
}

export function listCmProfiles() {
    const list = getCtx()?.extensionSettings?.connectionManager?.profiles;
    return normalizeCmProfiles(Array.isArray(list) ? list : []);
}

// {{getvar::...}} и прочие макросы подставляет ядро ST — одинаково для всех источников.
function subst(ctx, text) {
    const s = String(text ?? '');
    try { return typeof ctx.substituteParams === 'function' ? ctx.substituteParams(s) : s; } catch { return s; }
}

async function generateViaCm({ system, user, profile, signal }) {
    const ctx = getCtx();
    const svc = ctx?.ConnectionManagerRequestService;
    if (!svc?.sendRequest) {
        throw new Error('Connection Manager недоступен — включи расширение connection-manager или выбери другой источник');
    }
    const profileId = profile?.sourceConfig?.profileId;
    if (!profileId) throw new Error('В профиле не выбран профиль подключения');
    // CM мог ещё не наполнить профили к первому запросу — одна передышка;
    // если и после неё список пуст, фейлим сразу и понятно.
    if (listCmProfiles().length === 0) {
        await new Promise(r => setTimeout(r, 300));
        if (listCmProfiles().length === 0) {
            throw new Error(`Профили Connection Manager не загружены — профиль «${profile?.sourceConfig?.profileName || profileId}» не найден. Проверь настройки CM или выбери другой источник`);
        }
    }
    // Доп. параметры запроса (например, отключение reasoning) — в payload.
    let override = {};
    const extraRaw = String(profile?.sourceConfig?.extraBody ?? '').trim();
    if (extraRaw) {
        try { override = JSON.parse(extraRaw); } catch { throw new Error('«Доп. параметры» — не JSON'); }
        if (!override || typeof override !== 'object' || Array.isArray(override)) throw new Error('«Доп. параметры» — должен быть JSON-объект');
    }
    let resp;
    try {
        resp = await svc.sendRequest(profileId, buildCmMessages({ system, user }), undefined,
            { stream: false, signal: signal || null, extractData: true, includePreset: false, includeInstruct: false }, override);
    } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError' || e?.cause?.name === 'AbortError') {
            throw new DOMException('Aborted', 'AbortError');
        }
        throw new Error(`Профиль «${profile?.sourceConfig?.profileName || profileId}»: ${cmErrorMessage(e)}`);
    }
    const text = extractCmText(resp);
    if (text === null) throw new Error('Профиль вернул ответ, но текст из него извлечь не удалось');
    return text;
}

async function generateViaCustom({ system, user, profile, signal }) {
    const sc = profile?.sourceConfig || {};
    // Политика эндпоинта: без учётных данных в URL; https — свободно, http —
    // только loopback, прочий plain-HTTP — по явному allowlist origin'ов.
    const ep = classifyEndpoint(sc.apiurl);
    if (!ep.ok) throw new Error(`custom endpoint: ${ep.error}`);
    if (ep.kind === 'insecure-http' && !isOriginAllowed(ep.origin, profile?.httpAllowList)) {
        throw new Error(`custom endpoint: plain-HTTP вне localhost запрещён — подтверди «${ep.origin}» в настройках источника`);
    }
    const key = (await getApiKey('source')) || '';
    let extra = {};
    const extraRaw = String(sc.extraBody ?? '').trim();
    if (extraRaw) {
        try { extra = JSON.parse(extraRaw); } catch { throw new Error('custom endpoint: «Доп. параметры» — не JSON'); }
        if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('custom endpoint: «Доп. параметры» — должен быть JSON-объект');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('custom endpoint: таймаут 5 мин')), 300_000);
    // Отмена могла прийти, пока шли await'ы выше (ключ, шаблон, контекст):
    // слушатель на уже-аборченном сигнале не сработает — проверяем состояние.
    const onAbort = () => ctrl.abort(signal.reason);
    if (signal?.aborted) ctrl.abort(signal.reason);
    else signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const res = await fetch(ep.normalized, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
            body: JSON.stringify({
                model: sc.model || undefined,
                messages: buildCmMessages({ system, user }),
                stream: false,
                ...extra, // например, отключение reasoning у конкретного провайдера
            }),
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`custom endpoint: HTTP ${res.status}`);
        const text = extractCmText(await res.json().catch(() => null));
        if (text === null) throw new Error('custom endpoint: не удалось извлечь текст из ответа');
        return text;
    } catch (e) {
        if (ctrl.signal.aborted && signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        // TypeError = fetch даже не получил ответ: CORS-блокировка или сеть.
        // Голый «Failed to fetch» пользователя ни к чему не ведёт.
        if (e instanceof TypeError) {
            throw new Error(`custom endpoint: ${e.message} — сервер не ответил. Проверь URL и CORS-политику: сервер должен отдавать Access-Control-Allow-Origin для запросов из браузера`);
        }
        throw e;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/**
 * Единая точка генерации. system/user — уже собранные части контракта;
 * макросы подставляются здесь для всех источников. Источники: профиль
 * Connection Manager или свой endpoint; «текущий API» хоста не используется.
 */
export async function generateText({ system, user, profile, signal }) {
    const ctx = getCtx();
    if (!ctx) throw new Error('контекст ST недоступен');
    const sys = subst(ctx, system);
    const usr = subst(ctx, user);
    if (profile?.source === 'custom') return generateViaCustom({ system: sys, user: usr, profile, signal });
    return generateViaCm({ system: sys, user: usr, profile, signal });
}
