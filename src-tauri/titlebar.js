// Barra de título própria (a nativa fica escondida em tauri.conf.json):
// 📌 fixar por cima, minimizar, maximizar e fechar.
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
        #${ID} button { width: 46px; height: 100%; border: none; background: transparent;
                        color: inherit; font-size: 14px; cursor: default; }
        #${ID} button:hover { background: rgba(255,255,255,.1); }
        #${ID} .x:hover { background: #c42b1c; }
        #${ID} .pin { transition: transform .15s, opacity .15s; }
    `;

    function paintPin(button) {
        button.title = pinned ? 'Desafixar janela' : 'Fixar janela por cima';
        button.style.opacity = pinned ? '1' : '.5';
        button.style.transform = pinned ? 'none' : 'rotate(45deg)';
    }

    function button(cls, text, title, onClick) {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = text;
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
        title.textContent = 'WhatsApp Lite';
        // arrastar e duplo clique para maximizar (Tauri trata o atributo)
        title.setAttribute('data-tauri-drag-region', '');

        const pin = button('pin', '📌', '', () => {
            const value = !pinned;
            call('set_always_on_top', { value }).then(() => { pinned = value; paintPin(pin); });
        });
        paintPin(pin);

        bar.append(
            title,
            pin,
            button('', '—', 'Minimizar', () => call('minimize')),
            button('', '☐', 'Maximizar', () => call('toggle_maximize')),
            button('x', '✕', 'Fechar', () => call('close')),
        );
        document.body.appendChild(bar);
    }

    // o WhatsApp recria o body ao carregar; confere de tempos em tempos
    setInterval(add, 1000);
})();
