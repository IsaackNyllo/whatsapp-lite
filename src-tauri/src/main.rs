#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod mcp;

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use serde_json::{json, Value};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, Webview, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};

struct Settings {
    run_in_background: AtomicBool,
    ask_download_path: AtomicBool,
    mcp_enabled: AtomicBool,
    /// "Avisar quando uma IA ler": balão na bolinha a cada leitura
    mcp_notify: AtomicBool,
    /// trocado pela tela "Conectores de IA"; nunca vai para a página do WhatsApp
    mcp_token: Mutex<String>,
    /// opções da bolinha (cor, contador, prévia, som, segundos); None = nunca salvas
    bubble: Mutex<Option<Value>>,
    /// visual do aviso de mensagem dentro da conversa: "a" (cartão), "b" (canto) ou "c" (pílula)
    popup_style: Mutex<String>,
}

/// Itens da bandeja que a tela de configurações também muda.
struct TrayItems {
    background: CheckMenuItem<Wry>,
    ask_download: CheckMenuItem<Wry>,
    mcp: CheckMenuItem<Wry>,
}

const DEFAULT_PROXY: Option<&str> = None;

const AD_REMOVAL_SCRIPT: &str = include_str!("../remove_ad.js");
const MOBILE_LAYOUT_SCRIPT: &str = include_str!("../mobile_layout.js");
const COMPACT_CHAT_SCRIPT: &str = include_str!("../compact_chat.js");
const MESSAGE_POPUP_SCRIPT: &str = include_str!("../message_popup.js");
const TITLEBAR_SCRIPT: &str = include_str!("../titlebar.js");
const BUBBLE_FEED_SCRIPT: &str = include_str!("../bubble_feed.js");
const MCP_TOOLS_SCRIPT: &str = include_str!("../mcp_tools.js");
const LITE_SETTINGS_SCRIPT: &str = include_str!("../lite_settings.js");

const WHATSAPP_ORIGIN: &str = "https://web.whatsapp.com/";

fn configure_webview_args() {
    let mut args = Vec::new();

    if let Some(proxy) = env::var("WHATSAPP_PROXY")
        .ok()
        .or_else(|| DEFAULT_PROXY.map(String::from))
    {
        args.push(format!("--proxy-server={}", proxy));
    }

    args.extend([
        "--disable-gpu-compositing".to_string(),
        "--disable-smooth-scrolling".to_string(),
        "--disable-features=msWebOOUI".to_string(),
        // o som da bolinha toca sem ninguém clicar na janela dela
        "--autoplay-policy=no-user-gesture-required".to_string(),
    ]);

    // desenvolvimento: ex. WL_WEBVIEW_ARGS=--remote-debugging-port=9222 para inspecionar a página
    if let Ok(extra) = env::var("WL_WEBVIEW_ARGS") {
        args.push(extra);
    }

    if !args.is_empty() {
        env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args.join(" "));
    }
}

fn open_in_browser(url: &Url) {
    // links de mensagens: nada de file://, ms-settings: etc.
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }

    if let Err(e) = open::that_detached(url.as_str()) {
        eprintln!("Erro ao abrir link no navegador: {}", e);
    }
}

// O Tauri só trata a permissão de clipboard, então o WebView2 negava as
// notificações (e salvava a recusa no perfil).
#[cfg(windows)]
fn allow_notifications(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{
        take_pwstr, PermissionRequestedEventHandler, SetPermissionStateCompletedHandler,
    };
    use windows::core::{w, Interface};

    window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };

        let profile = core
            .cast::<ICoreWebView2_13>()
            .and_then(|core| core.Profile())
            .and_then(|profile| profile.cast::<ICoreWebView2Profile4>());
        if let Ok(profile) = profile {
            let done = SetPermissionStateCompletedHandler::create(Box::new(|result| {
                if let Err(e) = result {
                    eprintln!("Erro ao liberar notificações: {}", e);
                }
                Ok(())
            }));
            let _ = profile.SetPermissionState(
                COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS,
                w!("https://web.whatsapp.com"),
                COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                &done,
            );
        }

        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };

            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind != COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS {
                return Ok(());
            }

            let mut uri = Default::default();
            args.Uri(&mut uri)?;
            if take_pwstr(uri).starts_with(WHATSAPP_ORIGIN) {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }

            Ok(())
        }));

        let mut token = 0;
        if let Err(e) = core.add_PermissionRequested(&handler, &mut token) {
            eprintln!("Erro ao configurar notificações: {}", e);
        }
    })
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

fn popup_style_clean(v: &str) -> &'static str {
    match v {
        "b" => "b",
        "c" => "c",
        _ => "a",
    }
}

fn load_settings(app: &AppHandle) -> Settings {
    let json = settings_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .unwrap_or_default();
    let flag = |key: &str, default| AtomicBool::new(json[key].as_bool().unwrap_or(default));
    let token = json["mcp_token"].as_str().filter(|t| t.len() == 64).map(String::from);

    Settings {
        run_in_background: flag("run_in_background", true),
        ask_download_path: flag("ask_download_path", true),
        mcp_enabled: flag("mcp_enabled", false),
        mcp_notify: flag("mcp_notify", true),
        mcp_token: Mutex::new(token.unwrap_or_else(mcp::new_token)),
        bubble: Mutex::new(json["bubble"].is_object().then(|| bubble_clean(&json["bubble"]))),
        popup_style: Mutex::new(popup_style_clean(json["popup_style"].as_str().unwrap_or("")).into()),
    }
}

fn save_settings(app: &AppHandle) {
    let Some(path) = settings_path(app) else { return };
    let settings = app.state::<Settings>();
    let json = json!({
        "run_in_background": settings.run_in_background.load(Ordering::Relaxed),
        "ask_download_path": settings.ask_download_path.load(Ordering::Relaxed),
        "mcp_enabled": settings.mcp_enabled.load(Ordering::Relaxed),
        "mcp_notify": settings.mcp_notify.load(Ordering::Relaxed),
        "mcp_token": *settings.mcp_token.lock().unwrap(),
        "bubble": *settings.bubble.lock().unwrap(),
        "popup_style": *settings.popup_style.lock().unwrap(),
    });
    let result = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|_| fs::write(&path, json.to_string()));
    if let Err(e) = result {
        eprintln!("Erro ao salvar preferências: {}", e);
    }
}

fn show_main_window(app: &AppHandle) {
    close_bubble(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.__wlBubbleMode = false");
        set_in_tray(&window, false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// Bolinha: janela pequena, sempre por cima, com a página de src-tauri/bubble/.
// Só existe enquanto a bolinha está ativa: uma janela escondida custa ~100 MB.
fn create_bubble(app: &AppHandle) -> tauri::Result<()> {
    // ambiente próprio do WebView2: dividir o da principal impede ela de encolher na bandeja
    let dir = app.path().app_local_data_dir().map(|d| d.join("bubble-webview"));
    let mut builder = WebviewWindowBuilder::new(app, "bubble", WebviewUrl::App("index.html".into()));
    if let Ok(dir) = dir {
        builder = builder.data_directory(dir);
    }
    let bubble = builder
        .title("WhatsApp Lite")
        .inner_size(76.0, 76.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()?;
    // o Windows impõe largura mínima a janela criada visível; força o tamanho depois
    let _ = bubble.set_size(tauri::LogicalSize::new(76.0, 76.0));
    Ok(())
}

fn close_bubble(app: &AppHandle) {
    if let Some(bubble) = app.get_webview_window("bubble") {
        let _ = bubble.close();
    }
}

fn eval_in(app: &AppHandle, label: &str, js: String) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.eval(js);
    }
}

// async: criar janela em comando síncrono trava no Windows
#[tauri::command]
async fn bubble_enter(app: AppHandle) {
    if app.get_webview_window("bubble").is_none() {
        if let Err(e) = create_bubble(&app) {
            eprintln!("Erro ao criar a bolinha: {}", e);
            return;
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
        set_in_tray(&main, true);
        let _ = main.eval("window.__wlBubbleMode = true");
    }
}

// a bolinha acabou de carregar: pede o total de não lidas de novo
#[tauri::command]
fn bubble_ready(app: AppHandle) {
    eval_in(&app, "main", "window.__wlResend && window.__wlResend()".into());
}

#[tauri::command]
fn bubble_open(app: AppHandle, chat: Option<String>) {
    show_main_window(&app);
    if let Some(chat) = chat {
        let name = serde_json::to_string(&chat).unwrap_or_default();
        eval_in(&app, "main", format!("window.__wlOpenChat && window.__wlOpenChat({name})"));
    }
}

#[tauri::command]
fn bubble_message(app: AppHandle, chat: String, text: String, avatar: Option<String>) {
    let payload = serde_json::json!({ "chat": chat, "text": text, "avatar": avatar });
    eval_in(&app, "bubble", format!("window.wlMessage && window.wlMessage({payload})"));
}

#[tauri::command]
fn bubble_reply(app: AppHandle, chat: String, text: String) {
    let args = serde_json::json!([chat, text]);
    eval_in(&app, "main", format!("window.__wlReply && window.__wlReply(...{args})"));
}

#[tauri::command]
fn bubble_unread(app: AppHandle, count: u32) {
    eval_in(&app, "bubble", format!("window.wlUnread && window.wlUnread({count})"));
}

/// Opções da bolinha só com as chaves conhecidas; o que faltar ou vier errado vira o padrão.
fn bubble_clean(v: &Value) -> Value {
    let flag = |k: &str| v[k].as_bool().unwrap_or(true);
    // cor vai para o CSS da bolinha: só "#rrggbb" ou "hsl(h s% l%)"
    let color = v["color"]
        .as_str()
        .filter(|c| c.len() <= 32 && c.chars().all(|ch| ch.is_ascii_alphanumeric() || " #(),.%".contains(ch)))
        .unwrap_or("#ffffff");
    json!({
        "color": color,
        "count": flag("count"),
        "preview": flag("preview"),
        "sound": flag("sound"),
        "seconds": v["seconds"].as_u64().unwrap_or(5).clamp(1, 60),
    })
}

/// `saved: false` = o app ainda não tem opções (a bolinha migra as do localStorage dela).
#[tauri::command]
fn bubble_opts_get(app: AppHandle) -> Value {
    let saved = app.state::<Settings>().bubble.lock().unwrap().clone();
    json!({ "saved": saved.is_some(), "opts": bubble_clean(saved.as_ref().unwrap_or(&Value::Null)) })
}

/// Grava as opções (da tela de configurações ou do painel da bolinha) e avisa a bolinha aberta.
#[tauri::command]
fn bubble_opts_set(app: AppHandle, opts: Value) {
    let clean = bubble_clean(&opts);
    *app.state::<Settings>().bubble.lock().unwrap() = Some(clean.clone());
    save_settings(&app);
    eval_in(&app, "bubble", format!("window.wlOpts && window.wlOpts({clean})"));
}

// "Iniciar com o Windows": valor no Run do usuário apontando para este exe com --hidden
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "WhatsApp Lite";
const HIDDEN_ARG: &str = "--hidden";

fn autostart() -> bool {
    mcp::quiet("reg")
        .args(["query", RUN_KEY, "/v", RUN_VALUE])
        .output()
        .is_ok_and(|out| out.status.success())
}

fn set_autostart(on: bool) -> std::io::Result<()> {
    let mut cmd = mcp::quiet("reg");
    if on {
        let exe = env::current_exe()?;
        cmd.args(["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/f", "/d"])
            .arg(format!("\"{}\" {HIDDEN_ARG}", exe.display()));
    } else {
        cmd.args(["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]);
    }
    let out = cmd.output()?;
    if out.status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(String::from_utf8_lossy(&out.stderr).into_owned()))
    }
}

/// O que a tela "WhatsApp Lite" mostra. Sem o token.
fn lite_state(app: &AppHandle) -> Value {
    let s = app.state::<Settings>();
    json!({
        "mcp_enabled": s.mcp_enabled.load(Ordering::Relaxed),
        "mcp_listening": mcp::listening(app),
        "mcp_notify": s.mcp_notify.load(Ordering::Relaxed),
        "run_in_background": s.run_in_background.load(Ordering::Relaxed),
        "ask_download_path": s.ask_download_path.load(Ordering::Relaxed),
        "autostart": autostart(),
        "popup_style": *s.popup_style.lock().unwrap(),
        "bubble": bubble_opts_get(app.clone())["opts"],
    })
}

#[tauri::command]
fn lite_get(app: AppHandle) -> Value {
    lite_state(&app)
}

/// Liga/desliga uma opção pela tela; a bandeja acompanha.
#[tauri::command]
fn lite_set(app: AppHandle, key: String, on: bool) -> Value {
    let s = app.state::<Settings>();
    let tray = app.state::<TrayItems>();
    let (flag, item) = match key.as_str() {
        "mcp_enabled" => (&s.mcp_enabled, Some(&tray.mcp)),
        "run_in_background" => (&s.run_in_background, Some(&tray.background)),
        "ask_download_path" => (&s.ask_download_path, Some(&tray.ask_download)),
        "mcp_notify" => (&s.mcp_notify, None),
        "autostart" => {
            if let Err(e) = set_autostart(on) {
                eprintln!("Erro ao mudar o início com o Windows: {}", e);
            }
            return lite_state(&app);
        }
        _ => return lite_state(&app),
    };
    flag.store(on, Ordering::Relaxed);
    save_settings(&app);
    if let Some(item) = item {
        let _ = item.set_checked(on);
    }
    if on && key == "mcp_enabled" {
        mcp_listen(&app, &tray.mcp);
    }
    lite_state(&app)
}

/// Visual do aviso de mensagem dentro da conversa.
#[tauri::command]
fn lite_popup_style(app: AppHandle, style: String) {
    *app.state::<Settings>().popup_style.lock().unwrap() = popup_style_clean(&style).into();
    save_settings(&app);
}

/// Copia o comando de conexão do app de IA; a chave fica só aqui no Rust.
#[tauri::command]
fn lite_copy_command(app: AppHandle, client: String) -> bool {
    let token = app.state::<Settings>().mcp_token.lock().unwrap().clone();
    let Some(text) = mcp::connect_command(&client, &token) else { return false };
    mcp::copy_to_clipboard(&text).map_err(|e| eprintln!("Erro ao copiar o comando: {}", e)).is_ok()
}

/// Nova chave: todo app conectado passa a receber 401.
#[tauri::command]
fn lite_new_token(app: AppHandle) -> bool {
    let token = mcp::new_token();
    if token.is_empty() {
        return false;
    }
    *app.state::<Settings>().mcp_token.lock().unwrap() = token;
    save_settings(&app);
    true
}

// Na bandeja o WebView2 para de desenhar e libera memória; o JavaScript
// continua rodando, então mensagens e notificações seguem chegando.
fn set_in_tray(window: &tauri::WebviewWindow, in_tray: bool) {
    #[cfg(windows)]
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows::core::Interface;

        let controller = webview.controller();
        let _ = controller.SetIsVisible(!in_tray);
        let level = if in_tray {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        if let Ok(core) = controller
            .CoreWebView2()
            .and_then(|core| core.cast::<ICoreWebView2_19>())
        {
            let _ = core.SetMemoryUsageTargetLevel(level);
        }
    });
}

const MCP_LABEL: &str = "Conectar a IAs (MCP)";

// Porta ocupada não derruba o app: o item da bandeja avisa e tenta de novo ao religar.
fn mcp_listen(app: &AppHandle, item: &CheckMenuItem<tauri::Wry>) {
    let label = match mcp::listen(app) {
        Ok(()) => MCP_LABEL.to_string(),
        Err(e) => {
            eprintln!("MCP: não abriu a porta {}: {}", mcp::PORT, e);
            format!("{MCP_LABEL}: porta {} ocupada", mcp::PORT)
        }
    };
    let _ = item.set_text(label);
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let settings = app.state::<Settings>();

    let open = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
    let background = CheckMenuItem::with_id(
        app,
        "background",
        "Rodar em segundo plano",
        true,
        settings.run_in_background.load(Ordering::Relaxed),
        None::<&str>,
    )?;
    let ask_download = CheckMenuItem::with_id(
        app,
        "ask_download",
        "Perguntar onde salvar downloads",
        true,
        settings.ask_download_path.load(Ordering::Relaxed),
        None::<&str>,
    )?;
    let mcp_on = CheckMenuItem::with_id(
        app,
        "mcp",
        MCP_LABEL,
        true,
        settings.mcp_enabled.load(Ordering::Relaxed),
        None::<&str>,
    )?;
    let mcp_copy = MenuItem::with_id(app, "mcp_copy", "Copiar comando de conexão", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &background, &ask_download, &mcp_on, &mcp_copy, &quit],
    )?;
    if settings.mcp_enabled.load(Ordering::Relaxed) {
        mcp_listen(app.handle(), &mcp_on);
    }
    app.manage(TrayItems {
        background: background.clone(),
        ask_download: ask_download.clone(),
        mcp: mcp_on.clone(),
    });

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("WhatsApp Lite")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            // o clique já alternou o check
            let toggled = match event.id().as_ref() {
                "open" => return show_main_window(app),
                "quit" => return app.exit(0),
                "mcp_copy" => {
                    lite_copy_command(app.clone(), "claude".into());
                    return;
                }
                "mcp" => (&mcp_on, &app.state::<Settings>().mcp_enabled),
                "background" => (&background, &app.state::<Settings>().run_in_background),
                "ask_download" => (&ask_download, &app.state::<Settings>().ask_download_path),
                _ => return,
            };
            let (item, flag) = toggled;
            let on = item.is_checked().unwrap_or(true);
            flag.store(on, Ordering::Relaxed);
            save_settings(app);
            if on && event.id() == "mcp" {
                mcp_listen(app, item);
            }
            // a tela "WhatsApp Lite", se aberta, mostra o mesmo valor
            eval_in(app, "main", "window.__wlLite && window.__wlLite.refresh()".into());
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    Ok(())
}

/// Janela "Salvar como" partindo do nome e da pasta que o WebView2 sugeriu.
/// `None` quando o usuário cancela.
fn ask_save_path(webview: &Webview, suggested: &Path) -> Option<PathBuf> {
    let mut dialog = rfd::FileDialog::new().set_parent(&webview.window());
    if let Some(dir) = suggested.parent() {
        dialog = dialog.set_directory(dir);
    }
    if let Some(name) = suggested.file_name() {
        dialog = dialog.set_file_name(name.to_string_lossy());
    }
    if let Some(ext) = suggested.extension().and_then(|ext| ext.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    dialog.save_file()
}

fn on_download(webview: Webview, event: DownloadEvent<'_>) -> bool {
    if let DownloadEvent::Requested { destination, .. } = event {
        let settings = webview.app_handle().state::<Settings>();
        if settings.ask_download_path.load(Ordering::Relaxed) {
            match ask_save_path(&webview, destination) {
                Some(path) => *destination = path,
                None => return false,
            }
        }
    }
    true
}

fn setup_main_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .first()
        .ok_or("Falha ao obter configuração da janela principal")?;

    // iniciado pelo Windows: abre direto na bandeja
    let hidden = env::args().any(|a| a == HIDDEN_ARG);
    let window = WebviewWindowBuilder::from_config(app, config)?
        .visible(!hidden)
        .initialization_script(AD_REMOVAL_SCRIPT)
        .initialization_script(MOBILE_LAYOUT_SCRIPT)
        .initialization_script(COMPACT_CHAT_SCRIPT)
        .initialization_script(MESSAGE_POPUP_SCRIPT)
        .initialization_script(TITLEBAR_SCRIPT)
        .initialization_script(BUBBLE_FEED_SCRIPT)
        .initialization_script(MCP_TOOLS_SCRIPT)
        .initialization_script(LITE_SETTINGS_SCRIPT)
        .on_new_window(|url, _features| {
            open_in_browser(&url);
            NewWindowResponse::Deny
        })
        .on_download(on_download)
        // deixa o WhatsApp receber os arquivos arrastados para a janela
        .disable_drag_drop_handler()
        .build()?;

    #[cfg(windows)]
    allow_notifications(&window)?;
    if hidden {
        set_in_tray(&window, true);
    }

    Ok(())
}

fn main() {
    configure_webview_args();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .setup(|app| {
            app.manage(load_settings(app.handle()));
            app.manage(mcp::Bridge::default());
            // garante o token do MCP no arquivo (é gerado na primeira vez)
            save_settings(app.handle());

            setup_main_window(app).map_err(|e| {
                eprintln!("Erro na inicialização: {}", e);
                e
            })?;
            setup_tray(app)?;
            // desenvolvimento: WL_AUTOBUBBLE=<segundos> entra no modo bolinha sozinho (medir consumo sem depurador)
            if let Some(secs) = env::var("WL_AUTOBUBBLE").ok().and_then(|v| v.parse::<u64>().ok()) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(secs));
                    tauri::async_runtime::block_on(bubble_enter(handle));
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bubble_enter,
            bubble_open,
            bubble_message,
            bubble_ready,
            bubble_reply,
            bubble_unread,
            bubble_opts_get,
            bubble_opts_set,
            lite_get,
            lite_set,
            lite_popup_style,
            lite_copy_command,
            lite_new_token,
            mcp::mcp_result
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // só a janela principal vai para a bandeja; a bolinha fecha de verdade
                if window.label() != "main" {
                    return;
                }
                let settings = window.app_handle().state::<Settings>();
                if settings.run_in_background.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                        set_in_tray(&webview, true);
                    }
                } else {
                    // a bolinha é outra janela e manteria o app aberto
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar WhatsApp Lite Desktop");
}
