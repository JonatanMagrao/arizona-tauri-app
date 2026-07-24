use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fmt, time::Duration};

pub const SUPABASE_URL: &str = "https://nizchnscqkixawqxrwzd.supabase.co";
pub const SUPABASE_PUBLISHABLE_KEY: &str = "sb_publishable_BaGu8kZnq6kjnmF8H6ehQw_J-CcfT0G";
const API_TIMEOUT: Duration = Duration::from_secs(20);
const TOTP_ISSUER: &str = "Arizona App";

#[derive(Clone, Debug, Deserialize)]
pub struct RemoteSession {
    pub access_token: String,
    pub refresh_token: String,
    #[serde(default)]
    pub user: Option<RemoteUser>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RemoteUser {
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub factors: Vec<Factor>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ActivationExchange {
    #[serde(rename = "tokenHash")]
    pub token_hash: String,
    #[serde(rename = "tokenType")]
    pub token_type: String,
    #[serde(default)]
    pub recovery: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Factor {
    pub id: String,
    #[serde(default)]
    pub factor_type: String,
    #[serde(default)]
    pub status: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct EnrollFactorResponse {
    pub id: String,
    pub totp: EnrolledTotp,
}

#[derive(Clone, Debug, Deserialize)]
pub struct EnrolledTotp {
    pub qr_code: String,
    pub secret: String,
    #[serde(default)]
    pub uri: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpEnrollment {
    pub factor_id: String,
    pub qr_code: String,
    pub secret: String,
    pub uri: String,
}

#[derive(Clone, Debug, Deserialize)]
struct ChallengeResponse {
    pub id: String,
}

#[derive(Clone, Debug)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub retry_after_seconds: Option<u64>,
}

impl ApiError {
    fn protocol(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retry_after_seconds: None,
        }
    }

    pub fn is_definitive_license_denial(&self) -> bool {
        matches!(
            self.code.as_str(),
            "member_not_authorized"
                | "organization_not_active"
                | "license_expired"
                | "device_revoked"
                | "device_not_active"
                | "invalid_user_token"
        )
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

pub fn activate(email: &str, code: &str) -> Result<ActivationExchange, ApiError> {
    function_request(
        "app-activate",
        json!({
            "email": email,
            "code": code,
        }),
        None,
    )
}

pub fn exchange_magic_link(exchange: &ActivationExchange) -> Result<RemoteSession, ApiError> {
    auth_post(
        "/auth/v1/verify",
        json!({
            "type": exchange.token_type,
            "token_hash": exchange.token_hash,
        }),
        None,
    )
}

pub fn revoke_other_sessions(access_token: &str) -> Result<(), ApiError> {
    match request_agent()
        .post(&format!("{SUPABASE_URL}/auth/v1/logout?scope=others"))
        .set("apikey", SUPABASE_PUBLISHABLE_KEY)
        .set("authorization", &format!("Bearer {access_token}"))
        .call()
    {
        Ok(_) => Ok(()),
        Err(error) => Err(response_error(error)),
    }
}

pub fn refresh(refresh_token: &str) -> Result<RemoteSession, ApiError> {
    auth_post(
        "/auth/v1/token?grant_type=refresh_token",
        json!({ "refresh_token": refresh_token }),
        None,
    )
}

pub fn factors(access_token: &str) -> Result<Vec<Factor>, ApiError> {
    let response: RemoteUser = request_json(
        request_agent()
            .get(&format!("{SUPABASE_URL}/auth/v1/user"))
            .set("apikey", SUPABASE_PUBLISHABLE_KEY)
            .set("authorization", &format!("Bearer {access_token}"))
            .call(),
    )?;

    Ok(response.factors)
}

pub fn enroll_totp(access_token: &str) -> Result<TotpEnrollment, ApiError> {
    let response: EnrollFactorResponse = auth_post(
        "/auth/v1/factors",
        totp_enrollment_body(),
        Some(access_token),
    )?;

    Ok(TotpEnrollment {
        factor_id: response.id,
        qr_code: normalize_totp_qr_code(response.totp.qr_code),
        secret: response.totp.secret,
        uri: response.totp.uri,
    })
}

fn totp_enrollment_body() -> Value {
    json!({
        "factor_type": "totp",
        "friendly_name": TOTP_ISSUER,
        "issuer": TOTP_ISSUER,
    })
}

fn normalize_totp_qr_code(qr_code: String) -> String {
    let qr_code = qr_code.trim();
    if qr_code.is_empty() || qr_code.starts_with("data:") {
        return qr_code.to_string();
    }
    format!("data:image/svg+xml;utf-8,{qr_code}")
}

pub fn delete_factor(access_token: &str, factor_id: &str) -> Result<(), ApiError> {
    let _: Value = request_json(
        request_agent()
            .delete(&format!("{SUPABASE_URL}/auth/v1/factors/{factor_id}"))
            .set("apikey", SUPABASE_PUBLISHABLE_KEY)
            .set("authorization", &format!("Bearer {access_token}"))
            .call(),
    )?;
    Ok(())
}

pub fn verify_totp(
    access_token: &str,
    factor_id: &str,
    code: &str,
) -> Result<RemoteSession, ApiError> {
    let challenge: ChallengeResponse = auth_post(
        &format!("/auth/v1/factors/{factor_id}/challenge"),
        json!({}),
        Some(access_token),
    )?;

    auth_post(
        &format!("/auth/v1/factors/{factor_id}/verify"),
        json!({
            "challenge_id": challenge.id,
            "code": code,
        }),
        Some(access_token),
    )
}

pub fn validate_license(access_token: &str, body: Value) -> Result<Value, ApiError> {
    function_request("validate-license", body, Some(access_token))
}

pub fn activate_device(access_token: &str, body: Value) -> Result<Value, ApiError> {
    function_request("app-activate-device", body, Some(access_token))
}

pub fn function_value(
    function_name: &str,
    access_token: &str,
    body: Value,
) -> Result<Value, ApiError> {
    function_request(function_name, body, Some(access_token))
}

fn auth_post<T: for<'de> Deserialize<'de>>(
    path: &str,
    body: Value,
    access_token: Option<&str>,
) -> Result<T, ApiError> {
    let mut request = request_agent()
        .post(&format!("{SUPABASE_URL}{path}"))
        .set("apikey", SUPABASE_PUBLISHABLE_KEY)
        .set("content-type", "application/json");
    if let Some(access_token) = access_token {
        request = request.set("authorization", &format!("Bearer {access_token}"));
    }
    request_json(request.send_json(body))
}

fn function_request<T: for<'de> Deserialize<'de>>(
    function_name: &str,
    body: Value,
    access_token: Option<&str>,
) -> Result<T, ApiError> {
    let mut request = request_agent()
        .post(&format!("{SUPABASE_URL}/functions/v1/{function_name}"))
        .set("apikey", SUPABASE_PUBLISHABLE_KEY)
        .set("content-type", "application/json");
    if let Some(access_token) = access_token {
        request = request.set("authorization", &format!("Bearer {access_token}"));
    }
    request_json(request.send_json(body))
}

fn request_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(API_TIMEOUT).build()
}

fn request_json<T: for<'de> Deserialize<'de>>(
    response: Result<ureq::Response, ureq::Error>,
) -> Result<T, ApiError> {
    match response {
        Ok(response) => response
            .into_json::<T>()
            .map_err(|error| ApiError::protocol("invalid_server_response", error.to_string())),
        Err(error) => Err(response_error(error)),
    }
}

fn response_error(error: ureq::Error) -> ApiError {
    match error {
        ureq::Error::Status(_status, response) => {
            let retry_after_header = response
                .header("retry-after")
                .and_then(parse_retry_after_seconds);
            let value = response.into_json::<Value>().unwrap_or_else(|_| json!({}));
            api_error_from_value(&value, retry_after_header)
        }
        ureq::Error::Transport(error) => ApiError {
            code: "network_error".to_string(),
            message: error.to_string(),
            retry_after_seconds: None,
        },
    }
}

fn api_error_from_value(value: &Value, retry_after_header: Option<u64>) -> ApiError {
    // Edge Functions return `{ error: { code, message } }`, while GoTrue has
    // used both `{ error, error_description }` and
    // `{ code: <http status>, error_code, msg }`. Check each textual field
    // independently so a numeric `code` cannot mask `error_code`.
    let code = first_json_text(value, &["/error/code", "/error_code", "/error", "/code"])
        .unwrap_or_else(|| "request_failed".to_string());
    let message = first_json_text(
        value,
        &["/error/message", "/error_description", "/message", "/msg"],
    )
    .unwrap_or_else(|| "Request failed.".to_string());
    let retry_after_seconds = first_json_u64(
        value,
        &[
            "/error/retryAfterSeconds",
            "/error/retry_after_seconds",
            "/retryAfterSeconds",
            "/retry_after_seconds",
            "/retry_after",
        ],
    )
    .or(retry_after_header);

    ApiError {
        code,
        message,
        retry_after_seconds,
    }
}

fn first_json_text(value: &Value, pointers: &[&str]) -> Option<String> {
    pointers.iter().find_map(|pointer| {
        value
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn first_json_u64(value: &Value, pointers: &[&str]) -> Option<u64> {
    pointers.iter().find_map(|pointer| {
        let candidate = value.pointer(pointer)?;
        candidate
            .as_u64()
            .or_else(|| candidate.as_str().and_then(parse_retry_after_seconds))
    })
}

fn parse_retry_after_seconds(value: &str) -> Option<u64> {
    value
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|seconds| *seconds > 0)
}

#[cfg(test)]
mod tests {
    use super::{
        api_error_from_value, normalize_totp_qr_code, totp_enrollment_body, ActivationExchange,
    };

    #[test]
    fn accepts_activation_exchange_from_older_backend_without_recovery_flag() {
        let exchange: ActivationExchange = serde_json::from_value(serde_json::json!({
            "tokenHash": "hash",
            "tokenType": "magiclink"
        }))
        .expect("activation exchange should deserialize");

        assert!(!exchange.recovery);
    }

    #[test]
    fn wraps_raw_totp_svg_as_a_data_url() {
        assert_eq!(
            normalize_totp_qr_code("<svg></svg>".to_string()),
            "data:image/svg+xml;utf-8,<svg></svg>"
        );
    }

    #[test]
    fn preserves_existing_totp_data_url() {
        let qr_code = "data:image/svg+xml;utf-8,<svg></svg>";
        assert_eq!(
            normalize_totp_qr_code(qr_code.to_string()),
            qr_code.to_string()
        );
    }

    #[test]
    fn enrollment_uses_arizona_app_as_totp_issuer() {
        let body = totp_enrollment_body();
        assert_eq!(body["issuer"], "Arizona App");
        assert_eq!(body["friendly_name"], "Arizona App");
        assert_eq!(body["factor_type"], "totp");
    }

    #[test]
    fn parses_current_gotrue_error_when_http_code_is_numeric() {
        let error = api_error_from_value(
            &serde_json::json!({
                "code": 422,
                "error_code": "mfa_challenge_expired",
                "msg": "MFA challenge has expired"
            }),
            None,
        );

        assert_eq!(error.code, "mfa_challenge_expired");
        assert_eq!(error.message, "MFA challenge has expired");
    }

    #[test]
    fn parses_legacy_gotrue_error_shape() {
        let error = api_error_from_value(
            &serde_json::json!({
                "error": "over_request_rate_limit",
                "error_description": "Too many requests"
            }),
            Some(37),
        );

        assert_eq!(error.code, "over_request_rate_limit");
        assert_eq!(error.message, "Too many requests");
        assert_eq!(error.retry_after_seconds, Some(37));
    }

    #[test]
    fn parses_nested_edge_function_error_and_string_retry_delay() {
        let error = api_error_from_value(
            &serde_json::json!({
                "error": {
                    "code": "rate_limited",
                    "message": "Try again later.",
                    "retryAfterSeconds": "12"
                }
            }),
            Some(99),
        );

        assert_eq!(error.code, "rate_limited");
        assert_eq!(error.message, "Try again later.");
        assert_eq!(error.retry_after_seconds, Some(12));
    }
}
