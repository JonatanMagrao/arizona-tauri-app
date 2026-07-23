mod after_effects;
mod arizona;
mod cep_bridge;
mod history;
mod license;
mod media;
mod settings;
mod uninstall;

use after_effects::AfterEffectsAction;
use arizona::{ActionResponse, Arizona, MediaFile, ProductImportReport};
use cep_bridge::CepBridgeState;
use chrono::{SecondsFormat, Utc};
use license::{LicenseInput, LicenseStatus};
use settings::AppConfig;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
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

#[derive(Clone, Copy, PartialEq, Eq)]
struct RegisteredAfterShortcut {
    shortcut: Shortcut,
    action: AfterEffectsAction,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSession {
    access_token: Option<String>,
    refresh_token: Option<String>,
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
    access_token: String,
    organization_id: String,
    current_member_id: Option<String>,
    email: String,
    role: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionWindowAuth {
    access_token: String,
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
    password_login_at: Option<String>,
    server_time: Option<String>,
    local_time: Option<String>,
    expires_at: Option<String>,
    member_id: Option<String>,
    role: Option<String>,
    organization_id: Option<String>,
    organization_name: Option<String>,
    seats_allowed: Option<i64>,
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
                WindowEvent::Moved(_) | WindowEvent::CloseRequested { .. } => {
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
            complete_login,
            update_auth_session,
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
            load_secure_auth,
            save_secure_auth,
            clear_secure_auth,
            open_author_site,
            load_app_config,
            save_app_config
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

    state
        .registered
        .lock()
        .ok()
        .and_then(|registered| {
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
fn open_visto() -> Result<ActionResponse, String> {
    Ok(match Arizona::new(AppConfig::default()).open_visto() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_bitrix() -> Result<ActionResponse, String> {
    Ok(match Arizona::new(AppConfig::default()).open_bitrix() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_pip() -> Result<ActionResponse, String> {
    Ok(match Arizona::new(AppConfig::default()).open_pip() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_claro() -> Result<ActionResponse, String> {
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

#[tauri::command]
fn load_secure_auth() -> Result<Option<SecureAuthRecord>, String> {
    let entry = secure_auth_entry()?;
    read_secure_auth_record(&entry)
}

#[tauri::command]
fn save_secure_auth(record: SecureAuthRecord) -> Result<ActionResponse, String> {
    if record.refresh_token.trim().is_empty() || record.email.trim().is_empty() {
        return Ok(ActionResponse::err("Sessão segura incompleta."));
    }

    let value = serde_json::to_string(&record).map_err(|err| err.to_string())?;
    secure_auth_entry()?
        .set_secret(value.as_bytes())
        .map_err(|err| format!("Não foi possível salvar a sessão segura: {err}"))?;

    match read_secure_auth_record(&secure_auth_entry()?)? {
        Some(saved)
            if saved.refresh_token == record.refresh_token && saved.email == record.email => {}
        Some(_) => return Ok(ActionResponse::err("A sessão segura salva não confere.")),
        None => {
            return Ok(ActionResponse::err(
                "A sessão segura não foi encontrada após salvar.",
            ))
        }
    }

    Ok(ActionResponse::ok())
}

#[tauri::command]
fn clear_secure_auth(
    app: AppHandle,
    auth: State<AuthState>,
    bridge: State<CepBridgeState>,
) -> Result<ActionResponse, String> {
    let entry = secure_auth_entry()?;
    let _ = entry.delete_credential();
    clear_cep_license_receipt(&app)?;
    clear_runtime_auth_session(&auth, &bridge)?;
    Ok(ActionResponse::ok())
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
fn cep_bridge_status(bridge: State<CepBridgeState>) -> Result<cep_bridge::BridgeStatus, String> {
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
fn list_installed_after_effects_versions() -> Vec<String> {
    after_effects::installed_versions()
}

#[tauri::command]
fn set_after_shortcut_recording(app: AppHandle, recording: bool) -> Result<(), String> {
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
fn complete_login(
    app: AppHandle,
    auth: State<AuthState>,
    bridge: State<CepBridgeState>,
    session: AuthSession,
) -> Result<ActionResponse, String> {
    let email = session.email.trim();
    if email.is_empty() {
        return Ok(ActionResponse::err("Email da sessao invalido."));
    }

    store_auth_session(&auth, session.clone())?;
    sync_cep_license_receipt(&app, session.cep_license_receipt.as_deref())?;
    bridge.set_license_status(license_status_from_session(Some(&session)));
    emit_auth_session(&app, "arizona-auth:login", &session)?;

    let app_window = app
        .get_webview_window(APP_WINDOW_LABEL)
        .ok_or_else(|| "Janela principal nao foi inicializada.".to_string())?;

    app_window
        .set_title("Arizona App")
        .map_err(|err| err.to_string())?;
    app_window.unminimize().map_err(|err| err.to_string())?;
    app_window.show().map_err(|err| err.to_string())?;
    app_window.set_focus().map_err(|err| err.to_string())?;

    if let Some(login_window) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = login_window.hide();
    }

    Ok(ActionResponse::ok())
}

#[tauri::command]
fn update_auth_session(
    app: AppHandle,
    auth: State<AuthState>,
    bridge: State<CepBridgeState>,
    session: AuthSession,
) -> Result<ActionResponse, String> {
    let email = session.email.trim();
    if email.is_empty() {
        return Ok(ActionResponse::err("Email da sessao invalido."));
    }

    store_auth_session(&auth, session.clone())?;
    sync_cep_license_receipt(&app, session.cep_license_receipt.as_deref())?;
    bridge.set_license_status(license_status_from_session(Some(&session)));
    emit_auth_session(&app, "arizona-auth:update", &session)?;
    Ok(ActionResponse::ok())
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
            return Ok(ActionResponse::err(
                "Entre com email e senha para continuar.",
            ));
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
fn open_links() -> Result<ActionResponse, String> {
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
fn open_jobao(app: AppHandle, jobao_cod: String) -> Result<ActionResponse, String> {
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
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
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
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    let arizona = arizona_from_app(&app)?;
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(match arizona.abrir_jobinho(&jobao_cod, &jobinho_cod) {
        Ok(project) => {
            history::record_project_opened(&app, &project)?;
            ActionResponse::ok_message(project.project_title)
        }
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_out(app: AppHandle, jobao_cod: String, option: String) -> Result<ActionResponse, String> {
    let arizona = arizona_from_app(&app)?;
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(match arizona.open_out(&jobao_cod, &option) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn import_products(app: AppHandle, jobao_cod: String) -> Result<ActionResponse, String> {
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
    product_report: Option<ProductImportReport>,
    admin_auth: Option<AdminWindowAuth>,
    session_auth: Option<SessionWindowAuth>,
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

#[tauri::command]
fn close_secondary_window(app: AppHandle) -> Result<ActionResponse, String> {
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
    authenticated_session(auth).map(|_| ())
}

fn authenticated_session(auth: &State<AuthState>) -> Result<AuthSession, String> {
    auth.session
        .lock()
        .map_err(|_| "Nao foi possivel ler a sessao.".to_string())?
        .clone()
        .ok_or_else(|| "Entre com email e senha para continuar.".to_string())
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

    let access_token = session
        .access_token
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();
    let organization_id = session
        .organization_id
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();

    if access_token.is_empty() || organization_id.is_empty() {
        return Err("Sessao admin incompleta. Entre novamente.".to_string());
    }

    Ok(AdminWindowAuth {
        access_token,
        organization_id,
        current_member_id: session.member_id,
        email: session.email,
        role,
    })
}

fn session_window_auth_from_session(session: &AuthSession) -> Result<SessionWindowAuth, String> {
    let access_token = session
        .access_token
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();

    if access_token.is_empty() {
        return Err("Sessao incompleta. Entre novamente.".to_string());
    }

    Ok(SessionWindowAuth {
        access_token,
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
    jobao_cod: String,
) -> Result<Vec<arizona::DuplicateMp4Item>, String> {
    arizona_from_app(&app)?.list_identical_mp4_items(&jobao_cod)
}

#[tauri::command]
fn export_identical_mp4_names_json(
    app: AppHandle,
    jobao_cod: String,
) -> Result<arizona::DuplicateMp4NamesJsonExport, String> {
    arizona_from_app(&app)?.export_identical_mp4_names_json(&jobao_cod)
}

#[tauri::command]
fn update_identical_mp4_names_json(
    app: AppHandle,
    jobao_cod: String,
) -> Result<arizona::DuplicateMp4NamesJsonExport, String> {
    arizona_from_app(&app)?.update_identical_mp4_names_json(&jobao_cod)
}

#[tauri::command]
fn import_identical_mp4_names_json(
    app: AppHandle,
    jobao_cod: String,
) -> Result<arizona::DuplicateMp4NamesJsonImport, String> {
    arizona_from_app(&app)?.import_identical_mp4_names_json(&jobao_cod)
}

#[tauri::command]
fn duplicate_identical_mp4(
    app: AppHandle,
    jobao_cod: String,
    source_file_name: String,
    copy_names: Vec<String>,
) -> Result<ActionResponse, String> {
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
fn open_video(
    app: AppHandle,
    jobao_cod: String,
    jobinho_cod: String,
    media_type: String,
) -> Result<ActionResponse, String> {
    match arizona_from_app(&app)?.video_file(&jobao_cod, &jobinho_cod, &media_type) {
        Ok(media) => show_media_window_with_native_fallback(app, media),
        Err(err) => Ok(ActionResponse::err(err)),
    }
}

#[tauri::command]
fn open_audio(
    app: AppHandle,
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    match arizona_from_app(&app)?.audio_file(&jobao_cod, &jobinho_cod) {
        Ok(media) => show_media_window_with_native_fallback(app, media),
        Err(err) => Ok(ActionResponse::err(err)),
    }
}

#[tauri::command]
fn open_media_native(media_path: String) -> Result<ActionResponse, String> {
    let path = PathBuf::from(media_path.trim());
    if !path.is_file() {
        return Ok(ActionResponse::err("Mídia não encontrada."));
    }

    if !is_media_path(&path) {
        return Ok(ActionResponse::err("Tipo de mídia inválido."));
    }

    Ok(match arizona::open_start_file(&path) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn reveal_video(
    app: AppHandle,
    jobao_cod: String,
    jobinho_cod: String,
    media_type: String,
) -> Result<ActionResponse, String> {
    arizona_from_app(&app)?.reveal_video(&jobao_cod, &jobinho_cod, &media_type)
}

#[tauri::command]
fn open_roteiro(
    app: AppHandle,
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    arizona_from_app(&app)?.open_roteiro(&jobao_cod, &jobinho_cod)
}

#[tauri::command]
fn history_list(app: AppHandle) -> Result<Vec<history::HistoryEntry>, String> {
    history::list(&app)
}

#[tauri::command]
fn history_clear(app: AppHandle) -> Result<ActionResponse, String> {
    history::clear(&app)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_copy_list(app: AppHandle) -> Result<Vec<history::CopyHistoryEntry>, String> {
    history::list_copies(&app)
}

#[tauri::command]
fn history_copy_clear(app: AppHandle) -> Result<ActionResponse, String> {
    history::clear_copies(&app)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_product_import_list(
    app: AppHandle,
) -> Result<Vec<history::ProductImportHistoryEntry>, String> {
    history::list_product_imports(&app)
}

#[tauri::command]
fn history_product_import_clear(app: AppHandle) -> Result<ActionResponse, String> {
    history::clear_product_imports(&app)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_copy_open_folder(app: AppHandle, id: i64) -> Result<ActionResponse, String> {
    history::open_copy_folder(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_copy_reveal_media(app: AppHandle, id: i64) -> Result<ActionResponse, String> {
    history::reveal_copy_media(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_copy_open_media(app: AppHandle, id: i64) -> Result<ActionResponse, String> {
    let path = history::copy_media_file(&app, id)?;
    let title = media_title_from_path(&path);
    show_media_path_with_title(app, path, "video", title)
}

#[tauri::command]
fn history_open_jobao_folder(app: AppHandle, id: i64) -> Result<ActionResponse, String> {
    history::open_jobao_folder(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_reveal_after_project(app: AppHandle, id: i64) -> Result<ActionResponse, String> {
    history::reveal_after_project(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_open_after_project(app: AppHandle, id: i64) -> Result<ActionResponse, String> {
    history::open_after_project(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_reveal_media(
    app: AppHandle,
    id: i64,
    media_type: String,
) -> Result<ActionResponse, String> {
    history::reveal_media(&app, id, &media_type)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_open_media(
    app: AppHandle,
    id: i64,
    media_type: String,
) -> Result<ActionResponse, String> {
    let path = history::media_file(&app, id, &media_type)?;
    let title = media_title_from_path(&path);
    show_media_path_with_title(app, path, "video", title)
}

#[tauri::command]
fn history_refresh_entry(app: AppHandle, id: i64) -> Result<ActionResponse, String> {
    history::refresh_entry(&app, id)?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn history_refresh_all_entries(app: AppHandle) -> Result<ActionResponse, String> {
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
    jobao_cod: String,
    jobinho_cod: String,
) -> Result<ActionResponse, String> {
    arizona_from_app(&app)?.project_name(&jobao_cod, &jobinho_cod)
}

#[tauri::command]
fn load_app_config(app: AppHandle) -> Result<AppConfig, String> {
    settings::load(&app)
}

#[tauri::command]
fn save_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let config = settings::validate_config(config)?;
    register_after_command_shortcuts(&app, &config)?;
    settings::save(&app, config)
}

fn arizona_from_app(app: &AppHandle) -> Result<Arizona, String> {
    Ok(Arizona::new(settings::load_validated(app)?))
}

fn show_media_window(app: AppHandle, media: MediaFile) -> Result<ActionResponse, String> {
    let MediaFile { path, kind, title } = media;
    show_media_path_with_title(app, path, &kind, title)
}

fn show_media_window_with_native_fallback(
    app: AppHandle,
    media: MediaFile,
) -> Result<ActionResponse, String> {
    let fallback_path = media.path.clone();
    match show_media_window(app, media) {
        Ok(response) => Ok(response),
        Err(window_error) => {
            eprintln!(
                "Janela interna de midia indisponivel; abrindo {} no sistema: {window_error}",
                fallback_path.display()
            );
            Ok(match arizona::open_start_file(&fallback_path) {
                Ok(()) => ActionResponse::ok(),
                Err(open_error) => ActionResponse::err(format!(
                    "A midia existe em {}, mas nao foi possivel abrir a janela interna ({window_error}) nem o visualizador do sistema ({open_error}).",
                    fallback_path.display()
                )),
            })
        }
    }
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
        product_report: Some(report),
        admin_auth: None,
        session_auth: None,
    };

    show_secondary_window(app, state)
}

fn show_media_path_with_title(
    app: AppHandle,
    path: PathBuf,
    media_kind: &str,
    title: String,
) -> Result<ActionResponse, String> {
    let state = SecondaryWindowState {
        view: "media".to_string(),
        jobao_cod: None,
        media_path: Some(path.to_string_lossy().into_owned()),
        media_kind: Some(media_kind.to_string()),
        media_title: Some(title),
        product_report: None,
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
