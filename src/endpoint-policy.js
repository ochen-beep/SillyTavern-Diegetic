import { tr } from './i18n.js';

// Политика кастомного эндпоинта: без учётных данных в URL, https или
// loopback; plain-HTTP вне localhost — только по явному allowlist-origin.
// Чистые функции; confirm-UI живёт у вызывающего (index.js).

export function classifyEndpoint(raw) {
    const input = String(raw ?? '').trim();
    if (!input) return { ok: false, error: tr('Endpoint URL is empty.', 'diegetic.policy.urlEmpty') };
    let parsed;
    try { parsed = new URL(input); } catch { return { ok: false, error: tr('Invalid URL: «{input}».', 'diegetic.policy.urlInvalid').replace('{input}', input) }; };
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: tr('Only http:// and https:// are supported.', 'diegetic.policy.scheme') };
    if (parsed.username || parsed.password) return { ok: false, error: tr('The URL must not contain login/password — pass the key in the «API key» field.', 'diegetic.policy.credentials') };
    const hostname = parsed.hostname.toLowerCase();
    const loopback = hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
        || hostname === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
    // Нормализация: хвостовые слэши и /v1 схлопываются в .../v1/chat/completions,
    // query сохраняется, hash отбрасывается.
    parsed.hash = '';
    const query = parsed.search;
    parsed.search = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    const endpointPath = /\/chat\/completions$/i.test(path) ? path
        : /\/v1$/i.test(path) ? `${path}/chat/completions`
        : `${path}/v1/chat/completions`;
    return {
        ok: true,
        kind: parsed.protocol === 'https:' ? 'https' : loopback ? 'loopback-http' : 'insecure-http',
        normalized: `${parsed.origin}${endpointPath}${query}`,
        origin: parsed.origin,
    };
}

export function isOriginAllowed(origin, allowList) {
    if (!origin || !Array.isArray(allowList)) return false;
    let target;
    try { target = new URL(origin); } catch { return false; }
    return allowList.some((value) => {
        try {
            const allowed = new URL(String(value));
            return allowed.protocol === target.protocol
                && allowed.hostname === target.hostname
                && allowed.port === target.port;
        } catch { return false; }
    });
}

export function addToAllowList(origin, allowList) {
    const list = Array.isArray(allowList) ? [...allowList] : [];
    if (!origin || isOriginAllowed(origin, list)) return list;
    list.push(origin);
    return list;
}
