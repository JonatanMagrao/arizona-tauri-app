mod protocol;
mod ws;

use std::{
    fs,
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread,
};

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::license::LicenseStatus;

pub use protocol::{BridgeStatus, SESSION_FILE_NAME};

use self::protocol::{
    ack, blocked, command as command_message, encode, error, is_allowed_command, license_status,
    parse_client_message, server_hello, BridgeSessionFile, ClientHello, ConnectedClient,
    PROTOCOL_VERSION,
};

#[derive(Clone)]
pub struct CepBridgeState {
    inner: Arc<Mutex<BridgeInner>>,
}

struct BridgeInner {
    bridge_id: String,
    token: String,
    endpoint: Option<String>,
    port: Option<u16>,
    session_file_path: Option<PathBuf>,
    started_at: Option<String>,
    client: Option<ConnectedClient>,
    client_tx: Option<Sender<String>>,
    license: LicenseStatus,
    next_seq: u64,
    last_error: Option<String>,
}

impl CepBridgeState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(BridgeInner {
                bridge_id: random_hex(16),
                token: random_hex(32),
                endpoint: None,
                port: None,
                session_file_path: None,
                started_at: None,
                client: None,
                client_tx: None,
                license: LicenseStatus::no_session(),
                next_seq: 1,
                last_error: None,
            })),
        }
    }

    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        if self.status().running {
            return Ok(());
        }

        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|err| format!("Nao foi possivel abrir o bridge CEP: {err}"))?;
        let port = listener.local_addr().map_err(|err| err.to_string())?.port();
        let endpoint = format!("ws://127.0.0.1:{port}/cep");
        let token = self.token();
        let started_at = now_iso();
        let session_file_path = session_file_path(&app)?;
        let session_file = BridgeSessionFile {
            protocol_version: PROTOCOL_VERSION.to_string(),
            endpoint: endpoint.clone(),
            ws_url: format!("{endpoint}?token={token}"),
            port,
            token,
            started_at: started_at.clone(),
        };

        write_session_file(&session_file_path, &session_file)?;

        {
            let mut inner = self.lock_inner();
            inner.endpoint = Some(endpoint);
            inner.port = Some(port);
            inner.session_file_path = Some(session_file_path);
            inner.started_at = Some(started_at);
            inner.last_error = None;
        }

        let state = self.clone();
        thread::spawn(move || accept_loop(listener, state));
        Ok(())
    }

    pub fn status(&self) -> BridgeStatus {
        let inner = self.lock_inner();
        BridgeStatus {
            running: inner.port.is_some(),
            protocol_version: PROTOCOL_VERSION.to_string(),
            endpoint: inner.endpoint.clone(),
            port: inner.port,
            session_file_path: inner.session_file_path.clone(),
            started_at: inner.started_at.clone(),
            connected_client: inner.client.clone(),
            license: inner.license.clone(),
            last_error: inner.last_error.clone(),
        }
    }

    pub fn set_license_status(&self, license: LicenseStatus) {
        let message = {
            let mut inner = self.lock_inner();
            inner.license = license.clone();
            let seq = inner.next_seq();
            encode(if license.licensed {
                license_status(seq, license)
            } else {
                blocked(seq, license.reason.clone(), license)
            })
            .ok()
        };

        if let Some(message) = message {
            self.send_to_client(message);
        }
    }

    pub fn set_last_error(&self, error: impl Into<String>) {
        self.lock_inner().last_error = Some(error.into());
    }

    pub fn send_command(&self, command: &str, args: Value) -> Result<String, String> {
        let command = command.trim();
        if !is_allowed_command(command) {
            return Err(format!("Comando CEP nao permitido: {command}"));
        }

        let (tx, message, command_id) = {
            let mut inner = self.lock_inner();
            if !inner.license.licensed {
                return Err(format!("Licenca bloqueada: {}", inner.license.reason));
            }

            let Some(tx) = inner.client_tx.clone() else {
                return Err("Nenhum painel CEP conectado.".to_string());
            };

            let seq = inner.next_seq();
            let command_id = format!("cmd_{seq}");
            let message = encode(command_message(seq, command_id.clone(), command, args))?;
            (tx, message, command_id)
        };

        tx.send(message)
            .map_err(|_| "Nao foi possivel enviar comando ao painel CEP.".to_string())?;
        Ok(command_id)
    }

    fn token(&self) -> String {
        self.lock_inner().token.clone()
    }

    fn next_seq(&self) -> u64 {
        self.lock_inner().next_seq()
    }

    pub fn license(&self) -> LicenseStatus {
        self.lock_inner().license.clone()
    }

    fn attach_client(&self, client_id: String, tx: Sender<String>) {
        let now = now_iso();
        let mut inner = self.lock_inner();
        inner.client = Some(ConnectedClient {
            id: client_id,
            name: None,
            version: None,
            connected_at: now.clone(),
            last_seen_at: now,
        });
        inner.client_tx = Some(tx);
        inner.last_error = None;
    }

    fn update_client_hello(&self, hello: Option<ClientHello>) {
        let mut inner = self.lock_inner();
        if let Some(client) = inner.client.as_mut() {
            if let Some(hello) = hello {
                client.name = hello.name;
                client.version = hello.version;
            }
            client.last_seen_at = now_iso();
        }
    }

    fn touch_client(&self) {
        let mut inner = self.lock_inner();
        if let Some(client) = inner.client.as_mut() {
            client.last_seen_at = now_iso();
        }
    }

    fn detach_client(&self, client_id: &str) {
        let mut inner = self.lock_inner();
        if inner.client.as_ref().map(|client| client.id.as_str()) == Some(client_id) {
            inner.client = None;
            inner.client_tx = None;
        }
    }

    fn send_to_client(&self, message: String) {
        let tx = self.lock_inner().client_tx.clone();
        if let Some(tx) = tx {
            let _ = tx.send(message);
        }
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, BridgeInner> {
        self.inner.lock().unwrap_or_else(|err| err.into_inner())
    }
}

impl BridgeInner {
    fn next_seq(&mut self) -> u64 {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        seq
    }
}

fn accept_loop(listener: TcpListener, state: CepBridgeState) {
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = state.clone();
                thread::spawn(move || handle_client(stream, state));
            }
            Err(err) => state.set_last_error(format!("Erro no bridge CEP: {err}")),
        }
    }
}

fn handle_client(mut stream: TcpStream, state: CepBridgeState) {
    let expected_token = state.token();
    if let Err(err) = ws::accept(&mut stream, &expected_token) {
        state.set_last_error(format!("Handshake CEP recusado: {err}"));
        return;
    }

    let client_id = random_hex(12);
    let (tx, rx) = mpsc::channel::<String>();
    state.attach_client(client_id.clone(), tx.clone());

    let mut writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(err) => {
            state.set_last_error(format!("Nao foi possivel clonar conexao CEP: {err}"));
            state.detach_client(&client_id);
            return;
        }
    };

    let writer_state = state.clone();
    let writer_client_id = client_id.clone();
    thread::spawn(move || {
        for message in rx {
            if ws::write_text(&mut writer, &message).is_err() {
                break;
            }
        }
        writer_state.detach_client(&writer_client_id);
    });

    send_initial_messages(&state, &tx);

    loop {
        match ws::read_message(&mut stream) {
            Ok(ws::WsMessage::Text(text)) => handle_client_text(&state, &tx, &text),
            Ok(ws::WsMessage::Ping(payload)) => {
                let _ = ws::write_pong(&mut stream, &payload);
            }
            Ok(ws::WsMessage::Pong) => state.touch_client(),
            Ok(ws::WsMessage::Close) => {
                let _ = ws::write_close(&mut stream);
                break;
            }
            Err(err) => {
                state.set_last_error(format!("Conexao CEP encerrada: {err}"));
                break;
            }
        }
    }

    state.detach_client(&client_id);
}

fn send_initial_messages(state: &CepBridgeState, tx: &Sender<String>) {
    let (bridge_id, seq) = {
        let mut inner = state.lock_inner();
        (inner.bridge_id.clone(), inner.next_seq())
    };
    let hello = encode(server_hello(&bridge_id, seq));
    if let Ok(message) = hello {
        let _ = tx.send(message);
    }

    let license = state.license();
    let status = if license.licensed {
        license_status(state.next_seq(), license)
    } else {
        blocked(state.next_seq(), license.reason.clone(), license)
    };

    if let Ok(message) = encode(status) {
        let _ = tx.send(message);
    }
}

fn handle_client_text(state: &CepBridgeState, tx: &Sender<String>, text: &str) {
    let message = match parse_client_message(text) {
        Ok(message) => message,
        Err(err) => {
            send_error(state, tx, None, "invalid_json", err);
            return;
        }
    };

    state.touch_client();

    if message.protocol_version.as_deref() != Some(PROTOCOL_VERSION) {
        send_error(
            state,
            tx,
            message.id,
            "protocol_mismatch",
            "Versao do protocolo CEP incompativel.",
        );
        return;
    }

    match message.message_type.as_str() {
        "cep.hello" => {
            state.update_client_hello(message.client);
            let license = state.license();
            let value = if license.licensed {
                license_status(state.next_seq(), license)
            } else {
                blocked(state.next_seq(), license.reason.clone(), license)
            };
            if let Ok(message) = encode(value) {
                let _ = tx.send(message);
            }
        }
        "ae.result" => {
            let _ = message.result;
            let _ = message.error;
            send_ack(state, tx, message.id, "ae.result");
        }
        "cep.event" => handle_cep_event(state, tx, message.id, message.event, message.payload),
        "cep.ping" => {
            let value = json!({
                "type": "cep.pong",
                "protocolVersion": PROTOCOL_VERSION,
                "seq": state.next_seq()
            });
            if let Ok(message) = encode(value) {
                let _ = tx.send(message);
            }
        }
        other => send_error(
            state,
            tx,
            message.id,
            "unsupported_message",
            format!("Mensagem CEP nao suportada: {other}"),
        ),
    }
}

fn handle_cep_event(
    state: &CepBridgeState,
    tx: &Sender<String>,
    id: Option<String>,
    event: Option<String>,
    payload: Option<Value>,
) {
    let event_name = event.as_deref().unwrap_or_default();

    if event_name != "shortcut" {
        send_ack(state, tx, id, "cep.event");
        return;
    }

    let shortcut = payload
        .as_ref()
        .and_then(|value| value.get("shortcut"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();

    if shortcut != "ctrl+shift+alt+a" {
        send_ack(state, tx, id, "cep.event");
        return;
    }

    send_ack(state, tx, id, "cep.event");
    send_bridge_command(
        state,
        tx,
        "show_alert",
        json!({
            "message": "ponte feita"
        }),
    );
}

fn send_bridge_command(state: &CepBridgeState, tx: &Sender<String>, command: &str, args: Value) {
    let message = {
        let mut inner = state.lock_inner();
        if !inner.license.licensed || !is_allowed_command(command) {
            return;
        }

        let seq = inner.next_seq();
        encode(command_message(seq, format!("cmd_{seq}"), command, args))
    };

    if let Ok(message) = message {
        let _ = tx.send(message);
    }
}

fn send_ack(state: &CepBridgeState, tx: &Sender<String>, id: Option<String>, message_type: &str) {
    if let Ok(message) = encode(ack(state.next_seq(), id, message_type)) {
        let _ = tx.send(message);
    }
}

fn send_error(
    state: &CepBridgeState,
    tx: &Sender<String>,
    id: Option<String>,
    code: &str,
    message: impl Into<String>,
) {
    if let Ok(message) = encode(error(state.next_seq(), id, code, message)) {
        let _ = tx.send(message);
    }
}

fn session_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join(SESSION_FILE_NAME))
}

fn write_session_file(path: &PathBuf, file: &BridgeSessionFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Nao foi possivel criar {}: {err}", parent.display()))?;
    }

    let text = serde_json::to_string_pretty(file).map_err(|err| err.to_string())?;
    fs::write(path, text)
        .map_err(|err| format!("Nao foi possivel salvar {}: {err}", path.display()))
}

fn random_hex(byte_count: usize) -> String {
    let mut bytes = vec![0u8; byte_count];
    for chunk in bytes.chunks_mut(32) {
        let random: [u8; 32] = rand::random();
        let len = chunk.len();
        chunk.copy_from_slice(&random[..len]);
    }

    bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
