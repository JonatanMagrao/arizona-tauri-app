use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    time::Duration,
};

const PRODUCT_COPY_MAX_PARALLELISM: usize = 4;
const PRODUCT_COPY_MAX_RETRIES: usize = 3;

pub(super) fn list_product_source_files(origem: &Path) -> Result<Vec<PathBuf>, String> {
    let mut arquivos = Vec::new();
    for entry in
        fs::read_dir(origem).map_err(|err| format!("Erro ao ler {}: {err}", origem.display()))?
    {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.is_file() {
            arquivos.push(path);
        }
    }

    Ok(arquivos)
}

pub(super) fn queue_product_copy_tasks(
    arquivos: &[PathBuf],
    codigo: &str,
    copy_tasks: &mut Vec<(PathBuf, String)>,
    queued_copy_names: &mut HashSet<String>,
) -> Result<bool, String> {
    let encontrados: Vec<PathBuf> = arquivos
        .iter()
        .filter(|arquivo| product_file_matches_code(arquivo, codigo))
        .cloned()
        .collect();

    if encontrados.is_empty() {
        return Ok(false);
    }

    for arquivo in encontrados {
        let file_name = arquivo
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Nome de arquivo invÃ¡lido: {}", arquivo.display()))?
            .to_string();
        if queued_copy_names.insert(file_name.to_lowercase()) {
            copy_tasks.push((arquivo, file_name));
        }
    }

    Ok(true)
}

fn product_file_matches_code(arquivo: &Path, codigo: &str) -> bool {
    let codigo = codigo.trim();
    if codigo.is_empty() {
        return false;
    }

    arquivo
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.trim() == codigo)
        .unwrap_or(false)
}

pub(super) struct CopyFilesResult {
    pub(super) imported_files: Vec<String>,
    pub(super) existing_files: Vec<String>,
}

enum CopyFileOutcome {
    Imported(String),
    Existing(String),
}

pub(super) fn copy_product_files(
    destino: &Path,
    tasks: &[(PathBuf, String)],
) -> Result<CopyFilesResult, String> {
    let mut imported_files = Vec::new();
    let mut existing_files = Vec::new();
    let mut next_index = 0;

    while next_index < tasks.len() {
        let remaining = tasks.len() - next_index;
        let parallelism = product_copy_parallelism(remaining);
        let chunk_end = (next_index + parallelism).min(tasks.len());
        let chunk = &tasks[next_index..chunk_end];
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|(source, file_name)| {
                    let target = destino.join(file_name);
                    scope.spawn(move || copy_product_file_with_retry(source, &target, file_name))
                })
                .collect();

            handles
                .into_iter()
                .map(|handle| {
                    handle
                        .join()
                        .unwrap_or_else(|_| Err("Falha ao copiar produto.".to_string()))
                })
                .collect::<Vec<_>>()
        });

        for result in results {
            match result? {
                CopyFileOutcome::Imported(file_name) => imported_files.push(file_name),
                CopyFileOutcome::Existing(file_name) => existing_files.push(file_name),
            }
        }

        next_index = chunk_end;
    }

    Ok(CopyFilesResult {
        imported_files,
        existing_files,
    })
}

fn product_copy_parallelism(task_count: usize) -> usize {
    if task_count <= 1 {
        return 1;
    }

    let available = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(2);
    let workers = match available {
        0..=2 => 1,
        3..=4 => 2,
        5..=8 => 3,
        _ => PRODUCT_COPY_MAX_PARALLELISM,
    };

    task_count.min(workers).min(PRODUCT_COPY_MAX_PARALLELISM)
}

fn copy_product_file_with_retry(
    source: &Path,
    target: &Path,
    file_name: &str,
) -> Result<CopyFileOutcome, String> {
    for attempt in 0..=PRODUCT_COPY_MAX_RETRIES {
        match copy_product_file_once(source, target) {
            Ok(CopyFileOutcome::Imported(_)) => {
                return Ok(CopyFileOutcome::Imported(file_name.to_string()));
            }
            Ok(CopyFileOutcome::Existing(_)) => {
                return Ok(CopyFileOutcome::Existing(file_name.to_string()));
            }
            Err(err) if attempt < PRODUCT_COPY_MAX_RETRIES => {
                std::thread::sleep(Duration::from_millis(180 * (attempt as u64 + 1)));
                if target.exists() {
                    return Ok(CopyFileOutcome::Existing(file_name.to_string()));
                }

                let _ = err;
            }
            Err(err) => return Err(format!("Erro ao copiar {file_name}: {err}")),
        }
    }

    Err(format!("Erro ao copiar {file_name}."))
}

fn copy_product_file_once(source: &Path, target: &Path) -> Result<CopyFileOutcome, String> {
    if target.exists() {
        return Ok(CopyFileOutcome::Existing(String::new()));
    }

    let mut source_file = File::open(source).map_err(|err| err.to_string())?;
    let mut target_file = match OpenOptions::new().write(true).create_new(true).open(target) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            return Ok(CopyFileOutcome::Existing(String::new()));
        }
        Err(err) => return Err(err.to_string()),
    };

    match std::io::copy(&mut source_file, &mut target_file) {
        Ok(_) => Ok(CopyFileOutcome::Imported(String::new())),
        Err(err) => {
            drop(target_file);
            let _ = fs::remove_file(target);
            Err(err.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_source_match_accepts_exact_stem_with_matching_case() {
        assert!(product_file_matches_code(
            Path::new("Fraldinha_Bovina.png"),
            "Fraldinha_Bovina"
        ));
        assert!(product_file_matches_code(
            Path::new("3389987.png"),
            "3389987"
        ));
    }

    #[test]
    fn product_source_match_rejects_partial_stem_and_different_case() {
        assert!(!product_file_matches_code(
            Path::new("4136152_A_OK.png"),
            "4136152"
        ));
        assert!(!product_file_matches_code(
            Path::new("Icone_Borda_Memoria_256GB.png"),
            "Borda_Memoria"
        ));
        assert!(!product_file_matches_code(
            Path::new("Fraldinha_Bovina.png"),
            "fraldinha_bovina"
        ));
    }

    #[test]
    fn product_source_match_trims_both_names_before_comparing() {
        assert!(product_file_matches_code(
            Path::new(" Produto Exato .png"),
            "  Produto Exato  "
        ));
    }
}
