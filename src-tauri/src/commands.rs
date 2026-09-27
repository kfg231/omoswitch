use crate::error::AppError;
use crate::models::ModelInfo;
use crate::omo_config::{self, ApplyResult, BackupInfo, Status, SwitchPreview};
use crate::paths::Paths;
use crate::store::{ImportResult, ImportSource, Profile, ProfileInput, Store};
use serde_json::Value;
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub paths: Paths,
    pub store: Mutex<Store>,
}

fn store<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, Store>, AppError> {
    state.store.lock().map_err(|_| AppError::Io {
        message: "profile store lock is poisoned".to_owned(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_status(state: State<'_, AppState>) -> Result<Status, AppError> {
    let store = store(&state)?;
    Ok(omo_config::status(&state.paths, &store))
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_profiles(state: State<'_, AppState>) -> Result<Vec<Profile>, AppError> {
    Ok(store(&state)?.list().to_vec())
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_profile(state: State<'_, AppState>, input: ProfileInput) -> Result<Profile, AppError> {
    store(&state)?.save(input)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_profile(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    store(&state)?.delete(&id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn duplicate_profile(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Profile, AppError> {
    store(&state)?.duplicate(&id, name)
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_from_config(
    state: State<'_, AppState>,
    source: String,
    name: String,
) -> Result<ImportResult, AppError> {
    let source = match source.as_str() {
        "opencode" => ImportSource::Opencode,
        "native" => ImportSource::Native,
        _ => {
            return Err(AppError::InvalidProfile {
                message: "unknown import source".to_owned(),
                field: "source".to_owned(),
            })
        }
    };
    let loaded = omo_config::load(&state.paths)?;
    let mut store = store(&state)?;
    let result = Store::import_profile(&loaded.value, source, name)?;
    let profile = store.save(ProfileInput {
        id: Some(result.profile.id.clone()),
        name: result.profile.name.clone(),
        note: result.profile.note.clone(),
        agents: result.profile.agents.clone(),
        categories: result.profile.categories.clone(),
    })?;
    Ok(ImportResult { profile, ..result })
}

#[tauri::command(rename_all = "camelCase")]
pub fn capture_active_from_config(state: State<'_, AppState>) -> Result<Profile, AppError> {
    let mut profile_store = store(&state)?;
    omo_config::capture_active(&state.paths, &mut profile_store)
}

#[tauri::command(rename_all = "camelCase")]
pub fn preview_switch(state: State<'_, AppState>, id: String) -> Result<SwitchPreview, AppError> {
    let profile_store = store(&state)?;
    omo_config::preview(&state.paths, &profile_store, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn apply_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    expected_hash: Option<String>,
) -> Result<ApplyResult, AppError> {
    let mut profile_store = store(&state)?;
    let result = omo_config::apply(
        &state.paths,
        &mut profile_store,
        &id,
        expected_hash.as_deref(),
    )?;
    app.emit("omoswitch://applied", &result)
        .map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_models(state: State<'_, AppState>, refresh: bool) -> Result<Vec<ModelInfo>, AppError> {
    crate::models::list_models(&state.paths, refresh)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupInfo>, AppError> {
    omo_config::list_backups(&state.paths)
}

#[tauri::command(rename_all = "camelCase")]
pub fn restore_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<ApplyResult, AppError> {
    let mut profile_store = store(&state)?;
    let result = omo_config::restore_backup(&state.paths, &mut profile_store, &path)?;
    app.emit("omoswitch://applied", &result)
        .map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
    Ok(result)
}

pub fn import_value(
    paths: &Paths,
    source: ImportSource,
    name: String,
) -> Result<ImportResult, AppError> {
    let loaded = omo_config::load(paths)?;
    Store::import_profile(&loaded.value, source, name)
}

pub fn profile_by_name_or_id<'a>(store: &'a Store, value: &str) -> Result<&'a Profile, AppError> {
    if let Ok(profile) = store.get(value) {
        return Ok(profile);
    }
    store
        .list()
        .iter()
        .find(|profile| profile.name.eq_ignore_ascii_case(value))
        .ok_or_else(|| AppError::ProfileNotFound {
            message: value.to_owned(),
        })
}

pub fn json_value<T: serde::Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_string_pretty(value).map_err(|error| AppError::Io {
        message: error.to_string(),
    })
}

pub fn error_value(error: &AppError) -> Result<String, AppError> {
    json_value(error)
}

pub fn loaded_config_value(paths: &Paths) -> Result<Value, AppError> {
    Ok(omo_config::load(paths)?.value)
}
