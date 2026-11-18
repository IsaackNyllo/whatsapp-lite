//! Aviso de versão nova: consulta a última release no GitHub (no máximo 1x por dia) e só avisa.
//! Não baixa nem instala nada; sem internet, sem release ou qualquer erro: silêncio.
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const API: &str = "https://api.github.com/repos/IsaackNyllo/zap-plus/releases/latest";
const PAGINA: &str = "https://github.com/IsaackNyllo/zap-plus/releases/latest";

/// "v1.4.0" -> (1, 4, 0). Sufixo (-beta) ou formato estranho: None (não avisa).
fn versao(s: &str) -> Option<(u64, u64, u64)> {
    let mut p = s.trim().trim_start_matches('v').split('.').map(|n| n.parse::<u64>().ok());
    let v = (p.next()??, p.next()??, p.next()??);
    p.next().is_none().then_some(v)
}

fn mais_nova(tag: &str, atual: &str) -> bool {
    matches!((versao(tag), versao(atual)), (Some(t), Some(a)) if t > a)
}

fn consultar() -> Option<String> {
    let saida = crate::transcricao::sistema("curl.exe")
        .args(["-fsSL", "--proto", "=https", "--connect-timeout", "10", "--max-time", "15",
               "-A", "whatsapp-lite", "-H", "Accept: application/vnd.github+json", API])
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let json: serde_json::Value = serde_json::from_slice(&saida.stdout).ok()?;
    let tag = json["tag_name"].as_str()?;
    versao(tag).map(|_| tag.to_string())
}

/// Tag da versão nova (ex.: "v1.4.0") ou None. A consulta ao GitHub é de 1x por dia
/// (guardada em atualizacao.txt: "<dia> <tag>"); no mesmo dia vale o que foi guardado.
#[tauri::command]
pub async fn atualizacao_verificar(app: AppHandle) -> Option<String> {
    let arq = app.path().app_config_dir().ok()?.join("atualizacao.txt");
    let hoje = (SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() / 86400).to_string();
    let guardado = fs::read_to_string(&arq).unwrap_or_default();
    let (dia, tag) = guardado.split_once(' ').unwrap_or((guardado.trim(), ""));
    let tag = if dia == hoje {
        tag.trim().to_string()
    } else {
        let tag = tauri::async_runtime::spawn_blocking(consultar).await.ok()?.unwrap_or_default();
        let _ = fs::write(&arq, format!("{hoje} {tag}"));
        tag
    };
    mais_nova(&tag, env!("CARGO_PKG_VERSION")).then_some(tag)
}

/// Abre a página da release no navegador. Endereço fixo: a página não escolhe o que abrir.
#[tauri::command]
pub fn atualizacao_abrir() {
    let _ = open::that_detached(PAGINA);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compara_versoes() {
        assert!(mais_nova("v1.4.0", "1.3.0"));
        assert!(mais_nova("v1.10.0", "1.9.9"));
        assert!(!mais_nova("v1.3.0", "1.3.0"));
        assert!(!mais_nova("v1.2.9", "1.3.0"));
        assert!(!mais_nova("", "1.3.0"));
        assert!(!mais_nova("v2.0.0-beta", "1.3.0"));
        assert!(!mais_nova("lixo", "1.3.0"));
        assert_eq!(versao("v1.4"), None);
    }
}
