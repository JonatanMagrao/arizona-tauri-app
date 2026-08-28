use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use super::Arizona;

mod copy;
mod report;
mod spreadsheet;

use copy::{copy_product_files, list_product_source_files, queue_product_copy_tasks};
use report::ProductImportGroup;
pub use report::ProductImportReport;
use report::{duration_millis, product_import_report};
use spreadsheet::{find_spreadsheet, read_visible_first_column};

const SHEET_NAME: &str = "Consolidado";

struct ImportResult {
    imported_files: Vec<String>,
    existing_files: Vec<String>,
    not_found_files: Vec<String>,
}

impl Arizona {
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
}

pub(super) fn product_folder_path(configured_path: &str) -> PathBuf {
    PathBuf::from(configured_path.trim())
}

fn first_code_part(value: &str) -> Option<String> {
    let code = value.split('.').next()?.trim();
    if code.is_empty() {
        None
    } else {
        Some(code.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_product_source_folder_from_config() {
        assert_eq!(
            product_folder_path(r"D:\Produtos Fonte"),
            PathBuf::from(r"D:\Produtos Fonte")
        );
    }
}
