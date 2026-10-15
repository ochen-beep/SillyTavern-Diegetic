// src/host.js — нативный транспортный слой поверх ctx SillyTavern.
// Всё общение с хостом (чат, генерация, CM, custom-endpoint) — только здесь;
// pipeline/ui/render видят узкие функции и не знают про SillyTavern.getContext.

import { getCtx, getApiKey } from './core.js';
import { normalizeCmProfiles, buildCmMessages, extractCmText, cmErrorMessage } from './cm.js';

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
    let resp;
    try {
        resp = await svc.sendRequest(profileId, buildCmMessages({ system, user }), undefined,
            { stream: false, signal: signal || null, extractData: true, includePreset: false, includeInstruct: false });
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
    const url = String(sc.apiurl || '').trim().replace(/\/+$/, '');
    // ponytail: только https; http разрешён на loopback — вместо allow-list/confirm-UI из Glosses
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)(:\d+)?\//i.test(url + '/')) {
        throw new Error('custom endpoint: нужен https (http — только localhost)');
    }
    const key = (await getApiKey(profile.id)) || String(sc.key ?? '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('custom endpoint: таймаут 60 с')), 60_000);
    const onAbort = () => ctrl.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const res = await fetch(`${url}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
            body: JSON.stringify({
                model: sc.model || undefined,
                messages: buildCmMessages({ system, user }),
                stream: false,
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
    return ctx.generateRaw({ prompt: `${sys}\n\n### Источник анализа\n${usr}` });
}
