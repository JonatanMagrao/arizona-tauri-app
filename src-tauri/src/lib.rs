mod arizona;
mod history;
mod media;
mod settings;

use arizona::{ActionResponse, Arizona, MediaFile, ProductImportReport};
use settings::AppConfig;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, LogicalSize, Manager, State};

#[derive(Default)]
struct AuthState {
    session: Mutex<Option<AuthSession>>,
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

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub fn run() {
    tauri::Builder::default()
        .manage(AuthState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            disable_browser_accelerator_keys(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            complete_login,
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
            open_log_file,
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
            open_author_site,
            load_app_config,
            save_app_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn disable_browser_accelerator_keys(app: &tauri::App) {
    #[cfg(windows)]
    {
        for label in [
            LOGIN_WINDOW_LABEL,
            APP_WINDOW_LABEL,
            SECONDARY_WINDOW_LABEL,
        ] {
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
fn complete_login(
    app: AppHandle,
    auth: State<AuthState>,
    session: AuthSession,
) -> Result<ActionResponse, String> {
    let email = session.email.trim();
    if email.is_empty() {
        return Ok(ActionResponse::err("Email da sessao invalido."));
    }

    let session_json = serde_json::to_string(&session).map_err(|err| err.to_string())?;
    {
        let mut stored_session = auth
            .session
            .lock()
            .map_err(|_| "Nao foi possivel atualizar a sessao.".to_string())?;
        *stored_session = Some(session);
    }

    let app_window = app
        .get_webview_window(APP_WINDOW_LABEL)
        .ok_or_else(|| "Janela principal nao foi inicializada.".to_string())?;
    let script = format!(
        "window.__ARIZONA_AUTH_SESSION__ = {session_json}; window.dispatchEvent(new CustomEvent('arizona-auth:login', {{ detail: {session_json} }}));"
    );

    let _ = app_window.eval(script);
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
    let role = session.role.as_deref().unwrap_or_default().trim().to_string();

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
fn open_log_file(app: AppHandle) -> Result<ActionResponse, String> {
    arizona_from_app(&app)?.open_log_file()?;
    Ok(ActionResponse::ok())
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
