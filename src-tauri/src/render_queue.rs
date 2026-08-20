use rand::RngCore;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    utils::config::Color, webview::PageLoadEvent, AppHandle, Emitter, Manager, State, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

use crate::{
    after_effects, auth, authenticated_session, device_identity, diagnostics,
    license_status_from_session, load_or_create_install_id, render_process, settings, Arizona,
    AuthState,
};

pub(crate) const WINDOW_LABEL: &str = "render_queue";
const WINDOW_SHOWN_EVENT: &str = "arizona-render-queue:shown";
const FUNCTION_NAME: &str = "render-queue";
const SCHEMA_VERSION: u8 = 1;
const PROTOCOL_VERSION: u8 = 1;
const RECIPE_VERSION: &str = "arizona-render-v1";
// With the queue panel's 5 s refresh this keeps the shared per-device
// `status` budget below the backend limit while still picking work promptly.
const IDLE_POLL: Duration = Duration::from_secs(10);
const OBSERVER_POLL: Duration = Duration::from_secs(30);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
// The backend lease lasts 45 seconds. Stop before that boundary whenever we
// cannot renew it, so a second attempt can never overlap this process.
const LEASE_GRACE: Duration = Duration::from_secs(30);
const SYNC_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const PUBLICATION_RECOVERY_DIRECTORY: &str = "render-queue-recovery";

#[derive(Default)]
struct LocalWorkerSnapshot {
    current_job_id: Option<String>,
    current_job_title: Option<String>,
    availability: String,
    readiness: String,
    warning: Option<String>,
}

pub(crate) struct RenderQueueState {
    worker_session_id: String,
    enabled: AtomicBool,
    shutdown: AtomicBool,
    worker_stopped: AtomicBool,
    cancel_current: AtomicBool,
    received_work_pending: AtomicBool,
    announced_disabled: AtomicBool,
    availability_change: Mutex<()>,
    snapshot: Mutex<LocalWorkerSnapshot>,
    prefill: Mutex<(String, String)>,
    last_notice: Mutex<Option<String>>,
    pending_publications: Mutex<Vec<PendingPublicationReconciliation>>,
    observed_jobs: Mutex<HashMap<String, String>>,
    observations_initialized: AtomicBool,
    recovery_blocked: AtomicBool,
    after_state_check_failed_logged: AtomicBool,
    last_recovery_check: Mutex<Option<Instant>>,
    wake_mutex: Mutex<()>,
    wake: Condvar,
}

impl RenderQueueState {
    pub(crate) fn new() -> Self {
        Self {
            worker_session_id: random_uuid_v4(),
            // Availability is deliberately not persisted. Every process starts OFF.
            enabled: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            worker_stopped: AtomicBool::new(false),
            cancel_current: AtomicBool::new(false),
            received_work_pending: AtomicBool::new(false),
            announced_disabled: AtomicBool::new(false),
            availability_change: Mutex::new(()),
            snapshot: Mutex::new(LocalWorkerSnapshot {
                availability: "disabled".to_string(),
                readiness: "unknown".to_string(),
                ..LocalWorkerSnapshot::default()
            }),
            prefill: Mutex::new((String::new(), String::new())),
            last_notice: Mutex::new(None),
            pending_publications: Mutex::new(Vec::new()),
            observed_jobs: Mutex::new(HashMap::new()),
            observations_initialized: AtomicBool::new(false),
            recovery_blocked: AtomicBool::new(false),
            after_state_check_failed_logged: AtomicBool::new(false),
            last_recovery_check: Mutex::new(None),
            wake_mutex: Mutex::new(()),
            wake: Condvar::new(),
        }
    }

    pub(crate) fn has_active_job(&self) -> bool {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.current_job_id.is_some())
            .unwrap_or(false)
    }

    pub(crate) fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    pub(crate) fn has_received_work(&self) -> bool {
        self.received_work_pending.load(Ordering::Acquire) || self.has_active_job()
    }

    fn wake_worker(&self) {
        self.wake.notify_all();
    }

    fn has_pending_publication(&self) -> bool {
        self.pending_publications
            .lock()
            .map(|items| !items.is_empty())
            .unwrap_or(true)
    }

    fn wait(&self, duration: Duration) {
        if let Ok(guard) = self.wake_mutex.lock() {
            let _ = self.wake.wait_timeout(guard, duration);
        }
    }
}

pub(crate) fn with_session_end_guard<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<RenderQueueState>();
    let _change = state.availability_change.lock().map_err(|_| {
        "Não foi possível confirmar a disponibilidade desta máquina agora. Abra a fila e tente novamente."
            .to_string()
    })?;

    let message = if state.has_active_job() {
        Some(
            "Esta máquina está renderizando. Aguarde o fim ou cancele o trabalho na fila de renderização antes de sair."
        )
    } else if state.has_received_work() {
        Some(
            "Esta máquina ainda tem trabalhos na fila. Conclua ou cancele esses trabalhos antes de sair."
        )
    } else if state.is_enabled() {
        Some(
            "Esta máquina está disponível para receber renders. Desative Receber renders na fila antes de sair."
        )
    } else {
        None
    };

    if let Some(message) = message {
        focus_queue_window(app);
        return Err(message.to_string());
    }

    operation()
}

fn focus_queue_window(app: &AppHandle) {
    if let Some(queue_window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = reveal_queue_window(&queue_window);
    }
}

fn reveal_queue_window(window: &WebviewWindow) -> Result<(), String> {
    let _ = window.unminimize();
    window.show().map_err(|error| error.to_string())?;
    let _ = window.emit(WINDOW_SHOWN_EVENT, ());
    window.set_focus().map_err(|error| error.to_string())
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RenderOutput {
    kind: String,
    composition: String,
    template: String,
    destination_relative_path: String,
    replace_existing: bool,
    existing_fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PendingJob {
    id: String,
    title: String,
    project_relative_path: String,
    project_size_bytes: u64,
    project_sha256: String,
    outputs: Vec<RenderOutput>,
}

#[derive(Clone)]
struct Lease {
    id: String,
    generation: u64,
}

#[derive(Clone)]
struct ClaimedJob {
    job: PendingJob,
    lease: Lease,
}

#[derive(Clone)]
struct PendingPublicationReconciliation {
    job_id: String,
    title: String,
    project: PathBuf,
    publication: Vec<PublicationRecord>,
    finish_payload: Value,
    outcome: String,
}

#[derive(Clone)]
struct CandidateInfo {
    relative_path: String,
    file_name: String,
    title: String,
    region: Option<String>,
    mov_relative_path: String,
    mp4_relative_path: String,
    existing_outputs: Vec<String>,
    source_path: PathBuf,
    output_paths: [PathBuf; 2],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestedOutputFormat {
    Mov,
    Mp4,
}

impl RequestedOutputFormat {
    fn kind(self) -> &'static str {
        match self {
            Self::Mov => "mov",
            Self::Mp4 => "mp4",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Mov => "MOV",
            Self::Mp4 => "MP4",
        }
    }

    fn composition(self) -> &'static str {
        match self {
            Self::Mov => "EXPORT",
            Self::Mp4 => "EXPORT_MP4",
        }
    }

    fn template(self) -> &'static str {
        match self {
            Self::Mov => "PROXY",
            Self::Mp4 => "MP4",
        }
    }

    fn path_index(self) -> usize {
        match self {
            Self::Mov => 0,
            Self::Mp4 => 1,
        }
    }
}

pub(crate) fn start_worker(app: &AppHandle) {
    let worker_app = app.clone();
    let spawn_result = thread::Builder::new()
        .name("arizona-render-worker".to_string())
        .spawn(move || worker_loop(worker_app));
    if spawn_result.is_err() {
        app.state::<RenderQueueState>()
            .worker_stopped
            .store(true, Ordering::Release);
    }
}

pub(crate) fn shutdown(app: &AppHandle) {
    let state = app.state::<RenderQueueState>();
    state.enabled.store(false, Ordering::Release);
    state.shutdown.store(true, Ordering::Release);
    state.cancel_current.store(true, Ordering::Release);
    state.wake_worker();

    // A stale heartbeat also makes the machine offline. This best-effort call
    // only improves how quickly other people see a clean shutdown.
    let app = app.clone();
    let (finished_sender, finished_receiver) = std::sync::mpsc::sync_channel(1);
    let _ = thread::Builder::new()
        .name("arizona-render-signoff".to_string())
        .spawn(move || {
            let _ = queue_call(
                &app,
                "set_availability",
                json!({
                    "enabled": false,
                    "availability": "unavailable",
                    "statusMessage": "Esta máquina fechou o Arizona App.",
                }),
            );
            let _ = finished_sender.send(());
        });
    let _ = finished_receiver.recv_timeout(Duration::from_millis(1500));

    let worker_deadline = Instant::now() + Duration::from_secs(2);
    while !state.worker_stopped.load(Ordering::Acquire) {
        let remaining = worker_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        state.wait(remaining.min(Duration::from_millis(200)));
    }
}

pub(crate) fn disable_for_auth_loss(app: &AppHandle) {
    let state = app.state::<RenderQueueState>();
    state.enabled.store(false, Ordering::Release);
    state.cancel_current.store(true, Ordering::Release);
    state.announced_disabled.store(false, Ordering::Release);
    state.wake_worker();
}

// The caller must hold `availability_change` through the complete auth-clear
// operation so a concurrent toggle cannot make the machine available again.
pub(crate) fn sign_off_before_auth_clear_while_guarded(app: &AppHandle) {
    let state = app.state::<RenderQueueState>();
    state.enabled.store(false, Ordering::Release);
    state.cancel_current.store(true, Ordering::Release);
    state.wake_worker();

    if queue_call(
        app,
        "set_availability",
        json!({
            "enabled": false,
            "availability": "unavailable",
            "statusMessage": "Esta máquina saiu da conta do Arizona.",
        }),
    )
    .is_ok()
    {
        state.announced_disabled.store(true, Ordering::Release);
    }
}

#[tauri::command]
pub(crate) async fn render_queue_open(
    app: AppHandle,
    jobao_cod: Option<String>,
    jobinho_cod: Option<String>,
) -> Result<crate::ActionResponse, String> {
    // WebView2 initialization may wait on Windows internals. Keep that work
    // away from Tauri's command loop so the main window remains responsive.
    tauri::async_runtime::spawn_blocking(move || {
        open_render_queue_window(app, jobao_cod, jobinho_cod)
    })
    .await
    .map_err(|_| "Não foi possível abrir a janela da fila.".to_string())?
}

fn open_render_queue_window(
    app: AppHandle,
    jobao_cod: Option<String>,
    jobinho_cod: Option<String>,
) -> Result<crate::ActionResponse, String> {
    let (window, created) = match app.get_webview_window(WINDOW_LABEL) {
        Some(window) => (window, false),
        None => {
            let window =
                WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
                    .title("Fila de renderização")
                    .inner_size(980.0, 720.0)
                    .min_inner_size(700.0, 520.0)
                    .center()
                    .resizable(true)
                    .decorations(false)
                    .background_color(Color(17, 19, 22, 255))
                    .visible(false)
                    .on_page_load(|window, payload| {
                        if payload.event() == PageLoadEvent::Finished {
                            let _ = reveal_queue_window(&window);
                        }
                    })
                    .build()
                    .map_err(|_| "Não foi possível abrir a janela da fila.".to_string())?;
            crate::disable_browser_accelerator_keys_for_window(&window);
            (window, true)
        }
    };
    let jobao_cod = jobao_cod.unwrap_or_default().trim().to_string();
    let jobinho_cod = jobinho_cod.unwrap_or_default().trim().to_string();
    if let Ok(mut stored) = app.state::<RenderQueueState>().prefill.lock() {
        *stored = (jobao_cod.clone(), jobinho_cod.clone());
    }
    let prefill = json!({
        "jobaoCod": jobao_cod,
        "jobinhoCod": jobinho_cod,
    });
    window
        .emit("arizona-render-queue:set-project", &prefill)
        .map_err(|error| error.to_string())?;
    if !created {
        reveal_queue_window(&window)?;
    }
    Ok(crate::ActionResponse::ok())
}

#[tauri::command]
pub(crate) fn render_queue_close_window(app: AppHandle) -> Result<crate::ActionResponse, String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(crate::ActionResponse::ok())
}

#[tauri::command]
pub(crate) async fn render_queue_status(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || status_value(&app))
        .await
        .map_err(|_| "Não foi possível consultar a fila agora.".to_string())?
}

#[tauri::command]
pub(crate) async fn render_queue_history(
    app: AppHandle,
    before_created_at: Option<String>,
    before_id: Option<String>,
    limit: Option<u16>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        queue_call(
            &app,
            "history",
            json!({
                "beforeCreatedAt": before_created_at,
                "beforeId": before_id,
                "limit": limit.unwrap_or(50).clamp(1, 100),
            }),
        )
    })
    .await
    .map_err(|_| "Não foi possível consultar o histórico de renders agora.".to_string())?
}

#[tauri::command]
pub(crate) async fn render_queue_set_available(
    app: AppHandle,
    enabled: bool,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<RenderQueueState>();
        let _change = state
            .availability_change
            .lock()
            .map_err(|_| "Não foi possível alterar a disponibilidade agora.".to_string())?;
        let preflight = if enabled {
            let preflight = worker_preflight(&app)?;
            if let Some((readiness, message)) = preflight.blocked.as_ref() {
                update_local_snapshot(&state, "unavailable", readiness, Some(message.clone()));
                emit_queue_notice(&app, state.inner(), readiness, message, "warning");
                return Err(message.clone());
            }
            if let Ok(mut last_check) = state.last_recovery_check.lock() {
                *last_check = None;
            }
            Some(preflight)
        } else {
            None
        };

        let active = state.has_active_job();
        let availability = if enabled { "available" } else { "unavailable" };
        let available_message = preflight
            .as_ref()
            .and_then(|preflight| preflight.warning.as_deref())
            .unwrap_or("Esta máquina está disponível para receber renders.");
        let remote = queue_call(
            &app,
            "set_availability",
            json!({
                "enabled": enabled,
                "availability": availability,
                "statusMessage": if enabled {
                    available_message
                } else if active {
                    "Esta máquina terminará o render atual e não receberá novos."
                } else {
                    "Esta máquina não está disponível para novos renders."
                },
            }),
        )?;
        if enabled {
            state.enabled.store(true, Ordering::Release);
            state.announced_disabled.store(false, Ordering::Release);
            let warning = preflight.and_then(|preflight| preflight.warning);
            update_local_snapshot(&state, "available", "ready", warning.clone());
            if let Some(message) = warning.as_deref() {
                emit_queue_notice(
                    &app,
                    state.inner(),
                    "after_effects_open_advisory",
                    message,
                    "warning",
                );
            }
        } else {
            // Keep the local state enabled until the server confirms OFF. If
            // the request fails, close/session guards must continue blocking
            // while the remote worker can still accept work.
            state.enabled.store(false, Ordering::Release);
            if state.has_active_job() {
                update_local_snapshot(&state, "draining", "rendering", None);
            } else {
                update_local_snapshot(&state, "disabled", "unknown", None);
            }
        }
        state.wake_worker();
        state.announced_disabled.store(!enabled, Ordering::Release);
        Ok(merge_local_status(&app, remote))
    })
    .await
    .map_err(|_| "Não foi possível alterar a disponibilidade.".to_string())?
}

#[tauri::command]
pub(crate) async fn render_queue_project_candidates(
    app: AppHandle,
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        require_queue_access(&app)?;
        let candidates = resolve_candidates(&app, &jobao_cod, &jobinho_cod)?;
        Ok(json!({
            "candidates": candidates.into_iter().map(|candidate| json!({
                "relativePath": candidate.relative_path,
                "name": candidate.file_name,
                "title": candidate.title,
                "region": candidate.region,
                "movRelativePath": candidate.mov_relative_path,
                "mp4RelativePath": candidate.mp4_relative_path,
                "existingOutputs": candidate.existing_outputs,
            })).collect::<Vec<_>>(),
            "message": "Será usada a última versão salva do projeto.",
        }))
    })
    .await
    .map_err(|_| "Não foi possível procurar o projeto.".to_string())?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn render_queue_submit(
    app: AppHandle,
    jobao_cod: String,
    jobinho_cod: String,
    project_relative_path: String,
    target_device_id: String,
    output_formats: Option<Vec<String>>,
    replace_existing: bool,
    submission_id: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        require_queue_access(&app)?;
        let target_device_id = target_device_id.trim();
        if target_device_id.is_empty() {
            return Err("Escolha a máquina que receberá este render.".to_string());
        }
        let output_formats = normalize_output_formats(output_formats)?;
        let idempotency_key = clean_identifier(&submission_id, "envio")?;

        let candidate = resolve_candidates(&app, &jobao_cod, &jobinho_cod)?
            .into_iter()
            .find(|candidate| paths_match(&candidate.relative_path, &project_relative_path))
            .ok_or_else(|| {
                "O projeto escolhido mudou ou não está mais disponível. Procure novamente."
                    .to_string()
            })?;

        let root = canonical_drive_root(&app)?;
        let outputs = submission_output_specs(&output_formats, &candidate.output_paths);
        // Capture exactly what the user confirmed before the snapshot copy can
        // take time. Any later change becomes a conflict instead of silently
        // expanding the overwrite permission.
        let output_fingerprints = outputs
            .iter()
            .map(|(_, destination)| destination_fingerprint(destination))
            .collect::<Result<Vec<_>, String>>()?;
        if !replace_existing && output_fingerprints.iter().any(Option::is_some) {
            let existing_outputs = output_fingerprints
                .iter()
                .enumerate()
                .filter_map(|(index, fingerprint)| {
                    fingerprint
                        .as_ref()
                        .map(|_| outputs[index].0.label().to_string())
                })
                .collect::<Vec<_>>();
            let message = if existing_outputs.len() == 1 {
                format!(
                    "Já existe o arquivo final {} para este projeto. Confirme se deseja substituí-lo.",
                    existing_outputs[0]
                )
            } else {
                "Já existem arquivos finais para este projeto. Confirme se deseja substituí-los."
                    .to_string()
            };
            return Ok(json!({
                "ok": false,
                "code": "overwrite_confirmation_required",
                "message": message,
                "existingOutputs": existing_outputs,
            }));
        }

        let snapshot = create_snapshot(&root, &candidate.source_path, &idempotency_key)?;
        let output_values = outputs
            .iter()
            .enumerate()
            .map(|(index, (format, destination))| {
                output_manifest_value(
                    format.kind(),
                    format.composition(),
                    format.template(),
                    &relative_protocol_path(&root, destination)?,
                    replace_existing,
                    output_fingerprints[index].clone(),
                )
            })
            .collect::<Result<Vec<_>, String>>()?;

        let result = queue_call_detailed(
            &app,
            "create_job",
            json!({
                "schemaVersion": SCHEMA_VERSION,
                "idempotencyKey": idempotency_key,
                "targetWorkerDeviceId": target_device_id,
                "jobaoCod": jobao_cod.trim(),
                "jobinhoCod": jobinho_cod.trim(),
                "projectName": candidate.file_name,
                "originalProjectRelativePath": candidate.relative_path,
                "projectRelativePath": snapshot.relative_path,
                "projectSizeBytes": snapshot.size_bytes,
                "projectSha256": snapshot.sha256,
                "recipe": RECIPE_VERSION,
                "overwritePolicy": if replace_existing { "replace-if-unchanged" } else { "fail-if-exists" },
                "outputs": output_values,
            }),
        );

        match result {
            Ok(mut value) => {
                if let Some(object) = value.as_object_mut() {
                    object.entry("ok".to_string()).or_insert(Value::Bool(true));
                }
                let _ = app.emit("arizona-render-queue:changed", json!({ "reason": "job_created" }));
                diagnostics::info(
                    &app,
                    "fila_render",
                    "enviar",
                    "completed",
                    "Projeto enviado para a fila de renderização.",
                    Some(json!({
                        "targetDeviceId": target_device_id,
                        "projectSizeBytes": snapshot.size_bytes,
                        "outputFormats": output_formats.iter().map(|format| format.kind()).collect::<Vec<_>>(),
                    })),
                );
                Ok(value)
            }
            Err(error) => {
                if submission_rejection_guarantees_no_job(&error.code) {
                    if let Err(cleanup_error) = remove_snapshot_file(&snapshot.path) {
                        diagnostics::warning(
                            &app,
                            "fila_render",
                            "limpar_copia_rejeitada",
                            "completed_with_warnings",
                            "render_rejected_snapshot_cleanup_failed",
                            "Uma cópia local de um envio recusado ainda aguarda limpeza.",
                            Some(json!({ "technicalMessage": cleanup_error.to_string() })),
                        );
                    }
                }
                // Every other failure is ambiguous. A timeout can happen
                // after the server committed the job, so retaining the
                // immutable snapshot is safer than leaving a valid remote job
                // pointing at a deleted file. It remains available for future
                // authoritative reconciliation.
                Err(error.public_message)
            }
        }
    })
    .await
    .map_err(|_| "Não foi possível preparar o projeto para a fila.".to_string())?
}

#[tauri::command]
pub(crate) async fn render_queue_cancel(app: AppHandle, job_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let job_id = clean_identifier(&job_id, "render")?;
        let state = app.state::<RenderQueueState>();
        if state
            .snapshot
            .lock()
            .ok()
            .and_then(|snapshot| snapshot.current_job_id.clone())
            .as_deref()
            == Some(job_id.as_str())
        {
            state.cancel_current.store(true, Ordering::Release);
        }
        state.wake_worker();
        let result = queue_call(&app, "cancel", json!({ "jobId": job_id }))?;
        let _ = app.emit(
            "arizona-render-queue:changed",
            json!({ "reason": "cancel_requested" }),
        );
        Ok(result)
    })
    .await
    .map_err(|_| "Não foi possível pedir o cancelamento.".to_string())?
}

#[tauri::command]
pub(crate) async fn render_queue_reassign(
    app: AppHandle,
    job_id: String,
    target_device_id: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = queue_call(
            &app,
            "reassign",
            json!({
                "jobId": clean_identifier(&job_id, "render")?,
                "targetWorkerDeviceId": clean_identifier(&target_device_id, "máquina")?,
            }),
        )?;
        let _ = app.emit(
            "arizona-render-queue:changed",
            json!({ "reason": "job_reassigned" }),
        );
        Ok(result)
    })
    .await
    .map_err(|_| "Não foi possível trocar a máquina.".to_string())?
}

fn worker_loop(app: AppHandle) {
    loop {
        let state = app.state::<RenderQueueState>();
        if state.shutdown.load(Ordering::Acquire) {
            break;
        }

        if state.has_pending_publication() {
            if let Err(error) = reconcile_pending_publication(&app, &state) {
                diagnostics::warning(
                    &app,
                    "fila_render",
                    "reconciliar_publicacao",
                    "completed_with_warnings",
                    "render_publication_reconciliation_pending",
                    "Os arquivos finais aguardam uma confirmação da fila.",
                    Some(json!({ "technicalMessage": error })),
                );
            }
            if state.has_pending_publication() {
                state.wait(IDLE_POLL);
                continue;
            }
        }

        if persisted_recovery_check_due(&state) {
            match reconcile_persisted_publications(&app) {
                Ok(()) => state.recovery_blocked.store(false, Ordering::Release),
                Err(error) => {
                    state.recovery_blocked.store(true, Ordering::Release);
                    diagnostics::warning(
                        &app,
                        "fila_render",
                        "recuperar_publicacao_local",
                        "completed_with_warnings",
                        "render_publication_recovery_pending",
                        "Há arquivos de um render interrompido aguardando recuperação segura.",
                        Some(json!({ "technicalMessage": error })),
                    );
                }
            }
        }
        if state.recovery_blocked.load(Ordering::Acquire) {
            let message =
                "Há arquivos de um render interrompido aguardando recuperação nesta máquina.";
            update_local_snapshot(
                &state,
                "unavailable",
                "publication_recovery_pending",
                Some(message.to_string()),
            );
            let _ = queue_call(
                &app,
                "heartbeat",
                json!({
                    "availability": "unavailable",
                    "statusCode": "publication_recovery_pending",
                    "statusMessage": message,
                }),
            );
            emit_queue_notice(
                &app,
                state.inner(),
                "publication_recovery_pending",
                message,
                "warning",
            );
            state.wait(IDLE_POLL);
            continue;
        }

        if !state.enabled.load(Ordering::Acquire) {
            update_local_snapshot(
                &state,
                if state.has_active_job() {
                    "draining"
                } else {
                    "disabled"
                },
                "unknown",
                None,
            );
            announce_disabled_once(&app, &state);
            if let Ok(remote) = queue_call(&app, "status", json!({ "includeNextJob": true })) {
                observe_queue_status(&app, state.inner(), &remote);
                if let Ok(root) = canonical_drive_root(&app) {
                    let _ = cleanup_terminal_attempts_from_status(&root, &remote);
                }
            }
            state.wait(OBSERVER_POLL);
            continue;
        }

        if let Err(error) = worker_iteration(&app, &state) {
            diagnostics::warning(
                &app,
                "fila_render",
                "processar_fila",
                "completed_with_warnings",
                "render_worker_iteration_failed",
                "A fila não conseguiu concluir uma verificação e tentará novamente.",
                Some(json!({ "technicalMessage": error })),
            );
            state.wait(IDLE_POLL);
        }
    }
    let state = app.state::<RenderQueueState>();
    state.worker_stopped.store(true, Ordering::Release);
    state.wake.notify_all();
}

fn worker_iteration(app: &AppHandle, state: &State<RenderQueueState>) -> Result<(), String> {
    let preflight = worker_preflight(app)?;
    if let Some((readiness, message)) = preflight.blocked {
        update_local_snapshot(state, "unavailable", readiness, Some(message.clone()));
        emit_queue_notice(app, state.inner(), readiness, &message, "warning");
        let _ = queue_call(
            app,
            "heartbeat",
            json!({
                "enabled": true,
                "availability": "unavailable",
                "statusCode": readiness,
                "statusMessage": message,
                "capabilities": preflight.capabilities,
            }),
        );
        state.wait(IDLE_POLL);
        return Ok(());
    }

    update_local_snapshot(state, "available", "ready", preflight.warning.clone());
    if let Some(message) = preflight.warning.as_deref() {
        emit_queue_notice(
            app,
            state.inner(),
            "after_effects_open_advisory",
            message,
            "warning",
        );
    }
    let status_message = preflight
        .warning
        .as_deref()
        .unwrap_or("Esta máquina está pronta para renderizar.");
    let status = queue_call(
        app,
        "heartbeat",
        json!({
            "enabled": true,
            "availability": "available",
            // An advisory deliberately has no statusCode: the backend keeps
            // this worker eligible while exposing the human-readable notice.
            "statusMessage": status_message,
            "capabilities": preflight.capabilities,
        }),
    )?;

    let pending = if let Some(pending) = pending_job_from_response(&status) {
        Some(pending)
    } else {
        let remote = queue_call(app, "status", json!({ "includeNextJob": true }))?;
        observe_queue_status(app, state.inner(), &remote);
        let _ = cleanup_terminal_attempts_from_status(&preflight.root, &remote);
        if let Some(recoverable) = recoverable_job_from_response(&remote) {
            return resume_recoverable_job(
                app,
                state,
                &preflight.root,
                &preflight.aerender,
                recoverable,
            );
        }
        pending_job_from_response(&remote)
    };
    let Some(job) = pending else {
        clear_local_job(state.inner());
        update_local_snapshot(state, "available", "ready", preflight.warning.clone());
        state.wait(IDLE_POLL);
        return Ok(());
    };

    emit_queue_notice(
        app,
        state.inner(),
        &format!("job_received:{}", job.id),
        &format!("{} entrou na fila desta máquina.", job.title),
        "info",
    );

    wait_for_snapshot_then_run(app, state, &preflight.root, &preflight.aerender, job)
}

fn resume_recoverable_job(
    app: &AppHandle,
    state: &State<RenderQueueState>,
    root: &Path,
    aerender: &Path,
    job: PendingJob,
) -> Result<(), String> {
    update_local_job(
        state,
        &job,
        "busy",
        "preparing",
        Some("Retomando o trabalho reservado por esta máquina.".to_string()),
    );
    // Reacquire the still-active lease before reading the whole snapshot.
    // The hash is repeated below with heartbeat ticks, so a large Drive file
    // cannot consume this recovered lease silently.
    let claim = queue_call(
        app,
        "claim",
        json!({
            "jobId": job.id,
            "observedProjectSha256": job.project_sha256,
            "observedProjectSizeBytes": job.project_size_bytes,
        }),
    )?;
    let claimed = claimed_job_from_response(&claim, &job)?;
    run_claimed_job(app, state, root, aerender, claimed)
}

struct WorkerPreflight {
    root: PathBuf,
    aerender: PathBuf,
    capabilities: Value,
    blocked: Option<(&'static str, String)>,
    warning: Option<String>,
}

fn worker_preflight(app: &AppHandle) -> Result<WorkerPreflight, String> {
    require_queue_access(app)?;
    let config = settings::load(app).map_err(|_| {
        "Confira as configurações do Arizona antes de disponibilizar esta máquina.".to_string()
    })?;
    let configured_root = PathBuf::from(config.drive.trim());
    let root = fs::canonicalize(&configured_root).unwrap_or(configured_root);
    let after_fx = after_effects::resolve_executable(&config.ae_version);
    let aerender = after_fx.with_file_name("aerender.exe");
    let blocked = if !root.is_dir() {
        Some((
            "drive_unavailable",
            "A pasta compartilhada não está acessível nesta máquina.".to_string(),
        ))
    } else if !aerender.is_file() {
        Some((
            "aerender_unavailable",
            "O renderizador do After Effects não foi encontrado nesta máquina.".to_string(),
        ))
    } else {
        None
    };
    let warning = if blocked.is_none() {
        let state = app.state::<RenderQueueState>();
        match after_effects::is_after_effects_running() {
            Ok(is_open) => {
                state
                    .after_state_check_failed_logged
                    .store(false, Ordering::Release);
                after_effects_open_advisory(is_open).map(str::to_string)
            }
            Err(error) => {
                if !state
                    .after_state_check_failed_logged
                    .swap(true, Ordering::AcqRel)
                {
                    diagnostics::warning(
                        app,
                        "fila_render",
                        "verificar_after_aberto",
                        "completed_with_warnings",
                        "render_after_state_check_failed",
                        "Não foi possível verificar se o After Effects está aberto. A máquina continuará disponível.",
                        Some(json!({ "technicalMessage": error })),
                    );
                }
                None
            }
        }
    } else {
        None
    };

    Ok(WorkerPreflight {
        root,
        aerender,
        capabilities: json!({
            "protocolVersion": PROTOCOL_VERSION,
            "recipe": RECIPE_VERSION,
            "afterEffectsVersion": config.ae_version,
            "movTemplate": "PROXY",
            "mp4Template": "MP4",
        }),
        blocked,
        warning,
    })
}

fn after_effects_open_advisory(is_open: bool) -> Option<&'static str> {
    is_open.then_some(
        "O After Effects está aberto. Esta máquina continuará aceitando renders, mas fechá-lo pode liberar mais recursos para o trabalho.",
    )
}

fn wait_for_snapshot_then_run(
    app: &AppHandle,
    state: &State<RenderQueueState>,
    root: &Path,
    aerender: &Path,
    job: PendingJob,
) -> Result<(), String> {
    let started = Instant::now();
    loop {
        if state.shutdown.load(Ordering::Acquire)
            || state.cancel_current.load(Ordering::Acquire)
            || !state.enabled.load(Ordering::Acquire)
        {
            clear_local_job(state);
            return Ok(());
        }
        match verify_snapshot(root, &job) {
            Ok(_) => {
                let runtime_block = if !root.is_dir() {
                    Some((
                        "drive_unavailable",
                        "A pasta compartilhada deixou de responder nesta máquina.",
                    ))
                } else if !aerender.is_file() {
                    Some((
                        "aerender_unavailable",
                        "O renderizador do After Effects não está mais disponível nesta máquina.",
                    ))
                } else {
                    None
                };
                if let Some((code, message)) = runtime_block {
                    update_local_job(state, &job, "unavailable", code, Some(message.to_string()));
                    let heartbeat = queue_call_detailed(
                        app,
                        "heartbeat",
                        json!({
                            "availability": "unavailable",
                            "jobId": job.id,
                            "stage": "waiting_for_worker",
                            "statusCode": code,
                            "statusMessage": message,
                        }),
                    );
                    if heartbeat
                        .as_ref()
                        .err()
                        .is_some_and(QueueCallFailure::pending_job_is_gone)
                    {
                        clear_local_job(state);
                        return Ok(());
                    }
                    state.wait(IDLE_POLL);
                    return Ok(());
                }

                let needs_publication_recovery = publication_recovery_exists(root, &job)?;
                let mut output_conflict = false;
                if !needs_publication_recovery {
                    for output in &job.outputs {
                        let destination =
                            resolve_protocol_path(root, &output.destination_relative_path)?;
                        ensure_safe_destination(root, &destination)?;
                        if !destination_still_matches(
                            &destination,
                            output.replace_existing,
                            output.existing_fingerprint.as_deref(),
                        )? {
                            output_conflict = true;
                            break;
                        }
                    }
                }
                let readiness = queue_call(
                    app,
                    "heartbeat",
                    json!({
                        "enabled": true,
                        "availability": "available",
                        "jobId": job.id,
                        "stage": if output_conflict { "waiting_for_sync" } else { "ready" },
                        "statusCode": if output_conflict { Value::String("output_conflict".to_string()) } else { Value::Null },
                        "statusMessage": if output_conflict {
                            "Um arquivo final mudou depois da confirmação."
                        } else {
                            "O projeto chegou por completo e está pronto para renderizar."
                        },
                        "outputConflict": output_conflict,
                        "outputConflictCode": if output_conflict { Value::String("existing_output_changed".to_string()) } else { Value::Null },
                    }),
                )?;
                if remote_cancel_requested(&readiness) {
                    clear_local_job(state);
                    return Ok(());
                }
                if output_conflict {
                    update_local_job(
                        state,
                        &job,
                        "busy",
                        "output_conflict",
                        Some(
                            "Um arquivo final mudou depois da confirmação. O solicitante precisa revisar."
                                .to_string(),
                        ),
                    );
                    emit_queue_notice(
                        app,
                        state.inner(),
                        &format!("output_conflict:{}", job.id),
                        "Um arquivo final mudou depois da confirmação. A máquina que enviou o projeto precisa revisar.",
                        "warning",
                    );
                    state.wait(IDLE_POLL);
                    return Ok(());
                }
                let claim = queue_call(
                    app,
                    "claim",
                    json!({
                        "jobId": job.id,
                        "observedProjectSha256": job.project_sha256,
                        "observedProjectSizeBytes": job.project_size_bytes,
                    }),
                )?;
                let claimed = claimed_job_from_response(&claim, &job)?;
                return run_claimed_job(app, state, root, aerender, claimed);
            }
            Err(VerifySnapshotError::Waiting) if started.elapsed() < SYNC_TIMEOUT => {
                update_local_job(
                    state,
                    &job,
                    "busy",
                    "waiting_for_sync",
                    Some("Aguardando o projeto chegar por completo nesta máquina.".to_string()),
                );
                let response = queue_call_detailed(
                    app,
                    "heartbeat",
                    json!({
                        "enabled": true,
                        "availability": "available",
                        "jobId": job.id,
                        "stage": "waiting_for_sync",
                        "statusCode": "project_not_synced",
                        "statusMessage": "Aguardando a sincronização do projeto na máquina escolhida.",
                    }),
                );
                match response {
                    Ok(response) if remote_cancel_requested(&response) => {
                        clear_local_job(state);
                        return Ok(());
                    }
                    Err(error) if error.pending_job_is_gone() => {
                        clear_local_job(state);
                        return Ok(());
                    }
                    Ok(_) | Err(_) => {}
                }
                state.wait(IDLE_POLL);
            }
            Err(VerifySnapshotError::Waiting) => {
                let _ = queue_call(
                    app,
                    "heartbeat",
                    json!({
                        "availability": "available",
                        "jobId": job.id,
                        "stage": "waiting_for_sync",
                        "statusCode": "project_not_synced",
                        "statusMessage": "O projeto não chegou por completo dentro do prazo.",
                        "errorCode": "sync_timeout",
                    }),
                );
                clear_local_job(state);
                return Ok(());
            }
            Err(
                VerifySnapshotError::Invalid(message) | VerifySnapshotError::Interrupted(message),
            ) => {
                let _ = queue_call(
                    app,
                    "heartbeat",
                    json!({
                        "availability": "available",
                        "jobId": job.id,
                        "stage": "waiting_for_sync",
                        "statusCode": "project_hash_mismatch",
                        "statusMessage": "O arquivo recebido não corresponde ao projeto enviado.",
                        "errorCode": "project_hash_mismatch",
                    }),
                );
                clear_local_job(state);
                return Err(message);
            }
        }
    }
}

fn run_claimed_job(
    app: &AppHandle,
    state: &State<RenderQueueState>,
    root: &Path,
    aerender: &Path,
    claimed: ClaimedJob,
) -> Result<(), String> {
    let job = claimed.job.clone();
    state.cancel_current.store(false, Ordering::Release);
    update_local_job(state, &job, "busy", "rendering", None);
    let _local_job_guard = LocalJobGuard(state.inner());
    if !root.is_dir() {
        return fail_claimed_job(
            app,
            state,
            &claimed,
            "lease_lost",
            "A pasta compartilhada deixou de responder. O render aguardará uma nova tentativa segura.",
            None,
        );
    }
    let mut remote_cancelled = false;
    let preparing = lease_heartbeat(
        app,
        &claimed,
        "preparing",
        0,
        state.enabled.load(Ordering::Acquire),
    )?;
    if remote_cancel_requested(&preparing) {
        remote_cancelled = true;
        state.cancel_current.store(true, Ordering::Release);
    }
    let mut last_lease_ok = Instant::now();
    let mut last_heartbeat = Instant::now();
    let mut lease_lost = false;

    let needs_publication_recovery = match publication_recovery_exists(root, &job) {
        Ok(value) => value,
        Err(error) => {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "lease_lost",
                "Uma tentativa anterior ainda precisa ser conferida antes de continuar.",
                Some(error),
            )
        }
    };
    let mut recovery_cancel_fenced = false;
    let recovery_result =
        if needs_publication_recovery {
            let mut recovery_tick = || {
                let local_cancel_requested = state.shutdown.load(Ordering::Acquire)
                    || state.cancel_current.load(Ordering::Acquire);
                if last_heartbeat.elapsed() < HEARTBEAT_INTERVAL
                    && (!local_cancel_requested || recovery_cancel_fenced)
                {
                    return Ok(());
                }
                last_heartbeat = Instant::now();
                match lease_heartbeat_detailed(
                    app,
                    &claimed,
                    "preparing",
                    0,
                    state.enabled.load(Ordering::Acquire),
                ) {
                    Ok(response) => {
                        last_lease_ok = Instant::now();
                        if remote_cancel_requested(&response) {
                            remote_cancelled = true;
                            state.cancel_current.store(true, Ordering::Release);
                        }
                        if !remote_lease_valid(&response) {
                            lease_lost = true;
                            Err("lease_lost: recovery lease is no longer valid".to_string())
                        } else {
                            if local_cancel_requested || remote_cancelled {
                                recovery_cancel_fenced = true;
                            }
                            Ok(())
                        }
                    }
                    Err(error) if error.lease_is_lost() => {
                        lease_lost = true;
                        Err(format!("lease_lost: {}", error.public_message))
                    }
                    Err(error) if last_lease_ok.elapsed() >= LEASE_GRACE => {
                        lease_lost = true;
                        Err(format!("lease_lost: {}", error.public_message))
                    }
                    Err(error) if local_cancel_requested && !recovery_cancel_fenced => {
                        Err(format!("cancelled_unfenced: {}", error.public_message))
                    }
                    Err(_) => Ok(()),
                }
            };
            let mut result = recover_interrupted_publication(root, &job, &mut recovery_tick);
            if result.is_ok() {
                for output in &job.outputs {
                    let destination =
                        match resolve_protocol_path(root, &output.destination_relative_path) {
                            Ok(destination) => destination,
                            Err(error) => {
                                result = Err(error);
                                break;
                            }
                        };
                    let matches = destination_still_matches_with_tick(
                        &destination,
                        output.replace_existing,
                        output.existing_fingerprint.as_deref(),
                        &mut recovery_tick,
                    );
                    match matches {
                        Ok(true) => {}
                        Ok(false) => return fail_claimed_job(
                            app,
                            state,
                            &claimed,
                            "output_conflict",
                            "Os arquivos finais mudaram durante a recuperação e foram preservados.",
                            None,
                        ),
                        Err(error) => {
                            result = Err(error);
                            break;
                        }
                    }
                }
            }
            result
        } else {
            Ok(())
        };
    if let Err(error) = recovery_result {
        if lease_lost || error.starts_with("cancelled_unfenced:") {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "lease_lost",
                "Esta máquina perdeu a autorização temporária durante a recuperação dos arquivos.",
                Some(error),
            );
        }
        return fail_claimed_job(
            app,
            state,
            &claimed,
            "lease_lost",
            "A recuperação dos arquivos anteriores ainda não pôde ser concluída com segurança.",
            Some(error),
        );
    }

    if needs_publication_recovery {
        let _ = remove_publication_recovery_marker(app, &job.id);
    }

    if state.cancel_current.load(Ordering::Acquire) || state.shutdown.load(Ordering::Acquire) {
        if needs_publication_recovery && !recovery_cancel_fenced {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "lease_lost",
                "Esta máquina interrompeu o render sem alterar os arquivos finais.",
                None,
            );
        }
        let _ = finish_job(
            app,
            &job.id,
            Some(&claimed.lease),
            "cancelled",
            cancellation_error_code(remote_cancelled),
            "Render cancelado depois de restaurar os arquivos anteriores.",
            None,
        );
        return Ok(());
    }

    if !aerender.is_file() {
        return fail_claimed_job(
            app,
            state,
            &claimed,
            "aerender_unavailable",
            "O recurso de renderização do After Effects não está mais disponível nesta máquina.",
            None,
        );
    }

    let project_check = verify_snapshot_with_tick(root, &job, || {
        let local_cancel_requested =
            state.shutdown.load(Ordering::Acquire) || state.cancel_current.load(Ordering::Acquire);
        if !local_cancel_requested && last_heartbeat.elapsed() < HEARTBEAT_INTERVAL {
            return Ok(());
        }
        last_heartbeat = Instant::now();
        match lease_heartbeat_detailed(
            app,
            &claimed,
            "preparing",
            0,
            state.enabled.load(Ordering::Acquire),
        ) {
            Ok(response) => {
                last_lease_ok = Instant::now();
                if remote_cancel_requested(&response) {
                    remote_cancelled = true;
                    state.cancel_current.store(true, Ordering::Release);
                }
                if !remote_lease_valid(&response) {
                    lease_lost = true;
                    Err("lease_lost: snapshot lease is no longer valid".to_string())
                } else if local_cancel_requested || remote_cancelled {
                    Err("cancelled_fenced: render cancelled while checking snapshot".to_string())
                } else {
                    Ok(())
                }
            }
            Err(error) if error.lease_is_lost() => {
                lease_lost = true;
                Err(format!("lease_lost: {}", error.public_message))
            }
            Err(error) if local_cancel_requested => {
                Err(format!("cancelled_unfenced: {}", error.public_message))
            }
            Err(error) if last_lease_ok.elapsed() >= LEASE_GRACE => {
                lease_lost = true;
                Err(format!("lease_lost: {}", error.public_message))
            }
            Err(_) => Ok(()),
        }
    });
    let project = match project_check {
        Ok(project) => project,
        Err(VerifySnapshotError::Interrupted(error))
            if lease_lost || error.starts_with("cancelled_unfenced:") =>
        {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "lease_lost",
                "Esta máquina perdeu a autorização temporária enquanto conferia o projeto.",
                Some(error),
            )
        }
        Err(VerifySnapshotError::Interrupted(error)) if error.starts_with("cancelled_fenced:") => {
            let _ = finish_job(
                app,
                &job.id,
                Some(&claimed.lease),
                "cancelled",
                cancellation_error_code(remote_cancelled),
                "Render cancelado antes de começar.",
                Some(error),
            );
            return Ok(());
        }
        Err(VerifySnapshotError::Waiting | VerifySnapshotError::Invalid(_))
        | Err(VerifySnapshotError::Interrupted(_)) => {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "project_hash_mismatch",
                "O projeto mudou antes de o render começar.",
                None,
            )
        }
    };

    if let Err(error) = cleanup_attempt_directories_for_job(root, &job) {
        diagnostics::warning(
            app,
            "fila_render",
            "limpar_tentativas_anteriores",
            "completed_with_warnings",
            "render_attempt_cleanup_pending",
            "Uma tentativa anterior deste render ainda ocupa espaço na pasta compartilhada.",
            Some(json!({ "technicalMessage": error })),
        );
    }

    let _sleep_guard = PreventSleep::new();
    let attempt_key = format!("{}-{}", claimed.lease.generation, random_uuid_v4());
    let mut attempt_cleanup = AttemptCleanup::default();
    let mut rendered = Vec::new();
    let mut last_progress = 0_u8;
    let mut execution_started_at: Option<Instant> = None;

    for (index, output) in job.outputs.iter().enumerate() {
        if output.kind != "mov" && output.kind != "mp4" {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "recipe_not_supported",
                "Este trabalho usa um formato que esta máquina não reconhece.",
                None,
            );
        }
        let output_paths = (|| {
            let destination = resolve_protocol_path(root, &output.destination_relative_path)?;
            ensure_safe_destination(root, &destination)?;
            let temporary = render_attempt_path(root, &destination, &job.id, &attempt_key)?;
            if let Some(parent) = temporary.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            Ok::<_, String>((temporary, destination))
        })();
        let (temporary, destination) = match output_paths {
            Ok(paths) => paths,
            Err(error) => {
                return fail_claimed_job(
                    app,
                    state,
                    &claimed,
                    "drive_unavailable",
                    "Não foi possível preparar a pasta temporária deste render.",
                    Some(error),
                )
            }
        };
        attempt_cleanup.track(temporary.clone());

        let (base_progress, span) = output_progress_bounds(index, job.outputs.len());
        let spec = render_process::AerenderSpec {
            executable: aerender.to_path_buf(),
            project: project.clone(),
            composition: output.composition.clone(),
            output_module_template: output.template.clone(),
            output: temporary.clone(),
        };
        let render_stage = if output.kind == "mov" {
            "rendering_proxy"
        } else {
            "rendering_mp4"
        };
        // Mark the render before spawning aerender so `started_at` includes
        // process startup as well as the frame rendering itself.
        let starting = lease_heartbeat(
            app,
            &claimed,
            render_stage,
            last_progress,
            state.enabled.load(Ordering::Acquire),
        )?;
        last_heartbeat = Instant::now();
        last_lease_ok = Instant::now();
        if remote_cancel_requested(&starting) {
            remote_cancelled = true;
            state.cancel_current.store(true, Ordering::Release);
        }
        if state.cancel_current.load(Ordering::Acquire) || state.shutdown.load(Ordering::Acquire) {
            let _ = finish_job(
                app,
                &job.id,
                Some(&claimed.lease),
                "cancelled",
                cancellation_error_code(remote_cancelled),
                "Render cancelado antes de iniciar o arquivo.",
                None,
            );
            clear_local_job(state);
            return Ok(());
        }
        execution_started_at.get_or_insert_with(Instant::now);
        let result = render_process::run_aerender(&spec, |line| {
            if state.shutdown.load(Ordering::Acquire)
                || state.cancel_current.load(Ordering::Acquire)
            {
                return false;
            }

            if let Some(percent) = line.and_then(parse_progress_percent) {
                let overall = base_progress.saturating_add(percent.saturating_mul(span) / 100);
                if overall >= last_progress.saturating_add(2) {
                    last_progress = overall;
                }
            }

            if last_heartbeat.elapsed() >= HEARTBEAT_INTERVAL {
                last_heartbeat = Instant::now();
                match lease_heartbeat_detailed(
                    app,
                    &claimed,
                    render_stage,
                    last_progress,
                    state.enabled.load(Ordering::Acquire),
                ) {
                    Ok(response) => {
                        last_lease_ok = Instant::now();
                        if remote_cancel_requested(&response) {
                            remote_cancelled = true;
                            state.cancel_current.store(true, Ordering::Release);
                            return false;
                        }
                        if !remote_lease_valid(&response) {
                            lease_lost = true;
                            state.cancel_current.store(true, Ordering::Release);
                            return false;
                        }
                    }
                    Err(error) if error.lease_is_lost() => {
                        lease_lost = true;
                        return false;
                    }
                    Err(_) if last_lease_ok.elapsed() >= LEASE_GRACE => {
                        lease_lost = true;
                        return false;
                    }
                    Err(_) => {}
                }
            }
            true
        });

        let result = match result {
            Ok(result) => result,
            Err(error) => {
                return fail_claimed_job(
                    app,
                    state,
                    &claimed,
                    "aerender_unavailable",
                    "O renderizador do After Effects não conseguiu iniciar.",
                    Some(error),
                )
            }
        };
        if lease_lost {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "lease_lost",
                "Esta máquina perdeu a autorização temporária do render e interrompeu o trabalho com segurança.",
                Some(result.output_tail),
            );
        }
        if state.cancel_current.load(Ordering::Acquire) || state.shutdown.load(Ordering::Acquire) {
            let _ = finish_job(
                app,
                &job.id,
                Some(&claimed.lease),
                "cancelled",
                cancellation_error_code(remote_cancelled),
                "Render cancelado.",
                Some(result.output_tail),
            );
            clear_local_job(state);
            return Ok(());
        }
        if !result.status_success || !temporary.is_file() {
            let technical_message = format!(
                "aerender exit code: {:?}\n{}",
                result.exit_code, result.output_tail
            );
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "aerender_failed",
                "O After Effects não conseguiu concluir o arquivo solicitado.",
                Some(technical_message),
            );
        }
        last_progress = base_progress.saturating_add(span);
        rendered.push((output.clone(), temporary, destination));
    }

    let response = match lease_heartbeat_detailed(
        app,
        &claimed,
        "publishing",
        100,
        state.enabled.load(Ordering::Acquire),
    ) {
        Ok(response) => response,
        Err(error) if error.lease_is_lost() => return fail_claimed_job(
            app,
            state,
            &claimed,
            "lease_lost",
            "Esta máquina perdeu a autorização temporária do render antes de concluir os arquivos.",
            Some(error.public_message),
        ),
        Err(error) => return Err(error.public_message),
    };
    last_heartbeat = Instant::now();
    last_lease_ok = Instant::now();
    if remote_cancel_requested(&response) {
        emit_queue_notice(
            app,
            state.inner(),
            &format!("job_cancelled:{}", job.id),
            "A máquina que enviou o projeto cancelou este render.",
            "warning",
        );
        let _ = finish_job(
            app,
            &job.id,
            Some(&claimed.lease),
            "cancelled",
            "cancelled_by_requester",
            "Render cancelado antes de publicar os arquivos.",
            None,
        );
        return Ok(());
    }
    if !remote_lease_valid(&response) {
        return fail_claimed_job(
            app,
            state,
            &claimed,
            "lease_lost",
            "A autorização deste render venceu antes de publicar os arquivos.",
            None,
        );
    }

    let mut verified_outputs = Vec::new();
    for (output, temporary, destination) in rendered {
        let hash_result = sha256_file_with_tick(&temporary, || {
            if state.shutdown.load(Ordering::Acquire)
                || state.cancel_current.load(Ordering::Acquire)
            {
                return Err("render cancelled while verifying output".to_string());
            }
            if last_heartbeat.elapsed() >= HEARTBEAT_INTERVAL {
                last_heartbeat = Instant::now();
                match lease_heartbeat_detailed(
                    app,
                    &claimed,
                    "publishing",
                    100,
                    state.enabled.load(Ordering::Acquire),
                ) {
                    Ok(response) => {
                        last_lease_ok = Instant::now();
                        if remote_cancel_requested(&response) {
                            remote_cancelled = true;
                            state.cancel_current.store(true, Ordering::Release);
                            return Err("render cancelled while verifying output".to_string());
                        }
                        if !remote_lease_valid(&response) {
                            lease_lost = true;
                            state.cancel_current.store(true, Ordering::Release);
                            return Err("render lease lost while verifying output".to_string());
                        }
                    }
                    Err(error) if error.lease_is_lost() => {
                        lease_lost = true;
                        return Err(error.public_message);
                    }
                    Err(error) if last_lease_ok.elapsed() >= LEASE_GRACE => {
                        lease_lost = true;
                        return Err(error.public_message);
                    }
                    Err(_) => {}
                }
            }
            Ok(())
        });
        let (size_bytes, sha256) = match hash_result {
            Ok(result) => result,
            Err(error) if lease_lost => {
                return fail_claimed_job(
                    app,
                    state,
                    &claimed,
                    "lease_lost",
                    "Esta máquina perdeu a autorização temporária do render antes de concluir os arquivos.",
                    Some(error),
                )
            }
            Err(error) if state.cancel_current.load(Ordering::Acquire) => {
                let _ = finish_job(
                    app,
                    &job.id,
                    Some(&claimed.lease),
                    "cancelled",
                    cancellation_error_code(remote_cancelled),
                    "Render cancelado.",
                    Some(error),
                );
                clear_local_job(state);
                return Ok(());
            }
            Err(error) => {
                return fail_claimed_job(
                    app,
                    state,
                    &claimed,
                    "lease_lost",
                    "A autorização deste render venceu antes de publicar os arquivos.",
                    Some(error),
                )
            }
        };
        verified_outputs.push((output, temporary, destination, size_bytes, sha256));
    }

    let project_check = sha256_file_with_tick(&project, || {
        if state.shutdown.load(Ordering::Acquire) || state.cancel_current.load(Ordering::Acquire) {
            return Err("render cancelled while rechecking project".to_string());
        }
        if last_heartbeat.elapsed() >= HEARTBEAT_INTERVAL {
            last_heartbeat = Instant::now();
            match lease_heartbeat_detailed(
                app,
                &claimed,
                "publishing",
                100,
                state.enabled.load(Ordering::Acquire),
            ) {
                Ok(response) => {
                    last_lease_ok = Instant::now();
                    if remote_cancel_requested(&response) {
                        remote_cancelled = true;
                        state.cancel_current.store(true, Ordering::Release);
                        return Err("render cancelled while rechecking project".to_string());
                    }
                    if !remote_lease_valid(&response) {
                        lease_lost = true;
                        return Err("render lease lost while rechecking project".to_string());
                    }
                }
                Err(error) if error.lease_is_lost() => {
                    lease_lost = true;
                    return Err(error.public_message);
                }
                Err(error) if last_lease_ok.elapsed() >= LEASE_GRACE => {
                    lease_lost = true;
                    return Err(error.public_message);
                }
                Err(_) => {}
            }
        }
        Ok(())
    });
    match project_check {
        Ok((size, sha256)) if size == job.project_size_bytes && sha256 == job.project_sha256 => {}
        Ok(_) => {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "project_hash_mismatch",
                "O projeto mudou durante o render. Nenhum arquivo final foi substituído.",
                None,
            )
        }
        Err(error) if lease_lost => {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "lease_lost",
                "Esta máquina perdeu a autorização temporária antes de concluir os arquivos.",
                Some(error),
            )
        }
        Err(error) if state.cancel_current.load(Ordering::Acquire) => {
            let _ = finish_job(
                app,
                &job.id,
                Some(&claimed.lease),
                "cancelled",
                cancellation_error_code(remote_cancelled),
                "Render cancelado antes de publicar os arquivos.",
                Some(error),
            );
            return Ok(());
        }
        Err(error) => {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "project_hash_mismatch",
                "Não foi possível confirmar que o projeto permaneceu igual durante o render.",
                Some(error),
            )
        }
    }

    if state.shutdown.load(Ordering::Acquire) || state.cancel_current.load(Ordering::Acquire) {
        let _ = finish_job(
            app,
            &job.id,
            Some(&claimed.lease),
            "cancelled",
            cancellation_error_code(remote_cancelled),
            "Render cancelado antes de publicar os arquivos.",
            None,
        );
        return Ok(());
    }
    if let Err(error) = write_publication_recovery_marker(app, root, &job) {
        return fail_claimed_job(
            app,
            state,
            &claimed,
            "unexpected_failure",
            "Não foi possível preparar a recuperação segura dos arquivos finais.",
            Some(error),
        );
    }

    let mut publication_cancel_fenced = false;
    let publication_result =
        publish_output_set(root, &job.id, &verified_outputs, state.inner(), || {
            let local_cancel_requested = state.shutdown.load(Ordering::Acquire)
                || state.cancel_current.load(Ordering::Acquire);
            if last_heartbeat.elapsed() < HEARTBEAT_INTERVAL {
                if publication_cancel_fenced {
                    return Err("cancelled_fenced: render cancelled during publication".to_string());
                }
                if !local_cancel_requested {
                    return Ok(());
                }
            }
            last_heartbeat = Instant::now();
            match lease_heartbeat_detailed(
                app,
                &claimed,
                "publishing",
                100,
                state.enabled.load(Ordering::Acquire),
            ) {
                Ok(response) => {
                    last_lease_ok = Instant::now();
                    if remote_cancel_requested(&response) {
                        remote_cancelled = true;
                        state.cancel_current.store(true, Ordering::Release);
                    }
                    if !remote_lease_valid(&response) {
                        lease_lost = true;
                        Err("lease_lost: publication lease is no longer valid".to_string())
                    } else if local_cancel_requested || remote_cancelled {
                        publication_cancel_fenced = true;
                        Err("cancelled_fenced: render cancelled during publication".to_string())
                    } else {
                        Ok(())
                    }
                }
                Err(error) if error.lease_is_lost() => {
                    lease_lost = true;
                    Err(format!("lease_lost: {}", error.public_message))
                }
                Err(_) if publication_cancel_fenced && last_lease_ok.elapsed() < LEASE_GRACE => {
                    Err("cancelled_fenced: render cancelled during publication".to_string())
                }
                Err(error) if local_cancel_requested => {
                    Err(format!("cancelled_unfenced: {}", error.public_message))
                }
                Err(error) if last_lease_ok.elapsed() >= LEASE_GRACE => {
                    lease_lost = true;
                    Err(format!("lease_lost: {}", error.public_message))
                }
                Err(_) => Ok(()),
            }
        });
    if publication_result.is_err() && matches!(publication_recovery_exists(root, &job), Ok(false)) {
        let _ = remove_publication_recovery_marker(app, &job.id);
    }
    let publication = match publication_result {
        Ok(publication) => publication,
        Err(error)
            if lease_lost
                || error.starts_with("lease_lost:")
                || error.starts_with("cancelled_unfenced:")
                || error.starts_with("recovery_pending:") => return fail_claimed_job(
            app,
            state,
            &claimed,
            "lease_lost",
            "Esta máquina perdeu a autorização temporária do render antes de concluir os arquivos.",
            Some(error),
        ),
        Err(error) if error.starts_with("output_conflict:") => return fail_claimed_job(
            app,
            state,
            &claimed,
            "output_conflict",
            "Um arquivo final mudou durante a conclusão. Os arquivos anteriores foram preservados.",
            Some(error),
        ),
        Err(error)
            if error.starts_with("cancelled_fenced:")
                && (state.shutdown.load(Ordering::Acquire)
                    || state.cancel_current.load(Ordering::Acquire)) =>
        {
            let _ = finish_job(
                app,
                &job.id,
                Some(&claimed.lease),
                "cancelled",
                cancellation_error_code(remote_cancelled),
                "Render cancelado antes de concluir os arquivos finais.",
                Some(error),
            );
            return Ok(());
        }
        Err(error) => {
            return fail_claimed_job(
                app,
                state,
                &claimed,
                "unexpected_failure",
                "Não foi possível concluir os arquivos finais com segurança.",
                Some(error),
            )
        }
    };

    let outputs = verified_outputs
        .iter()
        .map(|(output, _, _, size_bytes, sha256)| {
            json!({
                "kind": output.kind,
                "destinationRelativePath": output.destination_relative_path,
                "sizeBytes": size_bytes,
                "sha256": sha256,
            })
        })
        .collect::<Vec<_>>();
    let finish_payload = json!({
        "jobId": job.id,
        "leaseId": claimed.lease.id,
        "leaseGeneration": claimed.lease.generation,
        "outcome": "completed",
        "outputs": outputs,
    });
    let finish_result = queue_call_detailed(app, "finish", finish_payload.clone());
    match finish_result {
        Ok(_) => {
            cleanup_publication_backups(&publication)?;
            remove_publication_recovery_marker(app, &job.id)?;
        }
        Err(error) if error.code == "render_cancel_requested" => {
            let cancel_payload = cancelled_finish_payload(&finish_payload)?;
            if let Ok(mut pending) = state.pending_publications.lock() {
                pending.push(PendingPublicationReconciliation {
                    job_id: job.id.clone(),
                    title: job.title.clone(),
                    project: project.clone(),
                    publication,
                    finish_payload: cancel_payload,
                    outcome: "cancelled".to_string(),
                });
            } else {
                return Err(
                    "O cancelamento foi recebido, mas os arquivos finais ainda aguardam recuperação segura."
                        .to_string(),
                );
            }
            reconcile_pending_publication(app, state)?;
            clear_local_job(state);
            let _ = app.emit(
                "arizona-render-queue:changed",
                json!({ "reason": "job_cancelled" }),
            );
            return Ok(());
        }
        Err(error) => {
            let error = error.public_message;
            match queue_call(
                app,
                "status",
                json!({ "includeNextJob": true, "jobId": job.id }),
            ) {
                Ok(status) if remote_job_has_status(&status, &job.id, "completed") => {
                    cleanup_publication_backups(&publication)?;
                    remove_publication_recovery_marker(app, &job.id)?;
                }
                Ok(status) => {
                    let remote_status = status
                        .get("job")
                        .and_then(|job| value_text(job, &["status", "outcome"]));
                    if matches!(remote_status.as_deref(), Some("failed" | "cancelled")) {
                        return match rollback_terminal_publication(&publication) {
                            Ok(()) => {
                                let _ = remove_publication_recovery_marker(app, &job.id);
                                Err(error)
                            }
                            Err(rollback_error) => Err(format!(
                                "{error}; output rollback also failed: {rollback_error}"
                            )),
                        };
                    }
                    if matches!(
                        remote_status.as_deref(),
                        Some("claimed" | "rendering" | "publishing")
                    ) {
                        if let Ok(mut pending) = state.pending_publications.lock() {
                            pending.push(PendingPublicationReconciliation {
                                job_id: job.id.clone(),
                                title: job.title.clone(),
                                project: project.clone(),
                                publication,
                                finish_payload,
                                outcome: "completed".to_string(),
                            });
                        }
                    }
                    // Pending means a new lease generation now owns recovery;
                    // unknown states are also preserved fail-closed.
                    return Err(error);
                }
                Err(_) => {
                    // The finish may have committed before the response was
                    // lost. Keep the outputs and journal, then block new work
                    // until an authoritative lookup reconciles the result.
                    if let Ok(mut pending) = state.pending_publications.lock() {
                        pending.push(PendingPublicationReconciliation {
                            job_id: job.id.clone(),
                            title: job.title.clone(),
                            project: project.clone(),
                            publication,
                            finish_payload,
                            outcome: "completed".to_string(),
                        });
                    }
                    return Err(error);
                }
            }
        }
    }
    let _ = remove_snapshot_file(&project);
    clear_local_job(state);
    let _ = app.emit(
        "arizona-render-queue:changed",
        json!({ "reason": "job_completed" }),
    );
    emit_queue_notice(
        app,
        state.inner(),
        &format!("job_completed:{}", job.id),
        &completed_outputs_message(&job.title, &job.outputs),
        "success",
    );
    if let Some(started_at) = execution_started_at {
        diagnostics::info(
            app,
            "fila_render",
            "executar",
            "completed",
            "Render concluído e arquivos finais publicados.",
            Some(json!({
                "durationMillis": started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
                "outputCount": job.outputs.len(),
            })),
        );
    }
    Ok(())
}

fn fail_claimed_job(
    app: &AppHandle,
    state: &State<RenderQueueState>,
    claimed: &ClaimedJob,
    code: &str,
    public_message: &str,
    technical_message: Option<String>,
) -> Result<(), String> {
    if code == "lease_lost" {
        emit_queue_notice(
            app,
            state.inner(),
            &format!("job_interrupted:{}:{code}", claimed.job.id),
            "Este render foi interrompido com segurança. A fila verificará se ele pode ser retomado.",
            "warning",
        );
        diagnostics::warning(
            app,
            "fila_render",
            "executar",
            "interrupted",
            code,
            public_message,
            technical_message.map(|message| json!({ "technicalMessage": message })),
        );
        clear_local_job(state);
        return Ok(());
    }
    emit_queue_notice(
        app,
        state.inner(),
        &format!("job_failed:{}:{code}", claimed.job.id),
        public_message,
        "error",
    );
    if let Some(technical_message) = technical_message.as_deref() {
        diagnostics::error(
            app,
            "fila_render",
            "executar",
            code,
            public_message,
            Some(json!({ "technicalMessage": technical_message })),
        );
    }
    let result = finish_job(
        app,
        &claimed.job.id,
        Some(&claimed.lease),
        "failed",
        code,
        public_message,
        None,
    );
    clear_local_job(state);
    result
}

fn finish_job(
    app: &AppHandle,
    job_id: &str,
    lease: Option<&Lease>,
    status: &str,
    code: &str,
    message: &str,
    local_detail: Option<String>,
) -> Result<(), String> {
    if let Some(detail) = local_detail.filter(|detail| !detail.is_empty()) {
        diagnostics::warning(
            app,
            "fila_render",
            "finalizar",
            status,
            code,
            message,
            Some(json!({ "technicalMessage": detail })),
        );
    }
    queue_call(
        app,
        "finish",
        json!({
            "jobId": job_id,
            "leaseId": lease.map(|lease| lease.id.as_str()),
            "leaseGeneration": lease.map(|lease| lease.generation),
            "outcome": status,
            "errorCode": code,
        }),
    )?;
    Ok(())
}

fn cancellation_error_code(remote_cancelled: bool) -> &'static str {
    if remote_cancelled {
        "cancelled_by_requester"
    } else {
        "cancelled_by_worker"
    }
}

fn lease_heartbeat(
    app: &AppHandle,
    claimed: &ClaimedJob,
    stage: &str,
    progress: u8,
    accepting_jobs: bool,
) -> Result<Value, String> {
    lease_heartbeat_detailed(app, claimed, stage, progress, accepting_jobs)
        .map_err(|error| error.public_message)
}

fn lease_heartbeat_detailed(
    app: &AppHandle,
    claimed: &ClaimedJob,
    stage: &str,
    progress: u8,
    accepting_jobs: bool,
) -> Result<Value, QueueCallFailure> {
    queue_call_detailed(
        app,
        "heartbeat",
        json!({
            "enabled": accepting_jobs,
            "availability": if accepting_jobs { "available" } else { "unavailable" },
            "jobId": claimed.job.id,
            "leaseId": claimed.lease.id,
            "leaseGeneration": claimed.lease.generation,
            "stage": stage,
            "progressPercent": progress,
            "statusMessage": stage_message(stage, &claimed.job.outputs),
        }),
    )
}

fn stage_message(stage: &str, outputs: &[RenderOutput]) -> String {
    match stage {
        "waiting_for_sync" => "Aguardando a sincronização do projeto.".to_string(),
        "rendering_proxy" => "Renderizando o arquivo MOV na máquina escolhida.".to_string(),
        "rendering_mp4" => "Renderizando o arquivo MP4 na máquina escolhida.".to_string(),
        "publishing" => match requested_output_flags(outputs) {
            (true, true) => "Finalizando os arquivos MOV e MP4.".to_string(),
            (true, false) => "Finalizando o arquivo MOV.".to_string(),
            (false, true) => "Finalizando o arquivo MP4.".to_string(),
            _ => "Finalizando o render.".to_string(),
        },
        _ => "Atualizando o estado do render.".to_string(),
    }
}

fn status_value(app: &AppHandle) -> Result<Value, String> {
    let remote = queue_call(app, "status", json!({ "includeNextJob": true }))?;
    Ok(merge_local_status(app, remote))
}

fn merge_local_status(app: &AppHandle, remote: Value) -> Value {
    let state = app.state::<RenderQueueState>();
    let enabled = state.enabled.load(Ordering::Acquire);
    let snapshot = state.snapshot.lock().ok();
    let current_job = snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.current_job_id.as_ref())
        .map(|id| {
            json!({
                "id": id,
                "title": snapshot.as_ref().and_then(|snapshot| snapshot.current_job_title.as_deref()),
            })
        });
    let mut local = json!({
        "enabled": enabled,
        "availability": snapshot.as_ref().map(|value| value.availability.as_str()).unwrap_or("disabled"),
        "readiness": snapshot.as_ref().map(|value| value.readiness.as_str()).unwrap_or("unknown"),
        "currentJob": current_job,
        "warnings": snapshot.as_ref().and_then(|value| value.warning.as_ref()).map(|message| vec![json!({ "message": message, "tone": "warning" })]).unwrap_or_default(),
    });

    let mut object = remote.as_object().cloned().unwrap_or_default();
    let remote_worker = object.get("worker").and_then(Value::as_object);
    let local_device_id = remote_worker
        .and_then(|worker| worker.get("deviceId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let local_member_id = remote_worker
        .and_then(|worker| worker.get("memberId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if let (Some(local), Some(remote_worker)) = (local.as_object_mut(), remote_worker) {
        for (local_key, remote_key) in [
            ("id", "deviceId"),
            ("deviceId", "deviceId"),
            ("name", "deviceLabel"),
            ("deviceLabel", "deviceLabel"),
            ("memberId", "memberId"),
            ("memberName", "memberName"),
            ("acceptingJobs", "acceptingJobs"),
            ("queueDepth", "queueDepth"),
            ("heartbeatAt", "heartbeatAt"),
        ] {
            if let Some(value) = remote_worker.get(remote_key) {
                local.insert(local_key.to_string(), value.clone());
            }
        }
    }
    let visible_jobs = object
        .get("jobs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let sent = visible_jobs
        .iter()
        .filter(|job| {
            value_text(job, &["requesterMemberId", "requester_member_id"])
                .is_some_and(|id| id == local_member_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut received = visible_jobs
        .iter()
        .filter(|job| job_targets_device(job, local_device_id))
        .cloned()
        .collect::<Vec<_>>();
    // The general history is intentionally bounded by the service. These two
    // authoritative entries keep the next/active received job visible even if
    // a member has more history than that window.
    for key in ["nextJob", "recoverableJob"] {
        if let Some(job) = object.get(key).filter(|job| job.is_object()) {
            if job_targets_device(job, local_device_id) {
                let job_id = value_text(job, &["id", "jobId", "job_id"]);
                if !received
                    .iter()
                    .any(|known| value_text(known, &["id", "jobId", "job_id"]) == job_id)
                {
                    received.push(job.clone());
                }
            }
        }
    }
    state
        .received_work_pending
        .store(received.iter().any(job_is_nonterminal), Ordering::Release);
    object.insert("sentJobs".to_string(), Value::Array(sent));
    object.insert("receivedJobs".to_string(), Value::Array(received));
    object.insert("thisMachine".to_string(), local);
    if let Ok(prefill) = state.prefill.lock() {
        object.insert(
            "prefill".to_string(),
            json!({ "jobaoCod": prefill.0.clone(), "jobinhoCod": prefill.1.clone() }),
        );
    }
    Value::Object(object)
}

#[derive(Debug)]
struct QueueCallFailure {
    code: String,
    public_message: String,
}

impl QueueCallFailure {
    fn local(message: String) -> Self {
        Self {
            code: "local_access".to_string(),
            public_message: message,
        }
    }

    fn lease_is_lost(&self) -> bool {
        matches!(
            self.code.as_str(),
            "render_lease_lost"
                | "render_job_not_found"
                | "render_worker_session_invalid"
                | "device_not_active"
                | "member_not_authorized"
                | "license_expired"
                | "organization_not_active"
        )
    }

    fn pending_job_is_gone(&self) -> bool {
        matches!(
            self.code.as_str(),
            "render_job_not_pending"
                | "render_job_not_found"
                | "render_job_not_next"
                | "render_worker_session_invalid"
        )
    }
}

fn queue_call(app: &AppHandle, action: &str, payload: Value) -> Result<Value, String> {
    queue_call_detailed(app, action, payload).map_err(|error| error.public_message)
}

fn queue_call_detailed(
    app: &AppHandle,
    action: &str,
    payload: Value,
) -> Result<Value, QueueCallFailure> {
    let access_token = require_queue_access(app).map_err(QueueCallFailure::local)?;
    let mut object = payload.as_object().cloned().unwrap_or_default();
    object.insert("action".to_string(), Value::String(action.to_string()));
    object.insert(
        "installId".to_string(),
        Value::String(load_or_create_install_id(app).map_err(QueueCallFailure::local)?),
    );
    object.insert(
        "deviceFingerprintHash".to_string(),
        Value::String(device_identity::device_fingerprint_hash()),
    );
    object.insert(
        "deviceLabel".to_string(),
        Value::String(
            std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Este computador".to_string()),
        ),
    );
    object.insert(
        "workerSessionId".to_string(),
        Value::String(app.state::<RenderQueueState>().worker_session_id.clone()),
    );
    object.insert(
        "appVersion".to_string(),
        Value::String(app.package_info().version.to_string()),
    );
    object.insert(
        "protocolVersion".to_string(),
        Value::Number(PROTOCOL_VERSION.into()),
    );
    object.insert(
        "recipe".to_string(),
        Value::String(RECIPE_VERSION.to_string()),
    );
    if let Ok(config) = settings::load(app) {
        if let Ok(year) = config.ae_version.trim().parse::<u64>() {
            if (2020..=2100).contains(&year) {
                object.insert("afterEffectsYear".to_string(), Value::Number(year.into()));
            }
        }
    }

    auth::function_value(FUNCTION_NAME, &access_token, Value::Object(object)).map_err(|error| {
        let public_message = public_queue_error(&error.code);
        diagnostics::warning(
            app,
            "fila_render",
            action,
            "failed",
            &error.code,
            "A fila de renderização não respondeu como esperado.",
            Some(json!({ "technicalMessage": error.message })),
        );
        QueueCallFailure {
            code: error.code,
            public_message,
        }
    })
}

fn require_queue_access(app: &AppHandle) -> Result<String, String> {
    let auth_state = app.state::<AuthState>();
    let session = authenticated_session(&auth_state)?;
    if !license_status_from_session(Some(&session)).licensed {
        return Err("Confirme seu acesso ao Arizona para usar a fila.".to_string());
    }
    session
        .access_token
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "Confirme seu acesso ao Arizona para usar a fila.".to_string())
}

fn public_queue_error(code: &str) -> String {
    match code {
        "network_error" => {
            "Não foi possível acessar a fila agora. Confira a conexão e tente novamente.".to_string()
        }
        "target_worker_unavailable"
        | "worker_unavailable"
        | "render_target_worker_not_found"
        | "render_worker_not_available" => {
            "A máquina escolhida não está mais disponível. Atualize a lista ou escolha outra."
                .to_string()
        }
        "job_already_active" | "render_worker_already_busy" | "render_job_in_progress" => {
            "Este trabalho já está sendo processado. Atualize a fila para ver o estado atual."
                .to_string()
        }
        "render_worker_session_invalid" => {
            "A disponibilidade desta máquina terminou. Desligue e ligue novamente o botão para continuar."
                .to_string()
        }
        "render_job_not_found" => {
            "Este trabalho não está mais na fila. Atualize a lista para ver o estado atual."
                .to_string()
        }
        "render_job_not_next" => {
            "Há outro trabalho antes deste na máquina escolhida. Aguarde a ordem da fila."
                .to_string()
        }
        "render_job_not_pending" => {
            "Este trabalho não está mais aguardando. Atualize a fila para ver o que aconteceu."
                .to_string()
        }
        "render_job_already_finished" => {
            "Este trabalho já foi encerrado. Atualize a fila para ver o resultado.".to_string()
        }
        "render_cancel_not_allowed" => {
            "Este trabalho só pode ser cancelado por uma das máquinas relacionadas.".to_string()
        }
        "render_cancel_requested" => {
            "O cancelamento já foi recebido. A máquina está preservando os arquivos anteriores."
                .to_string()
        }
        "render_reassign_not_allowed" => {
            "Somente quem enviou este trabalho pode escolher outra máquina.".to_string()
        }
        "render_output_destination_in_use" => {
            "Outro render já está usando um dos arquivos finais escolhidos. Aguarde a conclusão ou cancele o trabalho anterior."
                .to_string()
        }
        "output_conflict" | "render_output_conflict" => {
            "Um arquivo final mudou depois da confirmação. Revise antes de tentar novamente."
                .to_string()
        }
        "render_attempt_limit_reached" => {
            "Este render foi interrompido várias vezes. Envie o projeto novamente quando a máquina estiver estável."
                .to_string()
        }
        "render_lease_lost" => {
            "A conexão deste trabalho foi interrompida e a máquina parou o render com segurança."
                .to_string()
        }
        "render_project_hash_mismatch" => {
            "O projeto ainda não chegou por completo à máquina escolhida.".to_string()
        }
        "rate_limited" => {
            "A fila recebeu muitas atualizações seguidas. Aguarde um pouco e tente novamente."
                .to_string()
        }
        "render_idempotency_conflict" => {
            "As informações deste envio mudaram. Localize o projeto novamente e faça um novo envio."
                .to_string()
        }
        "unsupported_render_recipe" | "unsupported_worker_protocol" => {
            "Esta máquina precisa de uma versão mais recente do Arizona para receber este render."
                .to_string()
        }
        "license_expired" | "organization_not_active" | "member_not_authorized" => {
            "Seu acesso não permite usar a fila neste momento.".to_string()
        }
        _ => "Não foi possível atualizar a fila agora. Tente novamente.".to_string(),
    }
}

fn resolve_candidates(
    app: &AppHandle,
    jobao_cod: &str,
    jobinho_cod: &str,
) -> Result<Vec<CandidateInfo>, String> {
    let jobao_cod = jobao_cod.trim();
    let jobinho_cod = jobinho_cod.trim();
    if jobao_cod.is_empty() || jobinho_cod.is_empty() {
        return Err("Informe o Jobão e o Jobinho para localizar o projeto.".to_string());
    }
    let config = settings::load(app).map_err(|_| {
        "Confira a pasta compartilhada nas configurações antes de procurar o projeto.".to_string()
    })?;
    if config.drive.trim().is_empty() {
        return Err(
            "Escolha a pasta compartilhada nas configurações antes de procurar o projeto."
                .to_string(),
        );
    }
    let root = canonical_drive_root_from(&config.drive)?;
    let projects = Arizona::new(config)
        .project_candidates(jobao_cod, jobinho_cod)
        .map_err(|_| "Não encontrei um projeto para esses códigos.".to_string())?;

    projects
        .into_iter()
        .map(|project| {
            let source_path = fs::canonicalize(&project.ae_project_path).map_err(|_| {
                "O projeto foi encontrado, mas não está acessível nesta máquina.".to_string()
            })?;
            ensure_inside_root(&root, &source_path)?;
            let output_paths = official_output_paths(&source_path)?;
            let existing_outputs = [
                ("MOV", output_paths[0].is_file()),
                ("MP4", output_paths[1].is_file()),
            ]
            .into_iter()
            .filter_map(|(label, exists)| exists.then_some(label.to_string()))
            .collect::<Vec<_>>();
            Ok(CandidateInfo {
                relative_path: relative_protocol_path(&root, &source_path)?,
                file_name: source_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Projeto do After Effects")
                    .to_string(),
                title: project.project_title,
                region: project.region,
                mov_relative_path: relative_protocol_path(&root, &output_paths[0])?,
                mp4_relative_path: relative_protocol_path(&root, &output_paths[1])?,
                existing_outputs,
                source_path,
                output_paths,
            })
        })
        .collect()
}

struct SnapshotInfo {
    path: PathBuf,
    relative_path: String,
    size_bytes: u64,
    sha256: String,
}

fn create_snapshot(root: &Path, source: &Path, id: &str) -> Result<SnapshotInfo, String> {
    let source_before = fs::metadata(source)
        .map_err(|_| "Não foi possível ler a versão salva do projeto.".to_string())?;
    if !source_before.is_file() || source_before.len() == 0 {
        return Err("O projeto salvo está vazio ou indisponível.".to_string());
    }
    let source_parent = source
        .parent()
        .ok_or_else(|| "A pasta do projeto não foi encontrada.".to_string())?;
    let snapshot_directory = source_parent.join(".arizona-render").join(id);
    fs::create_dir_all(&snapshot_directory)
        .map_err(|_| "Não foi possível preparar uma cópia segura do projeto.".to_string())?;
    let canonical_snapshot_directory = fs::canonicalize(&snapshot_directory)
        .map_err(|_| "Não foi possível preparar uma cópia segura do projeto.".to_string())?;
    ensure_inside_root(root, &canonical_snapshot_directory)?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "O nome do projeto não foi reconhecido.".to_string())?;
    let destination = canonical_snapshot_directory.join(file_name);
    if destination.exists() {
        ensure_safe_destination(root, &destination)?;
        let metadata = fs::metadata(&destination)
            .map_err(|_| "Não foi possível conferir a cópia segura já preparada.".to_string())?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err("A cópia segura já preparada não é válida.".to_string());
        }
        let canonical_destination = fs::canonicalize(&destination)
            .map_err(|_| "Não foi possível conferir a cópia segura já preparada.".to_string())?;
        ensure_inside_root(root, &canonical_destination)?;
        let (size_bytes, sha256) = sha256_file(&canonical_destination)
            .map_err(|_| "Não foi possível conferir a cópia segura já preparada.".to_string())?;
        let relative_path = relative_protocol_path(root, &canonical_destination)?;
        return Ok(SnapshotInfo {
            path: canonical_destination,
            relative_path,
            size_bytes,
            sha256,
        });
    }
    let temporary = canonical_snapshot_directory.join(format!(
        ".{}.part-{}",
        file_name.to_string_lossy(),
        random_uuid_v4()
    ));

    let result = (|| {
        fs::copy(source, &temporary)
            .map_err(|_| "Não foi possível copiar a versão salva do projeto.".to_string())?;
        File::options()
            .write(true)
            .open(&temporary)
            .and_then(|file| file.sync_all())
            .map_err(|_| "Não foi possível concluir a cópia segura do projeto.".to_string())?;
        let (size_bytes, sha256) = sha256_file(&temporary)
            .map_err(|_| "Não foi possível conferir a cópia segura do projeto.".to_string())?;
        let source_after = fs::metadata(source).map_err(|_| {
            "O projeto mudou enquanto era preparado. Salve e tente novamente.".to_string()
        })?;
        if source_before.len() != source_after.len()
            || source_before.modified().ok() != source_after.modified().ok()
            || size_bytes != source_before.len()
        {
            return Err(
                "O projeto mudou enquanto era preparado. Salve e tente novamente.".to_string(),
            );
        }
        fs::rename(&temporary, &destination)
            .map_err(|_| "Não foi possível publicar a cópia segura do projeto.".to_string())?;
        let relative_path = relative_protocol_path(root, &destination)?;
        Ok(SnapshotInfo {
            path: destination,
            relative_path,
            size_bytes,
            sha256,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_dir(&snapshot_directory);
    }
    result
}

fn remove_snapshot_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir(parent);
        if let Some(root) = parent.parent() {
            let _ = fs::remove_dir(root);
        }
    }
    Ok(())
}

fn submission_rejection_guarantees_no_job(code: &str) -> bool {
    // These responses are emitted only after the idempotent existing-job
    // return and before INSERT in render_create_job. Other failures (including
    // auth, rate limiting, malformed responses and timeouts) are deliberately
    // ambiguous and must retain the snapshot referenced by a possible commit.
    matches!(
        code,
        "render_target_worker_not_found"
            | "render_worker_not_available"
            | "render_output_destination_in_use"
    )
}

fn official_output_paths(project: &Path) -> Result<[PathBuf; 2], String> {
    let parent = project
        .parent()
        .ok_or_else(|| "A pasta do projeto não foi encontrada.".to_string())?;
    let stem = project
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .ok_or_else(|| "O nome do projeto não foi reconhecido.".to_string())?;
    let is_cla = stem
        .split('_')
        .next()
        .unwrap_or_default()
        .chars()
        .take(3)
        .collect::<String>()
        .eq_ignore_ascii_case("CLA");
    let base = if is_cla {
        parent.parent()
    } else {
        parent.parent().and_then(Path::parent)
    }
    .ok_or_else(|| "A estrutura de pastas deste projeto não foi reconhecida.".to_string())?;
    if is_cla {
        Ok([
            base.join("OUT").join(format!("{stem}.mov")),
            base.join("OUT").join(format!("{stem}.mp4")),
        ])
    } else {
        Ok([
            base.join("OUT")
                .join("RENDER")
                .join("MOV")
                .join(format!("{stem}.mov")),
            base.join("OUT")
                .join("RENDER")
                .join("MP4")
                .join(format!("{stem}.mp4")),
        ])
    }
}

fn canonical_drive_root(app: &AppHandle) -> Result<PathBuf, String> {
    let config = settings::load(app).map_err(|_| {
        "Confira a pasta compartilhada nas configurações antes de continuar.".to_string()
    })?;
    if config.drive.trim().is_empty() {
        return Err(
            "Escolha a pasta compartilhada nas configurações antes de continuar.".to_string(),
        );
    }
    canonical_drive_root_from(&config.drive)
}

fn canonical_drive_root_from(value: &str) -> Result<PathBuf, String> {
    fs::canonicalize(Path::new(value.trim()))
        .map_err(|_| "A pasta compartilhada não está acessível nesta máquina.".to_string())
}

fn relative_protocol_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "O arquivo fica fora da pasta compartilhada configurada.".to_string())?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            _ => return Err("O caminho do arquivo não é seguro para a fila.".to_string()),
        }
    }
    if parts.is_empty() {
        return Err("O caminho do arquivo não foi reconhecido.".to_string());
    }
    Ok(parts.join("/"))
}

fn resolve_protocol_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = relative.trim().replace('\\', "/");
    if relative.is_empty() || relative.starts_with('/') || relative.contains(':') {
        return Err("O caminho recebido para o render não é válido.".to_string());
    }
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err("O caminho recebido para o render não é válido.".to_string());
        }
        path.push(part);
    }
    Ok(path)
}

fn ensure_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let inside = path.to_string_lossy().to_lowercase().starts_with(&format!(
        "{}\\",
        root.to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .to_lowercase()
    )) || paths_equal(root, path);
    #[cfg(not(windows))]
    let inside = path.starts_with(root);
    if inside {
        Ok(())
    } else {
        Err("O arquivo fica fora da pasta compartilhada configurada.".to_string())
    }
}

fn paths_match(left: &str, right: &str) -> bool {
    left.replace('\\', "/")
        .eq_ignore_ascii_case(&right.trim().replace('\\', "/"))
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn sha256_file(path: &Path) -> io::Result<(u64, String)> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut total = 0_u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        digest.update(&buffer[..read]);
    }
    Ok((total, format!("{:x}", digest.finalize())))
}

fn sha256_file_with_tick<F>(path: &Path, mut tick: F) -> Result<(u64, String), String>
where
    F: FnMut() -> Result<(), String>,
{
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut total = 0_u64;
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        digest.update(&buffer[..read]);
        tick()?;
    }
    Ok((total, format!("{:x}", digest.finalize())))
}

#[derive(Debug)]
enum VerifySnapshotError {
    Waiting,
    Invalid(String),
    Interrupted(String),
}

fn verify_snapshot(root: &Path, job: &PendingJob) -> Result<PathBuf, VerifySnapshotError> {
    match verify_snapshot_with_tick(root, job, || Ok(())) {
        Err(VerifySnapshotError::Interrupted(_)) => Err(VerifySnapshotError::Waiting),
        result => result,
    }
}

fn verify_snapshot_with_tick(
    root: &Path,
    job: &PendingJob,
    mut on_tick: impl FnMut() -> Result<(), String>,
) -> Result<PathBuf, VerifySnapshotError> {
    let path = resolve_protocol_path(root, &job.project_relative_path)
        .map_err(VerifySnapshotError::Invalid)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            VerifySnapshotError::Waiting
        } else {
            VerifySnapshotError::Waiting
        }
    })?;
    if !metadata.is_file() || metadata.len() != job.project_size_bytes {
        return Err(VerifySnapshotError::Waiting);
    }
    let canonical = fs::canonicalize(&path).map_err(|_| VerifySnapshotError::Waiting)?;
    ensure_inside_root(root, &canonical).map_err(VerifySnapshotError::Invalid)?;
    let (_, hash) = sha256_file_with_tick(&canonical, &mut on_tick)
        .map_err(VerifySnapshotError::Interrupted)?;
    if !hash.eq_ignore_ascii_case(&job.project_sha256) {
        // Google Drive can briefly expose a previous generation with the same
        // size. Keep waiting; the timeout is what turns a permanent mismatch
        // into a user-visible failure.
        return Err(VerifySnapshotError::Waiting);
    }
    Ok(canonical)
}

fn render_attempt_path(
    root: &Path,
    destination: &Path,
    job_id: &str,
    attempt: &str,
) -> Result<PathBuf, String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "A pasta final do render não foi reconhecida.".to_string())?;
    let name = destination
        .file_name()
        .ok_or_else(|| "O nome final do render não foi reconhecido.".to_string())?;
    let path = parent
        .join(".arizona-render")
        .join(clean_path_component(job_id))
        .join(clean_path_component(attempt))
        .join(name);
    ensure_inside_root(root, &path)?;
    ensure_safe_destination(root, &path)?;
    Ok(path)
}

#[derive(Clone, Debug)]
struct PublicationRecord {
    destination: PathBuf,
    backup: PathBuf,
    journal: PathBuf,
    original_existed: bool,
    original_fingerprint: Option<String>,
    published_by_us: bool,
    published_sha256: String,
}

fn publication_record(
    destination: &Path,
    job_id: &str,
    published_sha256: &str,
) -> Result<PublicationRecord, String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "A pasta final do render não foi reconhecida.".to_string())?;
    let file_name = destination
        .file_name()
        .ok_or_else(|| "O nome final do render não foi reconhecido.".to_string())?;
    let directory = parent
        .join(".arizona-render")
        .join(clean_path_component(job_id))
        .join("publication-backup");
    Ok(PublicationRecord {
        destination: destination.to_path_buf(),
        backup: directory.join(file_name),
        journal: directory.join(format!(".{}.publication", file_name.to_string_lossy())),
        original_existed: false,
        original_fingerprint: None,
        published_by_us: false,
        published_sha256: published_sha256.to_string(),
    })
}

fn publication_recovery_exists(root: &Path, job: &PendingJob) -> Result<bool, String> {
    for output in &job.outputs {
        let destination = resolve_protocol_path(root, &output.destination_relative_path)?;
        ensure_safe_destination(root, &destination)?;
        let record = publication_record(&destination, &job.id, "")?;
        if record.backup.exists() || record.journal.exists() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_no_foreign_publication_journal(
    root: &Path,
    destination: &Path,
    current_job_id: &str,
) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "A pasta final do render não foi reconhecida.".to_string())?;
    let render_directory = parent.join(".arizona-render");
    let entries = match fs::read_dir(&render_directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(_) => {
            return Err(
                "Não foi possível conferir tentativas anteriores neste destino.".to_string(),
            )
        }
    };
    let file_name = destination
        .file_name()
        .ok_or_else(|| "O nome final do render não foi reconhecido.".to_string())?;
    for (index, entry) in entries.enumerate() {
        if index >= 2048 {
            return Err(
                "Há tentativas demais aguardando revisão nesta pasta de saída.".to_string(),
            );
        }
        let entry = entry.map_err(|_| {
            "Não foi possível conferir tentativas anteriores neste destino.".to_string()
        })?;
        if entry.file_name().to_string_lossy() == current_job_id {
            continue;
        }
        let recovery_directory = entry.path().join("publication-backup");
        if !recovery_directory.exists() {
            continue;
        }
        let canonical = fs::canonicalize(&recovery_directory).map_err(|_| {
            "Uma recuperação anterior desta saída não pôde ser validada.".to_string()
        })?;
        ensure_inside_root(root, &canonical)?;
        let journal =
            recovery_directory.join(format!(".{}.publication", file_name.to_string_lossy()));
        if journal.is_file() {
            return Err(
                "output_conflict: another render still owns recovery for this destination"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn recover_interrupted_publication(
    root: &Path,
    job: &PendingJob,
    mut on_tick: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    for output in &job.outputs {
        let destination = resolve_protocol_path(root, &output.destination_relative_path)?;
        ensure_safe_destination(root, &destination)?;
        let record = publication_record(&destination, &job.id, "")?;
        if !record.backup.exists() && !record.journal.exists() {
            continue;
        }

        let journal_directory = record
            .journal
            .parent()
            .ok_or_else(|| "A recuperação dos arquivos finais não é segura.".to_string())?;
        let canonical_directory = fs::canonicalize(journal_directory)
            .map_err(|_| "A recuperação dos arquivos finais não é segura.".to_string())?;
        ensure_inside_root(root, &canonical_directory)?;
        ensure_safe_destination(root, &record.backup)?;
        ensure_safe_destination(root, &record.journal)?;

        let published_sha256 = read_publication_journal(&record.journal)?;
        let published_fingerprint = format!("sha256:{published_sha256}");
        let current_fingerprint =
            destination_fingerprint_with_tick(&record.destination, &mut on_tick)?;
        if record.backup.exists() {
            let expected_backup = output.existing_fingerprint.as_deref().ok_or_else(|| {
                "A cópia anterior do arquivo final não corresponde ao trabalho recebido."
                    .to_string()
            })?;
            if destination_fingerprint_with_tick(&record.backup, &mut on_tick)?.as_deref()
                != Some(expected_backup)
            {
                return Err(
                    "A cópia anterior do arquivo final mudou e não foi restaurada automaticamente."
                        .to_string(),
                );
            }
            if current_fingerprint
                .as_deref()
                .is_some_and(|fingerprint| fingerprint != published_fingerprint)
            {
                on_tick()?;
                preserve_conflicting_destination(&record)?;
            }
            on_tick()?;
            diagnostics::replace_file(&record.backup, &record.destination)
                .map_err(|_| "Não foi possível restaurar o arquivo final anterior.".to_string())?;
        } else if current_fingerprint.as_deref() == Some(published_fingerprint.as_str()) {
            on_tick()?;
            fs::remove_file(&record.destination).map_err(|_| {
                "Não foi possível desfazer uma publicação interrompida.".to_string()
            })?;
        }
        on_tick()?;
        fs::remove_file(&record.journal).map_err(|_| {
            "Não foi possível concluir a recuperação dos arquivos finais.".to_string()
        })?;
    }
    Ok(())
}

fn recover_terminal_publication(root: &Path, job: &PendingJob) -> Result<(), String> {
    for output in &job.outputs {
        let destination = resolve_protocol_path(root, &output.destination_relative_path)?;
        ensure_safe_destination(root, &destination)?;
        let record = publication_record(&destination, &job.id, "")?;
        if !record.backup.exists() && !record.journal.exists() {
            continue;
        }

        let journal_directory = record
            .journal
            .parent()
            .ok_or_else(|| "A recuperação dos arquivos finais não é segura.".to_string())?;
        let canonical_directory = fs::canonicalize(journal_directory)
            .map_err(|_| "A recuperação dos arquivos finais não é segura.".to_string())?;
        ensure_inside_root(root, &canonical_directory)?;
        ensure_safe_destination(root, &record.backup)?;
        ensure_safe_destination(root, &record.journal)?;

        let published_sha256 = read_publication_journal(&record.journal)?;
        let published_fingerprint = format!("sha256:{published_sha256}");
        let current_fingerprint = destination_fingerprint(&record.destination)?;
        if record.backup.exists() {
            let expected_backup = output.existing_fingerprint.as_deref().ok_or_else(|| {
                "A cópia anterior do arquivo final não corresponde ao trabalho recebido."
                    .to_string()
            })?;
            if destination_fingerprint(&record.backup)?.as_deref() != Some(expected_backup) {
                return Err(
                    "A cópia anterior do arquivo final mudou e foi preservada para revisão."
                        .to_string(),
                );
            }
            if current_fingerprint
                .as_deref()
                .is_some_and(|fingerprint| fingerprint != published_fingerprint)
            {
                return Err(
                    "Outro arquivo passou a ocupar o destino final; nada foi substituído durante a recuperação."
                        .to_string(),
                );
            }
            diagnostics::replace_file(&record.backup, &record.destination)
                .map_err(|_| "Não foi possível restaurar o arquivo final anterior.".to_string())?;
        } else {
            match current_fingerprint.as_deref() {
                Some(fingerprint)
                    if fingerprint == published_fingerprint
                        && output.existing_fingerprint.is_none() =>
                {
                    fs::remove_file(&record.destination).map_err(|_| {
                        "Não foi possível desfazer a publicação interrompida.".to_string()
                    })?;
                }
                Some(fingerprint)
                    if output.existing_fingerprint.as_deref() == Some(fingerprint) => {}
                None if output.existing_fingerprint.is_none() => {}
                Some(_) => {
                    return Err(
                        "Outro arquivo passou a ocupar o destino final; nada foi removido durante a recuperação."
                            .to_string(),
                    )
                }
                None => {
                    return Err(
                        "A cópia anterior do arquivo final não foi encontrada; nada foi alterado durante a recuperação."
                            .to_string(),
                    )
                }
            }
        }
        fs::remove_file(&record.journal).map_err(|_| {
            "Não foi possível concluir a recuperação dos arquivos finais.".to_string()
        })?;
    }
    Ok(())
}

fn publish_output_set(
    root: &Path,
    job_id: &str,
    outputs: &[(RenderOutput, PathBuf, PathBuf, u64, String)],
    state: &RenderQueueState,
    mut on_tick: impl FnMut() -> Result<(), String>,
) -> Result<Vec<PublicationRecord>, String> {
    let mut planned = Vec::new();
    for (_, _, destination, _, published_sha256) in outputs {
        ensure_safe_destination(root, destination)?;
        ensure_no_foreign_publication_journal(root, destination, job_id)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let record = publication_record(destination, job_id, published_sha256)?;
        let directory = record
            .backup
            .parent()
            .ok_or_else(|| "A pasta temporária do render não foi reconhecida.".to_string())?;
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let canonical_directory = fs::canonicalize(directory).map_err(|error| error.to_string())?;
        ensure_inside_root(root, &canonical_directory)?;
        planned.push(record);
    }

    let mut records = Vec::new();
    for ((output, _, _, _, _), mut record) in outputs.iter().zip(planned) {
        let destination = &record.destination;
        if let Err(error) = ensure_safe_destination(root, destination) {
            return Err(with_rollback_error(error, &records, &mut on_tick));
        }
        match destination_still_matches_with_tick(
            destination,
            output.replace_existing,
            output.existing_fingerprint.as_deref(),
            &mut on_tick,
        ) {
            Ok(true) => {}
            Ok(false) => {
                return Err(with_rollback_error(
                    "output_conflict: render output changed immediately before publication"
                        .to_string(),
                    &records,
                    &mut on_tick,
                ))
            }
            Err(error) => return Err(with_rollback_error(error, &records, &mut on_tick)),
        }

        record.original_existed = output.existing_fingerprint.is_some();
        record.original_fingerprint = output.existing_fingerprint.clone();
        if let Err(error) = write_publication_journal(&record) {
            return Err(with_rollback_error(
                format!("failed to prepare output publication: {error}"),
                &records,
                &mut on_tick,
            ));
        }
        if record.original_existed {
            if let Err(error) = on_tick() {
                if !error.starts_with("lease_lost:") && !error.starts_with("cancelled_unfenced:") {
                    let _ = fs::remove_file(&record.journal);
                }
                return Err(with_rollback_error(error, &records, &mut on_tick));
            }
            if let Err(error) = fs::rename(destination, &record.backup) {
                let _ = fs::remove_file(&record.journal);
                return Err(with_rollback_error(
                    format!("failed to preserve previous output: {error}"),
                    &records,
                    &mut on_tick,
                ));
            }
        }
        records.push(record);

        if let Some(expected) = output.existing_fingerprint.as_deref() {
            match destination_fingerprint_with_tick(
                &records.last().expect("record was pushed").backup,
                &mut on_tick,
            ) {
                Ok(Some(actual)) if actual == expected => {}
                Ok(_) => return Err(with_rollback_error(
                    "output_conflict: render output changed while publication was being prepared"
                        .to_string(),
                    &records,
                    &mut on_tick,
                )),
                Err(error) => return Err(with_rollback_error(error, &records, &mut on_tick)),
            }
        }
    }

    if state.shutdown.load(Ordering::Acquire) || state.cancel_current.load(Ordering::Acquire) {
        let cancellation = on_tick().err().unwrap_or_else(|| {
            "cancelled_fenced: render stopped before output publication".to_string()
        });
        return Err(with_rollback_error(cancellation, &records, &mut on_tick));
    }

    if let Err(error) = on_tick() {
        return Err(with_rollback_error(error, &records, &mut on_tick));
    }

    for (index, (_, temporary, destination, _, _)) in outputs.iter().enumerate() {
        if state.shutdown.load(Ordering::Acquire) || state.cancel_current.load(Ordering::Acquire) {
            let cancellation = on_tick().err().unwrap_or_else(|| {
                "cancelled_fenced: render stopped during output publication".to_string()
            });
            return Err(with_rollback_error(cancellation, &records, &mut on_tick));
        }
        if let Err(error) = ensure_safe_destination(root, destination) {
            return Err(with_rollback_error(error, &records, &mut on_tick));
        }
        if let Err(error) = on_tick() {
            return Err(with_rollback_error(error, &records, &mut on_tick));
        }
        if let Err(error) = move_file_without_replacement(temporary, destination) {
            let error = if destination.exists() {
                format!("output_conflict: destination appeared during publication: {error}")
            } else {
                format!("failed to publish rendered output: {error}")
            };
            return Err(with_rollback_error(error, &records, &mut on_tick));
        }
        records[index].published_by_us = true;
        debug_assert_eq!(records[index].destination, *destination);
    }
    Ok(records)
}

#[cfg(test)]
fn rollback_publication(records: &[PublicationRecord]) -> Result<(), String> {
    rollback_publication_with_tick(records, || Ok(()))
}

fn rollback_terminal_publication(records: &[PublicationRecord]) -> Result<(), String> {
    let mut errors = Vec::new();
    for record in records.iter().rev() {
        let errors_before_record = errors.len();
        let current = match destination_fingerprint(&record.destination) {
            Ok(current) => current,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        let published = format!("sha256:{}", record.published_sha256);

        if record.original_existed {
            let Some(expected_original) = record.original_fingerprint.as_deref() else {
                errors.push(format!(
                    "missing original fingerprint for {}",
                    record.destination.display()
                ));
                continue;
            };
            if record.backup.exists() {
                match destination_fingerprint(&record.backup) {
                    Ok(Some(fingerprint)) if fingerprint == expected_original => {}
                    Ok(_) => {
                        errors.push(format!(
                            "publication backup changed for {}",
                            record.destination.display()
                        ));
                        continue;
                    }
                    Err(error) => {
                        errors.push(error);
                        continue;
                    }
                }
                match current.as_deref() {
                    Some(fingerprint) if fingerprint == expected_original => {
                        if let Err(error) = fs::remove_file(&record.backup) {
                            errors.push(error.to_string());
                        }
                    }
                    Some(fingerprint) if fingerprint == published => {
                        if let Err(error) =
                            diagnostics::replace_file(&record.backup, &record.destination)
                        {
                            errors.push(format!(
                                "failed to restore {}: {error}",
                                record.destination.display()
                            ));
                        }
                    }
                    None => {
                        if let Err(error) =
                            move_file_without_replacement(&record.backup, &record.destination)
                        {
                            errors.push(format!(
                                "failed to restore {}: {error}",
                                record.destination.display()
                            ));
                        }
                    }
                    Some(_) => errors.push(format!(
                        "another output now occupies {}",
                        record.destination.display()
                    )),
                }
            } else if current.as_deref() != Some(expected_original) {
                errors.push(format!(
                    "missing publication backup for {}",
                    record.destination.display()
                ));
            }
        } else if record.published_by_us {
            match current.as_deref() {
                Some(fingerprint) if fingerprint == published => {
                    if let Err(error) = fs::remove_file(&record.destination) {
                        errors.push(error.to_string());
                    }
                }
                None => {}
                Some(_) => errors.push(format!(
                    "another output now occupies {}",
                    record.destination.display()
                )),
            }
        }

        if errors.len() == errors_before_record {
            if let Err(error) = fs::remove_file(&record.journal) {
                if error.kind() != io::ErrorKind::NotFound {
                    errors.push(error.to_string());
                }
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn rollback_publication_with_tick(
    records: &[PublicationRecord],
    mut on_tick: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for record in records.iter().rev() {
        let errors_before_record = errors.len();
        if record.original_existed {
            if record.backup.exists() {
                let destination_is_ours = if record.published_by_us {
                    match destination_fingerprint_with_tick(&record.destination, &mut on_tick) {
                        Ok(fingerprint) => {
                            fingerprint.as_deref()
                                == Some(format!("sha256:{}", record.published_sha256).as_str())
                        }
                        Err(error) => {
                            errors.push(error);
                            break;
                        }
                    }
                } else {
                    false
                };
                if record.destination.exists() && !destination_is_ours {
                    if let Err(error) = on_tick() {
                        errors.push(error);
                        break;
                    }
                    if let Err(error) = preserve_conflicting_destination(record) {
                        errors.push(error);
                        continue;
                    }
                }
                if let Err(error) = on_tick() {
                    errors.push(error);
                    break;
                }
                if let Err(error) = diagnostics::replace_file(&record.backup, &record.destination) {
                    errors.push(format!(
                        "failed to restore {}: {error}",
                        record.destination.display()
                    ));
                }
            } else {
                let expected_original = match record.original_fingerprint.as_deref() {
                    Some(expected) => expected,
                    None => {
                        errors.push(format!(
                            "missing original fingerprint for {}",
                            record.destination.display()
                        ));
                        continue;
                    }
                };
                match destination_fingerprint_with_tick(&record.destination, &mut on_tick) {
                    Ok(Some(actual)) if actual == expected_original => {
                        // A previous rollback pass already restored this
                        // output and removed its backup. Removing the journal
                        // below (if still present) completes that record.
                    }
                    Ok(_) => errors.push(format!(
                        "missing publication backup for {}",
                        record.destination.display()
                    )),
                    Err(error) => errors.push(error),
                }
            }
        } else if record.published_by_us {
            match destination_fingerprint_with_tick(&record.destination, &mut on_tick) {
                Ok(Some(fingerprint))
                    if fingerprint == format!("sha256:{}", record.published_sha256) =>
                {
                    if let Err(error) = on_tick() {
                        errors.push(error);
                        break;
                    }
                    if let Err(error) = fs::remove_file(&record.destination) {
                        errors.push(format!(
                            "failed to remove uncommitted output {}: {error}",
                            record.destination.display()
                        ));
                    }
                }
                Ok(None) => {}
                Ok(Some(_)) => errors.push(format!(
                    "uncommitted output changed before rollback: {}",
                    record.destination.display()
                )),
                Err(error) => errors.push(error),
            }
        }
        if errors.len() == errors_before_record {
            if let Err(error) = on_tick() {
                errors.push(error);
                break;
            }
            if let Err(error) = fs::remove_file(&record.journal) {
                if error.kind() != io::ErrorKind::NotFound {
                    errors.push(error.to_string());
                }
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn with_rollback_error(
    primary: String,
    records: &[PublicationRecord],
    on_tick: &mut impl FnMut() -> Result<(), String>,
) -> String {
    if primary.starts_with("lease_lost:") || primary.starts_with("cancelled_unfenced:") {
        // This generation may no longer own the job. Leave the journal and
        // backups untouched for the next valid lease to reconcile.
        return primary;
    }
    match rollback_publication_with_tick(records, || match on_tick() {
        Err(error) if error.starts_with("cancelled_fenced:") => Ok(()),
        result => result,
    }) {
        Ok(()) => primary,
        Err(error) => format!("recovery_pending: {primary}; output rollback also failed: {error}"),
    }
}

fn write_publication_journal(record: &PublicationRecord) -> io::Result<()> {
    let mut file = File::options()
        .write(true)
        .create_new(true)
        .open(&record.journal)?;
    let result = file
        .write_all(record.published_sha256.as_bytes())
        .and_then(|()| file.sync_all());
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(&record.journal);
    }
    result
}

fn read_publication_journal(path: &Path) -> Result<String, String> {
    let value = fs::read_to_string(path).map_err(|_| {
        "O registro de recuperação dos arquivos finais não pôde ser lido.".to_string()
    })?;
    let value = value.trim();
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("O registro de recuperação dos arquivos finais está incompleto.".to_string());
    }
    Ok(value.to_ascii_lowercase())
}

fn preserve_conflicting_destination(record: &PublicationRecord) -> Result<(), String> {
    if !record.destination.exists() {
        return Ok(());
    }
    let directory = record.backup.parent().ok_or_else(|| {
        "A pasta de recuperação dos arquivos finais não foi reconhecida.".to_string()
    })?;
    let file_name = record
        .destination
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let conflict = directory.join(format!(".{file_name}.conflict-{}", random_uuid_v4()));
    fs::rename(&record.destination, conflict).map_err(|_| {
        "Um arquivo final mudou durante a recuperação e não pôde ser preservado.".to_string()
    })
}

#[cfg(windows)]
fn move_file_without_replacement(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

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
            MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn move_file_without_replacement(source: &Path, destination: &Path) -> io::Result<()> {
    fs::hard_link(source, destination)?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(destination);
        return Err(error);
    }
    Ok(())
}

fn cleanup_publication_backups(records: &[PublicationRecord]) -> Result<(), String> {
    let mut errors = Vec::new();
    for record in records {
        for path in [&record.backup, &record.journal] {
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != io::ErrorKind::NotFound {
                    errors.push(format!("{}: {error}", path.display()));
                }
            }
        }
        if let Some(directory) = record.backup.parent() {
            let _ = fs::remove_dir(directory);
            if let Some(job_directory) = directory.parent() {
                let _ = fs::remove_dir(job_directory);
                if let Some(render_directory) = job_directory.parent() {
                    let _ = fs::remove_dir(render_directory);
                }
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Não foi possível concluir a limpeza segura da publicação: {}",
            errors.join("; ")
        ))
    }
}

fn persisted_recovery_check_due(state: &RenderQueueState) -> bool {
    let Ok(mut last_check) = state.last_recovery_check.lock() else {
        return false;
    };
    if last_check.is_some_and(|instant| instant.elapsed() < OBSERVER_POLL) {
        return false;
    }
    *last_check = Some(Instant::now());
    true
}

fn publication_recovery_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join(PUBLICATION_RECOVERY_DIRECTORY))
        .map_err(|_| "A pasta local de recuperação do render não está disponível.".to_string())
}

fn publication_recovery_marker_path(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    let job_id = clean_identifier(job_id, "render")?;
    Ok(publication_recovery_directory(app)?.join(format!("{job_id}.json")))
}

fn write_publication_recovery_marker(
    app: &AppHandle,
    root: &Path,
    job: &PendingJob,
) -> Result<(), String> {
    let directory = publication_recovery_directory(app)?;
    fs::create_dir_all(&directory)
        .map_err(|_| "Não foi possível preparar o registro local de recuperação.".to_string())?;
    let destination = publication_recovery_marker_path(app, &job.id)?;
    let temporary = directory.join(format!(
        ".{}.part-{}",
        clean_path_component(&job.id),
        random_uuid_v4()
    ));
    let outputs = job
        .outputs
        .iter()
        .map(|output| {
            json!({
                "kind": output.kind,
                "comp": output.composition,
                "template": output.template,
                "destinationRelativePath": output.destination_relative_path,
                "replaceExisting": output.replace_existing,
                "existingFingerprint": output.existing_fingerprint,
            })
        })
        .collect::<Vec<_>>();
    let payload = serde_json::to_vec(&json!({
        "schemaVersion": SCHEMA_VERSION,
        "localRoot": root.to_string_lossy(),
        "id": job.id,
        "title": job.title,
        "projectRelativePath": job.project_relative_path,
        "projectSizeBytes": job.project_size_bytes,
        "projectSha256": job.project_sha256,
        "recipe": RECIPE_VERSION,
        "outputs": outputs,
    }))
    .map_err(|_| "Não foi possível preparar o registro local de recuperação.".to_string())?;

    let result = (|| {
        let mut file = File::options()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&payload)?;
        file.sync_all()?;
        drop(file);
        diagnostics::replace_file(&temporary, &destination)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "Não foi possível concluir o registro local de recuperação: {error}"
        ));
    }
    Ok(())
}

fn remove_publication_recovery_marker(app: &AppHandle, job_id: &str) -> Result<(), String> {
    let path = publication_recovery_marker_path(app, job_id)?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    if let Some(directory) = path.parent() {
        let _ = fs::remove_dir(directory);
    }
    Ok(())
}

fn load_publication_recovery_markers(
    app: &AppHandle,
) -> Result<Vec<(PathBuf, PathBuf, PendingJob)>, String> {
    let directory = publication_recovery_directory(app)?;
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => {
            return Err("Os registros locais de recuperação não puderam ser lidos.".to_string())
        }
    };
    let mut markers = Vec::new();
    for entry in entries {
        let entry = entry
            .map_err(|_| "Um registro local de recuperação não pôde ser conferido.".to_string())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata = fs::metadata(&path)
            .map_err(|_| "Um registro local de recuperação não pôde ser conferido.".to_string())?;
        if !metadata.is_file() || metadata.len() > 128 * 1024 {
            return Err("Um registro local de recuperação não é válido.".to_string());
        }
        let value: Value = serde_json::from_slice(
            &fs::read(&path)
                .map_err(|_| "Um registro local de recuperação não pôde ser lido.".to_string())?,
        )
        .map_err(|_| "Um registro local de recuperação está incompleto.".to_string())?;
        let job = parse_pending_job(&value)
            .ok_or_else(|| "Um registro local de recuperação não é compatível.".to_string())?;
        if path.file_stem().and_then(|value| value.to_str()) != Some(job.id.as_str()) {
            return Err("Um registro local de recuperação não corresponde ao render.".to_string());
        }
        let local_root = value_text(&value, &["localRoot"])
            .map(PathBuf::from)
            .filter(|root| root.is_absolute())
            .ok_or_else(|| "Um registro local de recuperação não informa sua pasta.".to_string())?;
        markers.push((path, local_root, job));
    }
    Ok(markers)
}

fn cleanup_completed_publication(root: &Path, job: &PendingJob) -> Result<(), String> {
    for output in &job.outputs {
        let destination = resolve_protocol_path(root, &output.destination_relative_path)?;
        ensure_safe_destination(root, &destination)?;
        let record = publication_record(&destination, &job.id, "")?;
        if !record.backup.exists() && !record.journal.exists() {
            continue;
        }
        let directory = record.journal.parent().ok_or_else(|| {
            "A pasta de recuperação dos arquivos finais não é segura.".to_string()
        })?;
        let canonical = fs::canonicalize(directory)
            .map_err(|_| "A pasta de recuperação dos arquivos finais não é segura.".to_string())?;
        ensure_inside_root(root, &canonical)?;
        ensure_safe_destination(root, &record.backup)?;
        ensure_safe_destination(root, &record.journal)?;
        for path in [&record.backup, &record.journal] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(_) => {
                    return Err(
                        "Não foi possível concluir a limpeza dos arquivos já publicados."
                            .to_string(),
                    )
                }
            }
        }
        let _ = fs::remove_dir(directory);
        if let Some(job_directory) = directory.parent() {
            let _ = fs::remove_dir(job_directory);
            if let Some(render_directory) = job_directory.parent() {
                let _ = fs::remove_dir(render_directory);
            }
        }
    }
    Ok(())
}

fn prepublication_state_is_intact(root: &Path, job: &PendingJob) -> Result<(), String> {
    for output in &job.outputs {
        let destination = resolve_protocol_path(root, &output.destination_relative_path)?;
        ensure_safe_destination(root, &destination)?;
        if !destination_still_matches(
            &destination,
            output.replace_existing,
            output.existing_fingerprint.as_deref(),
        )? {
            return Err(
                "Os arquivos anteriores ainda não estão no estado esperado para concluir a recuperação."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn reconcile_persisted_publications(app: &AppHandle) -> Result<(), String> {
    let markers = load_publication_recovery_markers(app)?;
    if markers.is_empty() {
        return Ok(());
    }
    let config = settings::load(app)
        .map_err(|_| "As configurações do Arizona não puderam ser lidas.".to_string())?;
    let configured_root = PathBuf::from(config.drive.trim());
    let root = fs::canonicalize(&configured_root).map_err(|_| {
        "A pasta compartilhada não está acessível para recuperar o render.".to_string()
    })?;
    if !root.is_dir() {
        return Err(
            "A pasta compartilhada não está acessível para recuperar o render.".to_string(),
        );
    }

    let mut errors = Vec::new();
    for (_marker_path, marker_root, marker_job) in markers {
        if !paths_equal(&marker_root, &root) {
            errors.push(
                "A pasta compartilhada mudou desde a interrupção; o registro de recuperação foi preservado."
                    .to_string(),
            );
            continue;
        }
        let has_recovery_artifacts = match publication_recovery_exists(&root, &marker_job) {
            Ok(value) => value,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        let remote = match queue_call(
            app,
            "status",
            json!({ "includeNextJob": true, "jobId": marker_job.id }),
        ) {
            Ok(remote) => remote,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        let remote_job_value = match remote.get("job") {
            Some(job) => job,
            None => {
                errors
                    .push("A fila não encontrou um render que precisa de recuperação.".to_string());
                continue;
            }
        };
        let remote_job = match parse_pending_job(remote_job_value) {
            Some(job) if job == marker_job => job,
            _ => {
                errors.push(
                    "A fila devolveu informações diferentes do registro local de recuperação."
                        .to_string(),
                );
                continue;
            }
        };
        let worker_device_id = remote
            .pointer("/worker/deviceId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let target_device_id = value_text(
            remote_job_value,
            &[
                "targetWorkerDeviceId",
                "targetDeviceId",
                "target_worker_device_id",
            ],
        )
        .unwrap_or_default();
        if worker_device_id.is_empty() {
            errors.push("A fila não confirmou a máquina desta recuperação.".to_string());
            continue;
        }
        let status = value_text(remote_job_value, &["status", "outcome"]);
        if target_device_id != worker_device_id {
            let can_discard_marker = match status.as_deref() {
                Some("completed") => !has_recovery_artifacts,
                Some("failed" | "cancelled") if !has_recovery_artifacts => {
                    prepublication_state_is_intact(&root, &remote_job).is_ok()
                }
                _ => false,
            };
            if can_discard_marker {
                let _ = remove_publication_recovery_marker(app, &remote_job.id);
            }
            // The newly assigned worker is the only machine allowed to mutate
            // shared recovery artifacts. This stale local marker is advisory
            // and must not prevent unrelated jobs on the old machine.
            continue;
        }
        let result = match status.as_deref() {
            Some("completed") => cleanup_completed_publication(&root, &remote_job),
            Some("failed" | "cancelled") if has_recovery_artifacts => {
                recover_terminal_publication(&root, &remote_job)
            }
            Some("failed" | "cancelled") => prepublication_state_is_intact(&root, &remote_job),
            Some(
                "waiting_for_worker" | "waiting_for_sync" | "queued" | "claimed" | "rendering"
                | "publishing",
            ) => continue,
            _ => Err("A fila não confirmou o estado de um render interrompido.".to_string()),
        };
        match result {
            Ok(()) => {
                let _ = remove_publication_recovery_marker(app, &remote_job.id);
            }
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn reconcile_pending_publication(
    app: &AppHandle,
    state: &State<RenderQueueState>,
) -> Result<(), String> {
    let pending = state
        .pending_publications
        .lock()
        .map_err(|_| {
            "A confirmação dos arquivos finais está temporariamente indisponível.".to_string()
        })?
        .first()
        .cloned();
    let Some(mut pending) = pending else {
        return Ok(());
    };

    let remote = queue_call(
        app,
        "status",
        json!({ "includeNextJob": true, "jobId": pending.job_id }),
    )?;
    let remote_status = remote
        .get("job")
        .and_then(|job| value_text(job, &["status", "outcome"]))
        .ok_or_else(|| "A fila ainda não confirmou o estado dos arquivos finais.".to_string())?;

    match remote_status.as_str() {
        "completed" => {
            cleanup_publication_backups(&pending.publication)?;
            remove_publication_recovery_marker(app, &pending.job_id)?;
            let _ = remove_snapshot_file(&pending.project);
            emit_queue_notice(
                app,
                state.inner(),
                &format!("job_completed:{}", pending.job_id),
                &completed_job_value_message(&pending.title, &pending.finish_payload),
                "success",
            );
        }
        "claimed" | "rendering" | "publishing" => {
            // A cancellation must restore the previous outputs while this
            // exact lease still owns their reservation. Only then may finish
            // make the job terminal and release those paths to another job.
            if pending.outcome == "cancelled" {
                rollback_cancelled_publication_with_lease(app, &mut pending)?;
                store_pending_publication(state, &pending)?;
                queue_call_detailed(app, "finish", pending.finish_payload.clone())
                    .map_err(|error| error.public_message)?;
            } else if let Err(error) =
                queue_call_detailed(app, "finish", pending.finish_payload.clone())
            {
                if error.code != "render_cancel_requested" {
                    return Err(error.public_message);
                }
                pending.finish_payload = cancelled_finish_payload(&pending.finish_payload)?;
                pending.outcome = "cancelled".to_string();
                store_pending_publication(state, &pending)?;
                rollback_cancelled_publication_with_lease(app, &mut pending)?;
                store_pending_publication(state, &pending)?;
                queue_call_detailed(app, "finish", pending.finish_payload.clone())
                    .map_err(|error| error.public_message)?;
            }
            if pending.outcome == "cancelled" {
                emit_queue_notice(
                    app,
                    state.inner(),
                    &format!("job_cancelled:{}", pending.job_id),
                    &format!(
                        "{} foi cancelado. Os arquivos anteriores foram preservados.",
                        pending.title
                    ),
                    "warning",
                );
            } else {
                cleanup_publication_backups(&pending.publication)?;
            }
            remove_publication_recovery_marker(app, &pending.job_id)?;
            let _ = remove_snapshot_file(&pending.project);
        }
        "waiting_for_worker" | "waiting_for_sync" | "queued" => {
            // The old lease expired and this job can receive a new generation.
            // Do not rollback here: that next valid lease owns recovery.
        }
        "failed" | "cancelled" => {
            // A terminal job no longer reserves these paths. Restore only
            // when the current fingerprints still prove that this exact
            // publication owns the files; otherwise preserve everything for
            // manual recovery instead of touching a newer render.
            rollback_terminal_publication(&pending.publication)?;
            remove_publication_recovery_marker(app, &pending.job_id)?;
            let _ = remove_snapshot_file(&pending.project);
            if remote_status == "cancelled" {
                emit_queue_notice(
                    app,
                    state.inner(),
                    &format!("job_cancelled:{}", pending.job_id),
                    &format!(
                        "{} foi cancelado. Os arquivos anteriores foram preservados.",
                        pending.title
                    ),
                    "warning",
                );
            }
        }
        _ => return Err("A fila devolveu um estado de render não reconhecido.".to_string()),
    }

    if let Ok(mut items) = state.pending_publications.lock() {
        items.retain(|item| item.job_id != pending.job_id);
    }
    Ok(())
}

fn cancelled_finish_payload(completed_payload: &Value) -> Result<Value, String> {
    let mut payload = completed_payload.clone();
    let object = payload
        .as_object_mut()
        .ok_or_else(|| "A confirmação local deste render não pôde ser recuperada.".to_string())?;
    object.insert(
        "outcome".to_string(),
        Value::String("cancelled".to_string()),
    );
    object.insert(
        "errorCode".to_string(),
        Value::String("cancelled_by_requester".to_string()),
    );
    object.remove("outputs");
    Ok(payload)
}

fn store_pending_publication(
    state: &State<RenderQueueState>,
    pending: &PendingPublicationReconciliation,
) -> Result<(), String> {
    let mut items = state.pending_publications.lock().map_err(|_| {
        "A recuperação local deste render não pôde ser atualizada com segurança.".to_string()
    })?;
    let stored = items
        .iter_mut()
        .find(|item| item.job_id == pending.job_id)
        .ok_or_else(|| {
            "A recuperação local deste render não foi encontrada para atualização.".to_string()
        })?;
    *stored = pending.clone();
    Ok(())
}

fn rollback_cancelled_publication_with_lease(
    app: &AppHandle,
    pending: &mut PendingPublicationReconciliation,
) -> Result<(), String> {
    if pending.publication.is_empty() {
        return Ok(());
    }
    let lease_id = value_text(&pending.finish_payload, &["leaseId", "lease_id"])
        .ok_or_else(|| "A autorização deste render não pôde ser confirmada.".to_string())?;
    let lease_generation = value_u64(
        &pending.finish_payload,
        &["leaseGeneration", "lease_generation"],
    )
    .ok_or_else(|| "A autorização deste render não pôde ser confirmada.".to_string())?;
    let mut last_heartbeat: Option<Instant> = None;

    rollback_publication_with_tick(&pending.publication, || {
        if last_heartbeat.is_some_and(|heartbeat| heartbeat.elapsed() < HEARTBEAT_INTERVAL) {
            return Ok(());
        }
        let response = queue_call_detailed(
            app,
            "heartbeat",
            json!({
                "jobId": pending.job_id,
                "leaseId": lease_id,
                "leaseGeneration": lease_generation,
                "stage": "publishing",
                "progressPercent": 100,
                "statusMessage": "Restaurando os arquivos anteriores após o cancelamento.",
            }),
        )
        .map_err(|error| error.public_message)?;
        if !remote_lease_valid(&response) {
            return Err(
                "A autorização deste render mudou antes de restaurar os arquivos anteriores."
                    .to_string(),
            );
        }
        last_heartbeat = Some(Instant::now());
        Ok(())
    })?;
    cleanup_publication_backups(&pending.publication)?;
    pending.publication.clear();
    Ok(())
}

fn remote_job_has_status(value: &Value, job_id: &str, expected_status: &str) -> bool {
    value.get("job").is_some_and(|job| {
        value_text(job, &["id", "jobId", "job_id"]).as_deref() == Some(job_id)
            && value_text(job, &["status", "outcome"]).as_deref() == Some(expected_status)
    }) || value
        .get("jobs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|job| {
            value_text(job, &["id", "jobId", "job_id"]).as_deref() == Some(job_id)
                && value_text(job, &["status", "outcome"]).as_deref() == Some(expected_status)
        })
}

fn ensure_safe_destination(root: &Path, path: &Path) -> Result<(), String> {
    ensure_inside_root(root, path)?;
    if fs::symlink_metadata(path)
        .ok()
        .is_some_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(
            "O destino do render aponta para um atalho de arquivo não permitido.".to_string(),
        );
    }

    let mut existing = path.parent();
    while existing.is_some_and(|candidate| !candidate.exists()) {
        existing = existing.and_then(Path::parent);
    }
    let existing = existing.ok_or_else(|| {
        "A pasta final do render não pôde ser validada nesta máquina.".to_string()
    })?;
    let canonical = fs::canonicalize(existing)
        .map_err(|_| "A pasta final do render não pôde ser validada nesta máquina.".to_string())?;
    ensure_inside_root(root, &canonical)
}

fn destination_fingerprint(path: &Path) -> Result<Option<String>, String> {
    destination_fingerprint_with_tick(path, &mut || Ok(()))
}

fn destination_fingerprint_with_tick(
    path: &Path,
    tick: &mut impl FnMut() -> Result<(), String>,
) -> Result<Option<String>, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(
                "Não foi possível conferir um arquivo final existente nesta máquina.".to_string(),
            )
        }
    };
    if !metadata.is_file() {
        return Err("O destino final existente não é um arquivo válido.".to_string());
    }
    let (_, sha256) = sha256_file_with_tick(path, tick).map_err(|error| {
        if error.starts_with("lease_lost:")
            || error.starts_with("cancelled:")
            || error.starts_with("cancelled_unfenced:")
            || error.starts_with("cancelled_fenced:")
        {
            error
        } else {
            format!("Não foi possível conferir o conteúdo de um arquivo final existente: {error}")
        }
    })?;
    Ok(Some(format!("sha256:{sha256}")))
}

fn destination_still_matches(
    path: &Path,
    replace_existing: bool,
    expected_fingerprint: Option<&str>,
) -> Result<bool, String> {
    destination_still_matches_with_tick(
        path,
        replace_existing,
        expected_fingerprint,
        &mut || Ok(()),
    )
}

fn destination_still_matches_with_tick(
    path: &Path,
    replace_existing: bool,
    expected_fingerprint: Option<&str>,
    tick: &mut impl FnMut() -> Result<(), String>,
) -> Result<bool, String> {
    match (replace_existing, expected_fingerprint) {
        (true, Some(expected)) => {
            Ok(destination_fingerprint_with_tick(path, tick)?.as_deref() == Some(expected))
        }
        (_, None) => Ok(destination_fingerprint_with_tick(path, tick)?.is_none()),
        (false, Some(_)) => Ok(false),
    }
}

fn output_manifest_value(
    kind: &str,
    composition: &str,
    template: &str,
    destination_relative_path: &str,
    replace_existing: bool,
    existing_fingerprint: Option<String>,
) -> Result<Value, String> {
    let mut output = Map::new();
    output.insert("kind".to_string(), Value::String(kind.to_string()));
    output.insert("comp".to_string(), Value::String(composition.to_string()));
    output.insert("template".to_string(), Value::String(template.to_string()));
    output.insert(
        "destinationRelativePath".to_string(),
        Value::String(destination_relative_path.to_string()),
    );
    output.insert("replaceExisting".to_string(), Value::Bool(replace_existing));
    if let Some(existing_fingerprint) = existing_fingerprint {
        output.insert(
            "existingFingerprint".to_string(),
            Value::String(existing_fingerprint),
        );
    }
    Ok(Value::Object(output))
}

fn pending_job_from_response(value: &Value) -> Option<PendingJob> {
    if let Some(candidate) = value
        .pointer("/nextJob")
        .or_else(|| value.pointer("/next_job"))
        .or_else(|| value.pointer("/job"))
    {
        if let Some(job) = parse_pending_job(candidate) {
            return Some(job);
        }
    }

    let worker_device_id = value
        .pointer("/worker/deviceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    value
        .get("jobs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|job| {
            value_text(
                job,
                &["targetWorkerDeviceId", "targetDeviceId", "target_device_id"],
            )
            .is_some_and(|id| id == worker_device_id)
                && value_text(job, &["status", "stage"]).is_some_and(|status| {
                    matches!(
                        status.as_str(),
                        "waiting_for_worker" | "waiting_for_sync" | "queued" | "ready"
                    )
                })
                && !job
                    .get("cancelRequested")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
        })
        .min_by_key(|job| value_u64(job, &["queuePosition", "queue_position"]).unwrap_or(u64::MAX))
        .and_then(parse_pending_job)
}

fn recoverable_job_from_response(value: &Value) -> Option<PendingJob> {
    let candidate = value
        .pointer("/recoverableJob")
        .or_else(|| value.pointer("/recoverable_job"))?;
    let status = value_text(candidate, &["status"])?;
    if !matches!(status.as_str(), "claimed" | "rendering" | "publishing") {
        return None;
    }
    let worker_device_id = value.pointer("/worker/deviceId").and_then(Value::as_str)?;
    let target_device_id = value_text(
        candidate,
        &[
            "targetWorkerDeviceId",
            "targetDeviceId",
            "target_worker_device_id",
        ],
    )?;
    if target_device_id != worker_device_id {
        return None;
    }
    parse_pending_job(candidate)
}

fn parse_pending_job(value: &Value) -> Option<PendingJob> {
    let manifest = value.get("manifest").unwrap_or(value);
    let id = value_text(value, &["id", "jobId", "job_id"])
        .or_else(|| value_text(manifest, &["id", "jobId", "job_id"]))?;
    let project_relative_path =
        value_text(manifest, &["projectRelativePath", "project_relative_path"])?;
    let project_size_bytes = value_u64(manifest, &["projectSizeBytes", "project_size_bytes"])?;
    let project_sha256 = value_text(manifest, &["projectSha256", "project_sha256"])?;
    let recipe = value_text(
        manifest,
        &["recipe", "renderRecipeVersion", "render_recipe_version"],
    )
    .unwrap_or_else(|| RECIPE_VERSION.to_string());
    if recipe != RECIPE_VERSION {
        return None;
    }
    let outputs_value = manifest
        .get("outputs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let outputs = outputs_value
        .iter()
        .map(parse_render_output)
        .collect::<Option<Vec<_>>>()?;
    if outputs.is_empty() || outputs.len() > 2 {
        return None;
    }
    for (index, output) in outputs.iter().enumerate() {
        if outputs[..index].iter().any(|previous| {
            previous.kind == output.kind
                || previous
                    .destination_relative_path
                    .eq_ignore_ascii_case(&output.destination_relative_path)
        }) {
            return None;
        }
    }
    Some(PendingJob {
        id,
        title: value_text(value, &["title", "projectTitle", "project_title"])
            .or_else(|| value_text(manifest, &["projectName", "project_name"]))
            .unwrap_or_else(|| "Projeto da fila".to_string()),
        project_relative_path,
        project_size_bytes,
        project_sha256,
        outputs,
    })
}

fn parse_render_output(value: &Value) -> Option<RenderOutput> {
    let kind = value_text(value, &["kind"])?;
    let (expected_composition, expected_template, expected_extension) = match kind.as_str() {
        "mov" => ("EXPORT", "PROXY", ".mov"),
        "mp4" => ("EXPORT_MP4", "MP4", ".mp4"),
        _ => return None,
    };
    let composition = value_text(value, &["comp", "composition"])?;
    let template = value_text(
        value,
        &["outputModuleTemplate", "output_module_template", "template"],
    )?;
    if composition != expected_composition || template != expected_template {
        return None;
    }
    let destination_relative_path = value_text(
        value,
        &["destinationRelativePath", "destination_relative_path"],
    )?;
    if !destination_relative_path
        .to_lowercase()
        .ends_with(expected_extension)
    {
        return None;
    }
    let replace_existing = value
        .get("replaceExisting")
        .or_else(|| value.get("replace_existing"))
        .and_then(Value::as_bool)?;
    let existing_fingerprint = value_text(value, &["existingFingerprint", "existing_fingerprint"]);
    if existing_fingerprint.as_deref().is_some_and(|fingerprint| {
        let Some(hash) = fingerprint.strip_prefix("sha256:") else {
            return true;
        };
        hash.len() != 64
            || !hash
                .chars()
                .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
    }) {
        return None;
    }
    Some(RenderOutput {
        composition,
        template,
        destination_relative_path,
        replace_existing,
        existing_fingerprint,
        kind,
    })
}

fn claimed_job_from_response(value: &Value, fallback: &PendingJob) -> Result<ClaimedJob, String> {
    let job = value
        .get("job")
        .and_then(parse_pending_job)
        .ok_or_else(|| "A fila não confirmou os dados do projeto reservado.".to_string())?;
    if &job != fallback {
        return Err(
            "A fila devolveu informações diferentes do projeto que foi conferido.".to_string(),
        );
    }
    let lease_value = value.get("lease").unwrap_or(value);
    let id = value_text(lease_value, &["id", "leaseId", "lease_id"])
        .ok_or_else(|| "A fila não confirmou a reserva deste trabalho.".to_string())?;
    let generation = value_u64(
        lease_value,
        &["generation", "leaseGeneration", "lease_generation"],
    )
    .ok_or_else(|| "A fila não confirmou a reserva deste trabalho.".to_string())?;
    Ok(ClaimedJob {
        job,
        lease: Lease { id, generation },
    })
}

fn value_text(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn value_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        })
    })
}

fn remote_cancel_requested(value: &Value) -> bool {
    value
        .get("cancelRequested")
        .or_else(|| value.get("cancel_requested"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || value
            .pointer("/job/cancelRequested")
            .or_else(|| value.pointer("/job/cancel_requested"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

fn remote_lease_valid(value: &Value) -> bool {
    value
        .get("leaseValid")
        .or_else(|| value.get("lease_valid"))
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

fn emit_queue_notice(
    app: &AppHandle,
    state: &RenderQueueState,
    key: &str,
    message: &str,
    tone: &str,
) {
    let should_emit = state
        .last_notice
        .lock()
        .map(|mut last_notice| {
            if last_notice.as_deref() == Some(key) {
                false
            } else {
                *last_notice = Some(key.to_string());
                true
            }
        })
        .unwrap_or(false);
    if should_emit {
        let _ = app.emit_to(
            "app",
            "arizona-render-queue:notice",
            json!({ "code": key, "message": message, "tone": tone }),
        );
    }
}

fn observe_queue_status(app: &AppHandle, state: &RenderQueueState, value: &Value) {
    let local_device_id = value
        .pointer("/worker/deviceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if local_device_id.is_empty() {
        return;
    }
    let initialized = state.observations_initialized.swap(true, Ordering::AcqRel);
    let Some(visible_jobs) = value.get("jobs").and_then(Value::as_array) else {
        return;
    };
    let mut jobs = visible_jobs.iter().collect::<Vec<_>>();
    for key in ["nextJob", "recoverableJob"] {
        if let Some(job) = value.get(key).filter(|job| job.is_object()) {
            let job_id = value_text(job, &["id", "jobId", "job_id"]);
            if !jobs
                .iter()
                .any(|known| value_text(known, &["id", "jobId", "job_id"]) == job_id)
            {
                jobs.push(job);
            }
        }
    }
    let Ok(mut previous) = state.observed_jobs.lock() else {
        return;
    };
    let mut current = HashMap::new();
    let mut notices = Vec::new();
    let mut has_initial_target_work = false;
    let mut has_target_work = false;

    for job in jobs {
        let Some(job_id) = value_text(job, &["id", "jobId", "job_id"]) else {
            continue;
        };
        let requester_device =
            value_text(job, &["requesterDeviceId", "requester_device_id"]).unwrap_or_default();
        let target_device = value_text(
            job,
            &["targetWorkerDeviceId", "targetDeviceId", "target_device_id"],
        )
        .unwrap_or_default();
        let is_requester = requester_device == local_device_id;
        let is_target = target_device == local_device_id;
        if !is_requester && !is_target {
            continue;
        }

        let status = value_text(job, &["status", "outcome"]).unwrap_or_default();
        let stage = value_text(job, &["stage"]).unwrap_or_default();
        if is_target && job_is_nonterminal(job) {
            has_target_work = true;
        }
        if !initialized
            && is_target
            && matches!(
                status.as_str(),
                "waiting_for_worker"
                    | "waiting_for_sync"
                    | "queued"
                    | "claimed"
                    | "rendering"
                    | "publishing"
            )
        {
            has_initial_target_work = true;
        }
        let error_code = value_text(
            job,
            &[
                "lastErrorCode",
                "errorCode",
                "statusCode",
                "last_error_code",
            ],
        )
        .unwrap_or_default();
        let output_conflict = job
            .get("outputConflict")
            .or_else(|| job.get("output_conflict"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let role = if is_target { "target" } else { "requester" };
        let fingerprint = format!("{role}:{status}:{stage}:{error_code}:{output_conflict}");
        let changed = previous.get(&job_id).is_some_and(|old| old != &fingerprint);
        let newly_related = initialized && !previous.contains_key(&job_id);
        current.insert(job_id.clone(), fingerprint);

        let terminal = matches!(status.as_str(), "completed" | "failed" | "cancelled");
        let should_notify = if is_target && !is_requester {
            newly_related || changed && terminal
        } else {
            changed || newly_related && terminal
        };
        if should_notify {
            if let Some((message, tone)) = queue_job_notice(job, is_requester, is_target) {
                notices.push((
                    format!("observed_job:{job_id}:{status}:{stage}:{error_code}"),
                    message,
                    tone,
                ));
            }
        }
    }
    state
        .received_work_pending
        .store(has_target_work, Ordering::Release);

    if has_initial_target_work {
        notices.push((
            "target_jobs_waiting_on_start".to_string(),
            "Há trabalhos aguardando esta máquina. Ligue a disponibilidade quando puder processá-los."
                .to_string(),
            "info",
        ));
    }

    if initialized {
        for (job_id, fingerprint) in previous.iter() {
            if current.contains_key(job_id) {
                continue;
            }
            let mut fields = fingerprint.split(':');
            let was_target = fields.next() == Some("target");
            let previous_status = fields.next().unwrap_or_default();
            if was_target
                && matches!(
                    previous_status,
                    "waiting_for_worker"
                        | "waiting_for_sync"
                        | "queued"
                        | "claimed"
                        | "rendering"
                        | "publishing"
                )
            {
                notices.push((
                    format!("observed_job_reassigned:{job_id}"),
                    "Um trabalho que aguardava esta máquina foi transferido para outra. Ele não será processado aqui."
                        .to_string(),
                    "info",
                ));
            }
        }
    }
    *previous = current;
    drop(previous);

    for (key, message, tone) in notices {
        emit_queue_notice(app, state, &key, &message, tone);
    }
}

fn job_is_nonterminal(job: &Value) -> bool {
    !matches!(
        value_text(job, &["status", "outcome"]).as_deref(),
        Some("completed" | "failed" | "cancelled")
    )
}

fn job_targets_device(job: &Value, device_id: &str) -> bool {
    !device_id.is_empty()
        && value_text(
            job,
            &["targetWorkerDeviceId", "targetDeviceId", "target_device_id"],
        )
        .is_some_and(|id| id == device_id)
}

fn queue_job_notice(
    job: &Value,
    is_requester: bool,
    is_target: bool,
) -> Option<(String, &'static str)> {
    let status = value_text(job, &["status", "outcome"])?;
    let stage = value_text(job, &["stage"]).unwrap_or_default();
    let title = value_text(job, &["projectName", "title", "projectTitle"])
        .or_else(|| {
            job.get("manifest")
                .and_then(|manifest| value_text(manifest, &["projectName"]))
        })
        .unwrap_or_else(|| "O projeto".to_string());
    let error_code = value_text(
        job,
        &[
            "lastErrorCode",
            "errorCode",
            "statusCode",
            "last_error_code",
        ],
    )
    .unwrap_or_default();
    let output_conflict = job
        .get("outputConflict")
        .or_else(|| job.get("output_conflict"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let cancel_requested = job
        .get("cancelRequested")
        .or_else(|| job.get("cancel_requested"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if output_conflict {
        return Some((
            "Um arquivo final mudou depois da confirmação. Revise o trabalho antes de continuar."
                .to_string(),
            "warning",
        ));
    }
    if cancel_requested && !matches!(status.as_str(), "completed" | "failed" | "cancelled") {
        return Some((
            if is_requester {
                format!("O cancelamento de {title} foi enviado à máquina responsável.")
            } else {
                format!("O cancelamento de {title} foi solicitado. A interrupção será feita com segurança.")
            },
            "warning",
        ));
    }
    match status.as_str() {
        "completed" => Some((completed_job_value_message(&title, job), "success")),
        "failed" => Some((human_render_failure(&error_code), "error")),
        "cancelled" => Some((format!("{title} foi cancelado."), "warning")),
        "waiting_for_worker" if is_requester => Some((
            "A máquina escolhida não está disponível agora. O trabalho continuará aguardando nela."
                .to_string(),
            "warning",
        )),
        "waiting_for_sync" if is_requester => Some((
            "O projeto está chegando à máquina escolhida e começará quando estiver completo."
                .to_string(),
            "info",
        )),
        "claimed" | "rendering" if is_requester => Some((
            if stage == "rendering_mp4" && job_value_requests_output(job, "mov") {
                format!("{title}: o arquivo MOV terminou e o MP4 está sendo renderizado.")
            } else if stage == "rendering_mp4" {
                format!("{title}: o arquivo MP4 está sendo renderizado.")
            } else if stage == "rendering_proxy" {
                format!("{title}: o arquivo MOV está sendo renderizado.")
            } else {
                format!("{title} começou a ser renderizado na máquina escolhida.")
            },
            "info",
        )),
        "publishing" if is_requester => Some((
            publishing_message(
                &title,
                (
                    job_value_requests_output(job, "mov"),
                    job_value_requests_output(job, "mp4"),
                ),
            ),
            "info",
        )),
        _ if is_target => Some((format!("{title} entrou na fila desta máquina."), "info")),
        _ => None,
    }
}

fn requested_output_flags(outputs: &[RenderOutput]) -> (bool, bool) {
    (
        outputs.iter().any(|output| output.kind == "mov"),
        outputs.iter().any(|output| output.kind == "mp4"),
    )
}

fn completed_outputs_message(title: &str, outputs: &[RenderOutput]) -> String {
    completed_message(title, requested_output_flags(outputs))
}

fn completed_job_value_message(title: &str, job: &Value) -> String {
    completed_message(
        title,
        (
            job_value_requests_output(job, "mov"),
            job_value_requests_output(job, "mp4"),
        ),
    )
}

fn completed_message(title: &str, formats: (bool, bool)) -> String {
    match formats {
        (true, true) => format!("{title} foi concluído e os arquivos MOV e MP4 estão prontos."),
        (true, false) => format!("{title} foi concluído e o arquivo MOV está pronto."),
        (false, true) => format!("{title} foi concluído e o arquivo MP4 está pronto."),
        _ => format!("{title} foi concluído e o render está pronto."),
    }
}

fn publishing_message(title: &str, formats: (bool, bool)) -> String {
    match formats {
        (true, true) => {
            format!("{title} terminou de renderizar e está finalizando os arquivos MOV e MP4.")
        }
        (true, false) => format!("{title} terminou de renderizar e está finalizando o MOV."),
        (false, true) => format!("{title} terminou de renderizar e está finalizando o MP4."),
        _ => format!("{title} terminou de renderizar e está finalizando o arquivo."),
    }
}

fn job_value_requests_output(job: &Value, expected_kind: &str) -> bool {
    job.get("manifest")
        .unwrap_or(job)
        .get("outputs")
        .and_then(Value::as_array)
        .is_some_and(|outputs| {
            outputs
                .iter()
                .any(|output| value_text(output, &["kind"]).as_deref() == Some(expected_kind))
        })
}

fn human_render_failure(code: &str) -> String {
    match code {
        "after_effects_open" => {
            "Este trabalho foi interrompido por uma versão anterior do Arizona na máquina escolhida. Atualize o app nessa máquina antes de tentar novamente."
                .to_string()
        }
        "drive_unavailable" => {
            "A máquina escolhida não conseguiu acessar a pasta compartilhada.".to_string()
        }
        "project_not_synced" | "sync_timeout" => {
            "O projeto não chegou por completo à máquina escolhida dentro do prazo.".to_string()
        }
        "project_hash_mismatch" => {
            "O arquivo recebido não corresponde à versão enviada do projeto.".to_string()
        }
        "recipe_unavailable" | "aerender_unavailable" => {
            "A máquina escolhida não encontrou os recursos necessários do After Effects."
                .to_string()
        }
        "aerender_failed" | "output_missing" => {
            "O After Effects não conseguiu concluir este render.".to_string()
        }
        "output_conflict" => {
            "Um arquivo final mudou depois da confirmação e nada foi substituído.".to_string()
        }
        "lease_lost" | "machine_unavailable" => {
            "A máquina escolhida foi desconectada e interrompeu o render com segurança."
                .to_string()
        }
        "render_attempt_limit_reached" => {
            "Este render foi interrompido várias vezes. Envie o projeto novamente quando a máquina estiver estável."
                .to_string()
        }
        _ => "Não foi possível concluir este render. Abra a fila para ver o estado atual."
            .to_string(),
    }
}

fn update_local_snapshot(
    state: &State<RenderQueueState>,
    availability: &str,
    readiness: &str,
    warning: Option<String>,
) {
    if let Ok(mut snapshot) = state.snapshot.lock() {
        snapshot.availability = availability.to_string();
        snapshot.readiness = readiness.to_string();
        snapshot.warning = warning;
    }
}

fn update_local_job(
    state: &State<RenderQueueState>,
    job: &PendingJob,
    availability: &str,
    readiness: &str,
    warning: Option<String>,
) {
    if let Ok(mut snapshot) = state.snapshot.lock() {
        snapshot.current_job_id = Some(job.id.clone());
        snapshot.current_job_title = Some(job.title.clone());
        snapshot.availability = availability.to_string();
        snapshot.readiness = readiness.to_string();
        snapshot.warning = warning;
    }
}

struct LocalJobGuard<'a>(&'a RenderQueueState);

impl Drop for LocalJobGuard<'_> {
    fn drop(&mut self) {
        clear_local_job(self.0);
    }
}

fn clear_local_job(state: &RenderQueueState) {
    state.cancel_current.store(false, Ordering::Release);
    if let Ok(mut snapshot) = state.snapshot.lock() {
        snapshot.current_job_id = None;
        snapshot.current_job_title = None;
        snapshot.warning = None;
        if state.enabled.load(Ordering::Acquire) {
            snapshot.availability = "available".to_string();
            snapshot.readiness = "ready".to_string();
        } else {
            snapshot.availability = "disabled".to_string();
            snapshot.readiness = "unknown".to_string();
        }
    }
}

fn announce_disabled_once(app: &AppHandle, state: &State<RenderQueueState>) {
    if state.announced_disabled.load(Ordering::Acquire) {
        return;
    }
    let Ok(_change) = state.availability_change.lock() else {
        return;
    };
    if state.announced_disabled.load(Ordering::Acquire)
        || state.enabled.load(Ordering::Acquire)
        || state.shutdown.load(Ordering::Acquire)
    {
        return;
    }
    if queue_call(
        app,
        "set_availability",
        json!({
            "enabled": false,
            "availability": "unavailable",
            "statusMessage": "Esta máquina iniciou indisponível para renders.",
        }),
    )
    .is_ok()
    {
        state.announced_disabled.store(true, Ordering::Release);
    }
}

fn parse_progress_percent(line: &str) -> Option<u8> {
    let percent_index = line.find('%')?;
    let prefix = &line[..percent_index];
    let digits = prefix
        .chars()
        .rev()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    digits.parse::<u8>().ok().filter(|value| *value <= 100)
}

fn clean_identifier(value: &str, subject: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        Err(format!("O identificador deste {subject} não é válido."))
    } else {
        Ok(value.to_string())
    }
}

fn normalize_output_formats(
    output_formats: Option<Vec<String>>,
) -> Result<Vec<RequestedOutputFormat>, String> {
    let requested = output_formats.unwrap_or_else(|| vec!["mov".to_string(), "mp4".to_string()]);
    if requested.is_empty() {
        return Err("Escolha MOV, MP4 ou os dois formatos para continuar.".to_string());
    }

    let mut normalized = Vec::with_capacity(requested.len());
    for value in requested {
        let format = match value.trim().to_ascii_lowercase().as_str() {
            "mov" => RequestedOutputFormat::Mov,
            "mp4" => RequestedOutputFormat::Mp4,
            _ => return Err("Escolha MOV, MP4 ou os dois formatos para continuar.".to_string()),
        };
        if normalized.contains(&format) {
            return Err("Cada formato deve ser escolhido apenas uma vez.".to_string());
        }
        normalized.push(format);
    }
    Ok(normalized)
}

fn submission_output_specs<'a>(
    formats: &[RequestedOutputFormat],
    paths: &'a [PathBuf; 2],
) -> Vec<(RequestedOutputFormat, &'a Path)> {
    formats
        .iter()
        .copied()
        .map(|format| (format, paths[format.path_index()].as_path()))
        .collect()
}

fn output_progress_bounds(index: usize, output_count: usize) -> (u8, u8) {
    if output_count == 0 || index >= output_count {
        return (0, 0);
    }
    let start = (index * 100 / output_count) as u8;
    let end = ((index + 1) * 100 / output_count) as u8;
    (start, end.saturating_sub(start))
}

fn clean_path_component(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(128)
        .collect()
}

#[derive(Default)]
struct AttemptCleanup {
    paths: Vec<PathBuf>,
}

impl AttemptCleanup {
    fn track(&mut self, path: PathBuf) {
        self.paths.push(path);
    }
}

impl Drop for AttemptCleanup {
    fn drop(&mut self) {
        for path in &self.paths {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(_) => continue,
            }
            if let Some(attempt_directory) = path.parent() {
                let _ = fs::remove_dir(attempt_directory);
                if let Some(job_directory) = attempt_directory.parent() {
                    let _ = fs::remove_dir(job_directory);
                    if let Some(render_directory) = job_directory.parent() {
                        let _ = fs::remove_dir(render_directory);
                    }
                }
            }
        }
    }
}

fn cleanup_attempt_directories_for_job(root: &Path, job: &PendingJob) -> Result<(), String> {
    let mut groups: HashMap<PathBuf, Vec<std::ffi::OsString>> = HashMap::new();
    for output in &job.outputs {
        let destination = resolve_protocol_path(root, &output.destination_relative_path)?;
        let parent = destination
            .parent()
            .ok_or_else(|| "A pasta final do render não foi reconhecida.".to_string())?;
        let file_name = destination
            .file_name()
            .ok_or_else(|| "O nome final do render não foi reconhecido.".to_string())?
            .to_os_string();
        let job_directory = parent
            .join(".arizona-render")
            .join(clean_path_component(&job.id));
        let allowed = groups.entry(job_directory).or_default();
        if !allowed.iter().any(|name| name == &file_name) {
            allowed.push(file_name);
        }
    }

    let mut errors = Vec::new();
    for (job_directory, allowed_names) in groups {
        let entries = match fs::read_dir(&job_directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                errors.push(error.to_string());
                continue;
            }
        };
        let canonical_job_directory = match fs::canonicalize(&job_directory) {
            Ok(directory) => directory,
            Err(error) => {
                errors.push(error.to_string());
                continue;
            }
        };
        if let Err(error) = ensure_inside_root(root, &canonical_job_directory) {
            errors.push(error);
            continue;
        }
        for entry in entries.flatten() {
            if entry.file_name() == "publication-backup" {
                continue;
            }
            let attempt_directory = entry.path();
            let metadata = match fs::symlink_metadata(&attempt_directory) {
                Ok(metadata) => metadata,
                Err(error) => {
                    errors.push(error.to_string());
                    continue;
                }
            };
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                errors.push("Uma tentativa antiga possui conteúdo não reconhecido.".to_string());
                continue;
            }
            let canonical_attempt = match fs::canonicalize(&attempt_directory) {
                Ok(directory) => directory,
                Err(error) => {
                    errors.push(error.to_string());
                    continue;
                }
            };
            if let Err(error) = ensure_inside_root(root, &canonical_attempt) {
                errors.push(error);
                continue;
            }
            let attempt_entries = match fs::read_dir(&attempt_directory) {
                Ok(entries) => entries,
                Err(error) => {
                    errors.push(error.to_string());
                    continue;
                }
            };
            let mut recognized = true;
            let mut files = Vec::new();
            for attempt_entry in attempt_entries.flatten() {
                let path = attempt_entry.path();
                if !allowed_names
                    .iter()
                    .any(|expected_name| attempt_entry.file_name() == *expected_name)
                    || !fs::symlink_metadata(&path)
                        .map(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
                        .unwrap_or(false)
                {
                    recognized = false;
                    break;
                }
                files.push(path);
            }
            if !recognized {
                errors.push("Uma tentativa antiga possui conteúdo não reconhecido.".to_string());
                continue;
            }
            for file in files {
                if let Err(error) = fs::remove_file(file) {
                    errors.push(error.to_string());
                }
            }
            let _ = fs::remove_dir(&attempt_directory);
        }
        let _ = fs::remove_dir(&job_directory);
        if let Some(render_directory) = job_directory.parent() {
            let _ = fs::remove_dir(render_directory);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn cleanup_terminal_attempts_from_status(root: &Path, status: &Value) -> Result<(), String> {
    let worker_device_id = status
        .pointer("/worker/deviceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if worker_device_id.is_empty() {
        return Ok(());
    }
    let mut errors = Vec::new();
    for value in status
        .get("jobs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let is_target = value_text(
            value,
            &[
                "targetWorkerDeviceId",
                "targetDeviceId",
                "target_worker_device_id",
            ],
        )
        .as_deref()
            == Some(worker_device_id);
        let is_terminal = value_text(value, &["status", "outcome"])
            .is_some_and(|status| matches!(status.as_str(), "completed" | "failed" | "cancelled"));
        if !is_terminal {
            continue;
        }
        if let Some(job) = parse_pending_job(value) {
            if is_target {
                if let Err(error) = cleanup_attempt_directories_for_job(root, &job) {
                    errors.push(error);
                }
            }
            let is_requester = value_text(value, &["requesterDeviceId", "requester_device_id"])
                .as_deref()
                == Some(worker_device_id);
            if is_requester {
                if let Err(error) = remove_terminal_snapshot(root, &job) {
                    errors.push(error);
                }
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn remove_terminal_snapshot(root: &Path, job: &PendingJob) -> Result<(), String> {
    let snapshot = resolve_protocol_path(root, &job.project_relative_path)?;
    if !snapshot
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("aep"))
    {
        return Err("A cópia temporária do projeto não foi reconhecida.".to_string());
    }
    let snapshot_directory = snapshot
        .parent()
        .ok_or_else(|| "A pasta da cópia temporária não foi reconhecida.".to_string())?;
    if snapshot_directory
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        != Some(".arizona-render")
    {
        return Err("A cópia temporária do projeto não está em uma pasta segura.".to_string());
    }
    if snapshot.exists() {
        ensure_safe_destination(root, &snapshot)?;
    }
    remove_snapshot_file(&snapshot).map_err(|error| error.to_string())
}

fn random_uuid_v4() -> String {
    let mut bytes = [0_u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

#[cfg(windows)]
struct PreventSleep;

#[cfg(windows)]
impl PreventSleep {
    fn new() -> Self {
        #[link(name = "Kernel32")]
        extern "system" {
            fn SetThreadExecutionState(flags: u32) -> u32;
        }
        const ES_CONTINUOUS: u32 = 0x8000_0000;
        const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
        unsafe {
            let _ = SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        }
        Self
    }
}

#[cfg(windows)]
impl Drop for PreventSleep {
    fn drop(&mut self) {
        #[link(name = "Kernel32")]
        extern "system" {
            fn SetThreadExecutionState(flags: u32) -> u32;
        }
        const ES_CONTINUOUS: u32 = 0x8000_0000;
        unsafe {
            let _ = SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

#[cfg(not(windows))]
struct PreventSleep;

#[cfg(not(windows))]
impl PreventSleep {
    fn new() -> Self {
        Self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("arizona-render-queue-{label}-{}", random_uuid_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn test_output(relative: &str, fingerprint: Option<String>) -> RenderOutput {
        RenderOutput {
            kind: "mov".to_string(),
            composition: "EXPORT".to_string(),
            template: "PROXY".to_string(),
            destination_relative_path: relative.to_string(),
            replace_existing: fingerprint.is_some(),
            existing_fingerprint: fingerprint,
        }
    }

    #[test]
    fn builds_uuid_v4_shape() {
        let value = random_uuid_v4();
        assert_eq!(value.len(), 36);
        assert_eq!(&value[14..15], "4");
        assert!(matches!(&value[19..20], "8" | "9" | "a" | "b"));
    }

    #[test]
    fn an_open_after_effects_is_only_a_worker_advisory() {
        let warning = after_effects_open_advisory(true).unwrap();
        assert!(warning.contains("continuará aceitando renders"));
        assert!(warning.contains("fechá-lo pode liberar mais recursos"));
        assert_eq!(after_effects_open_advisory(false), None);
    }

    #[test]
    fn rejects_absolute_and_parent_protocol_paths() {
        let root = Path::new("C:\\Drive");
        assert!(resolve_protocol_path(root, "CARREFOUR/projeto.aep").is_ok());
        assert!(resolve_protocol_path(root, "../segredo.aep").is_err());
        assert!(resolve_protocol_path(root, "C:/segredo.aep").is_err());
        assert!(resolve_protocol_path(root, "/segredo.aep").is_err());
    }

    #[test]
    fn cleans_snapshots_only_after_conclusive_preinsert_rejections() {
        for code in [
            "render_target_worker_not_found",
            "render_worker_not_available",
            "render_output_destination_in_use",
        ] {
            assert!(submission_rejection_guarantees_no_job(code));
        }

        for ambiguous in [
            "network_error",
            "invalid_server_response",
            "rate_limited",
            "device_not_active",
            "render_invalid_manifest",
            "render_idempotency_conflict",
        ] {
            assert!(!submission_rejection_guarantees_no_job(ambiguous));
        }
    }

    #[test]
    fn snapshot_hash_yields_to_lease_ticks() {
        let root = TestDirectory::new("snapshot-heartbeat");
        let project = root.0.join("snapshot.aep");
        fs::write(&project, vec![7_u8; 2 * 1024 * 1024 + 1]).unwrap();
        let (size, sha256) = sha256_file(&project).unwrap();
        let job = PendingJob {
            id: "job-snapshot-heartbeat".to_string(),
            title: "Projeto".to_string(),
            project_relative_path: "snapshot.aep".to_string(),
            project_size_bytes: size,
            project_sha256: sha256,
            outputs: Vec::new(),
        };
        let ticks = Cell::new(0_u8);

        let verified = verify_snapshot_with_tick(&root.0, &job, || {
            ticks.set(ticks.get().saturating_add(1));
            Ok(())
        })
        .unwrap();

        assert!(paths_equal(&verified, &fs::canonicalize(project).unwrap()));
        assert!(ticks.get() >= 3);
    }

    #[test]
    fn parses_only_bounded_progress_percentages() {
        assert_eq!(parse_progress_percent("PROGRESS 42%"), Some(42));
        assert_eq!(parse_progress_percent("PROGRESS 101%"), None);
        assert_eq!(parse_progress_percent("PROGRESS"), None);
    }

    #[test]
    fn normalizes_requested_output_formats_safely() {
        assert_eq!(
            normalize_output_formats(None).unwrap(),
            vec![RequestedOutputFormat::Mov, RequestedOutputFormat::Mp4]
        );
        assert_eq!(
            normalize_output_formats(Some(vec![" MP4 ".to_string()])).unwrap(),
            vec![RequestedOutputFormat::Mp4]
        );
        assert!(normalize_output_formats(Some(Vec::new())).is_err());
        assert!(
            normalize_output_formats(Some(vec!["mov".to_string(), "MOV".to_string(),])).is_err()
        );
        assert!(normalize_output_formats(Some(vec!["avi".to_string()])).is_err());
    }

    #[test]
    fn scales_progress_to_the_requested_output_count() {
        assert_eq!(output_progress_bounds(0, 1), (0, 100));
        assert_eq!(output_progress_bounds(0, 2), (0, 50));
        assert_eq!(output_progress_bounds(1, 2), (50, 50));
        assert_eq!(output_progress_bounds(0, 0), (0, 0));
    }

    #[test]
    fn parses_mov_mp4_or_both_with_the_official_recipe() {
        let mov = json!({
            "kind": "mov",
            "comp": "EXPORT",
            "template": "PROXY",
            "destinationRelativePath": "out/projeto.mov",
            "replaceExisting": false
        });
        let mp4 = json!({
            "kind": "mp4",
            "comp": "EXPORT_MP4",
            "template": "MP4",
            "destinationRelativePath": "out/projeto.mp4",
            "replaceExisting": false
        });
        let job = |outputs: Value| {
            json!({
                "id": "job-formatos",
                "manifest": {
                    "projectName": "projeto.aep",
                    "projectRelativePath": "projetos/.arizona-render/job-formatos/projeto.aep",
                    "projectSizeBytes": 10,
                    "projectSha256": "0".repeat(64),
                    "recipe": "arizona-render-v1",
                    "outputs": outputs
                }
            })
        };

        let mov_job = parse_pending_job(&job(json!([mov.clone()]))).unwrap();
        assert_eq!(requested_output_flags(&mov_job.outputs), (true, false));
        let mp4_job = parse_pending_job(&job(json!([mp4.clone()]))).unwrap();
        assert_eq!(requested_output_flags(&mp4_job.outputs), (false, true));
        let both_job = parse_pending_job(&job(json!([mov.clone(), mp4]))).unwrap();
        assert_eq!(requested_output_flags(&both_job.outputs), (true, true));

        assert!(parse_pending_job(&job(json!([]))).is_none());
        assert!(parse_pending_job(&job(json!([mov.clone(), mov]))).is_none());
    }

    #[test]
    fn recovers_only_an_active_job_reserved_by_this_worker() {
        let mut response = json!({
            "worker": { "deviceId": "worker-a" },
            "recoverableJob": {
                "id": "job-a",
                "status": "claimed",
                "targetWorkerDeviceId": "worker-a",
                "manifest": {
                    "jobId": "job-a",
                    "projectName": "projeto.aep",
                    "projectRelativePath": "projetos/.arizona-render/job-a/projeto.aep",
                    "projectSizeBytes": 10,
                    "projectSha256": "0".repeat(64),
                    "recipe": "arizona-render-v1",
                    "outputs": [
                        {
                            "kind": "mov",
                            "comp": "EXPORT",
                            "template": "PROXY",
                            "destinationRelativePath": "out/projeto.mov",
                            "replaceExisting": false
                        },
                        {
                            "kind": "mp4",
                            "comp": "EXPORT_MP4",
                            "template": "MP4",
                            "destinationRelativePath": "out/projeto.mp4",
                            "replaceExisting": false
                        }
                    ]
                }
            }
        });

        assert_eq!(
            recoverable_job_from_response(&response).map(|job| job.id),
            Some("job-a".to_string())
        );
        response["recoverableJob"]["targetWorkerDeviceId"] = json!("worker-b");
        assert!(recoverable_job_from_response(&response).is_none());
        response["recoverableJob"]["targetWorkerDeviceId"] = json!("worker-a");
        response["recoverableJob"]["status"] = json!("queued");
        assert!(recoverable_job_from_response(&response).is_none());
    }

    #[test]
    fn derives_the_existing_local_output_recipe() {
        let project = Path::new("I:\\Drive\\CARREFOUR\\FILMES\\2026\\08_AGOSTO\\12_ABC_12345_x\\PROJETOS\\AE\\123_SP_v1.aep");
        let outputs = official_output_paths(project).unwrap();
        assert!(outputs[0].ends_with("OUT\\RENDER\\MOV\\123_SP_v1.mov"));
        assert!(outputs[1].ends_with("OUT\\RENDER\\MP4\\123_SP_v1.mp4"));
    }

    #[test]
    fn preserves_the_existing_cla_output_exception() {
        let project = Path::new(
            "I:\\Drive\\CARREFOUR\\FILMES\\2026\\08_AGOSTO\\12_ABC_12345_x\\PROJETOS\\AE\\CLA_RJ_v1.aep",
        );
        let outputs = official_output_paths(project).unwrap();
        assert!(outputs[0].ends_with("PROJETOS\\OUT\\CLA_RJ_v1.mov"));
        assert!(outputs[1].ends_with("PROJETOS\\OUT\\CLA_RJ_v1.mp4"));
    }

    #[test]
    fn selects_only_the_requested_official_destinations() {
        let normal_project = Path::new(
            "I:\\Drive\\CARREFOUR\\FILMES\\2026\\08_AGOSTO\\12_ABC_12345_x\\PROJETOS\\AE\\123_SP_v1.aep",
        );
        let normal_paths = official_output_paths(normal_project).unwrap();
        let mov_only = submission_output_specs(&[RequestedOutputFormat::Mov], &normal_paths);
        assert_eq!(mov_only.len(), 1);
        assert!(mov_only[0].1.ends_with("OUT\\RENDER\\MOV\\123_SP_v1.mov"));

        let mp4_only = submission_output_specs(&[RequestedOutputFormat::Mp4], &normal_paths);
        assert_eq!(mp4_only.len(), 1);
        assert!(mp4_only[0].1.ends_with("OUT\\RENDER\\MP4\\123_SP_v1.mp4"));

        let cla_project = Path::new(
            "J:\\Drive\\CARREFOUR\\FILMES\\2026\\08_AGOSTO\\12_ABC_12345_x\\PROJETOS\\AE\\CLA_CUR_v2.aep",
        );
        let cla_paths = official_output_paths(cla_project).unwrap();
        let both = submission_output_specs(
            &[RequestedOutputFormat::Mov, RequestedOutputFormat::Mp4],
            &cla_paths,
        );
        assert_eq!(both.len(), 2);
        assert!(both[0].1.ends_with("PROJETOS\\OUT\\CLA_CUR_v2.mov"));
        assert!(both[1].1.ends_with("PROJETOS\\OUT\\CLA_CUR_v2.mp4"));
    }

    #[test]
    fn resolves_the_same_relative_output_under_another_local_root() {
        let requester_root = TestDirectory::new("requester-root");
        let worker_root = TestDirectory::new("worker-root");
        let relative = "CARREFOUR/FILMES/JOB/OUT/RENDER/MP4/projeto.mp4";

        assert_eq!(
            resolve_protocol_path(&requester_root.0, relative).unwrap(),
            requester_root
                .0
                .join("CARREFOUR/FILMES/JOB/OUT/RENDER/MP4/projeto.mp4")
        );
        assert_eq!(
            resolve_protocol_path(&worker_root.0, relative).unwrap(),
            worker_root
                .0
                .join("CARREFOUR/FILMES/JOB/OUT/RENDER/MP4/projeto.mp4")
        );
    }

    #[test]
    fn publication_refuses_a_destination_changed_after_confirmation() {
        let root = TestDirectory::new("changed-destination");
        let destination = root.0.join("final.mov");
        let temporary = root.0.join("new.mov");
        fs::write(&destination, b"confirmed version").unwrap();
        let expected = destination_fingerprint(&destination).unwrap();
        fs::write(&destination, b"changed after confirmation").unwrap();
        fs::write(&temporary, b"new render").unwrap();
        let (size, sha256) = sha256_file(&temporary).unwrap();
        let output = test_output("final.mov", expected);

        let error = publish_output_set(
            &root.0,
            "job-changed",
            &[(output, temporary.clone(), destination.clone(), size, sha256)],
            &RenderQueueState::new(),
            || Ok(()),
        )
        .unwrap_err();

        assert!(error.starts_with("output_conflict:"));
        assert_eq!(
            fs::read(&destination).unwrap(),
            b"changed after confirmation"
        );
        assert_eq!(fs::read(&temporary).unwrap(), b"new render");
    }

    #[test]
    fn rollback_restores_both_previous_outputs() {
        let root = TestDirectory::new("rollback-pair");
        let mov_destination = root.0.join("final.mov");
        let mp4_destination = root.0.join("final.mp4");
        let mov_temporary = root.0.join("new.mov");
        let mp4_temporary = root.0.join("new.mp4");
        fs::write(&mov_destination, b"old mov").unwrap();
        fs::write(&mp4_destination, b"old mp4").unwrap();
        fs::write(&mov_temporary, b"new mov").unwrap();
        fs::write(&mp4_temporary, b"new mp4").unwrap();

        let mov_expected = destination_fingerprint(&mov_destination).unwrap();
        let mp4_expected = destination_fingerprint(&mp4_destination).unwrap();
        let (mov_size, mov_hash) = sha256_file(&mov_temporary).unwrap();
        let (mp4_size, mp4_hash) = sha256_file(&mp4_temporary).unwrap();
        let outputs = vec![
            (
                test_output("final.mov", mov_expected),
                mov_temporary,
                mov_destination.clone(),
                mov_size,
                mov_hash,
            ),
            (
                RenderOutput {
                    kind: "mp4".to_string(),
                    composition: "EXPORT_MP4".to_string(),
                    template: "MP4".to_string(),
                    destination_relative_path: "final.mp4".to_string(),
                    replace_existing: true,
                    existing_fingerprint: mp4_expected,
                },
                mp4_temporary,
                mp4_destination.clone(),
                mp4_size,
                mp4_hash,
            ),
        ];

        let records = publish_output_set(
            &root.0,
            "job-pair",
            &outputs,
            &RenderQueueState::new(),
            || Ok(()),
        )
        .unwrap();
        assert_eq!(fs::read(&mov_destination).unwrap(), b"new mov");
        assert_eq!(fs::read(&mp4_destination).unwrap(), b"new mp4");

        rollback_publication(&records).unwrap();
        assert_eq!(fs::read(&mov_destination).unwrap(), b"old mov");
        assert_eq!(fs::read(&mp4_destination).unwrap(), b"old mp4");
    }

    #[test]
    fn rollback_resumes_after_one_output_was_already_restored() {
        let root = TestDirectory::new("rollback-resume");
        let mov_destination = root.0.join("final.mov");
        let mp4_destination = root.0.join("final.mp4");
        let mov_temporary = root.0.join("new.mov");
        let mp4_temporary = root.0.join("new.mp4");
        fs::write(&mov_destination, b"old mov").unwrap();
        fs::write(&mp4_destination, b"old mp4").unwrap();
        fs::write(&mov_temporary, b"new mov").unwrap();
        fs::write(&mp4_temporary, b"new mp4").unwrap();

        let mov_expected = destination_fingerprint(&mov_destination).unwrap();
        let mp4_expected = destination_fingerprint(&mp4_destination).unwrap();
        let (mov_size, mov_hash) = sha256_file(&mov_temporary).unwrap();
        let (mp4_size, mp4_hash) = sha256_file(&mp4_temporary).unwrap();
        let outputs = vec![
            (
                test_output("final.mov", mov_expected),
                mov_temporary,
                mov_destination.clone(),
                mov_size,
                mov_hash,
            ),
            (
                RenderOutput {
                    kind: "mp4".to_string(),
                    composition: "EXPORT_MP4".to_string(),
                    template: "MP4".to_string(),
                    destination_relative_path: "final.mp4".to_string(),
                    replace_existing: true,
                    existing_fingerprint: mp4_expected,
                },
                mp4_temporary,
                mp4_destination.clone(),
                mp4_size,
                mp4_hash,
            ),
        ];
        let records = publish_output_set(
            &root.0,
            "job-resume",
            &outputs,
            &RenderQueueState::new(),
            || Ok(()),
        )
        .unwrap();
        let ticks = Cell::new(0_u8);

        let first = rollback_publication_with_tick(&records, || {
            let current = ticks.get().saturating_add(1);
            ticks.set(current);
            if current == 4 {
                Err("temporary heartbeat failure".to_string())
            } else {
                Ok(())
            }
        });
        assert!(first.is_err());

        rollback_publication(&records).unwrap();
        assert_eq!(fs::read(&mov_destination).unwrap(), b"old mov");
        assert_eq!(fs::read(&mp4_destination).unwrap(), b"old mp4");
    }

    #[test]
    fn terminal_rollback_never_replaces_a_newer_output() {
        let root = TestDirectory::new("terminal-rollback-conflict");
        let destination = root.0.join("final.mov");
        let temporary = root.0.join("new.mov");
        fs::write(&destination, b"old mov").unwrap();
        fs::write(&temporary, b"render from old job").unwrap();
        let expected = destination_fingerprint(&destination).unwrap();
        let (size, sha256) = sha256_file(&temporary).unwrap();
        let records = publish_output_set(
            &root.0,
            "job-terminal-conflict",
            &[(
                test_output("final.mov", expected),
                temporary,
                destination.clone(),
                size,
                sha256,
            )],
            &RenderQueueState::new(),
            || Ok(()),
        )
        .unwrap();
        fs::write(&destination, b"newer render").unwrap();

        assert!(rollback_terminal_publication(&records).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"newer render");
        assert_eq!(fs::read(&records[0].backup).unwrap(), b"old mov");
        assert!(records[0].journal.exists());
    }

    #[test]
    fn unfenced_cancel_preserves_the_recovery_journal_without_rollback() {
        let root = TestDirectory::new("unfenced-cancel");
        let first_destination = root.0.join("first.mov");
        let second_destination = root.0.join("second.mp4");
        let first_temporary = root.0.join("new-first.mov");
        let second_temporary = root.0.join("new-second.mp4");
        fs::write(&first_destination, b"old first").unwrap();
        fs::write(&second_destination, b"old second").unwrap();
        fs::write(&first_temporary, b"new first").unwrap();
        fs::write(&second_temporary, b"new second").unwrap();
        let first_expected = destination_fingerprint(&first_destination).unwrap();
        let second_expected = destination_fingerprint(&second_destination).unwrap();
        let (first_size, first_hash) = sha256_file(&first_temporary).unwrap();
        let (second_size, second_hash) = sha256_file(&second_temporary).unwrap();
        let outputs = vec![
            (
                test_output("first.mov", first_expected),
                first_temporary.clone(),
                first_destination.clone(),
                first_size,
                first_hash.clone(),
            ),
            (
                RenderOutput {
                    kind: "mp4".to_string(),
                    composition: "EXPORT_MP4".to_string(),
                    template: "MP4".to_string(),
                    destination_relative_path: "second.mp4".to_string(),
                    replace_existing: true,
                    existing_fingerprint: second_expected,
                },
                second_temporary.clone(),
                second_destination,
                second_size,
                second_hash,
            ),
        ];
        let ticks = Cell::new(0_u8);

        let error = publish_output_set(
            &root.0,
            "job-unfenced",
            &outputs,
            &RenderQueueState::new(),
            || {
                let current = ticks.get().saturating_add(1);
                ticks.set(current);
                if current == 4 {
                    Err("cancelled_unfenced: connection unavailable".to_string())
                } else {
                    Ok(())
                }
            },
        )
        .unwrap_err();

        let record = publication_record(&first_destination, "job-unfenced", &first_hash).unwrap();
        assert!(error.starts_with("cancelled_unfenced:"));
        assert!(!first_destination.exists());
        assert!(record.backup.exists());
        assert!(record.journal.exists());
        assert!(first_temporary.exists());
        assert!(second_temporary.exists());
    }

    #[test]
    fn cleanup_accepts_mov_and_mp4_in_the_same_cla_attempt_directory() {
        let root = TestDirectory::new("cleanup-cla");
        let attempt = root
            .0
            .join("OUT")
            .join(".arizona-render")
            .join("job-cla")
            .join("attempt-1");
        fs::create_dir_all(&attempt).unwrap();
        fs::write(attempt.join("video.mov"), b"partial mov").unwrap();
        fs::write(attempt.join("video.mp4"), b"partial mp4").unwrap();
        let job = PendingJob {
            id: "job-cla".to_string(),
            title: "CLA".to_string(),
            project_relative_path: "snapshot.aep".to_string(),
            project_size_bytes: 1,
            project_sha256: "0".repeat(64),
            outputs: vec![
                test_output("OUT/video.mov", None),
                RenderOutput {
                    kind: "mp4".to_string(),
                    composition: "EXPORT_MP4".to_string(),
                    template: "MP4".to_string(),
                    destination_relative_path: "OUT/video.mp4".to_string(),
                    replace_existing: false,
                    existing_fingerprint: None,
                },
            ],
        };

        cleanup_attempt_directories_for_job(&root.0, &job).unwrap();

        assert!(!attempt.exists());
    }

    #[test]
    fn recovery_restores_the_previous_file_after_an_interrupted_publish() {
        let root = TestDirectory::new("crash-recovery");
        let destination = root.0.join("final.mov");
        let temporary = root.0.join("new.mov");
        fs::write(&destination, b"old output").unwrap();
        fs::write(&temporary, b"new output").unwrap();
        let expected = destination_fingerprint(&destination).unwrap();
        let (_, published_hash) = sha256_file(&temporary).unwrap();
        let mut record = publication_record(&destination, "job-recovery", &published_hash).unwrap();
        fs::create_dir_all(record.backup.parent().unwrap()).unwrap();
        record.original_existed = true;
        write_publication_journal(&record).unwrap();
        fs::rename(&destination, &record.backup).unwrap();
        move_file_without_replacement(&temporary, &destination).unwrap();

        let job = PendingJob {
            id: "job-recovery".to_string(),
            title: "Projeto".to_string(),
            project_relative_path: "snapshot.aep".to_string(),
            project_size_bytes: 1,
            project_sha256: "0".repeat(64),
            outputs: vec![test_output("final.mov", expected)],
        };
        recover_interrupted_publication(&root.0, &job, || Ok(())).unwrap();

        assert_eq!(fs::read(&destination).unwrap(), b"old output");
        assert!(!record.backup.exists());
        assert!(!record.journal.exists());
    }
}
