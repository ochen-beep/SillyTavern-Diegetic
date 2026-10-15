// src/ui.js — настройки в разделе «Расширения» таверны (inline-drawer, форма
// Glosses), плавающей панели и FAB/QR-лаунчера больше нет: действия у поста —
// кнопки в .mes_buttons (render.js). Делегированные обработчики — на document
// в namespace .diegetic (off перед bind: повторный init не задваивает их).
import { readRawPayload, digestForVariant } from './payload.js';

/** Чистая: строки списка артефактов для панели — скан extra всего чата.
 *  msgId — это индекс в массиве chat. Статус stale: digest payload разошёлся
 *  с текстом (правка/свайп) — render.js перепривяжет при следующей отрисовке. */
export function collectRows(chat) {
    const rows = [];
    (Array.isArray(chat) ? chat : []).forEach((msg, msgId) => {
        if (!msg || typeof msg !== 'object') return;
        const idx = msg.swipe_id ?? 0;
        const payload = readRawPayload(msg, idx);
        if (!payload) return;
        const stale = payload.contentDigest !== digestForVariant(msg, idx);
        for (const a of payload.artifacts) {
            rows.push({ ...a, msgId, status: stale ? 'stale' : a.status });
        }
    });
    rows.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    return rows;
}

const CSS = `
#dg-ext .dg-body { font-size: 13px; line-height: 1.45; }
#dg-ext .dg-section { border-top: 1px dashed var(--SmartThemeBorderColor, rgba(255,255,255,.12));
  padding: 10px 0 4px; margin-top: 6px; }
#dg-ext .dg-title { font-weight: 600; font-size: 12.5px; margin: 0 0 7px; opacity: .85; }
#dg-ext .dg-hint { opacity: .6; font-size: 12px; margin: 4px 0 0; }
#dg-ext select, #dg-ext input[type=text], #dg-ext input[type=number], #dg-ext input[type=password],
#dg-ext textarea { width: 100%; box-sizing: border-box; background: var(--black30, rgba(0,0,0,.25));
  color: var(--SmartThemeBodyColor, #ddd); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.15));
  border-radius: 8px; padding: 6px 8px; font-size: 13px; }
#dg-ext textarea { resize: vertical; font-family: var(--monoFontFamily, monospace); font-size: 12px; }
#dg-ext select:focus, #dg-ext input:focus, #dg-ext textarea:focus {
  outline: 1px solid var(--SmartThemeEmColor, #c9a86a); }
#dg-ext .dg-btn { cursor: pointer; border-radius: 8px; padding: 6px 12px; font-size: 13px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  background: var(--black30, rgba(0,0,0,.25)); color: var(--SmartThemeBodyColor, #ddd); }
#dg-ext .dg-btn:hover { border-color: var(--SmartThemeEmColor, #c9a86a); }
#dg-ext .dg-btn-primary { width: 100%; padding: 9px 12px; font-weight: 600; font-size: 14px;
  border: none; background: var(--SmartThemeEmColor, #c9a86a); color: var(--black300, #16161a); }
#dg-ext .dg-btn-primary:hover { filter: brightness(1.1); }
#dg-ext .dg-genrow { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
#dg-ext .dg-genrow input[type=number] { width: 76px; }
#dg-ext .dg-srcgrid { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; }
#dg-ext .dg-srcgrid label { opacity: .75; }
#dg-ext .dg-autoline { display: flex; align-items: center; gap: 8px;
  color: var(--SmartThemeEmColor, #c9a86a); }
#dg-ext details { margin-top: 4px; }
#dg-ext summary { cursor: pointer; font-weight: 600; font-size: 12.5px; opacity: .85;
  padding: 3px 0; list-style-position: inside; }
#dg-ext details[open] summary { margin-bottom: 7px; }
#dg-ext .dg-row { display: flex; gap: 6px; align-items: center; padding: 5px 0;
  border-bottom: 1px dashed var(--SmartThemeBorderColor, rgba(255,255,255,.08)); }
#dg-ext .dg-row:last-child { border-bottom: none; }
#dg-ext .dg-type { font-weight: 600; }
#dg-ext .dg-status { margin-left: auto; opacity: .7; font-size: 12px; }
#dg-ext .dg-status.orphan { color: #ffb86b; opacity: 1; }
#dg-ext .dg-status.fuzzy { color: #9ad1ff; opacity: 1; }
#dg-ext .dg-status.stale { color: #ff8b8b; opacity: 1; }
#dg-ext .dg-row .dg-btn { padding: 2px 8px; }
#dg-ext .dg-switch { position: relative; width: 34px; height: 19px; flex: none; cursor: pointer; }
#dg-ext .dg-switch input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
#dg-ext .dg-switch i { position: absolute; inset: 0; border-radius: 19px; transition: background .15s;
  background: var(--black30, rgba(0,0,0,.4)); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  pointer-events: none; /* иначе <i> перекрывает input и свитч никогда не кликается */ }
#dg-ext .dg-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px;
  border-radius: 50%; background: var(--SmartThemeBodyColor, #ddd); transition: left .15s; }
#dg-ext .dg-switch input:checked + i { background: var(--SmartThemeEmColor, #c9a86a); }
#dg-ext .dg-switch input:checked + i::after { left: 17px; background: var(--black300, #16161a); }
#dg-ext .dg-switch input:focus-visible + i { outline: 2px solid var(--SmartThemeEmColor, #c9a86a); }
#dg-ext .dg-empty { opacity: .6; font-style: italic; }
.dg-shell { margin: 10px 0; position: relative; }
.dg-frame { width: 100%; border: 0; display: block; min-height: 80px; border-radius: 10px; }
.dg-chiprow { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.dg-chip, .dg-chip-action { cursor: pointer; border-radius: 8px; padding: 6px 14px; font-size: 13px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  background: var(--black30, rgba(0,0,0,.25)); color: var(--SmartThemeBodyColor, #ddd); }
.dg-chip { font-weight: 600; }
.dg-chip:hover, .dg-chip-action:hover { border-color: var(--SmartThemeEmColor, #c9a86a); }
.dg-popup { position: fixed; inset: 0; z-index: 2999; }
.dg-popup-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.6); }
.dg-popup-dialog { position: relative; margin: 5vh auto; width: min(780px, 94vw); height: 84vh;
  background: var(--SmartThemeBlurTintColor, #1e1e22); border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.15)); }
.dg-popup-dialog header { display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.12)); }
.dg-popup-dialog iframe { flex: 1; width: 100%; border: 0; }
.dg-popup-close { cursor: pointer; background: none; border: none; font-size: 18px;
  color: var(--SmartThemeBodyColor, #ddd); }
/* Фотослоты (мост URIS): состояния живут на элементе с data-dg-img внутри артефакта */
[data-dg-img-state="loading"]::after { content: ''; position: absolute; inset: 0; z-index: 2;
  background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.16) 50%, transparent 70%);
  background-size: 200% 100%; animation: dgShimmer 1.4s linear infinite; }
@keyframes dgShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
[data-dg-img-state="error"] { outline: 1px dashed rgba(255,120,120,.55); outline-offset: -1px; }
.dg-slot-regen { position: absolute; right: 6px; bottom: 6px; z-index: 3; width: 22px; height: 22px;
  border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 13px; line-height: 21px;
  text-align: center; cursor: pointer; opacity: 0; transition: opacity .15s;
  border: 1px solid rgba(255,255,255,.3); user-select: none; }
[data-dg-img]:hover .dg-slot-regen { opacity: 1; }
`;

// type/status приходят из вывода модели, name/id — из настроек, исключения пишет
// пользователь: всё это попадает в документ через .html() — только через esc.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SOURCE_LABELS = { current: 'Текущий API SillyTavern', profile: 'Профиль подключения (Connection Manager)', custom: 'Свой endpoint (OpenAI-совместимый)' };
const DISPLAY_LABELS = { inline: 'Сразу в посте', expand: 'Кнопка → развернуть в посте', popup: 'Кнопка → во всплывающем окне' };

/** Чистая: подпись источника профиля для подсказки под селектом шаблона. */
export function describeSource(p) {
    if (!p) return '';
    if (p.source === 'profile') return `Источник: профиль подключения${p.sourceConfig?.profileName ? ` «${p.sourceConfig.profileName}»` : ''}`;
    if (p.source === 'custom') return `Источник: свой endpoint${p.sourceConfig?.apiurl ? ` (${p.sourceConfig.apiurl})` : ''}`;
    return 'Источник: текущий API SillyTavern';
}

export function mountPanel(deps) {
    const $ = deps.$;
    const doc = document;

    // Idempotent-remount: повторный init не плодит дубли.
    for (const id of ['dg-style', 'dg-ext']) {
        doc.getElementById(id)?.remove();
    }

    const style = doc.createElement('style');
    style.id = 'dg-style';
    style.textContent = CSS;
    doc.head.appendChild(style);

    // Секция в «Расширения» — стандартный inline-drawer (форма Glosses).
    const container = doc.createElement('div');
    container.id = 'dg-ext';
    container.className = 'extension_block';
    container.innerHTML = `
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>◆ Diegetic</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content"><div class="dg-body"></div></div>
      </div>`;
    const hostEl = doc.getElementById('extensions_settings');
    if (!hostEl) return { render() {} };
    hostEl.appendChild(container);
    const panel = container.querySelector('.dg-body');

    const sourceOpts = (sel) => ['current', 'profile', 'custom']
        .map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${SOURCE_LABELS[s]}</option>`).join('');
    const displayOpts = (sel) => ['inline', 'expand', 'popup']
        .map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${DISPLAY_LABELS[s]}</option>`).join('');

    const render = () => {
        // Шаблон — async (fetch встроенного файла основы профиля).
        const st0 = deps.settings();
        const active0 = st0.profiles.find(p => p.id === st0.activeProfile) || st0.profiles[0];
        deps.getBuiltinTemplate(active0?.builtin).then((builtin) => {
            const rows = deps.listArtifacts();
            const items = rows.map(r => `
          <div class="dg-row" data-msgid="${r.msgId}">
            <span class="dg-type">${esc(r.type)}</span>
            <span class="dg-hint">#${r.msgId}</span>
            <span class="dg-status ${esc(r.status)}">${esc(r.status)}</span>
            <button class="dg-btn dg-regen" data-msgid="${r.msgId}" title="Перегенерировать">⟳</button>
            <button class="dg-btn dg-del" data-msgid="${r.msgId}" title="Удалить артефакты поста">✕</button>
          </div>`).join('');
            const st = deps.settings();
            const profiles = st.profiles
                .map(p => `<option value="${esc(p.id)}" ${p.id === st.activeProfile ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
            const active = st.profiles.find(p => p.id === st.activeProfile) || st.profiles[0];
            const template = String(active?.templateText ?? '').trim() || builtin;
            const cmProfiles = deps.listCmProfiles ? deps.listCmProfiles() : [];
            const cmOptions = cmProfiles
                .map(p => `<option value="${esc(p.id)}" ${active?.sourceConfig?.profileId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
            const src = active?.source || 'current';
            const sc = active?.sourceConfig || {};
            $(panel).html(`
          <div class="dg-section" style="border-top:none; margin-top:0">
            <div class="dg-autoline">
              <span class="dg-switch"><input type="checkbox" id="dg-enabled" ${st.enabled ? 'checked' : ''}/><i></i></span>
              <span id="dg-auto-label">${st.enabled ? 'автогенерация после каждого поста' : 'автогенерация выключена'}</span>
            </div>
            <div class="dg-srcgrid" style="margin-top:8px">
              <label for="dg-display-mode">Показ</label>
              <select id="dg-display-mode">${displayOpts(st.displayMode)}</select>
            </div>
            <p class="dg-hint">Кнопка-режимы показывают в посте компактный ряд вместо артефакта:
              тип открывает его — в посте или во всплывающем окне.</p>
          </div>
          <div class="dg-section">
            <p class="dg-title">Шаблон артефактов</p>
            <select id="dg-profile">${profiles}</select>
            <p class="dg-hint">${esc(describeSource(active))}</p>
            <div style="margin-top:8px">
              <button class="dg-btn dg-btn-primary" id="dg-gen-latest">Сгенерировать для последнего поста</button>
            </div>
            <div class="dg-genrow">
              <input id="dg-msgid" type="number" placeholder="ID"/>
              <button class="dg-btn" id="dg-manual">Сгенерировать по ID</button>
            </div>
          </div>
          <div class="dg-section">
            <p class="dg-title">Артефакты чата</p>
            <div id="dg-list">${items || '<span class="dg-empty">пока пусто — сгенерируй первый артефакт</span>'}</div>
          </div>
          <div class="dg-section">
            <details>
              <summary>Фото через URIS</summary>
              <p class="dg-hint" id="dg-uris-status">проверка моста…</p>
              <div class="dg-srcgrid" style="margin-top:6px">
                <label for="dg-img-mode">Режим</label>
                <select id="dg-img-mode">
                  <option value="off" ${st.imageMode === 'off' ? 'selected' : ''}>выключено</option>
                  <option value="button" ${st.imageMode === 'button' ? 'selected' : ''}>по кнопке 📷 на посте</option>
                  <option value="auto" ${st.imageMode === 'auto' ? 'selected' : ''}>авто (платно, за каждый слот)</option>
                </select>
                <label for="dg-img-quality">Качество</label>
                <select id="dg-img-quality">
                  <option value="low" ${st.imageQuality === 'low' ? 'selected' : ''}>low</option>
                  <option value="medium" ${st.imageQuality === 'medium' ? 'selected' : ''}>medium</option>
                  <option value="high" ${st.imageQuality === 'high' ? 'selected' : ''}>high</option>
                </select>
              </div>
              <p class="dg-hint">Слоты в артефактах (<code>data-dg-img</code>) заполняются сгенерированными
                фото из UR Image Studio: поляроиды, селфи, снимки к статьям. CSS-плейсхолдер остаётся фолбэком.</p>
            </details>
          </div>
          <div class="dg-section">
            <details>
              <summary>Текст шаблона</summary>
              <div class="dg-srcgrid" style="margin-bottom:6px">
                <label for="dg-builtin">Основа</label>
                <select id="dg-builtin">
                  <option value="universal" ${active?.builtin !== 'universal-photo' ? 'selected' : ''}>Универсальный</option>
                  <option value="universal-photo" ${active?.builtin === 'universal-photo' ? 'selected' : ''}>Универсальный с фото</option>
                </select>
              </div>
              <textarea id="dg-template" rows="9">${esc(template)}</textarea>
              <p class="dg-hint">пустое поле = выбранная встроенная основа</p>
              <div class="dg-genrow">
                <button class="dg-btn" id="dg-save-template">Сохранить шаблон</button>
                <button class="dg-btn" id="dg-reset-template" title="Вернуть встроенный универсальный шаблон">Вернуть встроенный</button>
              </div>
            </details>
          </div>
          <div class="dg-section">
            <details>
              <summary>Источник генерации</summary>
              <select id="dg-source">${sourceOpts(src)}</select>
              <div id="dg-src-profile" style="display:${src === 'profile' ? '' : 'none'}; margin-top:6px">
                ${cmOptions
                  ? `<select id="dg-cm-profile">${cmOptions}</select>`
                  : '<p class="dg-hint">Расширение connection-manager не найдено или в нём нет профилей.</p>'}
              </div>
              <div id="dg-src-custom" style="display:${src === 'custom' ? '' : 'none'}; margin-top:6px">
                <div class="dg-srcgrid">
                  <label for="dg-apiurl">URL</label><input id="dg-apiurl" type="text" value="${esc(sc.apiurl || '')}" placeholder="https://…/v1"/>
                  <label for="dg-key">Ключ</label><input id="dg-key" type="password" value="" placeholder="${sc.hasKey ? 'сохранён — введи для замены' : 'sk-…'}"/>
                  <label for="dg-model">Модель</label><input id="dg-model" type="text" value="${esc(sc.model || '')}" placeholder="необязательно"/>
                </div>
              </div>
              <div class="dg-genrow"><button class="dg-btn" id="dg-save-source">Применить к профилю</button></div>
              <p class="dg-hint">Ключ хранится в localforage браузера, а не в settings.json.</p>
            </details>
          </div>
          <div class="dg-section">
            <details>
              <summary>Новый шаблон (профиль)</summary>
              <input id="dg-newname" type="text" placeholder="имя профиля" style="margin-bottom:6px"/>
              <select id="dg-newsource">${sourceOpts('current')}</select>
              <div id="dg-new-cm" style="display:none; margin-top:6px">
                ${cmOptions
                  ? `<select id="dg-new-cm-profile">${cmOptions}</select>`
                  : '<p class="dg-hint">Connection Manager недоступен — выбери другой источник.</p>'}
              </div>
              <div id="dg-new-custom" style="display:none; margin-top:6px">
                <div class="dg-srcgrid">
                  <label for="dg-apiurl">URL</label><input id="dg-napiurl" type="text" placeholder="https://…/v1"/>
                  <label for="dg-nkey">Ключ</label><input id="dg-nkey" type="password" placeholder="sk-…"/>
                  <label for="dg-nmodel">Модель</label><input id="dg-nmodel" type="text" placeholder="необязательно"/>
                </div>
              </div>
              <div class="dg-genrow"><button class="dg-btn" id="dg-add-profile">Добавить профиль</button></div>
              <p class="dg-hint">Новый профиль получает встроенный универсальный шаблон — правится в «Текст шаблона».</p>
            </details>
          </div>
          <div class="dg-section">
            <details>
              <summary>Исключения авторежима</summary>
              <textarea id="dg-excl" rows="3">${esc(deps.getExclusions())}</textarea>
              <p class="dg-hint">фраза на строку — на постах с такой фразой авторежим молчит</p>
              <div class="dg-genrow"><button class="dg-btn" id="dg-save-excl">Сохранить исключения</button></div>
            </details>
          </div>`);
            refreshUrisStatus();
        }).catch(() => { /* шаблон не загрузился — перерисуем при следующем вызове */ });
    };

    // Статус моста URIS — асинхронный: строка подменяется по готовности промиса.
    const refreshUrisStatus = () => {
        if (!deps.urisStatus) return;
        deps.urisStatus().then((st) => {
            const node = doc.getElementById('dg-uris-status');
            if (!node) return;
            node.textContent = !st.available
                ? 'мост не найден — UR Image Studio не установлен или выключен'
                : st.accepting
                    ? `мост активен${st.connection ? `, подключение: ${st.connection.label}` : ' — но в чате не выбрано image-подключение'}`
                    : 'мост найден, но URIS выключен или ещё инициализируется';
        }).catch(() => {});
    };

    // Делегированные обработчики — ОДИН раз, namespace .diegetic.
    $(doc).off('.diegetic');
    $(doc).on('change.diegetic', '#dg-enabled', (e) => {
        deps.setEnabled(e.target.checked);
        $('#dg-auto-label').text(e.target.checked ? 'автогенерация после каждого поста' : 'автогенерация выключена');
    });
    $(doc).on('change.diegetic', '#dg-display-mode', (e) => { deps.setDisplayMode(String(e.target.value)); });
    $(doc).on('change.diegetic', '#dg-profile', (e) => { deps.setActiveProfile(e.target.value); render(); });
    $(doc).on('click.diegetic', '#dg-gen-latest', () => {
        const id = deps.getLatestAssistantId ? deps.getLatestAssistantId() : null;
        if (id !== null) deps.pipeline.run(id, { force: true });
    });
    $(doc).on('click.diegetic', '#dg-manual', () => {
        const id = Number($('#dg-msgid').val());
        if (Number.isFinite(id)) deps.pipeline.run(id, { force: true });
    });
    $(doc).on('click.diegetic', '#dg-save-template', () => { deps.setTemplateText(String($('#dg-template').val())); });
    $(doc).on('change.diegetic', '#dg-builtin', (e) => { deps.setBuiltin(String(e.target.value)); render(); });
    $(doc).on('click.diegetic', '#dg-reset-template', () => { deps.setTemplateText(''); render(); });
    $(doc).on('click.diegetic', '#dg-save-source', () => {
        deps.setProfileSource({
            source: String($('#dg-source').val()),
            apiurl: String($('#dg-apiurl').val() || ''),
            key: String($('#dg-key').val() || ''),
            model: String($('#dg-model').val() || ''),
            profileId: String($('#dg-cm-profile').val() || ''),
            profileName: String($('#dg-cm-profile option:selected').text() || ''),
        });
        render();
    });
    $(doc).on('change.diegetic', '#dg-source', (e) => {
        const v = String($(e.target).val());
        $('#dg-src-profile').toggle(v === 'profile');
        $('#dg-src-custom').toggle(v === 'custom');
    });
    $(doc).on('change.diegetic', '#dg-newsource', (e) => {
        const v = String($(e.target).val());
        $('#dg-new-cm').toggle(v === 'profile');
        $('#dg-new-custom').toggle(v === 'custom');
    });
    $(doc).on('click.diegetic', '#dg-add-profile', () => {
        const name = String($('#dg-newname').val() || '').trim();
        if (!name) return;
        const source = String($('#dg-newsource').val());
        if (source === 'profile' && !$('#dg-new-cm-profile').length) return;
        deps.addProfile({
            name,
            source,
            apiurl: String($('#dg-napiurl').val() || ''),
            key: String($('#dg-nkey').val() || ''),
            model: String($('#dg-nmodel').val() || ''),
            profileId: String($('#dg-new-cm-profile').val() || ''),
            profileName: String($('#dg-new-cm-profile option:selected').text() || ''),
        });
        $('#dg-newname').val(''); $('#dg-napiurl').val(''); $('#dg-nkey').val(''); $('#dg-nmodel').val('');
        $('#dg-new-cm').hide(); $('#dg-new-custom').hide();
        $('#dg-newsource').val('current');
        render();
    });
    $(doc).on('click.diegetic', '#dg-regen', (e) => deps.regen(Number($(e.target).data('msgid'))));
    $(doc).on('click.diegetic', '#dg-del', (e) => deps.removeArtifacts(Number($(e.target).data('msgid'))));
    $(doc).on('click.diegetic', '#dg-save-excl', () => { deps.setExclusions(String($('#dg-excl').val())); });
    $(doc).on('change.diegetic', '#dg-img-mode', (e) => deps.setImageMode?.(String(e.target.value)));
    $(doc).on('change.diegetic', '#dg-img-quality', (e) => deps.setImageQuality?.(String(e.target.value)));

    render();
    return { render };
}

/** Снять всё, что навесил ui.js (disable/clean). */
export function unmountUi(deps) {
    const $ = deps?.$ ?? globalThis.jQuery ?? globalThis.$;
    try { $?.(document).off('.diegetic'); } catch { /* ок */ }
    for (const id of ['dg-style', 'dg-ext']) {
        document.getElementById(id)?.remove();
    }
}
