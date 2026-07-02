use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::license::LicenseStatus;

pub const PROTOCOL_VERSION: &str = "arizona.cep.v1";
pub const SESSION_FILE_NAME: &str = "cep-bridge-session.json";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSessionFile {
    pub protocol_version: String,
    pub endpoint: String,
    pub ws_url: String,
    pub port: u16,
    pub token: String,
    pub started_at: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub id: Option<String>,
    pub protocol_version: Option<String>,
    pub client: Option<ClientHello>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientHello {
    pub name: Option<String>,
    pub version: Option<String>,
}

pub fn parse_client_message(text: &str) -> Result<ClientMessage, String> {
    serde_json::from_str(text).map_err(|err| format!("invalid_json: {err}"))
}

pub fn server_hello(bridge_id: &str, seq: u64) -> Value {
    json!({
        "type": "bridge.hello",
        "protocolVersion": PROTOCOL_VERSION,
        "bridgeId": bridge_id,
        "seq": seq
    })
}

pub fn license_status(seq: u64, license: LicenseStatus) -> Value {
    json!({
        "type": "license.status",
        "protocolVersion": PROTOCOL_VERSION,
        "seq": seq,
        "license": license
    })
}

pub fn blocked(seq: u64, reason: impl Into<String>, license: LicenseStatus) -> Value {
    json!({
        "type": "blocked",
        "protocolVersion": PROTOCOL_VERSION,
        "seq": seq,
        "reason": reason.into(),
        "license": license
    })
}

pub fn error(
    seq: u64,
    id: Option<String>,
    code: impl Into<String>,
    message: impl Into<String>,
) -> Value {
    json!({
        "type": "error",
        "protocolVersion": PROTOCOL_VERSION,
        "seq": seq,
        "id": id,
        "code": code.into(),
        "message": message.into()
    })
}

pub fn encode(value: Value) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|err| err.to_string())
}
