use chrono::{DateTime, SecondsFormat, Utc};
use std::fs::File;
use std::io::Read;
use std::path::Path;

const MAX_DOCX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoteiroDocument {
    file_name: String,
    jobao_cod: String,
    jobinho_cod: String,
    praca: String,
    modified_at: Option<String>,
    content: String,
}

impl RoteiroDocument {
    pub fn project_title(&self) -> String {
        format!("{} - {} - {}", self.jobao_cod, self.jobinho_cod, self.praca)
    }
}

pub fn read_document(
    path: &Path,
    jobao_cod: &str,
    jobinho_cod: &str,
    praca: &str,
) -> Result<RoteiroDocument, String> {
    let is_docx = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("docx"));
    if !is_docx {
        return Err("O roteiro selecionado não é um arquivo DOCX.".to_string());
    }

    let metadata = path
        .metadata()
        .map_err(|err| format!("Não foi possível ler {}: {err}", path.display()))?;
    if metadata.len() > MAX_DOCX_BYTES {
        return Err("O roteiro é grande demais para o visualizador interno.".to_string());
    }

    let file = File::open(path)
        .map_err(|err| format!("Não foi possível abrir {}: {err}", path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "O arquivo de roteiro não é um DOCX válido.".to_string())?;
    let mut document_xml = archive
        .by_name("word/document.xml")
        .map_err(|_| "O DOCX não contém o texto principal do roteiro.".to_string())?;

    if document_xml.size() > MAX_DOCUMENT_XML_BYTES {
        return Err("O texto do roteiro é grande demais para o visualizador interno.".to_string());
    }

    let mut xml_bytes = Vec::with_capacity(document_xml.size() as usize);
    document_xml
        .by_ref()
        .take(MAX_DOCUMENT_XML_BYTES + 1)
        .read_to_end(&mut xml_bytes)
        .map_err(|err| format!("Não foi possível extrair o texto do DOCX: {err}"))?;
    if xml_bytes.len() as u64 > MAX_DOCUMENT_XML_BYTES {
        return Err("O texto do roteiro é grande demais para o visualizador interno.".to_string());
    }

    let xml = std::str::from_utf8(&xml_bytes)
        .map_err(|_| "O texto interno do DOCX não está em UTF-8 válido.".to_string())?;
    let content = extract_text_from_xml(xml)?;
    if content.trim().is_empty() {
        return Err("O roteiro não contém texto legível.".to_string());
    }

    let modified_at = metadata
        .modified()
        .ok()
        .map(|value| DateTime::<Utc>::from(value).to_rfc3339_opts(SecondsFormat::Secs, true));

    Ok(RoteiroDocument {
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Roteiro.docx")
            .to_string(),
        jobao_cod: jobao_cod.trim().to_string(),
        jobinho_cod: jobinho_cod.trim().to_string(),
        praca: praca.trim().to_string(),
        modified_at,
        content,
    })
}

fn extract_text_from_xml(xml: &str) -> Result<String, String> {
    let document = roxmltree::Document::parse(xml)
        .map_err(|err| format!("Não foi possível interpretar o texto do DOCX: {err}"))?;
    let mut paragraphs = Vec::new();

    for paragraph in document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "p")
    {
        let mut text = String::new();
        for node in paragraph.descendants().filter(|node| node.is_element()) {
            match node.tag_name().name() {
                "t" => {
                    if let Some(value) = node.text() {
                        text.push_str(value);
                    }
                }
                "tab" => text.push('\t'),
                "br" | "cr" => text.push('\n'),
                _ => {}
            }
        }
        paragraphs.push(text.trim_end().to_string());
    }

    Ok(paragraphs.join("\n").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::extract_text_from_xml;

    #[test]
    fn extracts_paragraphs_and_decodes_entities() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
            <w:document xmlns:w="urn:test"><w:body>
              <w:p><w:r><w:t>CARREFOUR &amp; REGIÃO</w:t></w:r></w:p>
              <w:p><w:r><w:t>Arroz</w:t></w:r><w:r><w:t> R$ 19,90</w:t></w:r></w:p>
            </w:body></w:document>"#;

        assert_eq!(
            extract_text_from_xml(xml).unwrap(),
            "CARREFOUR & REGIÃO\nArroz R$ 19,90"
        );
    }

    #[test]
    fn preserves_empty_paragraphs_breaks_and_tabs() {
        let xml = r#"<w:document xmlns:w="urn:test"><w:body>
            <w:p><w:r><w:t>Oferta 1</w:t><w:br/><w:t>Complemento</w:t></w:r></w:p>
            <w:p></w:p>
            <w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>
          </w:body></w:document>"#;

        assert_eq!(
            extract_text_from_xml(xml).unwrap(),
            "Oferta 1\nComplemento\n\nA\tB"
        );
    }
}
