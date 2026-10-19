// Неизменяемое машинное ядро формата: ломать его = ломать src/parser.js.
// Стиль, язык и диегетичность живут в templates/*.md — контракт содержит только
// то, что код реально парсит и валидирует. Промпты — только на английском.

export const DIEGETIC_CONTRACT = `### TOOL — DIEGETIC HTML (response contract)

Return exactly {{MAX_COUNT}} artifact(s).

For each artifact, output one pair in order:
<!--DIEGETIC {"type":"<type>","anchor":"<anchor>"}-->
\`\`\`html
<html>...<body>...</body>...</html>
\`\`\`

- The metadata comment must contain valid JSON with exactly the keys "type" and "anchor".
- "type" is a short string label.
- "anchor" is a verbatim 2–6-word phrase from the post in its original wording; use "" if no suitable anchor exists.
- Use one \`\`\`html fenced block per artifact and close every fence.
- Do not place \`\`\` or a JSON DIEGETIC metadata comment inside the artifact HTML.
- Return the artifact pair(s) only.`;

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
    + ' Do not retell, clean up or reformat the post text.'
    + ' Prefer a context-specific living object or environment with causal, tactile interaction'
    + ' over a static panel whose clicks only replace text.';

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
