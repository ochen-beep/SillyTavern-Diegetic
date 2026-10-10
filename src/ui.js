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

const CSS = `
#dg-panel { position: fixed; right: 16px; top: 64px; width: 340px; max-height: 70vh; overflow: auto;
  background: var(--SmartThemeBlurTintColor, #222); color: var(--SmartThemeBodyColor, #eee);
  border: 1px solid rgba(255,255,255,.15); border-radius: 10px; padding: 10px; z-index: 9999; font-size: 13px; }
#dg-panel h3 { margin: 4px 0 8px; font-size: 14px; }
#dg-panel .dg-row { display: flex; gap: 6px; align-items: center; padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,.08); }
#dg-panel .dg-orphan { color: #ffb86b; }
#dg-panel button { cursor: pointer; }
#dg-fab { position: fixed; right: 16px; bottom: 90px; z-index: 9999; border-radius: 50%;
  width: 36px; height: 36px; opacity: .7; }
.dg-overlay-btn { position: absolute; z-index: 50; padding: 2px 7px; border-radius: 6px;
  background: rgba(0,0,0,.65); color: #fff; border: 1px solid rgba(255,255,255,.25); font-size: 12px; }
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
let qrDebounce = null;

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

    // type/status приходят из вывода модели, name/id — из dg_settings, исключения
    // пишет пользователь — интерполируем только через esc.
    const render = () => {
        const rows = collectArtifacts(deps.getChatVars());
        const items = rows.map(r => `
          <div class="dg-row" data-digest="${r.digest}">
            <span>${esc(r.type)}</span>
            <span class="${r.status === 'orphan' ? 'dg-orphan' : ''}">${esc(r.status)}</span>
            <button class="dg-regen" data-digest="${r.digest}">⟳</button>
            <button class="dg-del" data-digest="${r.digest}">✕</button>
          </div>`).join('');
        const st = deps.settings();
        const profiles = st.profiles
            .map(p => `<option value="${esc(p.id)}" ${p.id === st.activeProfile ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
        const active = st.profiles.find(p => p.id === st.activeProfile) || st.profiles[0];
        $(panel).html(`
          <h3>Diegetic</h3>
          <div><label><input type="checkbox" id="dg-enabled" ${st.enabled ? 'checked' : ''}/> включено</label></div>
          <h3>Профили</h3>
          <div><select id="dg-profile">${profiles}</select></div>
          <div style="margin-top:6px">
            <label for="dg-lens">Линза активного профиля</label>
            <textarea id="dg-lens" rows="8" style="width:100%">${esc(active?.lensText || '')}</textarea>
            <div style="opacity:.7">вставь содержимое .md из templates/</div>
            <button id="dg-save-lens">Сохранить линзу</button>
          </div>
          <div style="margin-top:6px">
            <label>Новый профиль</label><br/>
            <input id="dg-newname" placeholder="имя" style="width:100%"/>
            <select id="dg-newsource">
              <option value="current">current</option>
              <option value="custom">custom</option>
            </select>
            <div id="dg-custom-fields" style="display:none">
              <input id="dg-apiurl" placeholder="apiurl (https://…/v1)" style="width:100%"/>
              <input id="dg-key" placeholder="key" style="width:100%"/>
              <input id="dg-model" placeholder="model" style="width:100%"/>
            </div>
            <button id="dg-add-profile">Добавить</button>
          </div>
          <h3>Артефакты чата</h3>
          <div id="dg-list">${items || '<i>пока пусто</i>'}</div>
          <h3>Ручная генерация</h3>
          <div>ID сообщения: <input id="dg-msgid" type="number" style="width:70px"/> <button id="dg-manual">Сгенерировать</button></div>
          <h3>Исключения</h3>
          <textarea id="dg-excl" rows="3" style="width:100%">${esc(deps.getExclusions())}</textarea>
          <div><button id="dg-save-excl">Сохранить исключения</button></div>`);
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
            if (qrDebounce) clearTimeout(qrDebounce);
            qrDebounce = setTimeout(() => { qrDebounce = null; remountQr(); }, 200);
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
    $(doc).on('click.diegetic', '#dg-enabled', (e) => { deps.setEnabled(e.target.checked); render(); });
    $(doc).on('change.diegetic', '#dg-profile', (e) => { deps.setActiveProfile(e.target.value); render(); });
    $(doc).on('click.diegetic', '#dg-save-lens', () => { deps.setLensText(String($('#dg-lens').val())); });
    $(doc).on('change.diegetic', '#dg-newsource', (e) => { $('#dg-custom-fields').toggle($(e.target).val() === 'custom'); });
    $(doc).on('click.diegetic', '#dg-add-profile', () => {
        const name = String($('#dg-newname').val() || '').trim();
        if (!name) return;
        deps.addProfile({
            name,
            source: String($('#dg-newsource').val()),
            apiurl: String($('#dg-apiurl').val() || ''),
            key: String($('#dg-key').val() || ''),
            model: String($('#dg-model').val() || ''),
        });
        $('#dg-newname').val(''); $('#dg-apiurl').val(''); $('#dg-key').val(''); $('#dg-model').val('');
        $('#dg-custom-fields').hide();
        render(); // добавленный профиль становится активным — селект и линза перечитаются
    });
    $(doc).on('click.diegetic', '#dg-manual', () => {
        const id = Number($('#dg-msgid').val());
        if (Number.isFinite(id)) deps.pipeline.run(id, { force: true });
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
