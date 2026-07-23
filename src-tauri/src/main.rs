// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if std::env::args().any(|arg| arg == "--release-device-for-uninstall") {
        std::process::exit(arizona_app_lib::release_device_for_uninstall_cli());
    }

    if std::env::args().any(|arg| arg == "--clear-local-auth-for-uninstall") {
        std::process::exit(arizona_app_lib::clear_local_auth_for_uninstall_cli());
    }

    arizona_app_lib::run()
}
