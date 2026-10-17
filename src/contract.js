// Неизменяемое машинное ядро формата: ломать его = ломать src/parser.js.
// Стиль, язык и диегетичность живут в templates/*.md — контракт содержит только
// то, что код реально парсит и валидирует. Промпты — только на английском.

export const DIEGETIC_CONTRACT = `### TOOL — DIEGETIC HTML (response contract)

For the post you receive, return exactly {{MAX_COUNT}} artifact(s). Making an artifact is MANDATORY:
you do not decide whether to make one — you only choose the type, medium and content.

**Response format (DO NOT DEVIATE)**
Each artifact is exactly one pair:
1) an HTML comment \`<!--DIEGETIC {"type":"<type>","anchor":"<verbatim short phrase from the post>"}-->\`
2) immediately followed by a single \`\`\`html fenced block containing a full document with \`<body>...</body>\`.
- "anchor" — a VERBATIM short phrase (2–6 words) copied from the post, next to which the artifact
  is embedded into the scene. Do not paraphrase, do not alter punctuation. The phrase must occur once.
- Triple backticks inside the fenced block are forbidden. Keep the artifact compact and self-contained;
  external libraries only when the medium truly requires them; fonts via @import are always fine.
- Height follows content: no min-height/height: 100vh (or 100svh/100dvh) on body or the scene —
  the artifact is embedded in the post and does not need screen height.
- Refusal is not allowed. An empty reply, "nothing comes to mind", "does not fit" — all contract
  violations: pure dialogue is a chat on a screen, reflection is a note, a scene change is a signboard.
  Every post has a suitable medium — find it and execute it.`;

/** Сигнатура уже вставленного контракта: старые шаблоны с контрактом,
 *  вписанным целиком, не должны получить его вторым экземпляром. */
const CONTRACT_SIGNATURE = '### TOOL — DIEGETIC HTML';

/**
 * Раздельная сборка: system = шаблон+контракт, user = контекст+пост.
 * assemblePrompt — те же части, склеенные в одну строку для generateRaw.
 * Идемпотентно: контракт вставляется ровно один раз — по {{CONTRACT}}, а если
 * плейсхолдера нет и контракт уже вписан в шаблон текстом, повторно не дописывается.
 */
export function assemblePromptParts({ templateText, postText, contextBlock = '', maxCount = 1 }) {
    maxCount = Math.max(1, Math.min(5, Number(maxCount) || 1));
    const template = String(templateText ?? '');
    let withContract;
    if (template.includes('{{CONTRACT}}')) {
        withContract = template.replaceAll('{{CONTRACT}}', DIEGETIC_CONTRACT);
    } else if (template.includes(CONTRACT_SIGNATURE)) {
        withContract = template; // контракт уже внутри — не дублируем
    } else {
        withContract = template.trim() + '\n\n' + DIEGETIC_CONTRACT;
    }
    const filled = withContract.replace(/\{\{MAX_COUNT\}\}/gu, String(maxCount));
    const user = contextBlock
        ? `Context of earlier messages:\n${contextBlock}\n\nPost (create an artifact for it):\n${postText}`
        : `Post (create an artifact for it):\n${postText}`;
    return { system: filled.trim(), user };
}

export function assemblePrompt({ templateText, postText, contextBlock = '', maxCount = 1 }) {
    const { system, user } = assemblePromptParts({ templateText, postText, contextBlock, maxCount });
    return `${system}\n\n### Post to analyze\n${user}`;
}
