// Manda para a bolinha (janela "bubble") as mensagens novas e o total de não lidas.
// Roda sempre, também com a janela principal escondida.
(function () {
    'use strict';
    if (window.top !== window) return;

    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch(() => {});
    let counts = null;
    let lastUnread = -1;

    function tick() {
        const chats = window.__wlChats;
        if (!chats) return;
        const rows = chats.readRows();
        if (!rows.size) return;

        // o título vem como "(3) WhatsApp" quando há não lidas
        const m = document.title.match(/^\((\d+)\)/);
        const unread = m ? parseInt(m[1], 10) : 0;
        if (unread !== lastUnread) {
            lastUnread = unread;
            invoke('bubble_unread', { count: unread });
        }

        if (counts) {
            for (const [name, info] of rows) {
                if (info.muted || info.count <= (counts.get(name) || 0)) continue;
                // com a janela em uso, quem avisa é o balão de dentro da conversa
                if (document.hasFocus()) break;
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

    // chamado pelo Rust quando a bolinha pede para abrir uma conversa
    window.__wlOpenChat = (name) => window.__wlChats && window.__wlChats.openChat(name);

    setInterval(tick, 1000);
})();
