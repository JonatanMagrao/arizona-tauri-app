//! A manual update can commit successfully before its old profile copy can be
//! retired. Keep the exact committed tree and profile baseline, independently
//! of the older Full payload. This record is never a cryptographic authority.
use super::*;
use serde::{Deserialize, Serialize};
use std::io::Write;

pub(super) const FILE_NAME: &str = "cep-pending-consolidation.json";
const RECORD_LIMIT: u64 = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Outcome {
    NotApplicable,
    WaitingForAfterEffects,
    Completed,
    PreservedChangedUser,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Failure {
    pub(super) code: &'static str,
    pub(super) retryable: bool,
}

impl Failure {
    fn invalid() -> Self {
        Self {
            code: "cep_consolidation_pending_invalid",
            retryable: false,
        }
    }
    fn unavailable() -> Self {
        Self {
            code: "cep_consolidation_pending_unavailable",
            retryable: true,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    schema_version: u32,
    state: CommitState,
    target_path: PathBuf,
    bundle_version: String,
    signature_digest: String,
    user_path: PathBuf,
    user_digest: String,
    user_manifest_modified: Option<String>,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CommitState {
    Prepared,
    Committed,
}

fn modified_key(value: Option<SystemTime>) -> Option<String> {
    value
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos().to_string())
}

fn check_record_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.file_name().and_then(|name| name.to_str()) != Some(FILE_NAME) {
        return Err("unexpected pending consolidation record path".into());
    }
    assert_no_link_ancestors(path)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !folder_is_junction(path) => Ok(()),
        Ok(_) => Err("pending consolidation record must be an ordinary file".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("pending consolidation record is unavailable".into()),
    }
}

fn prepare_record_parent(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.file_name().and_then(|name| name.to_str()) != Some(FILE_NAME) {
        return Err("unexpected pending consolidation record path".into());
    }
    let parent = path
        .parent()
        .ok_or("pending consolidation directory absent")?;
    for ancestor in parent.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if metadata.is_dir() && !folder_is_junction(ancestor) => {}
            Ok(_) => return Err("pending consolidation parent is not an ordinary directory".into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return Err("pending consolidation parent is unavailable".into()),
        }
    }
    fs::create_dir_all(parent).map_err(|_| "pending consolidation directory unavailable")?;
    check_record_path(path)
}

/// Persist intent before elevation. Keep the original user baseline even if the
/// user changes it during UAC; such a change must later block automatic cleanup.
pub(super) fn prepare(
    path: &Path,
    plan: &CepInstallPlan,
    package: &CepZxpInfo,
    signature_digest: &str,
    consolidation: &CepUserConsolidation,
) -> Result<(), String> {
    let expected = &consolidation.expected;
    if plan.scope != CEP_SCOPE_PER_MACHINE
        || expected.status.scope != CEP_SCOPE_PER_USER
        || !expected.regular_directory
        || expected.status.is_dev_link
        || package.bundle_id != CEP_BUNDLE_ID
        || !package.signed
        || !package.trusted
        || !digest_valid(signature_digest)
    {
        return Err(
            "pending consolidation requires a verified machine commit and normal user copy".into(),
        );
    }
    let user_digest = consolidation
        .content_digest
        .as_ref()
        .ok_or("user baseline digest absent")?;
    let pending = Pending {
        schema_version: 2,
        state: CommitState::Prepared,
        target_path: plan.target.clone(),
        bundle_version: package.version.clone(),
        signature_digest: signature_digest.to_owned(),
        user_path: PathBuf::from(&expected.status.path),
        user_digest: user_digest.clone(),
        user_manifest_modified: modified_key(expected.manifest_modified),
    };
    persist(path, &pending)
}

/// A successful helper exit confirms the transaction, but is not enough to
/// delete anything. The retry still verifies the signature and installed tree.
pub(super) fn mark_committed(path: &Path) -> Result<(), String> {
    let Loaded {
        mut pending,
        _lease,
    } = load(path)
        .map_err(|_| "pending consolidation record unavailable for commit")?
        .ok_or("pending consolidation record absent for commit")?;
    drop(_lease);
    pending.state = CommitState::Committed;
    persist(path, &pending)
}

fn persist(path: &Path, pending: &Pending) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(&pending).map_err(|_| "pending consolidation encoding failed")?;
    if bytes.len() as u64 > RECORD_LIMIT {
        return Err("pending consolidation record too large".into());
    }
    prepare_record_parent(path)?;
    let temporary = path.with_file_name(format!("{FILE_NAME}.tmp-{}", random_suffix()));
    let mut temporary_created = false;
    let result: Result<(), String> = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "pending consolidation staging unavailable")?;
        temporary_created = true;
        file.write_all(&bytes)
            .map_err(|_| "pending consolidation write failed")?;
        file.sync_all()
            .map_err(|_| "pending consolidation flush failed")?;
        drop(file);
        check_record_path(path)?;
        crate::diagnostics::replace_file(&temporary, path)
            .map_err(|_| "pending consolidation atomic replacement failed".to_string())
    })();
    if result.is_err() && temporary_created {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn digest_valid(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn signature_digest(target: &Path) -> Result<String, String> {
    let path = target.join(SIGNATURES_ENTRY);
    assert_no_link_ancestors(&path)?;
    require_regular_verifier_file(&path, "installed CEP signature")?;
    if folder_is_junction(&path) {
        return Err("installed CEP signature is a link".into());
    }
    let file = fs::File::open(&path).map_err(|_| "installed CEP signature unavailable")?;
    let mut bytes = Vec::new();
    file.take(MAX_ZXP_METADATA_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "installed CEP signature unreadable")?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_ZXP_METADATA_BYTES {
        return Err("installed CEP signature has an invalid length".into());
    }
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

/// Removes only this exact metadata file; never a directory or a link target.
pub(super) fn clear(path: &Path) -> Result<(), String> {
    // A fresh installation may not have the app data directory yet.
    if let Some(parent) = path.parent() {
        if !parent.exists()
            && path.is_absolute()
            && path.file_name().and_then(|name| name.to_str()) == Some(FILE_NAME)
        {
            return Ok(());
        }
    }
    check_record_path(path)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("pending consolidation record cleanup failed".into()),
    }
}

struct Loaded {
    pending: Pending,
    // Prevent another process from rewriting/removing the baseline mid-retire.
    _lease: fs::File,
}

fn load(path: &Path) -> Result<Option<Loaded>, Failure> {
    if !path.is_absolute() || path.file_name().and_then(|name| name.to_str()) != Some(FILE_NAME) {
        return Err(Failure::invalid());
    }
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Failure::unavailable()),
        Ok(_) => {}
    }
    check_record_path(path).map_err(|_| Failure::invalid())?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1).custom_flags(0x0020_0000); // OPEN_REPARSE_POINT
    }
    let mut lease = options.open(path).map_err(|_| Failure::unavailable())?;
    let metadata = lease.metadata().map_err(|_| Failure::unavailable())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(Failure::invalid());
        }
    }
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > RECORD_LIMIT {
        return Err(Failure::invalid());
    }
    let mut bytes = Vec::new();
    (&mut lease)
        .take(RECORD_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Failure::unavailable())?;
    if bytes.len() as u64 > RECORD_LIMIT {
        return Err(Failure::invalid());
    }
    let pending: Pending = serde_json::from_slice(&bytes).map_err(|_| Failure::invalid())?;
    if pending.schema_version != 2
        || !pending.target_path.is_absolute()
        || !pending.user_path.is_absolute()
        || !digest_valid(&pending.signature_digest)
        || !digest_valid(&pending.user_digest)
        || parse_cep_semver(&pending.bundle_version).is_err()
    {
        return Err(Failure::invalid());
    }
    Ok(Some(Loaded {
        pending,
        _lease: lease,
    }))
}

pub(super) fn attempt(
    path: &Path,
    inventory: &[CepInstallationCandidate],
    verifier: &CepContentVerifier,
) -> Result<Outcome, Failure> {
    attempt_with(
        path,
        inventory,
        |target| {
            assert_extracted_tree_is_trusted(target)?;
            assert_extracted_debug_file(target)?;
            verify_cep_content_signature(verifier, CepContentTarget::Directory(target))
        },
        assert_after_effects_is_closed,
    )
}

fn attempt_with<V, A>(
    path: &Path,
    inventory: &[CepInstallationCandidate],
    verify: V,
    mut after_closed: A,
) -> Result<Outcome, Failure>
where
    V: FnOnce(&Path) -> Result<(), String>,
    A: FnMut() -> Result<(), String>,
{
    let Some(loaded) = load(path)? else {
        return Ok(Outcome::NotApplicable);
    };
    let pending = &loaded.pending;
    if pending.state == CommitState::Prepared {
        return Err(Failure {
            code: "cep_consolidation_commit_unconfirmed",
            retryable: false,
        });
    }
    let known = |scope: &str, target: &Path| {
        inventory.iter().any(|candidate| {
            candidate.status.scope == scope
                && windows_path_dedup_key(Path::new(&candidate.status.path))
                    == windows_path_dedup_key(target)
        })
    };
    if !known(CEP_SCOPE_PER_USER, &pending.user_path)
        || !known(CEP_SCOPE_PER_MACHINE, &pending.target_path)
    {
        return Err(Failure::invalid());
    }
    // An unreadable path is not an absent installation. Recheck the probe
    // because the inventory may have been captured before its ACL changed.
    assert_inventory_target_probe(&pending.user_path, fs::symlink_metadata(&pending.user_path))
        .map_err(|_| Failure::unavailable())?;
    let user = inspect_cep_installation(CEP_SCOPE_PER_USER, &pending.user_path);
    if !user.status.installed {
        drop(loaded);
        clear(path).map_err(|_| Failure::unavailable())?;
        return Ok(Outcome::Completed);
    }
    // Leave the record as a tombstone. A later startup must not fall back to an
    // older Full receipt and remove a new user install or a development link.
    if !user.regular_directory
        || user.status.is_dev_link
        || modified_key(user.manifest_modified) != pending.user_manifest_modified
    {
        return Ok(Outcome::PreservedChangedUser);
    }
    let user_digest =
        installation_tree_digest(&pending.user_path).map_err(|_| Failure::unavailable())?;
    if user_digest != pending.user_digest {
        return Ok(Outcome::PreservedChangedUser);
    }
    assert_inventory_target_probe(
        &pending.target_path,
        fs::symlink_metadata(&pending.target_path),
    )
    .map_err(|_| Failure::unavailable())?;
    let machine = inspect_cep_installation(CEP_SCOPE_PER_MACHINE, &pending.target_path);
    if !machine.regular_directory || !machine.status.manifest_valid {
        return Err(Failure {
            code: "cep_consolidation_machine_busy",
            retryable: true,
        });
    }
    if machine.status.version.as_deref() != Some(pending.bundle_version.as_str()) {
        drop(loaded);
        clear(path).map_err(|_| Failure::unavailable())?;
        return Ok(Outcome::NotApplicable);
    }
    let current_signature =
        signature_digest(&pending.target_path).map_err(|_| Failure::unavailable())?;
    if current_signature != pending.signature_digest {
        drop(loaded);
        clear(path).map_err(|_| Failure::unavailable())?;
        return Ok(Outcome::NotApplicable);
    }
    if let Err(error) = after_closed() {
        if error.starts_with("after_effects_running:") {
            return Ok(Outcome::WaitingForAfterEffects);
        }
        return Err(Failure {
            code: "cep_consolidation_process_check_failed",
            retryable: true,
        });
    }
    let _machine_leases =
        full_consolidation::read_tree_leases(&pending.target_path).map_err(|_| Failure {
            code: "cep_consolidation_machine_busy",
            retryable: true,
        })?;
    // Check again after leasing, before the verifier or any retirement.
    if signature_digest(&pending.target_path).map_err(|_| Failure::unavailable())?
        != pending.signature_digest
    {
        return Err(Failure {
            code: "cep_consolidation_machine_changed",
            retryable: false,
        });
    }
    let machine_digest =
        installation_tree_digest(&pending.target_path).map_err(|_| Failure::unavailable())?;
    verify(&pending.target_path).map_err(|_| Failure {
        code: "cep_consolidation_signature_invalid",
        retryable: false,
    })?;
    let consolidation = CepUserConsolidation {
        expected: user,
        content_digest: Some(user_digest),
    };
    let guard = || {
        after_closed()?;
        let current_machine = inspect_cep_installation(CEP_SCOPE_PER_MACHINE, &pending.target_path);
        if !installation_state_matches(&machine, &current_machine)
            || installation_tree_digest(&pending.target_path)? != machine_digest
        {
            return Err("cep_consolidation_machine_changed".into());
        }
        Ok(())
    };
    if let Err(error) = retire_user_installation_guarded(&consolidation, guard) {
        if error.contains("after_effects_running:") {
            return Ok(Outcome::WaitingForAfterEffects);
        }
        if error.contains("cep_consolidation_machine_changed") {
            return Err(Failure {
                code: "cep_consolidation_machine_changed",
                retryable: false,
            });
        }
        let current_user = inspect_cep_installation(CEP_SCOPE_PER_USER, &pending.user_path);
        if current_user.status.installed
            && (!installation_state_matches(&consolidation.expected, &current_user)
                || installation_tree_digest(&pending.user_path)
                    .is_ok_and(|digest| digest != pending.user_digest))
        {
            return Ok(Outcome::PreservedChangedUser);
        }
        return Err(Failure {
            code: "cep_consolidation_user_busy",
            retryable: true,
        });
    }
    drop(loaded);
    clear(path).map_err(|_| Failure::unavailable())?;
    Ok(Outcome::Completed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct Fixture {
        root: PathBuf,
        path: PathBuf,
        user: PathBuf,
        machine: PathBuf,
    }
    impl Fixture {
        fn new(user_version: &str, machine_version: &str) -> Self {
            let root = env::temp_dir().join(format!(
                "arizona-pending-{}-{}",
                std::process::id(),
                random_suffix()
            ));
            let user = root
                .join("profile/Adobe/CEP/extensions")
                .join(CEP_BUNDLE_ID);
            let machine = root
                .join("machine/Adobe/CEP/extensions")
                .join(CEP_BUNDLE_ID);
            for (target, version) in [(&user, user_version), (&machine, machine_version)] {
                fs::create_dir_all(target.join("CSXS")).unwrap();
                fs::write(target.join(MANIFEST_ENTRY), format!(r#"<ExtensionManifest ExtensionBundleId="{CEP_BUNDLE_ID}" ExtensionBundleVersion="{version}"/>"#)).unwrap();
                fs::create_dir_all(target.join("META-INF")).unwrap();
                fs::write(
                    target.join(SIGNATURES_ENTRY),
                    format!("test-only signature for {version}"),
                )
                .unwrap();
                fs::write(
                    target.join("panel.js"),
                    if target == &user { "old" } else { "latest" },
                )
                .unwrap();
            }
            let path = root.join("app-data").join(FILE_NAME);
            let fixture = Self {
                root,
                path,
                user,
                machine,
            };
            fixture.record(machine_version);
            fixture
        }
        fn inventory(&self) -> Vec<CepInstallationCandidate> {
            vec![
                inspect_cep_installation(CEP_SCOPE_PER_USER, &self.user),
                inspect_cep_installation(CEP_SCOPE_PER_MACHINE, &self.machine),
            ]
        }
        fn record(&self, version: &str) {
            self.prepare(version);
            mark_committed(&self.path).unwrap();
        }
        fn prepare(&self, version: &str) {
            prepare(
                &self.path,
                &CepInstallPlan {
                    scope: CEP_SCOPE_PER_MACHINE.into(),
                    target: self.machine.clone(),
                },
                &CepZxpInfo {
                    bundle_id: CEP_BUNDLE_ID.into(),
                    version: version.into(),
                    signed: true,
                    trusted: true,
                },
                &signature_digest(&self.machine).unwrap(),
                &prepare_user_consolidation(&self.inventory(), false)
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
        }
        fn attempt(&self) -> Result<Outcome, Failure> {
            attempt_with(&self.path, &self.inventory(), |_| Ok(()), || Ok(()))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = remove_install_work_path(&self.root);
        }
    }

    #[test]
    fn latest_manual_new_version_and_confirmed_downgrade_retire_only_expected_user() {
        for (user, machine) in [("2.4.0", "2.4.2"), ("2.5.0", "2.4.1")] {
            let f = Fixture::new(user, machine);
            assert_eq!(f.attempt().unwrap(), Outcome::Completed);
            assert!(!f.user.exists());
            assert!(!f.path.exists());
            assert_eq!(
                fs::read_to_string(f.machine.join("panel.js")).unwrap(),
                "latest"
            );
        }
    }

    #[test]
    fn replacement_record_tracks_same_version_new_bytes_without_full_payload_or_source_zxp() {
        let f = Fixture::new("2.4.1", "2.4.1");
        fs::write(f.machine.join("panel.js"), "reissued package").unwrap();
        fs::write(
            f.machine.join(SIGNATURES_ENTRY),
            "reissued signed references",
        )
        .unwrap();
        f.record("2.4.1");
        assert_eq!(f.attempt().unwrap(), Outcome::Completed);
        assert_eq!(
            fs::read_to_string(f.machine.join("panel.js")).unwrap(),
            "reissued package"
        );
    }

    #[test]
    fn prepared_intent_never_authorizes_retirement_or_full_fallback() {
        let f = Fixture::new("2.4.0", "2.4.1");
        f.prepare("2.4.1");
        let error = f.attempt().unwrap_err();
        assert_eq!(error.code, "cep_consolidation_commit_unconfirmed");
        assert!(!error.retryable);
        assert!(f.path.exists());
        assert!(f.user.exists());
        mark_committed(&f.path).unwrap();
        assert_eq!(f.attempt().unwrap(), Outcome::Completed);
    }

    #[test]
    fn prepare_and_commit_never_absorb_a_changed_user_baseline() {
        let f = Fixture::new("2.4.0", "2.4.1");
        let baseline = prepare_user_consolidation(&f.inventory(), false)
            .unwrap()
            .unwrap();
        fs::write(f.user.join("panel.js"), "user changed before prepare").unwrap();
        prepare(
            &f.path,
            &CepInstallPlan {
                scope: CEP_SCOPE_PER_MACHINE.into(),
                target: f.machine.clone(),
            },
            &CepZxpInfo {
                bundle_id: CEP_BUNDLE_ID.into(),
                version: "2.4.1".into(),
                signed: true,
                trusted: true,
            },
            &signature_digest(&f.machine).unwrap(),
            &baseline,
        )
        .unwrap();
        fs::write(f.user.join("panel.js"), "user changed during UAC").unwrap();
        mark_committed(&f.path).unwrap();
        assert_eq!(f.attempt().unwrap(), Outcome::PreservedChangedUser);
        assert_eq!(
            fs::read_to_string(f.user.join("panel.js")).unwrap(),
            "user changed during UAC"
        );
        assert!(f.path.exists());
    }

    #[test]
    #[cfg(windows)]
    fn confirmed_commit_survives_busy_machine_without_reading_it_until_retry() {
        use std::os::windows::fs::OpenOptionsExt;
        let f = Fixture::new("2.4.0", "2.4.1");
        f.prepare("2.4.1");
        let busy = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(f.machine.join(MANIFEST_ENTRY))
            .unwrap();
        mark_committed(&f.path).unwrap();
        let error = f.attempt().unwrap_err();
        assert!(error.retryable);
        assert!(f.path.exists());
        assert!(f.user.exists());
        drop(busy);
        assert_eq!(f.attempt().unwrap(), Outcome::Completed);
    }

    #[test]
    fn changed_user_keeps_tombstone_even_if_machine_also_changed() {
        let f = Fixture::new("2.4.0", "2.4.1");
        fs::write(f.user.join("panel.js"), "later user install").unwrap();
        fs::write(f.machine.join("panel.js"), "later Full").unwrap();
        assert_eq!(f.attempt().unwrap(), Outcome::PreservedChangedUser);
        assert_eq!(f.attempt().unwrap(), Outcome::PreservedChangedUser);
        assert!(f.path.exists());
        assert_eq!(
            fs::read_to_string(f.user.join("panel.js")).unwrap(),
            "later user install"
        );
    }

    #[test]
    fn user_edit_during_verification_cannot_be_retired_by_an_old_record() {
        let f = Fixture::new("2.4.0", "2.4.1");
        let outcome = attempt_with(
            &f.path,
            &f.inventory(),
            |_| {
                fs::write(f.user.join("panel.js"), "changed during verification").unwrap();
                Ok(())
            },
            || Ok(()),
        )
        .unwrap();
        assert_eq!(outcome, Outcome::PreservedChangedUser);
        assert!(f.path.exists());
        assert_eq!(
            fs::read_to_string(f.user.join("panel.js")).unwrap(),
            "changed during verification"
        );
    }

    #[test]
    fn new_file_during_verification_invalidates_machine_and_preserves_user() {
        let f = Fixture::new("2.4.0", "2.4.1");
        let result = attempt_with(
            &f.path,
            &f.inventory(),
            |_| {
                fs::write(f.machine.join("added.js"), "concurrent change")
                    .map_err(|error| error.to_string())
            },
            || Ok(()),
        );
        assert!(result.is_err());
        assert!(f.user.exists());
        assert!(f.path.exists());
    }

    #[test]
    fn newer_machine_commit_obsoletes_pending_record_and_allows_full_fallback() {
        let f = Fixture::new("2.4.0", "2.4.1");
        fs::write(f.machine.join("panel.js"), "later Full").unwrap();
        fs::write(
            f.machine.join(SIGNATURES_ENTRY),
            "later Full signed references",
        )
        .unwrap();
        assert_eq!(f.attempt().unwrap(), Outcome::NotApplicable);
        assert!(!f.path.exists());
        assert!(f.user.exists());
    }

    #[test]
    fn cryptographic_rejection_never_uses_record_as_authority() {
        let f = Fixture::new("2.4.0", "2.4.1");
        let failure = attempt_with(
            &f.path,
            &f.inventory(),
            |_| Err("signature rejected".into()),
            || Ok(()),
        )
        .unwrap_err();
        assert_eq!(failure.code, "cep_consolidation_signature_invalid");
        assert!(!failure.retryable);
        assert!(f.user.exists());
        assert!(f.path.exists());
    }

    #[test]
    fn after_open_defers_and_opening_during_retirement_restores_user() {
        let f = Fixture::new("2.4.0", "2.4.1");
        assert_eq!(
            attempt_with(
                &f.path,
                &f.inventory(),
                |_| panic!("After open"),
                || Err("after_effects_running: open".into())
            )
            .unwrap(),
            Outcome::WaitingForAfterEffects
        );
        let calls = Cell::new(0);
        assert_eq!(
            attempt_with(
                &f.path,
                &f.inventory(),
                |_| Ok(()),
                || {
                    calls.set(calls.get() + 1);
                    if calls.get() == 3 {
                        Err("after_effects_running: opened".into())
                    } else {
                        Ok(())
                    }
                }
            )
            .unwrap(),
            Outcome::WaitingForAfterEffects
        );
        assert!(f.user.exists());
        assert!(f.path.exists());
        assert_eq!(f.attempt().unwrap(), Outcome::Completed);
    }

    #[test]
    fn invalid_record_unknown_destination_and_deleted_user_are_safe() {
        let f = Fixture::new("2.4.0", "2.4.1");
        let mut data: serde_json::Value =
            serde_json::from_slice(&fs::read(&f.path).unwrap()).unwrap();
        data["targetPath"] = serde_json::json!(f.root.join("unmanaged"));
        fs::write(&f.path, serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(f.attempt().unwrap_err(), Failure::invalid());
        assert!(f.user.exists());
        fs::write(&f.path, "invalid").unwrap();
        assert_eq!(f.attempt().unwrap_err(), Failure::invalid());
        f.record("2.4.1");
        remove_install_work_path(&f.user).unwrap();
        assert_eq!(f.attempt().unwrap(), Outcome::Completed);
        assert!(!f.path.exists());
    }

    #[test]
    fn clear_is_idempotent_and_rejects_non_record_paths() {
        let f = Fixture::new("2.4.0", "2.4.1");
        let unrelated = f.path.with_file_name("keep.json");
        fs::write(&unrelated, "unrelated").unwrap();
        assert!(clear(&unrelated).is_err());
        assert!(clear(&f.root).is_err());
        assert_eq!(fs::read_to_string(unrelated).unwrap(), "unrelated");
        clear(&f.path).unwrap();
        clear(&f.path).unwrap();
        assert_eq!(f.attempt().unwrap(), Outcome::NotApplicable);
        assert!(f.user.exists());
        assert!(f.machine.exists());
    }

    #[test]
    #[cfg(windows)]
    fn user_dev_link_is_preserved_and_never_recorded() {
        let f = Fixture::new("2.4.0", "2.4.1");
        let actual = f.root.join("dev-target");
        fs::rename(&f.user, &actual).unwrap();
        let quote = |path: &Path| path.to_string_lossy().replace('\'', "''");
        let result = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null",
                    quote(&f.user),
                    quote(&actual)
                ),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .unwrap();
        assert!(result.status.success());
        assert_eq!(f.attempt().unwrap(), Outcome::PreservedChangedUser);
        let consolidation = prepare_user_consolidation(&f.inventory(), true)
            .unwrap()
            .unwrap();
        assert!(prepare(
            &f.path,
            &CepInstallPlan {
                scope: CEP_SCOPE_PER_MACHINE.into(),
                target: f.machine.clone()
            },
            &CepZxpInfo {
                bundle_id: CEP_BUNDLE_ID.into(),
                version: "2.4.1".into(),
                signed: true,
                trusted: true
            },
            &signature_digest(&f.machine).unwrap(),
            &consolidation
        )
        .is_err());
        assert!(folder_is_junction(&f.user));
        assert_eq!(fs::read_to_string(actual.join("panel.js")).unwrap(), "old");
    }
}
