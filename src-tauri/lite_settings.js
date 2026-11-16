// Seção "WhatsApp Lite" na tela Configurações do WhatsApp (engrenagem) e as 3 subtelas dela.
// Só mexe dentro de [data-testid="settings-drawer"]: se o WhatsApp mudar a tela e o ponto
// de inserção sumir, a seção não aparece. A chave do MCP nunca vem para a página: o app
// monta e copia os comandos (lite_copy_command).
(function () {
    'use strict';
    if (window.top !== window) return;

    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
    const SEC = 'wl-lite-sec';
    const VIEW = 'wl-lite-view';
    const PRESETS = ['#ffffff', '#25d366', '#53bdeb', '#ffd279', '#ff7a7a', '#c9a7ff'];
    const TERMINAL = 'Copie o comando e cole no terminal';
    // [id no Rust, nome, cor, letra, onde colar]
    const CLIENTS = [
        ['claude', 'Claude Code', '#d97757', 'C', TERMINAL],
        ['gemini', 'Gemini CLI', '#4285f4', 'G', TERMINAL],
        ['codex', 'Codex', '#10a37f', 'X', 'Copie o trecho e cole em ~/.codex/config.toml'],
        ['antigravity', 'Antigravity', '#7b61ff', 'A', TERMINAL],
    ];

    // cores e medidas da própria tela de Configurações (variáveis WDS do WhatsApp, medidas pela depuração)
    const FG = 'var(--WDS-content-default, #fafafa)';
    const MUTED = 'var(--WDS-content-deemphasized, rgba(255,255,255,.6))';
    const GREEN = 'var(--WDS-content-action-emphasized, #21c063)';
    const HOVER = 'var(--WDS-surface-highlight, rgba(255,255,255,.1))';
    const LINE = 'var(--WDS-lines-divider, rgba(255,255,255,.1))';
    const CSS = `
        #${SEC} .wl-group { color: ${GREEN}; font-size: 14px; line-height: 20px; padding: 14px 28px 6px; }
        #${SEC} .wl-item { display: flex; align-items: center; gap: 22px; box-sizing: border-box;
            width: calc(100% - 20px); min-height: 68px; margin: 0 10px; padding: 8px 18px; border: 0;
            border-radius: 12px; background: none; color: ${FG}; font: inherit; text-align: left; cursor: pointer; }
        #${SEC} .wl-item:hover, #${SEC} .wl-item:focus-visible { background: ${HOVER}; outline: none; }
        #${SEC} .wl-item svg, #${VIEW} .wl-ico { flex: none; width: 24px; height: 24px; fill: none; stroke: ${MUTED};
            stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
        #${SEC} .wl-txt { flex: 1; min-width: 0; }
        #${SEC} .wl-t { font-size: 16px; line-height: 24px; }
        #${SEC} .wl-t::after { content: "novo"; margin-left: 8px; font-size: 11px; line-height: 16px; color: #111;
            background: ${GREEN}; border-radius: 8px; padding: 1px 7px; vertical-align: 2px; }
        #${SEC} .wl-s { font-size: 14px; line-height: 20px; color: ${MUTED}; }
        #${SEC} .wl-sep { padding: 10px 20px; }
        #${SEC} .wl-sep::before { content: ""; display: block; height: 1px; background: ${LINE}; }

        #${VIEW} { position: absolute; inset: 0; z-index: 1000; display: flex; flex-direction: column;
            background: var(--WDS-surface-default, #161717); color: ${FG}; font-size: 16px; line-height: normal; }
        #${VIEW} > header { flex: none; height: 64px; box-sizing: border-box; padding: 10px; display: flex;
            align-items: center; gap: 8px; }
        #${VIEW} .wl-back { width: 40px; height: 40px; flex: none; border: 0; border-radius: 50%; padding: 0;
            background: none; color: inherit; display: grid; place-items: center; cursor: pointer; }
        #${VIEW} .wl-back:hover { background: ${HOVER}; }
        #${VIEW} .wl-title { font-size: 16px; line-height: 24px; }
        #${VIEW} .wl-body { flex: 1; overflow-y: auto; padding: 0 30px 28px; }
        #${VIEW} .wl-group { color: ${GREEN}; font-size: 14px; line-height: 20px; padding: 18px 0 6px; }
        #${VIEW} .wl-row { display: flex; align-items: center; gap: 18px; padding: 14px 0; }
        #${VIEW} .wl-row.wl-top { align-items: flex-start; }
        #${VIEW} .wl-txt { flex: 1; min-width: 0; }
        #${VIEW} .wl-t { font-size: 15px; line-height: 20px; }
        #${VIEW} .wl-s { font-size: 14px; line-height: 20px; color: ${MUTED}; }
        #${VIEW} .wl-danger { color: var(--WDS-secondary-negative, #fb5061); }
        #${VIEW} .wl-switch { position: relative; flex: none; width: 36px; height: 20px; border-radius: 10px;
            background: #3b4a54; border: 0; padding: 0; cursor: pointer; transition: background .15s; }
        #${VIEW} .wl-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
            border-radius: 50%; background: #aebac1; transition: transform .15s, background .15s; }
        #${VIEW} .wl-switch[aria-checked="true"] { background: #00a884; }
        #${VIEW} .wl-switch[aria-checked="true"]::after { transform: translateX(16px); background: #fff; }
        #${VIEW} .wl-status { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: ${MUTED};
            padding: 0 0 10px; }
        #${VIEW} .wl-status i { width: 8px; height: 8px; border-radius: 50%; background: ${GREEN}; }
        #${VIEW} .wl-status.off i { background: #6b6f6f; }
        #${VIEW} .wl-app { width: 40px; height: 40px; flex: none; border-radius: 10px; display: grid; place-items: center;
            font-weight: 700; color: #fff; }
        #${VIEW} .wl-btns { display: flex; gap: 8px; flex: none; }
        #${VIEW} .wl-btn { flex: none; height: 32px; padding: 0 16px; border: 1px solid ${LINE}; border-radius: 9999px;
            background: none; color: ${GREEN}; font-family: inherit; font-size: 14px; font-weight: 600; line-height: 20px;
            letter-spacing: .16px; cursor: pointer; }
        #${VIEW} .wl-btn:hover { background: ${HOVER}; }
        #${VIEW} .wl-btn.wl-danger { color: var(--WDS-secondary-negative, #fb5061); }
        #${VIEW} .wl-btn[disabled] { color: #6b6f6f; cursor: default; background: none; }
        #${VIEW} .wl-switch:focus-visible, #${VIEW} .wl-btn:focus-visible, #${VIEW} .wl-back:focus-visible {
            outline: 2px solid ${FG}; outline-offset: 2px; }
        #${VIEW} .wl-dim { opacity: .45; pointer-events: none; }
        #${VIEW} .wl-ball { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; flex: none; }
        #${VIEW} .wl-ball svg { width: 22px; height: 22px; fill: none; stroke: #111b21; stroke-width: 2; stroke-linejoin: round; }
        #${VIEW} .wl-hue, #${VIEW} .wl-sec { -webkit-appearance: none; appearance: none; display: block; width: 100%;
            max-width: 360px; border-radius: 6px; outline: none; margin: 10px 0 0; }
        #${VIEW} .wl-hue { height: 12px; background: linear-gradient(90deg, #ff3b3b, #ffb13b, #f2ff3b, #3bff5e,
            #3bf2ff, #3b5eff, #b13bff, #ff3bb1, #ff3b3b); }
        #${VIEW} .wl-sec { height: 6px; background: linear-gradient(90deg, #00a884 var(--p), #3b4a54 var(--p)); }
        #${VIEW} .wl-hue::-webkit-slider-thumb, #${VIEW} .wl-sec::-webkit-slider-thumb { -webkit-appearance: none;
            width: 20px; height: 20px; border-radius: 50%; background: #fff; border: 3px solid #00a884; cursor: pointer; }
        #${VIEW} .wl-sws { display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
        #${VIEW} .wl-sw { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; padding: 0;
            cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
        #${VIEW} .wl-sw[aria-pressed="true"] { box-shadow: 0 0 0 2px #00a884; border-color: var(--WDS-surface-default, #161717); }
        #${VIEW} .wl-toast { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%); max-width: calc(100% - 32px);
            background: #2a3942; color: ${FG}; padding: 10px 18px; border-radius: 8px; font-size: 14px;
            box-shadow: 0 4px 14px rgba(0,0,0,.5); }
        #${VIEW} .wl-choice { box-sizing: border-box; border: 2px solid ${LINE}; border-radius: 12px; padding: 10px 12px 12px;
            margin: 0 0 10px; cursor: pointer; }
        #${VIEW} .wl-choice.wl-fade { opacity: .45; }
        #${VIEW} .wl-choice:hover { background: ${HOVER}; }
        #${VIEW} .wl-choice:focus-visible { outline: 2px solid ${FG}; outline-offset: 2px; }
        #${VIEW} .wl-choice[aria-checked="true"] { border-color: #00a884; }
        #${VIEW} .wl-choice .wl-lbl { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; margin-bottom: 8px; }
        #${VIEW} .wl-choice .wl-lbl i { flex: none; width: 16px; height: 16px; border-radius: 50%; box-sizing: border-box;
            border: 2px solid #6b6f6f; }
        #${VIEW} .wl-choice[aria-checked="true"] .wl-lbl i { border: 5px solid #00a884; }
        @media (max-width: 640px) { #${VIEW} .wl-body { padding: 0 16px 24px; } }
    `;

    const svg = (d) => `<svg viewBox="0 0 24 24" class="wl-ico">${d}</svg>`;
    const ICONS = {
        bolinha: svg('<circle cx="12" cy="12" r="8"/><path d="M9 13.5c1.5 1.5 4.5 1.5 6 0"/>'),
        mcp: svg('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>'),
        aplicativo: svg('<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/>'),
    };
    const BACK = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>';
    const BALL = '<svg viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
    const ITEMS = [
        ['bolinha', 'Bolinha flutuante', 'Cor, contador, prévia e som'],
        ['mcp', 'Conectores de IA', 'Claude, Gemini, Codex e outros leem suas conversas'],
        ['aplicativo', 'Aplicativo', 'Segundo plano, iniciar com o Windows, downloads'],
    ];

    const POPUPS = [['a', 'A · Cartão no topo (padrão)'], ['b', 'B · Canto de baixo, à direita'], ['c', 'C · Pílula compacta no topo']];

    let state = null;     // lite_get: valores do app (sem a chave)
    let current = null;   // subtela aberta
    let confirming = false;
    let toastTimer = null;

    const sw = (k, on, label) =>
        `<button class="wl-switch" role="switch" aria-checked="${!!on}" aria-label="${label}" data-k="${k}"></button>`;
    const row = (t, s, right) =>
        `<div class="wl-row"><div class="wl-txt"><div class="wl-t">${t}</div>${s ? `<div class="wl-s">${s}</div>` : ''}</div>${right}</div>`;
    const group = (t) => `<div class="wl-group">${t}</div>`;
    const hueOf = (color) => { const m = /^hsl\((\d+)/.exec(color); return m ? m[1] : 140; };
    const pct = (sec) => ((sec - 1) / 59 * 100) + '%';

    const VIEWS = {
        bolinha: ['Bolinha flutuante', () => {
            const b = state.bubble;
            return row('Usar a bolinha', 'Esconde a janela e deixa só a bolinha na tela', sw('bubble_mode', false, 'Usar a bolinha')) +
                group('Aparência') +
                `<div class="wl-row wl-top"><div class="wl-ball" style="background:${b.color}">${BALL}</div>
                  <div class="wl-txt"><div class="wl-t">Cor da bolinha</div>
                    <input class="wl-hue" type="range" min="0" max="360" value="${hueOf(b.color)}" aria-label="Escolher cor">
                    <div class="wl-sws">${PRESETS.map((c) => `<button class="wl-sw" style="background:${c}" data-c="${c}" aria-label="Cor ${c}" aria-pressed="${c === b.color}"></button>`).join('')}</div>
                  </div></div>` +
                group('Avisos') +
                row('Contador de não lidas', '', sw('b.count', b.count, 'Contador de não lidas')) +
                row('Prévia das mensagens', 'Balão com o nome e a mensagem, com Responder', sw('b.preview', b.preview, 'Prévia das mensagens')) +
                row('Som ao avisar', '', sw('b.sound', b.sound, 'Som ao avisar')) +
                `<div class="wl-row${b.preview ? '' : ' wl-dim'}"><div class="wl-txt"><div class="wl-t">Prévia na tela por <b class="wl-secval">${b.seconds} s</b></div>
                  <input class="wl-sec" type="range" min="1" max="60" value="${b.seconds}" style="--p:${pct(b.seconds)}" aria-label="Segundos da prévia"></div></div>` +
                group('Grupos arquivados') +
                row('Grupos que avisam', 'Escolha na tela Arquivadas, pelo botão ao lado do aviso', '<button class="wl-btn" data-act="archived">Escolher</button>');
        }],
        mcp: ['Conectores de IA', () => {
            const [cls, text] = !state.mcp_enabled ? ['off', 'Desligado: nenhuma IA consegue ler']
                : state.mcp_listening ? ['', 'Ativo neste computador']
                : ['off', 'Porta 47800 ocupada: feche o programa que a usa e ligue de novo'];
            const key = confirming
                ? row('<span class="wl-danger">Trocar a chave de acesso</span>', 'Os apps conectados param de ler na hora. Trocar mesmo?',
                    '<div class="wl-btns"><button class="wl-btn" data-act="cancel">Cancelar</button><button class="wl-btn wl-danger" data-act="token">Trocar</button></div>')
                : row('<span class="wl-danger">Trocar a chave de acesso</span>', 'Desconecta todos os apps. Copie os comandos de novo depois.',
                    '<button class="wl-btn wl-danger" data-act="confirm">Trocar</button>');
            return row('Permitir que IAs leiam suas conversas', 'Só leitura. Nada é enviado nem marcado como lido.',
                    sw('mcp_enabled', state.mcp_enabled, 'Permitir que IAs leiam suas conversas')) +
                `<div class="wl-status ${cls}"><i></i>${text}</div>` +
                group('Conectar um app') +
                CLIENTS.map(([id, name, color, letter, sub]) =>
                    `<div class="wl-row"><div class="wl-app" style="background:${color}">${letter}</div><div class="wl-txt"><div class="wl-t">${name}</div><div class="wl-s">${sub}</div></div><button class="wl-btn" data-copy="${id}">Copiar comando</button></div>`).join('') +
                group('Celular') +
                row('Gemini e app do Claude no celular', 'Em breve: precisa de acesso pela internet com login', '<button class="wl-btn" disabled>Em breve</button>') +
                group('Segurança') +
                row('Avisar quando uma IA ler', 'A bolinha mostra qual conversa foi lida e quantas mensagens', sw('mcp_notify', state.mcp_notify, 'Avisar quando uma IA ler')) +
                key;
        }],
        aplicativo: ['Aplicativo', () =>
            row('Iniciar com o Windows', 'Abre escondido na bandeja quando o computador liga', sw('autostart', state.autostart, 'Iniciar com o Windows')) +
            row('Rodar em segundo plano', 'Fechar a janela deixa o app na bandeja', sw('run_in_background', state.run_in_background, 'Rodar em segundo plano')) +
            row('Perguntar onde salvar downloads', '', sw('ask_download_path', state.ask_download_path, 'Perguntar onde salvar downloads')) +
            group('Aviso de mensagem nova') +
            row('Mostrar aviso de mensagem nova', '', sw('popup_on', state.popup_on, 'Mostrar aviso de mensagem nova')) +
            `<div class="wl-s" style="padding-bottom:10px">Aparece quando chega mensagem de outra conversa enquanto você está numa conversa. Clicar nele abre a conversa.</div>` +
            POPUPS.map(([id, name]) =>
                `<div class="wl-choice${state.popup_on ? '' : ' wl-fade'}" role="radio" tabindex="0" aria-checked="${state.popup_style === id}" data-pop="${id}"><div class="wl-lbl"><i></i><span style="flex:1">${name}</span><button class="wl-btn" data-see="${id}">Ver na tela</button></div><div data-ex="${id}"></div></div>`).join('')],
    };

    function viewEl() { return document.getElementById(VIEW); }

    function render() {
        const el = viewEl();
        if (!el || !current || !state) return;
        const [title, html] = VIEWS[current];
        el.querySelector('.wl-title').textContent = title;
        el.querySelector('.wl-body').innerHTML = html();
        // exemplos do aviso: os mesmos cartões que aparecem de verdade (message_popup.js)
        el.querySelectorAll('[data-ex]').forEach((ex) =>
            window.__wlPopup.fill(ex, ex.dataset.ex, 'Mãe', 'Oi, meu filho, já chegou em casa?', null, true));
    }

    function toast(text) {
        const el = viewEl();
        if (!el) return;
        let t = el.querySelector('.wl-toast');
        if (!t) { t = document.createElement('div'); t.className = 'wl-toast'; t.setAttribute('role', 'status'); el.appendChild(t); }
        t.textContent = text;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.remove(), 2200);
    }

    async function open(name) {
        const drawer = document.querySelector('[data-testid="settings-drawer"]');
        if (!drawer) return;
        let el = viewEl();
        if (!el) {
            el = document.createElement('div');
            el.id = VIEW;
            el.innerHTML = `<header><button class="wl-back" aria-label="Voltar" title="Voltar">${BACK}</button><div class="wl-title"></div></header><div class="wl-body"></div>`;
            el.addEventListener('click', onClick);
            el.addEventListener('input', onInput);
            el.addEventListener('keydown', (e) => {
                const choice = e.target.closest('[data-pop]');
                if (choice && e.target === choice && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(choice.dataset.pop); }
            });
            drawer.appendChild(el);
        }
        current = name;
        confirming = false;
        state = await invoke('lite_get');
        render();
    }

    function close() {
        const el = viewEl();
        if (el) el.remove();
        current = null;
    }

    function saveBubble() {
        invoke('bubble_opts_set', { opts: state.bubble }).catch(() => {});
    }

    function paintColor() {
        const el = viewEl();
        el.querySelector('.wl-ball').style.background = state.bubble.color;
        el.querySelectorAll('.wl-sw').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === state.bubble.color));
    }

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // "Escolher": vai para Conversas e abre a tela Arquivadas, onde fica o botão de seleção
    async function openArchived() {
        const chats = document.querySelector('[data-navbar-item]'); // a primeira aba é Conversas
        if (chats) chats.click();
        for (let i = 0; i < 20; i++) {
            await wait(100);
            const btn = document.querySelector('[data-testid="chatlist-panel-archived-button"]');
            if (btn) return btn.click();
        }
    }

    function pick(id) {
        state.popup_style = id;
        window.__wlPopup.setStyle(id);
        invoke('lite_popup_style', { style: id }).catch(() => {});
        render();
    }

    async function onClick(e) {
        const see = e.target.closest('[data-see]');
        if (see) return window.__wlPopup.preview(see.dataset.see);
        const choice = e.target.closest('[data-pop]');
        if (choice) return pick(choice.dataset.pop);
        const t = e.target.closest('button');
        if (!t || t.disabled) return;
        if (t.classList.contains('wl-back')) return close();
        if (t.dataset.c) { state.bubble.color = t.dataset.c; paintColor(); return saveBubble(); }
        if (t.dataset.copy) {
            const name = CLIENTS.find((c) => c[0] === t.dataset.copy)[1];
            const ok = await invoke('lite_copy_command', { client: t.dataset.copy }).catch(() => false);
            const what = t.dataset.copy === 'codex' ? 'Trecho' : 'Comando';
            return toast(ok ? `${what} do ${name} copiado` : 'Não deu para copiar. Tente de novo.');
        }
        const act = t.dataset.act;
        if (act === 'archived') { close(); return openArchived(); }
        if (act === 'confirm' || act === 'cancel') { confirming = act === 'confirm'; return render(); }
        if (act === 'token') {
            const ok = await invoke('lite_new_token').catch(() => false);
            confirming = false;
            render();
            return toast(ok ? 'Chave trocada. Conecte os apps de novo.' : 'Não deu para trocar a chave.');
        }
        const k = t.dataset.k;
        if (!k) return;
        const on = t.getAttribute('aria-checked') !== 'true';
        t.setAttribute('aria-checked', on);
        if (k === 'bubble_mode') return on && invoke('bubble_enter');
        if (k.startsWith('b.')) { state.bubble[k.slice(2)] = on; render(); return saveBubble(); }
        state = await invoke('lite_set', { key: k, on });
        if (k === 'popup_on') window.__wlPopup.setOn(state.popup_on);
        render();
    }

    function onInput(e) {
        const t = e.target;
        if (t.classList.contains('wl-hue')) {
            state.bubble.color = `hsl(${t.value} 90% 60%)`;
            paintColor();
            saveBubble();
        } else if (t.classList.contains('wl-sec')) {
            state.bubble.seconds = Math.min(60, Math.max(1, parseInt(t.value, 10) || 5));
            t.style.setProperty('--p', pct(state.bubble.seconds));
            viewEl().querySelector('.wl-secval').textContent = state.bubble.seconds + ' s';
            saveBubble();
        }
    }

    function section() {
        const sec = document.createElement('div');
        sec.id = SEC;
        sec.innerHTML = group('WhatsApp Lite') + ITEMS.map(([go, t, s]) =>
            `<button class="wl-item" data-go="${go}">${ICONS[go]}<div class="wl-txt"><div class="wl-t">${t}</div><div class="wl-s">${s}</div></div></button>`).join('') +
            '<div class="wl-sep"></div>';
        sec.addEventListener('click', (e) => {
            const item = e.target.closest('[data-go]');
            if (item) open(item.dataset.go);
        });
        return sec;
    }

    // logo abaixo do perfil: antes do primeiro item do WhatsApp (botões role=listitem com data-testid)
    function inject() {
        injectTimer = 0;
        if (document.getElementById(SEC)) return;
        const drawer = document.querySelector('[data-testid="settings-drawer"]');
        const first = drawer && drawer.querySelector('button[role="listitem"][data-testid]');
        if (!first || !first.parentElement) { current = null; return; }
        if (!document.getElementById(SEC + '-style')) {
            const style = document.createElement('style');
            style.id = SEC + '-style';
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        first.before(section());
    }

    let injectTimer = 0;
    // setTimeout e não requestAnimationFrame: com a janela escondida o rAF não roda
    const schedule = () => { if (!injectTimer) injectTimer = setTimeout(inject, 50); };

    // a bandeja mudou um valor, ou a janela voltou (a bolinha pode ter mudado as opções)
    async function refresh() {
        if (!viewEl() || !current) return;
        state = await invoke('lite_get');
        render();
    }
    window.__wlLite = { refresh };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

    function init() {
        // documentElement: o WhatsApp recria o body ao carregar
        new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
        schedule();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
