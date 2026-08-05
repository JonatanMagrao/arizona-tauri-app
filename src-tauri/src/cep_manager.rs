use std::collections::HashSet;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use roxmltree::Document;
use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{Manager, State};
use zip::ZipArchive;

use crate::after_effects;
use crate::AuthState;

const CEP_BUNDLE_ID: &str = "com.arizona-carrefour.cep";
const PLAYER_DEBUG_MODE_VALUE: &str = "PlayerDebugMode";
const CSXS_VERSIONS: [&str; 2] = ["CSXS.11", "CSXS.12"];
const MANIFEST_ENTRY: &str = "CSXS/manifest.xml";
const SIGNATURES_ENTRY: &str = "META-INF/signatures.xml";
const DEBUG_ENTRY: &str = ".debug";
const XMLDSIG_NAMESPACE: &str = "http://www.w3.org/2000/09/xmldsig#";
const MAX_ZXP_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ZXP_ENTRY_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ZXP_TOTAL_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ZXP_ENTRIES: usize = 4096;
const MAX_ZXP_METADATA_BYTES: u64 = 2 * 1024 * 1024;
const CONTENT_SIGNATURE_SUCCESS_MARKER: &str = "CEP content signature verified:";
#[cfg(windows)]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Tauri may dispatch independent commands concurrently. Every CEP operation
// shares one lock so a status read or a second install cannot observe/delete a
// staging directory while another operation is committing it.
static CEP_OPERATION_MUTEX: Mutex<()> = Mutex::new(());

#[derive(Debug)]
struct CepContentVerifier {
    powershell: PathBuf,
    script: PathBuf,
    trusted_certificates: PathBuf,
}

#[derive(Clone, Copy)]
enum CepContentTarget<'a> {
    Zxp(&'a Path),
    Directory(&'a Path),
}

/// Public list of certificates whose ZXPs this build accepts. Embedded at
/// compile time on purpose: a client cannot edit a file on disk to widen it.
/// A missing file is a build error, and that is intended.
const TRUSTED_CERTIFICATES_MANIFEST: &str = include_str!("../../INSTALLER/cep-trusted-cert.json");

/// This pin is an IDENTITY check, not a signature verification: it only proves
/// the ZXP carries our certificate. The bundled content verifier independently
/// validates the XML signature and every referenced digest before installation;
/// Adobe CEP verifies the installed tree again when it loads the panel.
const UNTRUSTED_ZXP_ERROR: &str =
    "cep_zxp_untrusted: Este .zxp não contém um certificado confiável da Arizona.";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CepDebugModeStatus {
    enabled: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CepExtensionStatus {
    installed: bool,
    version: Option<String>,
    path: String,
    is_dev_link: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CepZxpInfo {
    bundle_id: String,
    version: String,
    signed: bool,
    trusted: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CepInstallResult {
    version: String,
}

#[tauri::command]
pub fn cep_debug_mode_status() -> Result<CepDebugModeStatus, String> {
    let _operation = lock_cep_operation()?;
    Ok(CepDebugModeStatus {
        enabled: debug_mode_enabled()?,
    })
}

#[tauri::command]
pub fn set_cep_debug_mode(
    auth: State<AuthState>,
    enabled: bool,
) -> Result<CepDebugModeStatus, String> {
    crate::require_authenticated(&auth)?;
    let _operation = lock_cep_operation()?;
    apply_debug_mode(enabled)?;
    Ok(CepDebugModeStatus {
        enabled: debug_mode_enabled()?,
    })
}

#[tauri::command]
pub fn cep_extension_status() -> Result<CepExtensionStatus, String> {
    let _operation = lock_cep_operation()?;
    let per_user_target = extension_target_dir()?;
    let per_user_installed = extension_manifest_path(&per_user_target).is_file();
    let system_targets: Vec<_> = system_extension_target_dirs()
        .into_iter()
        .map(|target| {
            let installed = extension_manifest_path(&target).is_file();
            (target, installed)
        })
        .collect();
    let target =
        select_extension_status_target(&per_user_target, per_user_installed, &system_targets);
    let manifest_path = extension_manifest_path(&target);
    let version = read_file_text_limited(&manifest_path, MAX_ZXP_METADATA_BYTES)
        .ok()
        .and_then(|xml| manifest_bundle_info(&xml).ok())
        .and_then(|info| info.version);

    Ok(CepExtensionStatus {
        installed: manifest_path.is_file(),
        version,
        path: target.to_string_lossy().into_owned(),
        is_dev_link: folder_is_junction(&target),
    })
}

#[tauri::command]
pub async fn inspect_cep_zxp(app: tauri::AppHandle, path: String) -> Result<CepZxpInfo, String> {
    run_blocking_cep_operation(move || {
        let auth = app.state::<AuthState>();
        crate::require_authenticated(&auth)?;
        let _operation = lock_cep_operation()?;
        let verifier = resolve_cep_content_verifier(&app)?;
        inspect_zxp_file_with_verifier(Path::new(path.trim()), &verifier)
    })
    .await
}

#[tauri::command]
pub async fn install_cep_zxp(
    app: tauri::AppHandle,
    path: String,
    replace_dev_link: Option<bool>,
) -> Result<CepInstallResult, String> {
    let replace_dev_link = replace_dev_link.unwrap_or(false);
    run_blocking_cep_operation(move || {
        let auth = app.state::<AuthState>();
        crate::require_authenticated(&auth)?;
        let _operation = lock_cep_operation()?;
        let verifier = resolve_cep_content_verifier(&app)?;
        install_zxp_file(Path::new(path.trim()), replace_dev_link, &verifier)
    })
    .await
}

fn lock_cep_operation() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CEP_OPERATION_MUTEX
        .lock()
        .map_err(|_| "Não foi possível coordenar a operação da extensão CEP.".to_string())
}

fn resolve_cep_content_verifier(app: &tauri::AppHandle) -> Result<CepContentVerifier, String> {
    let resource_dir = app.path().resource_dir().map_err(|err| {
        content_signature_error(format!(
            "não foi possível localizar os recursos do aplicativo: {err}"
        ))
    })?;
    let system_root = env::var_os("SystemRoot")
        .map(PathBuf::from)
        .ok_or_else(|| content_signature_error("SystemRoot não está definido"))?;
    resolve_cep_content_verifier_in(&resource_dir, &system_root)
}

fn resolve_cep_content_verifier_in(
    resource_dir: &Path,
    system_root: &Path,
) -> Result<CepContentVerifier, String> {
    if !resource_dir.is_absolute() {
        return Err(content_signature_error(
            "a pasta de recursos do aplicativo não é absoluta",
        ));
    }
    if !system_root.is_absolute() {
        return Err(content_signature_error(
            "SystemRoot não é um caminho absoluto",
        ));
    }

    let powershell = system_root
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let installer_resources = resource_dir.join("installer");
    let script = installer_resources
        .join("scripts")
        .join("verify-zxp-content.ps1");
    let trusted_certificates = installer_resources.join("cep-trusted-cert.json");

    require_regular_verifier_file(&powershell, "powershell.exe")?;
    require_regular_verifier_file(&script, "verify-zxp-content.ps1")?;
    require_regular_verifier_file(&trusted_certificates, "cep-trusted-cert.json")?;

    Ok(CepContentVerifier {
        powershell,
        script,
        trusted_certificates,
    })
}

fn require_regular_verifier_file(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(_) => Err(content_signature_error(format!(
            "o recurso {label} não é um arquivo regular: {}",
            path.display()
        ))),
        Err(err) => Err(content_signature_error(format!(
            "o recurso {label} não está disponível em {}: {err}",
            path.display()
        ))),
    }
}

fn content_verifier_arguments(
    verifier: &CepContentVerifier,
    target: CepContentTarget<'_>,
) -> Result<Vec<OsString>, String> {
    let (target_parameter, target_path) = match target {
        CepContentTarget::Zxp(path) => ("-ZxpPath", path),
        CepContentTarget::Directory(path) => ("-Directory", path),
    };
    let target_path = absolute_verification_target(target_path)?;
    Ok(vec![
        OsString::from("-NoProfile"),
        OsString::from("-NonInteractive"),
        OsString::from("-ExecutionPolicy"),
        OsString::from("Bypass"),
        OsString::from("-File"),
        verifier.script.as_os_str().to_os_string(),
        OsString::from(target_parameter),
        target_path.into_os_string(),
        OsString::from("-TrustedCertPath"),
        verifier.trusted_certificates.as_os_str().to_os_string(),
    ])
}

fn absolute_verification_target(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    env::current_dir()
        .map(|directory| directory.join(path))
        .map_err(|err| {
            content_signature_error(format!(
                "não foi possível resolver o caminho do conteúdo CEP: {err}"
            ))
        })
}

#[cfg(windows)]
fn verify_cep_content_signature(
    verifier: &CepContentVerifier,
    target: CepContentTarget<'_>,
) -> Result<(), String> {
    let arguments = content_verifier_arguments(verifier, target)?;
    let mut command = Command::new(&verifier.powershell);
    command
        .args(arguments)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|err| {
        content_signature_error(format!("não foi possível iniciar o verificador: {err}"))
    })?;

    if !output.status.success() {
        let detail = verifier_process_detail(&output.stdout, &output.stderr);
        return Err(content_signature_error(if detail.is_empty() {
            format!(
                "o verificador rejeitou a assinatura (código {:?})",
                output.status.code()
            )
        } else {
            format!("o verificador rejeitou a assinatura: {detail}")
        }));
    }
    if !verifier_output_has_success_marker(&output.stdout) {
        return Err(content_signature_error(
            "o processo terminou sem o marcador de confirmação esperado",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn verify_cep_content_signature(
    _verifier: &CepContentVerifier,
    _target: CepContentTarget<'_>,
) -> Result<(), String> {
    Err(content_signature_error(
        "a verificação criptográfica CEP está disponível apenas no Windows",
    ))
}

fn verifier_output_has_success_marker(stdout: &[u8]) -> bool {
    decode_verifier_output(stdout).contains(CONTENT_SIGNATURE_SUCCESS_MARKER)
}

fn verifier_process_detail(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr = compact_verifier_output(stderr);
    if !stderr.is_empty() {
        return stderr;
    }
    compact_verifier_output(stdout)
}

fn compact_verifier_output(bytes: &[u8]) -> String {
    let compact = decode_verifier_output(bytes)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");
    compact.chars().take(2_000).collect()
}

fn decode_verifier_output(bytes: &[u8]) -> String {
    // Windows PowerShell can emit redirected text as UTF-16LE. Removing NULs
    // keeps the ASCII marker detectable while diagnostics remain best-effort.
    String::from_utf8_lossy(bytes).replace('\0', "")
}

fn content_signature_error(detail: impl AsRef<str>) -> String {
    format!(
        "cep_zxp_signature_invalid: Falha na verificação criptográfica do conteúdo CEP: {}",
        detail.as_ref()
    )
}

// Filesystem/registry work must not run on the WebView2 window callback (it
// blocks the native move/drag message pump — see run_blocking_network_command).
async fn run_blocking_cep_operation<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            format!("Não foi possível executar a operação da extensão em segundo plano: {error}")
        })?
}

fn inspect_zxp_file(path: &Path) -> Result<CepZxpInfo, String> {
    // An unreadable file says nothing about the file's identity, so it must not
    // be reported as "this is not the Arizona extension".
    let file = fs::File::open(path)
        .map_err(|err| format!("cep_zxp_unreadable: Não foi possível abrir o arquivo: {err}"))?;
    assert_archive_file_size(&file).map_err(|err| format!("cep_zxp_invalid: {err}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|err| format!("cep_zxp_invalid: O arquivo não é um ZXP válido: {err}"))?;
    validate_archive_limits_and_paths(&mut archive)
        .map_err(|err| format!("cep_zxp_invalid: {err}"))?;

    let manifest_xml = read_archive_text(&mut archive, MANIFEST_ENTRY, MAX_ZXP_METADATA_BYTES)
        .map_err(|err| format!("cep_zxp_invalid: Manifesto CSXS ausente no ZXP: {err}"))?;
    let info =
        manifest_bundle_info(&manifest_xml).map_err(|err| format!("cep_zxp_invalid: {err}"))?;
    let bundle_id = info
        .bundle_id
        .ok_or_else(|| "cep_zxp_invalid: ExtensionBundleId ausente no manifesto.".to_string())?;
    if bundle_id != CEP_BUNDLE_ID {
        return Err(format!(
            "cep_zxp_invalid: O ZXP pertence a \"{bundle_id}\"; o esperado é \"{CEP_BUNDLE_ID}\"."
        ));
    }
    let version = info.version.ok_or_else(|| {
        "cep_zxp_invalid: ExtensionBundleVersion ausente no manifesto.".to_string()
    })?;
    let signed = archive_entry_index(&mut archive, SIGNATURES_ENTRY).is_some();
    // An unsigned ZXP has no certificate to pin, so it fails the same way as a
    // ZXP signed by somebody else.
    let signatures_xml = read_archive_text(&mut archive, SIGNATURES_ENTRY, MAX_ZXP_METADATA_BYTES)
        .unwrap_or_default();
    assert_signed_by_trusted_certificate(&signatures_xml)?;
    require_regular_archive_entry(&mut archive, DEBUG_ENTRY)
        .map_err(|err| format!("cep_zxp_invalid: {err}"))?;

    Ok(CepZxpInfo {
        bundle_id,
        version,
        signed,
        trusted: true,
    })
}

fn inspect_zxp_file_with_verifier(
    path: &Path,
    verifier: &CepContentVerifier,
) -> Result<CepZxpInfo, String> {
    let info = inspect_zxp_file(path)?;
    // The Rust pin proves publisher identity; the external verifier proves the
    // signature and every PackageContents digest. Both checks are mandatory.
    verify_cep_content_signature(verifier, CepContentTarget::Zxp(path))?;
    Ok(info)
}

#[derive(serde::Deserialize)]
struct TrustedCertificatesManifest {
    #[serde(default)]
    certificates: Vec<TrustedCertificateEntry>,
}

#[derive(serde::Deserialize)]
struct TrustedCertificateEntry {
    sha256: String,
}

/// Parsed once; a broken pinned manifest yields an empty list, which fails
/// closed (nothing installs) instead of silently trusting everything.
fn trusted_certificate_fingerprints() -> &'static [String] {
    static FINGERPRINTS: OnceLock<Vec<String>> = OnceLock::new();
    FINGERPRINTS.get_or_init(|| {
        parse_trusted_certificates(TRUSTED_CERTIFICATES_MANIFEST).unwrap_or_default()
    })
}

fn parse_trusted_certificates(json: &str) -> Result<Vec<String>, String> {
    let manifest: TrustedCertificatesManifest = serde_json::from_str(json)
        .map_err(|err| format!("Lista de certificados confiáveis inválida: {err}"))?;
    manifest
        .certificates
        .into_iter()
        .map(|entry| {
            let fingerprint = entry.sha256.trim().to_ascii_lowercase();
            if is_sha256_hex(&fingerprint) {
                Ok(fingerprint)
            } else {
                Err(format!(
                    "Impressão digital de certificado inválida: {:?}",
                    entry.sha256
                ))
            }
        })
        .collect()
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}

/// Fingerprint contract shared with the packaging scripts: lowercase SHA-256
/// over the raw DER bytes of the single signing certificate. The certificate
/// Signature, KeyInfo, X509Data and X509Certificate must each occur exactly
/// once in the whole document, on the exact Signature > KeyInfo > X509Data >
/// X509Certificate path in the XMLDSig namespace (the concrete prefix chosen by
/// ZXPSignCmd does not matter).
fn signing_certificate_fingerprint(signatures_xml: &str) -> Result<String, String> {
    let document =
        Document::parse(signatures_xml).map_err(|err| format!("signatures.xml inválido: {err}"))?;
    let signatures: Vec<_> = document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "Signature")
        .collect();
    if signatures.len() != 1 {
        return Err(format!(
            "signatures.xml precisa conter exatamente uma Signature; encontrou {}.",
            signatures.len()
        ));
    }
    if !is_xmldsig_element(signatures[0], "Signature") {
        return Err("Signature fora do namespace XMLDSig esperado.".to_string());
    }

    let certificates: Vec<_> = document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "X509Certificate")
        .collect();
    if certificates.len() != 1 {
        return Err(format!(
            "signatures.xml precisa conter exatamente um X509Certificate; encontrou {}.",
            certificates.len()
        ));
    }
    if !is_xmldsig_element(certificates[0], "X509Certificate") {
        return Err("X509Certificate fora do namespace XMLDSig esperado.".to_string());
    }

    let key_infos: Vec<_> = document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "KeyInfo")
        .collect();
    if key_infos.len() != 1 {
        return Err(format!(
            "signatures.xml precisa conter exatamente um KeyInfo; encontrou {}.",
            key_infos.len()
        ));
    }
    if !is_xmldsig_element(key_infos[0], "KeyInfo") {
        return Err("KeyInfo fora do namespace XMLDSig esperado.".to_string());
    }
    let direct_key_infos: Vec<_> = signatures[0]
        .children()
        .filter(|node| node.is_element() && node.tag_name().name() == "KeyInfo")
        .collect();
    if direct_key_infos.len() != 1 || direct_key_infos[0] != key_infos[0] {
        return Err(format!(
            "Signature precisa conter exatamente um KeyInfo filho; encontrou {}.",
            direct_key_infos.len()
        ));
    }

    let x509_data_nodes: Vec<_> = document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "X509Data")
        .collect();
    if x509_data_nodes.len() != 1 {
        return Err(format!(
            "signatures.xml precisa conter exatamente um X509Data; encontrou {}.",
            x509_data_nodes.len()
        ));
    }
    if !is_xmldsig_element(x509_data_nodes[0], "X509Data") {
        return Err("X509Data fora do namespace XMLDSig esperado.".to_string());
    }
    let key_info_elements: Vec<_> = key_infos[0]
        .children()
        .filter(|node| node.is_element())
        .collect();
    if key_info_elements.len() != 1 || key_info_elements[0] != x509_data_nodes[0] {
        return Err("KeyInfo precisa conter somente um X509Data.".to_string());
    }
    let x509_data_elements: Vec<_> = x509_data_nodes[0]
        .children()
        .filter(|node| node.is_element())
        .collect();
    if x509_data_elements.len() != 1
        || !is_xmldsig_element(x509_data_elements[0], "X509Certificate")
        || x509_data_elements[0] != certificates[0]
    {
        return Err("X509Data precisa conter somente um X509Certificate.".to_string());
    }
    let node = certificates[0];
    if node.children().any(|child| child.is_element()) {
        return Err("X509Certificate não pode conter elementos filhos.".to_string());
    }

    // The signer wraps the base64 across lines, so direct text nodes are joined
    // and unwrapped. Element children were rejected above.
    let encoded: String = node
        .children()
        .filter(roxmltree::Node::is_text)
        .filter_map(|node| node.text())
        .flat_map(str::chars)
        .filter(|character| !character.is_whitespace())
        .collect();
    if encoded.is_empty() {
        return Err("X509Certificate vazio em signatures.xml.".to_string());
    }

    let der = BASE64_STANDARD
        .decode(encoded.as_bytes())
        .map_err(|err| format!("X509Certificate não é base64 válido: {err}"))?;
    Ok(hex_digest(&der))
}

fn is_xmldsig_element(node: roxmltree::Node<'_, '_>, local_name: &str) -> bool {
    node.is_element()
        && node.tag_name().name() == local_name
        && node.tag_name().namespace() == Some(XMLDSIG_NAMESPACE)
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn fingerprint_is_trusted(fingerprint: &str, trusted: &[String]) -> bool {
    trusted
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(fingerprint))
}

/// Never surfaces the parsing detail: whatever went wrong, the answer to the
/// user is the same — this file does not carry the Arizona certificate.
fn assert_signed_by_trusted_certificate(signatures_xml: &str) -> Result<(), String> {
    match signing_certificate_fingerprint(signatures_xml) {
        Ok(fingerprint)
            if fingerprint_is_trusted(&fingerprint, trusted_certificate_fingerprints()) =>
        {
            Ok(())
        }
        _ => Err(UNTRUSTED_ZXP_ERROR.to_string()),
    }
}

/// Re-runs the pin on what actually landed on disk, so replacing the file
/// between the inspection and the install cannot bypass it.
fn assert_extracted_tree_is_trusted(extracted: &Path) -> Result<(), String> {
    let mut signatures_path = extracted.to_path_buf();
    for segment in SIGNATURES_ENTRY.split('/') {
        signatures_path.push(segment);
    }
    let signatures_xml =
        read_file_text_limited(&signatures_path, MAX_ZXP_METADATA_BYTES).unwrap_or_default();
    assert_signed_by_trusted_certificate(&signatures_xml)
}

fn install_zxp_file(
    zxp_path: &Path,
    replace_dev_link: bool,
    verifier: &CepContentVerifier,
) -> Result<CepInstallResult, String> {
    // Rejects a foreign bundle before anything is touched on disk; the version
    // that is reported back comes from the extracted manifest further down.
    inspect_zxp_file_with_verifier(zxp_path, verifier)?;

    assert_after_effects_is_closed()?;

    let extensions = extensions_dir()?;
    fs::create_dir_all(&extensions).map_err(|err| {
        format!(
            "cep_install_failed: Não foi possível criar {}: {err}",
            extensions.display()
        )
    })?;

    let target = extensions.join(CEP_BUNDLE_ID);
    let work_root = install_work_root(&extensions)?;
    fs::create_dir_all(&work_root).map_err(|err| {
        format!(
            "cep_install_failed: Não foi possível criar a pasta de trabalho {}: {err}",
            work_root.display()
        )
    })?;
    if folder_is_junction(&work_root) {
        return Err(
            "cep_install_failed: A pasta de trabalho da instalação é um link e não pode ser usada."
                .to_string(),
        );
    }
    recover_interrupted_install(&extensions, &work_root, &target)?;

    // Dev machines keep a junction pointing at the extension build output.
    // Keep it in place until the commit: swap_into_place renames the reparse
    // point itself to .bak and can therefore restore it if the new rename fails.
    if folder_is_junction(&target) {
        if !replace_dev_link {
            return Err(
                "cep_dev_link: A pasta da extensão é um link de desenvolvimento. Confirme a substituição para instalar o ZXP no lugar dele."
                    .to_string(),
            );
        }
    }

    // Staging lives beside (never inside) Adobe\CEP\extensions. CEP therefore
    // cannot discover a half-extracted bundle after a crash, while the final
    // rename remains on the same volume.
    let temp = create_install_staging_dir(&work_root)?;

    let result = extract_zxp_to(zxp_path, &temp)
        // The archive is reopened for extraction, so the bundle identity is
        // asserted again on what actually landed on disk, not on what the file
        // claimed when it was inspected.
        .and_then(|()| installed_bundle_version(&temp))
        .map_err(|err| format!("cep_install_failed: {err}"))
        // Same reasoning for the certificate pin; this error already carries
        // its own code, so it is not wrapped.
        .and_then(|version| assert_extracted_tree_is_trusted(&temp).map(|()| version))
        .and_then(|version| assert_extracted_debug_file(&temp).map(|()| version))
        // Re-verify the exact extracted tree. This closes the archive reopen
        // gap and ensures the bytes being committed match PackageContents.
        .and_then(|version| {
            verify_cep_content_signature(verifier, CepContentTarget::Directory(&temp))
                .map(|()| version)
        })
        .and_then(|version| {
            // The first check only protects the start of a potentially long
            // extraction. Refuse the commit if After Effects opened meanwhile.
            assert_after_effects_is_closed()?;
            // A signed production tree must not inherit the debug bypass from
            // an older/dev installation. Clear every supported CSXS key before
            // touching the current target, and abort safely if that fails.
            apply_debug_mode(false).map_err(|err| {
                format!(
                    "cep_install_failed: Não foi possível desativar o PlayerDebugMode antes da instalação: {err}"
                )
            })?;
            swap_into_place(&extensions, &work_root, &target, &temp)
                .map_err(|err| format!("cep_install_failed: {err}"))?;
            Ok(version)
        });
    let version = match result {
        Ok(version) => version,
        Err(err) => {
            let _ = remove_install_work_path(&temp);
            return Err(err);
        }
    };

    Ok(CepInstallResult { version })
}

fn assert_after_effects_is_closed() -> Result<(), String> {
    if after_effects::is_after_effects_running()
        .map_err(|err| format!("cep_install_failed: {err}"))?
    {
        return Err(
            "after_effects_running: Feche o After Effects antes de instalar a extensão."
                .to_string(),
        );
    }
    Ok(())
}

// Re-reads the extracted manifest and refuses anything that is not the Arizona
// bundle, closing the gap between inspecting the file and extracting it.
fn installed_bundle_version(extracted: &Path) -> Result<String, String> {
    let manifest_path = extracted.join("CSXS").join("manifest.xml");
    let manifest_xml = read_file_text_limited(&manifest_path, MAX_ZXP_METADATA_BYTES)
        .map_err(|err| format!("Manifesto CSXS ausente no conteúdo extraído: {err}"))?;
    let info = manifest_bundle_info(&manifest_xml)?;
    match info.bundle_id.as_deref() {
        Some(CEP_BUNDLE_ID) => {}
        _ => return Err("O conteúdo extraído não é a extensão Arizona.".to_string()),
    }
    info.version
        .ok_or_else(|| "ExtensionBundleVersion ausente no manifesto extraído.".to_string())
}

fn assert_extracted_debug_file(extracted: &Path) -> Result<(), String> {
    let debug_path = extracted.join(DEBUG_ENTRY);
    match fs::symlink_metadata(&debug_path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        _ => Err("O conteúdo extraído não contém o arquivo .debug assinado.".to_string()),
    }
}

fn random_suffix() -> String {
    use rand::Rng;
    let value: u64 = rand::rng().random();
    format!("{value:016x}")
}

fn extract_zxp_to(zxp_path: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(zxp_path)
        .map_err(|err| format!("Não foi possível abrir o arquivo ZXP: {err}"))?;
    assert_archive_file_size(&file)?;
    let mut archive =
        ZipArchive::new(file).map_err(|err| format!("O arquivo não é um ZXP válido: {err}"))?;
    validate_archive_limits_and_paths(&mut archive)?;
    let mut total_written = 0_u64;

    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|err| format!("Não foi possível ler o conteúdo do ZXP: {err}"))?;
        let Some(relative) = sanitized_zip_entry_path(entry.name()) else {
            return Err(format!("Entrada insegura no ZXP: {}", entry.name()));
        };
        let target = destination.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|err| format!("Não foi possível criar {}: {err}", target.display()))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Não foi possível criar {}: {err}", parent.display()))?;
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|err| format!("Não foi possível criar {}: {err}", target.display()))?;
        let remaining_total = MAX_ZXP_TOTAL_UNCOMPRESSED_BYTES.saturating_sub(total_written);
        let copy_limit = MAX_ZXP_ENTRY_BYTES.min(remaining_total).saturating_add(1);
        let copied = io::copy(&mut entry.take(copy_limit), &mut output)
            .map_err(|err| format!("Não foi possível extrair {}: {err}", target.display()))?;
        if copied > MAX_ZXP_ENTRY_BYTES {
            return Err(format!(
                "Entrada do ZXP excede o limite de {} bytes: {}",
                MAX_ZXP_ENTRY_BYTES,
                relative.display()
            ));
        }
        if copied > remaining_total {
            return Err(format!(
                "Conteúdo descompactado do ZXP excede o limite de {} bytes.",
                MAX_ZXP_TOTAL_UNCOMPRESSED_BYTES
            ));
        }
        total_written += copied;
    }

    Ok(())
}

fn assert_archive_file_size(file: &fs::File) -> Result<(), String> {
    let size = file
        .metadata()
        .map_err(|err| format!("Não foi possível medir o arquivo ZXP: {err}"))?
        .len();
    if size > MAX_ZXP_ARCHIVE_BYTES {
        return Err(format!(
            "O arquivo ZXP excede o limite de {} bytes.",
            MAX_ZXP_ARCHIVE_BYTES
        ));
    }
    Ok(())
}

fn validate_archive_limits_and_paths<R: Read + io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<(), String> {
    if archive.len() > MAX_ZXP_ENTRIES {
        return Err(format!(
            "O ZXP contém {} entradas; o limite é {}.",
            archive.len(),
            MAX_ZXP_ENTRIES
        ));
    }

    let mut total_size = 0_u64;
    let mut normalized_names = HashSet::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|err| format!("Não foi possível ler o diretório do ZXP: {err}"))?;
        let relative = sanitized_zip_entry_path(entry.name())
            .ok_or_else(|| format!("Entrada insegura no ZXP: {}", entry.name()))?;
        let normalized = relative
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
        if !normalized_names.insert(normalized) {
            return Err(format!("Entrada duplicada no ZXP: {}", entry.name()));
        }
        if entry.is_symlink() {
            return Err(format!(
                "Link simbólico não permitido no ZXP: {}",
                entry.name()
            ));
        }

        let size = entry.size();
        if size > MAX_ZXP_ENTRY_BYTES {
            return Err(format!(
                "Entrada do ZXP excede o limite de {} bytes: {}",
                MAX_ZXP_ENTRY_BYTES,
                entry.name()
            ));
        }
        total_size = total_size
            .checked_add(size)
            .ok_or_else(|| "Tamanho descompactado do ZXP excede a faixa suportada.".to_string())?;
        if total_size > MAX_ZXP_TOTAL_UNCOMPRESSED_BYTES {
            return Err(format!(
                "Conteúdo descompactado do ZXP excede o limite de {} bytes.",
                MAX_ZXP_TOTAL_UNCOMPRESSED_BYTES
            ));
        }
    }
    Ok(())
}

fn require_regular_archive_entry<R: Read + io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<(), String> {
    let index = archive_entry_index(archive, name)
        .ok_or_else(|| format!("entrada {name} não encontrada"))?;
    let entry = archive.by_index_raw(index).map_err(|err| err.to_string())?;
    if !entry.is_file() {
        return Err(format!("entrada {name} não é um arquivo regular"));
    }
    Ok(())
}

// Same-volume swap: staging and backup live under Adobe\CEP\.arizona-install-work,
// a sibling of the scanned extensions directory. Renames remain atomic without
// ever exposing a second bundle to CEP, including between crash points.
fn swap_into_place(
    extensions: &Path,
    work_root: &Path,
    target: &Path,
    temp: &Path,
) -> Result<(), String> {
    let backup = unused_install_work_path(work_root, "bak")?;
    let had_previous = install_path_exists(target)
        .map_err(|err| format!("Não foi possível verificar a versão anterior: {err}"))?;

    if had_previous {
        fs::rename(target, &backup)
            .map_err(|err| format!("Não foi possível reservar a versão anterior: {err}"))?;
    }

    if let Err(err) = fs::rename(temp, target) {
        if had_previous {
            return match fs::rename(&backup, target) {
                Ok(()) => Err(format!(
                    "Não foi possível mover a nova versão: {err}. A versão anterior foi restaurada."
                )),
                Err(rollback_err) => Err(format!(
                    "Não foi possível mover a nova versão: {err}. A restauração automática também falhou: {rollback_err}. O backup foi preservado em {}.",
                    backup.display()
                )),
            };
        }
        return Err(format!("Não foi possível mover a nova versão: {err}"));
    }

    // Cleanup is part of a successful commit. Legacy backups are removed from
    // the scanned directory, and current backups are removed from work_root.
    // Any failure is surfaced instead of reporting a misleading success.
    remove_install_backups_after_commit(extensions, work_root)?;
    Ok(())
}

fn install_work_root(extensions: &Path) -> Result<PathBuf, String> {
    extensions
        .parent()
        .map(|cep_root| cep_root.join(".arizona-install-work"))
        .ok_or_else(|| {
            "cep_install_failed: Não foi possível localizar a pasta pai de Adobe\\CEP\\extensions."
                .to_string()
        })
}

fn random_install_work_path(work_root: &Path, kind: &str) -> PathBuf {
    work_root.join(format!(
        "{CEP_BUNDLE_ID}.{kind}-{}-{}",
        std::process::id(),
        random_suffix()
    ))
}

fn unused_install_work_path(work_root: &Path, kind: &str) -> Result<PathBuf, String> {
    for _ in 0..8 {
        let candidate = random_install_work_path(work_root, kind);
        let exists = install_path_exists(&candidate).map_err(|err| {
            format!(
                "Não foi possível verificar o caminho de trabalho {}: {err}",
                candidate.display()
            )
        })?;
        if !exists {
            return Ok(candidate);
        }
    }
    Err(format!(
        "Não foi possível reservar um nome de trabalho {kind} não utilizado."
    ))
}

fn create_install_staging_dir(work_root: &Path) -> Result<PathBuf, String> {
    for _ in 0..8 {
        let temp = random_install_work_path(work_root, "tmp");
        match fs::create_dir(&temp) {
            Ok(()) => {
                if folder_is_junction(&temp) {
                    let _ = remove_install_work_path(&temp);
                    return Err(
                        "cep_install_failed: A pasta temporária de instalação é um link e foi descartada."
                            .to_string(),
                    );
                }
                return Ok(temp);
            }
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(format!(
                    "cep_install_failed: Não foi possível criar a pasta temporária {}: {err}",
                    temp.display()
                ));
            }
        }
    }
    Err("cep_install_failed: Não foi possível reservar uma pasta temporária única.".to_string())
}

fn remove_install_backups_after_commit(extensions: &Path, work_root: &Path) -> Result<(), String> {
    let mut backups = list_install_backups(extensions)?;
    backups.extend(list_install_backups(work_root)?);
    backups.sort_by(|left, right| {
        left.to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&right.to_string_lossy().to_ascii_lowercase())
    });
    for backup in backups {
        remove_install_work_path(&backup).map_err(|err| {
            format!(
                "A nova extensão foi posicionada, mas o backup {} não pôde ser removido: {err}",
                backup.display()
            )
        })?;
    }
    Ok(())
}

fn recover_interrupted_install(
    extensions: &Path,
    work_root: &Path,
    target: &Path,
) -> Result<(), String> {
    let target_exists = install_path_exists(target).map_err(|err| {
        format!("cep_install_failed: Não foi possível verificar o destino: {err}")
    })?;
    let mut backups = list_install_backups(extensions)?;
    backups.extend(list_install_backups(work_root)?);
    backups.sort_by(|left, right| {
        left.to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&right.to_string_lossy().to_ascii_lowercase())
    });

    if !target_exists {
        match backups.as_slice() {
            [] => {}
            [backup] => {
                fs::rename(backup, target).map_err(|err| {
                    format!(
                        "cep_install_failed: A instalação anterior foi interrompida e o backup {} não pôde ser restaurado: {err}",
                        backup.display()
                    )
                })?;
            }
            _ => {
                return Err(format!(
                    "cep_install_failed: Foram encontrados {} backups e nenhum destino ativo; todos foram preservados para recuperação manual.",
                    backups.len()
                ));
            }
        }
    }

    // If a target was already present, or has just been restored, every other
    // backup is stale. A moved recovery source is simply ignored as NotFound.
    let target_exists_after = install_path_exists(target).map_err(|err| {
        format!("cep_install_failed: Não foi possível verificar o destino recuperado: {err}")
    })?;
    if target_exists || target_exists_after {
        for backup in backups {
            remove_install_work_path(&backup).map_err(|err| {
                format!(
                    "cep_install_failed: Não foi possível limpar o backup {}: {err}",
                    backup.display()
                )
            })?;
        }
    }
    clean_install_temporaries(extensions)?;
    clean_install_temporaries(work_root)?;
    Ok(())
}

fn list_install_backups(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !install_path_exists(root).map_err(|err| {
        format!(
            "cep_install_failed: Não foi possível verificar {}: {err}",
            root.display()
        )
    })? {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(root).map_err(|err| {
        format!(
            "cep_install_failed: Não foi possível listar backups em {}: {err}",
            root.display()
        )
    })?;
    let mut backups = Vec::new();
    for entry in entries {
        let entry = entry
            .map_err(|err| format!("cep_install_failed: Não foi possível ler um backup: {err}"))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if is_install_backup(name) {
            backups.push(entry.path());
        }
    }
    Ok(backups)
}

fn clean_install_temporaries(root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(root).map_err(|err| {
        format!(
            "cep_install_failed: Não foi possível listar temporários em {}: {err}",
            root.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| {
            format!("cep_install_failed: Não foi possível ler um temporário: {err}")
        })?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !is_install_temporary(name) {
            continue;
        }
        remove_install_work_path(&entry.path()).map_err(|err| {
            format!(
                "cep_install_failed: Não foi possível limpar o temporário {}: {err}",
                entry.path().display()
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
fn is_stale_install_leftover(name: &str) -> bool {
    is_install_backup(name) || is_install_temporary(name)
}

fn is_install_backup(name: &str) -> bool {
    name == format!("{CEP_BUNDLE_ID}.bak") || name.starts_with(&format!("{CEP_BUNDLE_ID}.bak-"))
}

fn is_install_temporary(name: &str) -> bool {
    name.starts_with(&format!("{CEP_BUNDLE_ID}.tmp-"))
}

fn install_path_exists(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err),
    }
}

fn remove_install_work_path(path: &Path) -> io::Result<()> {
    // Walk explicitly instead of remove_dir_all: every descendant is checked
    // with symlink_metadata before it is touched, so a junction hidden inside a
    // stale work directory is removed as a link and is never traversed.
    let mut pending = vec![(path.to_path_buf(), false)];
    while let Some((current, children_queued)) = pending.pop() {
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
            Err(err) => return Err(err),
        };
        if folder_is_junction(&current) {
            remove_directory_link(&current)?;
            continue;
        }
        if !metadata.is_dir() {
            fs::remove_file(&current)?;
            continue;
        }
        if children_queued {
            fs::remove_dir(&current)?;
            continue;
        }

        pending.push((current.clone(), true));
        for child in fs::read_dir(&current)? {
            pending.push((child?.path(), false));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn remove_directory_link(path: &Path) -> io::Result<()> {
    // remove_dir drops the junction/reparse point itself and never traverses
    // into the directory it targets.
    fs::remove_dir(path)
}

#[cfg(not(windows))]
fn remove_directory_link(path: &Path) -> io::Result<()> {
    fs::remove_file(path)
}

fn extension_target_dir() -> Result<PathBuf, String> {
    Ok(extensions_dir()?.join(CEP_BUNDLE_ID))
}

fn system_extension_target_dirs() -> Vec<PathBuf> {
    system_extension_target_dirs_from(
        env::var_os("CommonProgramW6432"),
        env::var_os("CommonProgramFiles"),
        env::var_os("CommonProgramFiles(x86)"),
    )
}

fn system_extension_target_dirs_from(
    common_program_w6432: Option<OsString>,
    common_program_files: Option<OsString>,
    common_program_files_x86: Option<OsString>,
) -> Vec<PathBuf> {
    // A 32-bit NSIS/Tauri process sees CommonProgramFiles through WOW64, while
    // CommonProgramW6432 still names the native x64 location. Preserve this
    // order so a Full install wins over a legacy x86 copy, then deduplicate the
    // aliases case-insensitively using Windows path semantics.
    let mut seen = HashSet::new();
    [
        common_program_w6432,
        common_program_files,
        common_program_files_x86,
    ]
    .into_iter()
    .flatten()
    .filter(|root| !root.is_empty())
    .map(PathBuf::from)
    .filter(|root| seen.insert(windows_path_dedup_key(root)))
    .map(|root| system_extensions_dir_from(&root).join(CEP_BUNDLE_ID))
    .collect()
}

fn system_extensions_dir_from(common_program_files: &Path) -> PathBuf {
    common_program_files
        .join("Adobe")
        .join("CEP")
        .join("extensions")
}

fn extension_manifest_path(target: &Path) -> PathBuf {
    target.join("CSXS").join("manifest.xml")
}

fn windows_path_dedup_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn select_extension_status_target(
    per_user_target: &Path,
    per_user_installed: bool,
    system_targets: &[(PathBuf, bool)],
) -> PathBuf {
    if per_user_installed {
        return per_user_target.to_path_buf();
    }
    system_targets
        .iter()
        .find(|(_, installed)| *installed)
        .map(|(target, _)| target.clone())
        .unwrap_or_else(|| per_user_target.to_path_buf())
}

fn extensions_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "Não foi possível localizar a pasta APPDATA.".to_string())?;
    Ok(PathBuf::from(appdata)
        .join("Adobe")
        .join("CEP")
        .join("extensions"))
}

// std's is_symlink() misses NTFS junctions; the raw reparse-point attribute
// covers both junctions and symlinks.
#[cfg(windows)]
fn folder_is_junction(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;

    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn folder_is_junction(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(windows)]
fn debug_mode_enabled() -> Result<bool, String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let values: Vec<Option<String>> = CSXS_VERSIONS
        .iter()
        .map(|version| {
            RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags(csxs_key_path(version), KEY_READ)
                .ok()
                .and_then(|key| key.get_value(PLAYER_DEBUG_MODE_VALUE).ok())
        })
        .collect();
    Ok(any_player_debug_mode_is_enabled(&values))
}

#[cfg(windows)]
fn apply_debug_mode(enabled: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    for version in CSXS_VERSIONS {
        let path = csxs_key_path(version);
        if enabled {
            // CEP reads the string value, so PlayerDebugMode must be REG_SZ
            // "1" — never a DWORD.
            let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(&path)
                .map_err(|err| format!("Não foi possível abrir HKCU\\{path}: {err}"))?;
            key.set_value(PLAYER_DEBUG_MODE_VALUE, &"1")
                .map_err(|err| format!("Não foi possível gravar HKCU\\{path}: {err}"))?;
            continue;
        }

        match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(&path, KEY_SET_VALUE) {
            Ok(key) => match key.delete_value(PLAYER_DEBUG_MODE_VALUE) {
                Ok(()) => {}
                Err(err) if err.kind() == io::ErrorKind::NotFound => {}
                Err(err) => return Err(format!("Não foi possível limpar HKCU\\{path}: {err}")),
            },
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return Err(format!("Não foi possível abrir HKCU\\{path}: {err}")),
        }
    }
    Ok(())
}

#[cfg(windows)]
fn csxs_key_path(version: &str) -> String {
    format!("Software\\Adobe\\{version}")
}

#[cfg(not(windows))]
fn debug_mode_enabled() -> Result<bool, String> {
    Err("O modo de depuração CEP está disponível apenas no Windows.".to_string())
}

#[cfg(not(windows))]
fn apply_debug_mode(_enabled: bool) -> Result<(), String> {
    Err("O modo de depuração CEP está disponível apenas no Windows.".to_string())
}

fn player_debug_mode_is_enabled(value: Option<&str>) -> bool {
    value.map(str::trim) == Some("1")
}

fn any_player_debug_mode_is_enabled(values: &[Option<String>]) -> bool {
    values
        .iter()
        .any(|value| player_debug_mode_is_enabled(value.as_deref()))
}

struct ManifestBundleInfo {
    bundle_id: Option<String>,
    version: Option<String>,
}

fn manifest_bundle_info(xml: &str) -> Result<ManifestBundleInfo, String> {
    let doc = Document::parse(xml).map_err(|err| format!("Manifesto CEP inválido: {err}"))?;
    let root = doc.root_element();
    if root.tag_name().name() != "ExtensionManifest" {
        return Err("Manifesto CEP inválido: raiz ExtensionManifest ausente.".to_string());
    }

    let attribute = |name: &str| {
        root.attribute(name)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };
    Ok(ManifestBundleInfo {
        bundle_id: attribute("ExtensionBundleId"),
        version: attribute("ExtensionBundleVersion"),
    })
}

fn read_archive_text<R: io::Read + io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    max_bytes: u64,
) -> Result<String, String> {
    let index = archive_entry_index(archive, name)
        .ok_or_else(|| format!("entrada {name} não encontrada"))?;
    let file = archive.by_index(index).map_err(|err| err.to_string())?;
    if file.is_dir() {
        return Err(format!("entrada {name} não é um arquivo"));
    }
    if file.size() > max_bytes {
        return Err(format!(
            "entrada {name} excede o limite de {max_bytes} bytes"
        ));
    }
    let mut bytes = Vec::with_capacity(file.size().min(max_bytes) as usize);
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|err| err.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "entrada {name} excede o limite de {max_bytes} bytes"
        ));
    }
    String::from_utf8(bytes).map_err(|err| format!("entrada {name} não é UTF-8 válido: {err}"))
}

fn read_file_text_limited(path: &Path, max_bytes: u64) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|err| err.to_string())?;
    let size = file.metadata().map_err(|err| err.to_string())?.len();
    if size > max_bytes {
        return Err(format!(
            "{} excede o limite de {max_bytes} bytes",
            path.display()
        ));
    }
    let mut bytes = Vec::with_capacity(size.min(max_bytes) as usize);
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|err| err.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "{} excede o limite de {max_bytes} bytes",
            path.display()
        ));
    }
    String::from_utf8(bytes).map_err(|err| format!("{} não é UTF-8 válido: {err}", path.display()))
}

fn archive_entry_index<R: io::Read + io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Option<usize> {
    (0..archive.len()).find(|&index| {
        archive
            .by_index_raw(index)
            .map(|entry| zip_names_match(entry.name(), name))
            .unwrap_or(false)
    })
}

fn zip_names_match(entry_name: &str, wanted: &str) -> bool {
    entry_name.replace('\\', "/").eq_ignore_ascii_case(wanted)
}

/// Zip-slip protection: returns the safe relative path for a zip entry, or
/// None when the entry could escape the extraction root (absolute path, drive
/// letter, UNC prefix or any ".." component).
fn sanitized_zip_entry_path(entry_name: &str) -> Option<PathBuf> {
    let normalized = entry_name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains(':') {
        return None;
    }

    let mut result = PathBuf::new();
    for component in normalized.split('/') {
        match component {
            "" | "." => continue,
            ".." => return None,
            part if windows_zip_component_is_safe(part) => result.push(part),
            _ => return None,
        }
    }

    if result.as_os_str().is_empty() {
        return None;
    }
    Some(result)
}

// The package is installed only on Windows. Win32 normalizes several distinct
// ZIP names to the same filesystem object (for example `panel.js` and
// `panel.js.`), and DOS device names do not denote ordinary files at all.
fn windows_zip_component_is_safe(component: &str) -> bool {
    if component.ends_with('.') || component.ends_with(' ') {
        return false;
    }
    if component
        .chars()
        .any(|character| character < ' ' || matches!(character, '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return false;
    }

    let stem = component.split('.').next().unwrap_or_default();
    let stem = stem.to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) {
        return false;
    }
    if stem.len() == 4 {
        let bytes = stem.as_bytes();
        if (&bytes[..3] == b"COM" || &bytes[..3] == b"LPT") && matches!(bytes[3], b'1'..=b'9') {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{
        any_player_debug_mode_is_enabled, content_verifier_arguments, create_install_staging_dir,
        extract_zxp_to, fingerprint_is_trusted, install_work_root, is_sha256_hex,
        is_stale_install_leftover, list_install_backups, manifest_bundle_info,
        parse_trusted_certificates, player_debug_mode_is_enabled, random_suffix, read_archive_text,
        recover_interrupted_install, remove_install_work_path, require_regular_archive_entry,
        resolve_cep_content_verifier_in, sanitized_zip_entry_path, select_extension_status_target,
        signing_certificate_fingerprint, swap_into_place, system_extension_target_dirs_from,
        system_extensions_dir_from, validate_archive_limits_and_paths,
        verifier_output_has_success_marker, zip_names_match, CepContentTarget, CepContentVerifier,
        CEP_BUNDLE_ID, CONTENT_SIGNATURE_SUCCESS_MARKER, MAX_ZXP_ENTRIES,
        TRUSTED_CERTIFICATES_MANIFEST,
    };
    use serde::Deserialize;
    use std::ffi::OsString;
    use std::fs;
    use std::io::{Cursor, Write};
    use std::path::{Path, PathBuf};
    use zip::write::SimpleFileOptions;
    use zip::{ZipArchive, ZipWriter};

    const SIGNATURE_CASES: &str = include_str!("../../scripts/fixtures/cep-signature-cases.json");

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SignatureCasesFixture {
        cases: Vec<SignatureCase>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SignatureCase {
        id: String,
        should_pass: bool,
        expected_sha256: Option<String>,
        xml: String,
    }

    // Base64 of the ASCII bytes "arizona-cep-test-certificate-der"; the code
    // only decodes and hashes, so a stand-in DER blob exercises the same path.
    const TEST_CERTIFICATE_BASE64: &str = "YXJpem9uYS1jZXAtdGVzdC1jZXJ0aWZpY2F0ZS1kZXI=";
    const TEST_CERTIFICATE_FINGERPRINT: &str =
        "6b535e6469d6a6fe5907384ad671f5b6393caac8773dc2e5d21f5b1c99ecb133";
    // Base64 of "arizona-cep-OTHER-certificate-der".
    const OTHER_CERTIFICATE_BASE64: &str = "YXJpem9uYS1jZXAtT1RIRVItY2VydGlmaWNhdGUtZGVy";
    const OTHER_CERTIFICATE_FINGERPRINT: &str =
        "b3febc70763af4b1ddca9a25e5ae89dce54be588ac489cc0fe79c06782d7a041";

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "arizona-cep-manager-{label}-{}-{}",
                std::process::id(),
                random_suffix()
            ));
            fs::create_dir_all(&path).expect("test directory should be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = remove_install_work_path(&self.0);
        }
    }

    fn signatures_xml(certificates: &[&str]) -> String {
        let elements: String = certificates
            .iter()
            .map(|certificate| format!("<X509Certificate>{certificate}</X509Certificate>"))
            .collect();
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<Manifest xmlns="http://www.w3.org/2000/09/xmldsig#">
  <Signature Id="PackageSignature">
    <SignedInfo><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/></SignedInfo>
    <SignatureValue>ZmFrZQ==</SignatureValue>
    <KeyInfo><X509Data>{elements}</X509Data></KeyInfo>
  </Signature>
</Manifest>"#
        )
    }

    fn in_memory_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("test entry should start");
            writer
                .write_all(contents)
                .expect("test entry should be written");
        }
        writer
            .finish()
            .expect("test zip should finish")
            .into_inner()
    }

    fn in_memory_archive(entries: &[(&str, &[u8])]) -> ZipArchive<Cursor<Vec<u8>>> {
        ZipArchive::new(Cursor::new(in_memory_zip(entries))).expect("test zip should open")
    }

    fn create_install_layout(label: &str) -> (TestDirectory, PathBuf, PathBuf, PathBuf) {
        let root = TestDirectory::new(label);
        let extensions = root.path().join("Adobe").join("CEP").join("extensions");
        fs::create_dir_all(&extensions).expect("extensions directory should be created");
        let work_root = install_work_root(&extensions).expect("work root should resolve");
        fs::create_dir_all(&work_root).expect("work root should be created");
        let target = extensions.join(CEP_BUNDLE_ID);
        (root, extensions, work_root, target)
    }

    fn create_fake_verifier(root: &Path) -> CepContentVerifier {
        CepContentVerifier {
            powershell: root.join("powershell.exe"),
            script: root.join("installer/scripts/verify-zxp-content.ps1"),
            trusted_certificates: root.join("installer/cep-trusted-cert.json"),
        }
    }

    #[test]
    fn derives_a_stable_fingerprint_from_the_signing_certificate() {
        let fingerprint =
            signing_certificate_fingerprint(&signatures_xml(&[TEST_CERTIFICATE_BASE64]))
                .expect("signatures.xml should parse");
        assert_eq!(fingerprint, TEST_CERTIFICATE_FINGERPRINT);
    }

    #[test]
    fn ignores_whitespace_and_line_wrapping_inside_the_base64_payload() {
        let wrapped = "\n      YXJpem9uYS1jZXAtdGVzdC1j\n      ZXJ0aWZpY2F0ZS1kZXI=\n    ";
        let fingerprint = signing_certificate_fingerprint(&signatures_xml(&[wrapped]))
            .expect("wrapped base64 should parse");
        assert_eq!(fingerprint, TEST_CERTIFICATE_FINGERPRINT);
    }

    // ZXPSignCmd emits the XML-DSig elements under a prefix.
    #[test]
    fn finds_the_certificate_under_a_namespace_prefix() {
        let xml = format!(
            r#"<ds:Manifest xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ds:Signature><ds:KeyInfo><ds:X509Data>
    <ds:X509Certificate>{TEST_CERTIFICATE_BASE64}</ds:X509Certificate>
  </ds:X509Data></ds:KeyInfo></ds:Signature>
</ds:Manifest>"#
        );
        assert_eq!(
            signing_certificate_fingerprint(&xml).expect("prefixed signatures.xml should parse"),
            TEST_CERTIFICATE_FINGERPRINT
        );
    }

    #[test]
    fn rejects_multiple_certificates_instead_of_pinning_the_first() {
        assert!(signing_certificate_fingerprint(&signatures_xml(&[
            TEST_CERTIFICATE_BASE64,
            OTHER_CERTIFICATE_BASE64,
        ]))
        .is_err());
    }

    #[test]
    fn rejects_wrong_xmldsig_namespace_and_nested_certificate_markup() {
        for xml in [
            format!(
                "<Signature xmlns=\"urn:not-xmldsig\"><KeyInfo><X509Data><X509Certificate>{TEST_CERTIFICATE_BASE64}</X509Certificate></X509Data></KeyInfo></Signature>"
            ),
            format!(
                "<Signature xmlns=\"http://www.w3.org/2000/09/xmldsig#\"><KeyInfo><X509Data><X509Certificate><Chunk>{TEST_CERTIFICATE_BASE64}</Chunk></X509Certificate></X509Data></KeyInfo></Signature>"
            ),
        ] {
            assert!(signing_certificate_fingerprint(&xml).is_err());
        }
    }

    #[test]
    fn rejects_empty_keyinfo_and_x509data_decoys_anywhere_in_the_document() {
        for decoy in ["<KeyInfo/>", "<X509Data/>"] {
            let xml = signatures_xml(&[TEST_CERTIFICATE_BASE64]).replace(
                "  <Signature Id=\"PackageSignature\">",
                &format!("  {decoy}\n  <Signature Id=\"PackageSignature\">"),
            );
            assert!(
                signing_certificate_fingerprint(&xml).is_err(),
                "global decoy {decoy} must be rejected"
            );
        }
    }

    #[test]
    fn follows_the_shared_signature_contract_fixture() {
        let fixture: SignatureCasesFixture =
            serde_json::from_str(SIGNATURE_CASES).expect("shared signature fixture should parse");

        for case in fixture.cases {
            let result = signing_certificate_fingerprint(&case.xml);
            assert_eq!(
                result.is_ok(),
                case.should_pass,
                "shared case {:?} returned {result:?}",
                case.id
            );
            if case.should_pass {
                assert_eq!(
                    result.unwrap(),
                    case.expected_sha256
                        .expect("passing shared case should declare expectedSha256"),
                    "case {:?}",
                    case.id
                );
            } else {
                assert!(
                    case.expected_sha256.is_none(),
                    "rejected case {:?} must not declare a fingerprint",
                    case.id
                );
            }
        }
    }

    #[test]
    fn reports_malformed_signatures_instead_of_panicking() {
        for xml in [
            "",
            "not xml at all",
            "<Manifest><KeyInfo/></Manifest>",
            "<Manifest><X509Certificate></X509Certificate></Manifest>",
            "<Manifest><X509Certificate>   \n  </X509Certificate></Manifest>",
            "<Manifest><X509Certificate>not base64 !!!</X509Certificate></Manifest>",
        ] {
            assert!(
                signing_certificate_fingerprint(xml).is_err(),
                "{xml:?} must not yield a fingerprint"
            );
        }
    }

    #[test]
    fn accepts_only_fingerprints_present_in_the_trusted_list() {
        let trusted = vec![TEST_CERTIFICATE_FINGERPRINT.to_string()];
        assert!(fingerprint_is_trusted(
            TEST_CERTIFICATE_FINGERPRINT,
            &trusted
        ));
        assert!(!fingerprint_is_trusted(
            OTHER_CERTIFICATE_FINGERPRINT,
            &trusted
        ));
        assert!(!fingerprint_is_trusted(TEST_CERTIFICATE_FINGERPRINT, &[]));
    }

    #[test]
    fn parses_a_trusted_list_with_room_for_a_rotation() {
        let fingerprints = parse_trusted_certificates(&format!(
            r#"{{"schemaVersion":1,"certificates":[
                {{"id":"v1","sha256":"{TEST_CERTIFICATE_FINGERPRINT}","commonName":"Arizona"}},
                {{"id":"v2","sha256":"  {OTHER_CERTIFICATE_FINGERPRINT}  ","commonName":"Arizona"}}
            ]}}"#
        ))
        .expect("trusted list should parse");
        assert_eq!(
            fingerprints,
            vec![
                TEST_CERTIFICATE_FINGERPRINT.to_string(),
                OTHER_CERTIFICATE_FINGERPRINT.to_string(),
            ]
        );
    }

    #[test]
    fn rejects_trusted_lists_that_are_not_sha256_hex() {
        assert!(parse_trusted_certificates(r#"{"certificates":[{"sha256":"abc"}]}"#).is_err());
        assert!(parse_trusted_certificates(r#"{"certificates":[{"sha256":""}]}"#).is_err());
        assert!(parse_trusted_certificates("not json").is_err());
        assert!(parse_trusted_certificates(r#"{"certificates":[]}"#)
            .expect("an empty list is valid")
            .is_empty());
    }

    #[test]
    fn recognizes_lowercase_sha256_hex_only() {
        assert!(is_sha256_hex(TEST_CERTIFICATE_FINGERPRINT));
        assert!(!is_sha256_hex(&TEST_CERTIFICATE_FINGERPRINT.to_uppercase()));
        assert!(!is_sha256_hex(&TEST_CERTIFICATE_FINGERPRINT[..63]));
        assert!(!is_sha256_hex(&format!("{TEST_CERTIFICATE_FINGERPRINT}0")));
    }

    // Guards the shipped pin: a manifest that does not parse would silently
    // fail closed at runtime, so the breakage has to surface here.
    #[test]
    fn the_embedded_trusted_certificate_manifest_parses() {
        parse_trusted_certificates(TRUSTED_CERTIFICATES_MANIFEST)
            .expect("INSTALLER/cep-trusted-cert.json must be a valid pinned manifest");
    }

    #[test]
    fn resolves_only_absolute_regular_verifier_resources() {
        let root = TestDirectory::new("verifier-resources");
        let resource_dir = root.path().join("resources");
        let system_root = root.path().join("Windows");
        let powershell = system_root
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        let script = resource_dir
            .join("installer")
            .join("scripts")
            .join("verify-zxp-content.ps1");
        let trusted = resource_dir.join("installer").join("cep-trusted-cert.json");
        fs::create_dir_all(powershell.parent().expect("PowerShell has a parent"))
            .expect("PowerShell parent should be created");
        fs::create_dir_all(script.parent().expect("script has a parent"))
            .expect("script parent should be created");
        fs::write(&powershell, b"fake executable").expect("PowerShell fixture should be written");
        fs::write(&script, b"fake script").expect("script fixture should be written");
        fs::write(&trusted, b"{}").expect("pin fixture should be written");

        let verifier = resolve_cep_content_verifier_in(&resource_dir, &system_root)
            .expect("complete absolute resources should resolve");
        assert_eq!(verifier.powershell, powershell);
        assert_eq!(verifier.script, script);
        assert_eq!(verifier.trusted_certificates, trusted);

        fs::remove_file(&verifier.script).expect("script fixture should be removable");
        let error = resolve_cep_content_verifier_in(&resource_dir, &system_root)
            .expect_err("a missing verifier script must fail closed");
        assert!(error.starts_with("cep_zxp_signature_invalid:"));
        assert!(error.contains("verify-zxp-content.ps1"));
    }

    #[test]
    fn builds_powershell_arguments_as_separate_values_for_both_targets() {
        let root = TestDirectory::new("verifier-arguments");
        let verifier = create_fake_verifier(root.path());
        let zxp = root.path().join("signed package.zxp");
        let directory = root.path().join("staged content");

        let zxp_arguments = content_verifier_arguments(&verifier, CepContentTarget::Zxp(&zxp))
            .expect("ZXP arguments should build");
        assert_eq!(
            zxp_arguments,
            vec![
                OsString::from("-NoProfile"),
                OsString::from("-NonInteractive"),
                OsString::from("-ExecutionPolicy"),
                OsString::from("Bypass"),
                OsString::from("-File"),
                verifier.script.as_os_str().to_os_string(),
                OsString::from("-ZxpPath"),
                zxp.as_os_str().to_os_string(),
                OsString::from("-TrustedCertPath"),
                verifier.trusted_certificates.as_os_str().to_os_string(),
            ]
        );

        let directory_arguments =
            content_verifier_arguments(&verifier, CepContentTarget::Directory(&directory))
                .expect("directory arguments should build");
        assert_eq!(directory_arguments[6], OsString::from("-Directory"));
        assert_eq!(directory_arguments[7], directory.as_os_str());
    }

    #[test]
    fn requires_the_verifiers_explicit_success_marker() {
        let output = format!("preflight complete\r\n{CONTENT_SIGNATURE_SUCCESS_MARKER} abc123\r\n");
        assert!(verifier_output_has_success_marker(output.as_bytes()));

        let utf16_output: Vec<u8> = output.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert!(verifier_output_has_success_marker(&utf16_output));
        assert!(!verifier_output_has_success_marker(
            b"PowerShell exited successfully without verification"
        ));
    }

    #[test]
    fn accepts_safe_zip_entry_paths() {
        assert_eq!(
            sanitized_zip_entry_path("CSXS/manifest.xml"),
            Some(PathBuf::from("CSXS").join("manifest.xml"))
        );
        assert_eq!(
            sanitized_zip_entry_path("./js/main.js"),
            Some(PathBuf::from("js").join("main.js"))
        );
        assert_eq!(
            sanitized_zip_entry_path("assets/"),
            Some(PathBuf::from("assets"))
        );
        assert_eq!(
            sanitized_zip_entry_path("META-INF\\signatures.xml"),
            Some(PathBuf::from("META-INF").join("signatures.xml"))
        );
    }

    #[test]
    fn rejects_ambiguous_or_unsafe_archive_entry_names() {
        for entries in [
            vec![
                ("CSXS/manifest.xml", &b"one"[..]),
                ("csxs\\MANIFEST.XML", &b"two"[..]),
            ],
            vec![("../manifest.xml", &b"bad"[..])],
        ] {
            let mut archive = in_memory_archive(&entries);
            assert!(validate_archive_limits_and_paths(&mut archive).is_err());
        }
    }

    #[test]
    fn limits_archive_entry_count_before_extraction() {
        let names: Vec<String> = (0..=MAX_ZXP_ENTRIES)
            .map(|index| format!("files/{index}.txt"))
            .collect();
        let entries: Vec<(&str, &[u8])> =
            names.iter().map(|name| (name.as_str(), &b""[..])).collect();
        let mut archive = in_memory_archive(&entries);
        assert!(validate_archive_limits_and_paths(&mut archive).is_err());
    }

    #[test]
    fn enforces_metadata_limits_and_requires_debug_as_a_file() {
        let mut archive = in_memory_archive(&[("CSXS/manifest.xml", b"12345"), (".debug", b"ok")]);
        assert!(read_archive_text(&mut archive, "CSXS/manifest.xml", 4).is_err());
        assert!(require_regular_archive_entry(&mut archive, ".debug").is_ok());
        assert!(require_regular_archive_entry(&mut archive, "missing").is_err());
    }

    #[test]
    fn rejects_zip_entries_that_escape_the_extraction_root() {
        for name in [
            "../evil.js",
            "a/../../evil.js",
            "a\\..\\..\\evil.js",
            "/absolute.js",
            "\\absolute.js",
            "C:\\Windows\\evil.js",
            "C:/Windows/evil.js",
            "\\\\server\\share\\evil.js",
            "..",
            "",
            ".",
            "./",
            "assets/panel.js.",
            "assets/panel.js ",
            "NUL",
            "nul.txt",
            "COM1.log",
            "nested/LPT9",
            "CONIN$/file.js",
            "assets/bad<name.js",
        ] {
            assert_eq!(
                sanitized_zip_entry_path(name),
                None,
                "{name:?} must be rejected"
            );
        }
    }

    #[test]
    fn extraction_never_overwrites_an_existing_destination_file() {
        let root = TestDirectory::new("create-new");
        let archive_path = root.path().join("input.zxp");
        let destination = root.path().join("destination");
        let existing = destination.join("js").join("main.js");
        fs::create_dir_all(existing.parent().expect("existing file has a parent"))
            .expect("destination should be created");
        fs::write(&existing, b"original").expect("existing file should be written");
        fs::write(
            &archive_path,
            in_memory_zip(&[("js/main.js", b"replacement")]),
        )
        .expect("test ZXP should be written");

        assert!(extract_zxp_to(&archive_path, &destination).is_err());
        assert_eq!(
            fs::read(&existing).expect("existing file should remain readable"),
            b"original"
        );
    }

    #[test]
    fn parses_bundle_id_and_version_from_the_manifest_root() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest Version="11.0" ExtensionBundleId="com.arizona-carrefour.cep" ExtensionBundleVersion="1.4.2" ExtensionBundleName="Arizona">
    <ExtensionList><Extension Id="com.arizona-carrefour.cep.panel" Version="1.4.2"/></ExtensionList>
</ExtensionManifest>"#;

        let info = manifest_bundle_info(xml).expect("manifest should parse");
        assert_eq!(info.bundle_id.as_deref(), Some("com.arizona-carrefour.cep"));
        assert_eq!(info.version.as_deref(), Some("1.4.2"));
    }

    #[test]
    fn treats_missing_manifest_attributes_as_absent() {
        let info = manifest_bundle_info(r#"<ExtensionManifest Version="11.0"/>"#)
            .expect("manifest should parse");
        assert_eq!(info.bundle_id, None);
        assert_eq!(info.version, None);
    }

    #[test]
    fn rejects_xml_whose_root_is_not_an_extension_manifest() {
        assert!(manifest_bundle_info("<Workbook/>").is_err());
        assert!(manifest_bundle_info("not xml at all").is_err());
    }

    #[test]
    fn debug_mode_requires_the_literal_string_one() {
        assert!(player_debug_mode_is_enabled(Some("1")));
        assert!(player_debug_mode_is_enabled(Some(" 1 ")));
        assert!(!player_debug_mode_is_enabled(Some("0")));
        assert!(!player_debug_mode_is_enabled(Some("true")));
        assert!(!player_debug_mode_is_enabled(Some("")));
        assert!(!player_debug_mode_is_enabled(None));
    }

    #[test]
    fn debug_mode_status_is_enabled_when_any_csxs_value_is_enabled() {
        assert!(any_player_debug_mode_is_enabled(&[
            None,
            Some("1".to_string()),
        ]));
        assert!(any_player_debug_mode_is_enabled(&[
            Some("1".to_string()),
            Some("0".to_string()),
        ]));
        assert!(!any_player_debug_mode_is_enabled(&[
            None,
            Some("0".to_string()),
        ]));
    }

    #[test]
    fn matches_zip_entry_names_across_separators_and_case() {
        assert!(zip_names_match("CSXS/manifest.xml", "CSXS/manifest.xml"));
        assert!(zip_names_match("CSXS\\manifest.xml", "CSXS/manifest.xml"));
        assert!(zip_names_match("csxs/MANIFEST.XML", "CSXS/manifest.xml"));
        assert!(!zip_names_match(
            "CSXS/manifest.xml.bak",
            "CSXS/manifest.xml"
        ));
    }

    #[test]
    fn recognizes_only_this_bundles_install_leftovers() {
        assert!(is_stale_install_leftover("com.arizona-carrefour.cep.bak"));
        assert!(is_stale_install_leftover(
            "com.arizona-carrefour.cep.bak-20260804"
        ));
        assert!(is_stale_install_leftover(
            "com.arizona-carrefour.cep.tmp-1234"
        ));
        assert!(!is_stale_install_leftover("com.arizona-carrefour.cep"));
        assert!(!is_stale_install_leftover("com.other.extension"));
        assert!(!is_stale_install_leftover("com.other.extension.bak"));
    }

    #[test]
    fn install_work_paths_are_siblings_of_the_scanned_extensions_directory() {
        let (_root, extensions, work_root, _target) = create_install_layout("work-root");

        assert_eq!(work_root.parent(), extensions.parent());
        assert!(!work_root.starts_with(&extensions));

        let staging = create_install_staging_dir(&work_root)
            .expect("staging directory should be created outside extensions");
        assert_eq!(staging.parent(), Some(work_root.as_path()));
        assert!(!staging.starts_with(&extensions));
        assert!(staging
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(&format!("{CEP_BUNDLE_ID}.tmp-"))));
    }

    #[test]
    fn system_status_roots_are_deduplicated_with_x64_before_x86() {
        let full_root = PathBuf::from(r"C:\Program Files\Common Files");
        let full_alias = OsString::from(r"c:/program files/common files/");
        let x86_root = PathBuf::from(r"C:\Program Files (x86)\Common Files");

        let targets = system_extension_target_dirs_from(
            Some(full_root.as_os_str().to_os_string()),
            Some(full_alias),
            Some(x86_root.as_os_str().to_os_string()),
        );

        assert_eq!(
            targets,
            vec![
                system_extensions_dir_from(&full_root).join(CEP_BUNDLE_ID),
                system_extensions_dir_from(&x86_root).join(CEP_BUNDLE_ID),
            ]
        );
    }

    #[test]
    fn status_prefers_user_then_system_x64_then_legacy_x86() {
        let user = PathBuf::from(r"C:\Users\Arizona\AppData\Roaming\Adobe\CEP\extensions")
            .join(CEP_BUNDLE_ID);
        let full = system_extensions_dir_from(Path::new(r"C:\Program Files\Common Files"))
            .join(CEP_BUNDLE_ID);
        let x86 = system_extensions_dir_from(Path::new(r"C:\Program Files (x86)\Common Files"))
            .join(CEP_BUNDLE_ID);

        assert_eq!(
            select_extension_status_target(
                &user,
                true,
                &[(full.clone(), true), (x86.clone(), true)]
            ),
            user
        );
        assert_eq!(
            select_extension_status_target(
                &user,
                false,
                &[(full.clone(), true), (x86.clone(), true)]
            ),
            full
        );
        assert_eq!(
            select_extension_status_target(
                &user,
                false,
                &[(full.clone(), false), (x86.clone(), true)]
            ),
            x86
        );
        assert_eq!(
            select_extension_status_target(&user, false, &[(full, false), (x86, false)]),
            user
        );
    }

    #[test]
    fn restores_the_exact_backup_after_a_crash_between_the_two_renames() {
        let (_root, extensions, work_root, target) = create_install_layout("recover-backup");
        let backup = work_root.join(format!("{CEP_BUNDLE_ID}.bak-crash"));
        let temporary = work_root.join(format!("{CEP_BUNDLE_ID}.tmp-abandoned"));
        fs::create_dir_all(&backup).expect("backup should be created");
        fs::create_dir_all(&temporary).expect("temporary directory should be created");
        fs::write(backup.join("marker.txt"), b"previous").expect("backup marker should be written");

        recover_interrupted_install(&extensions, &work_root, &target)
            .expect("the interrupted install should recover");

        assert_eq!(
            fs::read(target.join("marker.txt")).expect("target should be restored"),
            b"previous"
        );
        assert!(fs::symlink_metadata(&backup).is_err());
        assert!(fs::symlink_metadata(&temporary).is_err());
        assert!(list_install_backups(&extensions)
            .expect("legacy backup scan should succeed")
            .is_empty());
        assert!(list_install_backups(&work_root)
            .expect("work backup scan should succeed")
            .is_empty());
    }

    #[test]
    fn ambiguous_backups_are_preserved_when_no_live_target_exists() {
        let (_root, extensions, work_root, target) = create_install_layout("ambiguous-backups");
        let backup_a = work_root.join(format!("{CEP_BUNDLE_ID}.bak-a"));
        let backup_b = work_root.join(format!("{CEP_BUNDLE_ID}.bak-b"));
        fs::create_dir_all(&backup_a).expect("first backup should be created");
        fs::create_dir_all(&backup_b).expect("second backup should be created");

        let error = recover_interrupted_install(&extensions, &work_root, &target)
            .expect_err("ambiguous recovery must fail closed");

        assert!(error.contains("2 backups"));
        assert!(backup_a.is_dir());
        assert!(backup_b.is_dir());
        assert!(fs::symlink_metadata(&target).is_err());
    }

    #[test]
    fn completed_commit_recovery_keeps_target_and_cleans_all_leftovers() {
        let (_root, extensions, work_root, target) =
            create_install_layout("cleanup-completed-swap");
        let legacy_backup = extensions.join(format!("{CEP_BUNDLE_ID}.bak"));
        let current_backup = work_root.join(format!("{CEP_BUNDLE_ID}.bak-current"));
        let legacy_temporary = extensions.join(format!("{CEP_BUNDLE_ID}.tmp-legacy"));
        let current_temporary = work_root.join(format!("{CEP_BUNDLE_ID}.tmp-current"));
        fs::create_dir_all(&target).expect("target should be created");
        fs::write(target.join("marker.txt"), b"current").expect("target marker should be written");
        for leftover in [
            &legacy_backup,
            &current_backup,
            &legacy_temporary,
            &current_temporary,
        ] {
            fs::create_dir_all(leftover).expect("leftover should be created");
        }

        recover_interrupted_install(&extensions, &work_root, &target)
            .expect("completed commit recovery should clean leftovers");

        assert_eq!(
            fs::read(target.join("marker.txt")).expect("live target should be preserved"),
            b"current"
        );
        for leftover in [
            legacy_backup,
            current_backup,
            legacy_temporary,
            current_temporary,
        ] {
            assert!(
                fs::symlink_metadata(&leftover).is_err(),
                "{} should be cleaned",
                leftover.display()
            );
        }
    }

    #[test]
    fn failed_commit_restores_the_previous_target() {
        let (_root, extensions, work_root, target) =
            create_install_layout("rollback-failed-commit");
        let missing_temp = work_root.join(format!("{CEP_BUNDLE_ID}.tmp-missing"));
        fs::create_dir_all(&target).expect("target should be created");
        fs::write(target.join("marker.txt"), b"previous").expect("target marker should be written");

        let error = swap_into_place(&extensions, &work_root, &target, &missing_temp)
            .expect_err("a missing staging directory must fail the commit");

        assert!(error.contains("versão anterior foi restaurada"));
        assert_eq!(
            fs::read(target.join("marker.txt")).expect("previous target should be restored"),
            b"previous"
        );
        assert!(list_install_backups(&extensions)
            .expect("legacy backup scan should succeed")
            .is_empty());
        assert!(list_install_backups(&work_root)
            .expect("work backup scan should succeed")
            .is_empty());
    }

    #[test]
    fn successful_commit_removes_every_backup_without_duplicate_extensions() {
        let (_root, extensions, work_root, target) = create_install_layout("successful-commit");
        let temporary = create_install_staging_dir(&work_root)
            .expect("staging directory should be created in work root");
        let legacy_backup = extensions.join(format!("{CEP_BUNDLE_ID}.bak-legacy"));
        let stale_work_backup = work_root.join(format!("{CEP_BUNDLE_ID}.bak-stale"));
        fs::create_dir_all(&target).expect("previous target should be created");
        fs::write(target.join("marker.txt"), b"previous")
            .expect("previous marker should be written");
        fs::write(temporary.join("marker.txt"), b"new").expect("new marker should be written");
        fs::create_dir_all(&legacy_backup).expect("legacy backup should be created");
        fs::create_dir_all(&stale_work_backup).expect("stale work backup should be created");

        swap_into_place(&extensions, &work_root, &target, &temporary)
            .expect("commit and cleanup should succeed");

        assert_eq!(
            fs::read(target.join("marker.txt")).expect("new target should be active"),
            b"new"
        );
        assert!(fs::symlink_metadata(&temporary).is_err());
        assert!(
            list_install_backups(&extensions)
                .expect("legacy backup scan should succeed")
                .is_empty(),
            "a successful commit must leave no duplicate bundle in extensions"
        );
        assert!(
            list_install_backups(&work_root)
                .expect("work backup scan should succeed")
                .is_empty(),
            "a successful commit must leave no retained transaction backup"
        );
    }

    #[test]
    fn cleanup_failure_is_reported_after_commit_and_preserves_the_backup() {
        let (root, _extensions, work_root, target) =
            create_install_layout("commit-cleanup-failure");
        let temporary = create_install_staging_dir(&work_root)
            .expect("staging directory should be created in work root");
        let unreadable_extensions = root.path().join("extensions-is-a-file");
        fs::write(&unreadable_extensions, b"not a directory")
            .expect("fault injection file should be created");
        fs::create_dir_all(&target).expect("previous target should be created");
        fs::write(target.join("marker.txt"), b"previous")
            .expect("previous marker should be written");
        fs::write(temporary.join("marker.txt"), b"new").expect("new marker should be written");

        let error = swap_into_place(&unreadable_extensions, &work_root, &target, &temporary)
            .expect_err("cleanup failure must prevent a success result");

        assert!(error.contains("listar backups"));
        assert_eq!(
            fs::read(target.join("marker.txt")).expect("new target should remain active"),
            b"new"
        );
        let retained =
            list_install_backups(&work_root).expect("retained work backup should be discoverable");
        assert_eq!(retained.len(), 1);
        assert_eq!(
            fs::read(retained[0].join("marker.txt")).expect("backup should remain intact"),
            b"previous"
        );
    }
}
