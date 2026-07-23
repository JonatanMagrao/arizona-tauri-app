use serde::Deserialize;
use std::time::Duration;

use crate::{read_secure_auth_record, secure_auth_entry};

const SUPABASE_URL: &str = "https://nizchnscqkixawqxrwzd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_BaGu8kZnq6kjnmF8H6ehQw_J-CcfT0G";

const EXIT_OK: i32 = 0;
const EXIT_NO_SECURE_SESSION: i32 = 21;
const EXIT_REMOTE_RELEASE_FAILED: i32 = 22;
const EXIT_LOCAL_AUTH_CLEAR_FAILED: i32 = 23;
const UNINSTALL_HTTP_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Deserialize)]
struct RefreshTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct ReleaseDeviceResponse {
    ok: bool,
}

pub fn release_device_for_uninstall_cli() -> i32 {
    match release_device_for_uninstall() {
        Ok(ReleaseOutcome::Released) => EXIT_OK,
        Ok(ReleaseOutcome::NoSecureSession) => EXIT_NO_SECURE_SESSION,
        Err(error) => {
            eprintln!("Unable to release the Arizona device during uninstall: {error}");
            EXIT_REMOTE_RELEASE_FAILED
        }
    }
}

pub fn clear_local_auth_for_uninstall_cli() -> i32 {
    match clear_local_auth() {
        Ok(()) => EXIT_OK,
        Err(error) => {
            eprintln!("Unable to clear Arizona secure auth during uninstall: {error}");
            EXIT_LOCAL_AUTH_CLEAR_FAILED
        }
    }
}

enum ReleaseOutcome {
    Released,
    NoSecureSession,
}

fn release_device_for_uninstall() -> Result<ReleaseOutcome, String> {
    let entry = secure_auth_entry()?;
    let Some(mut secure_auth) = read_secure_auth_record(&entry)? else {
        return Ok(ReleaseOutcome::NoSecureSession);
    };

    let refresh_token = secure_auth.refresh_token.trim();
    if refresh_token.is_empty() {
        return Ok(ReleaseOutcome::NoSecureSession);
    }

    let agent = ureq::AgentBuilder::new()
        .timeout(UNINSTALL_HTTP_TIMEOUT)
        .build();
    let token_url = format!("{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token");
    let token_response = agent
        .post(&token_url)
        .set("apikey", SUPABASE_PUBLISHABLE_KEY)
        .set("content-type", "application/json")
        .send_json(serde_json::json!({ "refresh_token": refresh_token }))
        .map_err(|error| request_error("refresh the uninstall session", error))?
        .into_json::<RefreshTokenResponse>()
        .map_err(|error| format!("Unable to read the refreshed uninstall session: {error}"))?;

    if token_response.access_token.trim().is_empty() {
        return Err("The refreshed uninstall session has no access token.".to_string());
    }

    if let Some(rotated_refresh_token) = token_response
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        secure_auth.refresh_token = rotated_refresh_token.to_string();
        let value = serde_json::to_vec(&secure_auth).map_err(|error| {
            format!("Unable to preserve the rotated uninstall session: {error}")
        })?;
        entry.set_secret(&value).map_err(|error| {
            format!("Unable to preserve the rotated uninstall session: {error}")
        })?;
    }

    let access_token = token_response.access_token.trim();
    let release_url = format!("{SUPABASE_URL}/functions/v1/app-release-device");
    let self_release = agent
        .post(&release_url)
        .set("apikey", SUPABASE_PUBLISHABLE_KEY)
        .set("authorization", &format!("Bearer {access_token}"))
        .set("content-type", "application/json")
        .send_json(serde_json::json!({ "source": "nsis_uninstall" }));

    let release_response = match self_release {
        Ok(response) => read_release_response(response)?,
        // Allows administrators to uninstall during a phased rollout before
        // app-release-device is deployed. Authorization is still enforced by
        // the existing admin-release-device Edge Function.
        Err(ureq::Error::Status(404, _)) => {
            release_device_through_admin_endpoint(&agent, &secure_auth, access_token)?
        }
        Err(error) => return Err(request_error("release the device", error)),
    };

    if !release_response.ok {
        return Err("The device release endpoint did not confirm the operation.".to_string());
    }

    clear_local_auth()?;
    Ok(ReleaseOutcome::Released)
}

fn release_device_through_admin_endpoint(
    agent: &ureq::Agent,
    secure_auth: &crate::SecureAuthRecord,
    access_token: &str,
) -> Result<ReleaseDeviceResponse, String> {
    let organization_id = secure_auth
        .organization_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The secure session has no organization id.".to_string())?;
    let member_id = secure_auth
        .member_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The secure session has no member id.".to_string())?;

    let release_url = format!("{SUPABASE_URL}/functions/v1/admin-release-device");
    let response = agent
        .post(&release_url)
        .set("apikey", SUPABASE_PUBLISHABLE_KEY)
        .set("authorization", &format!("Bearer {access_token}"))
        .set("content-type", "application/json")
        .send_json(serde_json::json!({
            "organizationId": organization_id,
            "memberId": member_id,
        }))
        .map_err(|error| request_error("release the device as administrator", error))?;

    read_release_response(response)
}

fn read_release_response(response: ureq::Response) -> Result<ReleaseDeviceResponse, String> {
    response
        .into_json::<ReleaseDeviceResponse>()
        .map_err(|error| format!("Unable to read the device release response: {error}"))
}

fn clear_local_auth() -> Result<(), String> {
    let entry = secure_auth_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Unable to delete the secure session: {error}")),
    }
}

fn request_error(action: &str, error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(status, _) => {
            format!("Unable to {action}: server returned HTTP {status}.")
        }
        ureq::Error::Transport(_) => {
            format!("Unable to {action}: network connection failed.")
        }
    }
}
