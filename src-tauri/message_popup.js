(function() {
    'use strict';

    const POPUP_ID = 'wl-message-popup';
    const SHOW_MS = 5000;

    if (window.__wlPopup) window.__wlPopup.destroy();

    // Três visuais (a: cartão no topo, b: canto de baixo, c: pílula). Ficam abaixo da barra de título
    // (--wl-bar, em titlebar.js): por cima dela o clique ia para a barra, não para o aviso.
    const CSS = `
        .wl-pop {
            position: fixed; z-index: 10001; box-sizing: border-box; overflow: hidden;
            display: flex; flex-direction: column; gap: 8px;
            background: #202c33; color: #e9edef; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
            font: 14px/1.3 "Segoe UI", sans-serif; cursor: pointer;
            opacity: 0; visibility: hidden; pointer-events: none;
            transform: translate(var(--tx, 0), var(--ty, -12px));
            transition: opacity .2s, transform .2s, visibility 0s .2s;
        }
        .wl-pop.wl-show { opacity: 1; visibility: visible; pointer-events: auto;
            transform: translate(var(--tx, 0), 0); transition: opacity .2s, transform .2s; }
        .wl-pop:hover { filter: brightness(1.08); }
        .wl-pop .wl-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .wl-pop .wl-av { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex: none;
            background: linear-gradient(135deg, #8b6f4e, #c79a6b); }
        .wl-pop .wl-text { min-width: 0; flex: 1; }
        .wl-pop .wl-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wl-pop .wl-time { color: #21c063; font-size: 12px; font-weight: 400; }
        .wl-pop .wl-preview { color: #aebac1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wl-pop .wl-close { flex: none; display: grid; place-items: center; border: 0; background: none;
            color: #aebac1; cursor: pointer; padding: 4px; border-radius: 50%; }
        .wl-pop .wl-close:hover { background: rgba(255, 255, 255, .08); }
        .wl-pop .wl-close svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; }
        .wl-pop .wl-reply { align-self: flex-start; border: 0; border-radius: 6px; padding: 3px 10px; cursor: pointer;
            background: #2a3942; color: #25d366; font: 600 12px "Segoe UI", sans-serif; }
        .wl-pop .wl-answer { border: 0; border-radius: 6px; padding: 6px 8px; outline: none; width: 100%; box-sizing: border-box;
            background: #2a3942; color: #e9edef; font: 13px "Segoe UI", sans-serif; }
        .wl-pop .wl-prog { position: absolute; left: 0; bottom: 0; height: 3px; background: #21c063;
            animation: wl-prog var(--wl-ms, 5s) linear forwards; }
        @keyframes wl-prog { from { width: 100%; } to { width: 0; } }

        .wl-a { --tx: -50%; top: calc(var(--wl-bar, 0px) + 10px); left: 50%; width: min(400px, calc(100vw - 24px));
            border-radius: 12px; padding: 10px 8px 10px 12px; }
        .wl-b { right: 14px; bottom: 76px; --ty: 12px; width: min(300px, calc(100vw - 28px));
            border-radius: 12px; border-left: 3px solid #21c063; padding: 10px 8px 10px 12px; }
        .wl-c { --tx: -50%; top: calc(var(--wl-bar, 0px) + 8px); left: 50%; width: max-content;
            max-width: calc(100vw - 24px); border-radius: 22px; padding: 4px 6px 4px 4px; box-shadow: 0 4px 14px rgba(0, 0, 0, .5); }
        .wl-c .wl-top { gap: 10px; }
        .wl-c .wl-av { width: 28px; height: 28px; }
        .wl-c .wl-text { max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wl-c .wl-name, .wl-c .wl-preview { display: inline; }
        .wl-c .wl-name::after { content: ": "; }
        .wl-c .wl-time { display: none; }

        /* amostra dentro das Configurações: sem posição, sem sumir */
        .wl-pop.wl-sample { position: relative; opacity: 1; visibility: visible; transform: none; pointer-events: none;
            top: auto; left: auto; right: auto; bottom: auto; width: auto; max-width: 100%; cursor: default; }
        .wl-pop.wl-sample.wl-c { width: max-content; }
        .wl-pop.wl-sample .wl-prog { animation: none; width: 60%; }
    `;

    let counts = new Map();
    let observer = null;
    let scanTimer = null;
    let hideTimer = null;
    let started = false;
    let style = 'a'; // visual escolhido em Configurações > Aplicativo (settings.json)

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

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // devolve uma promessa que só termina com a lista já estável (quem digita em seguida precisa disso)
    async function openChat(name) {
        const current = readRows().get(name);
        if (current) return press(current.row);
        // grupo arquivado: abre a tela Arquivadas, abre a conversa e volta para a lista
        const btn = document.querySelector('[data-testid="chatlist-panel-archived-button"]');
        if (!btn) return;
        btn.click();
        await wait(700);
        const drawer = document.querySelector('[data-testid="archived-drawer"]');
        const row = drawer && readRows(drawer, '[role="listitem"]').get(name);
        if (row) press(row.row);
        await wait(400);
        const back = document.querySelector('[data-testid="archived-drawer"] button[aria-label="Voltar"]');
        if (back) back.click();
        await wait(500);
    }

    // grupos arquivados marcados para avisar (vale para o balão e para a bolinha)
    const KEY = 'wl-arch-groups';
    function groups() {
        try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { return new Set(); }
    }
    function saveGroups(set) {
        try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch (e) {}
    }

    // Tela Arquivadas: a bolinha ao lado do aviso liga a seleção. Ligada, clicar num grupo marca (cartão
    // verde + selo ✓ no canto da foto) ou tira (selo ✗ vermelho); apertar a bolinha de novo salva.
    let selecting = false;
    let draft = new Set();
    const PICKED = '#14493b';
    const ICON_V = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
    const ICON_X = '<path d="M6 6l12 12M18 6L6 18"/>';
    const svg = (path, size, stroke, w) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" style="display:block">${path}</svg>`;

    function badge(row, kind) {
        const img = row.querySelector('img');
        const box = img && img.parentElement;
        if (!box) return;
        let el = box.querySelector('.wl-arch-mark');
        if (!kind) { if (el) el.remove(); return; }
        if (!el) {
            if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
            el = document.createElement('span');
            el.className = 'wl-arch-mark';
            el.style.cssText = 'position:absolute;top:-3px;right:-3px;width:14px;height:14px;border-radius:50%;display:grid;place-items:center;box-shadow:0 0 0 2px #111b21;pointer-events:none;z-index:2';
            box.appendChild(el);
        }
        if (el.dataset.kind !== kind) {
            el.dataset.kind = kind;
            el.innerHTML = svg(kind === 'v' ? ICON_V : ICON_X, 8, '#fff', 3.4);
            el.style.background = kind === 'v' ? '#00a884' : '#e5484d';
        }
    }
    function toggleSelecting() {
        if (selecting) saveGroups(draft);
        else draft = groups();
        selecting = !selecting;
        decorateArchived();
    }
    // com a seleção ligada, o clique no grupo marca em vez de abrir a conversa
    function onSelectClick(e) {
        if (!selecting) return;
        const item = e.target.closest && e.target.closest('[data-testid="archived-drawer"] [role="listitem"]');
        if (!item) return;
        e.stopPropagation();
        e.preventDefault();
        if (e.type !== 'click') return;
        const t = item.querySelector('[data-testid="cell-frame-title"] span[title]');
        if (!t) return;
        const name = t.getAttribute('title');
        draft.has(name) ? draft.delete(name) : draft.add(name);
        decorateArchived();
    }
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        document.addEventListener(type, onSelectClick, true);
    }
    // o aviso "Essas conversas permanecem arquivadas…": o menor div com texto longo e sem linhas de conversa
    function archivedNote(drawer) {
        const found = [...drawer.querySelectorAll('div')].filter(
            (d) => !d.querySelector('[role="listitem"]') && !d.closest('[role="listitem"]') && d.textContent.length > 60);
        return found[found.length - 1] || null;
    }
    function decorateArchived() {
        const drawer = document.querySelector('[data-testid="archived-drawer"]');
        if (!drawer) { selecting = false; return; }
        let btn = document.getElementById('wl-arch-btn');
        if (!btn) {
            const note = archivedNote(drawer);
            if (!note) return;
            if (getComputedStyle(note).position === 'static') note.style.position = 'relative';
            note.style.paddingRight = '84px';
            // o aviso de uma linha (janela larga) precisa ser mais alto que o botão
            note.style.paddingTop = note.style.paddingBottom = '20px';
            btn = document.createElement('button');
            btn.id = 'wl-arch-btn';
            btn.title = 'Selecionar grupos que avisam';
            btn.style.cssText = 'position:absolute;right:16px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:0;color:#e9edef;cursor:pointer;font:11px "Segoe UI",sans-serif;padding:2px 4px';
            btn.onclick = toggleSelecting;
            note.appendChild(btn);
        }
        const state = selecting ? 'on' : 'off';
        if (btn.dataset.state !== state) {
            btn.dataset.state = state;
            const ring = `display:grid;place-items:center;width:28px;height:28px;border-radius:50%;box-sizing:border-box;border:2px solid ${selecting ? '#00a884' : '#e9edef'};background:${selecting ? '#00a884' : 'transparent'}`;
            btn.innerHTML = `<span style="${ring}">${svg(ICON_V, 15, '#e9edef', 2.6)}</span><span>${selecting ? 'Salvar' : 'Selecionar'}</span>`;
        }
        const saved = groups();
        for (const [name, info] of readRows(drawer, '[role="listitem"]')) {
            if (!selecting) { badge(info.row, ''); info.row.style.background = ''; continue; }
            const on = draft.has(name);
            info.row.style.background = on ? PICKED : '';
            badge(info.row, on ? 'v' : saved.has(name) ? 'x' : '');
        }
    }

    window.__wlChats = { readRows, previewOf, openChat, groups };

    const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        e.className = cls;
        if (text) e.textContent = text;
        return e;
    };

    // monta o cartão de um visual (a, b ou c) dentro de `box`; `sample` = exemplo das Configurações
    function fill(box, vis, name, preview, avatar, sample) {
        box.className = `wl-pop wl-${vis}${sample ? ' wl-sample' : ''}`;
        box.style.setProperty('--wl-ms', SHOW_MS + 'ms');
        const top = el('div', 'wl-top');
        let av;
        if (avatar) { av = el('img', 'wl-av'); av.src = avatar; } else av = el('span', 'wl-av');
        const text = el('div', 'wl-text');
        const title = el('div', 'wl-name', name);
        title.append(el('span', 'wl-time', ' · agora'));
        text.append(title, el('div', 'wl-preview', preview));
        const close = el('button', 'wl-close');
        close.innerHTML = X;
        close.title = 'Fechar';
        top.append(av, text, close);
        box.replaceChildren(top);
        if (vis === 'a') box.append(el('button', 'wl-reply', 'Responder'), el('span', 'wl-prog'));
        return close;
    }

    function show(name, info) {
        const popup = document.getElementById(POPUP_ID);
        if (!popup) return;
        const avatar = info.row.querySelector('img');
        const close = fill(popup, style, name, previewOf(info.row), avatar && avatar.src);
        const reply = popup.querySelector('.wl-reply');

        // Responder vira um campo: Enter envia (pela função da bolinha), Esc cancela; enquanto responde, não some
        if (reply) reply.onclick = () => {
            clearTimeout(hideTimer);
            popup.querySelector('.wl-prog').remove();
            const answer = el('input', 'wl-answer');
            answer.placeholder = 'Responder a ' + name;
            // o WhatsApp tem atalhos de teclado na página: a digitação não pode vazar para eles
            for (const t of ['keydown', 'keypress', 'keyup']) answer.addEventListener(t, (e) => e.stopPropagation());
            answer.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') return hide();
                if (e.key !== 'Enter' || !answer.value.trim()) return;
                window.__wlReply(name, answer.value);
                hide();
            });
            reply.replaceWith(answer);
            answer.focus();
        };
        popup.onclick = (e) => {
            if (e.target.closest('.wl-answer, .wl-reply')) return;
            hide();
            if (!close.contains(e.target)) openChat(name);
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
        popup.className = 'wl-pop';
        document.body.appendChild(popup);
        window.__TAURI_INTERNALS__.invoke('lite_get').then((s) => { style = s.popup_style || 'a'; }).catch(() => {});

        observer = new MutationObserver(scheduleScan);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        scheduleScan();
    }

    window.__wlPopup = {
        fill,
        show,
        setStyle(v) { style = v; },
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
