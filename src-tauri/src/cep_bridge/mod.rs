use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::license::LicenseStatus;

// Nome do arquivo de sessao do antigo bridge WebSocket. O canal atual e o
// arquivo cep-license-receipt.json; este nome so existe para limpar o arquivo
// legado de maquinas que rodaram versoes antigas (ver lib.rs).
pub const SESSION_FILE_NAME: &str = "cep-bridge-session.json";

#[derive(Clone)]
pub struct CepBridgeState {
    inner: Arc<Mutex<BridgeInner>>,
}

struct BridgeInner {
    license: LicenseStatus,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub license: LicenseStatus,
    pub last_error: Option<String>,
}

impl CepBridgeState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(BridgeInner {
                license: LicenseStatus::no_session(),
                last_error: None,
            })),
        }
    }

    pub fn status(&self) -> BridgeStatus {
        let inner = self.lock_inner();
        BridgeStatus {
            license: inner.license.clone(),
            last_error: inner.last_error.clone(),
        }
    }

    pub fn set_license_status(&self, license: LicenseStatus) {
        self.lock_inner().license = license;
    }

    pub fn set_last_error(&self, error: impl Into<String>) {
        self.lock_inner().last_error = Some(error.into());
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, BridgeInner> {
        self.inner.lock().unwrap_or_else(|err| err.into_inner())
    }
}
