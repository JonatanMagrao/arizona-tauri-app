use chrono::{Datelike, Local};
use regex::Regex;
use roxmltree::{Document, Node};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant, UNIX_EPOCH},
};
use zip::ZipArchive;

use crate::{
    media::{find_video_path, find_video_path_by_code, MediaType},
    settings::AppConfig,
};

const SHEET_NAME: &str = "Consolidado";
const PRODUCT_COPY_MAX_PARALLELISM: usize = 4;
const PRODUCT_COPY_MAX_RETRIES: usize = 3;
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

#[derive(Clone)]
struct MonthFolder {
    year: i32,
    label: String,
}

struct ImportResult {
    imported_files: Vec<String>,
    existing_files: Vec<String>,
    not_found_files: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductImportGroup {
    folder_name: String,
    imported_files: Vec<String>,
    existing_files: Vec<String>,
    not_found_files: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductImportReport {
    jobao_cod: String,
    product_path: String,
    source_path: String,
    imported_files: Vec<String>,
    existing_files: Vec<String>,
    not_found_files: Vec<String>,
    groups: Vec<ProductImportGroup>,
    total_processed: usize,
    total_imported: usize,
    total_existing: usize,
    total_not_found: usize,
    duration_millis: u64,
}

impl ProductImportReport {
    pub fn jobao_cod(&self) -> &str {
        &self.jobao_cod
    }

    pub fn product_path(&self) -> &str {
        &self.product_path
    }

    pub fn source_path(&self) -> &str {
        &self.source_path
    }

    pub fn total_processed(&self) -> usize {
        self.total_processed
    }

    pub fn total_imported(&self) -> usize {
        self.total_imported
    }

    pub fn total_existing(&self) -> usize {
        self.total_existing
    }

    pub fn total_not_found(&self) -> usize {
        self.total_not_found
    }

    pub fn total_groups(&self) -> usize {
        self.groups.len()
    }

    pub fn duration_millis(&self) -> u64 {
        self.duration_millis
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMp4Item {
    pub file_name: String,
    pub stem: String,
    pub extension: String,
}

#[derive(Clone)]
pub struct DuplicateMp4Copy {
    pub source_file_name: String,
    pub target_file_name: String,
    pub folder_path: PathBuf,
    pub source_path: PathBuf,
    pub target_path: PathBuf,
}

pub struct DuplicateMp4Result {
    pub message: String,
    pub copies: Vec<DuplicateMp4Copy>,
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

struct AudioCandidate {
    path: PathBuf,
    score: u8,
    modified_epoch: u64,
    file_name_key: String,
}

pub struct Arizona {
    produtos: String,
    carrefour_path: PathBuf,
    after_fx: PathBuf,
    product_folder_path: PathBuf,
    meses: Vec<MonthFolder>,
}

impl Arizona {
    pub fn new(config: AppConfig) -> Self {
        let carrefour_path = entrypoint_path_from_drive(&config.drive);
        let after_fx = PathBuf::from(format!(
            "C:/Program Files/Adobe/Adobe After Effects {}/Support Files/AfterFX.exe",
            config.ae_version
        ));
        let product_folder_path = product_folder_path(&config.produtos_path);
        let meses = build_month_labels(&carrefour_path, 2, &config.produtos_year);

        Self {
            produtos: config.produtos,
            carrefour_path,
            after_fx,
            product_folder_path,
            meses,
        }
    }

    pub fn open_visto(&self) -> Result<(), String> {
        open_with_shell("https://carrefour.visto.global/app/workspace/tasks")
    }

    pub fn open_bitrix(&self) -> Result<(), String> {
        open_with_shell("https://arizona.bitrix24.com/crm/type/1042/kanban/category/0/")
    }

    pub fn open_pip(&self) -> Result<(), String> {
        open_with_shell("https://cfo-pip.arizonaapps.io/site/jobs")
    }

    pub fn open_claro(&self) -> Result<(), String> {
        open_with_shell("https://talentmarcelclaro.visto.global/app/login")
    }

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

        Err(format!(
            r#"Jobão "{}" não encontrado em {} nem em {}!"#,
            jobao_cod,
            self.month_label_for_error(0),
            self.month_label_for_error(1)
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

    fn project_open_info(
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

        Err(format!(r#"Código Jobinho "{}" inválido!"#, jobinho_cod))
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
                    r#"Pasta "{}" não encontrada em {}"#,
                    option, jobao_cod
                ))
            }
        };

        open_explorer(&path)
    }

    pub fn list_identical_mp4_items(
        &self,
        jobao_cod: &str,
    ) -> Result<Vec<DuplicateMp4Item>, String> {
        let mp4_folder = self.mp4_folder(jobao_cod)?;
        let mut items = Vec::new();

        for entry in fs::read_dir(&mp4_folder)
            .map_err(|err| format!("Erro ao ler {}: {err}", mp4_folder.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if !path.is_file() || !has_extension(&path, "mp4") {
                continue;
            }

            let file_name = entry.file_name().to_string_lossy().into_owned();
            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_string();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_string();

            items.push(DuplicateMp4Item {
                file_name,
                stem,
                extension,
            });
        }

        items.sort_by_key(|item| item.file_name.to_lowercase());
        Ok(items)
    }

    pub fn duplicate_identical_mp4(
        &self,
        jobao_cod: &str,
        source_file_name: &str,
        copy_names: Vec<String>,
    ) -> Result<DuplicateMp4Result, String> {
        let mp4_folder = self.mp4_folder(jobao_cod)?;
        let source_path = self.find_mp4_by_name(&mp4_folder, source_file_name)?;
        let source_file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("Nome de arquivo inválido: {}", source_path.display()))?
            .to_string();
        let source_extension = source_path
            .extension()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("Arquivo sem extensão: {}", source_path.display()))?;
        let target_file_names = validate_copy_names(&mp4_folder, &copy_names, source_extension)?;

        let mut copies = Vec::new();
        for target_file_name in &target_file_names {
            let target_path = mp4_folder.join(target_file_name);
            fs::copy(&source_path, &target_path).map_err(|err| {
                format!(
                    "Erro ao copiar {} para {}: {err}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
            copies.push(DuplicateMp4Copy {
                source_file_name: source_file_name.clone(),
                target_file_name: target_file_name.clone(),
                folder_path: mp4_folder.clone(),
                source_path: source_path.clone(),
                target_path,
            });
        }

        let count = target_file_names.len();
        let label = if count == 1 {
            "cópia criada"
        } else {
            "cópias criadas"
        };
        Ok(DuplicateMp4Result {
            message: format!("{count} {label}."),
            copies,
        })
    }

    pub fn get_visible_rows_from_xl(
        &self,
        jobao_cod: &str,
    ) -> Result<(PathBuf, Vec<String>), String> {
        let product_path = self.get_jobao_path(jobao_cod)?.join(&self.produtos);
        let sheet_path = find_spreadsheet(&product_path)
            .ok_or_else(|| format!("Nenhum .xlsx encontrado em {}", product_path.display()))?;
        let valores = read_visible_first_column(&sheet_path, SHEET_NAME)?;

        Ok((product_path, valores))
    }

    fn importar_produtos(
        &self,
        dstn_folder: &Path,
        lista_codigos: &[String],
    ) -> Result<ImportResult, String> {
        let origem = &self.product_folder_path;
        let destino = dstn_folder;
        if origem.as_os_str().is_empty() {
            return Err("Selecione a pasta Fotos Flow nas configurações.".to_string());
        }
        if !origem.is_dir() {
            return Err(format!(
                "Pasta Fotos Flow não encontrada: {}",
                origem.display()
            ));
        }

        let arquivos = list_product_source_files(origem)?;

        let mut imported_files = Vec::new();
        let mut existing_files = Vec::new();
        let mut not_found_files = Vec::new();
        let mut copy_tasks = Vec::new();
        let mut queued_copy_names = HashSet::new();

        for codigo in lista_codigos {
            if !queue_product_copy_tasks(
                &arquivos,
                codigo,
                &mut copy_tasks,
                &mut queued_copy_names,
            )? {
                not_found_files.push(codigo.clone());
            }
        }

        let copy_result = copy_product_files(destino, &copy_tasks)?;
        imported_files.extend(copy_result.imported_files);
        existing_files.extend(copy_result.existing_files);

        if !not_found_files.is_empty() {
            let retry_files = list_product_source_files(origem)?;
            let retry_codes = std::mem::take(&mut not_found_files);
            let mut retry_tasks = Vec::new();

            for codigo in retry_codes {
                if !queue_product_copy_tasks(
                    &retry_files,
                    &codigo,
                    &mut retry_tasks,
                    &mut queued_copy_names,
                )? {
                    not_found_files.push(codigo);
                }
            }

            let retry_result = copy_product_files(destino, &retry_tasks)?;
            imported_files.extend(retry_result.imported_files);
            existing_files.extend(retry_result.existing_files);
        }

        Ok(ImportResult {
            imported_files,
            existing_files,
            not_found_files,
        })
    }

    pub fn import_products(&self, jobao_cod: &str) -> Result<ProductImportReport, String> {
        let started_at = Instant::now();
        let (product_path, linhas_visiveis) = self.get_visible_rows_from_xl(jobao_cod)?;

        let mut imported_normais = Vec::new();
        let mut existing_normais = Vec::new();
        let mut not_found_normais = Vec::new();
        let mut groups = Vec::new();
        let mut linhas_soltas = Vec::new();
        let mut linhas_com_grupo = Vec::new();

        for linha in linhas_visiveis {
            if linha.contains(';') {
                linhas_com_grupo.push(linha);
            } else {
                linhas_soltas.push(linha);
            }
        }

        let codigos_soltos: Vec<String> = linhas_soltas
            .iter()
            .filter_map(|linha| first_code_part(linha))
            .collect();

        if !codigos_soltos.is_empty() {
            let res = self.importar_produtos(&product_path, &codigos_soltos)?;
            imported_normais.extend(res.imported_files);
            existing_normais.extend(res.existing_files);
            not_found_normais.extend(res.not_found_files);
        }

        for (idx, linha) in linhas_com_grupo.iter().enumerate() {
            let partes: Vec<String> = linha.split(';').filter_map(first_code_part).collect();
            let nome_pasta = format!("produtos_{:02}", idx + 1);
            let subpasta = product_path.join(&nome_pasta);
            fs::create_dir_all(&subpasta).map_err(|err| err.to_string())?;

            let res = self.importar_produtos(&subpasta, &partes)?;
            groups.push(ProductImportGroup {
                folder_name: nome_pasta,
                imported_files: res.imported_files,
                existing_files: res.existing_files,
                not_found_files: res.not_found_files,
            });
        }

        Ok(product_import_report(
            jobao_cod,
            &product_path,
            &self.product_folder_path,
            imported_normais,
            existing_normais,
            not_found_normais,
            groups,
            duration_millis(started_at),
        ))
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
            return Ok(ActionResponse::err("Praça não encontrada."));
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
            return Ok(ActionResponse::err("Roteiro não encontrado."));
        };

        open_start_file(&roteiro)?;
        Ok(ActionResponse::ok())
    }

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
            MediaType::parse(media_type).ok_or_else(|| "Tipo de vídeo inválido.".to_string())?;

        match self.project_open_info(jobao_cod, cod_jobinho) {
            Ok(project) => {
                let video = match media_type {
                    MediaType::Mp4 => project.mp4_path,
                    MediaType::Mov => project.mov_path,
                }
                .or_else(|| find_video_path_by_code(&project.jobao_path, cod_jobinho, media_type));

                let Some(video) = video else {
                    return Err("Vídeo não encontrado.".to_string());
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
                "Pasta de áudio não encontrada em {}",
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

    pub fn open_log_file(&self) -> Result<(), String> {
        let log_path = products_log_path();
        if !log_path.exists() {
            return Err(format!("Log não encontrado em {}", log_path.display()));
        }

        open_start_file(&log_path)
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

    fn month_label_for_error(&self, index: usize) -> String {
        self.meses
            .get(index)
            .map(|mes| mes.label.clone())
            .unwrap_or_else(|| "(sem mês)".to_string())
    }

    fn mp4_folder(&self, jobao_cod: &str) -> Result<PathBuf, String> {
        let folder = self
            .get_jobao_path(jobao_cod)?
            .join("OUT")
            .join("RENDER")
            .join("MP4");

        if !folder.is_dir() {
            return Err(format!("Pasta MP4 não encontrada em {}", folder.display()));
        }

        Ok(folder)
    }

    fn find_mp4_by_name(
        &self,
        mp4_folder: &Path,
        source_file_name: &str,
    ) -> Result<PathBuf, String> {
        let source_file_name = source_file_name.trim();
        if source_file_name.is_empty() {
            return Err("Selecione um arquivo MP4.".to_string());
        }

        for entry in fs::read_dir(mp4_folder)
            .map_err(|err| format!("Erro ao ler {}: {err}", mp4_folder.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if !path.is_file() || !has_extension(&path, "mp4") {
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            if name == source_file_name {
                return Ok(path);
            }
        }

        Err(format!(
            "Arquivo MP4 \"{}\" não encontrado.",
            source_file_name
        ))
    }
}

fn build_month_labels(
    carrefour_path: &Path,
    months_back: i32,
    configured_year: &str,
) -> Vec<MonthFolder> {
    let today = Local::now();
    let project_year = project_year_folder_name(configured_year);
    let current = month_folder(project_year, today.month() as i32, 0);
    let next = month_folder(project_year, today.month() as i32, 1);
    let next_path = carrefour_path
        .join("CARREFOUR")
        .join("FILMES")
        .join(next.year.to_string())
        .join(&next.label);

    let mut labels = Vec::new();
    if next_path.exists() {
        labels.push(next);
    } else {
        labels.push(current);
    }

    for offset in 1..=months_back {
        labels.push(month_folder(project_year, today.month() as i32, -offset));
    }

    labels
}

fn entrypoint_path_from_drive(drive: &str) -> PathBuf {
    PathBuf::from(drive.trim())
}

fn product_folder_path(configured_path: &str) -> PathBuf {
    PathBuf::from(configured_path.trim())
}

fn list_product_source_files(origem: &Path) -> Result<Vec<PathBuf>, String> {
    let mut arquivos = Vec::new();
    for entry in
        fs::read_dir(origem).map_err(|err| format!("Erro ao ler {}: {err}", origem.display()))?
    {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.is_file() {
            arquivos.push(path);
        }
    }

    Ok(arquivos)
}

fn queue_product_copy_tasks(
    arquivos: &[PathBuf],
    codigo: &str,
    copy_tasks: &mut Vec<(PathBuf, String)>,
    queued_copy_names: &mut HashSet<String>,
) -> Result<bool, String> {
    let encontrados: Vec<PathBuf> = arquivos
        .iter()
        .filter(|arquivo| product_file_matches_code(arquivo, codigo))
        .cloned()
        .collect();

    if encontrados.is_empty() {
        return Ok(false);
    }

    for arquivo in encontrados {
        let file_name = arquivo
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Nome de arquivo inválido: {}", arquivo.display()))?
            .to_string();
        if queued_copy_names.insert(file_name.to_lowercase()) {
            copy_tasks.push((arquivo, file_name));
        }
    }

    Ok(true)
}

fn product_file_matches_code(arquivo: &Path, codigo: &str) -> bool {
    let codigo = codigo.trim();
    if codigo.is_empty() {
        return false;
    }

    arquivo
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.to_lowercase().contains(&codigo.to_lowercase()))
        .unwrap_or(false)
}

struct CopyFilesResult {
    imported_files: Vec<String>,
    existing_files: Vec<String>,
}

enum CopyFileOutcome {
    Imported(String),
    Existing(String),
}

fn copy_product_files(
    destino: &Path,
    tasks: &[(PathBuf, String)],
) -> Result<CopyFilesResult, String> {
    let mut imported_files = Vec::new();
    let mut existing_files = Vec::new();
    let mut next_index = 0;

    while next_index < tasks.len() {
        let remaining = tasks.len() - next_index;
        let parallelism = product_copy_parallelism(remaining);
        let chunk_end = (next_index + parallelism).min(tasks.len());
        let chunk = &tasks[next_index..chunk_end];
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|(source, file_name)| {
                    let target = destino.join(file_name);
                    scope.spawn(move || copy_product_file_with_retry(source, &target, file_name))
                })
                .collect();

            handles
                .into_iter()
                .map(|handle| {
                    handle
                        .join()
                        .unwrap_or_else(|_| Err("Falha ao copiar produto.".to_string()))
                })
                .collect::<Vec<_>>()
        });

        for result in results {
            match result? {
                CopyFileOutcome::Imported(file_name) => imported_files.push(file_name),
                CopyFileOutcome::Existing(file_name) => existing_files.push(file_name),
            }
        }

        next_index = chunk_end;
    }

    Ok(CopyFilesResult {
        imported_files,
        existing_files,
    })
}

fn product_copy_parallelism(task_count: usize) -> usize {
    if task_count <= 1 {
        return 1;
    }

    let available = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(2);
    let workers = match available {
        0..=2 => 1,
        3..=4 => 2,
        5..=8 => 3,
        _ => PRODUCT_COPY_MAX_PARALLELISM,
    };

    task_count.min(workers).min(PRODUCT_COPY_MAX_PARALLELISM)
}

fn copy_product_file_with_retry(
    source: &Path,
    target: &Path,
    file_name: &str,
) -> Result<CopyFileOutcome, String> {
    for attempt in 0..=PRODUCT_COPY_MAX_RETRIES {
        match copy_product_file_once(source, target) {
            Ok(CopyFileOutcome::Imported(_)) => {
                return Ok(CopyFileOutcome::Imported(file_name.to_string()));
            }
            Ok(CopyFileOutcome::Existing(_)) => {
                return Ok(CopyFileOutcome::Existing(file_name.to_string()));
            }
            Err(err) if attempt < PRODUCT_COPY_MAX_RETRIES => {
                std::thread::sleep(Duration::from_millis(180 * (attempt as u64 + 1)));
                if target.exists() {
                    return Ok(CopyFileOutcome::Existing(file_name.to_string()));
                }

                let _ = err;
            }
            Err(err) => return Err(format!("Erro ao copiar {file_name}: {err}")),
        }
    }

    Err(format!("Erro ao copiar {file_name}."))
}

fn copy_product_file_once(source: &Path, target: &Path) -> Result<CopyFileOutcome, String> {
    if target.exists() {
        return Ok(CopyFileOutcome::Existing(String::new()));
    }

    let mut source_file = File::open(source).map_err(|err| err.to_string())?;
    let mut target_file = match OpenOptions::new().write(true).create_new(true).open(target) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            return Ok(CopyFileOutcome::Existing(String::new()));
        }
        Err(err) => return Err(err.to_string()),
    };

    match std::io::copy(&mut source_file, &mut target_file) {
        Ok(_) => Ok(CopyFileOutcome::Imported(String::new())),
        Err(err) => {
            drop(target_file);
            let _ = fs::remove_file(target);
            Err(err.to_string())
        }
    }
}

fn project_year_folder_name(configured_year: &str) -> i32 {
    let trimmed = configured_year.trim();
    if trimmed.is_empty() {
        Local::now().year()
    } else {
        trimmed.parse().unwrap_or_else(|_| Local::now().year())
    }
}

fn validate_copy_names(
    mp4_folder: &Path,
    copy_names: &[String],
    extension: &str,
) -> Result<Vec<String>, String> {
    if copy_names.is_empty() {
        return Err("Adicione ao menos um nome para a cópia.".to_string());
    }

    let existing = file_name_keys(mp4_folder)?;
    let mut requested = HashSet::new();
    let mut targets = Vec::new();

    for copy_name in copy_names {
        let file_name = normalize_copy_name(copy_name, extension)?;
        let key = file_name.to_lowercase();
        if !requested.insert(key.clone()) {
            return Err(format!("Nome repetido: \"{}\".", file_name));
        }

        if existing.contains(&key) {
            return Err(format!("Já existe um arquivo chamado \"{}\".", file_name));
        }

        let target_path = mp4_folder.join(&file_name);
        if target_path.exists() {
            return Err(format!("Já existe um arquivo chamado \"{}\".", file_name));
        }

        targets.push(file_name);
    }

    Ok(targets)
}

fn file_name_keys(mp4_folder: &Path) -> Result<HashSet<String>, String> {
    let mut names = HashSet::new();

    for entry in fs::read_dir(mp4_folder)
        .map_err(|err| format!("Erro ao ler {}: {err}", mp4_folder.display()))?
    {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.is_file() {
            names.insert(entry.file_name().to_string_lossy().to_lowercase());
        }
    }

    Ok(names)
}

fn normalize_copy_name(value: &str, extension: &str) -> Result<String, String> {
    let extension = extension.trim().trim_start_matches('.');
    if extension.is_empty() {
        return Err("Extensão do arquivo matriz inválida.".to_string());
    }

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Preencha todos os nomes das cópias.".to_string());
    }

    if trimmed.contains('\\') || trimmed.contains('/') {
        return Err(format!("Use somente o nome do arquivo: \"{}\".", trimmed));
    }

    if trimmed.chars().any(has_invalid_windows_file_char) {
        return Err(format!("Nome inválido para arquivo: \"{}\".", trimmed));
    }

    let lower = trimmed.to_lowercase();
    let extension_suffix = format!(".{}", extension.to_lowercase());
    let stem = if lower.ends_with(&extension_suffix) {
        &trimmed[..trimmed.len() - extension_suffix.len()]
    } else {
        trimmed
    };

    if stem.trim().is_empty() {
        return Err(format!("Informe um nome antes da extensão .{}.", extension));
    }

    if stem.ends_with(' ') || stem.ends_with('.') {
        return Err(format!("Nome inválido para arquivo: \"{}\".", trimmed));
    }

    if is_reserved_windows_name(stem) {
        return Err(format!("Nome reservado pelo Windows: \"{}\".", stem));
    }

    Ok(format!("{stem}.{extension}"))
}

fn has_invalid_windows_file_char(ch: char) -> bool {
    matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*') || ch.is_control()
}

fn is_reserved_windows_name(stem: &str) -> bool {
    let base = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(
        base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(extension))
        .unwrap_or(false)
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
            .unwrap_or_else(|| format!(" para a região {}", region.trim().to_uppercase()));
        return Err(format!(
            "Áudio{} não encontrado em {}.",
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

fn month_folder(year: i32, month: i32, offset: i32) -> MonthFolder {
    let zero_based = year * 12 + (month - 1) + offset;
    let target_year = zero_based.div_euclid(12);
    let target_month = zero_based.rem_euclid(12) + 1;

    MonthFolder {
        year: target_year,
        label: format!("{target_month:02}_{}", month_name_pt(target_month)),
    }
}

fn month_name_pt(month: i32) -> &'static str {
    match month {
        1 => "JANEIRO",
        2 => "FEVEREIRO",
        3 => "MARCO",
        4 => "ABRIL",
        5 => "MAIO",
        6 => "JUNHO",
        7 => "JULHO",
        8 => "AGOSTO",
        9 => "SETEMBRO",
        10 => "OUTUBRO",
        11 => "NOVEMBRO",
        12 => "DEZEMBRO",
        _ => "MES_INVALIDO",
    }
}

fn starts_with_two_digits(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_digit() && bytes[1].is_ascii_digit()
}

fn open_with_shell(target: &str) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "", target])
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

pub(crate) fn open_start_file(path: &Path) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

pub(crate) fn open_explorer(path: &Path) -> Result<(), String> {
    Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

pub(crate) fn reveal_in_explorer(path: &Path) -> Result<(), String> {
    Command::new("explorer")
        .arg("/select,")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn find_spreadsheet(folder_path: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(folder_path).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("xlsx"))
                .unwrap_or(false)
        {
            return Some(path);
        }
    }

    None
}

fn read_visible_first_column(xlsx_path: &Path, sheet_name: &str) -> Result<Vec<String>, String> {
    let file = File::open(xlsx_path).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;

    let workbook_xml = read_zip_text(&mut archive, "xl/workbook.xml")?;
    let rels_xml = read_zip_text(&mut archive, "xl/_rels/workbook.xml.rels")?;
    let sheet_target = find_sheet_target(&workbook_xml, &rels_xml, sheet_name)?;
    let sheet_xml = read_zip_text(&mut archive, &sheet_target)?;
    let shared_strings = match read_zip_text(&mut archive, "xl/sharedStrings.xml") {
        Ok(xml) => parse_shared_strings(&xml)?,
        Err(_) => Vec::new(),
    };

    parse_visible_first_column(&sheet_xml, &shared_strings)
}

fn read_zip_text<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<String, String> {
    let mut file = archive.by_name(name).map_err(|err| err.to_string())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|err| err.to_string())?;
    Ok(text)
}

fn find_sheet_target(
    workbook_xml: &str,
    rels_xml: &str,
    sheet_name: &str,
) -> Result<String, String> {
    let doc = Document::parse(workbook_xml).map_err(|err| err.to_string())?;
    let sheet = doc
        .descendants()
        .find(|node| {
            node.is_element()
                && node.tag_name().name() == "sheet"
                && node.attribute("name") == Some(sheet_name)
        })
        .ok_or_else(|| format!(r#"Aba "{}" não encontrada."#, sheet_name))?;

    let relation_id = sheet
        .attributes()
        .find(|attr| attr.name() == "id")
        .map(|attr| attr.value().to_string())
        .ok_or_else(|| format!(r#"Relação da aba "{}" não encontrada."#, sheet_name))?;

    let target = find_relationship_target(&rels_xml, &relation_id)?;
    Ok(normalize_workbook_target(&target))
}

fn find_relationship_target(rels_xml: &str, relation_id: &str) -> Result<String, String> {
    let doc = Document::parse(rels_xml).map_err(|err| err.to_string())?;
    doc.descendants()
        .find(|node| {
            node.is_element()
                && node.tag_name().name() == "Relationship"
                && node.attribute("Id") == Some(relation_id)
        })
        .and_then(|node| node.attribute("Target"))
        .map(|target| target.to_string())
        .ok_or_else(|| format!(r#"Target da relação "{}" não encontrado."#, relation_id))
}

fn normalize_workbook_target(target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("xl/") {
        target.to_string()
    } else {
        format!("xl/{target}")
    }
}

fn parse_shared_strings(xml: &str) -> Result<Vec<String>, String> {
    let doc = Document::parse(xml).map_err(|err| err.to_string())?;
    let mut values = Vec::new();

    for si in doc
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "si")
    {
        let mut text = String::new();
        for t in si
            .descendants()
            .filter(|node| node.is_element() && node.tag_name().name() == "t")
        {
            if let Some(value) = t.text() {
                text.push_str(value);
            }
        }
        values.push(text);
    }

    Ok(values)
}

fn parse_visible_first_column(xml: &str, shared_strings: &[String]) -> Result<Vec<String>, String> {
    let doc = Document::parse(xml).map_err(|err| err.to_string())?;
    let mut values = Vec::new();

    for row in doc
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "row")
    {
        if is_hidden_row(row) {
            continue;
        }

        if let Some(cell) = first_column_cell(row) {
            if let Some(value) = cell_text(cell, shared_strings) {
                let value = value.trim().to_string();
                if !value.is_empty() {
                    values.push(value);
                }
            }
        }
    }

    Ok(values)
}

fn is_hidden_row(row: Node<'_, '_>) -> bool {
    matches!(row.attribute("hidden"), Some("1") | Some("true"))
}

fn first_column_cell<'a, 'input>(row: Node<'a, 'input>) -> Option<Node<'a, 'input>> {
    let mut fallback = None;
    for cell in row
        .children()
        .filter(|node| node.is_element() && node.tag_name().name() == "c")
    {
        if fallback.is_none() {
            fallback = Some(cell);
        }

        if cell.attribute("r").map(is_column_a).unwrap_or(false) {
            return Some(cell);
        }
    }

    fallback.filter(|cell| cell.attribute("r").is_none())
}

fn is_column_a(cell_ref: &str) -> bool {
    let column: String = cell_ref
        .chars()
        .take_while(|ch| ch.is_ascii_alphabetic())
        .collect();
    column.eq_ignore_ascii_case("A")
}

fn cell_text(cell: Node<'_, '_>, shared_strings: &[String]) -> Option<String> {
    if cell.attribute("t") == Some("inlineStr") {
        let mut text = String::new();
        for node in cell
            .descendants()
            .filter(|node| node.is_element() && node.tag_name().name() == "t")
        {
            if let Some(value) = node.text() {
                text.push_str(value);
            }
        }
        return Some(text);
    }

    let raw_value = cell
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "v")
        .and_then(|node| node.text())?;

    if cell.attribute("t") == Some("s") {
        let idx = raw_value.parse::<usize>().ok()?;
        return shared_strings.get(idx).cloned();
    }

    Some(raw_value.to_string())
}

fn first_code_part(value: &str) -> Option<String> {
    let code = value.split('.').next()?.trim();
    if code.is_empty() {
        None
    } else {
        Some(code.to_string())
    }
}

fn products_log_path() -> PathBuf {
    std::env::temp_dir().join("produtos-log.txt")
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

fn product_import_report(
    jobao_cod: &str,
    product_path: &Path,
    source_path: &Path,
    imported_files: Vec<String>,
    existing_files: Vec<String>,
    not_found_files: Vec<String>,
    groups: Vec<ProductImportGroup>,
    duration_millis: u64,
) -> ProductImportReport {
    let total_processed = imported_files.len()
        + existing_files.len()
        + not_found_files.len()
        + groups
            .iter()
            .map(|group| {
                group.imported_files.len()
                    + group.existing_files.len()
                    + group.not_found_files.len()
            })
            .sum::<usize>();
    let total_imported = imported_files.len()
        + groups
            .iter()
            .map(|group| group.imported_files.len())
            .sum::<usize>();
    let total_existing = existing_files.len()
        + groups
            .iter()
            .map(|group| group.existing_files.len())
            .sum::<usize>();
    let total_not_found = not_found_files.len()
        + groups
            .iter()
            .map(|group| group.not_found_files.len())
            .sum::<usize>();

    ProductImportReport {
        jobao_cod: jobao_cod.trim().to_string(),
        product_path: product_path.to_string_lossy().into_owned(),
        source_path: source_path.to_string_lossy().into_owned(),
        imported_files,
        existing_files,
        not_found_files,
        groups,
        total_processed,
        total_imported,
        total_existing,
        total_not_found,
        duration_millis,
    }
}

fn duration_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u64::MAX as u128) as u64
}

#[allow(dead_code)]
fn write_products_log(
    imported_normais: &[String],
    not_found_normais: &[String],
    grupos_resultados: &[ProductImportGroup],
) -> Result<(), String> {
    let log_path = products_log_path();
    let mut logf = File::create(&log_path).map_err(|err| err.to_string())?;

    let total_processados = imported_normais.len()
        + not_found_normais.len()
        + grupos_resultados
            .iter()
            .map(|grupo| grupo.imported_files.len() + grupo.not_found_files.len())
            .sum::<usize>();
    let total_importados = imported_normais.len()
        + grupos_resultados
            .iter()
            .map(|grupo| grupo.imported_files.len())
            .sum::<usize>();
    let total_nao_encontrados = not_found_normais.len()
        + grupos_resultados
            .iter()
            .map(|grupo| grupo.not_found_files.len())
            .sum::<usize>();

    writeln!(logf, "=== Resumo Geral ===").map_err(|err| err.to_string())?;
    writeln!(logf, "Total de códigos processados: {total_processados}")
        .map_err(|err| err.to_string())?;
    writeln!(logf, "Importados: {total_importados}").map_err(|err| err.to_string())?;
    writeln!(logf, "Não encontrados: {total_nao_encontrados}").map_err(|err| err.to_string())?;
    writeln!(logf, "Grupos detectados: {}\n", grupos_resultados.len())
        .map_err(|err| err.to_string())?;

    writeln!(logf, "=== Produtos Não Encontrados ===").map_err(|err| err.to_string())?;
    for file in not_found_normais {
        writeln!(logf, "❌ {file}").map_err(|err| err.to_string())?;
    }
    for grupo in grupos_resultados {
        for file in &grupo.not_found_files {
            writeln!(logf, "❌ {file}").map_err(|err| err.to_string())?;
        }
    }
    writeln!(logf).map_err(|err| err.to_string())?;

    writeln!(logf, "=== Produtos Importados ===").map_err(|err| err.to_string())?;
    for file in imported_normais {
        writeln!(logf, "✅ {file}").map_err(|err| err.to_string())?;
    }
    for file in not_found_normais {
        writeln!(logf, "❌ {file}").map_err(|err| err.to_string())?;
    }
    writeln!(logf).map_err(|err| err.to_string())?;

    if !grupos_resultados.is_empty() {
        writeln!(logf, "=== Grupos ===\n").map_err(|err| err.to_string())?;
        for grupo in grupos_resultados {
            writeln!(logf, "{}", grupo.folder_name).map_err(|err| err.to_string())?;
            let total = grupo.imported_files.len() + grupo.not_found_files.len();
            let mut index = 0;

            for file in &grupo.imported_files {
                index += 1;
                let prefix = if index < total { " ┣ " } else { " ┗ " };
                writeln!(logf, "{prefix}✅ {file}").map_err(|err| err.to_string())?;
            }

            for file in &grupo.not_found_files {
                index += 1;
                let prefix = if index < total { " ┣ " } else { " ┗ " };
                writeln!(logf, "{prefix}❌ {file}").map_err(|err| err.to_string())?;
            }
            writeln!(logf).map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_mp4_copy_names() {
        assert_eq!(
            normalize_copy_name("novo_nome", "mp4").unwrap(),
            "novo_nome.mp4"
        );
        assert_eq!(
            normalize_copy_name("novo_nome.MP4", "mp4").unwrap(),
            "novo_nome.mp4"
        );
        assert_eq!(
            normalize_copy_name("novo_nome", "MOV").unwrap(),
            "novo_nome.MOV"
        );
    }

    #[test]
    fn rejects_invalid_mp4_copy_names() {
        assert!(normalize_copy_name("", "mp4").is_err());
        assert!(normalize_copy_name("pasta/arquivo", "mp4").is_err());
        assert!(normalize_copy_name("CON", "mp4").is_err());
        assert!(normalize_copy_name("arquivo?.mp4", "mp4").is_err());
    }

    #[test]
    fn rejects_duplicate_or_existing_mp4_copy_names() {
        let folder = std::env::temp_dir().join(format!(
            "arizona_duplicate_identical_test_{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("existente.mp4"), b"").unwrap();

        let duplicate_names = vec!["novo".to_string(), "novo.mp4".to_string()];
        assert!(validate_copy_names(&folder, &duplicate_names, "mp4")
            .unwrap_err()
            .contains("Nome repetido"));

        let existing_name = vec!["existente".to_string()];
        assert!(validate_copy_names(&folder, &existing_name, "mp4")
            .unwrap_err()
            .contains("Já existe"));

        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn resolves_project_year_folder_name() {
        let current_year = Local::now().year();

        assert_eq!(project_year_folder_name(""), current_year);
        assert_eq!(project_year_folder_name("2027"), 2027);
        assert_eq!(project_year_folder_name(" 2027 "), 2027);
    }

    #[test]
    fn resolves_entrypoint_from_drive_config_without_appending() {
        assert_eq!(
            entrypoint_path_from_drive(r"I:\Drives compartilhados\Phx CRF Copa"),
            PathBuf::from(r"I:\Drives compartilhados\Phx CRF Copa")
        );
    }

    #[test]
    fn resolves_product_source_folder_from_config() {
        assert_eq!(
            product_folder_path(r"D:\Produtos Fonte"),
            PathBuf::from(r"D:\Produtos Fonte")
        );
    }

    #[test]
    fn product_source_match_accepts_exact_stem_ignoring_case() {
        assert!(product_file_matches_code(
            Path::new("Fraldinha_Bovina.png"),
            "fraldinha_bovina"
        ));
        assert!(product_file_matches_code(Path::new("3389987.png"), "3389987"));
    }

    #[test]
    fn product_source_match_accepts_partial_stem_like_python_importer() {
        assert!(product_file_matches_code(
            Path::new("4136152_A_OK.png"),
            "4136152"
        ));
        assert!(product_file_matches_code(
            Path::new("Icone_Borda_Memoria_256GB.png"),
            "Borda_Memoria"
        ));
        assert!(!product_file_matches_code(
            Path::new("Fraldinha_Bovina.png"),
            "Picanha_Bovina"
        ));
    }
}
