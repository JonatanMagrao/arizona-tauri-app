use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;

pub const AE_PANEL_FEATURE: &str = "ae_panel";
pub const AE_BRIDGE_FEATURE: &str = "ae_bridge";

#[derive(Clone, Debug, Default)]
pub struct LicenseInput {
    pub has_access_token: bool,
    pub email: String,
    pub member_id: Option<String>,
    pub role: Option<String>,
    pub organization_id: Option<String>,
    pub organization_name: Option<String>,
    pub seats_allowed: Option<i64>,
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub licensed: bool,
    pub reason: String,
    pub email: Option<String>,
    pub member_id: Option<String>,
    pub role: Option<String>,
    pub organization_id: Option<String>,
    pub organization_name: Option<String>,
    pub seats_allowed: Option<i64>,
    pub expires_at: Option<String>,
    pub allowed_features: Vec<String>,
    pub checked_at: String,
}

impl LicenseStatus {
    pub fn no_session() -> Self {
        Self {
            licensed: false,
            reason: "no_session".to_string(),
            email: None,
            member_id: None,
            role: None,
            organization_id: None,
            organization_name: None,
            seats_allowed: None,
            expires_at: None,
            allowed_features: Vec::new(),
            checked_at: now_iso(),
        }
    }

    pub fn from_input(input: LicenseInput) -> Self {
        let email = clean_required(input.email);
        let member_id = clean_optional(input.member_id);
        let role = clean_optional(input.role);
        let organization_id = clean_optional(input.organization_id);
        let organization_name = clean_optional(input.organization_name);
        let expires_at = clean_optional(input.expires_at);

        let reason = if !input.has_access_token {
            "invalid_session"
        } else if email.is_none() {
            "missing_email"
        } else if member_id.is_none() {
            "missing_member"
        } else if organization_id.is_none() {
            "missing_organization"
        } else if expires_at_is_past(expires_at.as_deref()) {
            "expired"
        } else {
            "valid"
        };

        let licensed = reason == "valid";
        let allowed_features = if licensed {
            vec![AE_PANEL_FEATURE.to_string(), AE_BRIDGE_FEATURE.to_string()]
        } else {
            Vec::new()
        };

        Self {
            licensed,
            reason: reason.to_string(),
            email,
            member_id,
            role,
            organization_id,
            organization_name,
            seats_allowed: input.seats_allowed,
            expires_at,
            allowed_features,
            checked_at: now_iso(),
        }
    }
}

fn clean_required(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn expires_at_is_past(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };

    DateTime::parse_from_rfc3339(value)
        .map(|expires_at| expires_at.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(true)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
