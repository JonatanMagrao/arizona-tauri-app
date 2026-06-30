use serde::Serialize;
use std::{path::Path, time::Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProductImportGroup {
    pub(super) folder_name: String,
    pub(super) imported_files: Vec<String>,
    pub(super) existing_files: Vec<String>,
    pub(super) not_found_files: Vec<String>,
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

pub(super) fn product_import_report(
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

pub(super) fn duration_millis(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u64::MAX as u128) as u64
}
