// Acesso de fora do PC (Fase 10): túnel do Tailscale Funnel + login OAuth mínimo (MCP 2025-11-25), só stdlib.
// O túnel entrega numa porta própria (47801): tudo o que chega nela é "de fora" e só entra com token OAuth.
// A porta 47800 (Claude Code e os outros apps do PC, por chave) continua igual e nunca aceita token daqui.
//
// Fluxo: 401 + resource_metadata -> metadados -> registro (DCR) -> /authorize (página com código de 6 dígitos;
// caixa Sim/Não no PC, 2 min) -> código de uso único -> /token (PKCE S256) -> token de acesso (1 h) + refresh.
// Cada app autorizado vira uma conexão "de fora" (mcp.rs), que começa só lendo. Tokens só como SHA-256.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::mcp::{self, Acesso, Conexoes, Request};

pub const PORTA: u16 = 47801;
/// Porta pública do Funnel: 443, porque o backend do claude.ai só conecta na 443 (issue #125 de anthropics/claude-ai-mcp).
/// O Funnel liga a porta inteira: se a 443 tiver outro `tailscale serve`, o app recusa abrir (ele iria para a internet).
const PORTA_PUBLICA: u16 = 443;
const DESTINO: &str = "http://127.0.0.1:47801";
const TAILSCALE: &str = r"C:\Program Files\Tailscale\tailscale.exe";
const TITULO_CAIXA: &str = "WhatsApp Lite · autorizar app";
/// Segundos para responder no PC; depois disso, recusado.
const ESPERA_PC: u64 = 120;
const VIDA_ACESSO: u64 = 3600;
const VIDA_CODIGO: u64 = 300;
/// Limite da página de autorização: até 5 pedidos novos em 10 min, um esperando de cada vez.
const JANELA: u64 = 600;
const PEDIDOS_MAX: usize = 5;
const CLIENTES_MAX: usize = 50;
const TOKENS_MAX: usize = 500;

#[derive(Clone)]
struct Cliente {
    id: String,
    nome: String,
    retornos: Vec<String>,
    /// SHA-256 do segredo, só se o app pediu um (client_secret_post/basic); senão cliente público
    segredo: Option<String>,
}

#[derive(PartialEq, Clone, Copy, Debug)]
enum Decisao {
    Esperando,
    Sim,
    Nao,
    Entregue,
}

struct Pedido {
    id: String,
    numero: String,
    cliente: Cliente,
    retorno: String,
    desafio: String,
    estado: Option<String>,
    criado: u64,
    decisao: Decisao,
}

struct Codigo {
    hash: String,
    cliente: Cliente,
    retorno: String,
    desafio: String,
    expira: u64,
}

struct Token {
    hash: String,
    conexao: u64,
    /// hash do refresh da conexão quando o token saiu: renovar ou girar o refresh derruba o token
    refresh: String,
    expira: u64,
}

/// Estado do acesso de fora: interruptor, endereço do túnel e o que o OAuth guarda só na memória.
#[derive(Default)]
pub struct Fora {
    pub ligado: AtomicBool,
    ouvindo: AtomicBool,
    /// "https://<máquina>.ts.net"; None = túnel não aberto
    base: Mutex<Option<String>>,
    erro: Mutex<Option<String>>,
    clientes: Mutex<Vec<Cliente>>,
    pedidos: Mutex<Vec<Pedido>>,
    codigos: Mutex<Vec<Codigo>>,
    tokens: Mutex<Vec<Token>>,
}

pub struct Resp {
    pub status: u16,
    pub tipo: &'static str,
    pub extra: Vec<(&'static str, String)>,
    pub corpo: String,
}

const JSON: &str = "application/json";
const HTML: &str = "text/html; charset=utf-8";

fn resp(status: u16, tipo: &'static str, corpo: String) -> Resp {
    Resp { status, tipo, extra: Vec::new(), corpo }
}

fn erro_oauth(status: u16, codigo: &str, texto: &str) -> Resp {
    let mut r = resp(status, JSON, json!({"error": codigo, "error_description": texto}).to_string());
    r.extra.push(("Cache-Control", "no-store".into()));
    r
}

impl Fora {
    pub fn estado(&self) -> Value {
        json!({
            "ligado": self.ligado.load(Ordering::Relaxed),
            "endereco": self.endereco_mcp(),
            "erro": *self.erro.lock().unwrap(),
        })
    }

    pub fn endereco_mcp(&self) -> Option<String> {
        self.base.lock().unwrap().as_ref().map(|b| format!("{b}/mcp"))
    }

    fn tunel(&self, base: Option<String>, erro: Option<String>) {
        *self.base.lock().unwrap() = base;
        *self.erro.lock().unwrap() = erro;
    }

    fn cliente(&self, id: &str, conexoes: &Conexoes) -> Option<Cliente> {
        if let Some(c) = self.clientes.lock().unwrap().iter().find(|c| c.id == id) {
            return Some(c.clone());
        }
        let (nome, retornos, segredo) = conexoes.fora_cliente(id)?;
        Some(Cliente { id: id.into(), nome, retornos, segredo })
    }

    /// O pedido ainda espera a resposta do PC?
    fn esperando(&self, pedido: &str) -> bool {
        self.pedidos.lock().unwrap().iter().any(|p| p.id == pedido && p.decisao == Decisao::Esperando)
    }

    /// Resposta da caixa do PC. Só vale enquanto espera e dentro dos 2 min; o resto fica recusado.
    fn decidir(&self, pedido: &str, sim: bool, agora: u64) {
        if let Some(p) = self.pedidos.lock().unwrap().iter_mut().find(|p| p.id == pedido && p.decisao == Decisao::Esperando) {
            p.decisao = if sim && agora <= p.criado + ESPERA_PC { Decisao::Sim } else { Decisao::Nao };
        }
    }

    /// Uma requisição que veio pelo túnel, sem rede (testável). `leitura`: leitura ou escrita ligada no app.
    /// `perguntar(pedido, app, código, para onde volta)` abre a caixa Sim/Não no PC.
    pub fn atender(
        &self,
        req: &Request,
        agora: u64,
        conexoes: &Conexoes,
        leitura: bool,
        perguntar: impl FnOnce(&str, &str, &str, &str),
        call: impl Fn(Acesso, &str, &Value) -> Result<String, String>,
    ) -> Resp {
        // interruptor desligado: nada de fora entra, mesmo se o túnel ficou aberto por engano
        let base = self.base.lock().unwrap().clone();
        let Some(base) = base.filter(|_| self.ligado.load(Ordering::Relaxed)) else { return resp(503, JSON, String::new()) };
        let (caminho, query) = req.path.split_once('?').unwrap_or((req.path.as_str(), ""));
        match (req.method.as_str(), caminho) {
            ("GET", "/.well-known/oauth-protected-resource" | "/.well-known/oauth-protected-resource/mcp") => resp(
                200,
                JSON,
                json!({"resource": format!("{base}/mcp"), "authorization_servers": [base], "bearer_methods_supported": ["header"], "resource_name": "WhatsApp Lite"}).to_string(),
            ),
            ("GET", "/.well-known/oauth-authorization-server") => resp(
                200,
                JSON,
                json!({
                    "issuer": base,
                    "authorization_endpoint": format!("{base}/authorize"),
                    "token_endpoint": format!("{base}/token"),
                    "registration_endpoint": format!("{base}/register"),
                    "response_types_supported": ["code"],
                    "grant_types_supported": ["authorization_code", "refresh_token"],
                    "code_challenge_methods_supported": ["S256"],
                    "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
                })
                .to_string(),
            ),
            ("POST", "/register") => self.registrar(&req.body, agora),
            ("GET", "/authorize") => self.autorizar(query, agora, conexoes, &base, perguntar),
            ("GET", "/authorize/espera") => self.espera(query, agora),
            ("POST", "/token") => self.token(req, agora, conexoes, &base),
            (_, "/mcp") => self.mcp(req, agora, conexoes, leitura, &base, call),
            _ => resp(404, JSON, String::new()),
        }
    }

    /// Registro dinâmico (RFC 7591). Só endereço de retorno https; o nome é do app (só texto na caixa e na tela).
    fn registrar(&self, corpo: &[u8], agora: u64) -> Resp {
        let Ok(v) = serde_json::from_slice::<Value>(corpo) else { return erro_oauth(400, "invalid_client_metadata", "JSON inválido") };
        let retornos: Vec<String> = v["redirect_uris"].as_array().into_iter().flatten().filter_map(|u| u.as_str().map(String::from)).collect();
        if retornos.is_empty() || retornos.len() > 5 || !retornos.iter().all(|u| retorno_ok(u)) {
            return erro_oauth(400, "invalid_redirect_uri", "Só endereços https://, até 5.");
        }
        let nome = limpa_nome(v["client_name"].as_str().unwrap_or(""));
        let metodo = match v["token_endpoint_auth_method"].as_str() {
            Some(m @ ("client_secret_post" | "client_secret_basic")) => m,
            _ => "none",
        };
        let (Some(id), Some(segredo)) = (mcp::aleatorio("wlcli_"), mcp::aleatorio("wls_")) else { return erro_oauth(500, "server_error", "") };
        let segredo = (metodo != "none").then_some(segredo);
        let mut lista = self.clientes.lock().unwrap();
        lista.push(Cliente { id: id.clone(), nome: nome.clone(), retornos: retornos.clone(), segredo: segredo.as_deref().map(hash) });
        // ponytail: lista só na memória, a mais antiga sai; o app autorizado fica guardado na conexão dele
        let sobra = lista.len().saturating_sub(CLIENTES_MAX);
        lista.drain(..sobra);
        let mut r = json!({
            "client_id": id, "client_name": nome, "redirect_uris": retornos, "client_id_issued_at": agora,
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"], "token_endpoint_auth_method": metodo,
        });
        if let Some(s) = segredo {
            (r["client_secret"], r["client_secret_expires_at"]) = (json!(s), json!(0));
        }
        let mut r = resp(201, JSON, r.to_string());
        r.extra.push(("Cache-Control", "no-store".into()));
        r
    }

    fn autorizar(&self, query: &str, agora: u64, conexoes: &Conexoes, base: &str, perguntar: impl FnOnce(&str, &str, &str, &str)) -> Resp {
        let p = params(query);
        let mut chaves: Vec<&str> = p.iter().map(|(k, _)| k.as_str()).collect();
        chaves.sort();
        if chaves.windows(2).any(|w| w[0] == w[1]) {
            return pagina(400, "Pedido inválido", "O pedido veio com campos repetidos.", None);
        }
        let get = |k: &str| p.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        // app desconhecido ou retorno não registrado: nunca redireciona (poderia mandar o código para outro lugar)
        let cliente = get("client_id").and_then(|id| self.cliente(id, conexoes));
        let retorno = get("redirect_uri").unwrap_or("");
        let Some(cliente) = cliente.filter(|c| c.retornos.iter().any(|r| r == retorno)) else {
            return pagina(400, "Pedido inválido", "App desconhecido ou endereço de retorno não registrado. Nada foi autorizado.", None);
        };
        if get("response_type") != Some("code") || get("code_challenge_method") != Some("S256") || !pkce_ok(get("code_challenge").unwrap_or("")) {
            return pagina(400, "Pedido inválido", "O app precisa pedir com PKCE (S256). Nada foi autorizado.", None);
        }
        if get("resource").is_some_and(|r| !recurso_ok(r, base)) {
            return pagina(400, "Pedido inválido", "O pedido é para outro servidor. Nada foi autorizado.", None);
        }
        let mut pedidos = self.pedidos.lock().unwrap();
        pedidos.retain(|x| x.criado + JANELA > agora);
        for x in pedidos.iter_mut().filter(|x| x.decisao == Decisao::Esperando && agora > x.criado + ESPERA_PC) {
            x.decisao = Decisao::Nao;
        }
        if pedidos.iter().any(|x| x.decisao == Decisao::Esperando) {
            return pagina(429, "Espere um pouco", "Já há um pedido esperando resposta no PC. Responda lá ou espere 2 minutos.", None);
        }
        if pedidos.len() >= PEDIDOS_MAX {
            return pagina(429, "Muitas tentativas", "Muitos pedidos em pouco tempo. Espere 10 minutos e tente de novo.", None);
        }
        let (Some(id), Some(sorteio)) = (mcp::aleatorio("wlp_"), mcp::aleatorio("")) else { return pagina(500, "Erro", "Tente de novo.", None) };
        let n = u32::from_str_radix(&sorteio[..8], 16).unwrap_or(0) % 1_000_000;
        let numero = format!("{:03} {:03}", n / 1000, n % 1000);
        let host = host_de(retorno);
        pedidos.push(Pedido {
            id: id.clone(), numero: numero.clone(), cliente: cliente.clone(), retorno: retorno.into(),
            desafio: get("code_challenge").unwrap_or("").into(), estado: get("state").map(String::from), criado: agora, decisao: Decisao::Esperando,
        });
        drop(pedidos);
        perguntar(&id, &cliente.nome, &numero, &host);
        esperando(&id, &cliente.nome, &numero)
    }

    /// A página do celular recarrega aqui a cada 2 s até o PC responder.
    fn espera(&self, query: &str, agora: u64) -> Resp {
        let p = params(query);
        let id = p.iter().find(|(k, _)| k == "p").map(|(_, v)| v.as_str()).unwrap_or("");
        let mut pedidos = self.pedidos.lock().unwrap();
        let Some(x) = pedidos.iter_mut().find(|x| !id.is_empty() && mcp::same_token(id, &x.id)) else {
            return pagina(404, "Pedido não encontrado", "Esse pedido expirou. Volte ao app e tente conectar de novo.", None);
        };
        if x.decisao == Decisao::Esperando && agora > x.criado + ESPERA_PC {
            x.decisao = Decisao::Nao;
        }
        match x.decisao {
            Decisao::Esperando => esperando(&x.id, &x.cliente.nome, &x.numero),
            Decisao::Nao => pagina(200, "Acesso negado no PC", "O pedido foi recusado no PC (ou ficou sem resposta por 2 minutos). Nada foi liberado.", None),
            Decisao::Entregue => pagina(200, "Autorizado", "Pode voltar ao app.", None),
            Decisao::Sim => {
                let Some(codigo) = mcp::aleatorio("wlc_") else { return pagina(500, "Erro", "Tente de novo.", None) };
                x.decisao = Decisao::Entregue;
                let mut destino = format!("{}{}code={codigo}", x.retorno, if x.retorno.contains('?') { '&' } else { '?' });
                if let Some(s) = &x.estado {
                    destino += &format!("&state={}", codifica(s));
                }
                let c = Codigo { hash: hash(&codigo), cliente: x.cliente.clone(), retorno: x.retorno.clone(), desafio: x.desafio.clone(), expira: agora + VIDA_CODIGO };
                drop(pedidos);
                let mut codigos = self.codigos.lock().unwrap();
                codigos.retain(|c| c.expira >= agora);
                codigos.push(c);
                let mut r = pagina(302, "Autorizado", "Voltando ao app…", None);
                r.extra.push(("Location", destino));
                r
            }
        }
    }

    fn token(&self, req: &Request, agora: u64, conexoes: &Conexoes, base: &str) -> Resp {
        let f = params(&String::from_utf8_lossy(&req.body));
        let get = |k: &str| f.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        // client_secret_basic: "Basic base64(id:segredo)"
        let basic = req
            .header("authorization")
            .and_then(|v| v.strip_prefix("Basic "))
            .and_then(|b| crate::transcricao::de_base64(b.trim()))
            .and_then(|b| String::from_utf8(b).ok())
            .and_then(|s| s.split_once(':').map(|(i, s)| (decodifica(i), decodifica(s))));
        let cliente = get("client_id").or_else(|| basic.as_ref().map(|b| b.0.clone())).unwrap_or_default();
        let segredo = get("client_secret").or_else(|| basic.map(|b| b.1));
        if get("resource").is_some_and(|r| !recurso_ok(&r, base)) {
            return erro_oauth(400, "invalid_target", "Recurso de outro servidor.");
        }
        match get("grant_type").as_deref() {
            Some("authorization_code") => {
                let codigo = get("code").unwrap_or_default();
                // uso único: sai da lista na primeira tentativa, dê certo ou não
                let c = {
                    let mut l = self.codigos.lock().unwrap();
                    let i = l.iter().position(|c| !codigo.is_empty() && mcp::same_token(&hash(&codigo), &c.hash));
                    i.map(|i| l.remove(i))
                };
                let Some(c) = c.filter(|c| c.expira >= agora && c.cliente.id == cliente && get("redirect_uri").as_deref() == Some(c.retorno.as_str())) else {
                    return erro_oauth(400, "invalid_grant", "Código inválido, usado ou expirado.");
                };
                if !segredo_ok(&c.cliente.segredo, segredo.as_deref()) {
                    return erro_oauth(401, "invalid_client", "Segredo do app inválido.");
                }
                let verificador = get("code_verifier").unwrap_or_default();
                if !pkce_ok(&verificador) || b64url(&sha256(verificador.as_bytes())) != c.desafio {
                    return erro_oauth(400, "invalid_grant", "PKCE não confere.");
                }
                let Some(refresh) = mcp::aleatorio("wlr_") else { return erro_oauth(500, "server_error", "") };
                let id = conexoes.fora_conectar(&c.cliente.id, &c.cliente.nome, tipo_de(&c.retorno), &c.cliente.retornos, c.cliente.segredo.clone(), hash(&refresh));
                self.emitir(id, refresh, agora)
            }
            Some("refresh_token") => {
                let dado = get("refresh_token").unwrap_or_default();
                let Some((_, retornos, guardado)) = conexoes.fora_cliente(&cliente) else { return erro_oauth(400, "invalid_grant", "Conexão revogada.") };
                if !segredo_ok(&guardado, segredo.as_deref()) {
                    return erro_oauth(401, "invalid_client", "Segredo do app inválido.");
                }
                // Claude (e o padrão OAuth 2.1 para app público) gira o refresh; o Gemini pede que não gire
                // (developers.google.com/connected-apps/mcp/oauth, "Persistent Linking")
                let novo = if retornos.first().is_some_and(|r| tipo_de(r) == "gemini") { None } else { mcp::aleatorio("wlr_") };
                let Some(id) = conexoes.fora_refresh(&cliente, &hash(&dado), novo.as_deref().map(hash)) else {
                    return erro_oauth(400, "invalid_grant", "Refresh inválido: autorize de novo.");
                };
                self.emitir(id, novo.unwrap_or(dado), agora)
            }
            _ => erro_oauth(400, "unsupported_grant_type", "Use authorization_code ou refresh_token."),
        }
    }

    fn emitir(&self, conexao: u64, refresh: String, agora: u64) -> Resp {
        let Some(acesso) = mcp::aleatorio("wla_") else { return erro_oauth(500, "server_error", "") };
        let mut l = self.tokens.lock().unwrap();
        l.retain(|t| t.expira > agora);
        l.push(Token { hash: hash(&acesso), conexao, refresh: hash(&refresh), expira: agora + VIDA_ACESSO });
        let sobra = l.len().saturating_sub(TOKENS_MAX);
        l.drain(..sobra);
        let mut r = resp(200, JSON, json!({"access_token": acesso, "token_type": "Bearer", "expires_in": VIDA_ACESSO, "refresh_token": refresh}).to_string());
        r.extra.extend([("Cache-Control", "no-store".to_string()), ("Pragma", "no-cache".to_string())]);
        r
    }

    fn mcp(&self, req: &Request, agora: u64, conexoes: &Conexoes, leitura: bool, base: &str, call: impl Fn(Acesso, &str, &Value) -> Result<String, String>) -> Resp {
        let dado = req.header("authorization").and_then(|v| v.strip_prefix("Bearer ")).map(str::trim).filter(|t| !t.is_empty());
        let achado = dado.and_then(|d| {
            let h = hash(d);
            let l = self.tokens.lock().unwrap();
            l.iter().find(|t| mcp::same_token(&h, &t.hash) && t.expira > agora).map(|t| (t.conexao, t.refresh.clone()))
        });
        let Some((acesso, ativa)) = achado.and_then(|(id, refresh)| conexoes.fora_acesso(id, &refresh)) else {
            let erro = if dado.is_some() { "error=\"invalid_token\", " } else { "" };
            let mut r = resp(401, JSON, String::new());
            r.extra.push(("WWW-Authenticate", format!("Bearer {erro}resource_metadata=\"{base}/.well-known/oauth-protected-resource/mcp\"")));
            return r;
        };
        if !ativa {
            return resp(403, JSON, json!({"error": "Conexão pausada no app WhatsApp Lite. Nada foi lido."}).to_string());
        }
        let (status, corpo) = mcp::rpc(req, acesso, leitura, call);
        resp(status, JSON, corpo)
    }
}

// ---- rede, túnel e caixa do PC ----

/// Abre a porta de fora (só 127.0.0.1; quem chega é o Funnel). Uma vez por execução.
pub fn ouvir(app: &AppHandle) -> std::io::Result<()> {
    let fora = app.state::<Fora>();
    if fora.ouvindo.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let l = std::net::TcpListener::bind(("127.0.0.1", PORTA)).inspect_err(|_| fora.ouvindo.store(false, Ordering::SeqCst))?;
    let app = app.clone();
    thread::spawn(move || {
        for stream in l.incoming().flatten() {
            let app = app.clone();
            thread::spawn(move || servir(&app, stream));
        }
    });
    Ok(())
}

fn servir(app: &AppHandle, mut stream: std::net::TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let r = match mcp::read_request(&stream) {
        // ícone do app: público, sem token (só enquanto o acesso de fora está ligado)
        Ok(req) if mcp::icone(&req).is_some() && app.state::<Fora>().ligado.load(Ordering::Relaxed) => {
            let (tipo, bytes) = mcp::icone(&req).unwrap();
            mcp::responder(&mut stream, 200, tipo, &[("Cache-Control", "public, max-age=86400".into())], bytes);
            return;
        }
        Ok(req) => {
            let leitura = app.state::<crate::Settings>().mcp_enabled.load(Ordering::Relaxed) || app.state::<mcp::Escrita>().ligado();
            let pede = |pedido: &str, nome: &str, numero: &str, host: &str| caixa(app.clone(), pedido.into(), nome.into(), numero.into(), host.into());
            app.state::<Fora>().atender(&req, mcp::agora(), &app.state::<Conexoes>(), leitura, pede, |a, tool, args| mcp::call_tool(app, a, tool, args))
        }
        Err(s) => resp(s, JSON, String::new()),
    };
    mcp::responder(&mut stream, r.status, r.tipo, &r.extra, &r.corpo);
}

fn tailscale(args: &[&str]) -> Result<String, String> {
    let exe = if Path::new(TAILSCALE).exists() { TAILSCALE } else { "tailscale" };
    let out = mcp::quiet(exe).args(args).output().map_err(|_| "Tailscale não encontrado neste PC. Instale e entre na sua conta.".to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let e = String::from_utf8_lossy(&out.stderr).into_owned() + &String::from_utf8_lossy(&out.stdout);
        Err(e.trim().chars().take(300).collect())
    }
}

fn serve_status() -> Result<Value, String> {
    serde_json::from_str(&tailscale(&["serve", "status", "--json"])?).map_err(|_| "Resposta estranha do Tailscale.".to_string())
}

/// Os handlers da porta pública em `tailscale serve status --json`: (caminho, destino).
fn handlers(serve: &Value) -> Vec<(String, String)> {
    let fim = format!(":{PORTA_PUBLICA}");
    let mut v: Vec<(String, String)> = serve["Web"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(k, _)| k.ends_with(&fim))
        .flat_map(|(_, w)| w["Handlers"].as_object().into_iter().flatten())
        .map(|(p, h)| (p.clone(), h["Proxy"].as_str().or(h["Path"].as_str()).unwrap_or("outro").to_string()))
        .collect();
    if let Some(f) = serve["TCP"][PORTA_PUBLICA.to_string()]["TCPForward"].as_str() {
        v.push(("tcp".into(), f.into()));
    }
    v
}

/// Algum serviço que não é deste app na porta pública? (o Funnel o abriria para a internet)
fn alheio(serve: &Value) -> Option<String> {
    handlers(serve).into_iter().find(|(_, d)| d != DESTINO).map(|(p, d)| format!("{p} → {d}"))
}

/// Liga o Funnel (443 público -> 127.0.0.1:47801) e devolve o endereço base. Não mexe no resto da configuração.
pub fn abrir_tunel() -> Result<String, String> {
    let st: Value = serde_json::from_str(&tailscale(&["status", "--json"])?).map_err(|_| "Resposta estranha do Tailscale.".to_string())?;
    if st["BackendState"] != "Running" {
        return Err("O Tailscale está desligado ou sem login. Abra o Tailscale e entre na sua conta.".into());
    }
    let dns = st["Self"]["DNSName"].as_str().unwrap_or("").trim_end_matches('.').to_ascii_lowercase();
    if dns.is_empty() {
        return Err("O Tailscale não informou o nome deste PC.".into());
    }
    if let Some(x) = alheio(&serve_status()?) {
        return Err(format!("A porta {PORTA_PUBLICA} deste PC já tem outro serviço do Tailscale ({x}). Ligar o túnel o abriria para a internet: mude esse serviço de porta e ligue de novo."));
    }
    tailscale(&["funnel", "--bg", "--yes", &format!("--https={PORTA_PUBLICA}"), DESTINO]).map_err(|e| format!("O Tailscale não abriu o túnel: {e}"))?;
    // 443 é a porta padrão do https: o endereço vai sem ela (forma canônica que o Claude usa)
    Ok(format!("https://{dns}"))
}

/// Fecha só o túnel deste app; com outro serviço na mesma porta não mexe (o `off` apagaria os dois).
pub fn fechar_tunel() -> Result<(), String> {
    let serve = serve_status()?;
    if handlers(&serve).is_empty() || alheio(&serve).is_some() {
        return Ok(());
    }
    tailscale(&["funnel", &format!("--https={PORTA_PUBLICA}"), "off"]).map(|_| ())
}

/// Ao abrir o app: interruptor ligado abre a porta e o túnel; desligado fecha um túnel esquecido (app fechado à força).
pub fn iniciar(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let fora = app.state::<Fora>();
        if !fora.ligado.load(Ordering::Relaxed) {
            if let Err(e) = fechar_tunel() {
                eprintln!("Acesso de fora: {e}");
            }
            return;
        }
        let r = ouvir(&app).map_err(|e| format!("A porta {PORTA} está ocupada: {e}")).and_then(|_| abrir_tunel());
        match r {
            Ok(b) => fora.tunel(Some(b), None),
            Err(e) => fora.tunel(None, Some(e)),
        }
        crate::eval_in(&app, "main", "window.__wlLite && window.__wlLite.refresh()".into());
    });
}

/// Ao sair do app: o túnel fecha junto (o interruptor continua ligado e reabre na próxima vez).
pub fn ao_sair(app: &AppHandle) {
    if app.state::<Fora>().ligado.load(Ordering::Relaxed) {
        let _ = fechar_tunel();
    }
}

/// Interruptor "Acesso de fora do PC": ligar pede a caixa Sim/Não e abre o túnel; desligar recusa tudo na hora e fecha.
#[tauri::command]
pub async fn mcp_fora(app: AppHandle, acao: String) -> Result<Value, String> {
    let fora = app.state::<Fora>();
    match acao.as_str() {
        "ligar" => {
            crate::confirma(&app, "mcp_fora", "ligar", !fora.ligado.load(Ordering::Relaxed)).await?;
            ouvir(&app).map_err(|e| format!("A porta {PORTA} está ocupada: {e}"))?;
            let base = tauri::async_runtime::spawn_blocking(abrir_tunel).await.map_err(|e| e.to_string())?;
            let base = base.inspect_err(|e| fora.tunel(None, Some(e.clone())))?;
            fora.tunel(Some(base), None);
            fora.ligado.store(true, Ordering::Relaxed);
        }
        "desligar" => {
            // primeiro o interruptor: a porta de fora passa a recusar tudo antes de o túnel fechar
            fora.ligado.store(false, Ordering::Relaxed);
            let r = tauri::async_runtime::spawn_blocking(fechar_tunel).await.map_err(|e| e.to_string())?;
            fora.tunel(None, r.err().map(|e| format!("O túnel não fechou: {e}")));
        }
        _ => return Err("Ação desconhecida.".into()),
    }
    crate::save_settings(&app);
    Ok(crate::lite_state(&app))
}

/// Caixa Sim/Não no PC "Autorizar o <app>?" com o código. Sem resposta em 2 min: recusado e a caixa fecha sozinha.
fn caixa(app: AppHandle, pedido: String, nome: String, numero: String, host: String) {
    let texto = format!(
        "Autorizar o {nome}?\n\nUm aparelho de fora pediu para ler o seu WhatsApp pelo endereço do túnel.\n\nCódigo: {numero}\nVolta para: {host}\n\nSó aceite se foi você que pediu agora e o código é igual ao do celular. Ele entra só lendo."
    );
    let (a, p) = (app.clone(), pedido.clone());
    tauri::async_runtime::spawn(async move {
        let sim = rfd::AsyncMessageDialog::new()
            .set_title(TITULO_CAIXA)
            .set_description(texto)
            .set_level(rfd::MessageLevel::Warning)
            .set_buttons(rfd::MessageButtons::YesNo)
            .show()
            .await
            == rfd::MessageDialogResult::Yes;
        a.state::<Fora>().decidir(&p, sim, mcp::agora());
    });
    thread::spawn(move || {
        let t0 = Instant::now();
        let mut na_frente = false;
        while t0.elapsed() < Duration::from_secs(ESPERA_PC) {
            thread::sleep(Duration::from_millis(250));
            if !app.state::<Fora>().esperando(&pedido) {
                return;
            }
            if !na_frente {
                na_frente = janela::frente(TITULO_CAIXA);
            }
        }
        app.state::<Fora>().decidir(&pedido, false, u64::MAX);
        janela::fechar(TITULO_CAIXA);
    });
}

#[cfg(windows)]
mod janela {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::*;

    fn achar(titulo: &str) -> Option<HWND> {
        let classe: Vec<u16> = "#32770\0".encode_utf16().collect();
        let t: Vec<u16> = titulo.encode_utf16().chain(Some(0)).collect();
        unsafe { FindWindowW(PCWSTR(classe.as_ptr()), PCWSTR(t.as_ptr())).ok() }
    }

    /// A caixa na frente de tudo (sem janela-mãe ela pode abrir atrás de outro programa).
    pub fn frente(titulo: &str) -> bool {
        let Some(h) = achar(titulo) else { return false };
        unsafe {
            let _ = SetWindowPos(h, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            let _ = SetForegroundWindow(h);
        }
        true
    }

    /// Fecha como "Não" (a caixa Sim/Não do Windows não fecha pelo X nem pelo Esc).
    pub fn fechar(titulo: &str) {
        if let Some(h) = achar(titulo) {
            unsafe {
                let _ = PostMessageW(Some(h), WM_COMMAND, WPARAM(IDNO.0 as usize), LPARAM(0));
            }
        }
    }
}

#[cfg(not(windows))]
mod janela {
    pub fn frente(_: &str) -> bool {
        true
    }
    pub fn fechar(_: &str) {}
}

// ---- páginas e utilidades ----

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

fn esperando(id: &str, nome: &str, numero: &str) -> Resp {
    // 6 dígitos em caixinhas, 3 + 3 (o número vem como "776 241")
    let digitos: String = numero.chars().map(|c| if c == ' ' { "<i></i>".to_string() } else { format!("<span>{}</span>", esc(&c.to_string())) }).collect();
    let cartao = format!(
        "<p class=\"m\">Confira este código no seu PC</p><div class=\"dg\">{digitos}</div><p>Aguardando o Sim <span class=\"pt\"><b></b><b></b><b></b></span></p><p class=\"m\">Só leitura. Você muda isso depois em Conexões.</p>"
    );
    montar(200, &format!("Pedido de acesso do {}", esc(nome)), &cartao, Some(&format!("/authorize/espera?p={id}")))
}

/// Página do celular de texto simples. `corpo` já vem escapado.
fn pagina(status: u16, titulo: &str, corpo: &str, recarregar: Option<&str>) -> Resp {
    montar(status, "", &format!("<h1>{}</h1><p>{corpo}</p>", esc(titulo)), recarregar)
}

/// Moldura da página do celular (sem script: recarrega por meta refresh): faixa verde com o ícone + cartão.
/// `sub` e `cartao` já vêm escapados. O ícone é a rota pública /icon.png do próprio servidor.
fn montar(status: u16, sub: &str, cartao: &str, recarregar: Option<&str>) -> Resp {
    let meta = recarregar.map_or(String::new(), |u| format!("<meta http-equiv=\"refresh\" content=\"2;url={}\">", esc(u)));
    let sub = if sub.is_empty() { String::new() } else { format!("<div class=\"sb\">{sub}</div>") };
    let html = format!(
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">{meta}<title>WhatsApp Lite</title><style>:root{{--bg:#e9edef;--fg:#111b21;--mut:#667781;--card:#fff;--cx:#e9edef;--band:#075e54;--green:#00a884;color-scheme:light}}@media(prefers-color-scheme:dark){{:root{{--bg:#0b141a;--fg:#e9edef;--mut:#8696a0;--card:#111b21;--cx:#0b141a;--band:#0b3d36;--green:#21c063;color-scheme:dark}}}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,\"Segoe UI\",sans-serif;text-align:center}}.hd{{background:var(--band);color:#fff;padding:28px 16px 52px}}.hd img{{width:60px;height:60px;display:block;margin:0 auto 8px}}.hd b{{display:block;font-size:17px;font-weight:600}}.sb{{opacity:.85;font-size:13px;overflow-wrap:anywhere}}.cd{{background:var(--card);border-radius:16px;max-width:420px;margin:-28px 12px 24px;padding:20px 14px;box-shadow:0 6px 24px rgba(0,0,0,.18)}}@media(min-width:456px){{.cd{{margin:-28px auto 24px}}}}h1{{font-size:20px;margin:0 0 8px}}p{{margin:8px 0}}.m{{color:var(--mut);font-size:14px}}.dg{{display:flex;gap:6px;justify-content:center;margin:12px 0}}.dg span{{width:34px;height:44px;border-radius:8px;background:var(--cx);display:grid;place-items:center;font:700 22px Consolas,monospace}}.dg i{{width:10px}}.pt b{{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin:0 3px;animation:p 1.2s infinite}}.pt b:nth-child(2){{animation-delay:.2s}}.pt b:nth-child(3){{animation-delay:.4s}}@keyframes p{{0%,80%,100%{{opacity:.25}}40%{{opacity:1}}}}@media(prefers-reduced-motion:reduce){{.pt b{{animation:none;opacity:.7}}}}</style></head><body><div class=\"hd\"><img src=\"/icon.png\" alt=\"\"><b>WhatsApp Lite</b>{sub}</div><div class=\"cd\">{cartao}</div></body></html>"
    );
    let mut r = resp(status, HTML, html);
    r.extra.extend([
        ("Cache-Control", "no-store".to_string()),
        ("Referrer-Policy", "no-referrer".to_string()),
        ("X-Content-Type-Options", "nosniff".to_string()),
        ("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'".to_string()),
    ]);
    r
}

fn params(s: &str) -> Vec<(String, String)> {
    s.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (decodifica(k), decodifica(v))
        })
        .collect()
}

fn decodifica(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => match std::str::from_utf8(&b[i + 1..i + 3]).ok().filter(|h| h.bytes().all(|c| c.is_ascii_hexdigit())).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                Some(x) => {
                    out.push(x);
                    i += 2;
                }
                None => out.push(b'%'),
            },
            x => out.push(x),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn codifica(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// Host de um endereço (para mostrar na caixa "Volta para:" e escolher o ícone).
pub fn host_de(url: &str) -> String {
    let resto = url.split_once("://").map_or(url, |(_, r)| r);
    let host = resto.split(['/', '?', '#']).next().unwrap_or("");
    host.rsplit('@').next().unwrap_or("").to_ascii_lowercase()
}

fn retorno_ok(u: &str) -> bool {
    u.len() <= 500 && u.starts_with("https://") && !u.contains('#') && !u.chars().any(|c| c.is_whitespace() || c.is_control()) && !host_de(u).is_empty()
}

fn tipo_de(retorno: &str) -> &'static str {
    let h = host_de(retorno);
    if ["claude.ai", "claude.com"].iter().any(|d| h == *d || h.ends_with(&format!(".{d}"))) {
        "claude"
    } else if h.ends_with(".googleusercontent.com") {
        "gemini"
    } else {
        "outro"
    }
}

fn limpa_nome(s: &str) -> String {
    let n: String = s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(40).collect();
    if n.is_empty() { "App".into() } else { n }
}

/// code_challenge e code_verifier: 43 a 128 caracteres de [A-Za-z0-9-._~] (RFC 7636).
fn pkce_ok(s: &str) -> bool {
    (43..=128).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._~".contains(&b))
}

fn recurso_ok(r: &str, base: &str) -> bool {
    let r = r.trim_end_matches('/').to_ascii_lowercase();
    let base = base.to_ascii_lowercase();
    // com ou sem a porta padrão escrita (":443")
    [base.clone(), format!("{base}:443")].iter().any(|b| r == *b || r == format!("{b}/mcp"))
}

fn segredo_ok(guardado: &Option<String>, dado: Option<&str>) -> bool {
    match guardado {
        None => true,
        Some(h) => dado.is_some_and(|s| mcp::same_token(&hash(s), h)),
    }
}

fn b64url(b: &[u8]) -> String {
    crate::documento::para_base64(b).trim_end_matches('=').replace('+', "-").replace('/', "_")
}

/// SHA-256 pelo BCrypt do Windows (crate `windows`, já dependência).
fn sha256(dado: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Security::Cryptography::*;
        let _ = BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, dado, &mut out);
    }
    out
}

fn hash(s: &str) -> String {
    sha256(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    const BASE: &str = "https://pc.tail0.ts.net";
    const RETORNO: &str = "https://claude.ai/api/mcp/auth_callback";
    const INIT: &str = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#;
    // par PKCE conferido fora do app (Python hashlib + base64url)
    const VERIF: &str = "dBjftJeZ4CVP-mJ0kzyJb6zU0w5c7XXkIpWHkMh2M7sA";
    const DESAFIO: &str = "nHGI1ExwaOnK3LFwi0T3uHyalIOhBjyVn8lH6WpT9Uc";

    fn ligado() -> Fora {
        let f = Fora::default();
        f.ligado.store(true, Ordering::Relaxed);
        f.tunel(Some(BASE.into()), None);
        f
    }

    fn conexoes() -> Conexoes {
        Conexoes::load(None, None).0
    }

    fn req(method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Request {
        Request { method: method.into(), path: path.into(), headers: headers.iter().map(|(n, v)| (n.to_string(), v.to_string())).collect(), body: body.as_bytes().to_vec() }
    }

    struct T {
        f: Fora,
        c: Conexoes,
        agora: u64,
    }

    impl T {
        fn novo() -> T {
            T { f: ligado(), c: conexoes(), agora: 1_000_000 }
        }
        /// requisição; devolve a resposta e o pedido que a caixa do PC recebeu (se abriu)
        fn ir(&self, r: Request) -> (Resp, Option<(String, String, String, String)>) {
            let caixa = RefCell::new(None);
            let x = self.f.atender(&r, self.agora, &self.c, true, |p, n, c, h| *caixa.borrow_mut() = Some((p.into(), n.into(), c.into(), h.into())), |a, tool, _| Ok(format!("[\"{tool}\",{}]", a.id)));
            (x, caixa.into_inner())
        }
        fn json(&self, r: Request) -> (u16, Value) {
            let (x, _) = self.ir(r);
            (x.status, serde_json::from_str(&x.corpo).unwrap_or(Value::Null))
        }
        fn registrar(&self, retorno: &str, metodo: &str) -> Value {
            let (s, v) = self.json(req("POST", "/register", &[], &json!({"client_name": "Claude", "redirect_uris": [retorno], "token_endpoint_auth_method": metodo}).to_string()));
            assert_eq!(s, 201, "{v}");
            v
        }
        fn autorizar(&self, cliente: &str, retorno: &str, desafio: &str) -> (Resp, Option<(String, String, String, String)>) {
            self.ir(req("GET", &format!("/authorize?response_type=code&client_id={cliente}&redirect_uri={}&code_challenge={desafio}&code_challenge_method=S256&state=a%20b&resource={}", codifica(retorno), codifica(&format!("{BASE}/mcp"))), &[], ""))
        }
        /// fluxo até o código: registra, pede, o PC diz `sim`, o celular recarrega
        fn codigo(&self, cliente: &str, retorno: &str) -> String {
            let (_, caixa) = self.autorizar(cliente, retorno, DESAFIO);
            let pedido = caixa.expect("a caixa abriu").0;
            self.f.decidir(&pedido, true, self.agora);
            let (r, _) = self.ir(req("GET", &format!("/authorize/espera?p={pedido}"), &[], ""));
            assert_eq!(r.status, 302);
            let destino = r.extra.iter().find(|(n, _)| *n == "Location").unwrap().1.clone();
            assert!(destino.starts_with(&format!("{retorno}?code=wlc_")) && destino.ends_with("&state=a%20b"), "{destino}");
            destino.split("code=").nth(1).unwrap().split('&').next().unwrap().to_string()
        }
        fn trocar(&self, cliente: &str, codigo: &str, retorno: &str, verif: &str) -> (u16, Value) {
            self.json(req("POST", "/token", &[], &format!("grant_type=authorization_code&code={codigo}&redirect_uri={}&client_id={cliente}&code_verifier={verif}", codifica(retorno))))
        }
        fn renovar(&self, cliente: &str, refresh: &str) -> (u16, Value) {
            self.json(req("POST", "/token", &[], &format!("grant_type=refresh_token&refresh_token={refresh}&client_id={cliente}")))
        }
        fn mcp(&self, token: &str) -> u16 {
            let b = format!("Bearer {token}");
            self.ir(req("POST", "/mcp", &[("authorization", &b)], INIT)).0.status
        }
        /// fluxo completo: (client_id, token de acesso, refresh, conexão)
        fn entrar(&self) -> (String, String, String, u64) {
            let cliente = self.registrar(RETORNO, "none")["client_id"].as_str().unwrap().to_string();
            let codigo = self.codigo(&cliente, RETORNO);
            let (s, t) = self.trocar(&cliente, &codigo, RETORNO, VERIF);
            assert_eq!(s, 200, "{t}");
            let id = self.c.visao().as_array().unwrap().last().unwrap()["id"].as_u64().unwrap();
            (cliente, t["access_token"].as_str().unwrap().into(), t["refresh_token"].as_str().unwrap().into(), id)
        }
    }

    #[test]
    fn pkce_s256_confere() {
        assert_eq!(b64url(&sha256(VERIF.as_bytes())), DESAFIO);
        assert_eq!(hash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn desligado_recusa_tudo() {
        let t = T::novo();
        let (_, token, _, _) = t.entrar();
        assert_eq!(t.mcp(&token), 200);
        t.f.ligado.store(false, Ordering::Relaxed);
        for (m, p) in [("POST", "/mcp"), ("GET", "/.well-known/oauth-authorization-server"), ("POST", "/register"), ("GET", "/authorize"), ("POST", "/token")] {
            assert_eq!(t.ir(req(m, p, &[], "")).0.status, 503, "{p}");
        }
        assert_eq!(t.mcp(&token), 503, "token válido, interruptor desligado: nada");
        // ligado, mas sem túnel aberto (endereço desconhecido): também nada
        t.f.ligado.store(true, Ordering::Relaxed);
        t.f.tunel(None, None);
        assert_eq!(t.mcp(&token), 503);
    }

    #[test]
    fn sem_token_e_token_ruim_dao_401() {
        let t = T::novo();
        let (x, _) = t.ir(req("POST", "/mcp", &[], INIT));
        assert_eq!(x.status, 401);
        let www = &x.extra.iter().find(|(n, _)| *n == "WWW-Authenticate").unwrap().1;
        assert_eq!(www, &format!("Bearer resource_metadata=\"{BASE}/.well-known/oauth-protected-resource/mcp\""));
        assert_eq!(t.ir(req("GET", "/mcp", &[], "")).0.status, 401, "GET sem token também começa o login");
        assert_eq!(t.mcp("wla_inventado"), 401);
        assert_eq!(t.mcp(""), 401);
        // a chave local (wlk_) nunca entra por aqui, mesmo de uma conexão ativa
        let id = t.c.acao_teste_criar();
        let k = t.c.chave_teste(id);
        assert_eq!(t.mcp(&k), 401);
        // e o token de fora nunca entra pela porta local
        let (_, token, _, _) = t.entrar();
        assert_eq!(t.c.autentica(&token), None);
        // expirado: 401
        let t2 = T { agora: t.agora + VIDA_ACESSO, ..T::novo() };
        let (_, token2, _, _) = t2.entrar();
        assert_eq!(t2.mcp(&token2), 200);
        let t3 = T { f: t2.f, c: t2.c, agora: t2.agora + VIDA_ACESSO };
        assert_eq!(t3.mcp(&token2), 401, "token de 1 h vencido");
    }

    #[test]
    fn metadados_pedem_pkce_s256() {
        let t = T::novo();
        let (s, v) = t.json(req("GET", "/.well-known/oauth-protected-resource/mcp", &[], ""));
        assert_eq!((s, v["resource"].as_str(), v["authorization_servers"][0].as_str()), (200, Some(&*format!("{BASE}/mcp")), Some(BASE)));
        assert_eq!(t.json(req("GET", "/.well-known/oauth-protected-resource", &[], "")).0, 200);
        let (_, v) = t.json(req("GET", "/.well-known/oauth-authorization-server", &[], ""));
        assert_eq!(v["code_challenge_methods_supported"], json!(["S256"]));
        assert_eq!(v["registration_endpoint"], format!("{BASE}/register"));
        assert!(v.get("client_id_metadata_document_supported").is_none(), "sem CIMD: buscar URL de fora pediria TLS");
        assert_eq!(t.ir(req("GET", "/.well-known/openid-configuration", &[], "")).0.status, 404);
    }

    #[test]
    fn registro_so_com_retorno_https() {
        let t = T::novo();
        for ruim in [json!({"redirect_uris": ["http://evil.com/cb"]}), json!({"redirect_uris": []}), json!({"redirect_uris": ["https://x.com/a#b"]}), json!({})] {
            assert_eq!(t.json(req("POST", "/register", &[], &ruim.to_string())).0, 400, "{ruim}");
        }
        let v = t.registrar(RETORNO, "none");
        assert!(v["client_id"].as_str().unwrap().starts_with("wlcli_") && v.get("client_secret").is_none());
        assert_eq!(v["token_endpoint_auth_method"], "none");
        let (_, v) = t.json(req("POST", "/register", &[], r#"{"client_name":"<b>\u0007Gemini</b>","redirect_uris":["https://oauth-redirect.googleusercontent.com/r/x"],"token_endpoint_auth_method":"client_secret_post"}"#));
        assert!(v["client_secret"].as_str().unwrap().starts_with("wls_"));
        assert_eq!(v["client_name"], "<b>Gemini</b>", "sem caractere de controle; vira texto na caixa e na tela");
    }

    #[test]
    fn retorno_nao_registrado_e_pedido_ruim_recusam() {
        let t = T::novo();
        let cliente = t.registrar(RETORNO, "none")["client_id"].as_str().unwrap().to_string();
        // retorno diferente do registrado: página de erro, sem redirecionar e sem caixa no PC
        let (r, caixa) = t.autorizar(&cliente, "https://evil.com/cb", DESAFIO);
        assert_eq!((r.status, caixa.is_none()), (400, true));
        assert!(r.extra.iter().all(|(n, _)| *n != "Location"));
        // app desconhecido
        assert_eq!(t.autorizar("wlcli_inventado", RETORNO, DESAFIO).0.status, 400);
        // sem PKCE S256 / desafio curto
        assert_eq!(t.autorizar(&cliente, RETORNO, "curto").0.status, 400);
        let sem_s256 = format!("/authorize?response_type=code&client_id={cliente}&redirect_uri={}&code_challenge={DESAFIO}&code_challenge_method=plain", codifica(RETORNO));
        assert_eq!(t.ir(req("GET", &sem_s256, &[], "")).0.status, 400);
        // recurso de outro servidor; campo repetido
        let outro = format!("/authorize?response_type=code&client_id={cliente}&redirect_uri={}&code_challenge={DESAFIO}&code_challenge_method=S256&resource=https%3A%2F%2Fevil.com", codifica(RETORNO));
        assert_eq!(t.ir(req("GET", &outro, &[], "")).0.status, 400);
        let rep = format!("/authorize?response_type=code&client_id={cliente}&redirect_uri={}&redirect_uri=https%3A%2F%2Fevil.com&code_challenge={DESAFIO}&code_challenge_method=S256", codifica(RETORNO));
        assert_eq!(t.ir(req("GET", &rep, &[], "")).1, None);
        // o token também confere o retorno
        let codigo = t.codigo(&cliente, RETORNO);
        assert_eq!(t.trocar(&cliente, &codigo, "https://evil.com/cb", VERIF).1["error"], "invalid_grant");
    }

    #[test]
    fn pkce_errado_e_codigo_de_uso_unico() {
        let t = T::novo();
        let cliente = t.registrar(RETORNO, "none")["client_id"].as_str().unwrap().to_string();
        let codigo = t.codigo(&cliente, RETORNO);
        let (s, v) = t.trocar(&cliente, &codigo, RETORNO, &"x".repeat(43));
        assert_eq!((s, v["error"].as_str()), (400, Some("invalid_grant")), "verificador errado");
        assert_eq!(t.trocar(&cliente, &codigo, RETORNO, VERIF).1["error"], "invalid_grant", "o código queimou na tentativa errada");
        assert!(t.c.visao().as_array().unwrap().is_empty(), "nenhuma conexão criada");
        // certo: entra uma vez; a segunda troca do mesmo código é recusada
        let codigo = t.codigo(&cliente, RETORNO);
        assert_eq!(t.trocar(&cliente, &codigo, RETORNO, VERIF).0, 200);
        assert_eq!(t.trocar(&cliente, &codigo, RETORNO, VERIF).1["error"], "invalid_grant");
        // código de outro cliente
        let outro = t.registrar(RETORNO, "none")["client_id"].as_str().unwrap().to_string();
        let codigo = t.codigo(&cliente, RETORNO);
        assert_eq!(t.trocar(&outro, &codigo, RETORNO, VERIF).1["error"], "invalid_grant");
        // código vencido (5 min)
        let codigo = t.codigo(&cliente, RETORNO);
        let t2 = T { f: t.f, c: t.c, agora: t.agora + VIDA_CODIGO + 1 };
        assert_eq!(t2.trocar(&cliente, &codigo, RETORNO, VERIF).1["error"], "invalid_grant");
    }

    #[test]
    fn caixa_do_pc_decide() {
        let t = T::novo();
        let cliente = t.registrar(RETORNO, "none")["client_id"].as_str().unwrap().to_string();
        let (r, caixa) = t.autorizar(&cliente, RETORNO, DESAFIO);
        let (pedido, nome, numero, host) = caixa.unwrap();
        assert_eq!((nome.as_str(), host.as_str(), numero.len()), ("Claude", "claude.ai", 7));
        assert!(r.corpo.contains(&format!("<span>{}</span>", &numero[..1])) && numero.len() == 7 && r.corpo.contains("Confira este código no seu PC") && r.corpo.contains("http-equiv=\"refresh\""));
        // enquanto espera: a mesma página; outro pedido no meio tempo é recusado (um de cada vez)
        let espera = format!("/authorize/espera?p={pedido}");
        assert_eq!(t.ir(req("GET", &espera, &[], "")).0.status, 200);
        assert_eq!(t.autorizar(&cliente, RETORNO, DESAFIO).0.status, 429);
        // "Não": acesso negado, sem código
        t.f.decidir(&pedido, false, t.agora);
        let (r, _) = t.ir(req("GET", &espera, &[], ""));
        assert!(r.corpo.contains("Acesso negado no PC") && r.extra.iter().all(|(n, _)| *n != "Location"));
        t.f.decidir(&pedido, true, t.agora);
        assert!(t.ir(req("GET", &espera, &[], "")).0.corpo.contains("Acesso negado"), "depois do Não, o Sim não vale");
        // sem resposta em 2 min: negado (e um "Sim" atrasado não vale)
        let (_, caixa) = t.autorizar(&cliente, RETORNO, DESAFIO);
        let p2 = caixa.unwrap().0;
        let t2 = T { f: t.f, c: t.c, agora: t.agora + ESPERA_PC + 1 };
        t2.f.decidir(&p2, true, t2.agora);
        assert!(t2.ir(req("GET", &format!("/authorize/espera?p={p2}"), &[], "")).0.corpo.contains("Acesso negado"));
        // pedido inventado
        assert_eq!(t2.ir(req("GET", "/authorize/espera?p=wlp_x", &[], "")).0.status, 404);
        // o nome do app vira texto na página
        let (_, v) = t2.json(req("POST", "/register", &[], &json!({"client_name": "<script>x</script>", "redirect_uris": [RETORNO]}).to_string()));
        let (r, _) = t2.autorizar(v["client_id"].as_str().unwrap(), RETORNO, DESAFIO);
        assert!(!r.corpo.contains("<script>x") && r.corpo.contains("&lt;script&gt;"));
    }

    #[test]
    fn limite_de_tentativas() {
        let t = T::novo();
        let cliente = t.registrar(RETORNO, "none")["client_id"].as_str().unwrap().to_string();
        for _ in 0..PEDIDOS_MAX {
            let (r, caixa) = t.autorizar(&cliente, RETORNO, DESAFIO);
            assert_eq!(r.status, 200);
            t.f.decidir(&caixa.unwrap().0, false, t.agora);
        }
        let (r, caixa) = t.autorizar(&cliente, RETORNO, DESAFIO);
        assert_eq!((r.status, caixa.is_none()), (429, true), "6º pedido em 10 min: recusado sem abrir caixa");
        let t2 = T { f: t.f, c: t.c, agora: t.agora + JANELA };
        assert_eq!(t2.autorizar(&cliente, RETORNO, DESAFIO).0.status, 200, "passados 10 min, volta");
    }

    #[test]
    fn pausar_renovar_revogar() {
        let t = T::novo();
        let (cliente, token, refresh, id) = t.entrar();
        assert_eq!(t.mcp(&token), 200);
        let v = &t.c.visao()[0];
        assert_eq!((v["fora"].as_bool(), v["le"].as_bool(), v["escreve"].as_bool(), v["docs"].as_bool(), v["tipo"].as_str()), (Some(true), Some(true), Some(false), Some(false), Some("claude")), "começa só lendo");
        assert!(v["chave"].is_null() && v["conectar"].is_null() && v["retorno"] == "claude.ai");
        // a ferramenta chega com a conexão certa
        let (x, _) = t.ir(req("POST", "/mcp", &[("authorization", &format!("Bearer {token}"))], r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ler_mensagens","arguments":{}}}"#));
        assert!(x.corpo.contains(&format!("[\\\"ler_mensagens\\\",{id}]")), "{}", x.corpo);
        // pausada: recusa (403) com token válido; reativar volta
        t.c.acao_teste(id, "pausar");
        assert_eq!(t.mcp(&token), 403);
        t.c.acao_teste(id, "ativar");
        assert_eq!(t.mcp(&token), 200);
        // pausar uma não afeta a outra
        let (_, token_b, _, id_b) = t.entrar();
        t.c.acao_teste(id_b, "pausar");
        assert_eq!((t.mcp(&token), t.mcp(&token_b)), (200, 403));
        // refresh gira (Claude): o antigo deixa de valer, o token de acesso antigo também
        let (s, n) = t.renovar(&cliente, &refresh);
        assert_eq!(s, 200);
        let (token2, refresh2) = (n["access_token"].as_str().unwrap().to_string(), n["refresh_token"].as_str().unwrap().to_string());
        assert_ne!(refresh2, refresh);
        assert_eq!(t.renovar(&cliente, &refresh).1["error"], "invalid_grant");
        assert_eq!((t.mcp(&token), t.mcp(&token2)), (401, 200));
        // refresh de outro cliente não vale
        let (outro, _, _, _) = t.entrar();
        assert_eq!(t.renovar(&outro, &refresh2).1["error"], "invalid_grant");
        // renovar: tokens e refresh caem; a próxima autorização volta para a MESMA conexão
        t.c.acao_teste(id, "renovar");
        assert_eq!(t.mcp(&token2), 401);
        assert_eq!(t.renovar(&cliente, &refresh2).1["error"], "invalid_grant");
        let n_antes = t.c.visao().as_array().unwrap().len();
        let codigo = t.codigo(&cliente, RETORNO);
        let (_, v) = t.trocar(&cliente, &codigo, RETORNO, VERIF);
        assert_eq!((t.c.visao().as_array().unwrap().len(), t.mcp(v["access_token"].as_str().unwrap())), (n_antes, 200));
        // revogar: some e tudo cai; o refresh também
        let refresh3 = v["refresh_token"].as_str().unwrap().to_string();
        t.c.acao_teste(id, "revogar");
        assert_eq!(t.mcp(v["access_token"].as_str().unwrap()), 401);
        assert_eq!(t.renovar(&cliente, &refresh3).1["error"], "invalid_grant");
    }

    #[test]
    fn gemini_nao_gira_e_segredo_confere() {
        let t = T::novo();
        let g = "https://oauth-redirect.googleusercontent.com/r/projeto";
        let v = t.registrar(g, "client_secret_post");
        let (cliente, segredo) = (v["client_id"].as_str().unwrap().to_string(), v["client_secret"].as_str().unwrap().to_string());
        let codigo = t.codigo(&cliente, g);
        let corpo = |c: &str, s: &str| format!("grant_type=authorization_code&code={c}&redirect_uri={}&client_id={cliente}&code_verifier={VERIF}&client_secret={s}", codifica(g));
        assert_eq!(t.json(req("POST", "/token", &[], &corpo(&codigo, "errado"))).1["error"], "invalid_client");
        let codigo = t.codigo(&cliente, g);
        let (s, tok) = t.json(req("POST", "/token", &[], &corpo(&codigo, &segredo)));
        assert_eq!(s, 200, "{tok}");
        assert_eq!(t.c.visao()[0]["tipo"], "gemini");
        let refresh = tok["refresh_token"].as_str().unwrap();
        let rf = |s: &str| format!("grant_type=refresh_token&refresh_token={refresh}&client_id={cliente}&client_secret={s}");
        assert_eq!(t.json(req("POST", "/token", &[], &rf("errado"))).1["error"], "invalid_client");
        let (_, n) = t.json(req("POST", "/token", &[], &rf(&segredo)));
        assert_eq!(n["refresh_token"], refresh, "Gemini: o mesmo refresh");
        assert_eq!(t.json(req("POST", "/token", &[], &rf(&segredo))).0, 200, "e continua valendo");
        // segredo pelo cabeçalho Basic
        let basic = format!("Basic {}", crate::documento::para_base64(format!("{cliente}:{segredo}").as_bytes()));
        let (s, _) = t.json(req("POST", "/token", &[("authorization", &basic)], &format!("grant_type=refresh_token&refresh_token={refresh}")));
        assert_eq!(s, 200);
    }

    #[test]
    fn arquivo_so_guarda_hash() {
        let dir = std::env::temp_dir().join(format!("wl-teste-fora-hash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let t = T { c: Conexoes::load(Some(dir.clone()), None).0, ..T::novo() };
        let (cliente, token, refresh, _) = t.entrar();
        let arquivo = std::fs::read_to_string(dir.join("mcp-conexoes.json")).unwrap();
        assert!(arquivo.contains(&cliente) && arquivo.contains(&hash(&refresh)));
        assert!(!arquivo.contains(&refresh) && !arquivo.contains(&token), "nunca o token");
        // reabrir o app: o refresh guardado (hash) continua valendo
        let t2 = T { f: ligado(), c: Conexoes::load(Some(dir.clone()), None).0, agora: t.agora };
        assert_eq!(t2.mcp(&token), 401, "token de acesso só na memória");
        assert_eq!(t2.renovar(&cliente, &refresh).0, 200);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn utilidades() {
        assert_eq!(decodifica("a%20b+c%2Fd%zz%"), "a b c/d%zz%");
        assert_eq!(decodifica("%C3%A9"), "é");
        assert_eq!(codifica("a b/é"), "a%20b%2F%C3%A9");
        assert_eq!(host_de("https://User@Claude.AI:443/x?y"), "claude.ai:443");
        assert_eq!(tipo_de("https://claude.com/api/mcp/auth_callback"), "claude");
        assert_eq!(tipo_de("https://evilclaude.ai/x"), "outro");
        assert!(recurso_ok(&format!("{BASE}/mcp/"), BASE) && recurso_ok(&BASE.to_uppercase(), BASE) && recurso_ok("https://pc.tail0.ts.net:443/mcp", BASE));
        assert!(!recurso_ok("https://pc.tail0.ts.net:8443/mcp", BASE) && !recurso_ok("https://outro.ts.net/mcp", BASE));
    }

    #[test]
    fn trava_da_porta_443() {
        // como `tailscale serve status --json` deste PC antes da troca: o serve do GaIA na 443
        let gaia = json!({"TCP": {"443": {"HTTPS": true}}, "Web": {"pc.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:8000"}}}}});
        assert_eq!(alheio(&gaia).as_deref(), Some("/ → http://127.0.0.1:8000"), "recusa abrir");
        // GaIA na 8443 (só tailnet): a 443 livre
        let livre = json!({"TCP": {"8443": {"HTTPS": true}}, "Web": {"pc.ts.net:8443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:8000"}}}}});
        assert_eq!((alheio(&livre), handlers(&livre).len()), (None, 0), "abre; e fechar não mexe em nada");
        assert!(alheio(&json!({})).is_none());
        // só o nosso: fecha; nosso + outro caminho ou TCP na mesma porta: não abre e não fecha
        let nosso = json!({"Web": {"pc.ts.net:443": {"Handlers": {"/": {"Proxy": DESTINO}}}}});
        assert_eq!((alheio(&nosso), handlers(&nosso).len()), (None, 1));
        let misto = json!({"Web": {"pc.ts.net:443": {"Handlers": {"/": {"Proxy": DESTINO}, "/x": {"Path": "C:\\site"}}}}});
        assert_eq!(alheio(&misto).as_deref(), Some("/x → C:\\site"));
        let tcp = json!({"TCP": {"443": {"TCPForward": "127.0.0.1:22"}}});
        assert!(alheio(&tcp).is_some());
    }
}
