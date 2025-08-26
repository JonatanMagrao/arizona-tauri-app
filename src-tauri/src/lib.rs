// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_python::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
