use chrono::Local;
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

use crate::{
    arizona::{open_explorer, reveal_in_explorer, Arizona, DuplicateMp4Copy, OpenedProject},
    media::{find_video_path, MediaType},
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyHistoryEntry {
    pub id: i64,
    pub jobao_cod: String,
    pub source_file_name: String,
    pub target_file_name: String,
    pub folder_path: String,
    pub source_path: String,
    pub target_path: String,
    pub copied_at: String,
    pub copied_at_epoch: i64,
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

pub fn record_duplicate_mp4_copies(
    app: &AppHandle,
    jobao_cod: &str,
    copies: &[DuplicateMp4Copy],
) -> Result<(), String> {
    if copies.is_empty() {
        return Ok(());
    }

    let mut conn = open_connection(app)?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    let now = Local::now();
    let now_text = now.to_rfc3339();
    let now_epoch = now.timestamp();
    let jobao_cod = jobao_cod.trim();

    for copy in copies {
        tx.execute(
            r#"
            INSERT INTO copy_history (
                jobao_cod,
                source_file_name,
                target_file_name,
                folder_path,
                source_path,
                target_path,
                copied_at,
                copied_at_epoch
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                jobao_cod,
                copy.source_file_name,
                copy.target_file_name,
                path_to_string(&copy.folder_path),
                path_to_string(&copy.source_path),
                path_to_string(&copy.target_path),
                now_text,
                now_epoch
            ],
        )
        .map_err(|err| err.to_string())?;
    }

    tx.commit().map_err(|err| err.to_string())
}

pub fn list_copies(app: &AppHandle) -> Result<Vec<CopyHistoryEntry>, String> {
    let conn = open_connection(app)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                id,
                jobao_cod,
                source_file_name,
                target_file_name,
                folder_path,
                source_path,
                target_path,
                copied_at,
                copied_at_epoch
            FROM copy_history
            ORDER BY copied_at_epoch DESC, id DESC
            LIMIT ?1
            "#,
        )
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map(params![HISTORY_LIMIT], row_to_copy_entry)
        .map_err(|err| err.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn clear_copies(app: &AppHandle) -> Result<(), String> {
    let conn = open_connection(app)?;
    conn.execute("DELETE FROM copy_history", [])
        .map(|_| ())
        .map_err(|err| err.to_string())
}

pub fn open_copy_folder(app: &AppHandle, id: i64) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_copy_entry(&conn, id)?;
    open_explorer(&required_path(&entry.folder_path, "pasta MP4")?)
}

pub fn reveal_copy_media(app: &AppHandle, id: i64) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_copy_entry(&conn, id)?;
    reveal_in_explorer(&copy_target_path(&entry)?)
}

pub fn copy_media_file(app: &AppHandle, id: i64) -> Result<PathBuf, String> {
    let conn = open_connection(app)?;
    let entry = get_copy_entry(&conn, id)?;
    copy_target_path(&entry)
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

pub fn media_file(app: &AppHandle, id: i64, media_type: &str) -> Result<PathBuf, String> {
    let conn = open_connection(app)?;
    let entry = get_entry(&conn, id)?;
    media_path(&entry, media_type)
}

pub fn refresh_entry(app: &AppHandle, id: i64) -> Result<(), String> {
    let conn = open_connection(app)?;
    let entry = get_entry(&conn, id)?;
    refresh_entry_paths(&conn, &entry)
}

pub fn refresh_all_entries(app: &AppHandle) -> Result<(usize, usize), String> {
    let conn = open_connection(app)?;
    let entries = list_all_entries(&conn)?;
    let mut updated = 0;
    let mut skipped = 0;

    for entry in entries {
        match refresh_entry_paths(&conn, &entry) {
            Ok(()) => updated += 1,
            Err(_) => skipped += 1,
        }
    }

    Ok((updated, skipped))
}

fn refresh_entry_paths(conn: &Connection, entry: &HistoryEntry) -> Result<(), String> {
    let jobao_path = required_path(&entry.jobao_path, "Jobão")?;
    let ae_project_path = required_path(&entry.ae_project_path, "projeto do After")?;
    let project_stem = ae_project_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "Nome do projeto do After inválido.".to_string())?;
    let mp4_path = find_video_path(&jobao_path, project_stem, MediaType::Mp4)
        .map(|path| path_to_string(&path));
    let mov_path = find_video_path(&jobao_path, project_stem, MediaType::Mov)
        .map(|path| path_to_string(&path));

    conn.execute(
        r#"
        UPDATE project_history
        SET mp4_path = ?1,
            mov_path = ?2
        WHERE id = ?3
        "#,
        params![mp4_path, mov_path, entry.id],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

fn list_all_entries(conn: &Connection) -> Result<Vec<HistoryEntry>, String> {
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
            "#,
        )
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map([], row_to_entry)
        .map_err(|err| err.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
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

        CREATE TABLE IF NOT EXISTS copy_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jobao_cod TEXT NOT NULL,
            source_file_name TEXT NOT NULL,
            target_file_name TEXT NOT NULL,
            folder_path TEXT NOT NULL,
            source_path TEXT NOT NULL,
            target_path TEXT NOT NULL,
            copied_at TEXT NOT NULL,
            copied_at_epoch INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_copy_history_lookup
            ON copy_history (jobao_cod, copied_at_epoch DESC);
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

fn get_copy_entry(conn: &Connection, id: i64) -> Result<CopyHistoryEntry, String> {
    conn.query_row(
        r#"
        SELECT
            id,
            jobao_cod,
            source_file_name,
            target_file_name,
            folder_path,
            source_path,
            target_path,
            copied_at,
            copied_at_epoch
        FROM copy_history
        WHERE id = ?1
        "#,
        params![id],
        row_to_copy_entry,
    )
    .map_err(|err| err.to_string())
}

fn row_to_copy_entry(row: &Row<'_>) -> rusqlite::Result<CopyHistoryEntry> {
    Ok(CopyHistoryEntry {
        id: row.get(0)?,
        jobao_cod: row.get(1)?,
        source_file_name: row.get(2)?,
        target_file_name: row.get(3)?,
        folder_path: row.get(4)?,
        source_path: row.get(5)?,
        target_path: row.get(6)?,
        copied_at: row.get(7)?,
        copied_at_epoch: row.get(8)?,
    })
}

fn media_path(entry: &HistoryEntry, media_type: &str) -> Result<PathBuf, String> {
    let media_type =
        MediaType::parse(media_type).ok_or_else(|| "Tipo de video invalido.".to_string())?;
    let value = match media_type {
        MediaType::Mp4 => entry.mp4_path.as_deref(),
        MediaType::Mov => entry.mov_path.as_deref(),
    };

    optional_path(value, media_type.label())
}

fn copy_target_path(entry: &CopyHistoryEntry) -> Result<PathBuf, String> {
    required_path(&entry.target_path, "MP4")
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

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
