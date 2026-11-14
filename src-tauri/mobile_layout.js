(function() {
    'use strict';

    const STYLE_ID = 'wl-mobile-layout';
    const BACK_ID = 'wl-back-button';

    if (window.__wlMobile) window.__wlMobile.destroy();

    // abaixo disso a barra lateral vai para baixo
    const NARROW_WIDTH = 640;
    const BOTTOM_NAV_HEIGHT = 56;
    // até esta largura: modo compacto, só mensagens (sem abas, busca, filtros e cabeçalhos)
    const COMPACT_WIDTH = 360;

    let timer = null;

    const CSS = `
        @media (max-width: ${NARROW_WIDTH}px) {
            html.wl-list [data-wl="nav"] {
                position: absolute !important;
                top: auto !important;
                bottom: 0 !important;
                left: 0 !important;
                right: 0 !important;
                width: auto !important;
                height: ${BOTTOM_NAV_HEIGHT}px !important;
                padding: 8px 12px !important;
                z-index: 5;
            }
            html.wl-list [data-wl="nav"] > div {
                flex-direction: row !important;
                justify-content: space-between !important;
                align-items: center !important;
                width: 100% !important;
                height: 100% !important;
            }
            html.wl-list [data-wl="nav"] > div > div {
                display: flex !important;
                flex: 0 0 auto !important;
                width: auto !important;
                height: auto !important;
            }
            html.wl-list [data-wl="nav"] > div > div > div {
                flex-direction: row !important;
                align-items: center !important;
                gap: 4px;
                height: auto !important;
            }
            html.wl-list [data-wl="nav"] hr { display: none !important; }
            html.wl-list [data-wl-hide] { display: none !important; }
            html.wl-list [data-wl="col"] {
                margin-left: 0 !important;
                height: calc(100% - ${BOTTOM_NAV_HEIGHT}px) !important;
            }
            html.wl-list [data-wl="layer"] {
                left: 0 !important;
                right: 0 !important;
                width: auto !important;
                bottom: ${BOTTOM_NAV_HEIGHT}px !important;
                height: auto !important;
            }
        }

        html.wl-list [data-wl="col"] {
            flex: 1 1 auto !important;
            width: auto !important;
            max-width: none !important;
        }
        /* com display: none o painel fica sem altura e a conversa abre no topo;
           fica fora da tela porque partes dele continuam clicáveis */
        html.wl-list [data-wl="main"] {
            position: absolute !important;
            top: 0 !important;
            bottom: 0 !important;
            left: 100% !important;
            width: 100% !important;
            max-width: none !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }

        html.wl-chat [data-wl="nav"] { display: none !important; }
        /* a lista só desenha as linhas que cabem nela; sem tamanho, para de atualizar */
        html.wl-chat [data-wl="col"] {
            position: absolute !important;
            top: 0 !important;
            bottom: 0 !important;
            right: 100% !important;
            width: 400px !important;
            max-width: none !important;
            visibility: hidden !important;
        }
        html.wl-chat [data-wl="main"] {
            flex: 1 1 auto !important;
            width: auto !important;
            max-width: none !important;
        }
        html.wl-chat [data-testid="conversation-header"] { padding-left: 52px !important; }
        /* o WhatsApp centraliza o painel no botão de emoji, que aqui fica colado na borda */
        html.wl-chat #expressions-panel-container > span > div {
            left: 8px !important;
            max-width: calc(100vw - 16px) !important;
        }

        #${BACK_ID} {
            position: fixed;
            top: calc(12px + var(--wl-bar, 0px));
            left: 8px;
            width: 40px;
            height: 40px;
            border: none;
            border-radius: 50%;
            background: transparent;
            color: inherit;
            cursor: pointer;
            z-index: 10000;
            display: none;
            align-items: center;
            justify-content: center;
        }
        #${BACK_ID}:hover { background: rgba(127, 127, 127, 0.2); }
        html.wl-chat #${BACK_ID} { display: flex; }
        /* fica no fim: precisa vencer as regras da barra de baixo acima */
        @media (max-width: ${COMPACT_WIDTH}px) {
            html.wl-list [data-wl="nav"],
            html.wl-list [data-wl="col"] > header,
            #side > div:first-child,
            #side [aria-label="chat-list-filters"],
            html.wl-chat #main > header,
            #main > header + span,
            #${BACK_ID},
            #main footer [role="textbox"] + div { display: none !important; }
            html.wl-list [data-wl="col"],
            html.wl-list [data-wl="layer"] { height: 100% !important; bottom: 0 !important; }
            /* anexos vêm com largura fixa (330 px) e vazariam da janela */
            #main [role="row"] * { max-width: 100% !important; }
        }
    `;

    function findColumn() {
        let el = document.getElementById('side');
        if (!el) return null;
        while (el.parentElement && !el.parentElement.classList.contains('two')) {
            el = el.parentElement;
            if (el === document.body) return null;
        }
        return el.parentElement ? el : null;
    }

    // o WhatsApp tem camadas sobrepostas com o mesmo layout lista/painel
    function findPairs(column) {
        const pairs = [[column, column.nextElementSibling]];
        const left = column.offsetLeft;
        for (const layer of column.parentElement.children) {
            if (layer === column || getComputedStyle(layer).position !== 'absolute') continue;
            for (const child of layer.children) {
                const next = child.nextElementSibling;
                if (next && Math.abs(child.offsetLeft + layer.offsetLeft - left) <= 1 &&
                    child.offsetWidth < layer.offsetWidth) {
                    pairs.push([child, next]);
                    break;
                }
            }
        }
        return pairs;
    }

    function tag(el, value) {
        if (el && el.getAttribute('data-wl') !== value) el.setAttribute('data-wl', value);
    }

    function setMode(mode) {
        const root = document.documentElement;
        const openingChat = mode === 'wl-chat' && !root.classList.contains('wl-chat');
        for (const m of ['wl-list', 'wl-chat']) {
            const on = m === mode;
            if (root.classList.contains(m) !== on) root.classList.toggle(m, on);
        }
        if (openingChat) focusComposer();
    }

    // o WhatsApp tenta focar a caixa de mensagem enquanto o painel ainda está invisível
    function focusComposer() {
        requestAnimationFrame(() => {
            const box = document.querySelector('#main footer [contenteditable="true"]');
            if (box && !box.contains(document.activeElement)) box.focus();
        });
    }

    function refreshSoon() {
        setTimeout(refresh, 50);
    }

    function paneHasContent(pane) {
        if (!pane || !pane.firstElementChild) return false;
        return !pane.querySelector('[data-testid="intro-panel"]');
    }

    // na barra de baixo: o que não cabe some, os menos importantes primeiro
    const NAV_PRIORITY = [/conversas|chats/i, /status/i, /liga[çc][õo]es|calls/i, /comunidades|communities/i];

    function navRank(item) {
        const el = item.matches('[aria-label]') ? item : item.querySelector('[aria-label]');
        const label = el ? el.getAttribute('aria-label') : '';
        const i = NAV_PRIORITY.findIndex(re => re.test(label));
        return i < 0 ? NAV_PRIORITY.length : i;
    }

    function fitNav(nav) {
        const items = nav ? [...nav.querySelectorAll(':scope > div > div > div > *')] : [];
        items.forEach(el => el.removeAttribute('data-wl-hide'));
        if (!nav || window.innerWidth > NARROW_WIDTH) return;
        const row = nav.firstElementChild;
        // estável: entre os de mesma prioridade, some o último da barra
        const order = items.map((el, i) => [navRank(el), i, el]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
        for (const [rank, , el] of order) {
            if (row.scrollWidth <= row.clientWidth + 1 || rank === 0) break;
            el.setAttribute('data-wl-hide', '');
        }
    }

    function refresh() {
        const column = findColumn();
        if (!column) {
            setMode(null);
            return;
        }
        const nav = column.parentElement.querySelector(':scope > header');
        tag(nav, 'nav');
        if (document.documentElement.classList.contains('wl-list')) fitNav(nav);
        for (const layer of column.parentElement.children) {
            const style = getComputedStyle(layer);
            if (style.position === 'absolute' && parseFloat(style.left) > 0) tag(layer, 'layer');
        }
        tag(column, 'col');
        tag(column.nextElementSibling, 'main');
        // com a lista escondida as medidas vêm zeradas
        if (column.offsetWidth > 0) {
            for (const [list, pane] of findPairs(column)) {
                tag(list, 'col');
                tag(pane, 'main');
            }
        }
        setMode(paneHasContent(column.nextElementSibling) ? 'wl-chat' : 'wl-list');
    }

    // Esc fecha a conversa no WhatsApp
    function goBack() {
        const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
        (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', init));
        setTimeout(refresh, 100);
    }

    // botão lateral "voltar" do mouse; sem o preventDefault o WebView2 volta o histórico
    function onMouseBack(e) {
        if (e.button !== 3) return;
        e.preventDefault();
        if (e.type === 'mouseup') goBack();
    }

    function createBackButton() {
        const button = document.createElement('button');
        button.id = BACK_ID;
        button.title = 'Voltar';
        button.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">' +
            '<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';
        button.addEventListener('click', goBack);
        document.body.appendChild(button);
    }

    function init() {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
        createBackButton();
        window.addEventListener('mousedown', onMouseBack, true);
        window.addEventListener('mouseup', onMouseBack, true);
        window.addEventListener('click', refreshSoon, true);
        refresh();
        timer = setInterval(refresh, 300);
    }

    window.__wlMobile = {
        back: goBack,
        destroy() {
            clearInterval(timer);
            window.removeEventListener('mousedown', onMouseBack, true);
            window.removeEventListener('mouseup', onMouseBack, true);
            window.removeEventListener('click', refreshSoon, true);
            setMode(null);
            document.querySelectorAll('[data-wl]').forEach(el => el.removeAttribute('data-wl'));
            document.querySelectorAll('[data-wl-hide]').forEach(el => el.removeAttribute('data-wl-hide'));
            [STYLE_ID, BACK_ID].forEach(id => {
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
