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
  Every post has a suitable medium — find it and execute it.
- Meta carries EXACTLY the keys "type" and "anchor" — no other keys.
- ALWAYS close the \`\`\`html fence. An unclosed fence is a contract violation.
- The artifact is a NEW physical object you design (a note, a ticket, a device, a signboard);
  it is NEVER a retelling or a reformatting of the post text.

**Example of one pair — format only, never reuse its content:**
<!--DIEGETIC {"type":"ticket","anchor":"verbatim short phrase from the post"}-->
\`\`\`html
<!DOCTYPE html><html><head><meta charset="utf-8"><style>.t{font-family:serif}</style></head>
<body><div class="t"><h3>THEATRE TICKET</h3><p>Row 3, Seat 12 — admit one</p></div></body></html>
\`\`\``;

/** Сигнатура уже вставленного контракта: старые шаблоны с контрактом,
 *  вписанным целиком, не должны получить его вторым экземпляром. */
const CONTRACT_SIGNATURE = '### TOOL — DIEGETIC HTML';

/**
 * Убрать из поста блоки reasoning RP-модели. Пост приходит как сохранённый
 * ST `mes` и может начинаться с <think>…</think> чужого размышления: модель
 * артефакта читает его как задачу «очисти текст от think» и перепечатывает
 * пост вместо создания артефакта.
 *
 * Два случая незакрытого <think>:
 *  1) Тег <think> в самом начале `mes` без `</think>` — артефакт ST при
 *     вынесенном `extra.reasoning` (префикс `<think>` остался перед чистовиком
 *     поста). Срезать до конца здесь нельзя: это сотрёт весь пост. Срезается
 *     только сам сиротский тег `<think>`.
 *  2) Незакрытый <think> после текста — обрыв генерации: срезается до конца.
 */
export function stripReasoning(text) {
    const s = String(text ?? '');
    const withoutClosed = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    const open = withoutClosed.search(/<think>/i);
    if (open < 0) return withoutClosed.replace(/<\/think>/gi, '').trim();
    const before = withoutClosed.slice(0, open).trim();
    if (!before) {
        return withoutClosed.slice(open + '<think>'.length).replace(/<\/?think>/gi, '').trim();
    }
    return before;
}

// Пост обёрнут в делимитеры, а задача повторена ПОСЛЕ него: длинный контекст
// (персоны/лор) в начале user-сообщения забивает инструкцию, и модель
// отвечает пересказом поста. Напоминание в хвосте работает на recency.
const POST_TASK_REMINDER = '\n\nRespond ONLY with the artifact pair(s) defined by the system contract'
    + ' above: one <!--DIEGETIC {...}--> comment + one ```html fenced block each.'
    + ' Do not retell, clean up or reformat the post text.';

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
    const post = stripReasoning(postText);
    // Задача — первой строкой: длинный контекст (персоны/лор) не должен
    // восприниматься как основное содержимое запроса. Без количества (оно
    // живёт в контракте: дублирование провоцировало «нарежь пост на части»)
    // и без «from the post» (читалось как «переработай текст поста»).
    const task = 'TASK: Design new diegetic HTML object(s) for the scene in the post below,'
        + ' following the system contract. The post is source material to read — never text to output.';
    const background = ' The context in the middle is background only — it is never the artifact target.';
    const user = contextBlock
        ? `${task}${background}\n\nContext of earlier messages:\n${contextBlock}\n\nPost (the artifact target):\n<post>\n${post}\n</post>${POST_TASK_REMINDER}`
        : `${task}\n\nPost (the artifact target):\n<post>\n${post}\n</post>${POST_TASK_REMINDER}`;
    return { system: filled.trim(), user };
}

export function assemblePrompt({ templateText, postText, contextBlock = '', maxCount = 1 }) {
    const { system, user } = assemblePromptParts({ templateText, postText, contextBlock, maxCount });
    return `${system}\n\n### Post to analyze\n${user}`;
}
