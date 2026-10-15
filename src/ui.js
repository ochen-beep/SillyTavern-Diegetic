// src/ui.js — настройки в разделе «Расширения» таверны (inline-drawer, форма
// Glosses) + лаунчер кнопки генерации (QR-бар / плавающая, режим buttonMode).
// Контролы — нативные классы ST (text_pole, menu_button): тема и вид бесплатно.
// Делегированные обработчики — на document в namespace .diegetic и scoped к
// #dg-ext: старый runner-скрипт рисует панель с теми же id — наши обработчики
// не должны на него срабатывать.
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
#dg-ext { font-size: 13px; line-height: 1.45; }
#dg-ext .dg-section { border-top: 1px dashed var(--SmartThemeBorderColor, rgba(255,255,255,.12));
  padding: 10px 0 4px; margin-top: 6px; }
#dg-ext .dg-title { font-weight: 600; font-size: 12.5px; margin: 0 0 7px; opacity: .85; }
#dg-ext .dg-hint { opacity: .6; font-size: 12px; margin: 4px 0 0; }
#dg-ext .dg-autoline { display: flex; align-items: center; gap: 8px;
  color: var(--SmartThemeEmColor, #c9a86a); }
#dg-ext .dg-genrow { display: flex; gap: 6px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
#dg-ext .dg-genrow input[type=number] { width: 76px; }
#dg-ext .dg-srcgrid { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; }
#dg-ext .dg-srcgrid label { opacity: .75; }
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
#dg-ext .dg-row .menu_button { padding: 2px 8px; }
#dg-ext .dg-switch { position: relative; width: 34px; height: 19px; flex: none; cursor: pointer; }
#dg-ext .dg-switch input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
#dg-ext .dg-switch i { position: absolute; inset: 0; border-radius: 19px; transition: background .15s;
  background: var(--black30, rgba(0,0,0,.4)); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  pointer-events: none; /* иначе <i> перекрывает input и свитч никогда не кликается */ }
#dg-ext .dg-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px;
  border-radius: 50%; background: var(--SmartThemeBodyColor, #ddd); transition: left .15s; }
#dg-ext .dg-switch input:checked + i { background: var(--SmartThemeEmColor, #c9a86a); }
#dg-ext .dg-switch input:checked + i::after { left: 17px; background: var(--black300, #16161a); }
#dg-ext .dg-empty { opacity: .6; font-style: italic; }

/* Артефакты в посте: по центру, без швов и скроллбаров */
.dg-shell { margin: 10px 0; position: relative; display: flex; justify-content: center; }
.dg-shell > iframe, .dg-shell > .dg-chiprow { width: 100%; }
.dg-frame { border: 0; display: block; min-height: 80px; background: transparent;
  color-scheme: normal; }
.dg-chiprow { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.dg-chip, .dg-chip-action { cursor: pointer; border-radius: 8px; padding: 6px 14px; font-size: 13px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  background: var(--black30, rgba(0,0,0,.25)); color: var(--SmartThemeBodyColor, #ddd); }
.dg-chip { font-weight: 600; }
.dg-chip:hover, .dg-chip-action:hover { border-color: var(--SmartThemeEmColor, #c9a86a); }

/* Лайтбокс: иммерсивный — только затемнение и сам артефакт */
.dg-popup { position: fixed; inset: 0; z-index: 2999; display: flex; align-items: center;
  justify-content: center; }
.dg-popup-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.72); }
.dg-popup-dialog { position: relative; width: min(820px, 94vw); height: min(86vh, 900px);
  display: flex; align-items: center; justify-content: center; }
.dg-popup-dialog iframe { width: 100%; height: 100%; border: 0; background: transparent; }
.dg-popup-close { position: absolute; top: 10px; right: 14px; z-index: 2; cursor: pointer;
  background: rgba(0,0,0,.55); color: #fff; border: 1px solid rgba(255,255,255,.3);
  border-radius: 50%; width: 34px; height: 34px; font-size: 16px; }

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

/* Кнопки генерации: анимация занятости (пост/QR-бар/FAB) */
.dg-gen-btn.dg-busy i, .dg-launcher-btn.dg-busy i { animation: dgSpin 1s linear infinite; }
.dg-launcher-btn.dg-busy { color: var(--SmartThemeEmColor, #c9a86a); }
.dg-launcher-btn.dg-busy::after { content: ''; position: absolute; inset: 2px; border-radius: 50%;
  border: 2px solid var(--SmartThemeEmColor, #c9a86a); border-top-color: transparent;
  animation: dgSpin 0.9s linear infinite; }
@keyframes dgSpin { to { transform: rotate(360deg); } }

/* Лаунчер: QR-бар — как родная кнопка бара; плавающая — фиксированный угол */
.dg-launcher-btn { position: relative; cursor: pointer; }
#dg-launcher-fab { position: fixed; right: 20px; bottom: 84px; z-index: 2999; width: 38px; height: 38px;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--SmartThemeBlurTintColor, #1e1e22); color: var(--SmartThemeEmColor, #c9a86a);
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  box-shadow: 0 6px 18px rgba(0,0,0,.4); opacity: .85; }
#dg-launcher-fab:hover { opacity: 1; }
`;

// type/status приходят из вывода модели, name/id — из настроек, исключения пишет
// пользователь: всё это попадает в документ через .html() — только через esc.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SOURCE_LABELS = { current: 'Текущий API SillyTavern', profile: 'Профиль подключения (Connection Manager)', custom: 'Свой endpoint (OpenAI-совместимый)' };
const DISPLAY_LABELS = { inline: 'Сразу в посте', expand: 'Кнопка → развернуть в посте', popup: 'Кнопка → во всплывающем окне' };
const BUTTON_LABELS = { post: 'У каждого поста', bar: 'В квик-баре', floating: 'Плавающая' };

/** Чистая: подпись источника профиля для подсказки под селектом шаблона. */
export function describeSource(p) {
    if (!p) return '';
    if (p.source === 'profile') return `Источник: профиль подключения${p.sourceConfig?.profileName ? ` «${p.sourceConfig.profileName}»` : ''}`;
    if (p.source === 'custom') return `Источник: свой endpoint${p.sourceConfig?.apiurl ? ` (${p.sourceConfig.apiurl})` : ''}`;
    return 'Источник: текущий API SillyTavern';
}

// ── Лаунчер кнопки генерации (режим buttonMode) ──

let _launcherObserver = null;
let _onLauncherClick = null;

function getQuickReplyBar() {
    return document.querySelector('#send_form #qr--bar')
        || document.getElementById('qr--bar')
        || document.querySelector('#send_form .qr--bar');
}
function getLauncherHost() {
    const qrBar = getQuickReplyBar();
    return qrBar ? (qrBar.querySelector('.qr--buttons') || qrBar) : null;
}

function ensureLauncher(mode, onClick) {
    const barBtn = document.getElementById('dg-launcher-bar');
    const fab = document.getElementById('dg-launcher-fab');
    if (mode !== 'bar' && mode !== 'floating') {
        barBtn?.remove();
        fab?.remove();
        if (_launcherObserver) { try { _launcherObserver.disconnect(); } catch { /* ок */ } _launcherObserver = null; }
        return;
    }
    _onLauncherClick = onClick;
    const makeBtn = (id, cls) => {
        const b = document.createElement('div');
        b.id = id;
        b.className = cls;
        b.title = 'Diegetic: сгенерировать артефакт для последнего поста';
        b.innerHTML = '<i class="fa-solid fa-scroll"></i>';
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _onLauncherClick?.(); });
        return b;
    };
    if (mode === 'bar') {
        fab?.remove();
        const host = getLauncherHost();
        if (!host) { barBtn?.remove(); return; }
        const btn = document.getElementById('dg-launcher-bar') || makeBtn('dg-launcher-bar', 'qr--button menu_button interactable dg-launcher-btn');
        if (btn.parentElement !== host) host.appendChild(btn);
        // ST пересобирает #send_form при смене чата — перецепляем.
        if (!_launcherObserver) {
            const target = document.getElementById('send_form') || document.documentElement;
            _launcherObserver = new MutationObserver(() => {
                const h = getLauncherHost();
                const b = document.getElementById('dg-launcher-bar');
                if (h && b && b.parentElement !== h) h.appendChild(b);
            });
            _launcherObserver.observe(target, { childList: true, subtree: true });
        }
    } else {
        barBtn?.remove();
        if (!fab) document.body.appendChild(makeBtn('dg-launcher-fab', 'dg-launcher-btn interactable'));
    }
}

// ── Панель настроек ──

export function mountPanel(deps) {
    const $ = deps.$;
    const doc = document;

    // Idempotent-remount + зачистка DOM старого runner-скрипта (он рисует
    // панель/FAB с теми же id и дублирует настройки). ВАЖНО: наш <style> —
    // под отдельным id (dg-style-native): старый скрипт монтируется позже и
    // подменяет #dg-style своим CSS, убивая стили drawer и попапа.
    for (const id of ['dg-style-native', 'dg-ext', 'dg-panel', 'dg-fab', 'dg-qr-btn']) {
        doc.getElementById(id)?.remove();
    }
    // Живой старый скрипт Diegetic ещё в раннере? — предупредить один раз.
    if (!mountPanel._legacyWarned && doc.querySelector('iframe[id^="TH-script--Diegetic"]')) {
        mountPanel._legacyWarned = true;
        doc.defaultView?.toastr?.warning?.(
            'В библиотеке скриптов 酒馆助手 всё ещё включён старый скрипт «Diegetic» — он дублирует настройки и генерацию. Отключите или удалите его там.',
            'Diegetic', { timeOut: 12000 });
    }

    const style = doc.createElement('style');
    style.id = 'dg-style-native';
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
    const buttonOpts = (sel) => ['post', 'bar', 'floating']
        .map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${BUTTON_LABELS[s]}</option>`).join('');

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
            <button class="menu_button dg-regen" data-msgid="${r.msgId}" title="Перегенерировать">⟳</button>
            <button class="menu_button dg-del" data-msgid="${r.msgId}" title="Удалить артефакты поста">✕</button>
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
              <select id="dg-display-mode" class="text_pole">${displayOpts(st.displayMode)}</select>
              <label for="dg-button-mode">Кнопка</label>
              <select id="dg-button-mode" class="text_pole">${buttonOpts(st.buttonMode)}</select>
            </div>
            <p class="dg-hint">Показ: артефакт сразу в посте или чип-рядом, который открывает его
              в посте либо во всплывающем окне. Кнопка: где живёт запуск генерации.</p>
          </div>
          <div class="dg-section">
            <p class="dg-title">Шаблон артефактов</p>
            <select id="dg-profile" class="text_pole">${profiles}</select>
            <p class="dg-hint">${esc(describeSource(active))}</p>
            <div style="margin-top:8px">
              <button class="menu_button dg-btn-primary" id="dg-gen-latest">Сгенерировать для последнего поста</button>
            </div>
            <div class="dg-genrow">
              <input id="dg-msgid" type="number" class="text_pole" placeholder="ID"/>
              <button class="menu_button" id="dg-manual">Сгенерировать по ID</button>
            </div>
          </div>
          <div class="dg-section">
            <p class="dg-title">Артефакты чата</p>
            <div id="dg-list">${items || '<span class="dg-empty">пока пусто — сгенерируй первый артефакт</span>'}</div>
          </div>
          <div class="dg-section">
            <details>
              <summary>Контекст генерации</summary>
              <div class="dg-srcgrid" style="margin-top:4px">
                <label for="dg-ctx-persona">Персона</label>
                <input type="checkbox" id="dg-ctx-persona" class="checkbox" ${st.ctxPersona ? 'checked' : ''}/>
                <label for="dg-ctx-character">Персонаж</label>
                <input type="checkbox" id="dg-ctx-character" class="checkbox" ${st.ctxCharacter ? 'checked' : ''}/>
                <label for="dg-ctx-world">Лорбуки</label>
                <input type="checkbox" id="dg-ctx-world" class="checkbox" ${st.ctxWorld ? 'checked' : ''}/>
              </div>
              <p class="dg-hint">Канон для артефактов: персона {{user}}, карточка персонажа и
                активированные записи World Info (dry-run, на правила самой таверны). Глубина
                истории чата — ${st.contextDepth} сообщений.</p>
            </details>
          </div>
          <div class="dg-section">
            <details>
              <summary>Фото через URIS</summary>
              <p class="dg-hint" id="dg-uris-status">проверка моста…</p>
              <div class="dg-srcgrid" style="margin-top:6px">
                <label for="dg-img-mode">Режим</label>
                <select id="dg-img-mode" class="text_pole">
                  <option value="off" ${st.imageMode === 'off' ? 'selected' : ''}>выключено</option>
                  <option value="button" ${st.imageMode === 'button' ? 'selected' : ''}>по кнопке 📷 на посте</option>
                  <option value="auto" ${st.imageMode === 'auto' ? 'selected' : ''}>авто (платно, за каждый слот)</option>
                </select>
                <label for="dg-img-quality">Качество</label>
                <select id="dg-img-quality" class="text_pole">
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
                <select id="dg-builtin" class="text_pole">
                  <option value="universal" ${active?.builtin !== 'universal-photo' ? 'selected' : ''}>Универсальный</option>
                  <option value="universal-photo" ${active?.builtin === 'universal-photo' ? 'selected' : ''}>Универсальный с фото</option>
                </select>
              </div>
              <textarea id="dg-template" class="text_pole" rows="9">${esc(template)}</textarea>
              <p class="dg-hint">пустое поле = выбранная встроенная основа</p>
              <div class="dg-genrow">
                <button class="menu_button" id="dg-save-template">Сохранить шаблон</button>
                <button class="menu_button" id="dg-reset-template" title="Вернуть встроенный шаблон основы">Вернуть встроенный</button>
              </div>
            </details>
          </div>
          <div class="dg-section">
            <details>
              <summary>Источник генерации</summary>
              <select id="dg-source" class="text_pole">${sourceOpts(src)}</select>
              <div id="dg-src-profile" style="display:${src === 'profile' ? '' : 'none'}; margin-top:6px">
                ${cmOptions
                  ? `<select id="dg-cm-profile" class="text_pole">${cmOptions}</select>`
                  : '<p class="dg-hint">Расширение connection-manager не найдено или в нём нет профилей.</p>'}
              </div>
              <div id="dg-src-custom" style="display:${src === 'custom' ? '' : 'none'}; margin-top:6px">
                <div class="dg-srcgrid">
                  <label for="dg-apiurl">URL</label><input id="dg-apiurl" type="text" class="text_pole" value="${esc(sc.apiurl || '')}" placeholder="https://…/v1"/>
                  <label for="dg-key">Ключ</label><input id="dg-key" type="password" class="text_pole" value="" placeholder="${sc.hasKey ? 'сохранён — введи для замены' : 'sk-…'}"/>
                  <label for="dg-model">Модель</label><input id="dg-model" type="text" class="text_pole" value="${esc(sc.model || '')}" placeholder="необязательно"/>
                </div>
              </div>
              <div class="dg-genrow"><button class="menu_button" id="dg-save-source">Применить к профилю</button></div>
              <p class="dg-hint">Ключ хранится в localforage браузера, а не в settings.json.</p>
            </details>
          </div>
          <div class="dg-section">
            <details>
              <summary>Новый шаблон (профиль)</summary>
              <input id="dg-newname" type="text" class="text_pole" placeholder="имя профиля" style="margin-bottom:6px"/>
              <select id="dg-newsource" class="text_pole">${sourceOpts('current')}</select>
              <div id="dg-new-cm" style="display:none; margin-top:6px">
                ${cmOptions
                  ? `<select id="dg-new-cm-profile" class="text_pole">${cmOptions}</select>`
                  : '<p class="dg-hint">Connection Manager недоступен — выбери другой источник.</p>'}
              </div>
              <div id="dg-new-custom" style="display:none; margin-top:6px">
                <div class="dg-srcgrid">
                  <label for="dg-apiurl">URL</label><input id="dg-napiurl" type="text" class="text_pole" placeholder="https://…/v1"/>
                  <label for="dg-nkey">Ключ</label><input id="dg-nkey" type="password" class="text_pole" placeholder="sk-…"/>
                  <label for="dg-nmodel">Модель</label><input id="dg-nmodel" type="text" class="text_pole" placeholder="необязательно"/>
                </div>
              </div>
              <div class="dg-genrow"><button class="menu_button" id="dg-add-profile">Добавить профиль</button></div>
              <p class="dg-hint">Новый профиль получает встроенный универсальный шаблон — правится в «Текст шаблона».</p>
            </details>
          </div>
          <div class="dg-section">
            <details>
              <summary>Исключения авторежима</summary>
              <textarea id="dg-excl" class="text_pole" rows="3">${esc(deps.getExclusions())}</textarea>
              <p class="dg-hint">фраза на строку — на постах с такой фразой авторежим молчит</p>
              <div class="dg-genrow"><button class="menu_button" id="dg-save-excl">Сохранить исключения</button></div>
            </details>
          </div>`);
            refreshUrisStatus();
            ensureLauncher(deps.settings().buttonMode, deps.runLatest);
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

    // Делегированные обработчики — scoped к нашему drawer: панель старого
    // runner-скрипта использует те же id, наши хендлеры на неё не должны влиять.
    $(doc).off('.diegetic');
    $(doc).on('change.diegetic', '#dg-ext #dg-enabled', (e) => {
        deps.setEnabled(e.target.checked);
        $('#dg-auto-label').text(e.target.checked ? 'автогенерация после каждого поста' : 'автогенерация выключена');
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-display-mode', (e) => { deps.setDisplayMode(String(e.target.value)); });
    $(doc).on('change.diegetic', '#dg-ext #dg-button-mode', (e) => { deps.setButtonMode(String(e.target.value)); });
    $(doc).on('change.diegetic', '#dg-ext #dg-profile', (e) => { deps.setActiveProfile(e.target.value); render(); });
    $(doc).on('click.diegetic', '#dg-ext #dg-gen-latest', () => { deps.runLatest?.(); });
    $(doc).on('click.diegetic', '#dg-ext #dg-manual', () => {
        const id = Number($('#dg-msgid').val());
        if (Number.isFinite(id)) deps.runId?.(id);
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-save-template', () => { deps.setTemplateText(String($('#dg-template').val())); });
    $(doc).on('change.diegetic', '#dg-ext #dg-builtin', (e) => { deps.setBuiltin(String(e.target.value)); render(); });
    $(doc).on('click.diegetic', '#dg-ext #dg-reset-template', () => { deps.setTemplateText(''); render(); });
    $(doc).on('click.diegetic', '#dg-ext #dg-save-source', () => {
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
    $(doc).on('change.diegetic', '#dg-ext #dg-source', (e) => {
        const v = String($(e.target).val());
        $('#dg-src-profile').toggle(v === 'profile');
        $('#dg-src-custom').toggle(v === 'custom');
    });
    $(doc).on('change.diegetic', '#dg-ext #dg-newsource', (e) => {
        const v = String($(e.target).val());
        $('#dg-new-cm').toggle(v === 'profile');
        $('#dg-new-custom').toggle(v === 'custom');
    });
    $(doc).on('click.diegetic', '#dg-ext #dg-add-profile', () => {
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
    $(doc).on('click.diegetic', '#dg-ext #dg-regen', (e) => deps.regen(Number($(e.target).data('msgid'))));
    $(doc).on('click.diegetic', '#dg-ext #dg-del', (e) => deps.removeArtifacts(Number($(e.target).data('msgid'))));
    $(doc).on('click.diegetic', '#dg-ext #dg-save-excl', () => { deps.setExclusions(String($('#dg-excl').val())); });
    $(doc).on('change.diegetic', '#dg-ext #dg-img-mode', (e) => deps.setImageMode?.(String(e.target.value)));
    $(doc).on('change.diegetic', '#dg-ext #dg-img-quality', (e) => deps.setImageQuality?.(String(e.target.value)));
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-persona', (e) => deps.setCtxPersona?.(e.target.checked));
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-character', (e) => deps.setCtxCharacter?.(e.target.checked));
    $(doc).on('change.diegetic', '#dg-ext #dg-ctx-world', (e) => deps.setCtxWorld?.(e.target.checked));

    ensureLauncher(deps.settings().buttonMode, deps.runLatest);
    render();
    return { render };
}

/** Снять всё, что навесил ui.js (disable/clean). */
export function unmountUi(deps) {
    const $ = deps?.$ ?? globalThis.jQuery ?? globalThis.$;
    try { $?.(document).off('.diegetic'); } catch { /* ок */ }
    if (_launcherObserver) { try { _launcherObserver.disconnect(); } catch { /* ок */ } _launcherObserver = null; }
    for (const id of ['dg-style-native', 'dg-ext', 'dg-launcher-bar', 'dg-launcher-fab']) {
        document.getElementById(id)?.remove();
    }
}
