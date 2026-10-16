// src/host.js — нативный транспортный слой поверх ctx SillyTavern.
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

// {{getvar::narlng}} и прочие макросы — подставляет ядро ST (раньше это молча
// делал раннер, причём CM-ветка их НЕ подставляла — теперь одинаково везде).
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
    // CM мог ещё не наполнить профили к первому запросу — короткое ожидание.
    for (let i = 0; i < 15 && listCmProfiles().length === 0; i++) {
        await new Promise(r => setTimeout(r, 300));
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
    const timer = setTimeout(() => ctrl.abort(new Error('custom endpoint: таймаут 60 с')), 60_000);
    const onAbort = () => ctrl.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
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
        throw e;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/**
 * Единая точка генерации. system/user — уже собранные части контракта;
 * макросы подставляются здесь для всех источников. «current» склеивает части
 * в один prompt для ctx.generateRaw (та же склейка, что делал assemblePrompt).
 */
export async function generateText({ system, user, profile, signal }) {
    const ctx = getCtx();
    if (!ctx) throw new Error('контекст ST недоступен');
    const sys = subst(ctx, system);
    const usr = subst(ctx, user);
    if (profile?.source === 'profile') return generateViaCm({ system: sys, user: usr, profile, signal });
    if (profile?.source === 'custom') return generateViaCustom({ system: sys, user: usr, profile, signal });
    const prompt = `${sys}\n\n### Post to analyze\n${usr}`;
    // generateRaw не принимает signal (его AbortController внутренний): мягкий
    // аборт — ожидание разматывается сразу, запрос догорает в фоне, а его
    // результат выбрасывает commit-гард isCurrent. Busy-индикатор при этом гаснет.
    if (!signal) return ctx.generateRaw({ prompt });
    return Promise.race([
        ctx.generateRaw({ prompt }),
        new Promise((_, rej) => {
            if (signal.aborted) rej(new DOMException('Aborted', 'AbortError'));
            else signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
    ]);
}
