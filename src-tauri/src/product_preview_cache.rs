use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const CACHE_APP_DIRECTORY: &str = "Arizona Carrefour";
const CACHE_PANEL_DIRECTORY: &str = "Product Viewer";
const CACHE_PREVIEW_DIRECTORY: &str = "preview-cache";
const SHARED_CACHE_VERSION_DIRECTORY: &str = "prewarmed-v1";
const CACHE_FILES_DIRECTORY: &str = "files";
const CACHE_JOBS_DIRECTORY: &str = "jobs";
const CACHE_TASKS_DIRECTORY: &str = "tasks";
const POWERSHELL_SCRIPT_NAME: &str = "arizona-product-preview-v1.ps1";
const PREVIEW_SIZE: u32 = 512;
const CACHE_VERSION: u32 = 1;

static SESSION_COMPLETED_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static SESSION_ACTIVE_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductPreviewManifestEntry {
    source_path: String,
    size: u64,
    modified_at_ms: u64,
    cache_key: String,
    preview_available: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductPreviewManifest {
    version: u32,
    jobao_cod: String,
    products_directory: String,
    status: String,
    updated_at_epoch_ms: u64,
    entries: Vec<ProductPreviewManifestEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewTask {
    input_path: String,
    output_path: String,
    size: u32,
}

pub fn start_warmup(app: AppHandle, jobao_cod: String, products_directory: PathBuf) {
    #[cfg(not(windows))]
    {
        let _ = (app, jobao_cod, products_directory);
        return;
    }

    #[cfg(windows)]
    {
        let job_key = sanitize_job_key(&jobao_cod);

        if lock_jobs(completed_jobs()).contains(&job_key) {
            if has_complete_manifest(&app, &jobao_cod) {
                return;
            }

            lock_jobs(completed_jobs()).remove(&job_key);
        }

        {
            let mut active_jobs = lock_jobs(active_jobs());
            if !active_jobs.insert(job_key.clone()) {
                return;
            }
        }

        tauri::async_runtime::spawn_blocking(move || {
            let result = warmup_job(&app, &jobao_cod, &products_directory);

            if let Ok(mut active_jobs) = active_jobs().lock() {
                active_jobs.remove(&job_key);
            }

            match result {
                Ok(()) => {
                    if let Ok(mut completed_jobs) = completed_jobs().lock() {
                        completed_jobs.insert(job_key);
                    }
                }
                Err(error) => {
                    eprintln!(
                        "Nao foi possivel preparar previews do Jobao {}: {}",
                        jobao_cod, error
                    );
                }
            }
        });
    }
}

#[cfg(windows)]
fn has_complete_manifest(app: &AppHandle, jobao_cod: &str) -> bool {
    let Ok(cache_root) = shared_cache_root(app) else {
        return false;
    };
    let manifest_path = cache_root
        .join(CACHE_JOBS_DIRECTORY)
        .join(format!("{}.json", sanitize_job_key(jobao_cod)));

    read_manifest(&manifest_path)
        .map(|manifest| manifest.status == "complete")
        .unwrap_or(false)
}

#[cfg(windows)]
fn warmup_job(app: &AppHandle, jobao_cod: &str, products_directory: &Path) -> Result<(), String> {
    if !products_directory.is_dir() {
        return Err(format!(
            "Pasta de produtos nao encontrada: {}",
            products_directory.display()
        ));
    }

    let cache_root = shared_cache_root(app)?;
    let files_directory = cache_root.join(CACHE_FILES_DIRECTORY);
    let jobs_directory = cache_root.join(CACHE_JOBS_DIRECTORY);
    let tasks_directory = cache_root.join(CACHE_TASKS_DIRECTORY);
    fs::create_dir_all(&files_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&jobs_directory).map_err(|error| error.to_string())?;
    fs::create_dir_all(&tasks_directory).map_err(|error| error.to_string())?;

    let manifest_path = jobs_directory.join(format!("{}.json", sanitize_job_key(jobao_cod)));
    let previous_manifest = read_manifest(&manifest_path);
    let unavailable_cache_keys = previous_manifest
        .as_ref()
        .filter(|manifest| manifest.status == "complete")
        .map(|manifest| {
            manifest
                .entries
                .iter()
                .filter(|entry| !entry.preview_available)
                .map(|entry| entry.cache_key.clone())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();

    let mut entries = scan_product_entries(products_directory)?;
    let mut tasks = Vec::new();

    for entry in &mut entries {
        let output_path = files_directory.join(format!("{}.png", entry.cache_key));
        entry.preview_available = output_path.is_file();

        if !entry.preview_available && !unavailable_cache_keys.contains(&entry.cache_key) {
            tasks.push(PreviewTask {
                input_path: entry.source_path.clone(),
                output_path: path_text(&output_path),
                size: PREVIEW_SIZE,
            });
        }
    }

    write_manifest(
        &manifest_path,
        ProductPreviewManifest {
            version: CACHE_VERSION,
            jobao_cod: jobao_cod.trim().to_string(),
            products_directory: path_text(products_directory),
            status: "preparing".to_string(),
            updated_at_epoch_ms: epoch_millis(SystemTime::now()),
            entries: entries.clone(),
        },
    )?;

    if !tasks.is_empty() {
        run_preview_tasks(&cache_root, &tasks_directory, jobao_cod, &tasks)?;
    }

    for entry in &mut entries {
        entry.preview_available = files_directory
            .join(format!("{}.png", entry.cache_key))
            .is_file();
    }

    write_manifest(
        &manifest_path,
        ProductPreviewManifest {
            version: CACHE_VERSION,
            jobao_cod: jobao_cod.trim().to_string(),
            products_directory: path_text(products_directory),
            status: "complete".to_string(),
            updated_at_epoch_ms: epoch_millis(SystemTime::now()),
            entries,
        },
    )
}

#[cfg(windows)]
fn scan_product_entries(
    products_directory: &Path,
) -> Result<Vec<ProductPreviewManifestEntry>, String> {
    let mut paths = fs::read_dir(products_directory)
        .map_err(|error| format!("Erro ao ler {}: {error}", products_directory.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file() && is_supported_product_image(path))
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| path_text(path).to_lowercase());

    paths
        .into_iter()
        .map(|path| {
            let metadata = fs::metadata(&path)
                .map_err(|error| format!("Erro ao ler {}: {error}", path.display()))?;
            let modified_at_ms = metadata.modified().map(epoch_millis).unwrap_or_default();
            let source_path = path_text(&path);

            Ok(ProductPreviewManifestEntry {
                cache_key: preview_cache_key(&source_path, metadata.len(), modified_at_ms),
                source_path,
                size: metadata.len(),
                modified_at_ms,
                preview_available: false,
            })
        })
        .collect()
}

#[cfg(windows)]
fn run_preview_tasks(
    cache_root: &Path,
    tasks_directory: &Path,
    jobao_cod: &str,
    tasks: &[PreviewTask],
) -> Result<(), String> {
    let script_path = cache_root.join(POWERSHELL_SCRIPT_NAME);
    if !script_path.is_file() {
        fs::write(&script_path, include_str!("product_preview_cache.ps1"))
            .map_err(|error| format!("Erro ao criar {}: {error}", script_path.display()))?;
    }

    let tasks_path = tasks_directory.join(format!(
        "{}-{}-{}.json",
        sanitize_job_key(jobao_cod),
        std::process::id(),
        epoch_millis(SystemTime::now())
    ));
    let tasks_json = serde_json::to_string(tasks).map_err(|error| error.to_string())?;
    fs::write(&tasks_path, tasks_json)
        .map_err(|error| format!("Erro ao criar {}: {error}", tasks_path.display()))?;

    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let result = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script_path)
        .arg("-TasksPath")
        .arg(&tasks_path)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| format!("Erro ao iniciar PowerShell: {error}"));

    let _ = fs::remove_file(&tasks_path);
    let status = result?;

    if !status.success() {
        return Err(format!("PowerShell encerrou com status {status}."));
    }

    Ok(())
}

fn preview_cache_key(source_path: &str, size: u64, modified_at_ms: u64) -> String {
    let normalized_path = source_path.replace('/', "\\").to_lowercase();
    let identity = format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}",
        normalized_path, size, modified_at_ms, PREVIEW_SIZE
    );
    format!("{:x}", Sha256::digest(identity.as_bytes()))
}

#[cfg(windows)]
fn shared_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let local_app_data = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| app.path().app_local_data_dir().ok())
        .ok_or_else(|| "LOCALAPPDATA nao encontrado.".to_string())?;

    Ok(local_app_data
        .join(CACHE_APP_DIRECTORY)
        .join(CACHE_PANEL_DIRECTORY)
        .join(CACHE_PREVIEW_DIRECTORY)
        .join(SHARED_CACHE_VERSION_DIRECTORY))
}

#[cfg(windows)]
fn read_manifest(path: &Path) -> Option<ProductPreviewManifest> {
    let text = fs::read_to_string(path).ok()?;
    let manifest = serde_json::from_str::<ProductPreviewManifest>(&text).ok()?;
    (manifest.version == CACHE_VERSION).then_some(manifest)
}

#[cfg(windows)]
fn write_manifest(path: &Path, manifest: ProductPreviewManifest) -> Result<(), String> {
    let temporary_path = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(&temporary_path, text)
        .map_err(|error| format!("Erro ao criar {}: {error}", temporary_path.display()))?;

    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Erro ao atualizar {}: {error}", path.display()))?;
    }

    fs::rename(&temporary_path, path)
        .map_err(|error| format!("Erro ao concluir {}: {error}", path.display()))
}

#[cfg(windows)]
fn is_supported_product_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "psd")
    )
}

fn sanitize_job_key(jobao_cod: &str) -> String {
    let sanitized = jobao_cod
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "jobao".to_string()
    } else {
        sanitized
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn epoch_millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn completed_jobs() -> &'static Mutex<HashSet<String>> {
    SESSION_COMPLETED_JOBS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn active_jobs() -> &'static Mutex<HashSet<String>> {
    SESSION_ACTIVE_JOBS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn lock_jobs(
    jobs: &'static Mutex<HashSet<String>>,
) -> std::sync::MutexGuard<'static, HashSet<String>> {
    jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::{preview_cache_key, sanitize_job_key};

    #[test]
    fn cache_key_ignores_windows_path_case_and_separator_direction() {
        assert_eq!(
            preview_cache_key(r"I:\JOB\PRODUTOS\ITEM.PSD", 42, 1000),
            preview_cache_key("i:/job/produtos/item.psd", 42, 1000)
        );
    }

    #[test]
    fn cache_key_changes_with_source_metadata() {
        assert_ne!(
            preview_cache_key(r"I:\job\produto.psd", 42, 1000),
            preview_cache_key(r"I:\job\produto.psd", 43, 1000)
        );
        assert_ne!(
            preview_cache_key(r"I:\job\produto.psd", 42, 1000),
            preview_cache_key(r"I:\job\produto.psd", 42, 1001)
        );
    }

    #[test]
    fn cache_key_matches_the_cep_contract_vector() {
        assert_eq!(
            preview_cache_key(r"I:\job\produtos\item.psd", 42, 1000),
            "15a0f4d5d4a0c021fc07d3f127b3d504a5391c604c86312c9dd50dcc5a61af9d"
        );
    }

    #[test]
    fn sanitizes_jobao_for_manifest_file_name() {
        assert_eq!(sanitize_job_key(" 13/34 "), "13_34");
        assert_eq!(sanitize_job_key(""), "jobao");
    }
}
