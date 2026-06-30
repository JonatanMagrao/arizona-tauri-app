use chrono::{Datelike, Local};
use std::path::{Path, PathBuf};

use super::models::MonthFolder;

pub(super) fn build_month_labels(
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
        labels.push(current);
    } else {
        labels.push(current);
    }

    for offset in 1..=months_back {
        labels.push(month_folder(project_year, today.month() as i32, -offset));
    }

    labels
}

pub(super) fn entrypoint_path_from_drive(drive: &str) -> PathBuf {
    PathBuf::from(drive.trim())
}

fn project_year_folder_name(configured_year: &str) -> i32 {
    let trimmed = configured_year.trim();
    if trimmed.is_empty() {
        Local::now().year()
    } else {
        trimmed.parse().unwrap_or_else(|_| Local::now().year())
    }
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
