use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use crate::media::{find_video_path_by_code, MediaType};

use super::{models::MediaFile, response::ActionResponse, shell::reveal_in_explorer, Arizona};

struct AudioCandidate {
    path: PathBuf,
    score: u8,
    modified_epoch: u64,
    file_name_key: String,
}

impl Arizona {
    pub fn reveal_video(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
        media_type: &str,
    ) -> Result<ActionResponse, String> {
        self.handle_video(jobao_cod, cod_jobinho, media_type, reveal_in_explorer)
    }

    pub fn video_file(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
        media_type: &str,
    ) -> Result<MediaFile, String> {
        let media_type =
            MediaType::parse(media_type).ok_or_else(|| "Tipo de vÃ­deo invÃ¡lido.".to_string())?;

        match self.project_open_info(jobao_cod, cod_jobinho) {
            Ok(project) => {
                let video = match media_type {
                    MediaType::Mp4 => project.mp4_path,
                    MediaType::Mov => project.mov_path,
                }
                .or_else(|| find_video_path_by_code(&project.jobao_path, cod_jobinho, media_type));

                let Some(video) = video else {
                    return Err("VÃ­deo nÃ£o encontrado.".to_string());
                };

                Ok(media_file_from_path(video, "video"))
            }
            Err(project_error) => {
                let jobao_path = self.get_jobao_path(jobao_cod)?;
                if let Some(video) = find_video_path_by_code(&jobao_path, cod_jobinho, media_type) {
                    return Ok(media_file_from_path(video, "video"));
                }

                Err(project_error)
            }
        }
    }

    pub fn audio_file(&self, jobao_cod: &str, cod_jobinho: &str) -> Result<MediaFile, String> {
        let project = self.project_open_info(jobao_cod, cod_jobinho)?;
        let audio_folder = project.jobao_path.join("AUDIO").join("BOUNCE");

        if !audio_folder.is_dir() {
            return Err(format!(
                "Pasta de Ã¡udio nÃ£o encontrada em {}",
                audio_folder.display()
            ));
        }

        let audio = find_audio_file(
            &audio_folder,
            &project.jobinho_cod,
            project.region.as_deref().unwrap_or(""),
        )?;

        Ok(media_file_from_path(audio, "audio"))
    }

    fn handle_video(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
        media_type: &str,
        opener: fn(&Path) -> Result<(), String>,
    ) -> Result<ActionResponse, String> {
        match self.video_file(jobao_cod, cod_jobinho, media_type) {
            Ok(video) => {
                opener(&video.path)?;
                Ok(ActionResponse::ok())
            }
            Err(err) => Ok(ActionResponse::err(err)),
        }
    }
}

fn media_file_from_path(path: PathBuf, kind: &str) -> MediaFile {
    let title = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    MediaFile {
        path,
        kind: kind.to_string(),
        title,
    }
}

fn find_audio_file(
    audio_folder: &Path,
    jobinho_cod: &str,
    region: &str,
) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    for entry in fs::read_dir(audio_folder)
        .map_err(|err| format!("Erro ao ler {}: {err}", audio_folder.display()))?
    {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() || !is_audio_file(&path) {
            continue;
        }

        let Some(score) = audio_match_score(&path, jobinho_cod, region) else {
            continue;
        };

        candidates.push(AudioCandidate {
            modified_epoch: modified_epoch(&path),
            file_name_key: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase(),
            path,
            score,
        });
    }

    if candidates.is_empty() {
        let region_detail = region
            .trim()
            .is_empty()
            .then(String::new)
            .unwrap_or_else(|| format!(" para a regiÃ£o {}", region.trim().to_uppercase()));
        return Err(format!(
            "Ãudio{} nÃ£o encontrado em {}.",
            region_detail,
            audio_folder.display()
        ));
    }

    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.modified_epoch.cmp(&left.modified_epoch))
            .then_with(|| left.file_name_key.cmp(&right.file_name_key))
    });

    Ok(candidates.remove(0).path)
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "wav" | "mp3" | "m4a" | "aac" | "flac" | "ogg" | "aif" | "aiff" | "wma"
            )
        })
        .unwrap_or(false)
}

fn audio_match_score(path: &Path, jobinho_cod: &str, region: &str) -> Option<u8> {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    let tokens = filename_tokens(&stem);
    let region = region.trim().to_ascii_uppercase();
    let jobinho = jobinho_cod.trim().to_ascii_uppercase();

    if !region.is_empty() && tokens.iter().any(|token| token == &region) {
        return Some(120);
    }

    if region.len() >= 3 && stem.contains(&region) {
        return Some(110);
    }

    if !jobinho.is_empty() && tokens.iter().any(|token| token == &jobinho) {
        return Some(90);
    }

    if !jobinho.is_empty() && stem.contains(&jobinho) {
        return Some(80);
    }

    None
}

fn filename_tokens(value: &str) -> Vec<String> {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn modified_epoch(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
