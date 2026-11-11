// Транспортный слой поверх ctx SillyTavern.
// Всё общение с хостом (чат, генерация, CM, custom-endpoint) — только здесь;
// pipeline/ui/render видят узкие функции и не знают про SillyTavern.getContext.

import { getCtx, getApiKey } from './core.js';
import { normalizeCmProfiles, buildCmMessages, extractCmText, cmErrorMessage } from './cm.js';
import { classifyEndpoint, isOriginAllowed } from './endpoint-policy.js';
import { tr } from './i18n.js';

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

async function generateViaCm({ system, user, profile, signal, stream }) {
    const ctx = getCtx();
    const svc = ctx?.ConnectionManagerRequestService;
    if (!svc?.sendRequest) {
        throw new Error(tr('Connection Manager unavailable — enable the connection-manager extension or pick another source', 'diegetic.host.cmUnavailable'));
    }
    const profileId = profile?.sourceConfig?.profileId;
    if (!profileId) throw new Error(tr('No connection profile selected in the profile', 'diegetic.host.cmNoProfile'));
    // CM мог ещё не наполнить профили к первому запросу — одна передышка;
    // если и после неё список пуст, фейлим сразу и понятно.
    if (listCmProfiles().length === 0) {
        await new Promise(r => setTimeout(r, 300));
        if (listCmProfiles().length === 0) {
            throw new Error(tr('Connection Manager profiles not loaded — profile «{name}» not found. Check CM settings or pick another source', 'diegetic.host.cmProfilesMissing').replace('{name}', profile?.sourceConfig?.profileName || profileId));
        }
    }
    // Доп. параметры запроса (например, отключение reasoning) — в payload.
    // Топ-левел доходят до нативных источников ST (OpenAI и др. читают их сами),
    // custom_include_body — обход whitelist'а сервера ST для CUSTOM-источников,
    // где неизвестные топ-левел ключи отбрасываются до отправки провайдеру.
    // «stream» в extraBody запрещён: им управляет тумблер, ручной stream:true
    // сломал бы разбор SSE-ответа.
    let extra = {};
    const extraRaw = String(profile?.sourceConfig?.extraBody ?? '').trim();
    if (extraRaw) {
        try { extra = JSON.parse(extraRaw); } catch { throw new Error(tr('«Extra params» — not JSON', 'diegetic.host.extraNotJson')); }
        if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error(tr('«Extra params» — must be a JSON object', 'diegetic.host.extraNotObject'));
        if ('stream' in extra) throw new Error(tr('«Extra params» must not set "stream" — it is controlled by the Streaming toggle', 'diegetic.host.streamForbidden'));
    }
    const override = Object.keys(extra).length ? { ...extra, custom_include_body: extra } : {};
    let resp;
    try {
        resp = await svc.sendRequest(profileId, buildCmMessages({ system, user }), undefined,
            { stream: stream === true, signal: signal || null, extractData: true, includePreset: false, includeInstruct: false }, override);
    } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError' || e?.cause?.name === 'AbortError') {
            throw new DOMException('Aborted', 'AbortError');
        }
        throw new Error(tr('Profile «{name}»: {msg}', 'diegetic.host.cmProfileError').replace('{name}', profile?.sourceConfig?.profileName || profileId).replace('{msg}', cmErrorMessage(e)));
    }
    // stream:true возвращает фабрику AsyncGenerator'а (чанки несут накопленный
    // текст); некоторые API стрим не умеют — сервис тогда отвечает объектом.
    let text = null;
    if (typeof resp === 'function') {
        text = '';
        try {
            for await (const chunk of resp()) {
                if (typeof chunk?.text === 'string') text = chunk.text;
            }
        } catch (e) {
            // Abort может приехать уже из итерации (cancel посреди потока),
            // когда sendRequest давно разрешён — маппим так же, как его ошибку.
            if (signal?.aborted || e?.name === 'AbortError' || e?.cause?.name === 'AbortError') {
                throw new DOMException('Aborted', 'AbortError');
            }
            throw e;
        }
        if (!text) text = null;
    } else {
        text = extractCmText(resp);
    }
    if (text === null) throw new Error(tr('The profile returned a reply but its text could not be extracted', 'diegetic.host.cmNoText'));
    return text;
}

// SSE-поток OpenAI-совместимого стрима → текст. Терпит мусор диких прокси:
// usage-чанки с пустым choices, пустые delta, reasoning_content, keep-alive
// комментарии (': ping'), не-JSON строки; [DONE] — терминатор.
async function readSseText(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return text;
            let json;
            try { json = JSON.parse(payload); } catch { continue; }
            const delta = json?.choices?.[0]?.delta;
            if (typeof delta?.content === 'string') text += delta.content;
        }
    }
    return text;
}

async function generateViaCustom({ system, user, profile, signal, stream }) {
    const sc = profile?.sourceConfig || {};
    // Политика эндпоинта: без учётных данных в URL; https — свободно, http —
    // только loopback, прочий plain-HTTP — по явному allowlist origin'ов.
    const ep = classifyEndpoint(sc.apiurl);
    if (!ep.ok) throw new Error(`custom endpoint: ${ep.error}`);
    if (ep.kind === 'insecure-http' && !isOriginAllowed(ep.origin, profile?.httpAllowList)) {
        throw new Error(tr('custom endpoint: plain-HTTP outside localhost is forbidden — confirm «{origin}» in source settings', 'diegetic.host.customInsecure').replace('{origin}', ep.origin));
    }
    const key = (await getApiKey('source')) || '';
    let extra = {};
    const extraRaw = String(sc.extraBody ?? '').trim();
    if (extraRaw) {
        try { extra = JSON.parse(extraRaw); } catch { throw new Error(tr('custom endpoint: «Extra params» — not JSON', 'diegetic.host.customExtraNotJson')); }
        if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error(tr('custom endpoint: «Extra params» — must be a JSON object', 'diegetic.host.customExtraNotObject'));
        if ('stream' in extra) throw new Error(tr('«Extra params» must not set "stream" — it is controlled by the Streaming toggle', 'diegetic.host.streamForbidden'));
    }
    const ctrl = new AbortController();
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
                stream: stream === true,
                ...extra, // например, отключение reasoning у конкретного провайдера
            }),
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(tr('custom endpoint: HTTP {status}', 'diegetic.host.customHttp').replace('{status}', res.status));
        // Стриминг — против таймаутов прокси (Cloudflare 524 на долгих нестриминговых
        // ответах): текст копится из delta.content, прогрессивный вывод не нужен.
        let text;
        if (stream) {
            text = await readSseText(res.body);
            if (!text) text = null;
        } else {
            text = extractCmText(await res.json().catch(() => null));
        }
        if (text === null) throw new Error(tr('custom endpoint: could not extract text from the reply', 'diegetic.host.customNoText'));
        return text;
    } catch (e) {
        if (ctrl.signal.aborted && signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        // TypeError = fetch даже не получил ответ: CORS-блокировка или сеть.
        // Голый «Failed to fetch» пользователя ни к чему не ведёт.
        if (e instanceof TypeError) {
            throw new Error(tr('custom endpoint: {msg} — the server did not respond. Check the URL and CORS policy: the server must send Access-Control-Allow-Origin for browser requests', 'diegetic.host.customNetwork').replace('{msg}', e.message));
        }
        throw e;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
}

/**
 * Единая точка генерации. system/user — уже собранные части контракта;
 * макросы подставляются здесь для всех источников. Источники: профиль
 * Connection Manager или свой endpoint; «текущий API» хоста не используется.
 */
export async function generateText({ system, user, profile, signal, stream }) {
    const ctx = getCtx();
    if (!ctx) throw new Error(tr('ST context unavailable', 'diegetic.host.noCtx'));
    const sys = subst(ctx, system);
    const usr = subst(ctx, user);
    if (profile?.source === 'custom') return generateViaCustom({ system: sys, user: usr, profile, signal, stream });
    return generateViaCm({ system: sys, user: usr, profile, signal, stream });
}
