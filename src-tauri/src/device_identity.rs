use sha2::{Digest, Sha256};

const FINGERPRINT_PREFIX: &str = "arizona-device-fp:v1";

/// Shared contract with the backend: lowercase hex SHA-256 of
/// "arizona-device-fp:v1:{MachineGuid}", or "" when the guid is unavailable.
pub fn device_fingerprint_hash() -> String {
    machine_guid()
        .map(|guid| fingerprint_hash_for_guid(&guid))
        .unwrap_or_default()
}

fn fingerprint_hash_for_guid(machine_guid: &str) -> String {
    let digest = Sha256::digest(format!("{FINGERPRINT_PREFIX}:{machine_guid}"));
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(windows)]
fn machine_guid() -> Option<String> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
    use winreg::RegKey;

    let guid: String = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(
            "SOFTWARE\\Microsoft\\Cryptography",
            KEY_READ | KEY_WOW64_64KEY,
        )
        .ok()?
        .get_value("MachineGuid")
        .ok()?;
    let guid = guid.trim().to_string();
    (!guid.is_empty()).then_some(guid)
}

#[cfg(not(windows))]
fn machine_guid() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::fingerprint_hash_for_guid;

    #[test]
    fn produces_64_lowercase_hex_characters() {
        let hash = fingerprint_hash_for_guid("12345678-90ab-cdef-1234-567890abcdef");
        assert_eq!(hash.len(), 64);
        assert!(hash
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase()));
    }

    #[test]
    fn matches_the_shared_fingerprint_contract_vector() {
        assert_eq!(
            fingerprint_hash_for_guid("12345678-90ab-cdef-1234-567890abcdef"),
            "05f7acd04695d96f63d0de2bc48b5ab7dd2b1382aaf2e4a90e72e9cd4ef56b63"
        );
    }

    #[test]
    fn is_stable_for_the_same_machine_guid() {
        assert_eq!(
            fingerprint_hash_for_guid("guid-a"),
            fingerprint_hash_for_guid("guid-a")
        );
        assert_ne!(
            fingerprint_hash_for_guid("guid-a"),
            fingerprint_hash_for_guid("guid-b")
        );
    }
}
