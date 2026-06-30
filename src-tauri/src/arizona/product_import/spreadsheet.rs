use roxmltree::{Document, Node};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};
use zip::ZipArchive;

pub(super) fn find_spreadsheet(folder_path: &Path) -> Option<PathBuf> {
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

pub(super) fn read_visible_first_column(
    xlsx_path: &Path,
    sheet_name: &str,
) -> Result<Vec<String>, String> {
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
        .ok_or_else(|| format!(r#"Aba "{}" nÃ£o encontrada."#, sheet_name))?;

    let relation_id = sheet
        .attributes()
        .find(|attr| attr.name() == "id")
        .map(|attr| attr.value().to_string())
        .ok_or_else(|| format!(r#"RelaÃ§Ã£o da aba "{}" nÃ£o encontrada."#, sheet_name))?;

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
        .ok_or_else(|| format!(r#"Target da relaÃ§Ã£o "{}" nÃ£o encontrado."#, relation_id))
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
