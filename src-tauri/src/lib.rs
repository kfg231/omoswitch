pub mod commands;
pub mod error;
pub mod jsonc_edit;
pub mod models;
pub mod omo_config;
pub mod paths;
pub mod store;
pub mod tray;

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
