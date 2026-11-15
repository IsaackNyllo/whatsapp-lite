// Manda para a bolinha (janela "bubble") as mensagens novas e o total de não lidas,
// e recebe dela as respostas. Roda sempre, também com a janela principal escondida.
(function () {
    'use strict';
    if (window.top !== window) return;

    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch(() => {});
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let counts = null;
    let lastUnread = -1;

    // no modo bolinha quem avisa é o balão dela, não a notificação do Windows
    window.__wlBubbleMode = false;
    const Native = window.Notification;
    if (Native) {
        const Quiet = function (title, options) {
            if (window.__wlBubbleMode) return { close() {}, addEventListener() {}, removeEventListener() {} };
            return new Native(title, options);
        };
        Object.defineProperty(Quiet, 'permission', { get: () => Native.permission });
        Quiet.requestPermission = Native.requestPermission.bind(Native);
        window.Notification = Quiet;
    }
    if (window.ServiceWorkerRegistration) {
        const show = ServiceWorkerRegistration.prototype.showNotification;
        ServiceWorkerRegistration.prototype.showNotification = function (...args) {
            return window.__wlBubbleMode ? Promise.resolve() : show.apply(this, args);
        };
    }

    function tick() {
        const chats = window.__wlChats;
        if (!chats) return;
        const rows = chats.readRows();
        if (!rows.size) return;

        // soma as mensagens não lidas das conversas não silenciadas. O título "(1) WhatsApp"
        // conta conversas, não mensagens.
        // ponytail: só vê as linhas que a lista já desenhou; conversas muito abaixo não entram.
        let unread = 0;
        for (const info of rows.values()) if (!info.muted) unread += info.count;
        if (unread !== lastUnread) {
            lastUnread = unread;
            invoke('bubble_unread', { count: unread });
        }

        // escondida, a página ainda pode dizer que tem foco; vale a visibilidade
        const inUse = document.visibilityState === 'visible' && document.hasFocus();
        if (counts && !inUse) {
            for (const [name, info] of rows) {
                if (info.muted || info.count <= (counts.get(name) || 0)) continue;
                const img = info.row.querySelector('img');
                invoke('bubble_message', {
                    chat: name,
                    text: chats.previewOf(info.row),
                    avatar: img && img.src ? img.src : null,
                });
                break;
            }
        }
        counts = new Map([...rows].map(([name, info]) => [name, info.count]));
    }

    function openTitle() {
        const el = document.querySelector('#main [data-testid="conversation-info-header-chat-title"]');
        return el ? el.textContent.trim() : null;
    }

    // chamados pelo Rust
    window.__wlOpenChat = (name) => window.__wlChats && window.__wlChats.openChat(name);

    // abre a conversa, confere que é ela mesma e envia; nunca envia para outra conversa
    window.__wlReply = async (name, text) => {
        if (!window.__wlChats || !text.trim()) return;
        if (openTitle() !== name) window.__wlChats.openChat(name);
        for (let i = 0; i < 30 && openTitle() !== name; i++) await sleep(100);
        if (openTitle() !== name) return;
        const box = document.querySelector('#main footer [contenteditable="true"]');
        if (!box) return;
        box.focus();
        document.execCommand('insertText', false, text);
        await sleep(150);
        const send = document.querySelector('#main footer button[aria-label="Enviar"]');
        if (send) send.click();
    };

    setInterval(tick, 1000);
})();
