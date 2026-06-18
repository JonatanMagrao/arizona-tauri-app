use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_ae_version")]
    pub ae_version: String,
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
        .map_err(|err| format!("Nao foi possivel ler {}: {err}", path.display()))?;
    serde_json::from_str(&text)
        .map(sanitize_config)
        .map_err(|err| format!("Config invalida em {}: {err}", path.display()))
}

pub fn load_validated(app: &AppHandle) -> Result<AppConfig, String> {
    validate_config(load(app)?)
}

pub fn save(app: &AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let config = validate_config(config)?;
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Nao foi possivel criar {}: {err}", parent.display()))?;
    }

    let text = serde_json::to_string_pretty(&config).map_err(|err| err.to_string())?;
    fs::write(&path, text)
        .map_err(|err| format!("Nao foi possivel salvar {}: {err}", path.display()))?;

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
        drive: config.drive.trim().to_string(),
        produtos: config.produtos.trim().to_string(),
        produtos_year: sanitize_produtos_year(&config.produtos_year),
        produtos_path: config.produtos_path.trim().to_string(),
    }
}

fn validate_config(config: AppConfig) -> Result<AppConfig, String> {
    let config = sanitize_config(config);
    if config.ae_version.is_empty() {
        return Err("Informe a versao do After Effects.".to_string());
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
        return Err("Informe um ano de produtos com 4 digitos ou deixe em branco.".to_string());
    }

    Ok(config)
}

fn default_ae_version() -> String {
    "2024".to_string()
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
