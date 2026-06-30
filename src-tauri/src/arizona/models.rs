use std::path::PathBuf;

#[derive(Clone)]
pub(super) struct MonthFolder {
    pub(super) year: i32,
    pub(super) label: String,
}

#[derive(Clone)]
pub struct OpenedProject {
    pub jobao_cod: String,
    pub jobinho_cod: String,
    pub region: Option<String>,
    pub jobao_path: PathBuf,
    pub ae_project_path: PathBuf,
    pub mp4_path: Option<PathBuf>,
    pub mov_path: Option<PathBuf>,
    pub project_title: String,
}

#[derive(Clone)]
pub struct MediaFile {
    pub path: PathBuf,
    pub kind: String,
    pub title: String,
}
