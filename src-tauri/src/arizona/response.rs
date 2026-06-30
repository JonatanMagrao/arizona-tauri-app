use serde::Serialize;

#[derive(Serialize)]
pub struct ActionResponse {
    ok: bool,
    message: Option<String>,
}

impl ActionResponse {
    pub fn ok() -> Self {
        Self {
            ok: true,
            message: None,
        }
    }

    pub fn ok_message(message: impl Into<String>) -> Self {
        Self {
            ok: true,
            message: Some(message.into()),
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            message: Some(message.into()),
        }
    }
}
