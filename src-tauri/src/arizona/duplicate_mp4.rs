use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use super::Arizona;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMp4Item {
    pub file_name: String,
    pub stem: String,
    pub extension: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateMp4NamesJsonFile {
    version: u8,
    jobao_cod: String,
    folder: String,
    generated_at: String,
    files: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMp4NamesJsonExport {
    pub count: usize,
    pub added_count: usize,
    pub file_name: String,
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMp4NamesJsonImport {
    pub count: usize,
    pub file_name: String,
    pub path: String,
    pub names: Vec<String>,
}

#[derive(Clone)]
pub struct DuplicateMp4Copy {
    pub source_file_name: String,
    pub target_file_name: String,
    pub folder_path: PathBuf,
    pub source_path: PathBuf,
    pub target_path: PathBuf,
}

pub struct DuplicateMp4Result {
    pub message: String,
    pub copies: Vec<DuplicateMp4Copy>,
}

impl Arizona {
    pub fn list_identical_mp4_items(
        &self,
        jobao_cod: &str,
    ) -> Result<Vec<DuplicateMp4Item>, String> {
        let mp4_folder = self.mp4_folder(jobao_cod)?;
        let mut items = Vec::new();

        for entry in fs::read_dir(&mp4_folder)
            .map_err(|err| format!("Erro ao ler {}: {err}", mp4_folder.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if !path.is_file() || !has_extension(&path, "mp4") {
                continue;
            }

            let file_name = entry.file_name().to_string_lossy().into_owned();
            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_string();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_string();

            items.push(DuplicateMp4Item {
                file_name,
                stem,
                extension,
            });
        }

        items.sort_by_key(|item| item.file_name.to_lowercase());
        Ok(items)
    }

    pub fn duplicate_identical_mp4(
        &self,
        jobao_cod: &str,
        source_file_name: &str,
        copy_names: Vec<String>,
    ) -> Result<DuplicateMp4Result, String> {
        let mp4_folder = self.mp4_folder(jobao_cod)?;
        let source_path = self.find_mp4_by_name(&mp4_folder, source_file_name)?;
        let source_file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("Nome de arquivo inválido: {}", source_path.display()))?
            .to_string();
        let source_extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("Arquivo sem extensão: {}", source_path.display()))?;
        let target_file_names = validate_copy_names(&mp4_folder, &copy_names, source_extension)?;

        let mut copies = Vec::new();
        for target_file_name in &target_file_names {
            let target_path = mp4_folder.join(target_file_name);
            fs::copy(&source_path, &target_path).map_err(|err| {
                format!(
                    "Erro ao copiar {} para {}: {err}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
            copies.push(DuplicateMp4Copy {
                source_file_name: source_file_name.clone(),
                target_file_name: target_file_name.clone(),
                folder_path: mp4_folder.clone(),
                source_path: source_path.clone(),
                target_path,
            });
        }

        let count = target_file_names.len();
        let label = if count == 1 {
            "cópia criada"
        } else {
            "cópias criadas"
        };
        Ok(DuplicateMp4Result {
            message: format!("{count} {label}."),
            copies,
        })
    }

    pub fn export_identical_mp4_names_json(
        &self,
        jobao_cod: &str,
    ) -> Result<DuplicateMp4NamesJsonExport, String> {
        let mp4_folder = self.mp4_folder(jobao_cod)?;
        let json_folder = self.claquetes_folder(jobao_cod)?;
        let files = mp4_file_names(&mp4_folder)?;

        if files.is_empty() {
            return Err("Nenhum MP4 encontrado para gerar o JSON.".to_string());
        }

        let json_file_name = mp4_names_json_file_name(jobao_cod);
        let json_path = mp4_names_json_path(&json_folder, &json_file_name);
        let payload = DuplicateMp4NamesJsonFile {
            version: 1,
            jobao_cod: jobao_cod.trim().to_string(),
            folder: mp4_folder.to_string_lossy().into_owned(),
            generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            files,
        };
        let contents = serde_json::to_string_pretty(&payload)
            .map_err(|err| format!("Erro ao montar JSON de nomes MP4: {err}"))?;

        fs::write(&json_path, contents).map_err(|err| {
            format!(
                "Erro ao gravar JSON de nomes MP4 em {}: {err}",
                json_path.display()
            )
        })?;

        Ok(DuplicateMp4NamesJsonExport {
            count: payload.files.len(),
            added_count: payload.files.len(),
            file_name: json_file_name,
            path: json_path.to_string_lossy().into_owned(),
        })
    }

    pub fn update_identical_mp4_names_json(
        &self,
        jobao_cod: &str,
    ) -> Result<DuplicateMp4NamesJsonExport, String> {
        let mp4_folder = self.mp4_folder(jobao_cod)?;
        let json_folder = self.claquetes_folder(jobao_cod)?;
        let current_files = mp4_file_names(&mp4_folder)?;

        if current_files.is_empty() {
            return Err("Nenhum MP4 encontrado para atualizar o JSON.".to_string());
        }

        let json_file_name = mp4_names_json_file_name(jobao_cod);
        let json_path = mp4_names_json_path(&json_folder, &json_file_name);
        let existing_files = if json_path.is_file() {
            let contents = fs::read_to_string(&json_path).map_err(|err| {
                format!(
                    "Erro ao ler JSON de nomes MP4 em {}: {err}",
                    json_path.display()
                )
            })?;
            parse_mp4_names_json(&contents)?
        } else {
            Vec::new()
        };
        let (files, added_count) = merge_mp4_names_json_files(existing_files, current_files)?;
        let payload = DuplicateMp4NamesJsonFile {
            version: 1,
            jobao_cod: jobao_cod.trim().to_string(),
            folder: mp4_folder.to_string_lossy().into_owned(),
            generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            files,
        };
        let contents = serde_json::to_string_pretty(&payload)
            .map_err(|err| format!("Erro ao montar JSON de nomes MP4: {err}"))?;

        fs::write(&json_path, contents).map_err(|err| {
            format!(
                "Erro ao gravar JSON de nomes MP4 em {}: {err}",
                json_path.display()
            )
        })?;

        Ok(DuplicateMp4NamesJsonExport {
            count: payload.files.len(),
            added_count,
            file_name: json_file_name,
            path: json_path.to_string_lossy().into_owned(),
        })
    }

    pub fn import_identical_mp4_names_json(
        &self,
        jobao_cod: &str,
    ) -> Result<DuplicateMp4NamesJsonImport, String> {
        let json_folder = self.claquetes_folder(jobao_cod)?;
        let json_file_name = mp4_names_json_file_name(jobao_cod);
        let json_path = mp4_names_json_path(&json_folder, &json_file_name);

        if !json_path.is_file() {
            return Err(format!(
                "JSON de nomes MP4 não encontrado em {}.",
                json_path.display()
            ));
        }

        let contents = fs::read_to_string(&json_path).map_err(|err| {
            format!(
                "Erro ao ler JSON de nomes MP4 em {}: {err}",
                json_path.display()
            )
        })?;
        let file_names = parse_mp4_names_json(&contents)?;
        let names = imported_copy_names_from_mp4_files(file_names)?;

        Ok(DuplicateMp4NamesJsonImport {
            count: names.len(),
            file_name: json_file_name,
            path: json_path.to_string_lossy().into_owned(),
            names,
        })
    }

    fn mp4_folder(&self, jobao_cod: &str) -> Result<PathBuf, String> {
        let folder = self
            .get_jobao_path(jobao_cod)?
            .join("OUT")
            .join("RENDER")
            .join("MP4");

        if !folder.is_dir() {
            return Err(format!("Pasta MP4 não encontrada em {}", folder.display()));
        }

        Ok(folder)
    }

    fn claquetes_folder(&self, jobao_cod: &str) -> Result<PathBuf, String> {
        let folder = self.get_jobao_path(jobao_cod)?.join("CLAQUETES");

        if !folder.is_dir() {
            return Err(format!(
                "Pasta CLAQUETES não encontrada em {}",
                folder.display()
            ));
        }

        Ok(folder)
    }

    fn find_mp4_by_name(
        &self,
        mp4_folder: &Path,
        source_file_name: &str,
    ) -> Result<PathBuf, String> {
        let source_file_name = source_file_name.trim();
        if source_file_name.is_empty() {
            return Err("Selecione um arquivo MP4.".to_string());
        }

        for entry in fs::read_dir(mp4_folder)
            .map_err(|err| format!("Erro ao ler {}: {err}", mp4_folder.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if !path.is_file() || !has_extension(&path, "mp4") {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            if name == source_file_name {
                return Ok(path);
            }
        }

        Err(format!(
            "Arquivo MP4 \"{}\" não encontrado.",
            source_file_name
        ))
    }
}

fn validate_copy_names(
    mp4_folder: &Path,
    copy_names: &[String],
    extension: &str,
) -> Result<Vec<String>, String> {
    if copy_names.is_empty() {
        return Err("Adicione ao menos um nome para a cópia.".to_string());
    }

    let existing = file_name_keys(mp4_folder)?;
    let mut requested = HashSet::new();
    let mut targets = Vec::new();

    for copy_name in copy_names {
        let file_name = normalize_copy_name(copy_name, extension)?;
        let key = file_name.to_lowercase();
        if !requested.insert(key.clone()) {
            return Err(format!("Nome repetido: \"{}\".", file_name));
        }

        if existing.contains(&key) {
            return Err(format!("Já existe um arquivo chamado \"{}\".", file_name));
        }

        let target_path = mp4_folder.join(&file_name);
        if target_path.exists() {
            return Err(format!("Já existe um arquivo chamado \"{}\".", file_name));
        }

        targets.push(file_name);
    }

    Ok(targets)
}

fn mp4_names_json_file_name(jobao_cod: &str) -> String {
    let normalized: String = jobao_cod
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        .collect();
    let normalized = if normalized.is_empty() {
        "jobao"
    } else {
        normalized.as_str()
    };

    format!("{normalized}-jobinhos.json")
}

fn mp4_names_json_path(mp4_folder: &Path, file_name: &str) -> PathBuf {
    mp4_folder.join(file_name)
}

fn mp4_file_names(mp4_folder: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();

    for entry in fs::read_dir(mp4_folder)
        .map_err(|err| format!("Erro ao ler {}: {err}", mp4_folder.display()))?
    {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() || !has_extension(&path, "mp4") {
            continue;
        }

        names.push(entry.file_name().to_string_lossy().into_owned());
    }

    names.sort_by_key(|name| name.to_lowercase());
    Ok(names)
}

fn parse_mp4_names_json(contents: &str) -> Result<Vec<String>, String> {
    let value: Value = serde_json::from_str(contents)
        .map_err(|err| format!("JSON de nomes MP4 inválido: {err}"))?;
    let entries = match &value {
        Value::Array(items) => items,
        Value::Object(map) => map
            .get("files")
            .or_else(|| map.get("names"))
            .and_then(Value::as_array)
            .ok_or_else(|| "JSON de nomes MP4 deve conter uma lista em \"files\".".to_string())?,
        _ => {
            return Err("JSON de nomes MP4 deve conter uma lista em \"files\".".to_string());
        }
    };
    let mut names = Vec::new();

    for entry in entries {
        let Some(name) = entry.as_str() else {
            return Err("JSON de nomes MP4 deve conter apenas textos.".to_string());
        };

        names.push(name.to_string());
    }

    Ok(names)
}

fn imported_copy_names_from_mp4_files(file_names: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut names = Vec::new();

    for file_name in file_names {
        let Some(name) = copy_name_from_mp4_json_entry(&file_name)? else {
            continue;
        };
        let key = name.to_lowercase();
        if seen.insert(key) {
            names.push(name);
        }
    }

    if names.is_empty() {
        return Err("Nenhum nome MP4 encontrado no JSON.".to_string());
    }

    Ok(names)
}

fn merge_mp4_names_json_files(
    existing_files: Vec<String>,
    current_files: Vec<String>,
) -> Result<(Vec<String>, usize), String> {
    let mut seen = HashSet::new();
    let mut merged = Vec::new();

    for file_name in existing_files {
        let Some(canonical_name) = canonical_mp4_json_file_name(&file_name)? else {
            continue;
        };
        let Some(key) = mp4_json_file_key(&canonical_name)? else {
            continue;
        };
        if seen.insert(key) {
            merged.push(canonical_name);
        }
    }

    let mut added_count = 0;
    for file_name in current_files {
        let Some(key) = mp4_json_file_key(&file_name)? else {
            continue;
        };
        if seen.insert(key) {
            merged.push(file_name);
            added_count += 1;
        }
    }

    Ok((merged, added_count))
}

fn canonical_mp4_json_file_name(value: &str) -> Result<Option<String>, String> {
    let Some(copy_name) = copy_name_from_mp4_json_entry(value)? else {
        return Ok(None);
    };

    Ok(Some(format!("{copy_name}.mp4")))
}

fn mp4_json_file_key(value: &str) -> Result<Option<String>, String> {
    Ok(copy_name_from_mp4_json_entry(value)?.map(|name| name.to_lowercase()))
}

fn copy_name_from_mp4_json_entry(value: &str) -> Result<Option<String>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if trimmed.contains('\\') || trimmed.contains('/') {
        return Err(format!(
            "JSON deve conter somente nomes de arquivo: \"{}\".",
            trimmed
        ));
    }

    let lower = trimmed.to_lowercase();
    let name = if lower.ends_with(".mp4") {
        &trimmed[..trimmed.len() - ".mp4".len()]
    } else {
        trimmed
    }
    .trim();

    if name.is_empty() {
        return Ok(None);
    }

    Ok(Some(name.to_string()))
}

fn file_name_keys(mp4_folder: &Path) -> Result<HashSet<String>, String> {
    let mut names = HashSet::new();

    for entry in fs::read_dir(mp4_folder)
        .map_err(|err| format!("Erro ao ler {}: {err}", mp4_folder.display()))?
    {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.is_file() {
            names.insert(entry.file_name().to_string_lossy().to_lowercase());
        }
    }

    Ok(names)
}

fn normalize_copy_name(value: &str, extension: &str) -> Result<String, String> {
    let extension = extension.trim().trim_start_matches('.');
    if extension.is_empty() {
        return Err("Extensão do arquivo matriz inválida.".to_string());
    }

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Preencha todos os nomes das cópias.".to_string());
    }

    if trimmed.contains('\\') || trimmed.contains('/') {
        return Err(format!("Use somente o nome do arquivo: \"{}\".", trimmed));
    }

    if trimmed.chars().any(has_invalid_windows_file_char) {
        return Err(format!("Nome inválido para arquivo: \"{}\".", trimmed));
    }

    let lower = trimmed.to_lowercase();
    let extension_suffix = format!(".{}", extension.to_lowercase());
    let stem = if lower.ends_with(&extension_suffix) {
        &trimmed[..trimmed.len() - extension_suffix.len()]
    } else {
        trimmed
    };

    if stem.trim().is_empty() {
        return Err(format!("Informe um nome antes da extensão .{}.", extension));
    }

    if stem.ends_with(' ') || stem.ends_with('.') {
        return Err(format!("Nome inválido para arquivo: \"{}\".", trimmed));
    }

    if is_reserved_windows_name(stem) {
        return Err(format!("Nome reservado pelo Windows: \"{}\".", stem));
    }

    Ok(format!("{stem}.{extension}"))
}

fn has_invalid_windows_file_char(ch: char) -> bool {
    matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*') || ch.is_control()
}

fn is_reserved_windows_name(stem: &str) -> bool {
    let base = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(
        base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(extension))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_mp4_copy_names() {
        assert_eq!(
            normalize_copy_name("novo_nome", "mp4").unwrap(),
            "novo_nome.mp4"
        );
        assert_eq!(
            normalize_copy_name("novo_nome.MP4", "mp4").unwrap(),
            "novo_nome.mp4"
        );
        assert_eq!(
            normalize_copy_name("novo_nome", "MOV").unwrap(),
            "novo_nome.MOV"
        );
    }

    #[test]
    fn rejects_invalid_mp4_copy_names() {
        assert!(normalize_copy_name("", "mp4").is_err());
        assert!(normalize_copy_name("pasta/arquivo", "mp4").is_err());
        assert!(normalize_copy_name("CON", "mp4").is_err());
        assert!(normalize_copy_name("arquivo?.mp4", "mp4").is_err());
    }

    #[test]
    fn rejects_duplicate_or_existing_mp4_copy_names() {
        let folder = std::env::temp_dir().join(format!(
            "arizona_duplicate_identical_test_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("existente.mp4"), b"").unwrap();

        let duplicate_names = vec!["novo".to_string(), "novo.mp4".to_string()];
        assert!(validate_copy_names(&folder, &duplicate_names, "mp4")
            .unwrap_err()
            .contains("Nome repetido"));

        let existing_name = vec!["existente".to_string()];
        assert!(validate_copy_names(&folder, &existing_name, "mp4")
            .unwrap_err()
            .contains("arquivo chamado"));

        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn parses_mp4_names_json_for_import() {
        let contents = r#"{
            "files": [
                "23353_RN_10_E_12-07_29041.mp4",
                "23352_PB_10_E_12-07_29041.MP4",
                "23353_RN_10_E_12-07_29041.mp4"
            ]
        }"#;
        let parsed = parse_mp4_names_json(contents).unwrap();

        assert_eq!(
            imported_copy_names_from_mp4_files(parsed).unwrap(),
            vec![
                "23353_RN_10_E_12-07_29041".to_string(),
                "23352_PB_10_E_12-07_29041".to_string()
            ]
        );
    }

    #[test]
    fn builds_jobinhos_json_file_name_from_jobao_code() {
        assert_eq!(mp4_names_json_file_name("1315"), "1315-jobinhos.json");
        assert_eq!(mp4_names_json_file_name(" 13/15 "), "1315-jobinhos.json");
    }

    #[test]
    fn update_json_merge_only_adds_missing_mp4_names() {
        let existing = vec![
            "antigo_que_saiu.mp4".to_string(),
            "ja_existe.mp4".to_string(),
        ];
        let current = vec!["ja_existe.mp4".to_string(), "novo.mp4".to_string()];
        let (merged, added_count) = merge_mp4_names_json_files(existing, current).unwrap();

        assert_eq!(added_count, 1);
        assert_eq!(
            merged,
            vec![
                "antigo_que_saiu.mp4".to_string(),
                "ja_existe.mp4".to_string(),
                "novo.mp4".to_string()
            ]
        );
    }
}
