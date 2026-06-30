use super::{shell::open_with_shell, Arizona};

impl Arizona {
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
}
