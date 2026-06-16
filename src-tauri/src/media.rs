use regex::Regex;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MediaType {
    Mp4,
    Mov,
}

impl MediaType {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "mp4" => Some(Self::Mp4),
            "mov" => Some(Self::Mov),
            _ => None,
        }
    }

    pub fn folder_name(self) -> &'static str {
        match self {
            Self::Mp4 => "MP4",
            Self::Mov => "MOV",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Mp4 => "MP4",
            Self::Mov => "MOV",
        }
    }
}

pub fn find_video_path(
    jobao_path: &Path,
    project_stem: &str,
    media_type: MediaType,
) -> Option<PathBuf> {
    let videos = jobao_path
        .join("OUT")
        .join("RENDER")
        .join(media_type.folder_name());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_media_types_case_insensitively() {
        assert_eq!(MediaType::parse("mp4"), Some(MediaType::Mp4));
        assert_eq!(MediaType::parse("MOV"), Some(MediaType::Mov));
        assert_eq!(MediaType::parse(" wav "), None);
    }
}
