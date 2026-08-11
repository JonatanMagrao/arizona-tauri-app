use chrono::{Duration, Local, NaiveDate, SecondsFormat, Utc};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc::{self, sync_channel, SyncSender, TrySendError},
    Mutex, OnceLock,
};
use std::thread;
use std::time::Duration as StdDuration;
use tauri::{AppHandle, Manager, State};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

pub const RETENTION_DAYS: i64 = 14;
const CONFIG_FILE_NAME: &str = "diagnostics-config.json";
const DEFAULT_DIRECTORY_NAME: &str = "logs";
const TAURI_LOG_PREFIX: &str = "arizona-tauri-";
const CEP_LOG_PREFIX: &str = "arizona-cep-";
const LOG_SUFFIX: &str = ".jsonl";
const MAX_BREADCRUMBS: usize = 30;
const ERROR_TRAIL_SIZE: usize = 12;
const MAX_TEXT_LENGTH: usize = 1_200;
const WRITER_QUEUE_CAPACITY: usize = 512;
const WRITER_FLUSH_TIMEOUT_SECONDS: u64 = 2;
static NEXT_PROBE_ID: AtomicU64 = AtomicU64::new(1);

pub struct DiagnosticsState {
    writer: Mutex<Option<SyncSender<WriterMessage>>>,
    io_lock: Mutex<()>,
    breadcrumbs: Mutex<VecDeque<Breadcrumb>>,
    last_cleanup: Mutex<Vec<(PathBuf, NaiveDate)>>,
    next_event_id: AtomicU64,
    session_id: String,
}

impl DiagnosticsState {
    pub fn new() -> Self {
        Self {
            writer: Mutex::new(None),
            io_lock: Mutex::new(()),
            breadcrumbs: Mutex::new(VecDeque::with_capacity(MAX_BREADCRUMBS)),
            last_cleanup: Mutex::new(Vec::new()),
            next_event_id: AtomicU64::new(1),
            session_id: format!("{}-{}", std::process::id(), Utc::now().timestamp_millis()),
        }
    }

    fn start_writer(&self, app: AppHandle) -> Result<(), String> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "Não foi possível iniciar a fila de diagnósticos.".to_string())?;
        if writer.is_some() {
            return Ok(());
        }

        let (sender, receiver) = sync_channel(WRITER_QUEUE_CAPACITY);
        thread::Builder::new()
            .name("arizona-diagnostics".to_string())
            .spawn(move || {
                while let Ok(message) = receiver.recv() {
                    match message {
                        WriterMessage::Event(event) => {
                            let state = app.state::<DiagnosticsState>();
                            if let Err(error) = record_event(&app, &state, event) {
                                eprintln!(
                                    "Falha ao gravar diagnóstico local: {}",
                                    redact_text(&error)
                                );
                            }
                        }
                        WriterMessage::Flush(completed) => {
                            let _ = completed.send(());
                        }
                    }
                }
            })
            .map_err(|error| format!("Não foi possível iniciar o diagnóstico local: {error}"))?;
        *writer = Some(sender);
        Ok(())
    }

    fn enqueue(&self, event: DiagnosticEvent) -> Result<(), String> {
        let sender = self
            .writer
            .lock()
            .map_err(|_| "A fila de diagnósticos não está disponível.".to_string())?
            .clone()
            .ok_or_else(|| "O diagnóstico local ainda não foi iniciado.".to_string())?;
        sender
            .try_send(WriterMessage::Event(event))
            .map_err(|error| match error {
                TrySendError::Full(_) => {
                    "A fila de diagnósticos atingiu o limite temporário.".to_string()
                }
                TrySendError::Disconnected(_) => {
                    "A gravação de diagnósticos foi encerrada.".to_string()
                }
            })
    }

    fn flush_writer(&self) -> Result<(), String> {
        let sender = self
            .writer
            .lock()
            .map_err(|_| "A fila de diagnósticos não está disponível.".to_string())?
            .clone()
            .ok_or_else(|| "O diagnóstico local ainda não foi iniciado.".to_string())?;
        let (completed, receiver) = mpsc::channel();
        sender
            .try_send(WriterMessage::Flush(completed))
            .map_err(|error| match error {
                TrySendError::Full(_) => {
                    "Há muitos diagnósticos pendentes; aguarde um instante e tente novamente."
                        .to_string()
                }
                TrySendError::Disconnected(_) => {
                    "A gravação de diagnósticos foi encerrada.".to_string()
                }
            })?;
        receiver
            .recv_timeout(StdDuration::from_secs(WRITER_FLUSH_TIMEOUT_SECONDS))
            .map_err(|_| {
                "A pasta de diagnósticos demorou para responder; tente novamente.".to_string()
            })
    }
}

enum WriterMessage {
    Event(DiagnosticEvent),
    Flush(mpsc::Sender<()>),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDiagnosticEvent {
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub component: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub status: String,
    pub code: Option<String>,
    #[serde(default)]
    pub message: String,
    pub details: Option<Value>,
}

#[derive(Clone, Debug)]
pub struct DiagnosticEvent {
    pub timestamp: String,
    pub local_date: NaiveDate,
    pub source: String,
    pub level: String,
    pub component: String,
    pub action: String,
    pub status: String,
    pub code: Option<String>,
    pub message: String,
    pub details: Option<Value>,
}

impl From<ClientDiagnosticEvent> for DiagnosticEvent {
    fn from(event: ClientDiagnosticEvent) -> Self {
        Self {
            timestamp: diagnostic_timestamp(),
            local_date: Local::now().date_naive(),
            source: event.source,
            level: event.level,
            component: event.component,
            action: event.action,
            status: event.status,
            code: event.code,
            message: event.message,
            details: event.details,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Breadcrumb {
    timestamp: String,
    component: String,
    action: String,
    status: String,
    message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsConfig {
    schema_version: u8,
    directory: Option<String>,
}

impl Default for DiagnosticsConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            directory: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsStatus {
    directory: String,
    active_directory: String,
    default_directory: String,
    is_custom: bool,
    using_fallback: bool,
    retention_days: i64,
    file_count: usize,
    total_size_bytes: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    moved_files: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportResult {
    path: String,
    file_count: usize,
}

pub fn initialize(app: &AppHandle) {
    let state = app.state::<DiagnosticsState>();
    if let Err(error) = state.start_writer(app.clone()) {
        eprintln!(
            "Falha ao iniciar diagnóstico local: {}",
            redact_text(&error)
        );
        return;
    }
    info(
        app,
        "aplicativo",
        "inicializacao",
        "ready",
        "Arizona App iniciado; diagnóstico local disponível.",
        Some(json!({
            "appVersion": app.package_info().version.to_string(),
            "retentionDays": RETENTION_DAYS,
        })),
    );
}

pub fn flush(app: &AppHandle) -> Result<(), String> {
    app.state::<DiagnosticsState>().flush_writer()
}

pub fn info(
    app: &AppHandle,
    component: &str,
    action: &str,
    status: &str,
    message: &str,
    details: Option<Value>,
) {
    record_internal(
        app,
        DiagnosticEvent {
            timestamp: diagnostic_timestamp(),
            local_date: Local::now().date_naive(),
            source: "tauri-core".to_string(),
            level: "info".to_string(),
            component: component.to_string(),
            action: action.to_string(),
            status: status.to_string(),
            code: None,
            message: message.to_string(),
            details,
        },
    );
}

pub fn warning(
    app: &AppHandle,
    component: &str,
    action: &str,
    status: &str,
    code: &str,
    message: &str,
    details: Option<Value>,
) {
    record_internal(
        app,
        DiagnosticEvent {
            timestamp: diagnostic_timestamp(),
            local_date: Local::now().date_naive(),
            source: "tauri-core".to_string(),
            level: "warning".to_string(),
            component: component.to_string(),
            action: action.to_string(),
            status: status.to_string(),
            code: Some(code.to_string()),
            message: message.to_string(),
            details,
        },
    );
}

pub fn error(
    app: &AppHandle,
    component: &str,
    action: &str,
    code: &str,
    message: &str,
    details: Option<Value>,
) {
    record_internal(
        app,
        DiagnosticEvent {
            timestamp: diagnostic_timestamp(),
            local_date: Local::now().date_naive(),
            source: "tauri-core".to_string(),
            level: "error".to_string(),
            component: component.to_string(),
            action: action.to_string(),
            status: "failed".to_string(),
            code: Some(code.to_string()),
            message: message.to_string(),
            details,
        },
    );
}

fn record_internal(app: &AppHandle, event: DiagnosticEvent) {
    let state = app.state::<DiagnosticsState>();
    if let Err(error) = state.enqueue(event) {
        eprintln!("Falha ao gravar diagnóstico local: {error}");
    }
}

#[tauri::command]
pub fn diagnostics_record_event(
    state: State<DiagnosticsState>,
    event: ClientDiagnosticEvent,
) -> Result<(), String> {
    state.enqueue(event.into())
}

#[tauri::command]
pub fn diagnostics_status(app: AppHandle) -> Result<DiagnosticsStatus, String> {
    build_status(&app, Vec::new(), None)
}

#[tauri::command]
pub fn diagnostics_set_directory(
    app: AppHandle,
    state: State<DiagnosticsState>,
    directory: Option<String>,
) -> Result<DiagnosticsStatus, String> {
    state.flush_writer()?;
    let default_directory = default_directory(&app)?;
    let requested = directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let target = requested
        .clone()
        .unwrap_or_else(|| default_directory.clone());
    if !target.is_absolute() {
        return Err("Selecione uma pasta completa para os diagnósticos.".to_string());
    }

    prepare_writable_directory(&target)
        .map_err(|error| format!("Não foi possível usar a pasta escolhida: {error}"))?;

    let _guard = state
        .io_lock
        .lock()
        .map_err(|_| "Não foi possível coordenar a mudança da pasta de logs.".to_string())?;
    let previous = configured_directory(&app)?;
    let is_default = paths_equal(&target, &default_directory);
    let default_has_residual_logs = !paths_equal(&default_directory, &target)
        && owned_log_files(&default_directory)
            .map(|files| !files.is_empty())
            .unwrap_or(false);
    let migration_needed = !paths_equal(&previous, &target) || default_has_residual_logs;
    if migration_needed {
        match crate::after_effects::is_after_effects_running() {
            Ok(true) => {
                return Err(
                    "Feche o After Effects antes de mover os diagnósticos para outra pasta."
                        .to_string(),
                );
            }
            Err(_) => {
                return Err(
                    "Não foi possível confirmar se o After Effects está fechado; tente novamente após fechá-lo."
                        .to_string(),
                );
            }
            Ok(false) => {}
        }
    }
    write_config(
        &app,
        &DiagnosticsConfig {
            schema_version: 1,
            directory: if is_default {
                None
            } else {
                Some(target.to_string_lossy().into_owned())
            },
        },
    )?;

    let mut moved_files = 0;
    let mut warnings = Vec::new();
    let mut migration_sources = Vec::new();
    if !paths_equal(&previous, &target) {
        migration_sources.push(previous.clone());
    }
    if default_has_residual_logs
        && !migration_sources
            .iter()
            .any(|source| paths_equal(source, &default_directory))
    {
        migration_sources.push(default_directory.clone());
    }
    for source in migration_sources {
        let (source_moved_files, source_warnings) = move_owned_logs(&source, &target);
        moved_files += source_moved_files;
        warnings.extend(source_warnings);
    }
    if let Err(error) = cleanup_directory(&target, Local::now().date_naive()) {
        warnings.push(error);
    }
    drop(_guard);

    info(
        &app,
        "diagnosticos",
        "alterar_pasta",
        "completed",
        if is_default {
            "Pasta padrão dos diagnósticos restaurada."
        } else {
            "Pasta dos diagnósticos alterada."
        },
        Some(json!({
            "movedFiles": moved_files,
            "warningCount": warnings.len(),
        })),
    );

    build_status(&app, warnings, Some(moved_files))
}

#[tauri::command]
pub fn diagnostics_open_directory(app: AppHandle) -> Result<(), String> {
    let (_, directory, _) = resolve_active_directory(&app)?;
    open_directory(&directory)
}

#[tauri::command]
pub fn diagnostics_export(
    app: AppHandle,
    state: State<DiagnosticsState>,
    destination: String,
) -> Result<DiagnosticsExportResult, String> {
    let mut destination = PathBuf::from(destination.trim());
    if destination.as_os_str().is_empty() {
        return Err("Escolha onde salvar o diagnóstico.".to_string());
    }
    if !destination.is_absolute() {
        return Err("Escolha um destino completo para o diagnóstico.".to_string());
    }
    if is_network_path(&destination) {
        return Err(
            "Escolha uma pasta local para exportar o diagnóstico; caminhos de rede não são aceitos."
                .to_string(),
        );
    }
    if !destination
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        destination.set_extension("zip");
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Não foi possível preparar o destino: {error}"))?;
    }

    state.flush_writer()?;
    let _guard = state
        .io_lock
        .lock()
        .map_err(|_| "Não foi possível coordenar a exportação dos diagnósticos.".to_string())?;
    let (configured_directory, active_directory, _) = resolve_active_directory(&app)?;
    let default_directory = default_directory(&app)?;
    let log_directories = unique_directories([
        active_directory.clone(),
        configured_directory,
        default_directory,
    ]);
    let mut log_files = Vec::new();
    let today = Local::now().date_naive();
    let mut residual_index = 0;
    for log_directory in &log_directories {
        cleanup_directory(log_directory, today)?;
        let archive_prefix = if paths_equal(log_directory, &active_directory) {
            "logs".to_string()
        } else {
            residual_index += 1;
            format!("logs/residual-{residual_index}")
        };
        for path in owned_log_files(log_directory)? {
            let Some(name) = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string)
            else {
                continue;
            };
            log_files.push((path, format!("{archive_prefix}/{name}")));
        }
    }
    let temporary = destination.with_extension(format!(
        "zip.arizona-export-{}-{}.tmp",
        std::process::id(),
        NEXT_PROBE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let write_result = (|| -> Result<(), String> {
        let archive_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("Não foi possível criar o pacote temporário: {error}"))?;
        let mut archive = ZipWriter::new(archive_file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);

        let summary = serde_json::to_vec_pretty(&json!({
            "schemaVersion": 1,
            "generatedAt": Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            "appVersion": app.package_info().version.to_string(),
            "platform": std::env::consts::OS,
            "architecture": std::env::consts::ARCH,
            "retentionDays": RETENTION_DAYS,
            "logFileCount": log_files.len(),
            "privacy": "O pacote contém apenas diagnósticos locais sanitizados; não inclui sessão de acesso, recibo ou código de ativação."
        }))
        .map_err(|error| error.to_string())?;
        archive
            .start_file("diagnostico.json", options)
            .map_err(|error| error.to_string())?;
        archive
            .write_all(&summary)
            .map_err(|error| error.to_string())?;

        for (path, archive_name) in &log_files {
            archive
                .start_file(archive_name, options)
                .map_err(|error| error.to_string())?;
            let mut source = File::open(path).map_err(|error| error.to_string())?;
            io::copy(&mut source, &mut archive).map_err(|error| error.to_string())?;
        }

        let archive_file = archive.finish().map_err(|error| error.to_string())?;
        archive_file.sync_all().map_err(|error| error.to_string())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Não foi possível concluir o pacote de diagnóstico: {error}"
        ));
    }
    if let Err(error) = replace_file(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Não foi possível salvar o pacote de diagnóstico: {error}"
        ));
    }
    drop(_guard);
    info(
        &app,
        "diagnosticos",
        "exportar",
        "completed",
        "Pacote de diagnóstico exportado.",
        Some(json!({ "fileCount": log_files.len() })),
    );

    Ok(DiagnosticsExportResult {
        path: destination.to_string_lossy().into_owned(),
        file_count: log_files.len(),
    })
}

fn record_event(
    app: &AppHandle,
    state: &DiagnosticsState,
    mut event: DiagnosticEvent,
) -> Result<(), String> {
    normalize_event(&mut event);
    let timestamp = event.timestamp.clone();
    let local_date = event.local_date;
    let include_trail = matches!(event.level.as_str(), "warning" | "error");
    let trail = if include_trail {
        state
            .breadcrumbs
            .lock()
            .ok()
            .map(|items| {
                items
                    .iter()
                    .rev()
                    .take(ERROR_TRAIL_SIZE)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut payload = Map::new();
    payload.insert("schemaVersion".to_string(), Value::Number(1.into()));
    payload.insert("timestamp".to_string(), Value::String(timestamp.clone()));
    payload.insert(
        "eventId".to_string(),
        Value::String(format!(
            "{}-{}",
            state.session_id,
            state.next_event_id.fetch_add(1, Ordering::Relaxed)
        )),
    );
    payload.insert(
        "sessionId".to_string(),
        Value::String(state.session_id.clone()),
    );
    payload.insert("level".to_string(), Value::String(event.level.clone()));
    payload.insert("source".to_string(), Value::String(event.source.clone()));
    payload.insert(
        "component".to_string(),
        Value::String(event.component.clone()),
    );
    payload.insert("action".to_string(), Value::String(event.action.clone()));
    payload.insert("status".to_string(), Value::String(event.status.clone()));
    if let Some(code) = event.code.clone() {
        payload.insert("code".to_string(), Value::String(code));
    }
    payload.insert("message".to_string(), Value::String(event.message.clone()));
    if let Some(details) = event.details.take() {
        payload.insert("details".to_string(), sanitize_value(details, 0));
    }
    if !trail.is_empty() {
        payload.insert(
            "recentActions".to_string(),
            serde_json::to_value(trail).unwrap_or_else(|_| Value::Array(Vec::new())),
        );
    }
    let line = serde_json::to_string(&Value::Object(payload)).map_err(|error| error.to_string())?;

    let _guard = state
        .io_lock
        .lock()
        .map_err(|_| "Não foi possível coordenar a gravação do diagnóstico.".to_string())?;
    append_line_with_fallback(app, state, local_date, &line)?;
    drop(_guard);

    if let Ok(mut breadcrumbs) = state.breadcrumbs.lock() {
        breadcrumbs.push_back(Breadcrumb {
            timestamp,
            component: event.component,
            action: event.action,
            status: event.status,
            message: event.message,
        });
        while breadcrumbs.len() > MAX_BREADCRUMBS {
            breadcrumbs.pop_front();
        }
    }
    Ok(())
}

fn diagnostic_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn normalize_event(event: &mut DiagnosticEvent) {
    event.level = match event.level.trim().to_ascii_lowercase().as_str() {
        "debug" => "debug",
        "warning" | "warn" => "warning",
        "error" => "error",
        _ => "info",
    }
    .to_string();
    event.source = safe_identifier(&event.source, "tauri-ui", 40);
    event.component = safe_identifier(&event.component, "aplicativo", 64);
    event.action = safe_identifier(&event.action, "acao_desconhecida", 96);
    event.status = safe_identifier(&event.status, "observed", 32);
    event.code = event
        .code
        .as_deref()
        .map(|value| safe_identifier(value, "unknown_error", 96));
    event.message = redact_text(&event.message);
    if event.message.is_empty() {
        event.message = "Evento técnico registrado.".to_string();
    }
}

fn safe_identifier(value: &str, fallback: &str, max_length: usize) -> String {
    let value = value.trim();
    let normalized = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | ':')
        })
        .take(max_length)
        .collect::<String>();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn sanitize_value(value: Value, depth: usize) -> Value {
    if depth >= 4 {
        return Value::String("<detalhe omitido>".to_string());
    }
    match value {
        Value::String(value) => Value::String(redact_text(&value)),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .take(20)
                .map(|value| sanitize_value(value, depth + 1))
                .collect(),
        ),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .take(32)
                .map(|(key, value)| {
                    let safe_key = safe_identifier(&key, "detail", 64);
                    let safe_value = if is_sensitive_detail_key(&safe_key) {
                        Value::String("<dado-removido>".to_string())
                    } else {
                        sanitize_value(value, depth + 1)
                    };
                    (safe_key, safe_value)
                })
                .collect(),
        ),
        other => other,
    }
}

fn is_sensitive_detail_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    normalized.contains("token")
        || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("apikey")
        || normalized.contains("credential")
        || normalized.contains("authorization")
        || normalized.contains("receipt")
        || normalized.contains("activationcode")
        || normalized.contains("email")
        || normalized.contains("fingerprint")
        || normalized.contains("installid")
        || normalized.contains("deviceid")
        || normalized.contains("memberid")
        || normalized.contains("organizationid")
        || normalized.contains("organizationname")
        || normalized.contains("sessionid")
        || normalized.contains("userid")
        || normalized.contains("accountid")
        || normalized.ends_with("path")
        || normalized.ends_with("directory")
}

fn redact_text(value: &str) -> String {
    let mut output = value.replace(['\r', '\n'], " ");
    output = quoted_path_regex()
        .replace_all(&output, "<caminho-local>")
        .into_owned();
    output = windows_path_regex()
        .replace_all(&output, "<caminho-local>")
        .into_owned();
    output = unc_path_regex()
        .replace_all(&output, "<caminho-local>")
        .into_owned();
    for (variable, placeholder) in [
        ("USERPROFILE", "%USERPROFILE%"),
        ("LOCALAPPDATA", "%LOCALAPPDATA%"),
        ("APPDATA", "%APPDATA%"),
        ("TEMP", "%TEMP%"),
        ("TMP", "%TMP%"),
    ] {
        if let Ok(path) = std::env::var(variable) {
            if !path.trim().is_empty() {
                output = replace_case_insensitive(&output, &path, placeholder);
                output = replace_case_insensitive(&output, &path.replace('\\', "/"), placeholder);
            }
        }
    }
    output = email_regex().replace_all(&output, "<email>").into_owned();
    output = quoted_secret_pair_regex()
        .replace_all(&output, "$1\"<segredo-removido>\"")
        .into_owned();
    output = bearer_regex()
        .replace_all(&output, "$1=<segredo-removido>")
        .into_owned();
    output = standalone_bearer_regex()
        .replace_all(&output, "bearer <segredo-removido>")
        .into_owned();
    output = jwt_regex()
        .replace_all(&output, "<token-removido>")
        .into_owned();
    output = activation_code_regex()
        .replace_all(&output, "<codigo-removido>")
        .into_owned();
    output = url_query_regex()
        .replace_all(&output, "$1?<parametros-removidos>")
        .into_owned();
    output.trim().chars().take(MAX_TEXT_LENGTH).collect()
}

fn email_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| Regex::new(r"(?i)\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b").unwrap())
}

fn bearer_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(
            r#"(?i)\b(authorization|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|credential)["']?\s*[:=]\s*["']?(?:bearer\s+)?[^\s,"'}]+"#,
        )
        .unwrap()
    })
}

fn quoted_secret_pair_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(
            r#"(?i)(["']?(?:authorization|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|credential)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')"#,
        )
        .unwrap()
    })
}

fn standalone_bearer_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| Regex::new(r#"(?i)\bbearer\s+["']?[^\s,"']+"#).unwrap())
}

fn jwt_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(r"\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}(?:\.[a-zA-Z0-9_-]{8,})?\b").unwrap()
    })
}

fn activation_code_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| Regex::new(r"\b[A-Z0-9]{4}(?:-?[A-Z0-9]{4}){2}\b").unwrap())
}

fn url_query_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| Regex::new(r"(?i)(https?://[^\s?]+)\?[^\s]+").unwrap())
}

fn quoted_path_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| Regex::new(r#"(?i)["'](?:[a-z]:[\\/]|\\\\)[^"'\r\n]+["']"#).unwrap())
}

fn windows_path_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| Regex::new(r"(?i)\b[a-z]:[\\/].*$").unwrap())
}

fn unc_path_regex() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| Regex::new(r"\\\\[^\s\\/]+[\\/].*$").unwrap())
}

fn replace_case_insensitive(value: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return value.to_string();
    }
    RegexBuilder::new(&regex::escape(needle))
        .case_insensitive(true)
        .build()
        .map(|pattern| pattern.replace_all(value, replacement).into_owned())
        .unwrap_or_else(|_| value.replace(needle, replacement))
}

fn maybe_cleanup_locked(
    state: &DiagnosticsState,
    directory: &Path,
    today: NaiveDate,
) -> Result<(), String> {
    let should_cleanup = state
        .last_cleanup
        .lock()
        .map(|last_cleanup| {
            if last_cleanup.iter().any(|(last_directory, last_date)| {
                paths_equal(last_directory, directory) && last_date == &today
            }) {
                false
            } else {
                true
            }
        })
        .unwrap_or(true);
    if should_cleanup {
        cleanup_directory(directory, today)?;
        if let Ok(mut last_cleanup) = state.last_cleanup.lock() {
            last_cleanup.retain(|(_, last_date)| last_date == &today);
            if !last_cleanup
                .iter()
                .any(|(last_directory, _)| paths_equal(last_directory, directory))
            {
                last_cleanup.push((directory.to_path_buf(), today));
            }
        }
    }
    Ok(())
}

fn cleanup_directory(directory: &Path, today: NaiveDate) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    let cutoff = today - Duration::days(RETENTION_DAYS - 1);
    let mut cleanup_failed = false;
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Não foi possível revisar os diagnósticos antigos: {error}"))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                cleanup_failed = true;
                continue;
            }
        };
        let path = entry.path();
        let Some(date) = retention_date(&path) else {
            continue;
        };
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => continue,
            Err(_) => {
                cleanup_failed = true;
                continue;
            }
        }
        if date < cutoff {
            if fs::remove_file(path).is_err() {
                cleanup_failed = true;
            }
        }
    }
    if cleanup_failed {
        Err(
            "Alguns diagnósticos vencidos não puderam ser apagados; a limpeza será tentada novamente."
                .to_string(),
        )
    } else {
        Ok(())
    }
}

fn log_date(path: &Path) -> Option<NaiveDate> {
    let name = path.file_name()?.to_str()?;
    let prefix = if name.starts_with(TAURI_LOG_PREFIX) {
        TAURI_LOG_PREFIX
    } else if name.starts_with(CEP_LOG_PREFIX) {
        CEP_LOG_PREFIX
    } else {
        return None;
    };
    let value = name.strip_prefix(prefix)?.strip_suffix(LOG_SUFFIX)?;
    let date = value.get(..10)?;
    let remainder = value.get(10..)?;
    if !remainder.is_empty() {
        let part = remainder.strip_prefix(".part-")?;
        if part.is_empty()
            || !part
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return None;
        }
    }
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn retention_date(path: &Path) -> Option<NaiveDate> {
    log_date(path).or_else(|| {
        let name = path.file_name()?.to_str()?;
        let without_tmp = name.strip_suffix(".tmp")?;
        let (log_name, migration_id) = without_tmp.rsplit_once(".arizona-move-")?;
        let (process_id, sequence_id) = migration_id.split_once('-')?;
        if process_id.is_empty()
            || sequence_id.is_empty()
            || !process_id
                .chars()
                .all(|character| character.is_ascii_digit())
            || !sequence_id
                .chars()
                .all(|character| character.is_ascii_digit())
        {
            return None;
        }
        log_date(Path::new(log_name))
    })
}

fn log_file_name(prefix: &str, date: NaiveDate) -> String {
    format!("{prefix}{}{LOG_SUFFIX}", date.format("%Y-%m-%d"))
}

fn build_status(
    app: &AppHandle,
    mut warnings: Vec<String>,
    moved_files: Option<usize>,
) -> Result<DiagnosticsStatus, String> {
    let (directory, active_directory, directory_warnings) = resolve_active_directory(app)?;
    warnings.extend(directory_warnings);
    let default_directory = default_directory(app)?;
    let log_directories = unique_directories([
        active_directory.clone(),
        directory.clone(),
        default_directory.clone(),
    ]);
    let today = Local::now().date_naive();
    let mut files = Vec::new();
    let mut residual_file_count = 0;
    for log_directory in &log_directories {
        if let Err(error) = cleanup_directory(log_directory, today) {
            warnings.push(error);
        }
        match owned_log_files(log_directory) {
            Ok(directory_files) => {
                if !paths_equal(log_directory, &active_directory) {
                    residual_file_count += directory_files.len();
                }
                files.extend(directory_files);
            }
            Err(_) => warnings
                .push("Uma pasta conhecida de diagnósticos não pôde ser revisada.".to_string()),
        }
    }
    if residual_file_count > 0 {
        warnings.push(format!(
            "Há {residual_file_count} arquivo(s) fora da pasta ativa; eles também serão incluídos na exportação."
        ));
    }
    let total_size_bytes = files
        .iter()
        .filter_map(|path| fs::metadata(path).ok())
        .map(|metadata| metadata.len())
        .sum();
    Ok(DiagnosticsStatus {
        directory: directory.to_string_lossy().into_owned(),
        active_directory: active_directory.to_string_lossy().into_owned(),
        default_directory: default_directory.to_string_lossy().into_owned(),
        is_custom: !paths_equal(&directory, &default_directory),
        using_fallback: !paths_equal(&directory, &active_directory),
        retention_days: RETENTION_DAYS,
        file_count: files.len(),
        total_size_bytes,
        warnings,
        moved_files,
    })
}

fn unique_directories<const N: usize>(directories: [PathBuf; N]) -> Vec<PathBuf> {
    let mut unique: Vec<PathBuf> = Vec::new();
    for directory in directories {
        if !unique
            .iter()
            .any(|existing| paths_equal(existing, &directory))
        {
            unique.push(directory);
        }
    }
    unique
}

fn owned_log_files(directory: &Path) -> Result<Vec<PathBuf>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Não foi possível listar os diagnósticos: {error}"))?
    {
        let entry =
            entry.map_err(|_| "Não foi possível revisar um arquivo de diagnóstico.".to_string())?;
        let path = entry.path();
        if log_date(&path).is_none() {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| "Não foi possível verificar um arquivo de diagnóstico.".to_string())?;
        if metadata.file_type().is_file() {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}

fn move_owned_logs(source: &Path, target: &Path) -> (usize, Vec<String>) {
    if !source.exists() {
        return (
            0,
            vec![
                "A pasta anterior não está disponível; nenhum arquivo foi removido dela."
                    .to_string(),
            ],
        );
    }
    let Ok(files) = owned_log_files(source) else {
        return (
            0,
            vec!["A pasta anterior não pôde ser lida; os novos registros já usarão a pasta escolhida.".to_string()],
        );
    };
    let mut moved = 0;
    let mut warnings = Vec::new();
    for source_path in files {
        let Some(name) = source_path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(date) = log_date(&source_path) else {
            continue;
        };
        let prefix = if name.starts_with(TAURI_LOG_PREFIX) {
            TAURI_LOG_PREFIX
        } else {
            CEP_LOG_PREFIX
        };
        let migration_name = format!(
            "{prefix}{}.part-{}-{}{LOG_SUFFIX}",
            date.format("%Y-%m-%d"),
            std::process::id(),
            NEXT_PROBE_ID.fetch_add(1, Ordering::Relaxed)
        );
        let staged_source = source.join(&migration_name);
        let destination = target.join(&migration_name);
        if let Err(_error) = fs::rename(&source_path, &staged_source) {
            warnings.push(format!("O arquivo {} permaneceu na pasta anterior.", name));
            continue;
        }
        match move_file_preserving_source_on_failure(&staged_source, &destination) {
            Ok(()) => moved += 1,
            Err(_) => warnings.push(format!(
                "O diagnóstico de {} permaneceu na pasta anterior.",
                name
            )),
        }
    }
    match owned_log_files(source) {
        Ok(remaining) if !remaining.is_empty() => warnings.push(format!(
            "Ainda há {} arquivo(s) de diagnóstico na pasta anterior; preserve-os manualmente se forem necessários.",
            remaining.len()
        )),
        Err(_) => warnings.push(
            "A pasta anterior não pôde ser conferida ao final da migração.".to_string(),
        ),
        _ => {}
    }
    (moved, warnings)
}

fn move_file_preserving_source_on_failure(source: &Path, destination: &Path) -> io::Result<()> {
    if paths_equal(source, destination) {
        return Ok(());
    }
    if destination.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "o arquivo de migração já existe",
        ));
    }
    match fs::rename(source, destination) {
        Ok(()) => return Ok(()),
        Err(error) if !is_cross_device_error(&error) => return Err(error),
        Err(_) => {}
    }

    let temporary = destination.with_extension(format!(
        "jsonl.arizona-move-{}-{}.tmp",
        std::process::id(),
        NEXT_PROBE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let copied = match fs::copy(source, &temporary) {
        Ok(copied) => copied,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    };
    if let Err(error) = File::open(&temporary).and_then(|file| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    let source_size = match fs::metadata(source) {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    };
    if source_size != copied {
        let _ = fs::remove_file(&temporary);
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "o log mudou durante a migração",
        ));
    }
    if let Err(error) = fs::rename(&temporary, destination) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(destination);
        return Err(error);
    }
    Ok(())
}

fn is_cross_device_error(error: &io::Error) -> bool {
    matches!(error.raw_os_error(), Some(17 | 18))
}

fn append_line_with_fallback(
    app: &AppHandle,
    state: &DiagnosticsState,
    today: NaiveDate,
    line: &str,
) -> Result<PathBuf, String> {
    let configured = configured_directory(app)?;
    let fallback = default_directory(app)?;
    let mut last_error = None;
    let mut directories = vec![configured.clone()];
    if !paths_equal(&configured, &fallback) {
        directories.push(fallback);
    }

    for directory in &directories {
        if directory.exists() {
            let _ = maybe_cleanup_locked(state, directory, today);
        }
    }

    for directory in directories {
        if fs::create_dir_all(&directory).is_err() || !directory.is_dir() {
            last_error = Some("a pasta não está disponível".to_string());
            continue;
        }
        let path = directory.join(log_file_name(TAURI_LOG_PREFIX, today));
        match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(mut file) => match writeln!(file, "{line}") {
                Ok(()) => return Ok(directory),
                Err(error) => last_error = Some(redact_text(&error.to_string())),
            },
            Err(error) => last_error = Some(redact_text(&error.to_string())),
        }
    }

    Err(format!(
        "Não foi possível gravar o diagnóstico local: {}.",
        last_error.unwrap_or_else(|| "destino indisponível".to_string())
    ))
}

fn configured_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(configured_directory_with_warning(app)?.0)
}

fn configured_directory_with_warning(app: &AppHandle) -> Result<(PathBuf, Option<String>), String> {
    let default = default_directory(app)?;
    let config = match read_config(app) {
        Ok(config) if config.schema_version == 1 => config,
        Ok(_) => {
            return Ok((
                default,
                Some(
                    "A versão da configuração de diagnósticos não é reconhecida; a pasta padrão está em uso."
                        .to_string(),
                ),
            ));
        }
        Err(_) => {
            return Ok((
                default,
                Some(
                    "A configuração de diagnósticos não pôde ser lida; a pasta padrão está em uso."
                        .to_string(),
                ),
            ));
        }
    };
    let Some(directory) = config.directory.as_deref().map(str::trim) else {
        return Ok((default, None));
    };
    if directory.is_empty() {
        return Ok((default, None));
    }
    let path = PathBuf::from(directory);
    if is_network_path(&path) {
        Ok((
            default,
            Some(
                "A pasta configurada é um caminho de rede; a pasta padrão local está em uso."
                    .to_string(),
            ),
        ))
    } else if path.is_absolute() {
        Ok((path, None))
    } else {
        Ok((
            default,
            Some(
                "A pasta configurada não é um caminho completo; a pasta padrão está em uso."
                    .to_string(),
            ),
        ))
    }
}

fn default_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_directory(app)?.join(DEFAULT_DIRECTORY_NAME))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_local_data_directory(app)?.join(CONFIG_FILE_NAME))
}

fn app_local_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())
}

fn read_config(app: &AppHandle) -> Result<DiagnosticsConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(DiagnosticsConfig::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Não foi possível ler {}: {error}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("Configuração de diagnóstico inválida: {error}"))
}

fn write_config(app: &AppHandle, config: &DiagnosticsConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Não foi possível preparar a configuração: {error}"))?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!(
        "json.arizona-tmp-{}-{}",
        std::process::id(),
        NEXT_PROBE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| {
            format!("Não foi possível salvar a configuração de diagnóstico: {error}")
        })?;
    if let Err(error) = file
        .write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
    {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Não foi possível concluir a configuração de diagnóstico: {error}"
        ));
    }
    drop(file);
    if let Err(error) = replace_file(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Não foi possível ativar a configuração de diagnóstico: {error}"
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .eq_ignore_ascii_case(right.to_string_lossy().trim_end_matches(['\\', '/']))
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn prepare_writable_directory(directory: &Path) -> io::Result<()> {
    if is_network_path(directory) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "caminhos de rede não são aceitos",
        ));
    }
    fs::create_dir_all(directory)?;
    if !directory.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "o destino não é uma pasta",
        ));
    }

    let probe = directory.join(format!(
        ".arizona-diagnostics-write-test-{}-{}",
        std::process::id(),
        NEXT_PROBE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let result = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe)
        .and_then(|mut file| file.write_all(b"ok").and_then(|_| file.sync_all()));
    let _ = fs::remove_file(&probe);
    result
}

fn is_network_path(path: &Path) -> bool {
    let value = path.to_string_lossy().replace('/', "\\");
    if value.starts_with("\\\\") {
        return true;
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};

        let drive = match path.components().next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
                Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _) => return true,
                _ => return false,
            },
            _ => return false,
        };
        let root = format!("{}:\\", char::from(drive))
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        #[link(name = "Kernel32")]
        extern "system" {
            fn GetDriveTypeW(root_path_name: *const u16) -> u32;
        }
        const DRIVE_REMOTE: u32 = 4;
        return unsafe { GetDriveTypeW(root.as_ptr()) } == DRIVE_REMOTE;
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn resolve_active_directory(app: &AppHandle) -> Result<(PathBuf, PathBuf, Vec<String>), String> {
    let (configured, config_warning) = configured_directory_with_warning(app)?;
    let mut warnings = config_warning.into_iter().collect::<Vec<_>>();
    match prepare_writable_directory(&configured) {
        Ok(()) => Ok((configured.clone(), configured, warnings)),
        Err(_) => {
            let fallback = default_directory(app)?;
            prepare_writable_directory(&fallback).map_err(|error| {
                format!("Não foi possível preparar o diagnóstico local: {error}")
            })?;
            warnings.push(
                "A pasta escolhida está indisponível; os novos registros estão usando temporariamente a pasta padrão."
                    .to_string(),
            );
            Ok((configured, fallback, warnings))
        }
    }
}

#[cfg(windows)]
fn open_directory(path: &Path) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Não foi possível abrir a pasta de diagnósticos: {error}"))
}

#[cfg(target_os = "macos")]
fn open_directory(path: &Path) -> Result<(), String> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Não foi possível abrir a pasta de diagnósticos: {error}"))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn open_directory(path: &Path) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Não foi possível abrir a pasta de diagnósticos: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        activation_code_regex, cleanup_directory, is_network_path, log_date, log_file_name,
        move_file_preserving_source_on_failure, paths_equal, redact_text, sanitize_value,
        RETENTION_DAYS, TAURI_LOG_PREFIX,
    };
    use chrono::{Duration, Local};
    use std::fs;

    #[test]
    fn redacts_credentials_and_contact_data() {
        let text = redact_text(
            r#"email pessoa@example.com Authorization: Bearer opaque-secret-123 bearer abc.def.ghi refreshToken="abc123" json={"password":"segredo com espaco"} codigo ABCD-EFGH-IJKL arquivo "D:\Projetos Arizona\Job 42\video.mov" e E:\out\video.mp4"#,
        );
        assert!(!text.contains("pessoa@example.com"));
        assert!(!text.contains("abc.def.ghi"));
        assert!(!text.contains("opaque-secret-123"));
        assert!(!text.contains("abc123"));
        assert!(!text.contains("segredo com espaco"));
        assert!(!text.contains("ABCD-EFGH-IJKL"));
        assert!(!text.contains("Projetos Arizona"));
        assert!(!text.contains(r"E:\out"));
        assert!(activation_code_regex().is_match("ABCD-EFGH-IJKL"));
    }

    #[test]
    fn redacts_sensitive_detail_fields_even_when_not_strings() {
        let value = sanitize_value(
            serde_json::json!({
                "accessToken": 12345,
                "projectPath": "arquivo-secreto",
                "durationMs": 42
            }),
            0,
        );
        assert_eq!(value["accessToken"], "<dado-removido>");
        assert_eq!(value["projectPath"], "<dado-removido>");
        assert_eq!(value["durationMs"], 42);
    }

    #[test]
    fn cleanup_removes_only_expired_arizona_logs() {
        let root = std::env::temp_dir().join(format!(
            "arizona-diagnostics-test-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        let today = Local::now().date_naive();
        let expired = root.join(log_file_name(
            TAURI_LOG_PREFIX,
            today - Duration::days(RETENTION_DAYS),
        ));
        let retained = root.join(log_file_name(
            TAURI_LOG_PREFIX,
            today - Duration::days(RETENTION_DAYS - 1),
        ));
        let expired_part = root.join(format!(
            "arizona-cep-{}.part-test-1.jsonl",
            (today - Duration::days(RETENTION_DAYS)).format("%Y-%m-%d")
        ));
        let expired_move_temporary = root.join(format!(
            "arizona-cep-{}.part-test-2.jsonl.arizona-move-1234-6.tmp",
            (today - Duration::days(RETENTION_DAYS)).format("%Y-%m-%d")
        ));
        let unrelated = root.join("outro-programa-2000-01-01.jsonl");
        let unrelated_temporary = root.join("outro-programa-2000-01-01.jsonl.arizona-move-1-2.tmp");
        fs::write(&expired, "old").unwrap();
        fs::write(&expired_part, "old part").unwrap();
        fs::write(&expired_move_temporary, "interrupted move").unwrap();
        fs::write(&retained, "new").unwrap();
        fs::write(&unrelated, "keep").unwrap();
        fs::write(&unrelated_temporary, "keep").unwrap();

        cleanup_directory(&root, today).unwrap();

        assert!(!expired.exists());
        assert!(!expired_part.exists());
        assert!(!expired_move_temporary.exists());
        assert!(retained.exists());
        assert!(unrelated.exists());
        assert!(unrelated_temporary.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn path_aliases_do_not_merge_a_log_into_itself() {
        let root = std::env::temp_dir().join(format!(
            "arizona-diagnostics-alias-test-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let directory = root.join("logs");
        fs::create_dir_all(&directory).unwrap();
        let source = directory.join("arizona-tauri-2026-08-11.jsonl");
        let alias = directory
            .join("..")
            .join("logs")
            .join(source.file_name().unwrap());
        fs::write(&source, "{\"event\":1}\n").unwrap();

        assert!(paths_equal(&source, &alias));
        move_file_preserving_source_on_failure(&source, &alias).unwrap();
        assert_eq!(fs::read_to_string(&source).unwrap(), "{\"event\":1}\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn moving_a_log_to_a_unique_name_preserves_its_contents() {
        let root = std::env::temp_dir().join(format!(
            "arizona-diagnostics-merge-test-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.jsonl");
        let destination = root.join("destination.jsonl");
        fs::write(&source, "{\"event\":2}").unwrap();
        move_file_preserving_source_on_failure(&source, &destination).unwrap();

        assert!(!source.exists());
        assert_eq!(fs::read_to_string(&destination).unwrap(), "{\"event\":2}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recognizes_migrated_part_files_for_export_and_retention() {
        let path = std::path::Path::new("arizona-cep-2026-08-11.part-1234-5.jsonl");
        assert_eq!(
            log_date(path).map(|date| date.format("%Y-%m-%d").to_string()),
            Some("2026-08-11".to_string())
        );
        assert!(log_date(std::path::Path::new(
            "arizona-cep-2026-08-11.part-../../segredo.jsonl"
        ))
        .is_none());
        assert!(log_date(std::path::Path::new("arizona-cep-2026-08-11.part-.jsonl")).is_none());
    }

    #[test]
    fn rejects_network_share_paths_for_local_diagnostics() {
        assert!(is_network_path(std::path::Path::new(
            r"\\servidor\diagnosticos"
        )));
    }
}
