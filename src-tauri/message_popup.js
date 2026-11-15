(function() {
    'use strict';

    const POPUP_ID = 'wl-message-popup';
    const SHOW_MS = 5000;

    if (window.__wlPopup) window.__wlPopup.destroy();

    const CSS = `
        #${POPUP_ID} {
            position: fixed;
            top: 8px;
            left: 50%;
            transform: translate(-50%, -150%);
            width: min(420px, calc(100vw - 16px));
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 12px;
            background: #202c33;
            color: #e9edef;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
            font: 14px/1.3 "Segoe UI", sans-serif;
            cursor: pointer;
            z-index: 10001;
            transition: transform 0.2s ease-out;
        }
        #${POPUP_ID}.wl-show { transform: translate(-50%, 0); }
        #${POPUP_ID} img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex: none; }
        #${POPUP_ID} .wl-text { min-width: 0; flex: 1; }
        #${POPUP_ID} .wl-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #${POPUP_ID} .wl-preview { color: #aebac1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #${POPUP_ID} .wl-close {
            flex: none; border: none; background: none; color: #aebac1;
            font-size: 18px; cursor: pointer; padding: 0 4px;
        }
    `;

    let counts = new Map();
    let observer = null;
    let scanTimer = null;
    let hideTimer = null;
    let started = false;

    function readRows(pane = document.getElementById('pane-side'), sel = '[role="row"]') {
        const rows = new Map();
        if (!pane) return rows;
        for (const row of pane.querySelectorAll(sel)) {
            const name = row.querySelector('[data-testid="cell-frame-title"] span[title]');
            if (!name) continue;
            const badge = row.querySelector('[data-testid="icon-unread-count"]');
            rows.set(name.getAttribute('title'), {
                row,
                count: badge ? parseInt(badge.textContent, 10) || 1 : 0,
                // testid medido na página real (não depende do idioma)
                muted: !!row.querySelector('[data-testid^="mute-notifications"]'),
                open: row.matches('[aria-selected="true"]') || !!row.querySelector('[aria-selected="true"]'),
            });
        }
        return rows;
    }

    function inConversation() {
        return document.documentElement.classList.contains('wl-chat') && document.hasFocus();
    }

    function openChatName() {
        const title = document.querySelector('#main [data-testid="conversation-info-header-chat-title"]');
        return title ? title.textContent.trim() : null;
    }

    function scan() {
        scanTimer = null;
        decorateArchived();
        const rows = readRows();
        if (started && inConversation()) {
            // a conversa aberta chega a ganhar o contador antes de ser marcada como lida
            const openName = openChatName();
            for (const [name, info] of rows) {
                if (info.open || info.muted || name === openName) continue;
                if (info.count > (counts.get(name) || 0)) {
                    show(name, info);
                    break;
                }
            }
        }
        started = true;
        counts = new Map([...rows].map(([name, info]) => [name, info.count]));
    }

    function previewOf(row) {
        const status = row.querySelector('[data-testid="last-msg-status"]');
        return (status && (status.getAttribute('title')
            || (status.querySelector('span[dir]') || {}).textContent)) || 'Nova mensagem';
    }

    // o row muda de elemento quando a lista re-renderiza
    function press(row) {
        // o WhatsApp abre a conversa pelos eventos de mouse no nome; click() na célula não abre
        const target = row.querySelector('[data-testid="cell-frame-title"] span[title]');
        if (!target) return;
        const init = { bubbles: true, cancelable: true, view: window };
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            target.dispatchEvent(new MouseEvent(type, init));
        }
    }

    function openChat(name) {
        const current = readRows().get(name);
        if (current) return press(current.row);
        // grupo arquivado: abre a tela Arquivadas, abre a conversa e volta para a lista
        const btn = document.querySelector('[data-testid="chatlist-panel-archived-button"]');
        if (!btn) return;
        btn.click();
        setTimeout(() => {
            const drawer = document.querySelector('[data-testid="archived-drawer"]');
            const row = drawer && readRows(drawer, '[role="listitem"]').get(name);
            if (row) press(row.row);
            setTimeout(() => {
                const back = document.querySelector('[data-testid="archived-drawer"] button[aria-label="Voltar"]');
                if (back) back.click();
            }, 400);
        }, 700);
    }

    // grupos arquivados marcados para avisar (vale para o balão e para a bolinha)
    const KEY = 'wl-arch-groups';
    function groups() {
        try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { return new Set(); }
    }
    function saveGroups(set) {
        try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch (e) {}
    }

    // botão "Selecionar grupos" na tela Arquivadas: marca com um ✓ cada grupo que deve avisar
    let selecting = false;
    function decorateArchived() {
        const drawer = document.querySelector('[data-testid="archived-drawer"]');
        if (!drawer) { selecting = false; return; }
        let btn = document.getElementById('wl-arch-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'wl-arch-btn';
            btn.style.cssText = 'margin:8px 24px;padding:6px 12px;border:0;border-radius:8px;background:#00a884;color:#fff;cursor:pointer;font:13px "Segoe UI",sans-serif';
            btn.onclick = () => { selecting = !selecting; decorateArchived(); };
            drawer.prepend(btn);
        }
        const label = selecting ? 'Concluir seleção' : 'Selecionar grupos';
        if (btn.textContent !== label) btn.textContent = label;
        const chosen = groups();
        for (const [name, info] of readRows(drawer, '[role="listitem"]')) {
            let mark = info.row.querySelector('.wl-arch-mark');
            if (!selecting) { if (mark) mark.remove(); continue; }
            if (!mark) {
                mark = document.createElement('span');
                mark.className = 'wl-arch-mark';
                mark.style.cssText = 'position:absolute;right:90px;top:50%;margin-top:-11px;width:22px;height:22px;border-radius:50%;border:2px solid #00a884;color:#fff;text-align:center;font:14px/18px sans-serif;z-index:5;cursor:pointer';
                mark.onclick = (e) => {
                    e.stopPropagation(); e.preventDefault();
                    const set = groups();
                    set.has(name) ? set.delete(name) : set.add(name);
                    saveGroups(set);
                    decorateArchived();
                };
                info.row.appendChild(mark);
            }
            const tick = chosen.has(name) ? '✓' : '';
            if (mark.textContent !== tick) mark.textContent = tick;
            mark.style.background = chosen.has(name) ? '#00a884' : 'transparent';
        }
    }

    // usado pela bolinha (bubble_feed.js)
    window.__wlChats = { readRows, previewOf, openChat, groups };

    function show(name, info) {
        const popup = document.getElementById(POPUP_ID);
        if (!popup) return;
        const preview = previewOf(info.row);
        const avatar = info.row.querySelector('img');

        popup.replaceChildren();
        if (avatar && avatar.src) {
            const img = document.createElement('img');
            img.src = avatar.src;
            popup.appendChild(img);
        }
        const text = document.createElement('div');
        text.className = 'wl-text';
        const title = document.createElement('div');
        title.className = 'wl-name';
        title.textContent = name;
        const body = document.createElement('div');
        body.className = 'wl-preview';
        body.textContent = preview;
        text.append(title, body);
        const close = document.createElement('button');
        close.className = 'wl-close';
        close.textContent = '×';
        close.title = 'Fechar';
        popup.append(text, close);

        popup.onclick = (e) => {
            hide();
            if (e.target === close) return;
            openChat(name);
        };

        popup.classList.add('wl-show');
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, SHOW_MS);
    }

    function hide() {
        const popup = document.getElementById(POPUP_ID);
        if (popup) popup.classList.remove('wl-show');
    }

    function scheduleScan() {
        if (!scanTimer) scanTimer = setTimeout(scan, 300);
    }

    function init() {
        const style = document.createElement('style');
        style.id = POPUP_ID + '-style';
        style.textContent = CSS;
        document.head.appendChild(style);
        const popup = document.createElement('div');
        popup.id = POPUP_ID;
        document.body.appendChild(popup);

        observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        scheduleScan();
    }

    window.__wlPopup = {
        destroy() {
            if (observer) observer.disconnect();
            clearTimeout(scanTimer);
            clearTimeout(hideTimer);
            [POPUP_ID, POPUP_ID + '-style'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
