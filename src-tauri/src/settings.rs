use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_ae_version")]
    pub ae_version: String,
    #[serde(default = "default_move_layers_backward_shortcut")]
    pub move_layers_backward_shortcut: String,
    #[serde(default = "default_move_layers_forward_shortcut")]
    pub move_layers_forward_shortcut: String,
    #[serde(default = "default_move_jump_marker_shortcut")]
    pub move_jump_marker_shortcut: String,
    #[serde(default = "default_select_jump_marker_layer_shortcut")]
    pub select_jump_marker_layer_shortcut: String,
    #[serde(default = "default_adjust_markers_shortcut")]
    pub adjust_markers_shortcut: String,
    #[serde(default = "default_render_shortcut")]
    pub render_shortcut: String,
    #[serde(default = "default_drive")]
    pub drive: String,
    #[serde(default = "default_produtos")]
    pub produtos: String,
    #[serde(default = "default_produtos_year")]
    pub produtos_year: String,
    #[serde(default = "default_produtos_path")]
    pub produtos_path: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            ae_version: default_ae_version(),
            move_layers_backward_shortcut: default_move_layers_backward_shortcut(),
            move_layers_forward_shortcut: default_move_layers_forward_shortcut(),
            move_jump_marker_shortcut: default_move_jump_marker_shortcut(),
            select_jump_marker_layer_shortcut: default_select_jump_marker_layer_shortcut(),
            adjust_markers_shortcut: default_adjust_markers_shortcut(),
            render_shortcut: default_render_shortcut(),
            drive: default_drive(),
            produtos: default_produtos(),
            produtos_year: default_produtos_year(),
            produtos_path: default_produtos_path(),
        }
    }
}

pub fn load(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let text = fs::read_to_string(&path)
        .map_err(|err| format!("Não foi possível ler {}: {err}", path.display()))?;
    serde_json::from_str(&text)
        .map(sanitize_config)
        .map_err(|err| format!("Config inválida em {}: {err}", path.display()))
}

pub fn load_validated(app: &AppHandle) -> Result<AppConfig, String> {
    validate_config(load(app)?)
}

pub fn save(app: &AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let config = validate_config(config)?;
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Não foi possível criar {}: {err}", parent.display()))?;
    }

    let text = serde_json::to_string_pretty(&config).map_err(|err| err.to_string())?;
    fs::write(&path, text)
        .map_err(|err| format!("Não foi possível salvar {}: {err}", path.display()))?;

    Ok(config)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join("settings.json"))
}

fn sanitize_config(config: AppConfig) -> AppConfig {
    AppConfig {
        ae_version: config.ae_version.trim().to_string(),
        move_layers_backward_shortcut: config.move_layers_backward_shortcut.trim().to_string(),
        move_layers_forward_shortcut: config.move_layers_forward_shortcut.trim().to_string(),
        move_jump_marker_shortcut: config.move_jump_marker_shortcut.trim().to_string(),
        select_jump_marker_layer_shortcut: config
            .select_jump_marker_layer_shortcut
            .trim()
            .to_string(),
        adjust_markers_shortcut: config.adjust_markers_shortcut.trim().to_string(),
        render_shortcut: config.render_shortcut.trim().to_string(),
        drive: config.drive.trim().to_string(),
        produtos: config.produtos.trim().to_string(),
        produtos_year: sanitize_produtos_year(&config.produtos_year),
        produtos_path: config.produtos_path.trim().to_string(),
    }
}

pub fn validate_config(config: AppConfig) -> Result<AppConfig, String> {
    let config = sanitize_config(config);
    if config.ae_version.is_empty() {
        return Err("Informe a versão do After Effects.".to_string());
    }
    if config.drive.is_empty() {
        return Err("Selecione o entrypoint do Drive.".to_string());
    }
    if is_incomplete_drive_entrypoint(&config.drive) {
        return Err("Selecione o entrypoint completo do Drive.".to_string());
    }
    if config.produtos_path.is_empty() {
        return Err("Selecione a pasta Fotos Flow.".to_string());
    }
    if config.produtos.is_empty() {
        return Err("Informe o nome da pasta de produtos.".to_string());
    }
    if !config.produtos_year.is_empty() && !is_valid_year(&config.produtos_year) {
        return Err("Informe um ano de produtos com 4 dígitos ou deixe em branco.".to_string());
    }

    Ok(config)
}

fn default_ae_version() -> String {
    "2026".to_string()
}

fn default_move_layers_backward_shortcut() -> String {
    "Ctrl+Numpad1".to_string()
}

fn default_move_layers_forward_shortcut() -> String {
    "Ctrl+Numpad3".to_string()
}

fn default_move_jump_marker_shortcut() -> String {
    "Ctrl+Numpad2".to_string()
}

fn default_select_jump_marker_layer_shortcut() -> String {
    "Ctrl+Numpad0".to_string()
}

fn default_adjust_markers_shortcut() -> String {
    "Ctrl+NumpadDecimal".to_string()
}

fn default_render_shortcut() -> String {
    "Ctrl+NumpadEnter".to_string()
}

fn default_drive() -> String {
    r"I:\Drives compartilhados\Phx CRF Copa".to_string()
}

fn default_produtos() -> String {
    "PRODUTOS".to_string()
}

fn default_produtos_year() -> String {
    String::new()
}

fn default_produtos_path() -> String {
    r"I:\Drives compartilhados\Phx CRF Copa\CARREFOUR\ASSETS\_FOTOS FLOW".to_string()
}

fn sanitize_produtos_year(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
        default_produtos_year()
    } else {
        trimmed.to_string()
    }
}

fn is_valid_year(value: &str) -> bool {
    value.len() == 4 && value.chars().all(|ch| ch.is_ascii_digit())
}

fn is_incomplete_drive_entrypoint(value: &str) -> bool {
    let path = PathBuf::from(value.trim());
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("Drives compartilhados"))
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::{validate_config, AppConfig};

    #[test]
    fn allows_every_after_shortcut_to_be_disabled() {
        let mut config = AppConfig::default();
        config.move_layers_backward_shortcut.clear();
        config.move_layers_forward_shortcut.clear();
        config.move_jump_marker_shortcut.clear();
        config.select_jump_marker_layer_shortcut.clear();
        config.adjust_markers_shortcut.clear();
        config.render_shortcut.clear();

        let validated = validate_config(config).unwrap();

        assert!(validated.move_layers_backward_shortcut.is_empty());
        assert!(validated.move_layers_forward_shortcut.is_empty());
        assert!(validated.move_jump_marker_shortcut.is_empty());
        assert!(validated.select_jump_marker_layer_shortcut.is_empty());
        assert!(validated.adjust_markers_shortcut.is_empty());
        assert!(validated.render_shortcut.is_empty());
    }
}
