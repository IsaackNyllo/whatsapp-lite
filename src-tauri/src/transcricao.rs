// Transcrição de áudio (Fase 7). Motor whisper.cpp (só CPU) baixado pelo botão "Baixar motor", com versão e
// SHA-256 fixos aqui; com hash errado nada é extraído nem executado. Um áudio por vez, com prioridade baixa.
// O áudio vem da página (WAV 16 kHz mono em base64) e vai para o whisper-cli num WAV temporário, apagado logo
// depois. Fica guardado só o texto, em `transcricoes.json`. A fila (baixar um por vez) mora na página,
// que é quem baixa e decifra a mídia; aqui só o motor, o cache e o formato.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

// Versão fixa: whisper.cpp b5454 (pacote só de CPU) e o modelo small q5_1 numa revisão fixa do Hugging Face.
// Os hashes foram conferidos baixando os arquivos (iguais aos publicados pelo GitHub e pelo Hugging Face).
const MOTOR_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip";
const MOTOR_SHA: &str = "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb";
const MODELO_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin";
const MODELO_SHA: &str = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb";
/// bytes baixados ao todo (zip + modelo), para a tela mostrar o andamento
const TOTAL: u64 = 8_928_640 + 190_085_487;
const MODELO: &str = "ggml-small-q5_1.bin";
const EXE: &str = "whisper-cli.exe";
/// só o que o whisper-cli usa; o resto do pacote não é extraído
const DO_ZIP: [&str; 5] = ["Release/whisper-cli.exe", "Release/whisper.dll", "Release/ggml.dll", "Release/ggml-base.dll", "Release/ggml-cpu-*.dll"];
/// teto por áudio: acima disso, "longo demais"
pub const DUR_MAX: u64 = 600;
/// teto de tempo do whisper por áudio (10 min de áudio levam ~3 min com 4 threads)
const PROCESSO_MAX: Duration = Duration::from_secs(900);

/// Uma transcrição guardada: estado ("ok", "sem_fala", "expirado", "longo"), texto (só no "ok"), duração e quando.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Entrada {
    estado: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    texto: String,
    dur: u64,
    t: u64,
}

#[derive(Deserialize)]
pub struct Pedido {
    id: String,
    #[serde(default)]
    dur: u64,
}

pub struct Transcricao {
    /// pasta de dados locais do app (o motor fica em `whisper\`, o cache em `transcricoes.json`)
    dir: Option<PathBuf>,
    cache: Mutex<HashMap<String, Entrada>>,
    baixando: AtomicBool,
}

/// Um whisper por vez (fila do lado do app; a página também manda um por vez).
static VEZ: Mutex<()> = Mutex::new(());

fn agora() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl Transcricao {
    pub fn load(dir: Option<PathBuf>) -> Transcricao {
        let cache = dir
            .as_ref()
            .and_then(|d| fs::read_to_string(d.join("transcricoes.json")).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        // WAV temporário que sobrou de uma queda no meio da transcrição
        if let Some(d) = &dir {
            let _ = fs::remove_file(d.join("whisper").join(WAV_TMP));
        }
        Transcricao { dir, cache: Mutex::new(cache), baixando: AtomicBool::new(false) }
    }

    fn pasta(&self) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| d.join("whisper"))
    }

    /// Executável e modelo, se o motor está instalado. A pasta só existe depois dos dois hashes conferidos.
    fn arquivos(&self) -> Option<(PathBuf, PathBuf)> {
        let p = self.pasta()?;
        let (exe, modelo) = (p.join(EXE), p.join(MODELO));
        (exe.is_file() && modelo.is_file()).then_some((exe, modelo))
    }

    /// Estado de um áudio para a leitura: guardado, longo demais (pela duração) ou "falta".
    fn estado(&self, id: &str, dur: u64) -> Value {
        match self.cache.lock().unwrap().get(id) {
            Some(e) => json!({"estado": e.estado, "texto": e.texto}),
            None if dur > DUR_MAX => json!({"estado": "longo"}),
            None => json!({"estado": "falta"}),
        }
    }

    fn guardar(&self, id: &str, estado: &str, texto: String, dur: u64) -> Value {
        let mut c = self.cache.lock().unwrap();
        c.insert(id.chars().take(200).collect(), Entrada { estado: estado.into(), texto: texto.clone(), dur, t: agora() });
        crate::mcp::gravar(&self.dir.as_ref().map(|d| d.join("transcricoes.json")), &*c);
        json!({"estado": estado, "texto": texto})
    }

    /// "Apagar transcrições": some o texto guardado (o arquivo inteiro).
    fn limpar(&self) -> Result<(), String> {
        self.cache.lock().unwrap().clear();
        match self.dir.as_ref().map(|d| fs::remove_file(d.join("transcricoes.json"))) {
            Some(Err(e)) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Não apagou as transcrições: {e}")),
            _ => Ok(()),
        }
    }

    /// O que a tela mostra. `baixando`: bytes já baixados (ou null).
    pub fn visao(&self, ligado: bool) -> Value {
        let c = self.cache.lock().unwrap();
        let baixando = self.baixando.load(Ordering::Relaxed).then(|| {
            let tmp = self.dir.as_ref().map(|d| d.join("whisper-baixando"));
            tmp.and_then(|t| fs::read_dir(t).ok()).map_or(0, |l| l.flatten().filter_map(|f| f.metadata().ok()).map(|m| m.len()).sum::<u64>())
        });
        json!({
            "ligado": ligado, "motor": self.arquivos().is_some(), "baixando": baixando, "total": TOTAL,
            "transcritos": c.values().filter(|e| e.estado == "ok").count(), "guardados": c.len(),
        })
    }

    /// Baixa o motor e o modelo numa pasta temporária, confere os dois hashes e só então extrai e troca.
    fn instalar(&self) -> Result<(), String> {
        let dir = self.dir.clone().ok_or("Sem pasta de dados do app.")?;
        if self.baixando.swap(true, Ordering::SeqCst) {
            return Err("O motor já está sendo baixado.".into());
        }
        let tmp = dir.join("whisper-baixando");
        let _ = fs::remove_dir_all(&tmp);
        let r = (|| {
            fs::create_dir_all(&tmp).map_err(|e| format!("Não criou a pasta: {e}"))?;
            let zip = tmp.join("motor.zip");
            baixar(MOTOR_URL, &zip, MOTOR_SHA)?;
            baixar(MODELO_URL, &tmp.join(MODELO), MODELO_SHA)?;
            // só depois dos dois hashes certos: extrai o que o motor usa
            let ok = sistema("tar.exe")
                .arg("-xf").arg(&zip).arg("-C").arg(&tmp).args(["--strip-components", "1"]).args(DO_ZIP)
                .status()
                .is_ok_and(|s| s.success());
            let _ = fs::remove_file(&zip);
            if !ok || !tmp.join(EXE).is_file() {
                return Err("Não deu para extrair o motor. Nada foi instalado.".to_string());
            }
            let pasta = dir.join("whisper");
            let _ = fs::remove_dir_all(&pasta);
            fs::rename(&tmp, &pasta).map_err(|e| format!("Não instalou o motor: {e}"))
        })();
        if r.is_err() {
            let _ = fs::remove_dir_all(&tmp);
        }
        self.baixando.store(false, Ordering::SeqCst);
        r
    }

    fn apagar_motor(&self) -> Result<(), String> {
        if self.baixando.load(Ordering::Relaxed) {
            return Err("O motor está sendo baixado; espere terminar.".into());
        }
        // ponytail: não espera a transcrição em curso; pede para tentar de novo
        let Ok(_vez) = VEZ.try_lock() else {
            return Err("O motor está transcrevendo um áudio agora; tente de novo em alguns segundos.".into());
        };
        match self.pasta().map(fs::remove_dir_all) {
            Some(Err(e)) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Não apagou o motor: {e}")),
            _ => Ok(()),
        }
    }
}

/// Programa do Windows pelo caminho completo (não pelo PATH), sem a janela preta.
pub(crate) fn sistema(nome: &str) -> Command {
    let raiz = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    crate::mcp::quiet(&format!(r"{raiz}\System32\{nome}"))
}

/// Baixa com o curl do Windows e confere o SHA-256. Hash errado: apaga o arquivo e devolve erro.
fn baixar(url: &str, destino: &Path, sha: &str) -> Result<(), String> {
    let ok = sistema("curl.exe")
        .args(["-fsSL", "--proto", "=https", "--retry", "2", "--connect-timeout", "20", "-o"])
        .arg(destino)
        .arg(url)
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        let _ = fs::remove_file(destino);
        return Err("Não deu para baixar o motor (sem internet?). Nada foi instalado.".into());
    }
    confere(destino, sha)
}

fn confere(arquivo: &Path, sha: &str) -> Result<(), String> {
    if sha256(arquivo).as_deref() == Some(sha) {
        return Ok(());
    }
    let _ = fs::remove_file(arquivo);
    Err("O arquivo baixado não confere com o esperado (SHA-256). Nada foi instalado nem executado.".into())
}

/// SHA-256 do arquivo em hex, pelo BCrypt do Windows (crate `windows`, já dependência), lendo em pedaços.
fn sha256(arquivo: &Path) -> Option<String> {
    let mut f = fs::File::open(arquivo).ok()?;
    let mut buf = vec![0u8; 1 << 20];
    let mut out = [0u8; 32];
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Security::Cryptography::*;
        let mut h = BCRYPT_HASH_HANDLE::default();
        if BCryptCreateHash(BCRYPT_SHA256_ALG_HANDLE, &mut h, None, None, 0).is_err() {
            return None;
        }
        let ok = loop {
            match f.read(&mut buf) {
                Ok(0) => break BCryptFinishHash(h, &mut out, 0).is_ok(),
                Ok(n) if BCryptHashData(h, &buf[..n], 0).is_ok() => {}
                _ => break false,
            }
        };
        let _ = BCryptDestroyHash(h);
        if !ok {
            return None;
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (&mut f, &mut buf, &mut out);
        return None;
    }
    Some(out.iter().map(|b| format!("{b:02x}")).collect())
}

/// Base64 padrão (o WAV vem assim da página). None se tiver caractere fora do alfabeto.
pub(crate) fn de_base64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in s.as_bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

/// WAV 16 kHz mono 16 bits: segundos pelo tamanho; None se não é WAV.
fn segundos_wav(b: &[u8]) -> Option<u64> {
    (b.len() >= 44 && &b[..4] == b"RIFF" && &b[8..12] == b"WAVE").then(|| (b.len() as u64 - 44) / 32000)
}

/// Saída do whisper-cli -> ("ok", texto) ou ("sem_fala", ""). Ruído volta só como marca entre colchetes ou
/// parênteses ("[MÚSICA]", "(silêncio)"): sem letra fora delas, é "sem fala".
fn texto_de(saida: &str) -> (&'static str, String) {
    let texto = saida.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut dentro = 0i32;
    let fala = texto.chars().any(|c| {
        match c {
            '[' | '(' => dentro += 1,
            ']' | ')' => dentro -= 1,
            _ => {}
        }
        dentro <= 0 && c.is_alphanumeric()
    });
    if fala { ("ok", texto) } else { ("sem_fala", String::new()) }
}

/// WAV temporário: apagado ao sair de `rodar`, dê certo ou não (e ao abrir o app, se sobrou de uma queda).
const WAV_TMP: &str = "transcrevendo.wav";
struct Apaga<'a>(&'a Path);
impl Drop for Apaga<'_> {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.0);
    }
}

/// Roda o whisper-cli (CPU, 4 threads, prioridade abaixo do normal, português) com o WAV num arquivo temporário.
/// ponytail: o `-f -` (entrada padrão) do b5454 lê o áudio mas não imprime o texto (medido); por isso o arquivo.
fn rodar(exe: &Path, modelo: &Path, wav: Vec<u8>) -> Result<String, String> {
    let tmp = exe.with_file_name(WAV_TMP);
    let _apaga = Apaga(&tmp);
    fs::write(&tmp, wav).map_err(|e| format!("Não gravou o áudio temporário: {e}"))?;
    let mut cmd = Command::new(exe);
    cmd.arg("-m").arg(modelo).args(["-l", "pt", "-t", "4", "-nt", "-np", "-ng", "-f"]).arg(&tmp);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_4000); // sem janela, BELOW_NORMAL_PRIORITY_CLASS
    }
    let mut p = cmd.spawn().map_err(|e| format!("O motor não abriu: {e}"))?;
    let Some(mut saida) = p.stdout.take() else {
        let _ = p.kill();
        return Err("O motor não abriu.".into());
    };
    let leitor = thread::spawn(move || {
        let mut s = Vec::new();
        let _ = saida.read_to_end(&mut s);
        s
    });
    let inicio = Instant::now();
    let status = loop {
        match p.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if inicio.elapsed() < PROCESSO_MAX => thread::sleep(Duration::from_millis(200)),
            _ => {
                let _ = p.kill();
                let _ = p.wait();
                return Err("O motor passou do tempo.".into());
            }
        }
    };
    let bytes = leitor.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("O motor falhou ({status})."));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn ligado(app: &AppHandle) -> bool {
    app.state::<crate::Settings>().audio_on.load(Ordering::Relaxed)
}

/// Estado dos áudios pedidos (por id) e da transcrição: ligada, motor, andamento do download, contadores.
#[tauri::command]
pub fn audio_ler(app: AppHandle, itens: Vec<Pedido>) -> Value {
    let t = app.state::<Transcricao>();
    let mut v = t.visao(ligado(&app));
    v["entradas"] = itens.iter().map(|p| (p.id.clone(), t.estado(&p.id, p.dur))).collect::<serde_json::Map<_, _>>().into();
    v
}

/// Transcreve um áudio (WAV em base64) e guarda o texto. `wav` vazio = a mídia expirou no WhatsApp (404).
/// Desligada ou sem motor: recusa e nada roda.
#[tauri::command]
pub async fn audio_transcrever(app: AppHandle, id: String, dur: u64, wav: String) -> Result<Value, String> {
    let r = tauri::async_runtime::spawn_blocking(move || {
        let t = app.state::<Transcricao>();
        if !ligado(&app) {
            return Err("Transcrição desligada.".to_string());
        }
        if wav.is_empty() {
            return Ok(t.guardar(&id, "expirado", String::new(), dur));
        }
        let bytes = de_base64(&wav).ok_or("WAV inválido.")?;
        drop(wav);
        let seg = segundos_wav(&bytes).ok_or("WAV inválido.")?;
        if dur.max(seg) > DUR_MAX {
            return Ok(t.guardar(&id, "longo", String::new(), dur.max(seg)));
        }
        let (exe, modelo) = t.arquivos().ok_or("Motor não instalado.")?;
        let saida = {
            let _vez = VEZ.lock().unwrap_or_else(|e| e.into_inner());
            rodar(&exe, &modelo, bytes)?
        };
        // desligou enquanto transcrevia: não guarda
        if !ligado(&app) {
            return Err("Transcrição desligada.".to_string());
        }
        let (estado, texto) = texto_de(&saida);
        Ok(t.guardar(&id, estado, texto, dur))
    })
    .await;
    r.map_err(|_| "falha interna".to_string())?
}

/// Tela: "baixar" (motor e modelo), "apagar" (motor) e "limpar" (apagar transcrições). Nenhuma aumenta o
/// poder da IA (ligar a transcrição é `lite_set`, com a caixa Sim/Não), então nenhuma pede confirmação.
#[tauri::command]
pub async fn audio_motor(app: AppHandle, acao: String) -> Result<Value, String> {
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t = a.state::<Transcricao>();
        match acao.as_str() {
            "baixar" => t.instalar(),
            "apagar" => t.apagar_motor(),
            "limpar" => t.limpar(),
            _ => Err("Ação desconhecida.".into()),
        }
    })
    .await
    .map_err(|_| "falha interna".to_string())??;
    Ok(crate::lite_state(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(nome: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("wl-teste-{nome}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn saida_do_whisper() {
        assert_eq!(texto_de(" Oi, tudo bem?\n E aí, vamos amanhã?\n"), ("ok", "Oi, tudo bem? E aí, vamos amanhã?".into()));
        for ruido in ["", "\n \n", " [MÚSICA]\n", "[silêncio] (risos)", " [Música] [Aplausos]\n"] {
            assert_eq!(texto_de(ruido), ("sem_fala", String::new()), "{ruido:?}");
        }
        // marca junto de fala: é fala, e o texto fica como veio
        assert_eq!(texto_de("Bom dia [risos]").0, "ok");
        assert_eq!(texto_de("[silêncio] 3 horas").1, "[silêncio] 3 horas");
    }

    #[test]
    fn base64_e_wav() {
        assert_eq!(de_base64("TWFu").unwrap(), b"Man");
        assert_eq!(de_base64("TWE=").unwrap(), b"Ma");
        assert_eq!(de_base64("TQ==").unwrap(), b"M");
        assert!(de_base64("TW F").is_none() && de_base64("<x>").is_none());
        let mut wav = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        wav.resize(44 + 32000 * 42, 0);
        assert_eq!(segundos_wav(&wav), Some(42));
        assert_eq!(segundos_wav(b"OggS isso nao e wav, e tem mais de 44 bytes ......"), None);
        assert_eq!(segundos_wav(b"RIFF"), None);
    }

    #[test]
    fn hash_confere_ou_apaga() {
        let d = temp("sha");
        let f = d.join("x.bin");
        fs::write(&f, b"abc").unwrap();
        assert_eq!(sha256(&f).as_deref(), Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        assert!(confere(&f, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").is_ok() && f.exists());
        // hash errado: erro e o arquivo some (nada fica para ser executado)
        assert!(confere(&f, MOTOR_SHA).unwrap_err().contains("SHA-256"));
        assert!(!f.exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn cache_so_texto_e_tetos() {
        let d = temp("cache");
        let t = Transcricao::load(Some(d.clone()));
        assert_eq!(t.estado("a", 42)["estado"], "falta");
        assert_eq!(t.estado("b", DUR_MAX + 1)["estado"], "longo", "acima de 10 min nem entra na fila");
        assert_eq!(t.estado("c", DUR_MAX)["estado"], "falta", "10 min ainda transcreve");
        t.guardar("a", "ok", "oi gente".into(), 42);
        t.guardar("e", "expirado", String::new(), 9);
        // reabrir: lê do arquivo; o arquivo tem texto, duração e quando, nunca o áudio
        let t2 = Transcricao::load(Some(d.clone()));
        assert_eq!(t2.estado("a", 42), json!({"estado": "ok", "texto": "oi gente"}));
        assert_eq!(t2.estado("e", 9)["estado"], "expirado");
        let arq: Value = serde_json::from_str(&fs::read_to_string(d.join("transcricoes.json")).unwrap()).unwrap();
        assert_eq!(arq["a"]["dur"], 42);
        assert!(arq["a"]["t"].as_u64().unwrap() > 0 && arq["e"].get("texto").is_none());
        let v = t2.visao(false);
        assert_eq!((v["transcritos"].as_u64(), v["guardados"].as_u64(), v["motor"].as_bool()), (Some(1), Some(2), Some(false)));
        // apagar transcrições: some o arquivo e tudo volta a "falta"
        t2.limpar().unwrap();
        assert!(!d.join("transcricoes.json").exists() && t2.estado("a", 42)["estado"] == "falta");
        // motor: só conta com o exe e o modelo; apagar some com a pasta
        fs::create_dir_all(d.join("whisper")).unwrap();
        fs::write(d.join("whisper").join(EXE), b"x").unwrap();
        assert!(t2.arquivos().is_none(), "sem o modelo não está instalado");
        fs::write(d.join("whisper").join(MODELO), b"x").unwrap();
        assert!(t2.arquivos().is_some());
        // o WAV temporário some mesmo quando o motor falha (aqui o "exe" nem é programa)
        assert!(rodar(&d.join("whisper").join(EXE), &d.join("whisper").join(MODELO), b"RIFF....WAVE".to_vec()).is_err());
        assert!(!d.join("whisper").join(WAV_TMP).exists(), "o áudio não fica no disco");
        t2.apagar_motor().unwrap();
        assert!(t2.arquivos().is_none() && !d.join("whisper").exists());
        assert!(t2.apagar_motor().is_ok(), "apagar de novo não é erro");
        let _ = fs::remove_dir_all(&d);
    }
}
