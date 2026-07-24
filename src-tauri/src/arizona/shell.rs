use std::{path::Path, process::Command};

pub(super) fn open_with_shell(target: &str) -> Result<(), String> {
    let target = target.trim();
    if !target.starts_with("https://") {
        return Err("Somente endereços HTTPS podem ser abertos.".to_string());
    }
    tauri_plugin_opener::open_url(target, None::<&str>)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn open_start_file(path: &Path) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn open_explorer(path: &Path) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

pub(crate) fn reveal_in_explorer(path: &Path) -> Result<(), String> {
    Command::new("explorer")
        .arg("/select,")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}
