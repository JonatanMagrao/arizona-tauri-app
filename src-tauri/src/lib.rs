mod aegp_bridge;
mod arizona;
mod cep_bridge;
mod history;
mod license;
mod media;
mod settings;

use arizona::{ActionResponse, Arizona, MediaFile, ProductImportReport};
use cep_bridge::CepBridgeState;
use license::{LicenseInput, LicenseStatus};
use settings::AppConfig;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, LogicalSize, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Default)]
struct AuthState {
    session: Mutex<Option<AuthSession>>,
}

#[derive(Default)]
struct AfterShortcutState {
    registered: Mutex<Vec<RegisteredAfterShortcut>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct RegisteredAfterShortcut {
    shortcut: Shortcut,
    action: AegpBridgeAction,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AegpBridgeAction {
    MoveLayersBackward,
    MoveLayersForward,
    MoveJumpMarker,
    SelectJumpMarkerLayer,
    AdjustMarkersToTail,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSession {
    access_token: Option<String>,
    refresh_token: Option<String>,
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
struct AdminWindowAuth {
    access_token: String,
    organization_id: String,
    current_member_id: Option<String>,
    email: String,
    role: String,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SecureAuthRecord {
    refresh_token: String,
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

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub fn run() {
    tauri::Builder::default()
        .manage(AuthState::default())
        .manage(CepBridgeState::new())
        .manage(AfterShortcutState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let Some(action) = after_command_action_for_shortcut(app, shortcut) else {
                            return;
                        };

                        let bridge = app.state::<CepBridgeState>();
                        let response = send_aegp_bridge_action_command(&bridge, action);
                        if !response.is_ok() {
                            if let Some(message) = response.message() {
                                eprintln!("Arizona AEGP shortcut failed: {message}");
                            }
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            disable_browser_accelerator_keys(app);
            let bridge = app.state::<CepBridgeState>();
            let app_handle = app.handle().clone();
            let config = settings::load(&app_handle).unwrap_or_default();
            if let Err(err) = register_after_command_shortcuts(&app_handle, &config) {
                let message = format!("Nao foi possivel registrar atalho do After: {err}");
                eprintln!("{message}");
                bridge.set_last_error(message);
            }
            if let Err(err) = bridge.start(app.handle().clone()) {
                bridge.set_last_error(err);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cep_bridge_status,
            cep_bridge_send_test_command,
            aegp_bridge_send_test_command,
            aegp_bridge_move_layers_to_markers_command,
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
) -> Option<AegpBridgeAction> {
    app.state::<AfterShortcutState>()
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

fn register_after_command_shortcuts(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let requested = configured_after_shortcuts(config)?;

    let shortcut_state = app.state::<AfterShortcutState>();
    let previous = shortcut_state
        .registered
        .lock()
        .map_err(|_| "Nao foi possivel atualizar os atalhos do After.".to_string())?
        .clone();

    if previous == requested {
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

fn configured_after_shortcuts(config: &AppConfig) -> Result<Vec<RegisteredAfterShortcut>, String> {
    let specs = [
        (
            "Mover Layers atras",
            AegpBridgeAction::MoveLayersBackward,
            config.move_layers_backward_shortcut.as_str(),
        ),
        (
            "Mover Layers frente",
            AegpBridgeAction::MoveLayersForward,
            config.move_layers_forward_shortcut.as_str(),
        ),
        (
            "Aplicar Jump",
            AegpBridgeAction::MoveJumpMarker,
            config.move_jump_marker_shortcut.as_str(),
        ),
        (
            "Selecionar Oferta",
            AegpBridgeAction::SelectJumpMarkerLayer,
            config.select_jump_marker_layer_shortcut.as_str(),
        ),
        (
            "Reset Markers",
            AegpBridgeAction::AdjustMarkersToTail,
            config.adjust_markers_shortcut.as_str(),
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
const SECURE_AUTH_SERVICE: &str = "Arizona App";
const SECURE_AUTH_ACCOUNT: &str = "daily-session";
const SECURE_AUTH_TARGET: &str = "daily-session.Arizona App";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    author_name: String,
    author_url: String,
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
fn clear_secure_auth(bridge: State<CepBridgeState>) -> Result<ActionResponse, String> {
    let entry = secure_auth_entry()?;
    let _ = entry.delete_credential();
    bridge.set_license_status(LicenseStatus::no_session());
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
fn cep_bridge_send_test_command(
    bridge: State<CepBridgeState>,
    command: String,
    args: Option<serde_json::Value>,
) -> Result<ActionResponse, String> {
    Ok(
        match bridge.send_command(&command, args.unwrap_or(serde_json::Value::Null)) {
            Ok(command_id) => ActionResponse::ok_message(command_id),
            Err(err) => ActionResponse::err(err),
        },
    )
}

#[tauri::command]
fn aegp_bridge_send_test_command(bridge: State<CepBridgeState>) -> Result<ActionResponse, String> {
    Ok(send_aegp_bridge_test_command(&bridge))
}

#[tauri::command]
fn aegp_bridge_move_layers_to_markers_command(
    bridge: State<CepBridgeState>,
) -> Result<ActionResponse, String> {
    Ok(send_aegp_bridge_move_layers_to_markers_command(&bridge))
}

fn send_aegp_bridge_test_command(bridge: &CepBridgeState) -> ActionResponse {
    let license = bridge.license();
    if !license.licensed {
        return ActionResponse::err(format!("Licenca bloqueada: {}", license.reason));
    }

    match aegp_bridge::send_show_alert("ponte feita") {
        Ok(command_id) => ActionResponse::ok_message(command_id),
        Err(err) => ActionResponse::err(err),
    }
}

fn send_aegp_bridge_move_layers_to_markers_command(bridge: &CepBridgeState) -> ActionResponse {
    send_aegp_bridge_action_command(bridge, AegpBridgeAction::MoveLayersForward)
}

fn send_aegp_bridge_action_command(
    bridge: &CepBridgeState,
    action: AegpBridgeAction,
) -> ActionResponse {
    let license = bridge.license();
    if !license.licensed {
        return ActionResponse::err(format!("Licenca bloqueada: {}", license.reason));
    }

    let result = match action {
        AegpBridgeAction::MoveLayersBackward => aegp_bridge::send_move_layers_backward(),
        AegpBridgeAction::MoveLayersForward => aegp_bridge::send_move_layers_forward(),
        AegpBridgeAction::MoveJumpMarker => aegp_bridge::send_move_jump_marker(),
        AegpBridgeAction::SelectJumpMarkerLayer => aegp_bridge::send_select_jump_marker_layer(),
        AegpBridgeAction::AdjustMarkersToTail => aegp_bridge::send_adjust_markers_to_tail(),
    };

    match result {
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

#[tauri::command]
fn exit_app(app: AppHandle) -> Result<(), String> {
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
}

#[tauri::command]
fn open_secondary_window(
    app: AppHandle,
    auth: State<AuthState>,
    view: String,
    jobao_cod: Option<String>,
) -> Result<ActionResponse, String> {
    let normalized_view = normalize_secondary_view(&view)?;
    let admin_auth = if normalized_view == "admin" {
        Some(admin_window_auth(&auth)?)
    } else {
        require_authenticated(&auth)?;
        None
    };
    let state = SecondaryWindowState {
        view: normalized_view.to_string(),
        jobao_cod: normalize_optional_text(jobao_cod),
        media_path: None,
        media_kind: None,
        media_title: None,
        product_report: None,
        admin_auth,
    };
    show_secondary_window(app, state)
}

fn show_secondary_window(
    app: AppHandle,
    state: SecondaryWindowState,
) -> Result<ActionResponse, String> {
    let window_title = secondary_window_state_title(&state);
    let state_json = serde_json::to_string(&state).map_err(|err| err.to_string())?;
    let window = app
        .get_webview_window(SECONDARY_WINDOW_LABEL)
        .ok_or_else(|| "Janela secundária não foi inicializada.".to_string())?;
    let script = format!(
        "window.__ARIZONA_SECONDARY_STATE__ = {state_json}; window.dispatchEvent(new CustomEvent('arizona-secondary:set-view', {{ detail: {state_json} }}));"
    );

    let _ = window.eval(script);
    window
        .set_title(&window_title)
        .map_err(|err| err.to_string())?;
    let _ = window.unmaximize();
    window
        .set_size(LogicalSize::new(
            SECONDARY_WINDOW_WIDTH,
            SECONDARY_WINDOW_HEIGHT,
        ))
        .map_err(|err| err.to_string())?;
    let _ = window.center();
    window.unminimize().map_err(|err| err.to_string())?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;

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
    jobao_cod: String,
) -> Result<ActionResponse, String> {
    open_secondary_window(app, auth, "duplicate".to_string(), Some(jobao_cod))
}

fn require_authenticated(auth: &State<AuthState>) -> Result<(), String> {
    let stored_session = auth
        .session
        .lock()
        .map_err(|_| "Nao foi possivel ler a sessao.".to_string())?;

    if stored_session.is_some() {
        Ok(())
    } else {
        Err("Entre com email e senha para continuar.".to_string())
    }
}

fn admin_window_auth(auth: &State<AuthState>) -> Result<AdminWindowAuth, String> {
    let session = auth
        .session
        .lock()
        .map_err(|_| "Nao foi possivel ler a sessao.".to_string())?
        .clone()
        .ok_or_else(|| "Entre com email e senha para continuar.".to_string())?;
    let role = session
        .role
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();

    if role != "admin" {
        return Err("Acesso admin disponivel apenas para gestores.".to_string());
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
        "duplicate" => "Produtos idênticos",
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
        Ok(media) => show_media_window(app, media),
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
        Ok(media) => show_media_window(app, media),
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
