// Comandos do app (os mesmos de `generate_handler!` em src/main.rs; um teste confere).
// Declarar a lista liga o ACL do Tauri para os comandos do app: cada janela só chama
// o que a sua capability libera (`allow-<comando>` em capabilities/*.json).
const COMMANDS: &[&str] = &[
    "bubble_enter",
    "bubble_open",
    "bubble_message",
    "bubble_notice",
    "bubble_ready",
    "bubble_reply",
    "bubble_unread",
    "bubble_opts_get",
    "bubble_opts_set",
    "lite_get",
    "lite_set",
    "lite_popup_style",
    "lite_notice_pos",
    "lite_dicas",
    "lite_midia",
    "doc_pdf",
    "mcp_result",
    "mcp_conexao",
    "mcp_copiar",
    "mcp_escrita",
    "filtro_verificar",
    "filtro_fila",
    "filtro_get",
    "filtro_acao",
    "filtro_minhas",
    "filtro_ollama",
    "audio_ler",
    "audio_transcrever",
    "audio_motor",
    "atualizacao_verificar",
    "atualizacao_abrir",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("falha no build do Tauri");
}
