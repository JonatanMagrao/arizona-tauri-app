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
        let jobinho_cod = jobinho_cod.trim();
        let jobao_path = self.get_jobao_path(jobao_cod)?;
        let ae_folder = jobao_path.join("PROJETOS").join("AE");
        let reg_exp = Regex::new(&format!(r"{}_", regex::escape(jobinho_cod)))
            .map_err(|err| err.to_string())?;

        for entry in fs::read_dir(&ae_folder)
            .map_err(|err| format!("Erro ao ler {}: {err}", ae_folder.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let ae_project_path = entry.path();
            if ae_project_path.extension().and_then(|ext| ext.to_str()) != Some("aep") {
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

                return Ok(OpenedProject {
                    jobao_cod: jobao_cod.trim().to_string(),
                    jobinho_cod: jobinho_cod.trim().to_string(),
                    region: region_from_aep_name(&name),
                    mp4_path: find_video_path(&jobao_path, &project_stem, MediaType::Mp4),
                    mov_path: find_video_path(&jobao_path, &project_stem, MediaType::Mov),
                    jobao_path,
                    ae_project_path,
                    project_title,
                });
            }
        }

        Err(format!(r#"CÃ³digo Jobinho "{}" invÃ¡lido!"#, jobinho_cod))
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
        .filter(|value| !value.is_empty())
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
