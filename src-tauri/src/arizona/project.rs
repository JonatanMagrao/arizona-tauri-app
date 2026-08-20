use regex::Regex;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use crate::media::{find_video_path, MediaType};

use super::{
    models::OpenedProject,
    response::ActionResponse,
    shell::{open_explorer, open_start_file},
    Arizona,
};

impl Arizona {
    pub fn get_jobao_path(&self, jobao_cod: &str) -> Result<PathBuf, String> {
        let reg_exp = Regex::new(&format!(r"\d{{2}}_{}_\d{{5,6}}_w*", jobao_cod))
            .map_err(|err| err.to_string())?;

        for mes in &self.meses {
            let projeto_path = self
                .carrefour_path
                .join("CARREFOUR")
                .join("FILMES")
                .join(mes.year.to_string())
                .join(&mes.label);

            if !projeto_path.exists() {
                continue;
            }

            let entries = fs::read_dir(&projeto_path)
                .map_err(|err| format!("Erro ao ler {}: {err}", projeto_path.display()))?;

            for entry in entries {
                let entry = entry.map_err(|err| err.to_string())?;
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                let name = entry.file_name().to_string_lossy().into_owned();
                if starts_with_two_digits(&name) && reg_exp.is_match(&name) {
                    return Ok(path);
                }
            }
        }

        let searched = self
            .meses
            .iter()
            .map(|mes| mes.label.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        Err(format!(
            r#"JobÃ£o "{}" nÃ£o encontrado em {}!"#,
            jobao_cod, searched
        ))
    }

    pub fn open_jobao(&self, jobao_cod: &str) -> Result<(), String> {
        let jobao_path = self.get_jobao_path(jobao_cod)?;
        open_explorer(&jobao_path)
    }

    pub fn open_jobinhos_folder(&self, jobao_cod: &str, jobinho_cod: &str) -> Result<(), String> {
        let jobao_path = self.get_jobao_path(jobao_cod)?.join("PROJETOS").join("AE");
        let reg_exp = Regex::new(&format!(r"{}_", jobinho_cod)).map_err(|err| err.to_string())?;

        for entry in fs::read_dir(&jobao_path)
            .map_err(|err| format!("Erro ao ler {}: {err}", jobao_path.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("aep") {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            if reg_exp.is_match(&name) {
                open_explorer(&jobao_path)?;
                return Ok(());
            }
        }

        Ok(())
    }

    pub fn abrir_jobinho(
        &self,
        jobao_cod: &str,
        jobinho_cod: &str,
    ) -> Result<OpenedProject, String> {
        let project = self.project_open_info(jobao_cod, jobinho_cod)?;
        self.open_after_project(&project.ae_project_path)?;
        Ok(project)
    }

    pub fn open_after_project(&self, project_path: &Path) -> Result<(), String> {
        Command::new(&self.after_fx)
            .arg("-project")
            .arg(project_path)
            .spawn()
            .map(|_| ())
            .map_err(|err| err.to_string())
    }

    pub(super) fn project_open_info(
        &self,
        jobao_cod: &str,
        jobinho_cod: &str,
    ) -> Result<OpenedProject, String> {
        self.project_open_info_impl(jobao_cod, jobinho_cod, None)
    }

    pub(crate) fn project_candidates(
        &self,
        jobao_cod: &str,
        jobinho_cod: &str,
    ) -> Result<Vec<OpenedProject>, String> {
        self.project_candidates_impl(jobao_cod, jobinho_cod, None)
    }

    pub(super) fn project_open_info_for_media(
        &self,
        jobao_cod: &str,
        jobinho_cod: &str,
        media_type: MediaType,
    ) -> Result<OpenedProject, String> {
        self.project_open_info_impl(jobao_cod, jobinho_cod, Some(media_type))
    }

    fn project_open_info_impl(
        &self,
        jobao_cod: &str,
        jobinho_cod: &str,
        requested_media: Option<MediaType>,
    ) -> Result<OpenedProject, String> {
        self.project_candidates_impl(jobao_cod, jobinho_cod, requested_media)?
            .into_iter()
            .next()
            .ok_or_else(|| format!(r#"Código Jobinho "{}" inválido!"#, jobinho_cod.trim()))
    }

    fn project_candidates_impl(
        &self,
        jobao_cod: &str,
        jobinho_cod: &str,
        requested_media: Option<MediaType>,
    ) -> Result<Vec<OpenedProject>, String> {
        let jobinho_cod = jobinho_cod.trim();
        let jobao_path = self.get_jobao_path(jobao_cod)?;
        let ae_folder = jobao_path.join("PROJETOS").join("AE");
        let reg_exp = Regex::new(&format!(r"(?i)^{}[_-]", regex::escape(jobinho_cod)))
            .map_err(|err| err.to_string())?;

        let mut candidates = Vec::new();

        for entry in fs::read_dir(&ae_folder)
            .map_err(|err| format!("Erro ao ler {}: {err}", ae_folder.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let ae_project_path = entry.path();
            if !ae_project_path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("aep"))
            {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            if reg_exp.is_match(&name) {
                let project_stem = ae_project_path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or("")
                    .to_string();
                let project_title = project_title_from_aep_name(&name, jobao_cod, jobinho_cod);

                candidates.push(OpenedProject {
                    jobao_cod: jobao_cod.trim().to_string(),
                    jobinho_cod: jobinho_cod.trim().to_string(),
                    region: region_from_aep_name(&name),
                    mp4_path: if requested_media != Some(MediaType::Mov) {
                        find_video_path(&jobao_path, &project_stem, MediaType::Mp4)
                    } else {
                        None
                    },
                    mov_path: if requested_media != Some(MediaType::Mp4) {
                        find_video_path(&jobao_path, &project_stem, MediaType::Mov)
                    } else {
                        None
                    },
                    jobao_path: jobao_path.clone(),
                    ae_project_path,
                    project_title,
                });
            }
        }

        candidates.sort_by(|left, right| {
            left.ae_project_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
                .cmp(
                    &right
                        .ae_project_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase(),
                )
        });

        if candidates.is_empty() {
            Err(format!(r#"Código Jobinho "{}" inválido!"#, jobinho_cod))
        } else {
            Ok(candidates)
        }
    }

    pub fn open_out(&self, jobao_cod: &str, option: &str) -> Result<(), String> {
        let jobao_path = self.get_jobao_path(jobao_cod)?;
        let path = match option {
            "mp4" => jobao_path.join("OUT").join("RENDER").join("MP4"),
            "mov" => jobao_path.join("OUT").join("RENDER").join("MOV"),
            "roteiro" => jobao_path.join("ROTEIRO"),
            "print" => jobao_path.join("OUT").join("PRINT"),
            "copia" => jobao_path.join("OUT").join("COPIA"),
            "produtos" => jobao_path.join(&self.produtos),
            "claquetes" => jobao_path.join("CLAQUETES"),
            "audio" => jobao_path.join("AUDIO").join("BOUNCE"),
            _ => {
                return Err(format!(
                    r#"Pasta "{}" nÃ£o encontrada em {}"#,
                    option, jobao_cod
                ))
            }
        };

        open_explorer(&path)
    }

    pub fn open_roteiro(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
    ) -> Result<ActionResponse, String> {
        let jobao = self.get_jobao_path(jobao_cod)?;
        let roteiros = jobao.join("ROTEIRO");
        let jobinho = jobao.join("PROJETOS").join("AE");
        let reg_exp = Regex::new(&format!("^{}", cod_jobinho)).map_err(|err| err.to_string())?;

        let mut praca = None;
        for entry in fs::read_dir(&jobinho)
            .map_err(|err| format!("Erro ao ler {}: {err}", jobinho.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if reg_exp.is_match(&name) {
                praca = name.split('_').nth(1).map(|value| value.to_string());
                break;
            }
        }

        let Some(praca) = praca else {
            return Ok(ActionResponse::err("PraÃ§a nÃ£o encontrada."));
        };

        let mut roteiro = None;
        for entry in fs::read_dir(&roteiros)
            .map_err(|err| format!("Erro ao ler {}: {err}", roteiros.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            let stem = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("");
            if stem.split('_').any(|part| part == praca) {
                roteiro = Some(path);
                break;
            }
        }

        let Some(roteiro) = roteiro else {
            return Ok(ActionResponse::err("Roteiro nÃ£o encontrado."));
        };

        open_start_file(&roteiro)?;
        Ok(ActionResponse::ok())
    }

    pub fn roteiro_source(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
    ) -> Result<(PathBuf, String), String> {
        let jobao = self.get_jobao_path(jobao_cod)?;
        let roteiros = jobao.join("ROTEIRO");
        let projetos_ae = jobao.join("PROJETOS").join("AE");
        let prefixo = Regex::new(&format!("^{}", regex::escape(cod_jobinho.trim())))
            .map_err(|err| err.to_string())?;

        let mut projetos = fs::read_dir(&projetos_ae)
            .map_err(|err| format!("Erro ao ler {}: {err}", projetos_ae.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        projetos.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

        let praca = projetos
            .into_iter()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .find(|name| prefixo.is_match(name))
            .and_then(|name| {
                name.split('_')
                    .nth(1)
                    .map(|value| value.trim().to_uppercase())
            })
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Praça não encontrada para este Jobinho.".to_string())?;

        let mut candidatos = fs::read_dir(&roteiros)
            .map_err(|err| format!("Erro ao ler {}: {err}", roteiros.display()))?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.is_file())
            .filter(|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("docx"))
            })
            .filter(|path| {
                !path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("~$"))
            })
            .filter(|path| {
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .is_some_and(|stem| {
                        stem.split('_')
                            .any(|part| part.eq_ignore_ascii_case(&praca))
                    })
            })
            .collect::<Vec<_>>();
        candidatos.sort_by_key(|path| {
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
        });

        let path = candidatos
            .into_iter()
            .next()
            .ok_or_else(|| format!("Roteiro DOCX da praça {praca} não encontrado."))?;

        Ok((path, praca))
    }

    pub fn roteiro_path(&self, jobao_cod: &str, cod_jobinho: &str) -> Result<PathBuf, String> {
        self.roteiro_source(jobao_cod, cod_jobinho)
            .map(|(path, _)| path)
    }

    pub fn project_name(
        &self,
        jobao_cod: &str,
        jobinho_cod: &str,
    ) -> Result<ActionResponse, String> {
        let jobao = self.get_jobao_path(jobao_cod)?;
        let jobinho = jobao.join("PROJETOS").join("AE");
        let reg_exp = Regex::new(&format!("^{}", jobinho_cod)).map_err(|err| err.to_string())?;

        for entry in fs::read_dir(&jobinho)
            .map_err(|err| format!("Erro ao ler {}: {err}", jobinho.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if reg_exp.is_match(&name) {
                return Ok(ActionResponse::ok_message(project_title_from_aep_name(
                    &name,
                    jobao_cod,
                    jobinho_cod,
                )));
            }
        }

        Ok(ActionResponse::ok())
    }
}

fn starts_with_two_digits(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_digit() && bytes[1].is_ascii_digit()
}

fn region_from_aep_name(file_name: &str) -> Option<String> {
    Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .and_then(|stem| stem.split('_').nth(1))
        .map(|value| value.trim().to_uppercase())
        .filter(|value| {
            !value.is_empty()
                && value.chars().count() <= 32
                && value
                    .chars()
                    .all(|character| character.is_alphanumeric() || character == '-')
        })
}

fn project_title_from_aep_name(
    file_name: &str,
    jobao_cod: &str,
    fallback_jobinho_cod: &str,
) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let mut parts = stem.split('_');
    let jobinho = parts
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_jobinho_cod)
        .trim();
    let region = parts
        .next()
        .map(|value| value.trim().to_uppercase())
        .unwrap_or_default();

    if region.is_empty() {
        format!("{} - {}", jobao_cod.trim(), jobinho)
    } else {
        format!("{} - {} - {}", jobao_cod.trim(), jobinho, region)
    }
}

#[cfg(test)]
mod tests {
    use super::region_from_aep_name;

    #[test]
    fn derives_only_a_safe_region_for_the_queue_contract() {
        assert_eq!(
            region_from_aep_name("15181_rj_v3.aep").as_deref(),
            Some("RJ")
        );
        assert_eq!(
            region_from_aep_name("15181_CUR-1_v3.aep").as_deref(),
            Some("CUR-1")
        );
        assert_eq!(region_from_aep_name("15181_RIO SP_v3.aep"), None);
        assert_eq!(region_from_aep_name("15181_!_v3.aep"), None);
        assert_eq!(region_from_aep_name("15181.aep"), None);
    }
}
