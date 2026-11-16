// Seção "WhatsApp Lite" na tela Configurações do WhatsApp (engrenagem) e as 3 subtelas dela.
// Só mexe dentro de [data-testid="settings-drawer"]: se o WhatsApp mudar a tela e o ponto
// de inserção sumir, a seção não aparece. As chaves do MCP nunca vêm para a página: a tela
// recebe só a versão mascarada e o app copia o texto com a chave real (mcp_copiar).
(function () {
    'use strict';
    if (window.top !== window) return;

    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
    const SEC = 'wl-lite-sec';
    const VIEW = 'wl-lite-view';
    const PRESETS = ['#ffffff', '#25d366', '#53bdeb', '#ffd279', '#ff7a7a', '#c9a7ff'];
    const ADDR = 'http://127.0.0.1:47800/mcp';
    const TERMINAL = 'Comando para colar no terminal';
    // tipos de conexão: [id no Rust, nome, como conectar]
    const TIPOS = [
        ['claude', 'Claude Code', TERMINAL],
        ['gemini', 'Gemini CLI', TERMINAL],
        ['codex', 'Codex', 'Trecho para o arquivo ~/.codex/config.toml'],
        ['antigravity', 'Antigravity', TERMINAL],
        ['outro', 'Outro app (MCP padrão)', 'MCP padrão: endereço, chave e um trecho de configuração'],
    ];
    const tipoDe = (id) => TIPOS.find((t) => t[0] === id) || TIPOS[4];
    // ícones dos apps (src-tauri/ia-icons/, embutidos: a página do WhatsApp não lê arquivo do app)
    const APP_ICONS = {"claude":"<svg height=\"26\" viewBox=\"0 0 24 24\" width=\"26\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z\" fill=\"#D97757\" fill-rule=\"nonzero\"></path></svg>","gemini":"<svg height=\"34\" viewBox=\"0 0 24 24\" width=\"34\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z\" fill=\"#3186FF\"></path><path d=\"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z\" fill=\"url(#lobe-icons-gemini-0-_R_0_)\"></path><path d=\"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z\" fill=\"url(#lobe-icons-gemini-1-_R_0_)\"></path><path d=\"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z\" fill=\"url(#lobe-icons-gemini-2-_R_0_)\"></path><defs><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"lobe-icons-gemini-0-_R_0_\" x1=\"7\" x2=\"11\" y1=\"15.5\" y2=\"12\"><stop stop-color=\"#08B962\"></stop><stop offset=\"1\" stop-color=\"#08B962\" stop-opacity=\"0\"></stop></linearGradient><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"lobe-icons-gemini-1-_R_0_\" x1=\"8\" x2=\"11.5\" y1=\"5.5\" y2=\"11\"><stop stop-color=\"#F94543\"></stop><stop offset=\"1\" stop-color=\"#F94543\" stop-opacity=\"0\"></stop></linearGradient><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"lobe-icons-gemini-2-_R_0_\" x1=\"3.5\" x2=\"17.5\" y1=\"13.5\" y2=\"12\"><stop stop-color=\"#FABC12\"></stop><stop offset=\".46\" stop-color=\"#FABC12\" stop-opacity=\"0\"></stop></linearGradient></defs></svg>","codex":"<svg height=\"36\" viewBox=\"0 0 24 24\" width=\"36\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z\" fill=\"url(#lobe-icons-codex-_R_0_)\"></path><defs><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"lobe-icons-codex-_R_0_\" x1=\"12\" x2=\"12\" y1=\"3\" y2=\"21\"><stop stop-color=\"#B1A7FF\"></stop><stop offset=\".5\" stop-color=\"#7A9DFF\"></stop><stop offset=\"1\" stop-color=\"#3941FF\"></stop></linearGradient></defs></svg>","antigravity":"<img alt=\"\" width=\"36\" height=\"36\" src=\"data:image/png;base64,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\">"};

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

        #${VIEW} { --wl-card: #f7f8f8; --wl-info: #eaf3f0; --wl-code: #eef0f1; --wl-fg2: #3b4a54; --wl-line2: #c8ccce;
            --wl-warn: #b8860b; --wl-warnbg: #fdf0cf; --wl-warntx: #7a5a00; --wl-iabg: #dbe8ff; --wl-iatx: #1f4f9a;
            --wl-bubble: #fff; --wl-field: #f0f2f5; --wl-track: #aebac1; --wl-knob: #fff; --wl-toast: #111b21; --wl-toastfg: #fff;
            --wl-okbg: #d8f3e8; --wl-dangerbg: #fde3e6; --wl-tile: #d5d9db; }
        .dark #${VIEW} { --wl-card: #1d1f1f; --wl-info: #1d2a2f; --wl-code: #0f1112; --wl-fg2: #dcdedf; --wl-line2: #3c3e3e;
            --wl-warn: #ffd279; --wl-warnbg: #3a2f12; --wl-warntx: #ffd279; --wl-iabg: #1c2f4a; --wl-iatx: #8cb8ff;
            --wl-bubble: #202c33; --wl-field: #2e2f2f; --wl-track: #3b4a54; --wl-knob: #aebac1; --wl-toast: #2a3942; --wl-toastfg: ${FG};
            --wl-okbg: #12382c; --wl-dangerbg: #3a1a1f; --wl-tile: #3a3d3d; }
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
            background: var(--wl-track); border: 0; padding: 0; cursor: pointer; transition: background .15s; }
        #${VIEW} .wl-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
            border-radius: 50%; background: var(--wl-knob); transition: transform .15s, background .15s; }
        #${VIEW} .wl-switch[aria-checked="true"] { background: #00a884; }
        #${VIEW} .wl-switch[aria-checked="true"]::after { transform: translateX(16px); background: #fff; }
        #${VIEW} .wl-status { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: ${MUTED};
            padding: 0 0 10px; }
        #${VIEW} .wl-status i { width: 8px; height: 8px; border-radius: 50%; background: ${GREEN}; }
        #${VIEW} .wl-status.off i { background: #6b6f6f; }
        #${VIEW} .wl-app { width: 40px; height: 40px; flex: none; border-radius: 10px; display: grid; place-items: center;
            overflow: hidden; }
        #${VIEW} .wl-app svg, #${VIEW} .wl-app img { display: block; }
        /* Claude Code: fundo branco e símbolo laranja no claro; no escuro, o contrário */
        #${VIEW} .wl-claude { background: #fff; box-shadow: inset 0 0 0 1px #dadada; }
        #${VIEW} .wl-claude path { fill: #D97757; }
        .dark #${VIEW} .wl-claude { background: #D97757; box-shadow: none; }
        .dark #${VIEW} .wl-claude path { fill: #fff; }
        #${VIEW} .wl-new { color: #111; background: ${GREEN}; border-radius: 8px; padding: 1px 7px; font-size: 11px; margin-left: 6px; }
        #${VIEW} .wl-info { margin: 4px 0 8px; padding: 10px 14px; border-radius: 10px; background: var(--wl-info); color: ${MUTED};
            font-size: 13px; line-height: 18px; }
        #${VIEW} .wl-info b { color: ${FG}; font-weight: 600; }
        #${VIEW} .wl-info code { background: var(--wl-code); color: ${FG}; padding: 1px 6px; border-radius: 4px; font-size: 12.5px; }
        #${VIEW} .wl-nav { display: flex; align-items: center; gap: 22px; box-sizing: border-box; width: calc(100% + 12px);
            margin: 0 -6px; padding: 12px 6px; border: 0; border-radius: 8px; background: none; color: ${FG}; font: inherit;
            text-align: left; cursor: pointer; }
        #${VIEW} .wl-nav:hover, #${VIEW} .wl-nav:focus-visible { background: ${HOVER}; outline: none; }
        #${VIEW} .wl-nav .wl-t { font-size: 16px; }
        #${VIEW} .wl-pill { flex: none; min-width: 22px; height: 22px; box-sizing: border-box; padding: 0 7px; border-radius: 11px;
            background: #ffd279; color: #111; font-size: 12px; font-weight: 700; display: grid; place-items: center; }
        #${VIEW} .wl-status.bad i { background: var(--wl-warn); }
        #${VIEW} .wl-card { margin: 8px 0; padding: 12px 14px; border-radius: 12px; background: var(--wl-card); border: 1px solid ${LINE}; }
        #${VIEW} .wl-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font-size: 13px; color: ${MUTED}; }
        #${VIEW} .wl-head b { color: ${FG}; font-weight: 600; font-size: 14px; }
        #${VIEW} .wl-why { margin-left: auto; font-size: 11.5px; border-radius: 8px; padding: 1px 8px; background: var(--wl-warnbg);
            color: var(--wl-warntx); }
        #${VIEW} .wl-why.ia { background: var(--wl-iabg); color: var(--wl-iatx); }
        #${VIEW} .wl-msg { margin: 8px 0 10px; padding: 8px 10px; border-radius: 8px; background: var(--wl-code); color: var(--wl-fg2);
            font: 13px/1.45 Consolas, "Cascadia Mono", monospace; overflow-wrap: anywhere; white-space: pre-wrap; }
        #${VIEW} .wl-act { display: flex; gap: 8px; flex-wrap: wrap; }
        #${VIEW} .wl-empty { text-align: center; color: ${MUTED}; padding: 34px 10px; }
        #${VIEW} .wl-empty svg { width: 40px; height: 40px; stroke: ${GREEN}; fill: none; stroke-width: 1.6; stroke-linecap: round;
            stroke-linejoin: round; }
        #${VIEW} .wl-rule { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid ${LINE}; }
        #${VIEW} .wl-rule code { flex: 1; min-width: 0; overflow-wrap: anywhere; font: 13px Consolas, "Cascadia Mono", monospace;
            color: var(--wl-fg2); }
        #${VIEW} .wl-k { flex: none; font-size: 11.5px; color: ${MUTED}; border: 1px solid var(--wl-line2); border-radius: 8px; padding: 0 8px; }
        #${VIEW} .wl-x { flex: none; border: 0; background: none; color: ${MUTED}; cursor: pointer; padding: 4px; border-radius: 50%; display: grid; }
        #${VIEW} .wl-x:hover { background: ${HOVER}; color: ${FG}; }
        #${VIEW} .wl-x svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; }
        #${VIEW} .wl-add { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 0 4px; }
        #${VIEW} .wl-add input, #${VIEW} .wl-add select, #${VIEW} .wl-test input { background: var(--wl-field); color: ${FG}; border: 0;
            border-radius: 18px; padding: 8px 14px; font-family: inherit; font-size: 14px; min-width: 0; outline: none; }
        #${VIEW} .wl-add input { flex: 1 1 200px; }
        #${VIEW} .wl-add select { flex: none; width: auto; }
        #${VIEW} .wl-test { margin: 6px 0 0; padding: 12px 14px; border-radius: 12px; border: 1px dashed var(--wl-line2); }
        #${VIEW} .wl-test input { width: 100%; box-sizing: border-box; }
        #${VIEW} .wl-verdict { margin-top: 10px; font-size: 13.5px; min-height: 20px; }
        #${VIEW} .wl-verdict.ok { color: ${GREEN}; }
        #${VIEW} .wl-verdict.hit { color: var(--wl-warn); }
        #${VIEW} .wl-stats { display: flex; gap: 10px; flex-wrap: wrap; padding: 4px 0 8px; }
        #${VIEW} .wl-stat { flex: 1 1 110px; padding: 10px 14px; border-radius: 12px; background: var(--wl-card); border: 1px solid ${LINE}; }
        #${VIEW} .wl-stat b { display: block; font-size: 20px; font-weight: 600; }
        #${VIEW} .wl-stat span { color: ${MUTED}; font-size: 12.5px; }
        #${VIEW} .wl-bubble { display: flex; align-items: center; gap: 12px; margin: 8px 0; padding: 10px 14px; border-radius: 12px;
            background: var(--wl-bubble); max-width: 380px; box-shadow: 0 2px 8px rgba(0,0,0,.45); }
        #${VIEW} .wl-bubble i { flex: none; width: 36px; height: 36px; border-radius: 50%; background: var(--wl-warn); display: grid;
            place-items: center; color: #111; font-style: normal; font-weight: 700; }
        #${VIEW} .wl-bubble .wl-n { font-weight: 600; }
        #${VIEW} .wl-bubble .wl-m { color: ${MUTED}; font-size: 13.5px; }
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
            background: var(--wl-toast); color: var(--wl-toastfg); padding: 10px 18px; border-radius: 8px; font-size: 14px;
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
        /* conexões do MCP */
        #${VIEW} .wl-mut { color: ${MUTED}; }
        #${VIEW} .wl-conn, #${VIEW} .wl-newconn { display: flex; align-items: center; gap: 16px; box-sizing: border-box;
            width: calc(100% + 12px); margin: 0 -6px; padding: 12px 6px; border: 0; border-radius: 8px; background: none;
            color: ${FG}; font: inherit; text-align: left; cursor: pointer; }
        #${VIEW} .wl-conn:hover, #${VIEW} .wl-newconn:hover { background: ${HOVER}; }
        #${VIEW} .wl-conn:focus-visible, #${VIEW} .wl-newconn:focus-visible, #${VIEW} .wl-opt:focus-visible,
            #${VIEW} .wl-big:focus-visible { outline: 2px solid ${FG}; outline-offset: 2px; }
        #${VIEW} .wl-conn .wl-t { font-size: 16px; }
        #${VIEW} .wl-newconn { color: ${GREEN}; font-size: 15.5px; font-weight: 600; }
        #${VIEW} .wl-plus { flex: none; width: 40px; height: 40px; box-sizing: border-box; border-radius: 10px;
            border: 1.5px dashed ${GREEN}; display: grid; place-items: center; font-size: 22px; font-weight: 400; }
        #${VIEW} .wl-gen { background: var(--wl-tile); }
        #${VIEW} .wl-gen svg { width: 22px; height: 22px; fill: none; stroke: ${FG}; stroke-width: 1.7; stroke-linecap: round;
            stroke-linejoin: round; }
        #${VIEW} .wl-state { flex: none; font-size: 12px; padding: 1px 10px; border-radius: 10px; background: var(--wl-okbg); color: ${GREEN}; }
        #${VIEW} .wl-state.off { background: var(--wl-tile); color: ${MUTED}; }
        #${VIEW} .wl-chev { flex: none; width: 18px; height: 18px; stroke: ${MUTED}; fill: none; stroke-width: 2;
            stroke-linecap: round; stroke-linejoin: round; }
        #${VIEW} .wl-opt { display: flex; gap: 14px; align-items: center; padding: 12px 14px; margin: 6px 0;
            border: 1px solid var(--wl-line2); border-radius: 12px; cursor: pointer; }
        #${VIEW} .wl-opt:hover { background: ${HOVER}; }
        #${VIEW} .wl-opt.on { border-color: #00a884; box-shadow: inset 0 0 0 1px #00a884; }
        #${VIEW} .wl-radio { flex: none; width: 18px; height: 18px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--wl-line2); }
        #${VIEW} .wl-opt.on .wl-radio { border-color: #00a884; background: radial-gradient(#00a884 42%, transparent 48%); }
        #${VIEW} .wl-field { display: block; width: 100%; box-sizing: border-box; margin: 4px 0; background: var(--wl-field);
            color: ${FG}; border: 0; border-radius: 18px; padding: 10px 16px; font-family: inherit; font-size: 15px; outline: none; }
        #${VIEW} .wl-field:focus-visible { outline: 2px solid #00a884; }
        #${VIEW} .wl-lbl { color: ${MUTED}; font-size: 12.5px; padding: 10px 0 4px; }
        #${VIEW} .wl-copyrow { display: flex; gap: 10px; align-items: flex-start; padding: 4px 0; }
        #${VIEW} .wl-box { flex: 1; min-width: 0; background: var(--wl-code); border-radius: 10px; padding: 10px 12px;
            font: 12.5px/1.5 Consolas, "Cascadia Mono", monospace; color: var(--wl-fg2); overflow-wrap: anywhere; white-space: pre-wrap; }
        #${VIEW} .wl-copyrow .wl-btn { margin-top: 2px; }
        #${VIEW} .wl-big { flex: none; border: 0; background: #00a884; color: #fff; border-radius: 22px; padding: 10px 24px;
            font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
        #${VIEW} .wl-big:hover { filter: brightness(1.1); }
        #${VIEW} .wl-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; padding: 14px 0 4px; }
        #${VIEW} .wl-hist { display: flex; gap: 12px; padding: 9px 0; border-bottom: 1px solid ${LINE}; font-size: 13px; color: ${MUTED}; }
        #${VIEW} .wl-when { flex: none; width: 96px; }
        #${VIEW} .wl-hist b { color: ${FG}; font-weight: 600; }
        #${VIEW} .wl-hist .wl-q { margin-left: auto; flex: none; text-align: right; }
        #${VIEW} .wl-confirm { margin: 8px 0; padding: 12px 14px; border-radius: 12px; background: var(--wl-dangerbg);
            border: 1px solid var(--WDS-secondary-negative, #fb5061); }
        #${VIEW} .wl-confirm p { margin: 0 0 10px; font-size: 14px; }
        #${VIEW} .wl-confirm .wl-actions { padding: 0; }
        #${VIEW} .wl-kv { display: flex; gap: 6px 22px; flex-wrap: wrap; font-size: 13px; color: ${MUTED}; padding: 0 0 6px; }
        #${VIEW} .wl-kv b { color: ${FG}; font-weight: 600; }
        #${VIEW} .wl-dt { display: flex; align-items: center; gap: 12px; }
        #${VIEW} .wl-dt .wl-app { width: 34px; height: 34px; }
        @media (max-width: 640px) { #${VIEW} .wl-body { padding: 0 16px 24px; } }
    `;

    const svg = (d) => `<svg viewBox="0 0 24 24" class="wl-ico">${d}</svg>`;
    const ICONS = {
        bolinha: svg('<circle cx="12" cy="12" r="8"/><path d="M9 13.5c1.5 1.5 4.5 1.5 6 0"/>'),
        mcp: svg('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>'),
        aplicativo: svg('<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/>'),
        list: svg('<path d="M5 6h14M5 12h14M5 18h9"/>'),
        ai: svg('<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 15h6"/>'),
        inbox: svg('<path d="M4 13l2-7h12l2 7v5H4zM4 13h5l1 2h4l1-2h5"/>'),
    };
    const CHECK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>';
    const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const BACK = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>';
    const BALL = '<svg viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
    const PLUG = '<svg viewBox="0 0 24 24"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/></svg>';
    const CHEV = '<svg class="wl-chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
    const ITEMS = [
        ['bolinha', 'Bolinha flutuante', 'Cor, contador, prévia e som'],
        ['mcp', 'Conectores de IA', 'Claude, Gemini, Codex e outros leem suas conversas'],
        ['aplicativo', 'Aplicativo', 'Segundo plano, iniciar com o Windows, downloads'],
    ];

    const POPUPS = [['a', 'A · Cartão no topo (padrão)'], ['b', 'B · Canto de baixo, à direita'], ['c', 'C · Pílula compacta no topo']];

    let state = null;     // lite_get: valores do app (conexões com a chave mascarada)
    let fil = null;       // filtro_get: retidas, regras do usuário, contadores da esteira
    let teste = null;     // último "Testar conexão" do Ollama
    // subtela -> tela de onde veio (o Voltar volta para ela)
    const PARENT = { retidas: 'mcp', regras: 'mcp', ia: 'mcp', nova: 'mcp', pronta: 'mcp', det: 'mcp', renovada: 'det', todas: 'mcp' };
    let current = null;   // subtela aberta
    let cur = null;       // id da conexão aberta (det, pronta, renovada)
    let asking = null;    // confirmação aberta na conexão: 'renovar' | 'revogar'
    let novoTipo = 'claude', novoNome = '';
    let toastTimer = null;

    const sw = (k, on, label) =>
        `<button class="wl-switch" role="switch" aria-checked="${!!on}" aria-label="${label}" data-k="${k}"></button>`;
    const row = (t, s, right) =>
        `<div class="wl-row"><div class="wl-txt"><div class="wl-t">${t}</div>${s ? `<div class="wl-s">${s}</div>` : ''}</div>${right}</div>`;
    const group = (t) => `<div class="wl-group">${t}</div>`;
    const hueOf = (color) => { const m = /^hsl\((\d+)/.exec(color); return m ? m[1] : 140; };
    const pct = (sec) => ((sec - 1) / 59 * 100) + '%';
    // texto de terceiros (mensagem, nome, regra) nunca entra como HTML
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const info = (html) => `<div class="wl-info">${html}</div>`;
    const nav = (icon, t, s, go, right = '') =>
        `<button class="wl-nav" data-nav="${go}">${ICONS[icon]}<div class="wl-txt"><div class="wl-t">${t}</div><div class="wl-s">${s}</div></div>${right}</button>`;
    const pad2 = (n) => String(n).padStart(2, '0');
    const diaDe = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    // "2026-11-15 14:32" -> "hoje 14:32", "ontem 22:47" ou "13/11 09:10"
    function quando(h) {
        const [d, hm] = String(h).split(' ');
        const hoje = new Date();
        if (d === diaDe(hoje)) return 'hoje ' + hm;
        if (d === diaDe(new Date(hoje.getTime() - 864e5))) return 'ontem ' + hm;
        const [, m, dd] = d.split('-');
        return dd + '/' + m + ' ' + hm;
    }
    const ollamaOk = () => (teste ? teste.ok : fil && fil.ollama);

    // ---- conexões do MCP ----
    const hm = (d) => diaDe(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const quandoT = (t) => quando(hm(new Date(t * 1000)));
    const dataCurta = (t) => { const d = new Date(t * 1000); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1); };
    const num = (n) => Number(n || 0).toLocaleString('pt-BR');
    const UNID = { ler_mensagens: ['mensagem', 'mensagens'], ver_imagens: ['imagem', 'imagens'], listar_conversas: ['conversa', 'conversas'] };
    const qtd = (h) => num(h.n) + ' ' + (UNID[h.ferramenta] || ['', ''])[h.n === 1 ? 0 : 1];
    const conn = () => (state.conexoes || []).find((c) => c.id === cur);
    const tile = (tipo) => tipo === 'outro' ? `<div class="wl-app wl-gen">${PLUG}</div>`
        : `<div class="wl-app${tipo === 'claude' ? ' wl-claude' : ''}">${APP_ICONS[tipo] || ''}</div>`;
    const sub = (c) => c.ultima ? `Última leitura ${quandoT(c.ultima)} · ${num(c.chamadas)} chamadas · ${num(c.mensagens)} mensagens` : 'Ainda não leu nada';
    const copyrow = (text, what, label = 'Copiar') =>
        `<div class="wl-copyrow"><div class="wl-box">${esc(text)}</div><button class="wl-btn" data-cp="${what}">${label}</button></div>`;
    const lbl = (t) => `<div class="wl-lbl">${t}</div>`;
    // o que a tela mostra para conectar; o texto vem do app com a chave mascarada
    const conectar = (c) => c.tipo === 'outro'
        ? lbl('Endereço') + copyrow(ADDR, 'endereco') +
          lbl('Chave de acesso (cabeçalho Authorization: Bearer)') + copyrow(c.chave, 'chave', 'Copiar chave') +
          lbl('Trecho de configuração comum (muda um pouco de app para app)') + copyrow(c.conectar, 'conectar')
        : lbl(tipoDe(c.tipo)[2]) + copyrow(c.conectar, 'conectar');
    const pronto = (texto, status) => (c) => `<div class="wl-status"><i></i>${esc(c.nome)} · ${status}</div>` + conectar(c) +
        info(texto) + '<div class="wl-actions"><button class="wl-big" data-act="voltar">Concluído</button></div>';

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
            const cs = state.conexoes || [];
            return row('Permitir que IAs leiam suas conversas', 'Só leitura. Nada é enviado nem marcado como lido.',
                    sw('mcp_enabled', state.mcp_enabled, 'Permitir que IAs leiam suas conversas')) +
                `<div class="wl-status ${cls}"><i></i>${text}</div>` +
                group(`Conexões (${cs.length}) <span class="wl-mut">· cada app tem a sua chave</span>`) +
                cs.map((c) => `<button class="wl-conn" data-det="${c.id}">${tile(c.tipo)}<div class="wl-txt"><div class="wl-t">${esc(c.nome)}</div><div class="wl-s">${sub(c)}</div></div><span class="wl-state${c.ativa ? '' : ' off'}">${c.ativa ? 'Ativa' : 'Pausada'}</span>${CHEV}</button>`).join('') +
                '<button class="wl-newconn" data-act="nova"><span class="wl-plus">+</span>Nova conexão</button>' +
                group('Celular') +
                row('Gemini e app do Claude no celular', 'Em breve: precisa de acesso pela internet com login', '<button class="wl-btn" disabled>Em breve</button>') +
                group('Filtro de mensagens <span class="wl-new">novo</span>') +
                info('Antes de a IA ver uma conversa, o app tira as mensagens que parecem <b>ordens para ela</b> ou <b>comandos de computador</b>. Elas ficam guardadas aqui, só no seu PC, para você decidir.') +
                nav('inbox', 'Mensagens retidas', 'Revise e decida o que a IA pode ler', 'retidas',
                    fil.retidas.length ? `<span class="wl-pill">${fil.retidas.length}</span>` : '') +
                nav('list', 'Regras do filtro', 'Padrões prontos e os seus', 'regras') +
                nav('ai', 'Verificação por IA local', !state.filtro_ia ? 'Desligada: só as regras valem'
                    : ollamaOk() === false ? 'Ligada, mas o Ollama está desligado' : 'Gemma 4 E4B · ligada', 'ia') +
                row('Avisar na bolinha quando reter', 'Mostra "1 mensagem retida" quando algo for guardado',
                    sw('filtro_avisar', state.filtro_avisar, 'Avisar na bolinha quando reter')) +
                group('Segurança') +
                row('Avisar quando uma IA ler', 'A bolinha mostra qual conexão leu, qual conversa e quantas mensagens', sw('mcp_notify', state.mcp_notify, 'Avisar quando uma IA ler')) +
                `<div class="wl-bubble"><i style="background:#fff">${APP_ICONS.gemini.replace(/(width|height)="34"/g, '$1="22"')}</i><div><div class="wl-n">Gemini CLI leu Grupo da firma (exemplo)</div><div class="wl-m">402 mensagens</div></div></div>` +
                (cs.length ? row('<span class="wl-danger">Revogar todas as conexões</span>', 'Todos os apps perdem o acesso de uma vez',
                    '<button class="wl-btn wl-danger" data-act="todas">Revogar todas</button>') : '');
        }],
        nova: ['Nova conexão', () => {
            const nome = tipoDe(novoTipo)[1];
            return group('Nome') +
                `<input class="wl-field wl-nome" maxlength="60" placeholder="Ex.: ${novoTipo === 'outro' ? 'Meu script' : esc(nome) + ' do notebook'}" aria-label="Nome da conexão" value="${esc(novoNome)}">` +
                group('Tipo de app') +
                TIPOS.map(([id, name, how]) => `<div class="wl-opt${id === novoTipo ? ' on' : ''}" role="radio" tabindex="0" aria-checked="${id === novoTipo}" data-tipo="${id}"><span class="wl-radio"></span>${tile(id)}<div class="wl-txt"><div class="wl-t">${name}</div><div class="wl-s">${how}</div></div></div>`).join('') +
                info('Cada conexão ganha a <b>sua própria chave</b>. Dá para pausar, renovar a chave ou revogar só ela, sem derrubar os outros apps.') +
                '<div class="wl-actions"><button class="wl-big" data-act="criar">Criar conexão</button><button class="wl-btn" data-act="voltar">Cancelar</button></div>';
        }],
        pronta: ['Conexão criada', pronto('Cole no app e abra uma sessão <b>nova</b>. Você pode ver isto de novo na tela da conexão, a qualquer hora.', 'chave nova criada')],
        renovada: ['Chave renovada', pronto('O app conectado perdeu o acesso. Cole o comando novo nele e abra uma sessão nova.', 'a chave antiga já não funciona')],
        det: [(c) => `<span class="wl-dt">${tile(c.tipo)}${esc(c.nome)}</span>`, (c) =>
            `<div class="wl-status ${c.ativa ? '' : 'off'}"><i></i>${c.ativa ? 'Ativa' : 'Pausada: o app recebe "não autorizado"'} · criada em ${dataCurta(c.criada)}</div>` +
            row('Conexão ativa', 'Desligada, a chave fica guardada, mas o app não lê nada até você ligar de novo', sw('conn_ativa', c.ativa, 'Conexão ativa')) +
            group('Conectar') + conectar(c) +
            group('Consumo') +
            `<div class="wl-stats"><div class="wl-stat"><b>${num(c.chamadas)}</b><span>chamadas</span></div><div class="wl-stat"><b>${num(c.mensagens)}</b><span>mensagens lidas</span></div><div class="wl-stat"><b>${num(c.imagens)}</b><span>imagens vistas</span></div></div>` +
            `<div class="wl-kv"><span>Última leitura: <b>${c.ultima ? quandoT(c.ultima) : 'nunca'}</b></span></div>` +
            group('Últimas leituras <span class="wl-mut">· só hora, conversa e quantidade, nunca o texto</span>') +
            (c.historico.length
                ? c.historico.map((h) => `<div class="wl-hist"><span class="wl-when">${quandoT(h.t)}</span><span><b>${esc(h.ferramenta)}</b><br>${esc(h.conversa || '—')}</span><span class="wl-q">${qtd(h)}</span></div>`).join('') +
                  '<div class="wl-actions"><button class="wl-btn" data-act="limpar">Limpar histórico</button></div>'
                : '<div class="wl-empty" style="padding:16px">Nenhuma leitura ainda.</div>') +
            group('Chave de acesso') +
            (asking === 'renovar'
                ? `<div class="wl-confirm"><p><b>Renovar a chave de "${esc(c.nome)}"?</b> O app conectado perde o acesso agora e só volta quando você colar o comando novo.</p><div class="wl-actions"><button class="wl-btn" data-act="nao">Cancelar</button><button class="wl-big" data-act="renovar">Renovar</button></div></div>`
                : asking === 'revogar'
                ? `<div class="wl-confirm"><p><b>Revogar "${esc(c.nome)}"?</b> O app perde o acesso agora e a conexão deixa de existir. Os outros apps não são afetados.</p><div class="wl-actions"><button class="wl-btn" data-act="nao">Cancelar</button><button class="wl-btn wl-danger" data-act="revogar">Revogar</button></div></div>`
                : row('Renovar chave', 'Gera uma chave nova. O app conectado cai até você colar o comando novo.', '<button class="wl-btn" data-act="ask_renovar">Renovar</button>') +
                  row('<span class="wl-danger">Revogar conexão</span>', 'Apaga esta conexão e a chave de vez. Os outros apps continuam.', '<button class="wl-btn wl-danger" data-act="ask_revogar">Revogar</button>'))],
        todas: ['Revogar todas as conexões', () => {
            const n = (state.conexoes || []).length;
            return `<div class="wl-confirm"><p><b>${n === 1 ? 'O app conectado perde' : `Todos os ${n} apps perdem`} o acesso agora.</b> As conexões e as chaves são apagadas. Para voltar a usar, crie as conexões de novo.</p><div class="wl-actions"><button class="wl-btn" data-act="voltar">Cancelar</button><button class="wl-btn wl-danger" data-act="revogar_todas">Revogar todas</button></div></div>`;
        }],
        retidas: ['Mensagens retidas', () =>
            info('<b>Liberar não executa nada.</b> O app nunca executa comando de mensagem. Liberar só deixa a IA <b>ler</b> a mensagem nas próximas leituras. Até lá, a IA vê apenas <code>[mensagem retida para revisão] Carlos, 14:32</code>, sem o texto.') +
            (fil.retidas.length ? fil.retidas.map((r, i) =>
                `<div class="wl-card"><div class="wl-head"><b>${esc(r.conversa)}</b><span>${esc(r.autor)}</span><span>${esc(quando(r.hora))}</span><span class="wl-why${r.motivo.startsWith('IA') ? ' ia' : ''}">${esc(r.motivo)}</span></div>
                  <div class="wl-msg">${esc(r.texto)}</div>
                  <div class="wl-act"><button class="wl-btn" data-lib="${i}">Liberar para a IA</button><button class="wl-btn wl-danger" data-del="${i}">Apagar</button></div></div>`).join('')
                : `<div class="wl-empty">${CHECK}<div style="margin-top:8px">Nada retido. As mensagens com cara de comando aparecem aqui.</div></div>`) +
            group('Como a bolinha avisa') +
            '<div class="wl-bubble"><i>!</i><div><div class="wl-n">1 mensagem retida</div><div class="wl-m">Grupo da firma (exemplo): revise em Conectores de IA</div></div></div>'],
        regras: ['Regras do filtro', () =>
            '<div class="wl-s" style="padding-top:6px">Sempre valem, mesmo sem a IA local.</div>' +
            group('Regras prontas e suas') +
            window.__wlFiltro.PRONTAS.map((p) => `<div class="wl-rule"><span class="wl-k">${esc(p.k)}</span><code>${esc(p.mostra)}</code><span class="wl-k">pronta</span></div>`).join('') +
            fil.minhas.map((r, i) => `<div class="wl-rule"><span class="wl-k">${r.tipo === 'regex' ? 'Padrão' : 'Texto'}</span><code>${esc(r.v)}</code><button class="wl-x" data-rm="${i}" aria-label="Remover regra" title="Remover regra">${X}</button></div>`).join('') +
            `<div class="wl-add"><select class="wl-tipo" aria-label="Tipo"><option value="texto">Texto</option><option value="regex">Padrão (regex)</option></select>
              <input class="wl-novo" placeholder="Ex.: transfira tudo" aria-label="Nova regra" maxlength="200"><button class="wl-btn" data-act="add">Adicionar</button></div>` +
            group('Testar uma frase') +
            '<div class="wl-test"><input class="wl-frase" placeholder="Digite uma frase para ver se seria retida" aria-label="Frase de teste"><div class="wl-verdict"></div></div>'],
        ia: ['Verificação por IA local', () => {
            const ok = ollamaOk();
            return row('Usar a IA local', 'Lê as mensagens que passaram pelas regras e separa as que parecem ordens. Só lê: não executa nada.',
                    sw('filtro_ia', state.filtro_ia, 'Usar a IA local')) +
                `<div class="wl-status ${ok ? '' : ok === false ? 'bad' : 'off'}"><i></i>${ok ? 'Ollama ligado neste computador'
                    : ok === false ? (teste && /modelo/.test(teste.erro) ? 'O Ollama não tem o modelo gemma4:e4b: só as regras estão valendo' : 'Ollama não encontrado: só as regras estão valendo')
                    : 'Procurando o Ollama…'}</div>` +
                `<div class="${state.filtro_ia ? '' : 'wl-dim'}">` +
                group('Modelo') +
                row('Gemma 4 E4B', (ok ? 'Já instalado no seu Ollama · ' : '') + 'roda só neste PC, nada sai da máquina', '<button class="wl-btn" data-act="ollama">Testar conexão</button>') +
                group('Esteira em segundo plano') +
                `<div class="wl-stats"><div class="wl-stat"><b>${fil.verificadas.toLocaleString('pt-BR')}</b><span>verificadas</span></div><div class="wl-stat"><b>${fil.retidas.length}</b><span>retidas</span></div><div class="wl-stat"><b>${fil.fila}</b><span>na fila</span></div></div>` +
                info('A verificação roda em segundo plano, conforme as mensagens chegam, e o resultado fica guardado. Na hora da leitura quase tudo já está verificado.') +
                group('Sem o Ollama') +
                info('Quem não usa Ollama liga só as <b>regras</b>: o filtro continua valendo e a tela avisa "verificação por IA local desligada". A leitura nunca fica bloqueada.') +
                '</div>';
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
        const c = conn();
        if (!c && ['det', 'pronta', 'renovada'].includes(current)) current = 'mcp'; // revogada: volta para a lista
        const [title, html] = VIEWS[current];
        el.querySelector('.wl-title').innerHTML = typeof title === 'function' ? title(c) : title;
        el.querySelector('.wl-body').innerHTML = html(c);
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
                if (e.key === 'Enter' && e.target.classList.contains('wl-novo')) return addRule();
                if (e.key === 'Enter' && e.target.classList.contains('wl-nome')) return criar();
                const opt = e.target.closest('[data-tipo]');
                if (opt && e.target === opt && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); novoTipo = opt.dataset.tipo; render(); }
                const choice = e.target.closest('[data-pop]');
                if (choice && e.target === choice && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(choice.dataset.pop); }
            });
            drawer.appendChild(el);
        }
        current = name;
        asking = null;
        [state, fil] = await Promise.all([invoke('lite_get'), invoke('filtro_get')]);
        render();
        el.querySelector('.wl-body').scrollTop = 0;
        if (name === 'ia') checkOllama(false);
    }

    // status do Ollama (lista de modelos: não carrega nada na placa de vídeo)
    async function checkOllama(avisar) {
        teste = await invoke('filtro_ollama').catch(() => ({ ok: false, erro: '' }));
        if (current === 'ia' || current === 'mcp') render();
        if (avisar) toast(teste.ok ? `Conectou: respondeu em ${(teste.ms / 1000).toFixed(1).replace('.', ',')} s`
            : /modelo/.test(teste.erro) ? 'O Ollama não tem o modelo gemma4:e4b' : 'Não achei o Ollama em 127.0.0.1:11434');
    }

    async function addRule() {
        const el = viewEl();
        const input = el.querySelector('.wl-novo');
        const tipo = el.querySelector('.wl-tipo').value;
        const v = input.value.trim();
        if (!v) return;
        if (tipo === 'regex' && !window.__wlFiltro.valida(v)) return toast('Padrão inválido: confira a regex');
        fil = await invoke('filtro_minhas', { regras: [...fil.minhas, { tipo, v }] });
        render();
        toast('Regra adicionada');
    }

    // ação numa conexão; a resposta traz a lista nova (com a chave mascarada)
    async function conexao(acao, extra = {}) {
        const r = await invoke('mcp_conexao', { acao, id: cur, ...extra }).catch(() => null);
        if (r) state.conexoes = r.conexoes;
        asking = null;
        return r && r.ok ? r : null;
    }

    async function criar() {
        const nome = novoNome.trim() || (novoTipo === 'outro' ? 'Meu app' : tipoDe(novoTipo)[1]);
        const r = await conexao('criar', { nome, tipo: novoTipo });
        if (!r) return toast('Não deu para criar a conexão.');
        cur = r.id;
        go('pronta');
    }

    // troca de subtela sem buscar de novo no app
    function go(name) {
        current = name;
        render();
        viewEl().querySelector('.wl-body').scrollTop = 0;
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
        const opt = e.target.closest('[data-tipo]');
        if (opt) { novoTipo = opt.dataset.tipo; return render(); }
        const t = e.target.closest('button');
        if (!t || t.disabled) return;
        if (t.classList.contains('wl-back') || t.dataset.act === 'voltar') return PARENT[current] ? open(PARENT[current]) : close();
        if (t.dataset.nav) return open(t.dataset.nav);
        if (t.dataset.det) { cur = +t.dataset.det; return open('det'); }
        if (t.dataset.cp) {
            const ok = await invoke('mcp_copiar', { id: cur, oque: t.dataset.cp }).catch(() => false);
            const c = conn();
            const what = { endereco: 'Endereço copiado', chave: 'Chave copiada' }[t.dataset.cp]
                || (c && (c.tipo === 'codex' || c.tipo === 'outro') ? 'Trecho copiado' : 'Comando copiado');
            return toast(ok ? what : 'Não deu para copiar. Tente de novo.');
        }
        if (t.dataset.lib || t.dataset.del) {
            const r = fil.retidas[+(t.dataset.lib || t.dataset.del)];
            if (!r) return;
            fil = await invoke('filtro_acao', { id: r.id, acao: t.dataset.lib ? 'liberar' : 'apagar' });
            render();
            return toast(t.dataset.lib ? 'Liberada: a IA passa a ver essa mensagem' : 'Apagada. Continua escondida da IA');
        }
        if (t.dataset.rm) {
            fil = await invoke('filtro_minhas', { regras: fil.minhas.filter((_, i) => i !== +t.dataset.rm) });
            return render();
        }
        if (t.dataset.c) { state.bubble.color = t.dataset.c; paintColor(); return saveBubble(); }
        const act = t.dataset.act;
        if (act === 'add') return addRule();
        if (act === 'ollama') return checkOllama(true);
        if (act === 'archived') { close(); return openArchived(); }
        if (act === 'nova') { novoTipo = 'claude'; novoNome = ''; return go('nova'); }
        if (act === 'criar') return criar();
        if (act === 'todas') return go('todas');
        if (act === 'ask_renovar' || act === 'ask_revogar' || act === 'nao') { asking = act === 'nao' ? null : act.slice(4); return render(); }
        if (act === 'renovar') {
            const ok = await conexao('renovar');
            if (ok) { toast('Chave renovada'); return go('renovada'); }
            render();
            return toast('Não deu para renovar a chave.');
        }
        if (act === 'revogar' || act === 'revogar_todas') {
            const ok = await conexao(act);
            go('mcp');
            return toast(!ok ? 'Não deu para revogar.' : act === 'revogar' ? 'Conexão revogada' : 'Todas as conexões foram revogadas');
        }
        if (act === 'limpar') { await conexao('limpar'); render(); return toast('Histórico limpo'); }
        const k = t.dataset.k;
        if (!k) return;
        const on = t.getAttribute('aria-checked') !== 'true';
        t.setAttribute('aria-checked', on);
        if (k === 'conn_ativa') {
            const ok = await conexao(on ? 'ativar' : 'pausar');
            render();
            return toast(!ok ? 'Não deu para mudar a conexão.' : on ? 'Conexão reativada' : 'Conexão pausada');
        }
        if (k === 'bubble_mode') return on && invoke('bubble_enter');
        if (k.startsWith('b.')) { state.bubble[k.slice(2)] = on; render(); return saveBubble(); }
        state = await invoke('lite_set', { key: k, on });
        if (k === 'popup_on') window.__wlPopup.setOn(state.popup_on);
        render();
        if (k === 'filtro_ia' && on) checkOllama(false);
    }

    function onInput(e) {
        const t = e.target;
        if (t.classList.contains('wl-nome')) novoNome = t.value;
        else if (t.classList.contains('wl-frase')) {
            const out = t.nextElementSibling;
            const v = t.value.trim();
            const hit = v && window.__wlFiltro.regra(v, window.__wlFiltro.compilar(fil.minhas));
            out.className = 'wl-verdict' + (v ? (hit ? ' hit' : ' ok') : '');
            out.textContent = !v ? '' : hit ? 'Seria retida pela regra: ' + hit : 'Passaria: a IA veria esta mensagem.';
        } else if (t.classList.contains('wl-hue')) {
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
        [state, fil] = await Promise.all([invoke('lite_get'), invoke('filtro_get')]);
        // não apaga o que está sendo digitado nas regras nem a confirmação aberta
        if (current !== 'regras' && current !== 'nova' && !asking) render();
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
