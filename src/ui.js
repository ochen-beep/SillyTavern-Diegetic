// src/ui.js
// ВАЖНО: скрипт работает в айфрейме раннера. Глобальный $ — это parent-jQuery
// (JS-Slash-Runner src/iframe/parent_jquery.js: window.$ = window.parent.$),
// поэтому $('body').append(...) попадает в документ SillyTavern. Но $(document)
// внутри айфрейма — документ САМОГО айфрейма: делегированные обработчики,
// навешанные через $(document).on(...), живут не в том документе и на клики
// в интерфейсе ST не срабатывают. Поэтому весь нативный доступ к DOM и все
// delegated-bind идут через parentDoc(); bare $(document) запрещён.
import { readMetaMap } from './meta.js';

/** Чистая: строки списка артефактов для панели. */
export function collectArtifacts(chatVars) {
    const map = readMetaMap(chatVars);
    const rows = [];
    for (const [digest, entry] of Object.entries(map)) {
        for (const a of entry.artifacts || []) rows.push({ ...a, digest, generatedAt: entry.generatedAt });
    }
    rows.sort((x, y) => (y.generatedAt || 0) - (x.generatedAt || 0));
    return rows;
}

// Дизайн-принципы: панель живёт в теме SillyTavern (все цвета — через --SmartTheme*),
// иерархия размером/весом, секции разделены пунктиром, один акцент — первичная кнопка
// «Сгенерировать». Верх панели = ежедневный поток (шаблон → генерация), конфиг — в details.
const CSS = `
#dg-panel { position: fixed; right: 16px; top: 64px; width: 356px; max-height: calc(100vh - 140px);
  overflow-y: auto; z-index: 9999; font-size: 13px; line-height: 1.45;
  background: var(--SmartThemeBlurTintColor, #1e1e22); color: var(--SmartThemeBodyColor, #ddd);
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.15)); border-radius: 14px;
  box-shadow: 0 12px 32px rgba(0,0,0,.45); }
#dg-panel .dg-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px; }
#dg-panel .dg-head .dg-gem { color: var(--SmartThemeEmColor, #c9a86a); font-size: 15px; }
#dg-panel .dg-head b { font-size: 15px; font-weight: 600; letter-spacing: .2px; }
#dg-panel .dg-head .dg-close { margin-left: auto; }
#dg-panel .dg-autoline { display: flex; align-items: center; gap: 8px; padding: 0 14px 10px;
  color: var(--SmartThemeEmColor, #c9a86a); }
#dg-panel .dg-autoline .dg-hint { color: var(--SmartThemeBodyColor, #ddd); opacity: .65; }
#dg-panel .dg-body { padding: 0 14px 12px; }
#dg-panel .dg-section { border-top: 1px dashed var(--SmartThemeBorderColor, rgba(255,255,255,.12));
  padding: 10px 0 4px; margin-top: 6px; }
#dg-panel .dg-title { font-weight: 600; font-size: 12.5px; margin: 0 0 7px; opacity: .85; }
#dg-panel .dg-hint { opacity: .6; font-size: 12px; margin: 4px 0 0; }
#dg-panel select, #dg-panel input[type=text], #dg-panel input[type=number], #dg-panel input[type=password],
#dg-panel textarea { width: 100%; box-sizing: border-box; background: var(--black30, rgba(0,0,0,.25));
  color: var(--SmartThemeBodyColor, #ddd); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.15));
  border-radius: 8px; padding: 6px 8px; font-size: 13px; }
#dg-panel textarea { resize: vertical; font-family: var(--monoFontFamily, monospace); font-size: 12px; }
#dg-panel select:focus, #dg-panel input:focus, #dg-panel textarea:focus {
  outline: 1px solid var(--SmartThemeEmColor, #c9a86a); }
#dg-panel .dg-btn { cursor: pointer; border-radius: 8px; padding: 6px 12px; font-size: 13px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2));
  background: var(--black30, rgba(0,0,0,.25)); color: var(--SmartThemeBodyColor, #ddd); }
#dg-panel .dg-btn:hover { border-color: var(--SmartThemeEmColor, #c9a86a); }
#dg-panel .dg-btn-primary { width: 100%; padding: 9px 12px; font-weight: 600; font-size: 14px;
  border: none; background: var(--SmartThemeEmColor, #c9a86a); color: var(--black300, #16161a); }
#dg-panel .dg-btn-primary:hover { filter: brightness(1.1); }
#dg-panel .dg-genrow { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
#dg-panel .dg-genrow input[type=number] { width: 76px; }
#dg-panel .dg-srcgrid { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; }
#dg-panel .dg-srcgrid label { opacity: .75; }
#dg-panel details { margin-top: 4px; }
#dg-panel summary { cursor: pointer; font-weight: 600; font-size: 12.5px; opacity: .85;
  padding: 3px 0; list-style-position: inside; }
#dg-panel details[open] summary { margin-bottom: 7px; }
#dg-panel .dg-row { display: flex; gap: 6px; align-items: center; padding: 5px 0;
  border-bottom: 1px dashed var(--SmartThemeBorderColor, rgba(255,255,255,.08)); }
#dg-panel .dg-row:last-child { border-bottom: none; }
#dg-panel .dg-type { font-weight: 600; }
#dg-panel .dg-status { margin-left: auto; opacity: .7; font-size: 12px; }
#dg-panel .dg-status.orphan { color: #ffb86b; opacity: 1; }
#dg-panel .dg-status.fuzzy { color: #9ad1ff; opacity: 1; }
#dg-panel .dg-row .dg-btn { padding: 2px 8px; }
#dg-panel .dg-switch { position: relative; width: 34px; height: 19px; flex: none; cursor: pointer; }
#dg-panel .dg-switch input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
#dg-panel .dg-switch i { position: absolute; inset: 0; border-radius: 19px; transition: background .15s;
  background: var(--black30, rgba(0,0,0,.4)); border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.2)); }
#dg-panel .dg-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px;
  border-radius: 50%; background: var(--SmartThemeBodyColor, #ddd); transition: left .15s; }
#dg-panel .dg-switch input:checked + i { background: var(--SmartThemeEmColor, #c9a86a); }
#dg-panel .dg-switch input:checked + i::after { left: 17px; background: var(--black300, #16161a); }
#dg-panel .dg-switch input:focus-visible + i { outline: 2px solid var(--SmartThemeEmColor, #c9a86a); }
#dg-panel .dg-empty { opacity: .6; font-style: italic; }
#dg-fab { position: fixed; right: 16px; bottom: 90px; z-index: 9999; border-radius: 50%;
  width: 36px; height: 36px; opacity: .7; cursor: pointer; }
.dg-overlay-btn { position: absolute; z-index: 50; padding: 2px 7px; border-radius: 6px;
  background: rgba(0,0,0,.65); color: #fff; border: 1px solid rgba(255,255,255,.25); font-size: 12px; cursor: pointer; }
`;

// type/status приходят из вывода модели, name/id — из dg_settings, исключения пишет пользователь:
// всё это попадает в parent-document через .html() — интерполируем только через esc.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Документ интерфейса SillyTavern — родитель айфрейма скрипта. */
const parentDoc = () => window.parent.document;

/** QR-бар (#qr--bar); ST монтирует его внутри #send_form. */
function getQuickReplyBar(doc) {
    return doc.querySelector('#send_form #qr--bar')
        || doc.getElementById('qr--bar')
        || doc.querySelector('#send_form .qr--bar');
}

/** Куда крепить кнопку: стили .qr--button scoped к .qr--buttons — иначе кнопка
 *  выпадает из flex-ряда бара. Паттерн расширения Glosses. */
function getLauncherHost(doc) {
    const qrBar = getQuickReplyBar(doc);
    return qrBar ? (qrBar.querySelector('.qr--buttons') || qrBar) : null;
}

/** Наблюдатель за пересборкой #send_form (ST пересоздаёт его при смене чата) —
 *  модульного уровня: защищает от двойного observer при повторном mount. */
let qrObserver = null;

const SOURCE_LABELS = { current: 'Текущий API SillyTavern', profile: 'Профиль подключения (Connection Manager)', custom: 'Свой endpoint (OpenAI-совместимый)' };

/** Чистая: подпись источника профиля для подсказки под селектом шаблона. */
export function describeSource(p) {
    if (!p) return '';
    if (p.source === 'profile') return `Источник: профиль подключения${p.sourceConfig?.profileName ? ` «${p.sourceConfig.profileName}»` : ''}`;
    if (p.source === 'custom') return `Источник: свой endpoint${p.sourceConfig?.apiurl ? ` (${p.sourceConfig.apiurl})` : ''}`;
    return 'Источник: текущий API SillyTavern';
}

export function mountPanel(deps) {
    const $ = deps.$;
    const doc = parentDoc();

    // 1. Idempotent-remount: перезагрузка скрипта не должна плодить дубли.
    for (const id of ['dg-style', 'dg-panel', 'dg-fab', 'dg-qr-btn']) {
        doc.getElementById(id)?.remove();
    }

    // 2. Стили — нативно в head parent-document.
    const style = doc.createElement('style');
    style.id = 'dg-style';
    style.textContent = CSS;
    doc.head.appendChild(style);

    // 3. Панель — нативно в body parent-document, скрыта до первого toggle.
    const panel = doc.createElement('div');
    panel.id = 'dg-panel';
    panel.style.display = 'none';
    doc.body.appendChild(panel);

    const sourceOpts = (sel) => ['current', 'profile', 'custom']
        .map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>${SOURCE_LABELS[s]}</option>`).join('');

    // type/status приходят из вывода модели, name/id — из dg_settings, исключения
    // пишет пользователь — интерполируем только через esc.
    const render = () => {
        const rows = collectArtifacts(deps.getChatVars());
        const items = rows.map(r => `
          <div class="dg-row" data-digest="${r.digest}">
            <span class="dg-type">${esc(r.type)}</span>
            <span class="dg-status ${esc(r.status)}">${esc(r.status)}</span>
            <button class="dg-btn dg-regen" data-digest="${r.digest}" title="Перегенерировать">⟳</button>
            <button class="dg-btn dg-del" data-digest="${r.digest}" title="Убрать из списка">✕</button>
          </div>`).join('');
        const st = deps.settings();
        const profiles = st.profiles
            .map(p => `<option value="${esc(p.id)}" ${p.id === st.activeProfile ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
        const active = st.profiles.find(p => p.id === st.activeProfile) || st.profiles[0];
        const rawLens = String(active?.lensText ?? '').trim();
        const lens = (!rawLens || rawLens === '@universal')
            ? (deps.getUniversalLens ? deps.getUniversalLens() : '')
            : active.lensText;
        const cmProfiles = deps.listCmProfiles ? deps.listCmProfiles() : [];
        const cmOptions = cmProfiles
            .map(p => `<option value="${esc(p.id)}" ${active?.sourceConfig?.profileId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
        const gallery = deps.getGallery ? deps.getGallery() : [];
        const galleryOptions = gallery.map((g, i) => `<option value="${i}">${esc(g.name)}</option>`).join('');
        const src = active?.source || 'current';
        const sc = active?.sourceConfig || {};
        $(panel).html(`
          <div class="dg-head"><span class="dg-gem">◆</span><b>Diegetic</b>
            <button class="dg-btn dg-close" id="dg-close" title="Закрыть">✕</button></div>
          <div class="dg-autoline">
            <span class="dg-switch"><input type="checkbox" id="dg-enabled" ${st.enabled ? 'checked' : ''}/><i></i></span>
            <span id="dg-auto-label">${st.enabled ? 'автогенерация после каждого поста' : 'автогенерация выключена'}</span>
          </div>
          <div class="dg-body">
            <div class="dg-section" style="border-top:none; margin-top:0">
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
                <summary>Линза шаблона</summary>
                ${galleryOptions ? `<select id="dg-gallery"><option value="">— вставить из галереи —</option>${galleryOptions}</select><div style="height:6px"></div>` : ''}
                <textarea id="dg-lens" rows="9">${esc(lens)}</textarea>
                <p class="dg-hint">пустое поле = встроенный универсальный шаблон (на все случаи)</p>
                <div class="dg-genrow">
                  <button class="dg-btn" id="dg-save-lens">Сохранить линзу</button>
                  <button class="dg-btn" id="dg-reset-lens" title="Вернуть встроенную универсальную линзу">Вернуть встроенную</button>
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
                    <label for="dg-key">Ключ</label><input id="dg-key" type="password" value="${esc(sc.key || '')}" placeholder="sk-…"/>
                    <label for="dg-model">Модель</label><input id="dg-model" type="text" value="${esc(sc.model || '')}" placeholder="необязательно"/>
                  </div>
                </div>
                <div class="dg-genrow"><button class="dg-btn" id="dg-save-source">Применить к профилю</button></div>
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
                    <label for="dg-napiurl">URL</label><input id="dg-napiurl" type="text" placeholder="https://…/v1"/>
                    <label for="dg-nkey">Ключ</label><input id="dg-nkey" type="password" placeholder="sk-…"/>
                    <label for="dg-nmodel">Модель</label><input id="dg-nmodel" type="text" placeholder="необязательно"/>
                  </div>
                </div>
                <div class="dg-genrow"><button class="dg-btn" id="dg-add-profile">Добавить профиль</button></div>
                <p class="dg-hint">Новый профиль получает встроенную универсальную линзу — правится в «Линза шаблона».</p>
              </details>
            </div>
            <div class="dg-section">
              <details>
                <summary>Исключения авторежима</summary>
                <textarea id="dg-excl" rows="3">${esc(deps.getExclusions())}</textarea>
                <p class="dg-hint">фраза на строку — на постах с такой фразой авторежим молчит</p>
                <div class="dg-genrow"><button class="dg-btn" id="dg-save-excl">Сохранить исключения</button></div>
              </details>
            </div>
          </div>`);
    };

    const toggle = () => {
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
        render();
    };

    // 5. Кнопка в QR-баре (нативный DOM на parentDoc, паттерн Glosses).
    const createQrButton = () => {
        const btn = doc.createElement('div');
        btn.id = 'dg-qr-btn';
        btn.className = 'qr--button menu_button interactable';
        btn.title = 'Diegetic';
        btn.innerHTML = '<span aria-hidden="true"><i class="fa-solid fa-scroll"></i></span>';
        btn.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
        return btn;
    };
    // Повторное подключение: reuse существующей кнопки по id (appendChild переносит).
    const remountQr = () => {
        const host = getLauncherHost(doc);
        if (!host) return;
        let btn = doc.getElementById('dg-qr-btn');
        if (!btn) btn = createQrButton();
        if (btn.parentElement !== host) host.appendChild(btn);
    };
    remountQr();

    // 6. ST пересобирает #send_form при смене чата — перецепляем кнопку.
    //    #send_form ленивый: пока его нет, наблюдаем documentElement (subtree
    //    всё равно покрывает его появление — простота важнее оптимизации).
    if (!qrObserver) {
        const target = doc.getElementById('send_form') || doc.documentElement;
        qrObserver = new MutationObserver(() => {
            // Без debounce: колбэк обсёрвера — микротаск, троттлинг таймеров
            // скрытого iframe его не задерживает (setTimeout здесь превращал
            // мгновенный remount в минуту ожидания). remountQr идемпотентен и O(1).
            remountQr();
        });
        qrObserver.observe(target, { childList: true, subtree: true });
    }

    // 4. FAB-фолбэк на случай отключённого Quick Replies — прямая привязка
    //    (не delegation), работает независимо от документа.
    const fab = doc.createElement('button');
    fab.id = 'dg-fab';
    fab.title = 'Diegetic';
    fab.textContent = '◆';
    fab.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
    doc.body.appendChild(fab);

    // 7. Делегированные обработчики панели — ОДИН раз, в parent-document,
    //    в namespace .diegetic (off перед bind: перезагрузка скрипта раннера
    //    не снимает старые обработчики — без off второй mount задвоит их).
    $(doc).off('.diegetic');
    // FAB закрыт прямым листенером выше — здесь только крестик панели,
    // иначе клик по FAB тогглит дважды и панель не открывается.
    $(doc).on('click.diegetic', '#dg-close', (e) => { e.preventDefault(); toggle(); });
    $(doc).on('change.diegetic', '#dg-enabled', (e) => {
        deps.setEnabled(e.target.checked);
        $('#dg-auto-label').text(e.target.checked ? 'автогенерация после каждого поста' : 'автогенерация выключена');
    });
    $(doc).on('change.diegetic', '#dg-profile', (e) => { deps.setActiveProfile(e.target.value); render(); });
    $(doc).on('click.diegetic', '#dg-gen-latest', () => {
        const id = deps.getLatestAssistantId ? deps.getLatestAssistantId() : null;
        if (id !== null) deps.pipeline.run(id, { force: true });
    });
    $(doc).on('click.diegetic', '#dg-manual', () => {
        const id = Number($('#dg-msgid').val());
        if (Number.isFinite(id)) deps.pipeline.run(id, { force: true });
    });
    $(doc).on('click.diegetic', '#dg-save-lens', () => { deps.setLensText(String($('#dg-lens').val())); });
    $(doc).on('click.diegetic', '#dg-reset-lens', () => { deps.setLensText(''); render(); });
    $(doc).on('change.diegetic', '#dg-gallery', (e) => {
        const i = Number($(e.target).val());
        const g = (deps.getGallery ? deps.getGallery() : [])[i];
        if (g) $('#dg-lens').val(g.text);
        $(e.target).val('');
    });
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
        render(); // добавленный профиль становится активным — селект и линза перечитаются
    });
    $(doc).on('click.diegetic', '#dg-regen', (e) => deps.regenByDigest(String($(e.target).data('digest'))));
    $(doc).on('click.diegetic', '#dg-del', (e) => deps.deleteByDigest(String($(e.target).data('digest'))));
    $(doc).on('click.diegetic', '#dg-save-excl', () => { deps.setExclusions(String($('#dg-excl').val())); });

    return { render, toggle };
}

/** ⟳-оверлей поверх .TH-render в сообщениях с нашими метаданными.
 *  .mes живёт в parent-document — delegated-bind тоже туда. */
export function attachOverlay(deps) {
    const $ = deps.$;
    $(parentDoc()).on('mouseenter.diegetic', '.mes', function () {
        const $mes = $(this);
        const msgId = $mes.attr('mesid');
        if (msgId === undefined || $mes.find('.dg-overlay-btn').length) return;
        const meta = deps.metaForMessage(Number(msgId));
        if (!meta || !meta.artifacts?.length) return;
        const $render = $mes.find('.TH-render').first();
        if (!$render.length) return; // класс сменён в будущем раннере — тихий фолбэк на панель
        const $btn = $('<button class="dg-overlay-btn" title="Перегенерировать артефакт">⟳</button>');
        $render.css('position', 'relative').append($btn);
        $btn.on('click', (e) => { e.stopPropagation(); deps.pipeline.run(Number(msgId), { force: true }); $btn.remove(); });
        $mes.one('mouseleave', () => $btn.remove());
    });
}
