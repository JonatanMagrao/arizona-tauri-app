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

    pub fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Mov => "mov",
        }
    }
}

pub fn find_video_path(
    jobao_path: &Path,
    project_stem: &str,
    media_type: MediaType,
) -> Option<PathBuf> {
    let videos = video_folder(jobao_path, media_type);
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

pub fn find_video_path_by_code(
    jobao_path: &Path,
    jobinho_cod: &str,
    media_type: MediaType,
) -> Option<PathBuf> {
    let code = jobinho_cod.trim();
    if code.is_empty() {
        return None;
    }

    let code_key = code.to_ascii_lowercase();
    let prefix = format!("{code_key}_");
    let mut matches = Vec::new();

    for entry in fs::read_dir(video_folder(jobao_path, media_type))
        .ok()?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() || !has_media_extension(&path, media_type) {
            continue;
        }

        let stem_key = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        if stem_key == code_key || stem_key.starts_with(&prefix) {
            matches.push(path);
        }
    }

    matches.sort_by_key(|path| {
        path.file_name()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    });
    matches.into_iter().next()
}

fn video_folder(jobao_path: &Path, media_type: MediaType) -> PathBuf {
    jobao_path
        .join("OUT")
        .join("RENDER")
        .join(media_type.folder_name())
}

fn has_media_extension(path: &Path, media_type: MediaType) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(media_type.extension()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_media_types_case_insensitively() {
        assert_eq!(MediaType::parse("mp4"), Some(MediaType::Mp4));
        assert_eq!(MediaType::parse("MOV"), Some(MediaType::Mov));
        assert_eq!(MediaType::parse(" wav "), None);
    }

    #[test]
    fn finds_video_by_jobinho_code_without_project_stem() {
        let folder = unique_media_test_dir("code_fallback");
        let mp4_folder = folder.join("OUT").join("RENDER").join("MP4");
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&mp4_folder).unwrap();
        fs::write(mp4_folder.join("22186_PE_26-06_28971.mp4"), b"").unwrap();
        fs::write(mp4_folder.join("221860_PE_26-06_28971.mp4"), b"").unwrap();

        let path = find_video_path_by_code(&folder, "22186", MediaType::Mp4).unwrap();

        assert_eq!(
            path.file_name().and_then(|value| value.to_str()),
            Some("22186_PE_26-06_28971.mp4")
        );
        assert!(find_video_path_by_code(&folder, "2218", MediaType::Mp4).is_none());

        let _ = fs::remove_dir_all(&folder);
    }

    fn unique_media_test_dir(name: &str) -> PathBuf {
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "arizona_media_{name}_{}_{}",
            std::process::id(),
            epoch
        ))
    }
}
