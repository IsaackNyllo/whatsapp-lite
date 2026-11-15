// Manda para a bolinha (janela "bubble") as mensagens novas e o total de não lidas,
// e recebe dela as respostas. Roda sempre, também com a janela principal escondida.
(function () {
    'use strict';
    if (window.top !== window) return;

    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch(() => {});
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let counts = null;
    let lastUnread = -1;
    // contagem de cada conversa quando o balão apareceu
    const shown = new Map();
    // conversas respondidas pela bolinha: mensagens já vistas, que saem da soma
    const dismissed = new Map();
    // grupos arquivados marcados: contagem lida a cada poll (só com a janela escondida)
    const archCounts = new Map();
    let archPrev = null;
    let archBusy = false;
    window.__wlFeed = { shown, dismissed };
    // a bolinha é criada sob demanda e precisa receber o total de novo
    window.__wlResend = () => { lastUnread = -1; };

    // no modo bolinha quem avisa é o balão dela, não a notificação do Windows
    window.__wlBubbleMode = false;
    const Native = window.Notification;
    // clicar na notificação do Windows abre a janela (escondida na bandeja) já na conversa; o título é o nome dela
    const openOnClick = (n, title) => {
        n.addEventListener('click', () => invoke('bubble_open', { chat: title }));
        return n;
    };
    if (Native) {
        const Quiet = function (title, options) {
            if (window.__wlBubbleMode) return { close() {}, addEventListener() {}, removeEventListener() {} };
            return openOnClick(new Native(title, options), title);
        };
        Object.defineProperty(Quiet, 'permission', { get: () => Native.permission });
        Quiet.requestPermission = Native.requestPermission.bind(Native);
        window.Notification = Quiet;
    }
    if (window.ServiceWorkerRegistration) {
        const show = ServiceWorkerRegistration.prototype.showNotification;
        // o WhatsApp avisa mensagens por aqui (service worker); o clique nessa notificação não mostra a janela
        // escondida. Mostramos a mesma notificação pela página, que dá o evento click para abrir a conversa.
        ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
            if (window.__wlBubbleMode) return Promise.resolve();
            try {
                openOnClick(new Native(title, options), title);
                return Promise.resolve();
            } catch (e) {
                return show.call(this, title, options);
            }
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
        for (const [name, info] of rows) {
            if (info.count === 0) dismissed.delete(name);
            if (!info.muted) unread += Math.max(0, info.count - (dismissed.get(name) || 0));
        }
        for (const [name, c] of archCounts) {
            if (!rows.has(name)) unread += Math.max(0, c - (dismissed.get(name) || 0));
        }
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
                shown.set(name, info.count);
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

    // abre Arquivadas por baixo dos panos, lê os grupos marcados e volta.
    // ponytail: só com a janela escondida; sem o balão para o grupo cujo nome some da gaveta (lista longa).
    async function pollArchived() {
        const chats = window.__wlChats;
        if (archBusy || !chats || document.visibilityState === 'visible') return;
        const chosen = chats.groups();
        if (!chosen.size) { archCounts.clear(); return; }
        const btn = document.querySelector('[data-testid="chatlist-panel-archived-button"]');
        if (!btn) return;
        archBusy = true;
        try {
            btn.click();
            let drawer = null;
            for (let i = 0; i < 20 && !drawer; i++) {
                await sleep(100);
                drawer = document.querySelector('[data-testid="archived-drawer"]');
            }
            if (!drawer) return;
            await sleep(300);
            const rows = chats.readRows(drawer, '[role="listitem"]');
            const next = new Map();
            let notified = false;
            for (const name of chosen) {
                const info = rows.get(name);
                if (!info) { if (archPrev && archPrev.has(name)) next.set(name, archPrev.get(name)); continue; }
                if (info.count === 0) dismissed.delete(name);
                if (info.muted || info.count === 0) { archCounts.delete(name); next.set(name, info.count); continue; }
                archCounts.set(name, info.count);
                next.set(name, info.count);
                if (archPrev && !notified && info.count > (archPrev.get(name) || 0)) {
                    const img = info.row.querySelector('img');
                    shown.set(name, info.count);
                    notified = true;
                    invoke('bubble_message', {
                        chat: name,
                        text: chats.previewOf(info.row),
                        avatar: img && img.src ? img.src : null,
                    });
                }
            }
            archPrev = next;
            const back = drawer.querySelector('button[aria-label="Voltar"]');
            if (back) back.click();
        } finally {
            archBusy = false;
        }
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
        // responder só dá a conversa por vista se havia 1 mensagem (a do balão) e nada novo chegou
        const row = window.__wlChats.readRows().get(name);
        const seen = row && row.count === 1 && shown.get(name) === 1;
        if (openTitle() !== name) await window.__wlChats.openChat(name);
        for (let i = 0; i < 30 && openTitle() !== name; i++) await sleep(100);
        if (openTitle() !== name) return;
        const box = document.querySelector('#main footer [contenteditable="true"]');
        if (!box) return;
        box.focus();
        document.execCommand('insertText', false, text);
        await sleep(150);
        const send = document.querySelector('#main footer button[aria-label="Enviar"]');
        if (send) {
            send.click();
            if (seen) dismissed.set(name, 1);
        }
    };

    setInterval(tick, 1000);
    setInterval(pollArchived, 20000);
})();
