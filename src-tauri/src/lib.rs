mod arizona;

use arizona::{ActionResponse, Arizona};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
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
            open_video,
            open_roteiro,
            open_log_file,
            project_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn open_visto() -> Result<ActionResponse, String> {
    Ok(match Arizona::new().open_visto() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_bitrix() -> Result<ActionResponse, String> {
    Ok(match Arizona::new().open_bitrix() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_pip() -> Result<ActionResponse, String> {
    Ok(match Arizona::new().open_pip() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_claro() -> Result<ActionResponse, String> {
    Ok(match Arizona::new().open_claro() {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_links() -> Result<ActionResponse, String> {
    let arizona = Arizona::new();
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
fn open_jobao(jobao_cod: String) -> Result<ActionResponse, String> {
    let arizona = Arizona::new();
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(match arizona.open_jobao(&jobao_cod) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_jobinho(jobao_cod: String, jobinho_cod: String) -> Result<ActionResponse, String> {
    let arizona = Arizona::new();
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(
        match arizona.open_jobinhos_folder(&jobao_cod, &jobinho_cod) {
            Ok(()) => ActionResponse::ok(),
            Err(err) => ActionResponse::err(err),
        },
    )
}

#[tauri::command]
fn abrir_ae(jobao_cod: String, jobinho_cod: String) -> Result<ActionResponse, String> {
    let arizona = Arizona::new();
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(match arizona.abrir_jobinho(&jobao_cod, &jobinho_cod) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_out(jobao_cod: String, option: String) -> Result<ActionResponse, String> {
    let arizona = Arizona::new();
    arizona.get_jobao_path(&jobao_cod)?;

    Ok(match arizona.open_out(&jobao_cod, &option) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn import_products(jobao_cod: String) -> Result<ActionResponse, String> {
    let arizona = Arizona::new();
    arizona.get_visible_rows_from_xl(&jobao_cod)?;

    Ok(match arizona.import_products(&jobao_cod) {
        Ok(()) => ActionResponse::ok(),
        Err(err) => ActionResponse::err(err),
    })
}

#[tauri::command]
fn open_video(
    jobao_cod: String,
    jobinho_cod: String,
    media_type: String,
) -> Result<ActionResponse, String> {
    Arizona::new().open_video(&jobao_cod, &jobinho_cod, &media_type)
}

#[tauri::command]
fn open_roteiro(jobao_cod: String, jobinho_cod: String) -> Result<ActionResponse, String> {
    Arizona::new().open_roteiro(&jobao_cod, &jobinho_cod)
}

#[tauri::command]
fn open_log_file() -> Result<ActionResponse, String> {
    Arizona::new().open_log_file()?;
    Ok(ActionResponse::ok())
}

#[tauri::command]
fn project_name(jobao_cod: String, jobinho_cod: String) -> Result<ActionResponse, String> {
    Arizona::new().project_name(&jobao_cod, &jobinho_cod)
}
