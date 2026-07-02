use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::Serialize;

use crate::license::LicenseStatus;

pub const SESSION_FILE_NAME: &str = "cep-bridge-session.json";
const PROTOCOL_VERSION: &str = "arizona.cep.v1";

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
    pub running: bool,
    pub protocol_version: String,
    pub endpoint: Option<String>,
    pub port: Option<u16>,
    pub session_file_path: Option<PathBuf>,
    pub started_at: Option<String>,
    pub connected_client: Option<ConnectedClient>,
    pub license: LicenseStatus,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedClient {
    pub id: String,
    pub name: Option<String>,
    pub version: Option<String>,
    pub connected_at: String,
    pub last_seen_at: String,
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
            running: false,
            protocol_version: PROTOCOL_VERSION.to_string(),
            endpoint: None,
            port: None,
            session_file_path: None,
            started_at: None,
            connected_client: None,
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

    pub fn license(&self) -> LicenseStatus {
        self.lock_inner().license.clone()
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, BridgeInner> {
        self.inner.lock().unwrap_or_else(|err| err.into_inner())
    }
}
