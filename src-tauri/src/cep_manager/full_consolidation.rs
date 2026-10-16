//! The elevated Full installer never touches user profiles. Its verified
//! machine receipt lets the normal desktop process retire its own old copy.
use super::*;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use tauri::Emitter;

const SUCCESS_MARKER: &str = "FULL CEP commit verified";
const EVENT_NAME: &str = "arizona-cep:consolidation-changed";
static STATE: Mutex<ConsolidationStatus> = Mutex::new(ConsolidationStatus {
    state: ConsolidationState::Idle,
    failure_code: None,
});
static WORKER_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ConsolidationStatus {
    state: ConsolidationState,
    failure_code: Option<&'static str>,
}

// Only enumerated, static codes cross the diagnostic/UI boundary. Original
// errors can contain profile paths and are never retained in this state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ConsolidationFailure {
    code: &'static str,
    retryable: bool,
}

impl ConsolidationFailure {
    fn transient(code: &'static str) -> Self {
        Self {
            code,
            retryable: true,
        }
    }

    fn blocked(code: &'static str) -> Self {
        Self {
            code,
            retryable: false,
        }
    }
}

struct WorkerLease<'a>(&'a AtomicBool);

impl<'a> WorkerLease<'a> {
    fn acquire(active: &'a AtomicBool) -> Option<Self> {
        active
            .compare_exchange(false, true, AtomicOrdering::AcqRel, AtomicOrdering::Acquire)
            .ok()
            .map(|_| Self(active))
    }
}

impl Drop for WorkerLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, AtomicOrdering::Release);
    }
}

// Three failed attempts at most per run. Waiting for After is separate and
// does not consume this budget. An explicit retry starts a new budget.
fn failure_retry_delay(failure_count: u8, retryable: bool) -> Option<std::time::Duration> {
    if !retryable {
        return None;
    }
    match failure_count {
        1 => Some(std::time::Duration::from_secs(5)),
        2 => Some(std::time::Duration::from_secs(15)),
        _ => None,
    }
}

#[derive(Default)]
struct RetryPolicy {
    failures: u8,
}

impl RetryPolicy {
    fn next_delay(
        &mut self,
        result: &Result<ConsolidationState, ConsolidationFailure>,
    ) -> Option<std::time::Duration> {
        match result {
            Ok(ConsolidationState::WaitingForAfterEffects) => {
                Some(std::time::Duration::from_secs(15))
            }
            Err(failure) => {
                self.failures = self.failures.saturating_add(1);
                failure_retry_delay(self.failures, failure.retryable)
            }
            Ok(_) => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConsolidationState {
    Idle,
    Checking,
    WaitingForAfterEffects,
    Completed,
    PreservedNewerUser,
    Blocked,
}

impl ConsolidationState {
    fn key(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Checking => "checking",
            Self::WaitingForAfterEffects => "waitingForAfterEffects",
            Self::Completed => "completed",
            Self::PreservedNewerUser => "preservedNewerUser",
            Self::Blocked => "blocked",
        }
    }
}

pub(super) fn status() -> &'static str {
    STATE
        .lock()
        .map(|snapshot| snapshot.state.key())
        .unwrap_or("blocked")
}

pub(super) fn failure_code() -> Option<&'static str> {
    STATE
        .lock()
        .map(|snapshot| snapshot.failure_code)
        .unwrap_or(Some("cep_consolidation_state_unavailable"))
}

fn publish(app: &tauri::AppHandle, state: ConsolidationState, failure_code: Option<&'static str>) {
    let next = ConsolidationStatus {
        state,
        failure_code,
    };
    let changed = if let Ok(mut current) = STATE.lock() {
        if *current == next {
            false
        } else {
            *current = next;
            true
        }
    } else {
        false
    };
    if !changed {
        return;
    }
    let _ = app.emit(EVENT_NAME, state.key());
    let message = match state {
        ConsolidationState::Idle | ConsolidationState::Checking => return,
        ConsolidationState::WaitingForAfterEffects => "Consolidação da extensão adiada até o After Effects fechar.",
        ConsolidationState::Completed => "Cópia normal da extensão do perfil consolidada após verificar a instalação selecionada.",
        ConsolidationState::PreservedNewerUser => "Cópia mais nova da extensão no perfil preservada.",
        ConsolidationState::Blocked => "Consolidação automática da extensão com finalização pendente; confira o estado local.",
    };
    // No paths, profile names, license information or native project data.
    crate::diagnostics::info(
        app,
        "extensao",
        "consolidar_full",
        state.key(),
        message,
        None,
    );
}

pub fn start_full_consolidation(app: &tauri::AppHandle) {
    let _ = retry_full_consolidation(app);
}

// Starting a worker never authorizes an installation or bypasses verification.
// The caller can expose this through an authenticated, explicit retry command.
pub fn retry_full_consolidation(app: &tauri::AppHandle) -> Result<bool, String> {
    // Development must never clean the operator's installations merely because
    // a repository happens to contain a previous Full payload or receipt.
    if cfg!(debug_assertions) || !cfg!(windows) {
        return Ok(false);
    }
    let Some(worker_lease) = WorkerLease::acquire(&WORKER_ACTIVE) else {
        return Ok(false);
    };
    let app = app.clone();
    let failure_app = app.clone();
    publish(&app, ConsolidationState::Checking, None);
    if std::thread::Builder::new()
        .name("arizona-cep-consolidation".into())
        .spawn(move || {
            let _worker_lease = worker_lease;
            let mut retry_policy = RetryPolicy::default();
            loop {
                // This always takes a fresh inventory and rereads the receipt;
                // no path, version or native process state survives a retry.
                let result = attempt_for_app(&app);
                let delay = retry_policy.next_delay(&result);
                match result {
                    Ok(state) => {
                        publish(&app, state, None);
                        if let Some(delay) = delay {
                            std::thread::sleep(delay);
                        } else {
                            break;
                        }
                    }
                    Err(failure) => {
                        crate::diagnostics::warning(
                            &app,
                            "extensao",
                            "consolidar_full",
                            if delay.is_some() { "retrying" } else { "blocked" },
                            failure.code,
                            "A consolidação da extensão não foi concluída nesta tentativa.",
                            Some(serde_json::json!({ "attempt": retry_policy.failures, "willRetry": delay.is_some() })),
                        );
                        if let Some(delay) = delay {
                            publish(&app, ConsolidationState::Checking, Some(failure.code));
                            std::thread::sleep(delay);
                        } else {
                            publish(&app, ConsolidationState::Blocked, Some(failure.code));
                            break;
                        }
                    }
                }
            }
        })
        .is_err()
    {
        let code = "cep_consolidation_worker_unavailable";
        publish(&failure_app, ConsolidationState::Blocked, Some(code));
        crate::diagnostics::warning(
            &failure_app, "extensao", "consolidar_full", "blocked", code,
            "Não foi possível iniciar a verificação da consolidação da extensão.", None,
        );
        return Err(format!("{code}: Não foi possível iniciar a consolidação da extensão."));
    }
    Ok(true)
}

fn attempt_for_app(app: &tauri::AppHandle) -> Result<ConsolidationState, ConsolidationFailure> {
    let _operation = lock_cep_operation()
        .map_err(|_| ConsolidationFailure::blocked("cep_consolidation_coordination_unavailable"))?;
    let installer_root = app
        .path()
        .resource_dir()
        .map_err(|_| ConsolidationFailure::blocked("cep_consolidation_resources_unavailable"))?
        .join("installer");
    let inventory = cep_installation_inventory()
        .map_err(|_| ConsolidationFailure::transient("cep_consolidation_inventory_unavailable"))?;
    let pending_path = app
        .path()
        .app_local_data_dir()
        .map_err(|_| ConsolidationFailure::blocked("cep_consolidation_local_state_unavailable"))?
        .join(pending_consolidation::FILE_NAME);
    let has_pending = match fs::symlink_metadata(&pending_path) {
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => {
            return Err(ConsolidationFailure::transient(
                "cep_consolidation_pending_unavailable",
            ));
        }
    };
    // A committed manual update can temporarily have an unreadable manifest.
    // Its journal must still be checked instead of treating this as no work.
    // Starts with neither evidence nor duplicates avoid signature subprocesses.
    if !has_pending && !has_normal_user_and_machine(&inventory) {
        return Ok(ConsolidationState::Idle);
    }
    if process_is_elevated().map_err(|_| {
        ConsolidationFailure::transient("cep_consolidation_process_identity_unavailable")
    })? {
        return Err(ConsolidationFailure::blocked(
            "cep_consolidation_elevated_process",
        ));
    }
    let verifier = resolve_cep_content_verifier(app)
        .map_err(|_| ConsolidationFailure::transient("cep_consolidation_verifier_unavailable"))?;
    match pending_consolidation::attempt(&pending_path, &inventory, &verifier).map_err(
        |failure| ConsolidationFailure {
            code: failure.code,
            retryable: failure.retryable,
        },
    )? {
        pending_consolidation::Outcome::NotApplicable => {}
        pending_consolidation::Outcome::WaitingForAfterEffects => {
            return Ok(ConsolidationState::WaitingForAfterEffects);
        }
        pending_consolidation::Outcome::Completed => return Ok(ConsolidationState::Completed),
        pending_consolidation::Outcome::PreservedChangedUser => {
            return Err(ConsolidationFailure::blocked(
                "cep_consolidation_user_changed",
            ));
        }
    }
    let result = consolidate_after_full(
        &installer_root,
        &inventory,
        |root, target| verify_full_commit(&verifier, root, target),
        assert_after_effects_is_closed,
    );
    // A process opening during verification/reservation is retryable. The
    // guarded retirement restores the user copy before returning this error.
    if result.is_err()
        && after_effects::is_after_effects_running().map_err(|_| {
            ConsolidationFailure::transient("cep_consolidation_after_process_probe_failed")
        })?
    {
        return Ok(ConsolidationState::WaitingForAfterEffects);
    }
    result
}

fn has_normal_user_and_machine(inventory: &[CepInstallationCandidate]) -> bool {
    let normal = |candidate: &&CepInstallationCandidate| {
        candidate.regular_directory && candidate.status.installed && candidate.status.manifest_valid
    };
    inventory
        .iter()
        .filter(normal)
        .any(|candidate| candidate.status.scope == CEP_SCOPE_PER_USER)
        && inventory
            .iter()
            .filter(normal)
            .any(|candidate| candidate.status.scope == CEP_SCOPE_PER_MACHINE)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FullReceipt {
    schema_version: u32,
    cep: FullReceiptCep,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FullReceiptCep {
    path: String,
    bundle_version: String,
}

fn read_full_receipt(installer_root: &Path) -> Result<Option<FullReceipt>, ConsolidationFailure> {
    let path = installer_root.join("installed-assets.json");
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(ConsolidationFailure::transient(
                "cep_consolidation_receipt_unreadable",
            ))
        }
        Ok(_) => {}
    }
    assert_no_link_ancestors(&path)
        .map_err(|_| ConsolidationFailure::blocked("cep_consolidation_receipt_path_unsafe"))?;
    require_regular_verifier_file(&path, "Full receipt")
        .map_err(|_| ConsolidationFailure::blocked("cep_consolidation_receipt_not_regular"))?;
    if folder_is_junction(&path) {
        return Err(ConsolidationFailure::blocked(
            "cep_consolidation_receipt_path_unsafe",
        ));
    }
    let text = read_file_text_limited(&path, MAX_ZXP_METADATA_BYTES)
        .map_err(|_| ConsolidationFailure::transient("cep_consolidation_receipt_unreadable"))?;
    // Windows PowerShell's UTF-8 writer prefixes the installed Full receipt
    // with a BOM. Accept that encoding without changing the signed resources.
    let json = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let receipt: FullReceipt = serde_json::from_str(json)
        .map_err(|_| ConsolidationFailure::blocked("cep_consolidation_receipt_invalid"))?;
    if receipt.schema_version != 2 || !Path::new(&receipt.cep.path).is_absolute() {
        return Err(ConsolidationFailure::blocked(
            "cep_consolidation_receipt_invalid",
        ));
    }
    parse_cep_semver(&receipt.cep.bundle_version)
        .map_err(|_| ConsolidationFailure::blocked("cep_consolidation_receipt_invalid"))?;
    Ok(Some(receipt))
}

fn consolidate_after_full<V, A>(
    installer_root: &Path,
    inventory: &[CepInstallationCandidate],
    verify: V,
    mut after_closed: A,
) -> Result<ConsolidationState, ConsolidationFailure>
where
    V: FnOnce(&Path, &Path) -> Result<(), ConsolidationFailure>,
    A: FnMut() -> Result<(), String>,
{
    if !has_normal_user_and_machine(inventory) {
        return Ok(ConsolidationState::Idle);
    }
    let Some(receipt) = read_full_receipt(installer_root)? else {
        return Ok(ConsolidationState::Idle);
    };
    let user = inventory
        .iter()
        .find(|candidate| candidate.status.scope == CEP_SCOPE_PER_USER)
        .ok_or(ConsolidationFailure::blocked(
            "cep_consolidation_user_identity_invalid",
        ))?;
    let machine = inventory
        .iter()
        .find(|candidate| {
            candidate.status.scope == CEP_SCOPE_PER_MACHINE
                && candidate.regular_directory
                && candidate.status.manifest_valid
                && windows_path_dedup_key(Path::new(&candidate.status.path))
                    == windows_path_dedup_key(Path::new(&receipt.cep.path))
        })
        .ok_or(ConsolidationFailure::blocked(
            "cep_consolidation_full_target_changed",
        ))?;
    if machine.status.version.as_deref() != Some(receipt.cep.bundle_version.as_str()) {
        return Err(ConsolidationFailure::blocked(
            "cep_consolidation_full_target_changed",
        ));
    }
    let user_version = user
        .semantic_version
        .as_ref()
        .ok_or(ConsolidationFailure::blocked(
            "cep_consolidation_user_identity_invalid",
        ))?;
    let machine_version =
        machine
            .semantic_version
            .as_ref()
            .ok_or(ConsolidationFailure::blocked(
                "cep_consolidation_machine_identity_invalid",
            ))?;
    if user_version.cmp_precedence(machine_version) == Ordering::Greater {
        return Ok(ConsolidationState::PreservedNewerUser);
    }
    if let Err(error) = after_closed() {
        if error.starts_with("after_effects_running:") {
            return Ok(ConsolidationState::WaitingForAfterEffects);
        }
        return Err(ConsolidationFailure::transient(
            "cep_consolidation_after_process_probe_failed",
        ));
    }

    let target = Path::new(&machine.status.path);
    // Freeze existing machine files and its directory against write/delete
    // while the user's copy is retired. The complete hash is checked again
    // after quarantine, so added entries also cause rollback.
    let _machine_leases = read_tree_leases(target)
        .map_err(|_| ConsolidationFailure::transient("cep_consolidation_machine_read_failed"))?;
    let _resource_leases = read_resource_leases(installer_root)
        .map_err(|_| ConsolidationFailure::transient("cep_consolidation_resources_read_failed"))?;
    let machine_digest = installation_tree_digest(target)
        .map_err(|_| ConsolidationFailure::transient("cep_consolidation_machine_digest_failed"))?;
    let consolidation = prepare_user_consolidation(inventory, false)
        .map_err(|_| ConsolidationFailure::transient("cep_consolidation_user_read_failed"))?
        .ok_or(ConsolidationFailure::blocked(
            "cep_consolidation_user_identity_invalid",
        ))?;
    verify(installer_root, target)?;
    let guard_failure = std::cell::Cell::new(None);
    let guard = || {
        let result = (|| {
            after_closed().map_err(|_| {
                ConsolidationFailure::transient("cep_consolidation_after_process_probe_failed")
            })?;
            let actual = installation_tree_digest(target).map_err(|_| {
                ConsolidationFailure::transient("cep_consolidation_machine_digest_failed")
            })?;
            if actual != machine_digest {
                return Err(ConsolidationFailure::blocked(
                    "cep_consolidation_machine_content_changed",
                ));
            }
            let current = inspect_cep_installation(CEP_SCOPE_PER_MACHINE, target);
            if !installation_state_matches(machine, &current) {
                return Err(ConsolidationFailure::blocked(
                    "cep_consolidation_machine_identity_changed",
                ));
            }
            Ok(())
        })();
        result.map_err(|failure: ConsolidationFailure| {
            guard_failure.set(Some(failure));
            failure.code.to_string()
        })
    };
    retire_user_installation_guarded(&consolidation, guard).map_err(|_| {
        if let Some(failure) = guard_failure.get() {
            return failure;
        }
        let user_target = Path::new(&user.status.path);
        let current = inspect_cep_installation(CEP_SCOPE_PER_USER, user_target);
        if current.status.installed {
            let content_changed = consolidation
                .content_digest
                .as_ref()
                .is_some_and(|expected| {
                    installation_tree_digest(user_target).is_ok_and(|actual| &actual != expected)
                });
            if !installation_state_matches(user, &current) || content_changed {
                return ConsolidationFailure::blocked("cep_consolidation_user_changed");
            }
        }
        ConsolidationFailure::transient("cep_consolidation_user_retirement_failed")
    })?;
    Ok(ConsolidationState::Completed)
}

fn read_resource_leases(root: &Path) -> Result<Vec<fs::File>, String> {
    [
        "installed-assets.json",
        "payload/release-manifest.json",
        "payload/cep/com.arizona-carrefour.cep.zxp",
        "cep-trusted-cert.json",
        "scripts/verify-full-cep-commit.ps1",
        "scripts/verify-full-cep-commit-core.ps1",
        "scripts/common.ps1",
        "scripts/cep-system-update-core.ps1",
    ]
    .iter()
    .map(|relative| read_lease(&root.join(relative)))
    .collect()
}

pub(super) fn read_tree_leases(root: &Path) -> Result<Vec<fs::File>, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut leases = Vec::new();
    while let Some(path) = pending.pop() {
        if leases.len() > MAX_ZXP_ENTRIES {
            return Err("machine tree exceeds the file limit".into());
        }
        leases.push(read_lease(&path)?);
        let metadata = fs::symlink_metadata(&path).map_err(|_| "machine tree changed")?;
        if metadata.is_dir() {
            for entry in fs::read_dir(&path).map_err(|_| "machine directory unreadable")? {
                pending.push(entry.map_err(|_| "machine entry unreadable")?.path());
            }
        }
    }
    Ok(leases)
}

fn read_lease(path: &Path) -> Result<fs::File, String> {
    assert_no_link_ancestors(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|_| "consolidation resource unavailable")?;
    if folder_is_junction(path) || (!metadata.is_file() && !metadata.is_dir()) {
        return Err("consolidation resource must be a regular file or directory".into());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ, without WRITE or DELETE; BACKUP_SEMANTICS allows a
        // read-only directory handle and does not enable any backup privilege.
        options.share_mode(1).custom_flags(0x0200_0000);
    }
    options
        .open(path)
        .map_err(|_| "consolidation resource is busy or unreadable".into())
}

fn full_verifier_arguments(root: &Path, target: &Path) -> Result<Vec<OsString>, String> {
    let script = root.join("scripts/verify-full-cep-commit.ps1");
    require_regular_verifier_file(&script, "Full commit verifier")?;
    Ok(vec![
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-File".into(),
        script.into_os_string(),
        "-InstallerRoot".into(),
        root.as_os_str().into(),
        "-TargetPath".into(),
        target.as_os_str().into(),
    ])
}

#[cfg(windows)]
fn verify_full_commit(
    verifier: &CepContentVerifier,
    root: &Path,
    target: &Path,
) -> Result<(), ConsolidationFailure> {
    // Check the publisher against the binary's immutable pin, independently
    // of the resource pin used by the PowerShell cryptographic verifier.
    let package = root.join("payload/cep/com.arizona-carrefour.cep.zxp");
    inspect_zxp_file(&package)
        .map_err(|_| ConsolidationFailure::blocked("cep_consolidation_payload_rejected"))?;
    assert_extracted_tree_is_trusted(target).map_err(|_| {
        ConsolidationFailure::blocked("cep_consolidation_installed_publisher_rejected")
    })?;
    let output = Command::new(&verifier.powershell)
        .args(full_verifier_arguments(root, target).map_err(|_| {
            ConsolidationFailure::transient("cep_consolidation_verifier_unavailable")
        })?)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|_| ConsolidationFailure::transient("cep_consolidation_verifier_start_failed"))?;
    if !output.status.success()
        || !decode_verifier_output(&output.stdout)
            .lines()
            .any(|line| line.trim() == SUCCESS_MARKER)
    {
        return Err(ConsolidationFailure::blocked(
            "cep_consolidation_full_verification_rejected",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn verify_full_commit(
    _: &CepContentVerifier,
    _: &Path,
    _: &Path,
) -> Result<(), ConsolidationFailure> {
    Err(ConsolidationFailure::blocked(
        "cep_consolidation_platform_unsupported",
    ))
}

#[cfg(windows)]
fn process_is_elevated() -> Result<bool, String> {
    use std::ffi::c_void;
    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(process: *mut c_void, access: u32, token: *mut *mut c_void) -> i32;
        fn GetTokenInformation(
            token: *mut c_void,
            class: u32,
            info: *mut c_void,
            size: u32,
            returned: *mut u32,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    let mut token = std::ptr::null_mut();
    // TOKEN_QUERY, TokenElevation. No token or privilege is modified.
    unsafe {
        if OpenProcessToken(GetCurrentProcess(), 8, &mut token) == 0 {
            return Err("process identity unavailable".into());
        }
        let mut elevated = 0u32;
        let mut returned = 0u32;
        let success = GetTokenInformation(
            token,
            20,
            &mut elevated as *mut u32 as *mut c_void,
            4,
            &mut returned,
        );
        CloseHandle(token);
        if success == 0 || returned != 4 {
            return Err("process elevation unavailable".into());
        }
        Ok(elevated != 0)
    }
}

#[cfg(not(windows))]
fn process_is_elevated() -> Result<bool, String> {
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn transient_retries_stop_after_three_failures_and_explicit_retry_starts_fresh() {
        let failure = Err(ConsolidationFailure::transient(
            "cep_consolidation_machine_read_failed",
        ));
        let mut policy = RetryPolicy::default();
        assert_eq!(
            policy.next_delay(&failure),
            Some(std::time::Duration::from_secs(5))
        );
        // Keeping After open does not spend the retry budget.
        for _ in 0..4 {
            assert_eq!(
                policy.next_delay(&Ok(ConsolidationState::WaitingForAfterEffects)),
                Some(std::time::Duration::from_secs(15))
            );
        }
        assert_eq!(policy.failures, 1);
        assert_eq!(
            policy.next_delay(&failure),
            Some(std::time::Duration::from_secs(15))
        );
        assert_eq!(policy.next_delay(&failure), None);
        assert_eq!(policy.failures, 3);
        assert_eq!(
            RetryPolicy::default().next_delay(&failure),
            Some(std::time::Duration::from_secs(5))
        );
        assert_eq!(policy.next_delay(&Ok(ConsolidationState::Completed)), None);
    }

    #[test]
    fn verification_and_identity_rejections_never_retry_automatically() {
        for code in [
            "cep_consolidation_full_verification_rejected",
            "cep_consolidation_elevated_process",
            "cep_consolidation_receipt_invalid",
            "cep_consolidation_full_target_changed",
            "cep_consolidation_user_changed",
        ] {
            let mut policy = RetryPolicy::default();
            assert_eq!(
                policy.next_delay(&Err(ConsolidationFailure::blocked(code))),
                None
            );
            assert_eq!(policy.failures, 1);
        }
    }

    #[test]
    fn worker_is_single_flight_and_a_finished_or_unwound_run_can_be_retried() {
        let active = AtomicBool::new(false);
        let first = WorkerLease::acquire(&active).unwrap();
        std::thread::scope(|scope| {
            let other = scope.spawn(|| WorkerLease::acquire(&active).is_none());
            assert!(other.join().unwrap());
        });
        drop(first);
        assert!(WorkerLease::acquire(&active).is_some());
        let panic = std::panic::catch_unwind(|| {
            let _lease = WorkerLease::acquire(&active).unwrap();
            panic!("fixture worker panic");
        });
        assert!(panic.is_err());
        assert!(WorkerLease::acquire(&active).is_some());
    }

    struct Fixture {
        root: PathBuf,
        installer: PathBuf,
        user: PathBuf,
        machine: PathBuf,
    }
    impl Fixture {
        fn new(user_version: &str) -> Self {
            let root = env::temp_dir().join(format!(
                "arizona-full-consolidation-{}-{}",
                std::process::id(),
                random_suffix()
            ));
            let installer = root.join("application/installer");
            let user = root
                .join("profile/Adobe/CEP/extensions")
                .join(CEP_BUNDLE_ID);
            let machine = root
                .join("machine/Adobe/CEP/extensions")
                .join(CEP_BUNDLE_ID);
            for (path, version) in [(&user, user_version), (&machine, "2.4.0")] {
                fs::create_dir_all(path.join("CSXS")).unwrap();
                fs::write(path.join(MANIFEST_ENTRY), format!(r#"<ExtensionManifest ExtensionBundleId="{CEP_BUNDLE_ID}" ExtensionBundleVersion="{version}"/>"#)).unwrap();
                fs::write(
                    path.join("panel.js"),
                    if path == &user {
                        "old user copy"
                    } else {
                        "verified Full content"
                    },
                )
                .unwrap();
            }
            for relative in [
                "payload/release-manifest.json",
                "payload/cep/com.arizona-carrefour.cep.zxp",
                "cep-trusted-cert.json",
                "scripts/verify-full-cep-commit.ps1",
                "scripts/verify-full-cep-commit-core.ps1",
                "scripts/common.ps1",
                "scripts/cep-system-update-core.ps1",
            ] {
                let path = installer.join(relative);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, "test-only verifier input").unwrap();
            }
            let fixture = Self {
                root,
                installer,
                user,
                machine,
            };
            fixture.receipt(&fixture.machine, "2.4.0");
            fixture
        }
        fn receipt(&self, target: &Path, version: &str) {
            fs::write(self.installer.join("installed-assets.json"), serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 2, "cep": { "path": target, "bundleVersion": version, "zxpSha256": null }
            })).unwrap()).unwrap();
        }
        fn inventory(&self) -> Vec<CepInstallationCandidate> {
            vec![
                inspect_cep_installation(CEP_SCOPE_PER_USER, &self.user),
                inspect_cep_installation(CEP_SCOPE_PER_MACHINE, &self.machine),
            ]
        }
        fn user_content(&self) -> String {
            fs::read_to_string(self.user.join("panel.js")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = remove_install_work_path(&self.root);
        }
    }

    #[test]
    fn full_same_version_verified_commit_removes_only_normal_user_copy() {
        let f = Fixture::new("2.4.0");
        let verified = Cell::new(false);
        let outcome = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |root, machine| {
                assert_eq!(root, f.installer);
                assert_eq!(machine, f.machine);
                assert_eq!(f.user_content(), "old user copy");
                verified.set(true);
                Ok(())
            },
            || Ok(()),
        )
        .unwrap();
        assert_eq!(outcome, ConsolidationState::Completed);
        assert!(verified.get());
        assert!(!f.user.exists());
        assert_eq!(
            fs::read_to_string(f.machine.join("panel.js")).unwrap(),
            "verified Full content"
        );
        assert!(f.installer.join("installed-assets.json").is_file());
    }

    #[test]
    fn windows_powershell_bom_receipt_allows_consolidation_without_rewriting_receipt() {
        let f = Fixture::new("2.4.0");
        let receipt_path = f.installer.join("installed-assets.json");
        let mut powershell_bytes = vec![0xef, 0xbb, 0xbf];
        powershell_bytes.extend(fs::read(&receipt_path).unwrap());
        fs::write(&receipt_path, &powershell_bytes).unwrap();
        assert_eq!(
            consolidate_after_full(&f.installer, &f.inventory(), |_, _| Ok(()), || Ok(())).unwrap(),
            ConsolidationState::Completed
        );
        assert!(!f.user.exists());
        assert!(f.machine.is_dir());
        assert_eq!(fs::read(&receipt_path).unwrap(), powershell_bytes);
    }

    #[test]
    fn absent_full_receipt_and_newer_user_are_preserved_without_verification() {
        let f = Fixture::new("2.5.0");
        let outcome = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| panic!("newer profile must remain"),
            || Ok(()),
        )
        .unwrap();
        assert_eq!(outcome, ConsolidationState::PreservedNewerUser);
        fs::remove_file(f.installer.join("installed-assets.json")).unwrap();
        let outcome = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| panic!("no Full receipt"),
            || Ok(()),
        )
        .unwrap();
        assert_eq!(outcome, ConsolidationState::Idle);
        assert_eq!(f.user_content(), "old user copy");
    }

    #[test]
    fn invalid_full_receipt_target_or_version_never_retires_user() {
        let f = Fixture::new("2.4.0");
        for (target, version) in [(&f.user, "2.4.0"), (&f.machine, "2.5.0")] {
            f.receipt(target, version);
            assert!(consolidate_after_full(
                &f.installer,
                &f.inventory(),
                |_, _| panic!("receipt rejected first"),
                || Ok(())
            )
            .is_err());
            assert_eq!(f.user_content(), "old user copy");
        }
    }

    #[test]
    fn after_open_defers_then_closed_retries_without_touching_native_application() {
        let f = Fixture::new("2.3.0");
        let outcome = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| panic!("After busy"),
            || Err("after_effects_running: After open".into()),
        )
        .unwrap();
        assert_eq!(outcome, ConsolidationState::WaitingForAfterEffects);
        assert_eq!(f.user_content(), "old user copy");
        assert_eq!(
            consolidate_after_full(&f.installer, &f.inventory(), |_, _| Ok(()), || Ok(())).unwrap(),
            ConsolidationState::Completed
        );
    }

    #[test]
    fn cryptographic_rejection_leaves_both_installations_intact() {
        let f = Fixture::new("2.4.0");
        assert!(consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| Err(ConsolidationFailure::blocked(
                "cep_consolidation_full_verification_rejected"
            )),
            || Ok(())
        )
        .is_err());
        assert_eq!(f.user_content(), "old user copy");
        assert!(f.machine.is_dir());
    }

    #[test]
    fn unavailable_process_check_fails_closed_without_claiming_after_is_open() {
        let f = Fixture::new("2.4.0");
        let failure = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| panic!("process inspection failed"),
            || Err("cep_install_failed: private-profile-path-and-sensitive-output".into()),
        )
        .unwrap_err();
        assert_eq!(failure.code, "cep_consolidation_after_process_probe_failed");
        assert!(failure.retryable);
        assert!(!format!("{failure:?}").contains("private-profile"));
        assert_eq!(f.user_content(), "old user copy");
        assert_eq!(
            consolidate_after_full(&f.installer, &f.inventory(), |_, _| Ok(()), || Ok(())).unwrap(),
            ConsolidationState::Completed
        );
    }

    #[test]
    fn retry_rechecks_current_inventory_and_preserves_a_newer_user_copy() {
        let f = Fixture::new("2.4.0");
        let first = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| Ok(()),
            || Err("process check temporarily unavailable".into()),
        )
        .unwrap_err();
        assert!(first.retryable);
        fs::write(f.user.join(MANIFEST_ENTRY), format!(
            r#"<ExtensionManifest ExtensionBundleId="{CEP_BUNDLE_ID}" ExtensionBundleVersion="2.5.0"/>"#
        )).unwrap();
        let current = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| panic!("newer user must be preserved"),
            || Ok(()),
        )
        .unwrap();
        assert_eq!(current, ConsolidationState::PreservedNewerUser);
        assert_eq!(f.user_content(), "old user copy");
    }

    #[test]
    fn malformed_receipt_has_a_stable_nonretryable_code_and_preserves_both_copies() {
        let f = Fixture::new("2.4.0");
        fs::write(
            f.installer.join("installed-assets.json"),
            b"{private receipt details",
        )
        .unwrap();
        let failure = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| panic!("invalid receipt must stop before verification"),
            || Ok(()),
        )
        .unwrap_err();
        assert_eq!(
            failure,
            ConsolidationFailure::blocked("cep_consolidation_receipt_invalid")
        );
        assert_eq!(f.user_content(), "old user copy");
        assert!(f.machine.is_dir());
    }

    #[test]
    fn user_content_changed_during_verification_is_preserved() {
        let f = Fixture::new("2.4.0");
        let failure = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| {
                fs::write(f.user.join("panel.js"), "concurrent edit").unwrap();
                Ok(())
            },
            || Ok(()),
        )
        .unwrap_err();
        assert_eq!(failure.code, "cep_consolidation_user_changed");
        assert!(!failure.retryable);
        assert_eq!(f.user_content(), "concurrent edit");
    }

    #[test]
    fn machine_change_or_sharing_guard_prevents_user_cleanup() {
        let f = Fixture::new("2.4.0");
        assert!(consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| {
                fs::write(f.machine.join("added.js"), "concurrent machine change").map_err(|_| {
                    ConsolidationFailure::blocked("cep_consolidation_machine_content_changed")
                })
            },
            || Ok(())
        )
        .is_err());
        assert_eq!(f.user_content(), "old user copy");
    }

    #[test]
    fn after_opens_after_user_quarantine_rolls_back_before_deletion() {
        let f = Fixture::new("2.4.0");
        let calls = Cell::new(0);
        let result = consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| Ok(()),
            || {
                calls.set(calls.get() + 1);
                if calls.get() == 3 {
                    Err("After opened during retirement".into())
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_err());
        assert_eq!(calls.get(), 3);
        assert_eq!(f.user_content(), "old user copy");
        let work = install_work_root(f.user.parent().unwrap()).unwrap();
        assert_eq!(fs::read_dir(work).unwrap().count(), 0);
    }

    #[test]
    fn verifier_receives_only_separate_read_only_paths() {
        let f = Fixture::new("2.4.0");
        let args = full_verifier_arguments(&f.installer, &f.machine).unwrap();
        assert_eq!(
            args[5],
            f.installer
                .join("scripts/verify-full-cep-commit.ps1")
                .as_os_str()
        );
        assert_eq!(args[7], f.installer.as_os_str());
        assert_eq!(args[9], f.machine.as_os_str());
        assert!(!args
            .iter()
            .any(|arg| arg.to_string_lossy().contains("RunAs")));
    }

    #[cfg(windows)]
    fn junction(link: &Path, target: &Path) {
        let quote = |path: &Path| path.to_string_lossy().replace('\'', "''");
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null",
                    quote(link),
                    quote(target)
                ),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .unwrap();
        assert!(output.status.success(), "junction fixture failed");
    }

    #[test]
    #[cfg(windows)]
    fn user_dev_junction_and_linked_profile_ancestor_are_preserved() {
        let mut f = Fixture::new("2.4.0");
        let actual = f.root.join("development-target");
        fs::rename(&f.user, &actual).unwrap();
        junction(&f.user, &actual);
        assert_eq!(
            consolidate_after_full(
                &f.installer,
                &f.inventory(),
                |_, _| panic!("dev link preserved"),
                || Ok(())
            )
            .unwrap(),
            ConsolidationState::Idle
        );
        assert!(folder_is_junction(&f.user));
        assert_eq!(f.user_content(), "old user copy");
        remove_directory_link(&f.user).unwrap();
        fs::rename(&actual, &f.user).unwrap();
        let profile = f.root.join("profile");
        let alias = f.root.join("profile-link");
        junction(&alias, &profile);
        f.user = alias.join("Adobe/CEP/extensions").join(CEP_BUNDLE_ID);
        assert!(
            consolidate_after_full(&f.installer, &f.inventory(), |_, _| Ok(()), || Ok(())).is_err()
        );
        assert_eq!(f.user_content(), "old user copy");
    }

    #[test]
    #[cfg(windows)]
    fn new_user_dev_junction_during_verification_is_never_removed() {
        let f = Fixture::new("2.4.0");
        let actual = f.root.join("new-development-target");
        assert!(consolidate_after_full(
            &f.installer,
            &f.inventory(),
            |_, _| {
                fs::rename(&f.user, &actual).unwrap();
                junction(&f.user, &actual);
                Ok(())
            },
            || Ok(())
        )
        .is_err());
        assert!(folder_is_junction(&f.user));
        assert_eq!(
            fs::read_to_string(actual.join("panel.js")).unwrap(),
            "old user copy"
        );
    }

    #[test]
    #[cfg(windows)]
    fn machine_read_leases_prevent_existing_file_overwrite_and_root_rename() {
        let f = Fixture::new("2.4.0");
        let leases = read_tree_leases(&f.machine).unwrap();
        assert!(fs::write(f.machine.join("panel.js"), "tampered").is_err());
        assert!(fs::rename(&f.machine, f.root.join("moved-machine")).is_err());
        drop(leases);
        assert_eq!(
            fs::read_to_string(f.machine.join("panel.js")).unwrap(),
            "verified Full content"
        );
    }
}
