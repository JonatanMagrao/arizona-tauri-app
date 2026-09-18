use super::*;
use crate::arizona::models::MonthFolder;
use serde_json::json;
use std::{
    io::Write,
    sync::atomic::{AtomicUsize, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, ZipWriter};

static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);

struct ImportFixture {
    root: PathBuf,
    app: Arizona,
}

impl ImportFixture {
    fn new(source_names: &[&str]) -> Self {
        let root = std::env::temp_dir().join(format!(
            "arizona-product-import-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let source = root.join("source");
        fs::create_dir(&source).unwrap();
        for name in source_names {
            fs::write(source.join(name), name.as_bytes()).unwrap();
        }
        let app = Arizona {
            produtos: "PRODUTOS".into(),
            carrefour_path: root.join("drive"),
            after_fx: PathBuf::new(),
            product_folder_path: source,
            meses: vec![MonthFolder {
                year: 2026,
                label: "09_SETEMBRO".into(),
            }],
        };
        Self { root, app }
    }

    fn add_job(&self, code: &str, rows: &[&str]) -> PathBuf {
        let products = self
            .app
            .carrefour_path
            .join("CARREFOUR/FILMES/2026/09_SETEMBRO")
            .join(format!("05_{code}_29266_TEST"))
            .join("PRODUTOS");
        fs::create_dir_all(&products).unwrap();
        write_spreadsheet(&products.join("products.xlsx"), rows);
        products
    }
}

impl Drop for ImportFixture {
    fn drop(&mut self) {
        let temp_root = std::env::temp_dir().canonicalize().unwrap();
        assert_eq!(self.root.parent(), Some(temp_root.as_path()));
        assert!(self
            .root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("arizona-product-import-"));
        fs::remove_dir_all(&self.root).unwrap();
    }
}

fn write_spreadsheet(path: &Path, rows: &[&str]) {
    let sheet_rows = rows
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let value = value
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            format!(
                r#"<row r="{0}"><c r="A{0}" t="inlineStr"><is><t>{value}</t></is></c></row>"#,
                index + 1
            )
        })
        .collect::<String>();
    let sheet = format!("<worksheet><sheetData>{sheet_rows}</sheetData></worksheet>");
    let mut writer = ZipWriter::new(fs::File::create(path).unwrap());
    for (name, contents) in [
        (
            "xl/workbook.xml",
            r#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Consolidado" r:id="rId1"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>"#,
        ),
        ("xl/worksheets/sheet1.xml", sheet.as_str()),
    ] {
        writer
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(contents.as_bytes()).unwrap();
    }
    writer.finish().unwrap();
}

fn file_names(path: &Path) -> Vec<String> {
    let mut names = fs::read_dir(path)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    names.sort();
    names
}

#[test]
fn resolves_product_source_folder_from_config() {
    assert_eq!(
        product_folder_path(r"D:\Produtos Fonte"),
        PathBuf::from(r"D:\Produtos Fonte")
    );
}

#[test]
fn groups_use_case_insensitive_code_sets_including_missing_products() {
    let fixture = ImportFixture::new(&["Maçã.png", "B.png", "Single.png"]);
    let products = fixture.add_job(
        "1387",
        &[
            "sInGlE",
            " Maçã.png ; B ; MAÇÃ ; Missing ; missing ",
            "missing; b.PNG; maçã",
            "B;MAÇÃ;OtherMissing",
            " ; ; ",
        ],
    );

    let report = fixture.app.import_products("1387").unwrap();
    assert_eq!(report.total_groups(), 2);
    assert_eq!(report.total_imported(), 5);
    assert_eq!(report.total_existing(), 0);
    assert_eq!(report.total_not_found(), 2);
    assert_eq!(report.total_processed(), 7);
    let serialized = serde_json::to_value(&report).unwrap();
    assert_eq!(serialized["importedFiles"], json!(["Single.png"]));
    assert_eq!(
        serialized["groups"],
        json!([
            {
                "folderName": "produtos_01",
                "importedFiles": ["Maçã.png", "B.png"],
                "existingFiles": [],
                "notFoundFiles": ["Missing"]
            },
            {
                "folderName": "produtos_03",
                "importedFiles": ["B.png", "Maçã.png"],
                "existingFiles": [],
                "notFoundFiles": ["OtherMissing"]
            }
        ])
    );
    assert_eq!(
        file_names(&products),
        ["Single.png", "products.xlsx", "produtos_01", "produtos_03"]
    );
    for name in ["produtos_01", "produtos_03"] {
        assert_eq!(file_names(&products.join(name)), ["B.png", "Maçã.png"]);
        assert_eq!(
            fs::read(products.join(name).join("Maçã.png")).unwrap(),
            "Maçã.png".as_bytes()
        );
    }
}

#[test]
fn equivalent_groups_are_imported_independently_for_each_jobao() {
    let fixture = ImportFixture::new(&["A.png", "B.png"]);
    for code in ["1387", "1388"] {
        let products = fixture.add_job(code, &["A;B", "b;a"]);
        let report = fixture.app.import_products(code).unwrap();
        assert_eq!(report.total_groups(), 1);
        assert_eq!(report.total_imported(), 2);
        assert_eq!(report.total_processed(), 2);
        assert_eq!(report.total_existing(), 0);
        assert_eq!(file_names(&products), ["products.xlsx", "produtos_01"]);
        assert_eq!(
            file_names(&products.join("produtos_01")),
            ["A.png", "B.png"]
        );
    }
}

#[test]
fn rerun_preserves_group_numbers_existing_files_and_old_duplicate_folders() {
    let fixture = ImportFixture::new(&["A.png", "B.png", "C.png", "D.png"]);
    let products = fixture.add_job("1387", &["A;B", "b;a", "C;D"]);
    fs::create_dir(products.join("produtos_02")).unwrap();
    fs::write(products.join("produtos_02/legacy.txt"), b"old duplicate").unwrap();
    fs::create_dir(products.join("produtos_03")).unwrap();
    fs::write(
        products.join("produtos_03/C.png"),
        b"existing local version",
    )
    .unwrap();

    let first = fixture.app.import_products("1387").unwrap();
    assert_eq!(first.total_groups(), 2);
    assert_eq!(first.total_imported(), 3);
    assert_eq!(first.total_existing(), 1);
    let second = fixture.app.import_products("1387").unwrap();
    assert_eq!(second.total_groups(), 2);
    assert_eq!(second.total_imported(), 0);
    assert_eq!(second.total_existing(), 4);
    assert_eq!(second.total_not_found(), 0);
    assert_eq!(second.total_processed(), 4);
    let serialized = serde_json::to_value(second).unwrap();
    assert_eq!(serialized["groups"][0]["folderName"], "produtos_01");
    assert_eq!(serialized["groups"][1]["folderName"], "produtos_03");
    assert_eq!(
        file_names(&products),
        ["products.xlsx", "produtos_01", "produtos_02", "produtos_03"]
    );
    assert_eq!(
        file_names(&products.join("produtos_01")),
        ["A.png", "B.png"]
    );
    assert_eq!(file_names(&products.join("produtos_02")), ["legacy.txt"]);
    assert_eq!(
        file_names(&products.join("produtos_03")),
        ["C.png", "D.png"]
    );
    assert_eq!(
        fs::read(products.join("produtos_02/legacy.txt")).unwrap(),
        b"old duplicate"
    );
    assert_eq!(
        fs::read(products.join("produtos_03/C.png")).unwrap(),
        b"existing local version"
    );
}
