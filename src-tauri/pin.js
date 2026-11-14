// Botão de alfinete: deixa a janela sempre por cima das outras.
(function () {
    'use strict';
    if (window.top !== window) return;

    const ID = 'wl-pin-button';
    let pinned = false;

    function paint(button) {
        button.title = pinned ? 'Desafixar janela' : 'Fixar janela por cima';
        button.style.opacity = pinned ? '1' : '0.45';
        button.style.transform = pinned ? 'rotate(0deg)' : 'rotate(45deg)';
    }

    function toggle(button) {
        const value = !pinned;
        window.__TAURI_INTERNALS__
            .invoke('plugin:window|set_always_on_top', { label: 'main', value })
            .then(() => { pinned = value; paint(button); })
            .catch((e) => console.error('alfinete:', e));
    }

    function add() {
        if (document.getElementById(ID) || !document.body) return;
        const button = document.createElement('button');
        button.id = ID;
        button.textContent = '📌';
        button.style.cssText =
            'position:fixed;top:6px;right:8px;z-index:99999;width:28px;height:28px;' +
            'border:none;border-radius:50%;background:transparent;cursor:pointer;' +
            'font-size:16px;line-height:28px;padding:0;transition:transform .15s,opacity .15s;';
        button.addEventListener('click', () => toggle(button));
        paint(button);
        document.body.appendChild(button);
    }

    // o WhatsApp recria o body ao carregar; confere de tempos em tempos
    setInterval(add, 1000);
})();
