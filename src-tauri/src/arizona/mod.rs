use std::path::PathBuf;

use crate::settings::AppConfig;

mod duplicate_mp4;
mod links;
mod media_files;
mod models;
mod months;
mod product_import;
mod project;
mod response;
mod shell;

pub(crate) use self::shell::{open_explorer, open_start_file, reveal_in_explorer};
pub use self::{
    duplicate_mp4::{
        DuplicateMp4Copy, DuplicateMp4Item, DuplicateMp4NamesJsonExport,
        DuplicateMp4NamesJsonImport,
    },
    models::{MediaFile, OpenedProject},
    product_import::ProductImportReport,
    response::ActionResponse,
};

use self::{
    models::MonthFolder,
    months::{build_month_labels, entrypoint_path_from_drive},
    product_import::product_folder_path,
};

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
}
