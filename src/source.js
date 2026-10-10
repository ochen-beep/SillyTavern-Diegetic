// Поле custom_api подтверждено в @types/function/generate.d.ts обеих версий раннера:
// { apiurl, key, model, source?, max_tokens, temperature, ... }.

export function generationIdFor(messageId, token) {
    return `diegetic:${messageId}:${token}`;
}

export function buildGenerateConfig({ prompt, profile, contextDepth, generationId }) {
    const cfg = {
        user_input: String(prompt ?? ''),
        max_chat_history: Math.max(1, Number(contextDepth) || 1),
        // undefined, не '': раннер подменяет falsy generation_id своим uuid — undefined честнее.
        generation_id: generationId == null || generationId === '' ? undefined : String(generationId),
        should_stream: false,
        should_silence: true,
    };
    if (profile?.source === 'custom' && profile.sourceConfig && profile.sourceConfig.apiurl) {
        const sc = profile.sourceConfig;
        cfg.custom_api = {
            apiurl: String(sc.apiurl),
            key: String(sc.key ?? ''),
            model: sc.model ? String(sc.model) : undefined,
            max_tokens: Number.isFinite(Number(sc.max_tokens)) ? Number(sc.max_tokens) : undefined,
            temperature: Number.isFinite(Number(sc.temperature)) ? Number(sc.temperature) : undefined,
        };
    }
    return cfg;
}
