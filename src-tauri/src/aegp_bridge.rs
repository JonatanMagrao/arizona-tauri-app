use serde_json::json;

const PIPE_NAME: &str = r"\\.\pipe\arizona-aegp-bridge";

pub fn send_show_alert(message: &str) -> Result<String, String> {
    send_command(
        "show_alert",
        json!({
            "message": message
        }),
    )
}

pub fn send_move_layers_backward() -> Result<String, String> {
    send_command("move_layers_backward", serde_json::Value::Null)
}

pub fn send_move_layers_forward() -> Result<String, String> {
    send_command("move_layers_forward", serde_json::Value::Null)
}

pub fn send_move_jump_marker() -> Result<String, String> {
    send_command("move_jump_marker", serde_json::Value::Null)
}

pub fn send_select_jump_marker_layer() -> Result<String, String> {
    send_command("select_jump_marker_layer", serde_json::Value::Null)
}

pub fn send_adjust_markers_to_tail() -> Result<String, String> {
    send_command("adjust_markers_to_tail", serde_json::Value::Null)
}

fn send_command(command: &str, args: serde_json::Value) -> Result<String, String> {
    let command_id = format!("aegp_cmd_{}", chrono::Utc::now().timestamp_millis());
    let payload = json!({
        "type": "ae.command",
        "id": command_id,
        "command": command,
        "args": args
    });

    send_payload(&payload.to_string())?;
    Ok(command_id)
}

#[cfg(windows)]
fn send_payload(payload: &str) -> Result<(), String> {
    use std::{fs::OpenOptions, io::Write, thread, time::Duration};

    let mut last_error = None;

    for _ in 0..20 {
        match OpenOptions::new().write(true).open(PIPE_NAME) {
            Ok(mut pipe) => {
                pipe.write_all(payload.as_bytes())
                    .map_err(|err| format!("Nao foi possivel enviar comando ao AEGP: {err}"))?;
                pipe.flush()
                    .map_err(|err| format!("Nao foi possivel finalizar envio ao AEGP: {err}"))?;
                return Ok(());
            }
            Err(err) if should_retry_pipe_open(&err) => {
                last_error = Some(err.to_string());
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                return Err(format!("Plugin AEGP nao conectado em {PIPE_NAME}: {err}"));
            }
        }
    }

    Err(format!(
        "Plugin AEGP nao respondeu em {PIPE_NAME}. Ultimo erro: {}",
        last_error.unwrap_or_else(|| "desconhecido".to_string())
    ))
}

#[cfg(windows)]
fn should_retry_pipe_open(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::WouldBlock
    ) || matches!(err.raw_os_error(), Some(2 | 3 | 231))
}

#[cfg(not(windows))]
fn send_payload(_payload: &str) -> Result<(), String> {
    Err("Bridge AEGP disponivel apenas no Windows.".to_string())
}
