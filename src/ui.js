// src/ui.js
// Работает в parent-document: глобальный $ скрипта раннера уже parent-jQuery
// (JS-Slash-Runner src/iframe/parent_jquery.js: window.$ = window.parent.$).
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountPanel(deps) {
    const $ = deps.$;
    $('#dg-panel, #dg-fab, #dg-style').remove();
    // Перезагрузка скрипта раннера не снимает делегированные обработчики parent-document:
    // без off второй mount задвоит их (#dg-fab переключит панель дважды — она не откроется).
    $(document).off('.diegetic');
    $('body').append(`<style id="dg-style">${CSS}</style>`);
    $('body').append('<button id="dg-fab" title="Diegetic">◆</button>');
    $('body').append('<div id="dg-panel" style="display:none"></div>');

    const render = () => {
        const rows = collectArtifacts(deps.getChatVars());
        const items = rows.map(r => `
          <div class="dg-row" data-digest="${r.digest}">
            <span>${esc(r.type)}</span>
            <span class="${r.status === 'orphan' ? 'dg-orphan' : ''}">${esc(r.status)}</span>
            <button class="dg-regen" data-digest="${r.digest}">⟳</button>
            <button class="dg-del" data-digest="${r.digest}">✕</button>
          </div>`).join('');
        const profiles = deps.settings().profiles
            .map(p => `<option value="${esc(p.id)}" ${p.id === deps.settings().activeProfile ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
        $('#dg-panel').html(`
          <h3>Diegetic</h3>
          <div><label><input type="checkbox" id="dg-enabled" ${deps.settings().enabled ? 'checked' : ''}/> включено</label></div>
          <div>Профиль: <select id="dg-profile">${profiles}</select></div>
          <h3>Артефакты чата</h3>
          <div id="dg-list">${items || '<i>пока пусто</i>'}</div>
          <h3>Ручная генерация</h3>
          <div>ID сообщения: <input id="dg-msgid" type="number" style="width:70px"/> <button id="dg-manual">Сгенерировать</button></div>
          <h3>Исключения</h3>
          <textarea id="dg-excl" rows="3" style="width:100%">${esc(deps.getExclusions())}</textarea>
          <div><button id="dg-save-excl">Сохранить исключения</button></div>`);
    };

    $(document).on('click.diegetic', '#dg-fab', () => { $('#dg-panel').toggle(); render(); });
    $(document).on('click.diegetic', '#dg-enabled', (e) => { deps.setEnabled(e.target.checked); render(); });
    $(document).on('change.diegetic', '#dg-profile', (e) => { deps.setActiveProfile(e.target.value); });
    $(document).on('click.diegetic', '#dg-manual', () => {
        const id = Number($('#dg-msgid').val());
        if (Number.isFinite(id)) deps.pipeline.run(id, { force: true });
    });
    $(document).on('click.diegetic', '#dg-regen', (e) => deps.regenByDigest(String($(e.target).data('digest'))));
    $(document).on('click.diegetic', '#dg-del', (e) => deps.deleteByDigest(String($(e.target).data('digest'))));
    $(document).on('click.diegetic', '#dg-save-excl', () => { deps.setExclusions(String($('#dg-excl').val())); });
    return { render };
}

/** ⟳-оверлей поверх .TH-render в сообщениях с нашими метаданными. */
export function attachOverlay(deps) {
    const $ = deps.$;
    $(document).on('mouseenter.diegetic', '.mes', function () {
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
