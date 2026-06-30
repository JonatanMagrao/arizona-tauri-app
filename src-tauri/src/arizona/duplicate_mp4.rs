use serde::Serialize;
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
}
