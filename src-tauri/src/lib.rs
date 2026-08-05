mod after_effects;
mod arizona;
mod auth;
mod cep_bridge;
mod cep_manager;
mod device_identity;
mod history;
mod license;
mod media;
mod settings;
mod uninstall;

use after_effects::AfterEffectsAction;
use arizona::{ActionResponse, Arizona, MediaFile, OpenedProject, ProductImportReport};
use cep_bridge::CepBridgeState;
use chrono::{SecondsFormat, Utc};
use license::{LicenseInput, LicenseStatus};
use settings::AppConfig;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, Window,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub fn release_device_for_uninstall_cli() -> i32 {
    uninstall::release_device_for_uninstall_cli()
}

pub fn clear_local_auth_for_uninstall_cli() -> i32 {
    uninstall::clear_local_auth_for_uninstall_cli()
}

#[derive(Default)]
struct AuthState {
    session: Mutex<Option<AuthSession>>,
    operation: Mutex<()>,
}

impl AuthState {
    fn lock_operation(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.operation
            .lock()
            .map_err(|_| "Não foi possível coordenar a autenticação.".to_string())
    }
}

#[derive(Clone, Copy)]
enum AuthenticatedUiMode {
    Reveal,
    Refresh,
}

impl AuthenticatedUiMode {
    fn event_name(self) -> &'static str {
        match self {
            Self::Reveal => "arizona-auth:login",
            Self::Refresh => "arizona-auth:update",
        }
    }

    fn should_reveal_window(self) -> bool {
        matches!(self, Self::Reveal)
    }
}

#[derive(Default)]
struct AfterShortcutState {
    registered: Mutex<Vec<RegisteredAfterShortcut>>,
    suspended: Mutex<bool>,
}

#[derive(Default)]
struct SecondaryWindowRuntimeState {
    active_view: Mutex<Option<String>>,
}

#[derive(Default)]
struct MediaPathCache {
    paths: Mutex<HashMap<String, PathBuf>>,
}

#[derive(Default)]
struct MediaLoadRuntimeState {
    generation: AtomicU64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct RegisteredAfterShortcut {
    shortcut: Shortcut,
    action: AfterEffectsAction,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSession {
    #[serde(skip_serializing)]
    access_token: Option<String>,
    #[serde(skip_serializing)]
    refresh_token: Option<String>,
    #[serde(skip_serializing)]
    cep_license_receipt: Option<String>,
    email: String,
    member_id: Option<String>,
    role: Option<String>,
    organization_id: Option<String>,
    organization_name: Option<String>,
    seats_allowed: Option<i64>,
    expires_at: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AfterEffectsNotice {
    level: &'static str,
    code: &'static str,
    message: String,
    detail: String,
    action: Option<&'static str>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminWindowAuth {
    organization_id: String,
    current_member_id: Option<String>,
    email: String,
    role: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionWindowAuth {
    organization_id: Option<String>,
    current_member_id: Option<String>,
    email: String,
    role: Option<String>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SecureAuthRecord {
    refresh_token: String,
    cep_license_receipt: Option<String>,
    email: String,
    auth_day: Option<String>,
    #[serde(alias = "passwordLoginAt")]
    mfa_verified_at: Option<String>,
    server_time: Option<String>,
    local_time: Option<String>,
    expires_at: Option<String>,
    member_id: Option<String>,
    role: Option<String>,
    organization_id: Option<String>,
    organization_name: Option<String>,
    seats_allowed: Option<i64>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicAuthSession {
    email: String,
    member_id: Option<String>,
    role: Option<String>,
    organization_id: Option<String>,
    organization_name: Option<String>,
    seats_allowed: Option<i64>,
    expires_at: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthFlowResponse {
    state: &'static str,
    code: Option<String>,
    message: Option<String>,
    retry_after_seconds: Option<u64>,
    email: Option<String>,
    session: Option<PublicAuthSession>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CepLicenseReceiptFile {
    version: u8,
    receipt: String,
    updated_at: String,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub fn run() {
    let _single_instance_guard = match single_instance::acquire() {
        Ok(guard) => guard,
        Err(err) => {
            eprintln!("{err}");
            return;
        }
    };

    tauri::Builder::default()
        .manage(AuthState::default())
        .manage(CepBridgeState::new())
        .manage(AfterShortcutState::default())
        .manage(SecondaryWindowRuntimeState::default())
        .manage(MediaPathCache::default())
        .manage(MediaLoadRuntimeState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let Some(action) = after_command_action_for_shortcut(app, shortcut) else {
                            return;
                        };

                        if secondary_duplicate_window_is_active(app) {
                            return;
                        }

                        let auth = app.state::<AuthState>();
                        let response = run_after_effects_action(app, &auth, action);
                        if !response.is_ok() {
                            if let Some(message) = response.message() {
                                notify_after_effects_shortcut_error(app, message, Some(action));
                            }
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if window.label() != APP_WINDOW_LABEL {
                return;
            }

            match event {
                WindowEvent::CloseRequested { .. } => {
                    save_app_window_position(window);
                }
                _ => {}
            }
        })
        .setup(|app| {
            disable_browser_accelerator_keys(app);
            let bridge = app.state::<CepBridgeState>();
            let app_handle = app.handle().clone();
            remove_legacy_cep_bridge_session(&app_handle);
            restore_app_window_position(&app_handle);
            let config = settings::load(&app_handle).unwrap_or_default();
            if let Err(err) = register_after_command_shortcuts(&app_handle, &config) {
                let message = format!("Nao foi possivel registrar atalho do After: {err}");
                eprintln!("{message}");
                bridge.set_last_error(message);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cep_bridge_status,
            after_effects_action_command,
            list_installed_after_effects_versions,
            set_after_shortcut_recording,
            auth_resume,
            auth_activate,
            auth_poll,
            restrict_admin_session,
            exit_app,
            open_visto,
            open_bitrix,
            open_pip,
            open_claro,
            open_links,
            open_jobao,
            open_jobinho,
            abrir_ae,
            open_out,
            import_products,
            open_secondary_window,
            close_secondary_window,
            open_duplicate_identical_window,
            list_identical_mp4_items,
            export_identical_mp4_names_json,
            update_identical_mp4_names_json,
            import_identical_mp4_names_json,
            duplicate_identical_mp4,
            open_video,
            open_audio,
            open_media_native,
            reveal_video,
            open_roteiro,
            history_list,
            history_clear,
            history_copy_list,
            history_copy_clear,
            history_product_import_list,
            history_product_import_clear,
            history_copy_open_folder,
            history_copy_reveal_media,
            history_copy_open_media,
            history_open_jobao_folder,
            history_reveal_after_project,
            history_open_after_project,
            history_reveal_media,
            history_open_media,
            history_refresh_entry,
            history_refresh_all_entries,
            project_name,
            app_info,
            clear_secure_auth,
            admin_list_members,
            admin_add_member,
            admin_release_device,
            admin_remove_member,
            admin_generate_activation_code,
            release_current_device,
            open_author_site,
            load_app_config,
            save_app_config,
            cep_manager::cep_debug_mode_status,
            cep_manager::set_cep_debug_mode,
            cep_manager::cep_extension_status,
            cep_manager::inspect_cep_zxp,
            cep_manager::install_cep_zxp
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn after_command_action_for_shortcut(
    app: &AppHandle,
    shortcut: &Shortcut,
) -> Option<AfterEffectsAction> {
    let state = app.state::<AfterShortcutState>();
    if state.suspended.lock().map(|value| *value).unwrap_or(true) {
        return None;
    }

    state.registered.lock().ok().and_then(|registered| {
        registered
            .iter()
            .find(|item| item.shortcut == *shortcut)
            .map(|item| item.action)
    })
}

fn secondary_duplicate_window_is_active(app: &AppHandle) -> bool {
    let Some(view) = app
        .state::<SecondaryWindowRuntimeState>()
        .active_view
        .lock()
        .ok()
        .and_then(|active_view| active_view.clone())
    else {
        return false;
    };

    if view != "duplicate" {
        return false;
    }

    app.get_webview_window(SECONDARY_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn set_secondary_active_view(app: &AppHandle, view: Option<&str>) {
    if let Ok(mut active_view) = app
        .state::<SecondaryWindowRuntimeState>()
        .active_view
        .lock()
    {
        *active_view = view.map(ToOwned::to_owned);
    }
}

fn register_after_command_shortcuts(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let requested = configured_after_shortcuts(config)?;

    let shortcut_state = app.state::<AfterShortcutState>();
    let suspended = *shortcut_state
        .suspended
        .lock()
        .map_err(|_| "Nao foi possivel atualizar os atalhos do After.".to_string())?;
    let previous = shortcut_state
        .registered
        .lock()
        .map_err(|_| "Nao foi possivel atualizar os atalhos do After.".to_string())?
        .clone();

    if previous == requested {
        return Ok(());
    }

    if suspended {
        *shortcut_state
            .registered
            .lock()
            .map_err(|_| "Nao foi possivel atualizar os atalhos do After.".to_string())? =
            requested;
        return Ok(());
    }

    for item in &previous {
        let _ = app.global_shortcut().unregister(item.shortcut);
    }

    let mut registered_now: Vec<RegisteredAfterShortcut> = Vec::new();
    for item in &requested {
        if let Err(err) = app.global_shortcut().register(item.shortcut) {
            for registered_item in &registered_now {
                let _ = app.global_shortcut().unregister(registered_item.shortcut);
            }
            for previous_item in &previous {
                let _ = app.global_shortcut().register(previous_item.shortcut);
            }
            return Err(err.to_string());
        }
        registered_now.push(*item);
    }

    *shortcut_state
        .registered
        .lock()
        .map_err(|_| "Nao foi possivel atualizar os atalhos do After.".to_string())? = requested;

    Ok(())
}

fn suspend_after_command_shortcuts(app: &AppHandle) -> Result<(), String> {
    let shortcut_state = app.state::<AfterShortcutState>();
    {
        let mut suspended = shortcut_state
            .suspended
            .lock()
            .map_err(|_| "Nao foi possivel suspender os atalhos do After.".to_string())?;
        if *suspended {
            return Ok(());
        }

        let registered = shortcut_state
            .registered
            .lock()
            .map_err(|_| "Nao foi possivel suspender os atalhos do After.".to_string())?
            .clone();
        for item in &registered {
            let _ = app.global_shortcut().unregister(item.shortcut);
        }

        *suspended = true;
    }

    Ok(())
}

fn resume_after_command_shortcuts(app: &AppHandle) -> Result<(), String> {
    let shortcut_state = app.state::<AfterShortcutState>();
    {
        let suspended = shortcut_state
            .suspended
            .lock()
            .map_err(|_| "Nao foi possivel restaurar os atalhos do After.".to_string())?;
        if !*suspended {
            return Ok(());
        }
    }

    let registered = shortcut_state
        .registered
        .lock()
        .map_err(|_| "Nao foi possivel restaurar os atalhos do After.".to_string())?
        .clone();

    let mut registered_now: Vec<RegisteredAfterShortcut> = Vec::new();
    for item in &registered {
        if let Err(err) = app.global_shortcut().register(item.shortcut) {
            for registered_item in &registered_now {
                let _ = app.global_shortcut().unregister(registered_item.shortcut);
            }
            return Err(err.to_string());
        }
        registered_now.push(*item);
    }

    *shortcut_state
        .suspended
        .lock()
        .map_err(|_| "Nao foi possivel restaurar os atalhos do After.".to_string())? = false;

    Ok(())
}

fn configured_after_shortcuts(config: &AppConfig) -> Result<Vec<RegisteredAfterShortcut>, String> {
    let specs = [
        (
            "Mover Layers atras",
            AfterEffectsAction::MoveLayersBackward,
            config.move_layers_backward_shortcut.as_str(),
        ),
        (
            "Mover Layers frente",
            AfterEffectsAction::MoveLayersForward,
            config.move_layers_forward_shortcut.as_str(),
        ),
        (
            "Aplicar Jump",
            AfterEffectsAction::MoveJumpMarker,
            config.move_jump_marker_shortcut.as_str(),
        ),
        (
            "Selecionar Oferta",
            AfterEffectsAction::SelectJumpMarkerLayer,
            config.select_jump_marker_layer_shortcut.as_str(),
        ),
        (
            "Reset Markers",
            AfterEffectsAction::AdjustMarkersToTail,
            config.adjust_markers_shortcut.as_str(),
        ),
        (
            "Render",
            AfterEffectsAction::Render,
            config.render_shortcut.as_str(),
        ),
    ];
    let mut shortcuts = Vec::new();

    for (label, action, shortcut_text) in specs {
        let shortcut = parse_after_shortcut(label, shortcut_text)?;
        if shortcuts
            .iter()
            .any(|item: &RegisteredAfterShortcut| item.shortcut == shortcut)
        {
            return Err(format!("Atalho duplicado em {label}: {shortcut_text}"));
        }
        shortcuts.push(RegisteredAfterShortcut { shortcut, action });
    }

    Ok(shortcuts)
}

fn parse_after_shortcut(label: &str, shortcut_text: &str) -> Result<Shortcut, String> {
    let shortcut_text = shortcut_text.trim();
    shortcut_text
        .parse()
        .map_err(|err| format!("Atalho invalido em {label} (\"{shortcut_text}\"): {err}"))
}

fn notify_after_effects_shortcut_error(
    app: &AppHandle,
    message: &str,
    action: Option<AfterEffectsAction>,
) {
    eprintln!("Arizona After Effects shortcut failed: {message}");

    let (code, user_message) = after_effects_shortcut_notice(message);
    let notice = AfterEffectsNotice {
        level: "error",
        code,
        message: user_message.to_string(),
        detail: message.to_string(),
        action: action.map(AfterEffectsAction::key),
    };

    let Some(app_window) = app.get_webview_window(APP_WINDOW_LABEL) else {
        return;
    };

    let Ok(notice_json) = serde_json::to_string(&notice) else {
        return;
    };
    let script = format!(
        "window.dispatchEvent(new CustomEvent('{AFTER_EFFECTS_SHORTCUT_ERROR_EVENT}', {{ detail: {notice_json} }}));"
    );
    let _ = app_window.eval(&script);
}

fn after_effects_shortcut_notice(message: &str) -> (&'static str, &'static str) {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("sessao") || normalized.contains("licenca") {
        return (
            "after_effects_license_required",
            AFTER_EFFECTS_LICENSE_NOTICE_MESSAGE,
        );
    }
    if normalized.contains("afterfx.exe") {
        return (
            "after_effects_not_found",
            "Nao encontrei a versao configurada do After Effects.",
        );
    }

    (
        "after_effects_command_failed",
        "Nao foi possivel executar o atalho no After Effects.",
    )
}

fn disable_browser_accelerator_keys(app: &tauri::App) {
    #[cfg(windows)]
    {
        for label in [LOGIN_WINDOW_LABEL, APP_WINDOW_LABEL, SECONDARY_WINDOW_LABEL] {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.with_webview(|webview| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows_core::Interface;

                    if let Ok(core_webview) = webview.controller().CoreWebView2() {
                        if let Ok(settings) = core_webview.Settings() {
                            if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                                let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                            }
                        }
                    }
                });
            }
        }
    }

    #[cfg(not(windows))]
    let _ = app;
}

#[tauri::command]
fn open_visto(auth: State<AuthState>) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    Ok(match Arizona::new(AppConfig::default()).open_visto() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_bitrix(auth: State<AuthState>) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    Ok(match Arizona::new(AppConfig::default()).open_bitrix() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_pip(auth: State<AuthState>) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    Ok(match Arizona::new(AppConfig::default()).open_pip() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_claro(auth: State<AuthState>) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    Ok(match Arizona::new(AppConfig::default()).open_claro() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

const AUTHOR_NAME: &str = "Jonatan Magr\u{00e3}o";
const AUTHOR_URL: &str = "https://www.jonatanmagrao.com.br";
const LOGIN_WINDOW_LABEL: &str = "main";
const APP_WINDOW_LABEL: &str = "app";
const SECONDARY_WINDOW_LABEL: &str = "secondary";
const AFTER_EFFECTS_SHORTCUT_ERROR_EVENT: &str = "arizona-after-effects:shortcut-error";
const AFTER_EFFECTS_LICENSE_NOTICE_MESSAGE: &str =
    "Atalho do After bloqueado. Valide a licença novamente no Arizona App.";
const CEP_LICENSE_RECEIPT_FILE_NAME: &str = "cep-license-receipt.json";
const SECURE_AUTH_SERVICE: &str = "Arizona App";
const SECURE_AUTH_ACCOUNT: &str = "daily-session";
const SECURE_AUTH_TARGET: &str = "daily-session.Arizona App";
const APP_WINDOW_STATE_FILE_NAME: &str = "window-state.json";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    author_name: String,
    author_url: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppWindowState {
    x: i32,
    y: i32,
}

#[tauri::command]
fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    let version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| app.package_info().version.to_string());

    Ok(AppInfo {
        version,
        author_name: AUTHOR_NAME.to_string(),
        author_url: AUTHOR_URL.to_string(),
    })
}

// `ureq` is synchronous. Running it from a regular Tauri command blocks the
// WebView2 window callback, including the native move/drag message pump.
async fn run_blocking_network_command<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            format!("Não foi possível executar a operação de rede em segundo plano: {error}")
        })?
}

#[tauri::command]
async fn auth_resume(app: AppHandle, app_version: String) -> Result<AuthFlowResponse, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let bridge = app.state::<CepBridgeState>();
        let _operation = auth_state.lock_operation()?;
        auth_resume_blocking(&app, &auth_state, &bridge, &app_version)
    })
    .await
}

fn auth_resume_blocking(
    app: &AppHandle,
    auth_state: &State<AuthState>,
    bridge: &State<CepBridgeState>,
    app_version: &str,
) -> Result<AuthFlowResponse, String> {
    let Some(record) = read_secure_auth_record(&secure_auth_entry()?)? else {
        return Ok(auth_flow("activation_required", None, None));
    };

    let remote = match auth::refresh(record.refresh_token.trim()) {
        Ok(remote) => remote,
        Err(error) => {
            if should_forget_secure_auth_on_resume_error(&error) {
                forget_secure_auth(app, auth_state, bridge)?;
            }
            return Ok(api_error_flow(&error, Some(record.email)));
        }
    };

    let response = continue_remote_auth(
        app,
        auth_state,
        bridge,
        remote,
        Some(record.email),
        app_version,
        AuthenticatedUiMode::Reveal,
    );
    apply_auth_flow_ui(app, auth_state, bridge, &response)?;
    Ok(response)
}

// Only credential-erasing denials and dead refresh tokens may erase the
// keyring record; transient failures (rate limit, 5xx, malformed response)
// and the reversible org-wide blocks (license_expired,
// organization_not_active) must keep it so the next resume can retry.
fn should_forget_secure_auth_on_resume_error(error: &auth::ApiError) -> bool {
    error.should_erase_credential()
        || matches!(
            error.code.as_str(),
            "invalid_grant" | "refresh_token_not_found" | "invalid_refresh_token"
        )
}

#[tauri::command]
async fn auth_activate(
    app: AppHandle,
    email: String,
    code: String,
    app_version: String,
) -> Result<AuthFlowResponse, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let bridge = app.state::<CepBridgeState>();
        let _operation = auth_state.lock_operation()?;
        auth_activate_blocking(&app, &auth_state, &bridge, &email, &code, &app_version)
    })
    .await
}

fn auth_activate_blocking(
    app: &AppHandle,
    auth_state: &State<AuthState>,
    bridge: &State<CepBridgeState>,
    email: &str,
    code: &str,
    app_version: &str,
) -> Result<AuthFlowResponse, String> {
    let email = email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') || code.trim().is_empty() {
        return Ok(auth_flow(
            "error",
            Some("activation_invalid"),
            Some("Informe o e-mail e o código de ativação.".to_string()),
        ));
    }
    // A machine that cannot identify itself can never validate; failing here
    // keeps the activation code unspent instead of burning it on the server.
    if let Some(response) = unidentifiable_machine_flow() {
        return Ok(response);
    }

    let exchange = match auth::activate(&email, code.trim()) {
        Ok(exchange) => exchange,
        Err(error) => return Ok(api_error_flow(&error, Some(email))),
    };
    let remote = match auth::exchange_magic_link(&exchange) {
        Ok(remote) => remote,
        Err(error) => return Ok(api_error_flow(&error, Some(email))),
    };
    if exchange.recovery {
        if let Err(error) = auth::revoke_other_sessions(&remote.access_token) {
            return Ok(api_error_flow(&error, Some(email)));
        }
    }

    let response = continue_remote_auth(
        app,
        auth_state,
        bridge,
        remote,
        Some(email),
        app_version,
        AuthenticatedUiMode::Reveal,
    );
    apply_auth_flow_ui(app, auth_state, bridge, &response)?;
    Ok(response)
}

#[tauri::command]
async fn auth_poll(app: AppHandle, app_version: String) -> Result<AuthFlowResponse, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let bridge = app.state::<CepBridgeState>();
        let _operation = auth_state.lock_operation()?;
        auth_poll_blocking(&app, &auth_state, &bridge, &app_version)
    })
    .await
}

fn auth_poll_blocking(
    app: &AppHandle,
    auth_state: &State<AuthState>,
    bridge: &State<CepBridgeState>,
    app_version: &str,
) -> Result<AuthFlowResponse, String> {
    let current = authenticated_session(auth_state)?;
    let refresh_token = current
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Sessão segura incompleta.".to_string())?;

    let remote = match auth::refresh(refresh_token) {
        Ok(remote) => remote,
        Err(error) => {
            let response = api_error_flow(&error, Some(current.email));
            if error.should_erase_credential() {
                forget_secure_auth(app, auth_state, bridge)?;
            }
            apply_auth_flow_ui(app, auth_state, bridge, &response)?;
            return Ok(response);
        }
    };

    let response = continue_remote_auth(
        app,
        auth_state,
        bridge,
        remote,
        Some(current.email),
        app_version,
        // A periodic/focus refresh may finish while the user is moving the
        // window. It must update state without showing or focusing it again.
        AuthenticatedUiMode::Refresh,
    );
    apply_auth_flow_ui(app, auth_state, bridge, &response)?;
    Ok(response)
}

fn continue_remote_auth(
    app: &AppHandle,
    auth_state: &State<AuthState>,
    bridge: &State<CepBridgeState>,
    remote: auth::RemoteSession,
    fallback_email: Option<String>,
    app_version: &str,
    ui_mode: AuthenticatedUiMode,
) -> AuthFlowResponse {
    let fallback_refresh_token = authenticated_session(auth_state)
        .ok()
        .and_then(|session| session.refresh_token);
    let email = remote
        .user
        .as_ref()
        .and_then(|user| user.email.clone())
        .or(fallback_email)
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let refresh_token = if remote.refresh_token.trim().is_empty() {
        fallback_refresh_token.unwrap_or_default()
    } else {
        remote.refresh_token.clone()
    };
    let base_session = AuthSession {
        access_token: Some(remote.access_token.clone()),
        refresh_token: Some(refresh_token),
        cep_license_receipt: None,
        email: email.clone(),
        member_id: None,
        role: None,
        organization_id: None,
        organization_name: None,
        seats_allowed: None,
        expires_at: None,
    };
    if let Err(error) = persist_refreshed_token(
        &email,
        base_session.refresh_token.as_deref().unwrap_or_default(),
    ) {
        return auth_flow("error", Some("local_auth_error"), Some(error));
    }

    // Sending an empty fingerprint would be answered with a credential-erasing
    // denial; failing locally keeps the stored session for when the machine
    // becomes identifiable again.
    if let Some(response) = unidentifiable_machine_flow() {
        return response;
    }
    let device_body = match device_request_body(app, app_version) {
        Ok(body) => body,
        Err(error) => return auth_flow("error", Some("device_identity_error"), Some(error)),
    };
    let mut license = auth::validate_license(&remote.access_token, device_body.clone());
    if matches!(
        &license,
        Err(error) if matches!(
            error.code.as_str(),
            "device_not_registered" | "device_revoked" | "device_not_active"
        )
    ) {
        if let Err(error) = auth::activate_device(&remote.access_token, device_body.clone()) {
            return api_error_flow(&error, Some(email));
        }
        license = auth::validate_license(&remote.access_token, device_body);
    }

    let license = match license {
        Ok(license) => license,
        Err(error) => return api_error_flow(&error, Some(email)),
    };
    match authenticated_session_from_license(base_session, &license) {
        Ok(session) => {
            if let Err(error) = finalize_authenticated_session(
                app,
                auth_state,
                bridge,
                session.clone(),
                &license,
                ui_mode,
            ) {
                return auth_flow("error", Some("local_auth_error"), Some(error));
            }
            AuthFlowResponse {
                state: "authenticated",
                code: None,
                message: None,
                retry_after_seconds: None,
                email: Some(session.email.clone()),
                session: Some(public_session(&session)),
            }
        }
        Err(error) => auth_flow("error", Some("invalid_license_response"), Some(error)),
    }
}

fn persist_refreshed_token(email: &str, refresh_token: &str) -> Result<(), String> {
    if email.trim().is_empty() || refresh_token.trim().is_empty() {
        return Err("Sessão atualizada incompleta.".to_string());
    }
    let entry = secure_auth_entry()?;
    let mut record = read_secure_auth_record(&entry)?.unwrap_or(SecureAuthRecord {
        refresh_token: String::new(),
        cep_license_receipt: None,
        email: email.to_string(),
        auth_day: None,
        mfa_verified_at: None,
        server_time: None,
        local_time: None,
        expires_at: None,
        member_id: None,
        role: None,
        organization_id: None,
        organization_name: None,
        seats_allowed: None,
    });
    record.refresh_token = refresh_token.to_string();
    record.email = email.to_string();
    write_secure_auth_record(&record)
}

// None when the machine can identify itself; a ready-to-return flow otherwise.
// device_identity_required is outside the credential-erasing set, so hitting
// this repeatedly never destroys the stored session.
fn unidentifiable_machine_flow() -> Option<AuthFlowResponse> {
    if !device_identity::device_fingerprint_hash().is_empty() {
        return None;
    }
    Some(auth_flow(
        "error",
        Some("device_identity_required"),
        Some(
            "Não foi possível identificar esta máquina. Contate o suporte e, depois da correção, feche e abra o app novamente."
                .to_string(),
        ),
    ))
}

fn device_request_body(app: &AppHandle, app_version: &str) -> Result<serde_json::Value, String> {
    let install_id = load_or_create_install_id(app)?;
    let stored = read_secure_auth_record(&secure_auth_entry()?)?;
    Ok(serde_json::json!({
        "installId": install_id,
        "appVersion": app_version.trim(),
        "deviceLabel": std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows".to_string()),
        "deviceFingerprintHash": device_identity::device_fingerprint_hash(),
        "clientLocalTime": now_iso(),
        "lastServerTimeSeen": stored.as_ref().and_then(|record| record.server_time.clone()),
        "lastLocalTimeSeen": stored.as_ref().and_then(|record| record.local_time.clone()),
    }))
}

fn load_or_create_install_id(app: &AppHandle) -> Result<String, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let path = directory.join("install-id");
    if let Ok(value) = fs::read_to_string(&path) {
        let value = value.trim();
        if value.len() >= 32 && value.len() <= 128 {
            return Ok(value.to_string());
        }
    }

    use rand::RngCore;
    let mut bytes = [0_u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    let value = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Não foi possível criar {}: {error}", directory.display()))?;
    fs::write(&path, &value)
        .map_err(|error| format!("Não foi possível salvar {}: {error}", path.display()))?;
    Ok(value)
}

fn authenticated_session_from_license(
    mut session: AuthSession,
    license: &serde_json::Value,
) -> Result<AuthSession, String> {
    let member = license
        .get("member")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Resposta de membro ausente.".to_string())?;
    let organization = license
        .get("organization")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Resposta de organização ausente.".to_string())?;

    session.cep_license_receipt = json_text(license, "cepLicenseReceipt");
    session.email = member
        .get("email")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&session.email)
        .to_string();
    session.member_id = object_text(member, "id");
    session.role = object_text(member, "role");
    session.organization_id = object_text(organization, "id");
    session.organization_name = object_text(organization, "name");
    session.seats_allowed = organization
        .get("seatsAllowed")
        .and_then(serde_json::Value::as_i64);
    session.expires_at = json_text(license, "expiresAt");

    if session
        .cep_license_receipt
        .as_deref()
        .unwrap_or_default()
        .is_empty()
        || session.member_id.is_none()
        || session.organization_id.is_none()
        || session.expires_at.is_none()
    {
        return Err("Resposta de licença incompleta.".to_string());
    }
    Ok(session)
}

fn object_text(object: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn json_text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn finalize_authenticated_session(
    app: &AppHandle,
    auth_state: &State<AuthState>,
    bridge: &State<CepBridgeState>,
    session: AuthSession,
    license: &serde_json::Value,
    ui_mode: AuthenticatedUiMode,
) -> Result<(), String> {
    let record = SecureAuthRecord {
        refresh_token: session.refresh_token.clone().unwrap_or_default(),
        cep_license_receipt: session.cep_license_receipt.clone(),
        email: session.email.clone(),
        auth_day: json_text(license, "authDay"),
        mfa_verified_at: json_text(license, "mfaVerifiedAt"),
        server_time: json_text(license, "serverTime"),
        local_time: Some(now_iso()),
        expires_at: session.expires_at.clone(),
        member_id: session.member_id.clone(),
        role: session.role.clone(),
        organization_id: session.organization_id.clone(),
        organization_name: session.organization_name.clone(),
        seats_allowed: session.seats_allowed,
    };
    write_secure_auth_record(&record)?;
    store_auth_session(auth_state, session.clone())?;
    sync_cep_license_receipt(app, session.cep_license_receipt.as_deref())?;
    bridge.set_license_status(license_status_from_session(Some(&session)));
    emit_public_auth_session(app, ui_mode.event_name(), &session)?;
    if ui_mode.should_reveal_window() {
        show_authenticated_window(app)?;
    }
    Ok(())
}

fn write_secure_auth_record(record: &SecureAuthRecord) -> Result<(), String> {
    if record.refresh_token.trim().is_empty() || record.email.trim().is_empty() {
        return Err("Sessão segura incompleta.".to_string());
    }
    let value = serde_json::to_string(record).map_err(|error| error.to_string())?;
    secure_auth_entry()?
        .set_secret(value.as_bytes())
        .map_err(|error| format!("Não foi possível salvar a sessão segura: {error}"))
}

fn public_session(session: &AuthSession) -> PublicAuthSession {
    PublicAuthSession {
        email: session.email.clone(),
        member_id: session.member_id.clone(),
        role: session.role.clone(),
        organization_id: session.organization_id.clone(),
        organization_name: session.organization_name.clone(),
        seats_allowed: session.seats_allowed,
        expires_at: session.expires_at.clone(),
    }
}

fn emit_public_auth_session(
    app: &AppHandle,
    event_name: &str,
    session: &AuthSession,
) -> Result<(), String> {
    let public_json =
        serde_json::to_string(&public_session(session)).map_err(|error| error.to_string())?;
    let script = format!(
        "window.__ARIZONA_AUTH_SESSION__ = {public_json}; window.dispatchEvent(new CustomEvent('{event_name}', {{ detail: {public_json} }}));"
    );
    if let Some(window) = app.get_webview_window(APP_WINDOW_LABEL) {
        let _ = window.eval(script);
    }
    Ok(())
}

fn show_authenticated_window(app: &AppHandle) -> Result<(), String> {
    let app_window = app
        .get_webview_window(APP_WINDOW_LABEL)
        .ok_or_else(|| "Janela principal não foi inicializada.".to_string())?;
    app_window
        .set_title("Arizona App")
        .map_err(|error| error.to_string())?;
    app_window.unminimize().map_err(|error| error.to_string())?;
    app_window.show().map_err(|error| error.to_string())?;
    app_window.set_focus().map_err(|error| error.to_string())?;
    if let Some(login_window) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = login_window.hide();
    }
    Ok(())
}

fn apply_auth_flow_ui(
    app: &AppHandle,
    auth_state: &State<AuthState>,
    bridge: &State<CepBridgeState>,
    response: &AuthFlowResponse,
) -> Result<(), String> {
    if response.state == "authenticated"
        || response.state == "error" && response.code.as_deref() == Some("network_error")
    {
        return Ok(());
    }

    let denial_code = response.code.as_deref();
    if denial_code.is_some_and(auth::should_erase_credential) {
        forget_secure_auth(app, auth_state, bridge)?;
    } else if denial_code.is_some_and(auth::is_blocking_denial) {
        // license_expired / organization_not_active: the app still hides and
        // the runtime session is dropped, but the Credential Manager record
        // survives so the login window can silently resume after renewal.
        clear_runtime_auth_session(auth_state, bridge)?;
    }

    clear_cep_license_receipt(app)?;
    bridge.set_license_status(LicenseStatus::no_session());
    emit_auth_cleared(app);
    if let Some(app_window) = app.get_webview_window(APP_WINDOW_LABEL) {
        let _ = app_window.hide();
    }
    if let Some(login_window) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let response_json = serde_json::to_string(response).map_err(|error| error.to_string())?;
        let script = format!(
            "window.dispatchEvent(new CustomEvent('arizona-auth:flow', {{ detail: {response_json} }}));"
        );
        let _ = login_window.eval(script);
        // The 60s renewal retry re-enters here while blocked; stealing the OS
        // focus every cycle would make the machine unusable for other work, so
        // an already visible login window is only updated, never re-focused.
        if !login_window.is_visible().unwrap_or(false) {
            let _ = login_window.show();
            let _ = login_window.set_focus();
        }
    }

    if response.state == "activation_required" {
        clear_runtime_auth_session(auth_state, bridge)?;
    }
    Ok(())
}

fn forget_secure_auth(
    app: &AppHandle,
    auth_state: &State<AuthState>,
    bridge: &State<CepBridgeState>,
) -> Result<(), String> {
    let _ = secure_auth_entry()?.delete_credential();
    clear_cep_license_receipt(app)?;
    clear_runtime_auth_session(auth_state, bridge)
}

fn auth_flow(state: &'static str, code: Option<&str>, message: Option<String>) -> AuthFlowResponse {
    AuthFlowResponse {
        state,
        code: code.map(ToOwned::to_owned),
        message,
        retry_after_seconds: None,
        email: None,
        session: None,
    }
}

fn api_error_flow(error: &auth::ApiError, email: Option<String>) -> AuthFlowResponse {
    let code = canonical_auth_error_code(&error.code);
    let state = match code {
        "invalid_refresh_token"
        | "refresh_token_not_found"
        | "invalid_grant"
        | "device_activation_expired" => "activation_required",
        _ => "error",
    };
    let message = match code {
        "activation_invalid" => "O código de ativação é inválido ou expirou.",
        "activation_unavailable" => {
            "Não foi possível concluir a ativação agora. Tente o mesmo código novamente."
        }
        "daily_mfa_required" | "mfa_required" => {
            "O servidor ainda exige o autenticador. Backend desatualizado — contate o suporte."
        }
        "device_limit_reached" => {
            "Este usuário já está ativo em outra máquina. Peça a liberação a quem enviou o código de ativação."
        }
        "device_revoked" => {
            "O acesso desta máquina foi liberado pelo administrador. Solicite um novo código de ativação."
        }
        "device_not_active" => {
            "Esta máquina precisa ser reativada. Atualize o Arizona App para a versão mais recente e solicite um novo código de ativação."
        }
        "device_activation_expired" => {
            "Esta sessão é antiga demais para cadastrar a máquina. Solicite um novo código de ativação."
        }
        "device_cooldown" => "Aguarde antes de cadastrar outra máquina.",
        "device_identity_required" => "Não foi possível identificar esta máquina. Contate o suporte.",
        "organization_not_active" => {
            "A licença da empresa está suspensa. O acesso volta automaticamente quando ela for reativada."
        }
        "license_expired" => {
            "A licença da empresa expirou. O acesso volta automaticamente quando ela for renovada."
        }
        "member_not_authorized" => "Este usuário não está autorizado.",
        "rate_limited" => "Muitas tentativas. Aguarde antes de tentar novamente.",
        "network_error" => "Não foi possível conectar ao Supabase.",
        _ => "Não foi possível confirmar o acesso.",
    };
    AuthFlowResponse {
        state,
        code: Some(code.to_string()),
        message: Some(message.to_string()),
        retry_after_seconds: error.retry_after_seconds,
        email,
        session: None,
    }
}

fn canonical_auth_error_code(code: &str) -> &str {
    match code {
        "over_request_rate_limit" => "rate_limited",
        _ => code,
    }
}

fn admin_access(auth_state: &State<AuthState>) -> Result<(AuthSession, String, String), String> {
    let session = authenticated_session(auth_state)?;
    if session.role.as_deref() != Some("admin") {
        return Err("Acesso disponível apenas para gestores.".to_string());
    }
    if !license_status_from_session(Some(&session)).licensed {
        return Err("Licença local expirada. Confirme o acesso novamente.".to_string());
    }
    let access_token = session
        .access_token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Sessão de gestão incompleta.".to_string())?;
    let organization_id = session
        .organization_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Organização ausente na sessão.".to_string())?;
    Ok((session, access_token, organization_id))
}

#[tauri::command]
async fn admin_list_members(app: AppHandle) -> Result<serde_json::Value, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let _operation = auth_state.lock_operation()?;
        let (_, access_token, organization_id) = admin_access(&auth_state)?;
        auth::function_value(
            "admin-list-members",
            &access_token,
            serde_json::json!({ "organizationId": organization_id }),
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn admin_add_member(
    app: AppHandle,
    name: String,
    email: String,
) -> Result<serde_json::Value, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let _operation = auth_state.lock_operation()?;
        let (_, access_token, organization_id) = admin_access(&auth_state)?;
        auth::function_value(
            "admin-add-member",
            &access_token,
            serde_json::json!({
                "organizationId": organization_id,
                "name": name.trim(),
                "email": email.trim().to_lowercase(),
                "role": "user",
            }),
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn admin_release_device(
    app: AppHandle,
    member_id: String,
) -> Result<serde_json::Value, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let _operation = auth_state.lock_operation()?;
        let (_, access_token, organization_id) = admin_access(&auth_state)?;
        auth::function_value(
            "admin-release-device",
            &access_token,
            serde_json::json!({
                "organizationId": organization_id,
                "memberId": member_id.trim(),
            }),
        )
        .map_err(release_device_api_error)
    })
    .await
}

#[tauri::command]
async fn admin_remove_member(
    app: AppHandle,
    member_id: String,
) -> Result<serde_json::Value, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let _operation = auth_state.lock_operation()?;
        let (_, access_token, organization_id) = admin_access(&auth_state)?;
        auth::function_value(
            "admin-remove-member",
            &access_token,
            serde_json::json!({
                "organizationId": organization_id,
                "memberId": member_id.trim(),
            }),
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn admin_generate_activation_code(
    app: AppHandle,
    member_id: String,
) -> Result<serde_json::Value, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let _operation = auth_state.lock_operation()?;
        let (_, access_token, organization_id) = admin_access(&auth_state)?;
        auth::function_value(
            "admin-generate-activation-code",
            &access_token,
            serde_json::json!({
                "organizationId": organization_id,
                "memberId": member_id.trim(),
            }),
        )
        .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn release_current_device(app: AppHandle) -> Result<ActionResponse, String> {
    run_blocking_network_command(move || {
        let auth_state = app.state::<AuthState>();
        let bridge = app.state::<CepBridgeState>();
        let _operation = auth_state.lock_operation()?;
        let session = authenticated_session(&auth_state)?;
        let access_token = session
            .access_token
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Sessão incompleta.".to_string())?;
        // The install id proves the caller is the machine holding the seat, so a
        // copied credential cannot release someone else's device.
        auth::function_value(
            "app-release-device",
            &access_token,
            serde_json::json!({
                "source": "tauri_settings",
                "installId": load_or_create_install_id(&app)?,
            }),
        )
        .map_err(release_device_api_error)?;
        forget_secure_auth(&app, &auth_state, &bridge)?;
        apply_auth_flow_ui(
            &app,
            &auth_state,
            &bridge,
            &auth_flow(
                "activation_required",
                None,
                Some("Acesso desta máquina liberado.".to_string()),
            ),
        )?;
        Ok(ActionResponse::ok())
    })
    .await
}

fn release_device_api_error(error: auth::ApiError) -> String {
    if error.code != "device_switch_interval" {
        return error.to_string();
    }

    let wait = error
        .retry_after_seconds
        .map(format_release_wait)
        .map(|duration| format!(" Tente novamente em {duration}."))
        .unwrap_or_default();
    format!(
        "device_switch_interval: Esta máquina ainda não completou o intervalo mínimo entre trocas.{wait}"
    )
}

fn format_release_wait(total_seconds: u64) -> String {
    const DAY: u64 = 86_400;
    const HOUR: u64 = 3_600;

    let days = total_seconds / DAY;
    let hours = (total_seconds % DAY) / HOUR;
    if days > 0 {
        return format!("{days}d {hours}h");
    }

    let minutes = (total_seconds % HOUR).div_ceil(60);
    if hours > 0 {
        format!("{hours}h {minutes}min")
    } else {
        format!("{minutes}min")
    }
}

#[cfg(test)]
mod device_release_tests {
    use super::format_release_wait;

    #[test]
    fn formats_long_device_switch_intervals_in_days() {
        assert_eq!(format_release_wait(7 * 86_400 + 2 * 3_600), "7d 2h");
    }

    #[test]
    fn rounds_short_device_switch_intervals_up_to_minutes() {
        assert_eq!(format_release_wait(61), "2min");
    }
}

#[cfg(test)]
mod auth_flow_tests {
    use super::{api_error_flow, should_forget_secure_auth_on_resume_error, AuthState};
    use crate::auth::{self, ApiError};

    fn api_error(code: &str) -> ApiError {
        ApiError {
            code: code.to_string(),
            message: "test".to_string(),
            retry_after_seconds: None,
        }
    }

    #[test]
    fn maps_server_mfa_demands_to_an_outdated_backend_error() {
        for code in ["daily_mfa_required", "mfa_required"] {
            let flow = api_error_flow(&api_error(code), None);

            assert_eq!(flow.state, "error");
            assert_eq!(flow.code.as_deref(), Some(code));
            assert_eq!(
                flow.message.as_deref(),
                Some(
                    "O servidor ainda exige o autenticador. Backend desatualizado — contate o suporte."
                )
            );
        }
    }

    #[test]
    fn forgets_the_stored_session_only_on_credential_erasing_resume_errors() {
        for code in [
            "member_not_authorized",
            "device_revoked",
            "device_not_active",
            "device_activation_expired",
            "invalid_user_token",
            "invalid_grant",
            "refresh_token_not_found",
            "invalid_refresh_token",
        ] {
            assert!(
                should_forget_secure_auth_on_resume_error(&api_error(code)),
                "{code} should wipe the stored session"
            );
        }

        // Reversible org-wide blocks hide the app but keep the credential so
        // resume can silently retry once the license returns.
        for code in ["license_expired", "organization_not_active"] {
            assert!(
                !should_forget_secure_auth_on_resume_error(&api_error(code)),
                "{code} should keep the stored session"
            );
            assert!(
                !auth::should_erase_credential(code),
                "{code} should keep the stored session"
            );
            assert!(
                auth::is_blocking_denial(code),
                "{code} should still block the app"
            );
        }

        for code in [
            "network_error",
            "rate_limited",
            "over_request_rate_limit",
            "request_failed",
            "invalid_server_response",
            "internal_error",
        ] {
            assert!(
                !should_forget_secure_auth_on_resume_error(&api_error(code)),
                "{code} should keep the stored session"
            );
            assert!(
                !auth::is_blocking_denial(code),
                "{code} should not block the app"
            );
        }
    }

    #[test]
    fn reversible_org_blocks_explain_that_access_returns_automatically() {
        let expired = api_error_flow(&api_error("license_expired"), None);
        assert_eq!(expired.state, "error");
        assert_eq!(
            expired.message.as_deref(),
            Some("A licença da empresa expirou. O acesso volta automaticamente quando ela for renovada.")
        );

        let paused = api_error_flow(&api_error("organization_not_active"), None);
        assert_eq!(paused.state, "error");
        assert_eq!(
            paused.message.as_deref(),
            Some("A licença da empresa está suspensa. O acesso volta automaticamente quando ela for reativada.")
        );
    }

    #[test]
    fn an_unidentifiable_machine_reports_support_without_wiping_the_credential() {
        let flow = api_error_flow(&api_error("device_identity_required"), None);

        assert_eq!(flow.state, "error");
        assert_eq!(
            flow.message.as_deref(),
            Some("Não foi possível identificar esta máquina. Contate o suporte.")
        );
        assert!(!auth::should_erase_credential("device_identity_required"));
        assert!(!auth::is_blocking_denial("device_identity_required"));
    }

    // The denial may also surface after a successful refresh, when only the
    // flow response reaches `apply_auth_flow_ui`.
    #[test]
    fn an_expired_activation_window_wipes_the_credential_and_reopens_the_activation_form() {
        let flow = api_error_flow(&api_error("device_activation_expired"), None);

        assert_eq!(flow.state, "activation_required");
        assert_eq!(
            flow.message.as_deref(),
            Some(
                "Esta sessão é antiga demais para cadastrar a máquina. Solicite um novo código de ativação."
            )
        );
        assert!(
            flow.code
                .as_deref()
                .is_some_and(auth::should_erase_credential),
            "an expired activation window must wipe the stored credential"
        );
    }

    #[test]
    fn canonicalizes_gotrue_request_rate_limit_for_the_login_ui() {
        let flow = api_error_flow(
            &ApiError {
                code: "over_request_rate_limit".to_string(),
                message: "Too many requests".to_string(),
                retry_after_seconds: Some(45),
            },
            None,
        );

        assert_eq!(flow.state, "error");
        assert_eq!(flow.code.as_deref(), Some("rate_limited"));
        assert_eq!(flow.retry_after_seconds, Some(45));
    }

    #[test]
    fn auth_operation_lock_excludes_a_second_operation() {
        let state = AuthState::default();
        let operation = state
            .lock_operation()
            .expect("first auth operation should acquire the lock");

        assert!(state.operation.try_lock().is_err());
        drop(operation);
        assert!(state.operation.try_lock().is_ok());
    }
}

#[tauri::command]
async fn clear_secure_auth(app: AppHandle) -> Result<ActionResponse, String> {
    run_blocking_network_command(move || {
        let auth = app.state::<AuthState>();
        let bridge = app.state::<CepBridgeState>();
        let _operation = auth.lock_operation()?;
        let entry = secure_auth_entry()?;
        let _ = entry.delete_credential();
        clear_cep_license_receipt(&app)?;
        clear_runtime_auth_session(&auth, &bridge)?;
        Ok(ActionResponse::ok())
    })
    .await
}

fn secure_auth_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new_with_target(SECURE_AUTH_TARGET, SECURE_AUTH_SERVICE, SECURE_AUTH_ACCOUNT)
        .map_err(|_| "Não foi possível acessar o cofre do sistema.".to_string())
}

fn read_secure_auth_record(entry: &keyring::Entry) -> Result<Option<SecureAuthRecord>, String> {
    match entry.get_secret() {
        Ok(value) => {
            if let Ok(text) = String::from_utf8(value) {
                if let Ok(record) = serde_json::from_str(&text) {
                    return Ok(Some(record));
                }
            }

            match entry.get_password() {
                Ok(value) => serde_json::from_str(&value)
                    .map(Some)
                    .map_err(|_| "Sessão segura inválida.".to_string()),
                Err(keyring::Error::NoEntry) => Err("Sessão segura inválida.".to_string()),
                Err(err) => Err(format!("Não foi possível ler a sessão segura: {err}")),
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("Não foi possível ler a sessão segura: {err}")),
    }
}

#[tauri::command]
fn cep_bridge_status(
    auth: State<AuthState>,
    bridge: State<CepBridgeState>,
) -> Result<cep_bridge::BridgeStatus, String> {
    require_authenticated(&auth)?;
    Ok(bridge.status())
}

#[tauri::command]
fn after_effects_action_command(
    app: AppHandle,
    auth: State<AuthState>,
    action: String,
) -> Result<ActionResponse, String> {
    let Some(action) = after_effects::action_from_key(&action) else {
        return Ok(ActionResponse::err("Acao do After Effects invalida."));
    };

    Ok(run_after_effects_action(&app, &auth, action))
}

#[tauri::command]
fn list_installed_after_effects_versions(auth: State<AuthState>) -> Result<Vec<String>, String> {
    require_authenticated(&auth)?;
    Ok(after_effects::installed_versions())
}

#[tauri::command]
fn set_after_shortcut_recording(
    app: AppHandle,
    auth: State<AuthState>,
    recording: bool,
) -> Result<(), String> {
    require_authenticated(&auth)?;
    if recording {
        suspend_after_command_shortcuts(&app)
    } else {
        resume_after_command_shortcuts(&app)
    }
}

fn run_after_effects_action(
    app: &AppHandle,
    auth: &State<AuthState>,
    action: AfterEffectsAction,
) -> ActionResponse {
    if let Err(err) = require_authenticated(auth) {
        return ActionResponse::err(err);
    }

    let config = match settings::load_validated(app) {
        Ok(config) => config,
        Err(err) => return ActionResponse::err(err),
    };

    match after_effects::execute(app, &config, action) {
        Ok(command_id) => ActionResponse::ok_message(command_id),
        Err(err) => ActionResponse::err(err),
    }
}

#[tauri::command]
fn restrict_admin_session(
    app: AppHandle,
    auth: State<AuthState>,
    bridge: State<CepBridgeState>,
) -> Result<ActionResponse, String> {
    let session = {
        let mut stored_session = auth
            .session
            .lock()
            .map_err(|_| "Nao foi possivel atualizar a sessao.".to_string())?;
        let Some(session) = stored_session.as_mut() else {
            return Ok(ActionResponse::err("Confirme seu acesso para continuar."));
        };

        if session.role.as_deref().unwrap_or_default().trim() == "admin" {
            session.role = Some("user".to_string());
        }

        session.clone()
    };

    bridge.set_license_status(license_status_from_session(Some(&session)));
    sync_cep_license_receipt(&app, session.cep_license_receipt.as_deref())?;
    emit_auth_session(&app, "arizona-auth:update", &session)?;
    Ok(ActionResponse::ok())
}

fn store_auth_session(auth: &State<AuthState>, session: AuthSession) -> Result<(), String> {
    let mut stored_session = auth
        .session
        .lock()
        .map_err(|_| "Nao foi possivel atualizar a sessao.".to_string())?;
    *stored_session = Some(session);
    Ok(())
}

fn license_status_from_session(session: Option<&AuthSession>) -> LicenseStatus {
    let Some(session) = session else {
        return LicenseStatus::no_session();
    };

    LicenseStatus::from_input(LicenseInput {
        has_access_token: session
            .access_token
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        email: session.email.clone(),
        member_id: session.member_id.clone(),
        role: session.role.clone(),
        organization_id: session.organization_id.clone(),
        organization_name: session.organization_name.clone(),
        seats_allowed: session.seats_allowed,
        expires_at: session.expires_at.clone(),
    })
}

fn emit_auth_session(
    app: &AppHandle,
    event_name: &str,
    session: &AuthSession,
) -> Result<(), String> {
    let session_json = serde_json::to_string(session).map_err(|err| err.to_string())?;
    let script = format!(
        "window.__ARIZONA_AUTH_SESSION__ = {session_json}; window.dispatchEvent(new CustomEvent('{event_name}', {{ detail: {session_json} }}));"
    );

    if let Some(app_window) = app.get_webview_window(APP_WINDOW_LABEL) {
        let _ = app_window.eval(script);
    }

    Ok(())
}

fn sync_cep_license_receipt(app: &AppHandle, receipt: Option<&str>) -> Result<(), String> {
    let receipt = receipt.map(str::trim).filter(|value| !value.is_empty());
    let Some(receipt) = receipt else {
        return clear_cep_license_receipt(app);
    };

    let path = cep_license_receipt_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Nao foi possivel criar {}: {err}", parent.display()))?;
    }

    let file = CepLicenseReceiptFile {
        version: 1,
        receipt: receipt.to_string(),
        updated_at: now_iso(),
    };
    let text = serde_json::to_string_pretty(&file).map_err(|err| err.to_string())?;
    fs::write(&path, text)
        .map_err(|err| format!("Nao foi possivel salvar {}: {err}", path.display()))
}

fn clear_cep_license_receipt(app: &AppHandle) -> Result<(), String> {
    let path = cep_license_receipt_file_path(app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "Nao foi possivel remover {}: {err}",
            path.display()
        )),
    }
}

fn remove_legacy_cep_bridge_session(app: &AppHandle) {
    if let Ok(path) = app.path().app_local_data_dir() {
        let legacy_path = path.join(cep_bridge::SESSION_FILE_NAME);
        let _ = fs::remove_file(legacy_path);
    }
}

fn cep_license_receipt_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join(CEP_LICENSE_RECEIPT_FILE_NAME))
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn app_window_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join(APP_WINDOW_STATE_FILE_NAME))
}

fn read_app_window_state(app: &AppHandle) -> Result<Option<AppWindowState>, String> {
    let path = app_window_state_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }

    let text = fs::read_to_string(&path)
        .map_err(|err| format!("Não foi possível ler {}: {err}", path.display()))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|err| format!("Estado de janela inválido em {}: {err}", path.display()))
}

fn restore_app_window_position(app: &AppHandle) {
    let Some(window) = app.get_webview_window(APP_WINDOW_LABEL) else {
        return;
    };

    match read_app_window_state(app) {
        Ok(Some(state)) => {
            let position = PhysicalPosition::new(state.x, state.y);
            if webview_window_position_is_visible(&window, position) {
                if window.set_position(position).is_err() {
                    let _ = window.center();
                }
            } else {
                let _ = window.center();
            }
        }
        Ok(None) => {}
        Err(err) => {
            eprintln!("{err}");
            let _ = window.center();
        }
    }
}

fn save_current_app_window_position(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(APP_WINDOW_LABEL) {
        save_app_webview_window_position(&window);
    }
}

fn save_app_window_position(window: &Window) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let Ok(position) = window.outer_position() else {
        return;
    };
    let state = AppWindowState {
        x: position.x,
        y: position.y,
    };

    let app = window.app_handle();
    write_app_window_state(app, &state);
}

fn save_app_webview_window_position(window: &WebviewWindow) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let Ok(position) = window.outer_position() else {
        return;
    };
    let state = AppWindowState {
        x: position.x,
        y: position.y,
    };

    let app = window.app_handle();
    write_app_window_state(app, &state);
}

fn write_app_window_state(app: &AppHandle, state: &AppWindowState) {
    let Ok(path) = app_window_state_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(state) {
        let _ = fs::write(path, text);
    }
}

fn webview_window_position_is_visible(
    window: &WebviewWindow,
    position: PhysicalPosition<i32>,
) -> bool {
    position_is_visible_for_window(
        window
            .outer_size()
            .unwrap_or_else(|_| PhysicalSize::new(440, 232)),
        position,
        window.available_monitors(),
    )
}

fn position_is_visible_for_window(
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    monitors: tauri::Result<Vec<tauri::Monitor>>,
) -> bool {
    let center_x = position.x + (size.width as i32 / 2);
    let center_y = position.y + (size.height as i32 / 2);
    let Ok(monitors) = monitors else {
        return false;
    };

    monitors.iter().any(|monitor| {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let left = monitor_position.x;
        let top = monitor_position.y;
        let right = left + monitor_size.width as i32;
        let bottom = top + monitor_size.height as i32;

        center_x >= left && center_x < right && center_y >= top && center_y < bottom
    })
}

// O recibo CEP NAO e apagado ao sair: ele ja expira sozinho (exp diario) e
// apaga-lo aqui bloqueava a extensao no meio do trabalho sempre que o app
// fosse fechado. A remocao explicita acontece apenas no logout
// (clear_secure_auth).
#[tauri::command]
fn exit_app(app: AppHandle) -> Result<(), String> {
    save_current_app_window_position(&app);
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn open_author_site() -> Result<ActionResponse, String> {
    Ok(
        match tauri_plugin_opener::open_url(AUTHOR_URL, None::<&str>) {
            Ok(()) => ActionResponse::ok(),
            Err(err) => ActionResponse::err(err.to_string()),
        },
    )
}

#[tauri::command]
fn open_links(auth: State<AuthState>) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let arizona = Arizona::new(AppConfig::default());
    if let Err(err) = arizona.open_visto() {
        return Ok(ActionResponse::err(err));
    }
    if let Err(err) = arizona.open_bitrix() {
        return Ok(ActionResponse::err(err));
    }
    if let Err(err) = arizona.open_pip() {
        return Ok(ActionResponse::err(err));
    }

    Ok(ActionResponse::ok())
}

#[tauri::command]
fn open_jobao(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let arizona = arizona_from_app(&app)?;
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(match arizona.open_jobao(&jobao_cod) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_jobinho(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let arizona = arizona_from_app(&app)?;
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(
        match arizona.open_jobinhos_folder(&jobao_cod, &jobinho_cod) {
            Ok(()) => ActionResponse::ok(),
            Err(err) => ActionResponse::err(err),
        },
    )
}

#[tauri::command]
fn abrir_ae(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let arizona = arizona_from_app(&app)?;
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(match arizona.abrir_jobinho(&jobao_cod, &jobinho_cod) {
        Ok(project) => {
            cache_project_media_paths(&app, &project);
            history::record_project_opened(&app, &project)?;
            ActionResponse::ok_message(project.project_title)
        }
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_out(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
    option: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let arizona = arizona_from_app(&app)?;
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(match arizona.open_out(&jobao_cod, &option) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn import_products(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let arizona = arizona_from_app(&app)?;

    match arizona.import_products(&jobao_cod) {
        Ok(report) => {
            let history_result = history::record_product_import(&app, &report);
            let response = show_product_import_report(app, report)?;

            if let Err(err) = history_result {
                return Ok(ActionResponse::err(format!(
                    "Produtos importados, mas o histórico não foi salvo: {err}"
                )));
            }

            Ok(response)
        }
        Err(err) => Ok(ActionResponse::err(err)),
    }
}

const SECONDARY_WINDOW_WIDTH: f64 = 950.0;
const SECONDARY_WINDOW_HEIGHT: f64 = 650.0;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SecondaryWindowState {
    view: String,
    jobao_cod: Option<String>,
    media_path: Option<String>,
    media_kind: Option<String>,
    media_title: Option<String>,
    media_loading: Option<bool>,
    media_error: Option<String>,
    product_report: Option<ProductImportReport>,
    admin_auth: Option<AdminWindowAuth>,
    session_auth: Option<SessionWindowAuth>,
}

fn begin_pending_media_load(app: &AppHandle) -> u64 {
    app.state::<MediaLoadRuntimeState>()
        .generation
        .fetch_add(1, Ordering::AcqRel)
        .wrapping_add(1)
}

fn cancel_pending_media_load(app: &AppHandle) {
    app.state::<MediaLoadRuntimeState>()
        .generation
        .fetch_add(1, Ordering::AcqRel);
}

fn pending_media_load_is_current(app: &AppHandle, request_id: u64) -> bool {
    if app
        .state::<MediaLoadRuntimeState>()
        .generation
        .load(Ordering::Acquire)
        != request_id
    {
        return false;
    }

    let media_view_is_active = app
        .state::<SecondaryWindowRuntimeState>()
        .active_view
        .lock()
        .ok()
        .and_then(|view| view.clone())
        .as_deref()
        == Some("media");
    let media_window_is_visible = app
        .get_webview_window(SECONDARY_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    media_view_is_active && media_window_is_visible
}

#[tauri::command]
fn open_secondary_window(
    app: AppHandle,
    auth: State<AuthState>,
    bridge: State<CepBridgeState>,
    view: String,
    jobao_cod: Option<String>,
) -> Result<ActionResponse, String> {
    let normalized_view = normalize_secondary_view(&view)?;
    let (admin_auth, session_auth) = match normalized_view {
        "admin" => {
            let admin_auth = match admin_window_auth(&app, &auth, &bridge) {
                Ok(admin_auth) => admin_auth,
                Err(err) => return Ok(ActionResponse::err(err)),
            };
            (Some(admin_auth), None)
        }
        "settings" => {
            let session = match authenticated_session(&auth) {
                Ok(session) => session,
                Err(err) => return Ok(ActionResponse::err(err)),
            };
            let session_auth = match session_window_auth_from_session(&session) {
                Ok(session_auth) => session_auth,
                Err(err) => return Ok(ActionResponse::err(err)),
            };
            (None, Some(session_auth))
        }
        _ => {
            if let Err(err) = require_authenticated(&auth) {
                return Ok(ActionResponse::err(err));
            }
            (None, None)
        }
    };
    let state = SecondaryWindowState {
        view: normalized_view.to_string(),
        jobao_cod: normalize_optional_text(jobao_cod),
        media_path: None,
        media_kind: None,
        media_title: None,
        media_loading: None,
        media_error: None,
        product_report: None,
        admin_auth,
        session_auth,
    };
    show_secondary_window(app, state)
}

fn show_secondary_window(
    app: AppHandle,
    state: SecondaryWindowState,
) -> Result<ActionResponse, String> {
    cancel_pending_media_load(&app);
    show_secondary_window_preserving_media_load(app, state)
}

fn show_secondary_window_preserving_media_load(
    app: AppHandle,
    state: SecondaryWindowState,
) -> Result<ActionResponse, String> {
    let active_view = state.view.clone();
    if active_view == "duplicate" {
        suspend_after_command_shortcuts(&app)?;
    } else {
        resume_after_command_shortcuts(&app)?;
    }

    let window_title = secondary_window_state_title(&state);
    let state_json = serde_json::to_string(&state).map_err(|err| err.to_string())?;
    let window = app
        .get_webview_window(SECONDARY_WINDOW_LABEL)
        .ok_or_else(|| "Janela secundária não foi inicializada.".to_string())?;
    let script = format!(
        "window.__ARIZONA_SECONDARY_STATE__ = {state_json}; window.dispatchEvent(new CustomEvent('arizona-secondary:set-view', {{ detail: {state_json} }}));"
    );

    let _ = window.eval(script);
    if let Err(err) = window.set_title(&window_title) {
        eprintln!("Nao foi possivel atualizar o titulo da janela secundaria: {err}");
    }
    let _ = window.unmaximize();
    if let Err(err) = window.set_size(LogicalSize::new(
        SECONDARY_WINDOW_WIDTH,
        SECONDARY_WINDOW_HEIGHT,
    )) {
        eprintln!("Nao foi possivel redimensionar a janela secundaria: {err}");
    }
    let _ = window.center();
    let _ = window.unminimize();
    window
        .show()
        .map_err(|err| format!("Nao foi possivel exibir a janela secundaria: {err}"))?;
    let _ = window.set_focus();
    set_secondary_active_view(&app, Some(&active_view));

    if let Some(app_window) = app.get_webview_window(APP_WINDOW_LABEL) {
        let _ = app_window.set_enabled(false);
    }

    Ok(ActionResponse::ok())
}

fn update_pending_media_window(
    app: &AppHandle,
    request_id: u64,
    state: &SecondaryWindowState,
) -> Result<bool, String> {
    if !pending_media_load_is_current(app, request_id) {
        return Ok(false);
    }

    let window = app
        .get_webview_window(SECONDARY_WINDOW_LABEL)
        .ok_or_else(|| "Janela secundária não foi inicializada.".to_string())?;
    let state_json = serde_json::to_string(state).map_err(|err| err.to_string())?;
    let script = format!(
        "window.__ARIZONA_SECONDARY_STATE__ = {state_json}; window.dispatchEvent(new CustomEvent('arizona-secondary:set-view', {{ detail: {state_json} }}));"
    );

    window
        .eval(script)
        .map_err(|err| format!("Não foi possível atualizar o visualizador: {err}"))?;
    if let Err(err) = window.set_title(&secondary_window_state_title(state)) {
        eprintln!("Nao foi possivel atualizar o titulo da janela secundaria: {err}");
    }

    Ok(true)
}

#[tauri::command]
fn close_secondary_window(app: AppHandle) -> Result<ActionResponse, String> {
    cancel_pending_media_load(&app);
    if let Some(window) = app.get_webview_window(SECONDARY_WINDOW_LABEL) {
        let _ = window.hide();
    }
    set_secondary_active_view(&app, None);
    if let Err(err) = resume_after_command_shortcuts(&app) {
        eprintln!("Nao foi possivel restaurar atalhos do After: {err}");
    }

    if let Some(app_window) = app.get_webview_window(APP_WINDOW_LABEL) {
        let _ = app_window.set_enabled(true);
        let _ = app_window.set_focus();
    }

    Ok(ActionResponse::ok())
}

#[tauri::command]
fn open_duplicate_identical_window(
    app: AppHandle,
    auth: State<AuthState>,
    bridge: State<CepBridgeState>,
    jobao_cod: String,
) -> Result<ActionResponse, String> {
    open_secondary_window(app, auth, bridge, "duplicate".to_string(), Some(jobao_cod))
}

fn require_authenticated(auth: &State<AuthState>) -> Result<(), String> {
    let session = authenticated_session(auth)?;
    let status = license_status_from_session(Some(&session));
    if status.licensed {
        Ok(())
    } else {
        Err("Licença local inválida ou expirada. Confirme o acesso novamente.".to_string())
    }
}

fn authenticated_session(auth: &State<AuthState>) -> Result<AuthSession, String> {
    auth.session
        .lock()
        .map_err(|_| "Nao foi possivel ler a sessao.".to_string())?
        .clone()
        .ok_or_else(|| "Confirme seu acesso para continuar.".to_string())
}

fn admin_window_auth(
    app: &AppHandle,
    auth: &State<AuthState>,
    bridge: &CepBridgeState,
) -> Result<AdminWindowAuth, String> {
    let session = authenticated_session(auth)?;
    let role = session
        .role
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();

    if role != "admin" {
        return Err("Acesso admin disponivel apenas para gestores.".to_string());
    }

    if let Err(err) = ensure_secure_auth_matches_session(&session) {
        clear_cep_license_receipt(app)?;
        clear_runtime_auth_session(auth, bridge)?;
        emit_auth_cleared(app);
        return Err(err);
    }

    let organization_id = session
        .organization_id
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();

    if organization_id.is_empty() {
        return Err("Sessao admin incompleta. Entre novamente.".to_string());
    }

    Ok(AdminWindowAuth {
        organization_id,
        current_member_id: session.member_id,
        email: session.email,
        role,
    })
}

fn session_window_auth_from_session(session: &AuthSession) -> Result<SessionWindowAuth, String> {
    if !license_status_from_session(Some(session)).licensed {
        return Err("Licença local inválida ou expirada. Entre novamente.".to_string());
    }

    Ok(SessionWindowAuth {
        organization_id: normalize_optional_text(session.organization_id.clone()),
        current_member_id: normalize_optional_text(session.member_id.clone()),
        email: session.email.clone(),
        role: normalize_optional_text(session.role.clone()),
    })
}

fn ensure_secure_auth_matches_session(session: &AuthSession) -> Result<(), String> {
    let entry = secure_auth_entry()?;
    let record = read_secure_auth_record(&entry)?;
    let Some(record) = record else {
        return Err("Sessao segura nao encontrada. Entre novamente.".to_string());
    };

    let session_refresh_token = session.refresh_token.as_deref().unwrap_or_default().trim();
    let session_email = session.email.trim();

    if session_refresh_token.is_empty()
        || record.refresh_token.trim() != session_refresh_token
        || !record.email.trim().eq_ignore_ascii_case(session_email)
    {
        return Err("Sessao segura invalida. Entre novamente.".to_string());
    }

    Ok(())
}

fn clear_runtime_auth_session(
    auth: &State<AuthState>,
    bridge: &CepBridgeState,
) -> Result<(), String> {
    let mut stored_session = auth
        .session
        .lock()
        .map_err(|_| "Nao foi possivel limpar a sessao.".to_string())?;
    *stored_session = None;
    drop(stored_session);
    bridge.set_license_status(LicenseStatus::no_session());
    Ok(())
}

fn emit_auth_cleared(app: &AppHandle) {
    if let Some(app_window) = app.get_webview_window(APP_WINDOW_LABEL) {
        let _ = app_window.eval(
            "window.__ARIZONA_AUTH_SESSION__ = null; window.dispatchEvent(new CustomEvent('arizona-auth:update', { detail: null }));",
        );
    }
}

fn normalize_secondary_view(view: &str) -> Result<&'static str, String> {
    match view.trim() {
        "duplicate" | "duplicate-identical" => Ok("duplicate"),
        "history" | "historico" => Ok("history"),
        "places" | "pracas" | "crf" => Ok("places"),
        "media" | "midia" => Ok("media"),
        "products" | "produtos" | "products-log" | "product-log" => Ok("products"),
        "settings" | "config" | "configuracoes" => Ok("settings"),
        "admin" | "gestao" | "gestor" => Ok("admin"),
        _ => Err("Tela secundária inválida.".to_string()),
    }
}

fn secondary_window_title(view: &str) -> &'static str {
    match view {
        "duplicate" => "Cópia de produtos idênticos",
        "history" => "Histórico",
        "places" => "Praças CRF",
        "media" => "Mídia",
        "products" => "Produtos importados",
        "settings" => "Configurações",
        "admin" => "Admin",
        _ => "Arizona",
    }
}

fn secondary_window_state_title(state: &SecondaryWindowState) -> String {
    if state.view == "media" {
        return state
            .media_title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| secondary_window_title("media"))
            .to_string();
    }

    if state.view == "products" {
        if let Some(report) = &state.product_report {
            return format!("Jobão {}", report.jobao_cod());
        }
    }

    secondary_window_title(&state.view).to_string()
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

#[tauri::command]
fn list_identical_mp4_items(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
) -> Result<Vec<arizona::DuplicateMp4Item>, String> {
    require_authenticated(&auth)?;
    arizona_from_app(&app)?.list_identical_mp4_items(&jobao_cod)
}

#[tauri::command]
fn export_identical_mp4_names_json(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
) -> Result<arizona::DuplicateMp4NamesJsonExport, String> {
    require_authenticated(&auth)?;
    arizona_from_app(&app)?.export_identical_mp4_names_json(&jobao_cod)
}

#[tauri::command]
fn update_identical_mp4_names_json(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
) -> Result<arizona::DuplicateMp4NamesJsonExport, String> {
    require_authenticated(&auth)?;
    arizona_from_app(&app)?.update_identical_mp4_names_json(&jobao_cod)
}

#[tauri::command]
fn import_identical_mp4_names_json(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
) -> Result<arizona::DuplicateMp4NamesJsonImport, String> {
    require_authenticated(&auth)?;
    arizona_from_app(&app)?.import_identical_mp4_names_json(&jobao_cod)
}

#[tauri::command]
fn duplicate_identical_mp4(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
    source_file_name: String,
    copy_names: Vec<String>,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let arizona = arizona_from_app(&app)?;

    Ok(
        match arizona.duplicate_identical_mp4(&jobao_cod, &source_file_name, copy_names) {
            Ok(result) => {
                let message = result.message.clone();
                match history::record_duplicate_mp4_copies(&app, &jobao_cod, &result.copies) {
                    Ok(()) => ActionResponse::ok_message(message),
                    Err(err) => ActionResponse::ok_message(format!(
                        "{message} Histórico não atualizado: {err}"
                    )),
                }
            }
            Err(err) => ActionResponse::err(err),
        },
    )
}

#[tauri::command]
async fn open_video(
    app: AppHandle,
    auth: State<'_, AuthState>,
    jobao_cod: String,
    jobinho_cod: String,
    media_type: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let loading_title = format!("Preparando {}...", media_type.trim().to_ascii_uppercase());
    let task_app = app.clone();

    load_media_window_in_background(app, "video", loading_title, move || {
        resolve_video_for_window(&task_app, &jobao_cod, &jobinho_cod, &media_type)
    })
    .await
}

#[tauri::command]
async fn open_audio(
    app: AppHandle,
    auth: State<'_, AuthState>,
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let task_app = app.clone();

    load_media_window_in_background(
        app,
        "audio",
        "Preparando áudio...".to_string(),
        move || {
            let media = arizona_from_app(&task_app)?.audio_file(&jobao_cod, &jobinho_cod)?;
            prepare_media_file_for_window(&task_app, media)
        },
    )
    .await
}

#[tauri::command]
fn open_media_native(
    app: AppHandle,
    auth: State<AuthState>,
    media_path: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let path = match validate_configured_media_path(&app, Path::new(media_path.trim())) {
        Ok(path) => path,
        Err(message) => return Ok(ActionResponse::err(message)),
    };

    Ok(match arizona::open_start_file(&path) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn reveal_video(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
    jobinho_cod: String,
    media_type: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    arizona_from_app(&app)?.reveal_video(&jobao_cod, &jobinho_cod, &media_type)
}

#[tauri::command]
fn open_roteiro(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    arizona_from_app(&app)?.open_roteiro(&jobao_cod, &jobinho_cod)
}

#[tauri::command]
fn history_list(
    app: AppHandle,
    auth: State<AuthState>,
) -> Result<Vec<history::HistoryEntry>, String> {
    require_authenticated(&auth)?;
    history::list(&app)
}

#[tauri::command]
fn history_clear(app: AppHandle, auth: State<AuthState>) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::clear(&app)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_copy_list(
    app: AppHandle,
    auth: State<AuthState>,
) -> Result<Vec<history::CopyHistoryEntry>, String> {
    require_authenticated(&auth)?;
    history::list_copies(&app)
}

#[tauri::command]
fn history_copy_clear(app: AppHandle, auth: State<AuthState>) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::clear_copies(&app)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_product_import_list(
    app: AppHandle,
    auth: State<AuthState>,
) -> Result<Vec<history::ProductImportHistoryEntry>, String> {
    require_authenticated(&auth)?;
    history::list_product_imports(&app)
}

#[tauri::command]
fn history_product_import_clear(
    app: AppHandle,
    auth: State<AuthState>,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::clear_product_imports(&app)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_copy_open_folder(
    app: AppHandle,
    auth: State<AuthState>,
    id: i64,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::open_copy_folder(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_copy_reveal_media(
    app: AppHandle,
    auth: State<AuthState>,
    id: i64,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::reveal_copy_media(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
async fn history_copy_open_media(
    app: AppHandle,
    auth: State<'_, AuthState>,
    id: i64,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let task_app = app.clone();

    load_media_window_in_background(
        app,
        "video",
        "Preparando vídeo...".to_string(),
        move || {
            let path = history::copy_media_file(&task_app, id)?;
            let media = MediaFile {
                title: media_title_from_path(&path),
                path,
                kind: "video".to_string(),
            };
            prepare_media_file_for_window(&task_app, media)
        },
    )
    .await
}

#[tauri::command]
fn history_open_jobao_folder(
    app: AppHandle,
    auth: State<AuthState>,
    id: i64,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::open_jobao_folder(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_reveal_after_project(
    app: AppHandle,
    auth: State<AuthState>,
    id: i64,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::reveal_after_project(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_open_after_project(
    app: AppHandle,
    auth: State<AuthState>,
    id: i64,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::open_after_project(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_reveal_media(
    app: AppHandle,
    auth: State<AuthState>,
    id: i64,
    media_type: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::reveal_media(&app, id, &media_type)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
async fn history_open_media(
    app: AppHandle,
    auth: State<'_, AuthState>,
    id: i64,
    media_type: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let loading_title = format!("Preparando {}...", media_type.trim().to_ascii_uppercase());
    let task_app = app.clone();

    load_media_window_in_background(app, "video", loading_title, move || {
        let path = history::media_file(&task_app, id, &media_type)?;
        let media = MediaFile {
            title: media_title_from_path(&path),
            path,
            kind: "video".to_string(),
        };
        prepare_media_file_for_window(&task_app, media)
    })
    .await
}

#[tauri::command]
fn history_refresh_entry(
    app: AppHandle,
    auth: State<AuthState>,
    id: i64,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    history::refresh_entry(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_refresh_all_entries(
    app: AppHandle,
    auth: State<AuthState>,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    let (updated, skipped) = history::refresh_all_entries(&app)?;
    let message = if skipped == 0 {
        format!("Paths atualizados em {updated} registros.")
    } else {
        format!("Paths atualizados em {updated} registros. {skipped} ignorados.")
    };

    Ok(ActionResponse::ok_message(message))
}

#[tauri::command]
fn project_name(
    app: AppHandle,
    auth: State<AuthState>,
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    require_authenticated(&auth)?;
    arizona_from_app(&app)?.project_name(&jobao_cod, &jobinho_cod)
}

#[tauri::command]
fn load_app_config(app: AppHandle, auth: State<AuthState>) -> Result<AppConfig, String> {
    require_authenticated(&auth)?;
    settings::load(&app)
}

#[tauri::command]
fn save_app_config(
    app: AppHandle,
    auth: State<AuthState>,
    config: AppConfig,
) -> Result<AppConfig, String> {
    require_authenticated(&auth)?;
    let config = settings::validate_config(config)?;
    register_after_command_shortcuts(&app, &config)?;
    settings::save(&app, config)
}

fn arizona_from_app(app: &AppHandle) -> Result<Arizona, String> {
    Ok(Arizona::new(settings::load_validated(app)?))
}

fn media_cache_key(jobao_cod: &str, jobinho_cod: &str, media_type: &str) -> String {
    format!(
        "{}\u{1f}{}\u{1f}{}",
        jobao_cod.trim().to_ascii_lowercase(),
        jobinho_cod.trim().to_ascii_lowercase(),
        media_type.trim().to_ascii_lowercase()
    )
}

fn cache_project_media_paths(app: &AppHandle, project: &OpenedProject) {
    if let Some(path) = project.mp4_path.as_deref() {
        cache_video_path(app, &project.jobao_cod, &project.jobinho_cod, "mp4", path);
    }
    if let Some(path) = project.mov_path.as_deref() {
        cache_video_path(app, &project.jobao_cod, &project.jobinho_cod, "mov", path);
    }
}

fn cache_video_path(
    app: &AppHandle,
    jobao_cod: &str,
    jobinho_cod: &str,
    media_type: &str,
    path: &Path,
) {
    if let Ok(mut paths) = app.state::<MediaPathCache>().paths.lock() {
        paths.insert(
            media_cache_key(jobao_cod, jobinho_cod, media_type),
            path.to_path_buf(),
        );
    }
}

fn remove_cached_video_path(app: &AppHandle, jobao_cod: &str, jobinho_cod: &str, media_type: &str) {
    if let Ok(mut paths) = app.state::<MediaPathCache>().paths.lock() {
        paths.remove(&media_cache_key(jobao_cod, jobinho_cod, media_type));
    }
}

fn cached_video_file(
    app: &AppHandle,
    jobao_cod: &str,
    jobinho_cod: &str,
    media_type: &str,
) -> Option<MediaFile> {
    let path = app
        .state::<MediaPathCache>()
        .paths
        .lock()
        .ok()?
        .get(&media_cache_key(jobao_cod, jobinho_cod, media_type))?
        .clone();
    Some(MediaFile {
        title: media_title_from_path(&path),
        path,
        kind: "video".to_string(),
    })
}

async fn load_media_window_in_background<F>(
    app: AppHandle,
    media_kind: &str,
    loading_title: String,
    operation: F,
) -> Result<ActionResponse, String>
where
    F: FnOnce() -> Result<MediaFile, String> + Send + 'static,
{
    let request_id = begin_pending_media_load(&app);
    let loading_state = SecondaryWindowState {
        view: "media".to_string(),
        jobao_cod: None,
        media_path: None,
        media_kind: Some(media_kind.to_string()),
        media_title: Some(loading_title),
        media_loading: Some(true),
        media_error: None,
        product_report: None,
        admin_auth: None,
        session_auth: None,
    };
    let window_result = show_secondary_window_preserving_media_load(app.clone(), loading_state);

    let result = match tauri::async_runtime::spawn_blocking(operation).await {
        Ok(result) => result,
        Err(error) => Err(format!(
            "Não foi possível preparar esta mídia em segundo plano: {error}"
        )),
    };

    if let Err(window_error) = window_result {
        return Ok(match result {
            Ok(media) => match arizona::open_start_file(&media.path) {
                Ok(()) => ActionResponse::ok(),
                Err(open_error) => ActionResponse::err(format!(
                    "A mídia foi encontrada, mas não foi possível abrir o visualizador interno ({window_error}) nem o aplicativo padrão do Windows ({open_error})."
                )),
            },
            Err(media_error) => ActionResponse::err(format!(
                "Não foi possível abrir o visualizador ({window_error}) nem preparar a mídia ({media_error})."
            )),
        });
    }

    let final_state = match result {
        Ok(media) => SecondaryWindowState {
            view: "media".to_string(),
            jobao_cod: None,
            media_path: Some(media.path.to_string_lossy().into_owned()),
            media_kind: Some(media.kind),
            media_title: Some(media.title),
            media_loading: Some(false),
            media_error: None,
            product_report: None,
            admin_auth: None,
            session_auth: None,
        },
        Err(message) => SecondaryWindowState {
            view: "media".to_string(),
            jobao_cod: None,
            media_path: None,
            media_kind: Some(media_kind.to_string()),
            media_title: Some("Mídia".to_string()),
            media_loading: Some(false),
            media_error: Some(message),
            product_report: None,
            admin_auth: None,
            session_auth: None,
        },
    };

    let _ = update_pending_media_window(&app, request_id, &final_state)?;
    Ok(ActionResponse::ok())
}

fn resolve_video_for_window(
    app: &AppHandle,
    jobao_cod: &str,
    jobinho_cod: &str,
    media_type: &str,
) -> Result<MediaFile, String> {
    if let Some(media) = cached_video_file(app, jobao_cod, jobinho_cod, media_type) {
        match prepare_media_file_for_window(app, media) {
            Ok(media) => return Ok(media),
            Err(_) => remove_cached_video_path(app, jobao_cod, jobinho_cod, media_type),
        }
    }

    let media = arizona_from_app(app)?.video_file(jobao_cod, jobinho_cod, media_type)?;
    cache_video_path(app, jobao_cod, jobinho_cod, media_type, &media.path);
    prepare_media_file_for_window(app, media)
}

fn prepare_media_file_for_window(
    app: &AppHandle,
    mut media: MediaFile,
) -> Result<MediaFile, String> {
    media.path = prepare_media_asset(app, &media.path)?;
    Ok(media)
}

fn show_product_import_report(
    app: AppHandle,
    report: ProductImportReport,
) -> Result<ActionResponse, String> {
    let state = SecondaryWindowState {
        view: "products".to_string(),
        jobao_cod: None,
        media_path: None,
        media_kind: None,
        media_title: None,
        media_loading: None,
        media_error: None,
        product_report: Some(report),
        admin_auth: None,
        session_auth: None,
    };

    show_secondary_window(app, state)
}

fn media_title_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn is_media_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "mp4"
                    | "mov"
                    | "wav"
                    | "mp3"
                    | "m4a"
                    | "aac"
                    | "flac"
                    | "ogg"
                    | "aif"
                    | "aiff"
                    | "wma"
            )
        })
        .unwrap_or(false)
}

fn prepare_media_asset(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let path = validate_configured_media_path(app, path)?;
    prewarm_media_for_webview(&path)?;
    if let Err(error) = app.asset_protocol_scope().allow_file(&path) {
        eprintln!(
            "Nao foi possivel liberar {} no Asset Protocol: {error}",
            path.display()
        );
        return Err("Não foi possível preparar esta mídia para reprodução.".to_string());
    }
    Ok(path)
}

const MEDIA_PREWARM_CHUNK_BYTES: u64 = 1024 * 1024;

fn prewarm_media_for_webview(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path)
        .map_err(|_| "Não foi possível acessar esta mídia no Drive.".to_string())?;
    let len = file
        .metadata()
        .map_err(|_| "Não foi possível consultar esta mídia no Drive.".to_string())?
        .len();
    if len == 0 {
        return Err("Esta mídia está vazia ou ainda não terminou de sincronizar.".to_string());
    }

    let prefix_len = len.min(MEDIA_PREWARM_CHUNK_BYTES) as usize;
    let mut buffer = vec![0_u8; prefix_len];
    file.read_exact(&mut buffer)
        .map_err(|_| "Não foi possível carregar o início desta mídia.".to_string())?;

    if len > MEDIA_PREWARM_CHUNK_BYTES {
        let tail_len = len.min(MEDIA_PREWARM_CHUNK_BYTES) as usize;
        file.seek(SeekFrom::Start(len - tail_len as u64))
            .map_err(|_| "Não foi possível preparar esta mídia.".to_string())?;
        buffer.resize(tail_len, 0);
        file.read_exact(&mut buffer)
            .map_err(|_| "Não foi possível carregar os metadados desta mídia.".to_string())?;
    }

    Ok(())
}

fn validate_configured_media_path(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let config = settings::load_validated(app)?;
    let roots = [
        PathBuf::from(config.drive),
        PathBuf::from(config.produtos_path),
    ];
    validate_media_path_against_roots(path, &roots)
}

fn validate_media_path_against_roots(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let candidate = fs::canonicalize(path).map_err(|_| "Mídia não encontrada.".to_string())?;

    if !is_media_path(&candidate) {
        return Err("Tipo de mídia inválido.".to_string());
    }

    let mut allowed = false;
    for root in roots {
        let Ok(root) = fs::canonicalize(root) else {
            continue;
        };
        if path_starts_with_windows_case_insensitive(&candidate, &root) {
            allowed = true;
            break;
        }
    }
    if !allowed {
        return Err("Mídia fora das pastas configuradas.".to_string());
    }

    Ok(candidate)
}

fn path_starts_with_windows_case_insensitive(path: &Path, root: &Path) -> bool {
    let path = path.to_string_lossy().replace('/', "\\").to_lowercase();
    let mut root = root.to_string_lossy().replace('/', "\\").to_lowercase();
    while root.ends_with('\\') {
        root.pop();
    }
    path == root || path.starts_with(&format!("{root}\\"))
}

#[cfg(test)]
mod media_scope_tests {
    use super::{
        media_cache_key, path_starts_with_windows_case_insensitive, prewarm_media_for_webview,
        validate_media_path_against_roots,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "arizona-media-scope-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn accepts_media_inside_the_configured_root_with_special_characters() {
        let temp = TestDirectory::new("allowed");
        let drive = temp.path().join("Carrefour Drive");
        let media_folder = drive.join("Vídeos #1");
        fs::create_dir_all(&media_folder).unwrap();
        let media = media_folder.join("Oferta 50%.MP4");
        fs::write(&media, b"test-media").unwrap();

        let validated = validate_media_path_against_roots(&media, &[drive]).unwrap();

        assert_eq!(validated, fs::canonicalize(media).unwrap());
    }

    #[test]
    fn rejects_a_sibling_directory_with_a_similar_prefix() {
        let temp = TestDirectory::new("sibling");
        let drive = temp.path().join("Drive");
        let sibling = temp.path().join("Drive antigo");
        fs::create_dir_all(&drive).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        let media = sibling.join("video.mp4");
        fs::write(&media, b"test-media").unwrap();

        let error = validate_media_path_against_roots(&media, &[drive]).unwrap_err();

        assert_eq!(error, "Mídia fora das pastas configuradas.");
    }

    #[test]
    fn rejects_a_non_media_file_inside_the_configured_root() {
        let temp = TestDirectory::new("extension");
        let drive = temp.path().join("Drive");
        fs::create_dir_all(&drive).unwrap();
        let file = drive.join("video.txt");
        fs::write(&file, b"not-media").unwrap();

        let error = validate_media_path_against_roots(&file, &[drive]).unwrap_err();

        assert_eq!(error, "Tipo de mídia inválido.");
    }

    #[test]
    fn prewarms_a_non_empty_media_file() {
        let temp = TestDirectory::new("prewarm");
        let media = temp.path().join("video.mp4");
        fs::write(&media, vec![7_u8; 1024 * 1024 + 32]).unwrap();

        prewarm_media_for_webview(&media).unwrap();
    }

    #[test]
    fn rejects_an_empty_media_file_during_prewarm() {
        let temp = TestDirectory::new("prewarm-empty");
        let media = temp.path().join("video.mp4");
        fs::write(&media, b"").unwrap();

        let error = prewarm_media_for_webview(&media).unwrap_err();

        assert_eq!(
            error,
            "Esta mídia está vazia ou ainda não terminou de sincronizar."
        );
    }

    #[test]
    fn windows_path_comparison_is_case_insensitive_and_segment_aware() {
        let root = Path::new(r"I:\Drives compartilhados\Phx CRF Copa");

        assert!(path_starts_with_windows_case_insensitive(
            Path::new(r"i:\DRIVES COMPARTILHADOS\PHX CRF COPA\OUT\video.mp4"),
            root,
        ));
        assert!(!path_starts_with_windows_case_insensitive(
            Path::new(r"I:\Drives compartilhados\Phx CRF Copa antiga\video.mp4"),
            root,
        ));
    }

    #[test]
    fn media_cache_key_normalizes_codes_and_media_type() {
        assert_eq!(
            media_cache_key(" 123 ", " AbC ", " MP4 "),
            media_cache_key("123", "abc", "mp4")
        );
        assert_ne!(
            media_cache_key("123", "abc", "mp4"),
            media_cache_key("123", "abc", "mov")
        );
    }
}

#[cfg(windows)]
mod single_instance {
    use std::{
        ffi::{c_void, OsStr},
        os::windows::ffi::OsStrExt,
        ptr,
    };

    type Handle = *mut c_void;
    const ERROR_ALREADY_EXISTS: u32 = 183;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            lp_mutex_attributes: *mut c_void,
            b_initial_owner: i32,
            lp_name: *const u16,
        ) -> Handle;
        fn GetLastError() -> u32;
        fn CloseHandle(h_object: Handle) -> i32;
    }

    pub struct Guard(Handle);

    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    pub fn acquire() -> Result<Guard, String> {
        let name = wide_null("Local\\com.pc.arizona-app.single-instance");
        let handle = unsafe { CreateMutexW(ptr::null_mut(), 1, name.as_ptr()) };
        if handle.is_null() {
            return Err("Não foi possível iniciar o controle de instância única.".to_string());
        }

        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Err("Arizona App já está aberto.".to_string());
        }

        Ok(Guard(handle))
    }

    fn wide_null(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
}

#[cfg(not(windows))]
mod single_instance {
    pub struct Guard;

    pub fn acquire() -> Result<Guard, String> {
        Ok(Guard)
    }
}
