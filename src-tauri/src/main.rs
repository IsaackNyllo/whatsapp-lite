#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod atualizacao;
mod documento;
mod filtro;
mod fora;
mod mcp;
mod transcricao;

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    /// aviso de mensagem nova dentro da conversa ligado (a escolha do visual fica em `popup_style`)
    popup_on: AtomicBool,
    /// aviso "IA leu" também na janela principal (Segurança) e onde aparece (`a` topo, `b` canto de baixo)
    notice_win: AtomicBool,
    notice_pos: Mutex<String>,
    /// opções da bolinha (cor, contador, prévia, som, segundos); None = nunca salvas
    bubble: Mutex<Option<Value>>,
    /// visual do aviso de mensagem dentro da conversa: "a" (cartão), "b" (canto) ou "c" (pílula)
    popup_style: Mutex<String>,
    /// filtro de mensagens: verificação pela IA local (Ollama), aviso na bolinha ao reter e regras do usuário
    filtro_ia: AtomicBool,
    filtro_avisar: AtomicBool,
    filtro_minhas: Mutex<Value>,
    /// dicas (textos explicativos) que o usuário fechou no X da tela Conectores de IA
    dicas_fechadas: Mutex<Vec<String>>,
    /// "Transcrever áudios" (Fase 7): desligado por padrão; ligar pede a caixa Sim/Não
    audio_on: AtomicBool,
    /// teto de imagens que a IA abre por resumo (Fase 19): fotos e GIFs/figurinhas à parte, 0 a 200
    midia_fotos: AtomicU64,
    midia_anim: AtomicU64,
    /// Conectores de IA v2: áudio mais longo (min), "Transcrever ao chegar", "Baixar imagens que não foram baixadas",
    /// tipos que ver_documento abre, teto do texto (KB) e filtro ligado. Padrão = como era antes, menos Texto e
    /// PowerPoint, que nascem desmarcados (pedido do Isaack).
    audio_min: AtomicU64,
    audio_chegar: AtomicBool,
    midia_baixar: AtomicBool,
    doc_pdf: AtomicBool,
    doc_docx: AtomicBool,
    doc_xlsx: AtomicBool,
    doc_texto: AtomicBool,
    doc_pptx: AtomicBool,
    doc_kb: AtomicU64,
    filtro_on: AtomicBool,
}

/// Campos numéricos da tela (lite_midia): nome, mínimo, máximo e padrão. O Rust recusa o que sair da faixa.
const FAIXAS: [(&str, u64, u64, u64); 4] = [("fotos", 0, 200, 50), ("anim", 0, 200, 20), ("audio_min", 1, 60, 10), ("doc_kb", 5, 500, 50)];
/// Tipos de documento (opção `doc_<tipo>`), na ordem da tela.
const DOC_TIPOS: [&str; 5] = ["pdf", "docx", "xlsx", "texto", "pptx"];

fn faixa(qual: &str) -> Option<(u64, u64, u64)> {
    FAIXAS.iter().find(|f| f.0 == qual).map(|f| (f.1, f.2, f.3))
}

/// Valor salvo dentro da faixa; fora dela (arquivo editado à mão) ou sem valor: o padrão.
fn na_faixa(json: &Value, chave: &str, qual: &str) -> u64 {
    let (min, max, padrao) = faixa(qual).unwrap();
    json[chave].as_u64().filter(|n| (min..=max).contains(n)).unwrap_or(padrao)
}

/// Recusa o número fora da faixa do campo.
fn valida(qual: &str, n: u64) -> Result<(), String> {
    let (min, max, _) = faixa(qual).ok_or("Opção desconhecida.")?;
    if (min..=max).contains(&n) { Ok(()) } else { Err(format!("Valor inválido: use um número inteiro de {min} a {max}. Nada mudou.")) }
}

impl Settings {
    fn doc(&self, tipo: &str) -> Option<&AtomicBool> {
        Some(match tipo {
            "pdf" => &self.doc_pdf,
            "docx" => &self.doc_docx,
            "xlsx" => &self.doc_xlsx,
            "texto" => &self.doc_texto,
            "pptx" => &self.doc_pptx,
            _ => return None,
        })
    }
}

/// Tetos, tipos e opções que a página usa nas ferramentas e que as descrições do MCP mostram.
pub(crate) fn limites(s: &Settings) -> Value {
    let tipos: Vec<&str> = DOC_TIPOS.into_iter().filter(|t| s.doc(t).is_some_and(|f| f.load(Ordering::Relaxed))).collect();
    json!({
        "fotos": s.midia_fotos.load(Ordering::Relaxed),
        "anim": s.midia_anim.load(Ordering::Relaxed),
        "baixar": s.midia_baixar.load(Ordering::Relaxed),
        "tipos": tipos,
        "kb": s.doc_kb.load(Ordering::Relaxed),
        "audio_min": s.audio_min.load(Ordering::Relaxed),
    })
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
const FILTRO_SCRIPT: &str = include_str!("../filtro.js");
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

fn notice_pos_clean(v: &str) -> &'static str {
    if v == "b" { "b" } else { "a" }
}

fn read_settings(app: &AppHandle) -> Value {
    settings_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_default()
}

fn load_settings(json: &Value) -> Settings {
    let flag = |key: &str, default| AtomicBool::new(json[key].as_bool().unwrap_or(default));

    Settings {
        run_in_background: flag("run_in_background", true),
        ask_download_path: flag("ask_download_path", true),
        mcp_enabled: flag("mcp_enabled", false),
        mcp_notify: flag("mcp_notify", true),
        popup_on: flag("popup_on", true),
        notice_win: flag("notice_win", true),
        notice_pos: Mutex::new(notice_pos_clean(json["notice_pos"].as_str().unwrap_or("")).into()),
        bubble: Mutex::new(json["bubble"].is_object().then(|| bubble_clean(&json["bubble"]))),
        popup_style: Mutex::new(popup_style_clean(json["popup_style"].as_str().unwrap_or("")).into()),
        // desligada por padrão: usa a placa de vídeo
        filtro_ia: flag("filtro_ia", false),
        filtro_avisar: flag("filtro_avisar", true),
        filtro_minhas: Mutex::new(if json["filtro_minhas"].is_array() { json["filtro_minhas"].clone() } else { json!([]) }),
        dicas_fechadas: Mutex::new(dicas_clean(&json["dicas_fechadas"])),
        audio_on: flag("audio_on", false),
        midia_fotos: AtomicU64::new(na_faixa(json, "midia_fotos", "fotos")),
        midia_anim: AtomicU64::new(na_faixa(json, "midia_anim", "anim")),
        audio_min: AtomicU64::new(na_faixa(json, "audio_min", "audio_min")),
        audio_chegar: flag("audio_chegar", true),
        midia_baixar: flag("midia_baixar", true),
        doc_pdf: flag("doc_pdf", true),
        doc_docx: flag("doc_docx", true),
        doc_xlsx: flag("doc_xlsx", true),
        doc_texto: flag("doc_texto", false),
        doc_pptx: flag("doc_pptx", false),
        doc_kb: AtomicU64::new(na_faixa(json, "doc_kb", "doc_kb")),
        filtro_on: flag("filtro_on", true),
    }
}

/// Só ids curtos (letras, números, `_`/`-`), no máximo 50: é só "qual dica não mostrar".
fn dicas_clean(v: &Value) -> Vec<String> {
    let ok = |s: &&str| !s.is_empty() && s.len() <= 32 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    let mut l: Vec<String> = v.as_array().into_iter().flatten().filter_map(Value::as_str).filter(ok).map(String::from).collect();
    l.sort();
    l.dedup();
    l.truncate(50);
    l
}

fn save_settings(app: &AppHandle) {
    let Some(path) = settings_path(app) else { return };
    let settings = app.state::<Settings>();
    let json = json!({
        "run_in_background": settings.run_in_background.load(Ordering::Relaxed),
        "ask_download_path": settings.ask_download_path.load(Ordering::Relaxed),
        "mcp_enabled": settings.mcp_enabled.load(Ordering::Relaxed),
        "mcp_notify": settings.mcp_notify.load(Ordering::Relaxed),
        "popup_on": settings.popup_on.load(Ordering::Relaxed),
        "notice_win": settings.notice_win.load(Ordering::Relaxed),
        "notice_pos": *settings.notice_pos.lock().unwrap(),
        "bubble": *settings.bubble.lock().unwrap(),
        "popup_style": *settings.popup_style.lock().unwrap(),
        "filtro_ia": settings.filtro_ia.load(Ordering::Relaxed),
        "filtro_avisar": settings.filtro_avisar.load(Ordering::Relaxed),
        "filtro_minhas": *settings.filtro_minhas.lock().unwrap(),
        "dicas_fechadas": *settings.dicas_fechadas.lock().unwrap(),
        "audio_on": settings.audio_on.load(Ordering::Relaxed),
        "midia_fotos": settings.midia_fotos.load(Ordering::Relaxed),
        "midia_anim": settings.midia_anim.load(Ordering::Relaxed),
        "audio_min": settings.audio_min.load(Ordering::Relaxed),
        "audio_chegar": settings.audio_chegar.load(Ordering::Relaxed),
        "midia_baixar": settings.midia_baixar.load(Ordering::Relaxed),
        "doc_pdf": settings.doc_pdf.load(Ordering::Relaxed),
        "doc_docx": settings.doc_docx.load(Ordering::Relaxed),
        "doc_xlsx": settings.doc_xlsx.load(Ordering::Relaxed),
        "doc_texto": settings.doc_texto.load(Ordering::Relaxed),
        "doc_pptx": settings.doc_pptx.load(Ordering::Relaxed),
        "doc_kb": settings.doc_kb.load(Ordering::Relaxed),
        "filtro_on": settings.filtro_on.load(Ordering::Relaxed),
        "fora_on": app.state::<fora::Fora>().ligado.load(Ordering::Relaxed),
    });
    *mcp::LIMITES.lock().unwrap() = limites(&settings);
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
        .title("Zap⁺")
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

/// Aviso do app (uma IA leu, mensagem retida): cartão próprio, sem Responder e sem som.
/// `icon` é um data URI redondo pronto; sem ele, a bolinha desenha o "!" amarelo.
#[tauri::command]
/// Devolve false quando a bolinha não existe: aí quem chamou mostra o aviso na janela.
fn bubble_notice(app: AppHandle, title: String, text: String, icon: Option<String>) -> bool {
    let payload = serde_json::json!({ "title": title, "text": text, "icon": icon });
    let on = app.get_webview_window("bubble").is_some();
    eval_in(&app, "bubble", format!("window.wlNotice && window.wlNotice({payload})"));
    on
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

/// O que a tela "Zap⁺" mostra. As chaves vêm mascaradas.
pub(crate) fn lite_state(app: &AppHandle) -> Value {
    let s = app.state::<Settings>();
    json!({
        "mcp_enabled": s.mcp_enabled.load(Ordering::Relaxed),
        "mcp_listening": mcp::listening(app),
        "mcp_notify": s.mcp_notify.load(Ordering::Relaxed),
        "run_in_background": s.run_in_background.load(Ordering::Relaxed),
        "ask_download_path": s.ask_download_path.load(Ordering::Relaxed),
        "autostart": autostart(),
        "popup_style": *s.popup_style.lock().unwrap(),
        "popup_on": s.popup_on.load(Ordering::Relaxed),
        "notice_win": s.notice_win.load(Ordering::Relaxed),
        "notice_pos": *s.notice_pos.lock().unwrap(),
        "filtro_ia": s.filtro_ia.load(Ordering::Relaxed),
        "filtro_avisar": s.filtro_avisar.load(Ordering::Relaxed),
        "bubble": bubble_opts_get(app.clone())["opts"],
        "conexoes": app.state::<mcp::Conexoes>().visao(),
        "escrita": app.state::<mcp::Escrita>().visao(),
        "dicas_fechadas": *s.dicas_fechadas.lock().unwrap(),
        "audio_on": s.audio_on.load(Ordering::Relaxed),
        "audio": app.state::<transcricao::Transcricao>().visao(s.audio_on.load(Ordering::Relaxed)),
        "midia_fotos": s.midia_fotos.load(Ordering::Relaxed),
        "midia_anim": s.midia_anim.load(Ordering::Relaxed),
        "audio_min": s.audio_min.load(Ordering::Relaxed),
        "audio_chegar": s.audio_chegar.load(Ordering::Relaxed),
        "midia_baixar": s.midia_baixar.load(Ordering::Relaxed),
        "doc_pdf": s.doc_pdf.load(Ordering::Relaxed),
        "doc_docx": s.doc_docx.load(Ordering::Relaxed),
        "doc_xlsx": s.doc_xlsx.load(Ordering::Relaxed),
        "doc_texto": s.doc_texto.load(Ordering::Relaxed),
        "doc_pptx": s.doc_pptx.load(Ordering::Relaxed),
        "doc_kb": s.doc_kb.load(Ordering::Relaxed),
        "filtro_on": s.filtro_on.load(Ordering::Relaxed),
        "fora": app.state::<fora::Fora>().estado(),
        "recusas": app.state::<fora::Fora>().recusas(20),
    })
}

/// Campos numéricos da tela: teto de imagens por resumo (`fotos`, `anim`: 0 a 200), áudio mais longo (`audio_min`:
/// 1 a 60 min) e tamanho máximo do texto dos documentos (`doc_kb`: 5 a 500 KB). Custo, não poder: sem caixa (assumido).
#[tauri::command]
fn lite_midia(app: AppHandle, qual: String, n: u64) -> Result<Value, String> {
    valida(&qual, n)?;
    let s = app.state::<Settings>();
    let alvo = match qual.as_str() {
        "fotos" => &s.midia_fotos,
        "anim" => &s.midia_anim,
        "audio_min" => &s.audio_min,
        _ => &s.doc_kb,
    };
    alvo.store(n, Ordering::Relaxed);
    save_settings(&app);
    Ok(lite_state(&app))
}

/// Dicas fechadas no X (ou todas de volta com lista vazia). Só esconde texto: não enfraquece nada, sem caixa.
#[tauri::command]
fn lite_dicas(app: AppHandle, fechadas: Value) -> Value {
    *app.state::<Settings>().dicas_fechadas.lock().unwrap() = dicas_clean(&fechadas);
    save_settings(&app);
    lite_state(&app)
}

#[tauri::command]
fn lite_get(app: AppHandle) -> Value {
    lite_state(&app)
}

/// Texto da caixa Sim/Não de cada ação sensível; None = segue sem perguntar.
/// `alvo` é a ação ou a opção; `on` é o valor novo (só no lite_set). O texto é fixo: nunca vem da página.
fn aviso(comando: &str, alvo: &str, on: bool) -> Option<&'static str> {
    Some(match (comando, alvo, on) {
        ("filtro_acao", "liberar", _) => "Liberar a mensagem retida para a IA?\n\nA IA conectada passa a ler essa mensagem nas próximas leituras. Nada é executado.",
        ("filtro_acao", "liberar_sempre", _) => "Liberar e não reter mais desta conversa?\n\nA IA passa a ler esta mensagem. Daqui para frente, nesta conversa, mensagens da MESMA categoria (abaixo) não são mais retidas. As outras categorias continuam valendo. Você tira a exceção em Minhas regras.",
        ("filtro_lote", "liberar", _) => "Liberar todas as mensagens retidas desta conversa?\n\nA IA conectada passa a ler essas mensagens nas próximas leituras. Nada é executado.",
        ("filtro_lote", "apagar", _) => "Apagar todas as mensagens retidas desta conversa?\n\nSomem da lista e o texto não fica guardado. Continuam escondidas da IA.",
        ("filtro_minhas", "remover", _) => "Remover regra do filtro?\n\nO que essa regra segurava passa a chegar à IA.",
        ("lite_set", "filtro_ia", false) => "Desligar a verificação por IA local?\n\nSó as regras continuam valendo: o filtro fica mais fraco.",
        ("lite_set", "mcp_notify", false) => "Desligar o aviso quando uma IA ler?\n\nVocê deixa de ver quando um app lê suas conversas.",
        ("lite_set", "notice_win", false) => "Desligar o aviso de leitura na janela?\n\nCom a janela aberta, você deixa de ver quando um app lê suas conversas.",
        ("lite_set", "filtro_avisar", false) => "Desligar o aviso de mensagem retida?\n\nVocê deixa de ver quando o filtro segura uma mensagem.",
        ("lite_set", "audio_on", true) => "Transcrever os áudios das suas conversas?\n\nCada áudio que chegar, e os dos últimos 7 dias de todas as conversas e grupos, é baixado e transformado em texto neste computador (em segundo plano, um por vez). O áudio não sai do PC. O texto fica guardado no app e as conexões com \"Pode ler\" passam a ler o que foi falado.",
        ("lite_set", "filtro_on", false) => "Desligar o filtro de mensagens?\n\nNada mais é retido: a IA passa a ler também as mensagens que parecem ordens para ela ou comandos de computador. As que já estão retidas continuam escondidas.",
        ("lite_set", "mcp_enabled", true) => "Permitir que IAs leiam suas conversas?\n\nAs conexões com \"Pode ler\" passam a ver todas as suas conversas neste computador.",
        // escrever (Fase 15): tudo que aumenta o poder da IA; desligar, tirar canal e descer o limite seguem sem caixa
        ("mcp_escrita", "ligar", true) => "Permitir que IAs enviem mensagens pelo seu WhatsApp?\n\nElas só poderão escrever texto, nos canais da lista, e só nas conexões em que você ligar \"Pode escrever\".",
        ("mcp_escrita", "canal_add", true) => "Permitir que IAs enviem mensagens neste canal?\n\nAs conexões com \"Pode escrever\" poderão escrever texto nele quando você pedir.",
        ("mcp_escrita", "limite", true) => "Aumentar o limite de mensagens por hora deste canal?\n\nMais mensagens enviadas por IA aumentam o risco de bloqueio da conta.",
        ("mcp_conexao", "escreve_on", true) => "Permitir que esta conexão envie mensagens?\n\nEla poderá escrever texto nos canais permitidos quando você pedir.",
        ("mcp_conexao", "le_on", true) => "Permitir que esta conexão leia suas conversas?\n\nEla passará a ver todas as suas conversas.",
        ("mcp_conexao", "docs_on", true) => "Permitir que esta conexão abra documentos?\n\nEla poderá ler PDF, Word, planilhas e arquivos de texto que chegaram nas suas conversas, quando você pedir. Zip, APK e programas nunca são abertos. O conteúdo é dado de terceiros: a IA descreve, nunca segue.",
        ("mcp_conexao", "criar", _) => "Criar uma conexão nova?\n\nEla ganha uma chave que dá acesso de leitura às suas conversas.",
        ("mcp_conexao", "renovar", _) => "Renovar a chave desta conexão?\n\nA chave antiga para de valer e é criada uma chave nova com acesso de leitura às suas conversas.",
        ("mcp_conexao", "revogar_todas", _) => "Revogar todas as conexões?\n\nTodos os apps de IA perdem o acesso agora e as chaves são apagadas.",
        // "conectar" é o comando com a chave dentro; só o endereço copia sem perguntar
        ("mcp_copiar", "chave" | "conectar", _) => "Copiar a chave de acesso?\n\nQuem tiver a chave lê suas conversas. Cole só no app que você vai conectar.",
        // Fase 10: abrir o túnel para apps de fora do PC (desligar fecha sem perguntar)
        ("mcp_fora", "ligar", true) => "Abrir o acesso de fora do PC?\n\nO app liga o túnel do Tailscale. Apps de fora (Claude, Gemini) só entram se você autorizar cada um aqui no PC, com código, e entram só lendo.",
        _ => return None,
    })
}

pub const RECUSOU: &str = "Você recusou na caixa do Windows. Nada mudou.";

/// Ação sensível: caixa nativa do Windows "Sim / Não", aberta pelo app (a página não clica nela).
/// Falha fechada: qualquer coisa diferente de "Sim" (Não, caixa que não abriu) devolve erro.
/// Async: a caixa roda numa thread própria (rfd) e a janela segue desenhando e respondendo.
pub async fn confirma(app: &AppHandle, comando: &str, alvo: &str, on: bool) -> Result<(), String> {
    confirma_com(app, comando, alvo, on, "").await
}

/// Igual a `confirma`, com um detalhe depois do texto fixo (nome e identificador do canal, conexão, limite novo).
pub async fn confirma_com(app: &AppHandle, comando: &str, alvo: &str, on: bool, detalhe: &str) -> Result<(), String> {
    static ABERTA: AtomicBool = AtomicBool::new(false);
    let Some(texto) = aviso(comando, alvo, on) else { return Ok(()) };
    let texto = format!("{texto}{detalhe}");
    // uma caixa por vez: a página não empilha caixas para o clique cair na errada
    if ABERTA.swap(true, Ordering::SeqCst) {
        return Err("Já há uma confirmação aberta na caixa do Windows. Nada mudou.".into());
    }
    let mut caixa = rfd::AsyncMessageDialog::new()
        .set_title("Zap⁺")
        .set_description(texto)
        .set_level(rfd::MessageLevel::Warning)
        .set_buttons(rfd::MessageButtons::YesNo);
    if let Some(main) = app.get_webview_window("main") {
        caixa = caixa.set_parent(&main);
    }
    let sim = caixa.show().await == rfd::MessageDialogResult::Yes;
    ABERTA.store(false, Ordering::SeqCst);
    if sim { Ok(()) } else { Err(RECUSOU.into()) }
}

/// Liga/desliga uma opção pela tela; a bandeja acompanha.
#[tauri::command]
async fn lite_set(app: AppHandle, key: String, on: bool) -> Result<Value, String> {
    // só pergunta quando o valor muda de verdade
    if lite_state(&app)[key.as_str()] != on {
        confirma(&app, "lite_set", &key, on).await?;
    }
    let s = app.state::<Settings>();
    let tray = app.state::<TrayItems>();
    let (flag, item) = match key.as_str() {
        "mcp_enabled" => (&s.mcp_enabled, Some(&tray.mcp)),
        "run_in_background" => (&s.run_in_background, Some(&tray.background)),
        "ask_download_path" => (&s.ask_download_path, Some(&tray.ask_download)),
        "mcp_notify" => (&s.mcp_notify, None),
        "popup_on" => (&s.popup_on, None),
        "notice_win" => (&s.notice_win, None),
        "filtro_ia" => (&s.filtro_ia, None),
        "filtro_avisar" => (&s.filtro_avisar, None),
        "audio_on" => (&s.audio_on, None),
        "audio_chegar" => (&s.audio_chegar, None),
        "midia_baixar" => (&s.midia_baixar, None),
        "filtro_on" => (&s.filtro_on, None),
        k if k.strip_prefix("doc_").and_then(|t| s.doc(t)).is_some() => (s.doc(&k[4..]).unwrap(), None),
        "autostart" => {
            if let Err(e) = set_autostart(on) {
                eprintln!("Erro ao mudar o início com o Windows: {}", e);
            }
            return Ok(lite_state(&app));
        }
        _ => return Ok(lite_state(&app)),
    };
    flag.store(on, Ordering::Relaxed);
    save_settings(&app);
    if let Some(item) = item {
        let _ = item.set_checked(on);
    }
    if on && key == "mcp_enabled" {
        mcp_listen(&app, &tray.mcp);
    }
    Ok(lite_state(&app))
}

/// Visual do aviso de mensagem dentro da conversa.
#[tauri::command]
fn lite_popup_style(app: AppHandle, style: String) {
    *app.state::<Settings>().popup_style.lock().unwrap() = popup_style_clean(&style).into();
    save_settings(&app);
}

/// Onde o aviso "IA leu" aparece dentro da janela.
#[tauri::command]
fn lite_notice_pos(app: AppHandle, pos: String) {
    *app.state::<Settings>().notice_pos.lock().unwrap() = notice_pos_clean(&pos).into();
    save_settings(&app);
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

/// Abre a porta do MCP (ao ligar escrever com a leitura desligada, por exemplo).
pub fn mcp_listen_app(app: &AppHandle) {
    mcp_listen(app, &app.state::<TrayItems>().mcp);
}

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
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &background, &ask_download, &mcp_on, &quit])?;
    if settings.mcp_enabled.load(Ordering::Relaxed) || app.state::<mcp::Escrita>().ligado() {
        mcp_listen(app.handle(), &mcp_on);
    }
    app.manage(TrayItems {
        background: background.clone(),
        ask_download: ask_download.clone(),
        mcp: mcp_on.clone(),
    });

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Zap⁺")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            // o clique já alternou o check
            let toggled = match event.id().as_ref() {
                "open" => return show_main_window(app),
                "quit" => return app.exit(0),
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
            // a tela "Zap⁺", se aberta, mostra o mesmo valor
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
        .initialization_script(FILTRO_SCRIPT)
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
            let json = read_settings(app.handle());
            app.manage(load_settings(&json));
            *mcp::LIMITES.lock().unwrap() = limites(&app.state::<Settings>());
            app.manage(mcp::Bridge::default());
            // acesso de fora do PC (Fase 10): interruptor salvo, desligado por padrão
            let local = app.path().app_local_data_dir().ok();
            let mut fora = fora::Fora::default();
            fora.log = local.as_ref().map(|d| d.join("fora-oauth.log"));
            fora.ligado.store(json["fora_on"].as_bool().unwrap_or(false), Ordering::Relaxed);
            app.manage(fora);
            // conexões do MCP (uma chave por app): a chave única antiga vira a conexão "Claude Code"
            let (conexoes, migrou) = mcp::Conexoes::load(local.clone(), json["mcp_token"].as_str());
            app.manage(conexoes);
            // escrever (canais, limite, envios): arquivo próprio, fora do settings.json
            app.manage(mcp::Escrita::load(local.clone()));
            if migrou {
                save_settings(app.handle()); // tira o mcp_token do settings.json
            }
            // retidas e resultado da IA local: só neste PC (Local, não Roaming)
            app.manage(filtro::Filtro::load(local.clone()));
            // transcrição de áudio: motor em whisper\ e o texto em transcricoes.json (dados locais)
            app.manage(transcricao::Transcricao::load(local));
            filtro::esteira(app.handle().clone());
            fora::iniciar(app.handle());

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
            bubble_notice,
            bubble_ready,
            bubble_reply,
            bubble_unread,
            bubble_opts_get,
            bubble_opts_set,
            lite_get,
            lite_set,
            lite_popup_style,
            lite_notice_pos,
            lite_dicas,
            lite_midia,
            documento::doc_pdf,
            mcp::mcp_result,
            mcp::mcp_conexao,
            mcp::mcp_copiar,
            mcp::mcp_escrita,
            fora::mcp_fora,
            filtro::filtro_verificar,
            filtro::filtro_fila,
            filtro::filtro_get,
            filtro::filtro_acao,
            filtro::filtro_lote,
            filtro::filtro_excecao,
            filtro::filtro_minhas,
            filtro::filtro_ollama,
            transcricao::audio_ler,
            transcricao::audio_transcrever,
            transcricao::audio_motor,
            atualizacao::atualizacao_verificar,
            atualizacao::atualizacao_abrir
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
        .build(tauri::generate_context!())
        .expect("Erro ao iniciar Zap⁺")
        .run(|app, event| {
            // o túnel de fora fecha junto com o app
            if let tauri::RunEvent::Exit = event {
                fora::ao_sair(app);
            }
        });
}

#[cfg(test)]
mod tests {
    // comando novo em generate_handler! sem entrar na lista do build.rs é recusado pelo ACL
    #[test]
    fn comandos_declarados_no_build() {
        let main = include_str!("main.rs");
        let bloco = main.split("generate_handler![").nth(1).unwrap().split(']').next().unwrap();
        let mut handler: Vec<&str> = bloco
            .split(',')
            .map(|c| c.trim().rsplit("::").next().unwrap())
            .filter(|c| !c.is_empty())
            .collect();
        let build = include_str!("../build.rs");
        let lista = build.split("COMMANDS: &[&str] = &[").nth(1).unwrap().split("];").next().unwrap();
        let mut declarados: Vec<&str> = lista.split(',').map(|c| c.trim().trim_matches('"')).filter(|c| !c.is_empty()).collect();
        handler.sort();
        declarados.sort();
        assert_eq!(handler, declarados);
        assert!(handler.len() >= 22);
    }

    // Conectores v2: faixas no Rust (a tela não é confiável), padrão = como era, tipos de documento
    #[test]
    fn faixas_padroes_e_tipos() {
        use super::*;
        use serde_json::json;
        // padrão: nada muda para quem não mexeu (Texto e PowerPoint nascem desmarcados, como pedido)
        let s = load_settings(&json!({}));
        assert_eq!(limites(&s), json!({"fotos": 50, "anim": 20, "baixar": true, "tipos": ["pdf", "docx", "xlsx"], "kb": 50, "audio_min": 10}));
        assert!(s.audio_chegar.load(Ordering::Relaxed) && s.filtro_on.load(Ordering::Relaxed));
        // arquivo editado à mão: fora da faixa volta ao padrão; dentro, vale
        let s = load_settings(&json!({"audio_min": 0, "doc_kb": 501, "midia_fotos": 201, "midia_anim": -1}));
        assert_eq!(limites(&s), json!({"fotos": 50, "anim": 20, "baixar": true, "tipos": ["pdf", "docx", "xlsx"], "kb": 50, "audio_min": 10}));
        let s = load_settings(&json!({"audio_min": 60, "doc_kb": 5, "midia_fotos": 0, "midia_baixar": false,
            "doc_pdf": false, "doc_texto": true, "doc_pptx": true}));
        assert_eq!(limites(&s), json!({"fotos": 0, "anim": 20, "baixar": false, "tipos": ["docx", "xlsx", "texto", "pptx"], "kb": 5, "audio_min": 60}));
        // a tela manda qualquer número: só a faixa passa
        for (q, ok, ruins) in [("fotos", [0, 200], [201, 999]), ("anim", [0, 200], [201, 1000]), ("audio_min", [1, 60], [0, 61]), ("doc_kb", [5, 500], [4, 501])] {
            for n in ok { assert!(valida(q, n).is_ok(), "{q} {n}"); }
            for n in ruins { assert!(valida(q, n).unwrap_err().contains("Nada mudou"), "{q} {n}"); }
        }
        assert!(valida("outro", 1).is_err());
        // só os 5 tipos têm opção (doc_exe não existe)
        assert!(DOC_TIPOS.iter().all(|t| s.doc(t).is_some()) && s.doc("exe").is_none() && s.doc("zip").is_none());
    }

    // as 7 ações sensíveis pedem a caixa Sim/Não; o resto (ligar avisos, pausar, apagar, aparência...) não
    #[test]
    fn caixa_sim_nao_nas_acoes_sensiveis() {
        use super::aviso;
        let pede = [
            ("filtro_acao", "liberar", false),
            ("filtro_minhas", "remover", false),
            // Mensagens retidas v2: exceção por conversa e lote (liberar e apagar)
            ("filtro_acao", "liberar_sempre", false),
            ("filtro_lote", "liberar", false),
            ("filtro_lote", "apagar", false),
            ("lite_set", "filtro_ia", false),
            ("lite_set", "mcp_notify", false),
            ("lite_set", "notice_win", false),
            ("lite_set", "filtro_avisar", false),
            ("lite_set", "mcp_enabled", true),
            ("mcp_conexao", "criar", false),
            ("mcp_conexao", "renovar", false),
            ("mcp_conexao", "revogar_todas", false),
            ("mcp_copiar", "chave", false),
            ("mcp_copiar", "conectar", false),
            // Fase 15: o que aumenta o poder (on = aumenta de verdade)
            ("mcp_escrita", "ligar", true),
            ("mcp_escrita", "canal_add", true),
            ("mcp_escrita", "limite", true),
            ("mcp_conexao", "escreve_on", true),
            ("mcp_conexao", "le_on", true),
            // Fase 7: ligar a transcrição de áudio
            ("lite_set", "audio_on", true),
            // Fase 19: ligar "Pode abrir documentos"
            ("mcp_conexao", "docs_on", true),
            // Fase 10: abrir o acesso de fora do PC
            ("mcp_fora", "ligar", true),
            // Conectores v2: desligar o filtro de mensagens enfraquece a proteção
            ("lite_set", "filtro_on", false),
        ];
        for (c, a, on) in pede {
            assert!(aviso(c, a, on).is_some(), "{c} {a} {on} tem de pedir");
        }
        let livre = [
            ("filtro_acao", "apagar", false),
            ("filtro_minhas", "adicionar", false),
            // tirar uma exceção só aumenta a proteção
            ("filtro_excecao", "tirar", false),
            ("lite_set", "filtro_ia", true),
            ("lite_set", "mcp_notify", true),
            ("lite_set", "notice_win", true),
            ("lite_set", "filtro_avisar", true),
            ("lite_set", "mcp_enabled", false),
            ("lite_set", "autostart", true),
            ("lite_set", "popup_on", false),
            ("lite_set", "run_in_background", false),
            ("mcp_conexao", "pausar", false),
            ("mcp_conexao", "ativar", false),
            ("mcp_conexao", "revogar", false),
            ("mcp_conexao", "limpar", false),
            ("mcp_copiar", "endereco", false),
            // Fase 15: o que reduz o poder (ou não muda nada) segue sem caixa
            ("mcp_escrita", "desligar", false),
            ("mcp_escrita", "canal_tirar", false),
            ("mcp_escrita", "limite", false),
            ("mcp_escrita", "limpar", false),
            // Fase 17: o intervalo entre envios só muda a velocidade (assumido: sem caixa, como no mockup aprovado)
            ("mcp_escrita", "intervalo", false),
            ("mcp_escrita", "intervalo", true),
            ("mcp_escrita", "ligar", false),
            ("mcp_escrita", "canal_add", false),
            ("mcp_conexao", "escreve_off", false),
            ("mcp_conexao", "le_off", false),
            ("mcp_conexao", "escreve_on", false),
            ("mcp_conexao", "le_on", false),
            // Fase 7: desligar, baixar ou apagar o motor e apagar transcrições não aumentam o poder
            ("lite_set", "audio_on", false),
            ("audio_motor", "baixar", false),
            ("audio_motor", "apagar", false),
            ("audio_motor", "limpar", false),
            // Fase 19: desligar documentos não aumenta o poder; teto de imagens é custo, não poder (assumido)
            ("mcp_conexao", "docs_off", false),
            ("mcp_conexao", "docs_on", false),
            ("lite_midia", "fotos", false),
            ("lite_midia", "anim", true),
            ("doc_pdf", "", false),
            // Fase 10: desligar fecha; renovar uma de fora só tira o acesso; copiar o endereço não leva chave
            ("mcp_fora", "desligar", false),
            ("mcp_fora", "ligar", false),
            ("mcp_conexao", "renovar_fora", false),
            ("mcp_copiar", "fora", false),
            // Conectores v2: ligar de volta, tipos de documento, opções de custo (assumido: sem caixa)
            ("lite_set", "filtro_on", true),
            ("lite_set", "audio_chegar", true),
            ("lite_set", "midia_baixar", true),
            ("lite_set", "doc_texto", true),
            ("lite_set", "doc_pptx", true),
            ("lite_midia", "audio_min", true),
            ("lite_midia", "doc_kb", true),
        ];
        for (c, a, on) in livre {
            assert!(aviso(c, a, on).is_none(), "{c} {a} {on} não pede");
        }
        // cada comando sensível chama a caixa antes de mexer em algo
        let fontes = [include_str!("main.rs"), include_str!("mcp.rs"), include_str!("filtro.rs"), include_str!("fora.rs")].concat();
        for cmd in ["lite_set", "mcp_conexao", "mcp_copiar", "mcp_escrita", "filtro_acao", "filtro_lote", "filtro_minhas", "mcp_fora"] {
            let corpo = fontes.split(&format!("async fn {cmd}(")).nth(1).unwrap_or_else(|| panic!("{cmd} não é async"));
            let corpo = corpo.split("\n}").next().unwrap(); // fim da função (mcp.rs e filtro.rs têm CRLF)
            assert!(
                corpo.contains(&format!("confirma(&app, \"{cmd}\"")) || corpo.contains(&format!("confirma_com(&app, \"{cmd}\"")),
                "{cmd} sem a caixa Sim/Não"
            );
        }
        // gravar as dicas fechadas não passa por caixa e não é ação sensível
        assert!(aviso("lite_dicas", "", false).is_none() && aviso("lite_dicas", "", true).is_none());
        assert_eq!(super::dicas_clean(&serde_json::json!(["escrever", "escrever", "<b>", "", 3, "a-b_c"])), ["a-b_c", "escrever"]);
    }
}
