use crate::commands::AppState;
use crate::error::AppError;
use crate::omo_config;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager};

fn labels() -> (&'static str, &'static str, &'static str) {
    let japanese = std::env::var("LANG")
        .map(|value| value.starts_with("ja"))
        .unwrap_or(false);
    if japanese {
        ("開く", "終了", "プロファイル")
    } else {
        ("Open", "Quit", "Profiles")
    }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let (open_label, quit_label, _) = labels();
    let open = MenuItem::with_id(app, "open", open_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "quit" {
                app.exit(0);
            } else if id == "open" {
                show_window(app);
            } else if let Some(profile_id) = id.strip_prefix("profile:") {
                apply_from_tray(app, profile_id);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(&tray.app_handle());
            }
        })
        .tooltip("OmOswitch")
        .build(app)?;
    rebuild(app.handle())
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn rebuild(app: &AppHandle) -> tauri::Result<()> {
    let tray = app.tray_by_id("main-tray").ok_or_else(|| {
        tauri::Error::Setup(
            (Box::new(std::io::Error::other("main tray missing")) as Box<dyn std::error::Error>)
                .into(),
        )
    })?;
    let state = app.state::<AppState>();
    let store = state.store.lock().map_err(|_| {
        tauri::Error::Setup(
            (Box::new(std::io::Error::other("store lock poisoned")) as Box<dyn std::error::Error>)
                .into(),
        )
    })?;
    let active = store.active_profile_id();
    let drift = omo_config::status(&state.paths, &store).drift;
    let (open_label, quit_label, profile_label) = labels();
    let open = MenuItem::with_id(app, "open", open_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> =
        vec![Box::new(open), Box::new(quit)];
    let _ = profile_label;
    for profile in store.list() {
        items.push(Box::new(CheckMenuItem::with_id(
            app,
            format!("profile:{}", profile.id),
            &profile.name,
            true,
            active == Some(profile.id.as_str()),
            None::<&str>,
        )?));
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|item| item.as_ref()).collect();
    tray.set_menu(Some(Menu::with_items(app, &refs)?))?;
    tray.set_tooltip(Some(format!(
        "OmOswitch — {} [{}]",
        active.unwrap_or("none"),
        format_drift(drift)
    )))?;
    Ok(())
}

fn format_drift(drift: omo_config::Drift) -> &'static str {
    match drift {
        omo_config::Drift::InSync => "inSync",
        omo_config::Drift::Drifted => "drifted",
        omo_config::Drift::NoActive => "noActive",
        omo_config::Drift::ConfigMissing => "configMissing",
        omo_config::Drift::ConfigInvalid => "configInvalid",
    }
}

fn apply_from_tray(app: &AppHandle, id: &str) {
    let result = (|| -> Result<_, AppError> {
        let state = app.state::<AppState>();
        let mut profile_store = state.store.lock().map_err(|_| AppError::Io {
            message: "store lock poisoned".to_owned(),
        })?;
        let result = omo_config::apply(&state.paths, &mut profile_store, id, None)?;
        app.emit("omoswitch://applied", &result)
            .map_err(|error| AppError::Io {
                message: error.to_string(),
            })?;
        Ok(result)
    })();
    match result {
        Ok(_) => {
            let _ = rebuild(app);
        }
        Err(error) => {
            if let Ok(payload) = serde_json::to_value(&error) {
                let _ = app.emit("omoswitch://error", payload);
            }
            show_window(app);
        }
    }
}
