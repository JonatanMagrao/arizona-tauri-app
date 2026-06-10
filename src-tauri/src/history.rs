use chrono::Local;
use regex::Regex;
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

use crate::{
    arizona::{open_explorer, open_start_file, reveal_in_explorer, Arizona, OpenedProject},
    settings,
};

const DUPLICATE_WINDOW_SECONDS: i64 = 10 * 60;
const HISTORY_LIMIT: i64 = 200;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub jobao_cod: String,
    pub jobinho_cod: String,
    pub region: Option<String>,
    pub jobao_path: String,
    pub ae_project_path: String,
    pub mp4_path: Option<String>,
    pub mov_path: Option<String>,
    pub opened_at: String,
    pub opened_at_epoch: i64,
}

struct HistoryInput {
    jobao_cod: String,
    jobinho_cod: String,
    region: Option<String>,
    jobao_path: String,
    ae_project_path: String,
    mp4_path: Option<String>,
    mov_path: Option<String>,
}

impl HistoryInput {
    fn from_project(project: &OpenedProject) -> Self {
        Self {
            jobao_cod: project.jobao_cod.clone(),
            jobinho_cod: project.jobinho_cod.clone(),
            region: project.region.clone(),
            jobao_path: path_to_string(&project.jobao_path),
            ae_project_path: path_to_string(&project.ae_project_path),
            mp4_path: project.mp4_path.as_deref().map(path_to_string),
            mov_path: project.mov_path.as_deref().map(path_to_string),
        }
    }

    fn from_entry(entry: &HistoryEntry) -> Self {
        Self {
            jobao_cod: entry.jobao_cod.clone(),
            jobinho_cod: entry.jobinho_cod.clone(),
            region: entry.region.clone(),
            jobao_path: entry.jobao_path.clone(),
            ae_project_path: entry.ae_project_path.clone(),
            mp4_path: entry.mp4_path.clone(),
            mov_path: entry.mov_path.clone(),
        }
    }
}

pub fn record_project_opened(app: &AppHandle, project: &OpenedProject) -> Result<(), String> {
    let conn = open_connection(app)?;
    insert_if_not_recent(&conn, &HistoryInput::from_project(project))
}

pub fn list(app: &AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let conn = open_connection(app)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                id,
                jobao_cod,
                jobinho_cod,
                region,
                jobao_path,
                ae_project_path,
                mp4_path,
                mov_path,
                opened_at,
                opened_at_epoch
            FROM project_history
            ORDER BY opened_at_epoch DESC, id DESC
            LIMIT ?1
            "#,
        )
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map(params![HISTORY_LIMIT], row_to_entry)
        .map_err(|err| err.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn clear(app: &AppHandle) -> Result<(), String> {
    let conn = open_connection(app)?;
    conn.execute("DELETE FROM project_history", [])
        .map(|_| ())
        .map_err(|err| err.to_string())
}

pub fn open_jobao_folder(app: &AppHandle, id: i64) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_entry(&conn, id)?;
    open_explorer(&required_path(&entry.jobao_path, "Jobão")?)
}

pub fn reveal_after_project(app: &AppHandle, id: i64) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_entry(&conn, id)?;
    reveal_in_explorer(&required_path(&entry.ae_project_path, "projeto do After")?)
}

pub fn open_after_project(app: &AppHandle, id: i64) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_entry(&conn, id)?;
    let project_path = required_path(&entry.ae_project_path, "projeto do After")?;
    Arizona::new(settings::load(app)?).open_after_project(&project_path)?;
    insert_if_not_recent(&conn, &HistoryInput::from_entry(&entry))
}

pub fn reveal_media(app: &AppHandle, id: i64, media_type: &str) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_entry(&conn, id)?;
    reveal_in_explorer(&media_path(&entry, media_type)?)
}

pub fn open_media(app: &AppHandle, id: i64, media_type: &str) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_entry(&conn, id)?;
    open_start_file(&media_path(&entry, media_type)?)
}

pub fn refresh_entry(app: &AppHandle, id: i64) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_entry(&conn, id)?;
    let jobao_path = required_path(&entry.jobao_path, "Jobão")?;
    let ae_project_path = required_path(&entry.ae_project_path, "projeto do After")?;
    let project_stem = ae_project_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "Nome do projeto do After inválido.".to_string())?;
    let mp4_path =
        find_video_path(&jobao_path, project_stem, "mp4").map(|path| path_to_string(&path));
    let mov_path =
        find_video_path(&jobao_path, project_stem, "mov").map(|path| path_to_string(&path));

    conn.execute(
        r#"
        UPDATE project_history
        SET mp4_path = ?1,
            mov_path = ?2
        WHERE id = ?3
        "#,
        params![mp4_path, mov_path, id],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Nao foi possivel criar {}: {err}", parent.display()))?;
    }

    let conn = Connection::open(&path)
        .map_err(|err| format!("Nao foi possivel abrir {}: {err}", path.display()))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join("history.sqlite3"))
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS project_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jobao_cod TEXT NOT NULL,
            jobinho_cod TEXT NOT NULL,
            region TEXT,
            jobao_path TEXT NOT NULL,
            ae_project_path TEXT NOT NULL,
            mp4_path TEXT,
            mov_path TEXT,
            opened_at TEXT NOT NULL,
            opened_at_epoch INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_project_history_lookup
            ON project_history (jobao_cod, jobinho_cod, opened_at_epoch DESC);
        "#,
    )
    .map_err(|err| err.to_string())
}

fn insert_if_not_recent(conn: &Connection, input: &HistoryInput) -> Result<(), String> {
    let now = Local::now();
    let now_epoch = now.timestamp();
    let min_epoch = now_epoch - DUPLICATE_WINDOW_SECONDS;
    let recent_count: i64 = conn
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM project_history
            WHERE jobao_cod = ?1
              AND jobinho_cod = ?2
              AND opened_at_epoch >= ?3
            "#,
            params![input.jobao_cod, input.jobinho_cod, min_epoch],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;

    if recent_count > 0 {
        return Ok(());
    }

    conn.execute(
        r#"
        INSERT INTO project_history (
            jobao_cod,
            jobinho_cod,
            region,
            jobao_path,
            ae_project_path,
            mp4_path,
            mov_path,
            opened_at,
            opened_at_epoch
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            input.jobao_cod,
            input.jobinho_cod,
            input.region,
            input.jobao_path,
            input.ae_project_path,
            input.mp4_path,
            input.mov_path,
            now.to_rfc3339(),
            now_epoch
        ],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

fn get_entry(conn: &Connection, id: i64) -> Result<HistoryEntry, String> {
    conn.query_row(
        r#"
        SELECT
            id,
            jobao_cod,
            jobinho_cod,
            region,
            jobao_path,
            ae_project_path,
            mp4_path,
            mov_path,
            opened_at,
            opened_at_epoch
        FROM project_history
        WHERE id = ?1
        "#,
        params![id],
        row_to_entry,
    )
    .map_err(|err| err.to_string())
}

fn row_to_entry(row: &Row<'_>) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        jobao_cod: row.get(1)?,
        jobinho_cod: row.get(2)?,
        region: row.get(3)?,
        jobao_path: row.get(4)?,
        ae_project_path: row.get(5)?,
        mp4_path: row.get(6)?,
        mov_path: row.get(7)?,
        opened_at: row.get(8)?,
        opened_at_epoch: row.get(9)?,
    })
}

fn media_path(entry: &HistoryEntry, media_type: &str) -> Result<PathBuf, String> {
    let (value, label) = match media_type {
        "mp4" => (entry.mp4_path.as_deref(), "MP4"),
        "mov" => (entry.mov_path.as_deref(), "MOV"),
        _ => return Err("Tipo de vídeo inválido.".to_string()),
    };

    optional_path(value, label)
}

fn optional_path(value: Option<&str>, label: &str) -> Result<PathBuf, String> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Err(format!("Path do {label} não disponível."));
    };

    required_path(value, label)
}

fn required_path(value: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("Path do {label} não disponível."))
    }
}

fn find_video_path(jobao_path: &Path, project_stem: &str, media_type: &str) -> Option<PathBuf> {
    let pasta = match media_type {
        "mp4" => "MP4",
        "mov" => "MOV",
        _ => return None,
    };
    let videos = jobao_path.join("OUT").join("RENDER").join(pasta);
    let reg_exp = Regex::new(&format!("^{}", regex::escape(project_stem))).ok()?;

    for entry in fs::read_dir(&videos).ok()?.flatten() {
        let path = entry.path();
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("");
        if reg_exp.is_match(stem) {
            return Some(path);
        }
    }

    None
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
