use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Manager};

use crate::settings::AppConfig;

#[cfg(debug_assertions)]
const ACTION_PLACEHOLDER: &str = "__ARIZONA_ACTION__";
#[cfg(debug_assertions)]
const EMBEDDED_ACTION_SCRIPT: &str = include_str!("after_effects/arizona_actions.jsx");
#[cfg(not(debug_assertions))]
const MOVE_LAYERS_BACKWARD_SCRIPT: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/after-effects-jsxbin/move_layers_backward.jsxbin"
));
#[cfg(not(debug_assertions))]
const MOVE_LAYERS_FORWARD_SCRIPT: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/after-effects-jsxbin/move_layers_forward.jsxbin"
));
#[cfg(not(debug_assertions))]
const MOVE_JUMP_MARKER_SCRIPT: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/after-effects-jsxbin/move_jump_marker.jsxbin"
));
#[cfg(not(debug_assertions))]
const SELECT_JUMP_MARKER_LAYER_SCRIPT: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/after-effects-jsxbin/select_jump_marker_layer.jsxbin"
));
#[cfg(not(debug_assertions))]
const ADJUST_MARKERS_TO_TAIL_SCRIPT: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/after-effects-jsxbin/adjust_markers_to_tail.jsxbin"
));
#[cfg(not(debug_assertions))]
const SWAP_LAYERS_SCRIPT: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/after-effects-jsxbin/swap_layers.jsxbin"
));
#[cfg(not(debug_assertions))]
const EXPORT_PRINT_FRAMES_SCRIPT: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/after-effects-jsxbin/export_print_frames.jsxbin"
));
#[cfg(not(debug_assertions))]
const RENDER_SCRIPT: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/after-effects-jsxbin/render.jsxbin"
));
const SCRIPT_DIRECTORY_NAME: &str = "after-effects-scripts";
const EXPORT_PRINT_COMP_NAME_FILE: &str = "export-print-comp-name.txt";
const RENDER_MOV_TEMPLATE_NAME_FILE: &str = "render-mov-template-name.txt";
const RENDER_MP4_TEMPLATE_NAME_FILE: &str = "render-mp4-template-name.txt";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AfterEffectsAction {
    MoveLayersBackward,
    MoveLayersForward,
    MoveJumpMarker,
    SelectJumpMarkerLayer,
    AdjustMarkersToTail,
    SwapLayers,
    ExportPrintFrames,
    Render,
}

impl AfterEffectsAction {
    pub fn key(self) -> &'static str {
        match self {
            Self::MoveLayersBackward => "moveLayersBackward",
            Self::MoveLayersForward => "moveLayersForward",
            Self::MoveJumpMarker => "moveJumpMarker",
            Self::SelectJumpMarkerLayer => "selectJumpMarkerLayer",
            Self::AdjustMarkersToTail => "adjustMarkersToTail",
            Self::SwapLayers => "swapLayers",
            Self::ExportPrintFrames => "exportPrintFrames",
            Self::Render => "render",
        }
    }

    fn script_key(self) -> &'static str {
        match self {
            Self::MoveLayersBackward => "move_layers_backward",
            Self::MoveLayersForward => "move_layers_forward",
            Self::MoveJumpMarker => "move_jump_marker",
            Self::SelectJumpMarkerLayer => "select_jump_marker_layer",
            Self::AdjustMarkersToTail => "adjust_markers_to_tail",
            Self::SwapLayers => "swap_layers",
            Self::ExportPrintFrames => "export_print_frames",
            Self::Render => "render",
        }
    }
}

pub fn action_from_key(value: &str) -> Option<AfterEffectsAction> {
    match value.trim() {
        "moveLayersBackward" | "move_layers_backward" => {
            Some(AfterEffectsAction::MoveLayersBackward)
        }
        "moveLayersForward" | "move_layers_forward" | "move_layers_to_markers" => {
            Some(AfterEffectsAction::MoveLayersForward)
        }
        "moveJumpMarker" | "move_jump_marker" => Some(AfterEffectsAction::MoveJumpMarker),
        "selectJumpMarkerLayer" | "select_jump_marker_layer" => {
            Some(AfterEffectsAction::SelectJumpMarkerLayer)
        }
        "adjustMarkersToTail" | "adjust_markers_to_tail" => {
            Some(AfterEffectsAction::AdjustMarkersToTail)
        }
        "swapLayers" | "swap_layers" | "troca_layers" => Some(AfterEffectsAction::SwapLayers),
        "exportPrintFrames" | "export_print_frames" => Some(AfterEffectsAction::ExportPrintFrames),
        "render" | "queueRender" | "queue_render" => Some(AfterEffectsAction::Render),
        _ => None,
    }
}

pub fn execute(
    app: &AppHandle,
    config: &AppConfig,
    action: AfterEffectsAction,
) -> Result<String, String> {
    let after_fx = resolve_executable(&config.ae_version);
    if !after_fx.is_file() {
        return Err(format!(
            "AfterFX.exe nao encontrado para a versao {}. Ajuste a versao do After Effects nas configuracoes.",
            config.ae_version.trim()
        ));
    }

    if !is_after_effects_running()? {
        return Err(
            "After Effects nao esta aberto. Abra o After Effects e tente o atalho novamente."
                .to_string(),
        );
    }

    let script_path = materialize_action_script(app, config, action)?;
    let process = Command::new(&after_fx)
        .arg("-r")
        .arg(&script_path)
        .spawn()
        .map_err(|err| {
            format!(
                "Nao foi possivel executar o ExtendScript no After Effects em {}: {err}",
                after_fx.display()
            )
        })?;

    Ok(format!("after_effects_script_{}", process.id()))
}

pub fn resolve_executable(configured_version: &str) -> PathBuf {
    resolve_executable_in_roots(configured_version, &default_adobe_roots())
}

pub fn installed_versions() -> Vec<String> {
    installed_versions_in_roots(&default_adobe_roots())
}

fn installed_versions_in_roots(roots: &[PathBuf]) -> Vec<String> {
    let mut detected = Vec::new();

    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(version) = name.strip_prefix("Adobe After Effects ") else {
                continue;
            };
            if version.len() != 4 || !version.chars().all(|character| character.is_ascii_digit()) {
                continue;
            }

            let executable = path.join("Support Files").join("AfterFX.exe");
            if executable.is_file() && !detected.iter().any(|found| found == version) {
                detected.push(version.to_string());
            }
        }
    }

    detected.sort_by(|left, right| version_sort_key(right).cmp(&version_sort_key(left)));
    detected
}

fn resolve_executable_in_roots(configured_version: &str, roots: &[PathBuf]) -> PathBuf {
    let configured_version = configured_version.trim();
    let configured = roots
        .first()
        .map(|root| executable_for_version(root, configured_version))
        .unwrap_or_else(|| PathBuf::from("AfterFX.exe"));

    for root in roots {
        let candidate = executable_for_version(root, configured_version);
        if candidate.is_file() {
            return candidate;
        }
    }

    let mut detected = Vec::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(version) = name.strip_prefix("Adobe After Effects ") else {
                continue;
            };
            let executable = path.join("Support Files").join("AfterFX.exe");
            if executable.is_file() {
                detected.push((version_sort_key(version), executable));
            }
        }
    }

    detected.sort_by(|left, right| right.0.cmp(&left.0));
    detected
        .into_iter()
        .next()
        .map(|(_, path)| path)
        .unwrap_or(configured)
}

fn executable_for_version(adobe_root: &Path, version: &str) -> PathBuf {
    adobe_root
        .join(format!("Adobe After Effects {version}"))
        .join("Support Files")
        .join("AfterFX.exe")
}

fn default_adobe_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        let Some(value) = env::var_os(variable) else {
            continue;
        };
        let root = PathBuf::from(value).join("Adobe");
        if !roots.iter().any(|existing| existing == &root) {
            roots.push(root);
        }
    }
    roots
}

fn version_sort_key(version: &str) -> Vec<u32> {
    version
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .map(|part| part.parse::<u32>().unwrap_or(0))
        .collect()
}

pub(crate) fn is_after_effects_running() -> Result<bool, String> {
    let mut command = Command::new("tasklist.exe");
    command.args(["/FI", "IMAGENAME eq AfterFX.exe", "/FO", "CSV", "/NH"]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().map_err(|err| {
        format!("Nao foi possivel verificar se o After Effects esta aberto: {err}")
    })?;
    if !output.status.success() {
        return Err("Nao foi possivel verificar se o After Effects esta aberto.".to_string());
    }

    Ok(tasklist_contains_after_effects(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

fn tasklist_contains_after_effects(output: &str) -> bool {
    output.lines().any(|line| {
        line.split(',')
            .next()
            .map(|value| {
                value
                    .trim()
                    .trim_matches('"')
                    .eq_ignore_ascii_case("AfterFX.exe")
            })
            .unwrap_or(false)
    })
}

fn materialize_action_script(
    app: &AppHandle,
    config: &AppConfig,
    action: AfterEffectsAction,
) -> Result<PathBuf, String> {
    let root_directory = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join(SCRIPT_DIRECTORY_NAME);
    let directory = action_script_directory(&root_directory, config, action);
    fs::create_dir_all(&directory)
        .map_err(|err| format!("Nao foi possivel criar {}: {err}", directory.display()))?;

    materialize_action_settings(&directory, config, action)?;

    let script_path = directory.join(format!(
        "arizona-{}.{}",
        action.script_key(),
        action_script_extension()
    ));
    let script = action_script(action);
    let should_write = fs::read_to_string(&script_path)
        .map(|current| current != script)
        .unwrap_or(true);

    if should_write {
        fs::write(&script_path, script.as_bytes())
            .map_err(|err| format!("Nao foi possivel gravar {}: {err}", script_path.display()))?;
    }

    Ok(script_path)
}

fn action_script_directory(
    root_directory: &Path,
    config: &AppConfig,
    action: AfterEffectsAction,
) -> PathBuf {
    let identity = match action {
        AfterEffectsAction::ExportPrintFrames => config.export_print_comp_name.clone(),
        AfterEffectsAction::Render => format!(
            "{}:{}|{}:{}",
            config.render_mov_template_name.len(),
            config.render_mov_template_name,
            config.render_mp4_template_name.len(),
            config.render_mp4_template_name
        ),
        _ => return root_directory.to_path_buf(),
    };
    let digest = format!("{:x}", Sha256::digest(identity.as_bytes()));

    root_directory.join(format!("{}-{}", action.script_key(), &digest[..16]))
}

fn materialize_action_settings(
    directory: &Path,
    config: &AppConfig,
    action: AfterEffectsAction,
) -> Result<(), String> {
    let settings = match action {
        AfterEffectsAction::ExportPrintFrames => vec![(
            EXPORT_PRINT_COMP_NAME_FILE,
            config.export_print_comp_name.as_str(),
        )],
        AfterEffectsAction::Render => vec![
            (
                RENDER_MOV_TEMPLATE_NAME_FILE,
                config.render_mov_template_name.as_str(),
            ),
            (
                RENDER_MP4_TEMPLATE_NAME_FILE,
                config.render_mp4_template_name.as_str(),
            ),
        ],
        _ => Vec::new(),
    };

    for (file_name, value) in settings {
        let path = directory.join(file_name);
        let should_write = fs::read_to_string(&path)
            .map(|current| current != value)
            .unwrap_or(true);
        if should_write {
            fs::write(&path, value.as_bytes())
                .map_err(|err| format!("Nao foi possivel gravar {}: {err}", path.display()))?;
        }
    }

    Ok(())
}

#[cfg(debug_assertions)]
fn action_script(action: AfterEffectsAction) -> String {
    EMBEDDED_ACTION_SCRIPT.replacen(ACTION_PLACEHOLDER, action.script_key(), 1)
}

#[cfg(not(debug_assertions))]
fn action_script(action: AfterEffectsAction) -> String {
    match action {
        AfterEffectsAction::MoveLayersBackward => MOVE_LAYERS_BACKWARD_SCRIPT,
        AfterEffectsAction::MoveLayersForward => MOVE_LAYERS_FORWARD_SCRIPT,
        AfterEffectsAction::MoveJumpMarker => MOVE_JUMP_MARKER_SCRIPT,
        AfterEffectsAction::SelectJumpMarkerLayer => SELECT_JUMP_MARKER_LAYER_SCRIPT,
        AfterEffectsAction::AdjustMarkersToTail => ADJUST_MARKERS_TO_TAIL_SCRIPT,
        AfterEffectsAction::SwapLayers => SWAP_LAYERS_SCRIPT,
        AfterEffectsAction::ExportPrintFrames => EXPORT_PRINT_FRAMES_SCRIPT,
        AfterEffectsAction::Render => RENDER_SCRIPT,
    }
    .to_string()
}

fn action_script_extension() -> &'static str {
    if cfg!(debug_assertions) {
        "jsx"
    } else {
        "jsxbin"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn maps_public_and_legacy_action_keys() {
        assert_eq!(
            action_from_key("moveLayersBackward"),
            Some(AfterEffectsAction::MoveLayersBackward)
        );
        assert_eq!(
            action_from_key("move_layers_to_markers"),
            Some(AfterEffectsAction::MoveLayersForward)
        );
        assert_eq!(
            action_from_key("queueRender"),
            Some(AfterEffectsAction::Render)
        );
        assert_eq!(
            action_from_key("troca_layers"),
            Some(AfterEffectsAction::SwapLayers)
        );
        assert_eq!(
            action_from_key("export_print_frames"),
            Some(AfterEffectsAction::ExportPrintFrames)
        );
        assert_eq!(action_from_key("unknown"), None);
    }

    #[test]
    fn embeds_the_selected_action_without_leaving_the_placeholder() {
        let script = action_script(AfterEffectsAction::AdjustMarkersToTail);

        assert!(script.contains("var action = \"adjust_markers_to_tail\";"));
        assert!(!script.contains(ACTION_PLACEHOLDER));
        assert!(script.contains("function adjustTimelineMarkersToTail()"));
        assert!(script.contains("function swapSelectedLayers()"));
        assert!(script.contains("function exportPrintFrames()"));
        assert!(script.contains("export-print-comp-name.txt"));
        assert!(script.contains("render-mov-template-name.txt"));
        assert!(script.contains("render-mp4-template-name.txt"));
        assert!(script.contains("getCompByName(exportCompName)"));
        assert!(script.contains("exportComp.saveFrameToPng"));
        assert!(!script.contains("projeto.activeItem.saveFrameToPng"));
        assert!(script.contains("function queueRenderOutputs()"));
    }

    #[test]
    fn configurable_actions_use_directories_isolated_by_their_settings() {
        let root = PathBuf::from("after-effects-scripts");
        let default_config = AppConfig::default();
        let mut custom_config = default_config.clone();
        custom_config.export_print_comp_name = "PRINT_CUSTOM".to_string();
        custom_config.render_mov_template_name = "MOV CUSTOM".to_string();

        assert_eq!(
            action_script_directory(
                &root,
                &default_config,
                AfterEffectsAction::MoveLayersBackward
            ),
            root
        );
        assert_ne!(
            action_script_directory(
                &root,
                &default_config,
                AfterEffectsAction::ExportPrintFrames
            ),
            action_script_directory(&root, &custom_config, AfterEffectsAction::ExportPrintFrames)
        );
        assert_ne!(
            action_script_directory(&root, &default_config, AfterEffectsAction::Render),
            action_script_directory(&root, &custom_config, AfterEffectsAction::Render)
        );
    }

    #[test]
    fn materializes_only_the_settings_needed_by_each_action() {
        let directory = unique_test_directory("action-settings");
        fs::create_dir_all(&directory).unwrap();
        let mut config = AppConfig::default();
        config.export_print_comp_name = "IMPRESSÃO_Ç".to_string();
        config.render_mov_template_name = "MOV ÁGIL".to_string();
        config.render_mp4_template_name = "MP4 MÍDIA".to_string();

        materialize_action_settings(&directory, &config, AfterEffectsAction::ExportPrintFrames)
            .unwrap();
        assert_eq!(
            fs::read_to_string(directory.join(EXPORT_PRINT_COMP_NAME_FILE)).unwrap(),
            "IMPRESSÃO_Ç"
        );
        assert!(!directory.join(RENDER_MOV_TEMPLATE_NAME_FILE).exists());
        assert!(!directory.join(RENDER_MP4_TEMPLATE_NAME_FILE).exists());

        materialize_action_settings(&directory, &config, AfterEffectsAction::Render).unwrap();
        assert_eq!(
            fs::read_to_string(directory.join(RENDER_MOV_TEMPLATE_NAME_FILE)).unwrap(),
            "MOV ÁGIL"
        );
        assert_eq!(
            fs::read_to_string(directory.join(RENDER_MP4_TEMPLATE_NAME_FILE)).unwrap(),
            "MP4 MÍDIA"
        );

        fs::remove_dir_all(directory).unwrap();

        let unrelated_directory = unique_test_directory("action-settings-unrelated");
        fs::create_dir_all(&unrelated_directory).unwrap();
        materialize_action_settings(
            &unrelated_directory,
            &config,
            AfterEffectsAction::MoveLayersBackward,
        )
        .unwrap();
        assert_eq!(fs::read_dir(&unrelated_directory).unwrap().count(), 0);
        fs::remove_dir_all(unrelated_directory).unwrap();
    }

    #[test]
    fn detects_after_effects_in_tasklist_csv_output() {
        let output = "\"AfterFX.exe\",\"24840\",\"Console\",\"1\",\"1.024.000 K\"\r\n";

        assert!(tasklist_contains_after_effects(output));
        assert!(!tasklist_contains_after_effects(
            "INFO: No tasks are running which match the specified criteria."
        ));
    }

    #[test]
    fn debug_build_materializes_readable_jsx() {
        assert_eq!(action_script_extension(), "jsx");
    }

    #[test]
    fn lists_only_installed_four_digit_after_effects_versions() {
        let root = unique_test_directory("versions");
        let installed_2025 = executable_for_version(&root, "2025");
        let installed_2026 = executable_for_version(&root, "2026");
        let invalid = executable_for_version(&root, "Beta");
        fs::create_dir_all(installed_2025.parent().unwrap()).unwrap();
        fs::create_dir_all(installed_2026.parent().unwrap()).unwrap();
        fs::create_dir_all(invalid.parent().unwrap()).unwrap();
        fs::write(&installed_2025, b"").unwrap();
        fs::write(&installed_2026, b"").unwrap();
        fs::write(&invalid, b"").unwrap();

        assert_eq!(
            installed_versions_in_roots(&[root.clone()]),
            vec!["2026".to_string(), "2025".to_string()]
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_configured_version_before_latest_fallback() {
        let root = unique_test_directory("configured");
        let configured = executable_for_version(&root, "2025");
        let latest = executable_for_version(&root, "2026");
        fs::create_dir_all(configured.parent().unwrap()).unwrap();
        fs::create_dir_all(latest.parent().unwrap()).unwrap();
        fs::write(&configured, b"").unwrap();
        fs::write(&latest, b"").unwrap();

        assert_eq!(
            resolve_executable_in_roots("2025", &[root.clone()]),
            configured
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn falls_back_to_the_latest_installed_version() {
        let root = unique_test_directory("fallback");
        let older = executable_for_version(&root, "2025");
        let latest = executable_for_version(&root, "2026");
        fs::create_dir_all(older.parent().unwrap()).unwrap();
        fs::create_dir_all(latest.parent().unwrap()).unwrap();
        fs::write(&older, b"").unwrap();
        fs::write(&latest, b"").unwrap();

        assert_eq!(resolve_executable_in_roots("2024", &[root.clone()]), latest);

        fs::remove_dir_all(root).unwrap();
    }

    fn unique_test_directory(name: &str) -> PathBuf {
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!(
            "arizona_after_effects_{name}_{}_{}",
            std::process::id(),
            epoch
        ))
    }
}
