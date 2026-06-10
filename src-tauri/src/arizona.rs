use chrono::{Datelike, Local};
use regex::Regex;
use roxmltree::{Document, Node};
use serde::Serialize;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
};
use zip::ZipArchive;

use crate::settings::AppConfig;

const SHEET_NAME: &str = "Consolidado";

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
    not_found_files: Vec<String>,
}

struct GroupResult {
    nome_pasta: String,
    imported_files: Vec<String>,
    not_found_files: Vec<String>,
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

pub struct Arizona {
    produtos: String,
    carrefour_path: PathBuf,
    after_fx: PathBuf,
    product_folder_path: PathBuf,
    meses: Vec<MonthFolder>,
}

impl Arizona {
    pub fn new(config: AppConfig) -> Self {
        let drive_root = PathBuf::from(&config.drive);
        let carrefour_path = drive_root.join("Phx CRF");
        let after_fx = PathBuf::from(format!(
            "C:/Program Files/Adobe/Adobe After Effects {}/Support Files/AfterFX.exe",
            config.ae_version
        ));
        let product_folder_path = carrefour_path
            .join("CARREFOUR")
            .join("ASSETS")
            .join("_FOTOS FLOW");
        let meses = build_month_labels(&carrefour_path, 2);

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
                    mp4_path: find_video_path(&jobao_path, &project_stem, "mp4"),
                    mov_path: find_video_path(&jobao_path, &project_stem, "mov"),
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
            "roteiro" => jobao_path.join("ROTEIRO").join("LOCUCAO"),
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

        let mut arquivos = Vec::new();
        for entry in fs::read_dir(origem)
            .map_err(|err| format!("Erro ao ler {}: {err}", origem.display()))?
        {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if path.is_file() {
                arquivos.push(path);
            }
        }

        let mut imported_files = Vec::new();
        let mut not_found_files = Vec::new();

        for codigo in lista_codigos {
            let codigo_lower = codigo.to_lowercase();
            let encontrados: Vec<&PathBuf> = arquivos
                .iter()
                .filter(|arquivo| {
                    arquivo
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .map(|stem| stem.to_lowercase() == codigo_lower)
                        .unwrap_or(false)
                })
                .collect();

            if encontrados.is_empty() {
                not_found_files.push(codigo.clone());
                continue;
            }

            for arquivo in encontrados {
                let file_name = arquivo
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| format!("Nome de arquivo inválido: {}", arquivo.display()))?;
                fs::copy(arquivo, destino.join(file_name))
                    .map_err(|err| format!("⚠️ Erro ao copiar {file_name}: {err}"))?;
                imported_files.push(file_name.to_string());
            }
        }

        Ok(ImportResult {
            imported_files,
            not_found_files,
        })
    }

    pub fn import_products(&self, jobao_cod: &str) -> Result<(), String> {
        let (product_path, linhas_visiveis) = self.get_visible_rows_from_xl(jobao_cod)?;

        let mut imported_normais = Vec::new();
        let mut not_found_normais = Vec::new();
        let mut grupos_resultados = Vec::new();
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
            not_found_normais.extend(res.not_found_files);
        }

        for (idx, linha) in linhas_com_grupo.iter().enumerate() {
            let partes: Vec<String> = linha.split(';').filter_map(first_code_part).collect();
            let nome_pasta = format!("produtos_{:02}", idx + 1);
            let subpasta = product_path.join(&nome_pasta);
            fs::create_dir_all(&subpasta).map_err(|err| err.to_string())?;

            let res = self.importar_produtos(&subpasta, &partes)?;
            grupos_resultados.push(GroupResult {
                nome_pasta,
                imported_files: res.imported_files,
                not_found_files: res.not_found_files,
            });
        }

        write_products_log(&imported_normais, &not_found_normais, &grupos_resultados)?;
        open_start_file(&products_log_path())?;

        Ok(())
    }

    pub fn open_roteiro(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
    ) -> Result<ActionResponse, String> {
        let jobao = self.get_jobao_path(jobao_cod)?;
        let roteiros = jobao.join("ROTEIRO").join("LOCUCAO");
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

    pub fn open_video(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
        media_type: &str,
    ) -> Result<ActionResponse, String> {
        self.handle_video(jobao_cod, cod_jobinho, media_type, open_start_file)
    }

    pub fn reveal_video(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
        media_type: &str,
    ) -> Result<ActionResponse, String> {
        self.handle_video(jobao_cod, cod_jobinho, media_type, reveal_in_explorer)
    }

    fn handle_video(
        &self,
        jobao_cod: &str,
        cod_jobinho: &str,
        media_type: &str,
        opener: fn(&Path) -> Result<(), String>,
    ) -> Result<ActionResponse, String> {
        let project = self.project_open_info(jobao_cod, cod_jobinho)?;
        let video = match media_type {
            "mp4" => project.mp4_path,
            "mov" => project.mov_path,
            _ => None,
        };

        let Some(video) = video else {
            return Ok(ActionResponse::err("Vídeo não encontrado."));
        };

        opener(&video)?;
        Ok(ActionResponse::ok())
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
}

fn build_month_labels(carrefour_path: &Path, months_back: i32) -> Vec<MonthFolder> {
    let today = Local::now();
    let current = month_folder(today.year(), today.month() as i32, 0);
    let next = month_folder(today.year(), today.month() as i32, 1);
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
        labels.push(month_folder(today.year(), today.month() as i32, -offset));
    }

    labels
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

fn write_products_log(
    imported_normais: &[String],
    not_found_normais: &[String],
    grupos_resultados: &[GroupResult],
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
            writeln!(logf, "{}", grupo.nome_pasta).map_err(|err| err.to_string())?;
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
