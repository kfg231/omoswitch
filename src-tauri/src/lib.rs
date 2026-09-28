pub mod auth;
pub mod catalog;
pub mod commands;
pub mod error;
pub mod jsonc_edit;
pub mod models;
pub mod net;
pub mod omo_config;
pub mod paths;
pub mod providers;
pub mod store;
pub mod tray;

use tauri::Manager;

pub fn run() {
    let paths = paths::Paths::resolve();
    let store = store::Store::load(&paths.store_home);
    let state = match store {
        Ok(store) => commands::AppState {
            paths: paths.clone(),
            store: std::sync::Mutex::new(store),
        },
        Err(error) => {
            eprintln!(
                "{}",
                serde_json::to_string(&error).unwrap_or_else(|_| error.to_string())
            );
            return;
        }
    };
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::duplicate_profile,
            commands::import_from_config,
            commands::capture_active_from_config,
            commands::preview_switch,
            commands::apply_profile,
            commands::list_models,
            commands::get_native_catalog,
            commands::list_backups,
            commands::restore_backup,
            commands::list_providers,
            commands::save_provider,
            commands::delete_provider,
            commands::set_provider_enabled,
            commands::set_provider_key,
            commands::clear_provider_key,
            commands::test_provider,
            commands::fetch_provider_models,
            commands::import_providers_from_opencode
        ])
        .setup(|app| {
            tray::setup(app)?;
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
