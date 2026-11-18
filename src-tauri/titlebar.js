// Barra de título própria (a nativa fica escondida em tauri.conf.json):
// alfinete (fixar por cima), modo celular, bolinha, minimizar, maximizar e fechar.
(function () {
    'use strict';
    if (window.top !== window) return;

    const ID = 'wl-titlebar';
    const HEIGHT = 32;
    let pinned = false;

    const call = (cmd, args) =>
        window.__TAURI_INTERNALS__.invoke('plugin:window|' + cmd, { label: 'main', ...args });

    const CSS = `
        html { --wl-bar: ${HEIGHT}px; }
        #app { position: fixed !important; top: ${HEIGHT}px !important; left: 0; right: 0; bottom: 0;
               height: auto !important; }
        #${ID} { position: fixed; top: 0; left: 0; right: 0; height: ${HEIGHT}px; z-index: 99999;
                 display: flex; align-items: center; user-select: none;
                 background: #0b141a; color: #e9edef; font: 12px "Segoe UI", sans-serif; }
        #${ID} .t { flex: 1; height: 100%; display: flex; align-items: center; padding-left: 12px; }
        #${ID} button { width: 46px; height: 100%; border: none; background: transparent; padding: 0;
                        color: inherit; font-size: 14px; cursor: default;
                        display: inline-flex; align-items: center; justify-content: center; }
        #${ID} .back { display: none; }
        @media (max-width: 360px) {
            #${ID} .t { font-size: 0; padding-left: 0; }
            #${ID} button { width: 36px; }
            html.wl-chat #${ID} .back { display: inline-flex; }
        }
        #${ID} button:hover { background: rgba(255,255,255,.1); }
        #${ID} .x:hover { background: #c42b1c; }
        #${ID} button svg { width: 16px; height: 16px; display: block; fill: none;
                            stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        #${ID} .pin svg { transition: transform .15s; transform: rotate(45deg); }
        #${ID} .pin.on svg { transform: none; fill: currentColor; }
        #${ID} .mini.on svg { fill: currentColor; fill-opacity: .25; }
    `;

    // ícones Lucide (licença ISC)
    const PIN = '<svg viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
    const PHONE = '<svg viewBox="0 0 24 24"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>';
    const BALL = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
    const BACK = '<svg viewBox="0 0 24 24"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>';
    // tamanho do modo celular; o tamanho anterior volta ao sair
    const MINI = { width: 400, height: 760 };
    let restore = null;

    function paintPin(button) {
        button.title = pinned ? 'Desafixar janela' : 'Fixar janela por cima';
        button.classList.toggle('on', pinned);
    }

    function toggleMini(button) {
        const size = restore || MINI;
        restore = restore ? null : { width: window.innerWidth, height: window.innerHeight };
        call('unmaximize')
            .then(() => call('set_size', { value: { Logical: size } }))
            .then(() => {
                button.classList.toggle('on', !!restore);
                button.title = restore ? 'Voltar ao tamanho anterior' : 'Modo celular';
            });
    }

    function button(cls, icon, title, onClick) {
        const b = document.createElement('button');
        b.className = cls;
        if (icon.startsWith('<')) b.innerHTML = icon; else b.textContent = icon;
        b.title = title;
        b.addEventListener('click', onClick);
        return b;
    }

    function add() {
        if (document.getElementById(ID) || !document.body) return;
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        const bar = document.createElement('div');
        bar.id = ID;
        const title = document.createElement('div');
        title.className = 't';
        title.textContent = 'Zap⁺';
        // arrastar e duplo clique para maximizar (Tauri trata o atributo)
        title.setAttribute('data-tauri-drag-region', '');

        const pin = button('pin', PIN, '', () => {
            const value = !pinned;
            call('set_always_on_top', { value }).then(() => { pinned = value; paintPin(pin); });
        });
        paintPin(pin);

        bar.append(
            button('back', BACK, 'Voltar', () => window.__wlMobile && window.__wlMobile.back()),
            title,
            pin,
            button('mini', PHONE, 'Modo celular', (e) => toggleMini(e.currentTarget)),
            button('', BALL, 'Virar bolinha', () => window.__TAURI_INTERNALS__.invoke('bubble_enter')),
            button('', '—', 'Minimizar', () => call('minimize')),
            button('', '☐', 'Maximizar', () => call('toggle_maximize')),
            button('x', '✕', 'Fechar', () => call('close')),
        );
        document.body.appendChild(bar);
    }

    // o WhatsApp recria o body ao carregar; confere de tempos em tempos
    setInterval(add, 1000);
})();
