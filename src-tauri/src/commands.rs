use crate::catalog::NativeCatalog;
use crate::error::AppError;
use crate::models::ModelInfo;
use crate::omo_config::{self, ApplyResult, BackupInfo, Status, SwitchPreview};
use crate::paths::Paths;
use crate::providers::{self, ProviderImportResult, ProviderInfo, ProviderInput, ProvidersResult};
use crate::store::{ImportResult, ImportSource, Profile, ProfileInput, Store};
use serde_json::Value;
use std::path::PathBuf;
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
pub async fn list_models(
    state: State<'_, AppState>,
    refresh: bool,
) -> Result<Vec<ModelInfo>, AppError> {
    crate::models::list_models(&state.paths, refresh)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_native_catalog(
    state: State<'_, AppState>,
    refresh: bool,
) -> Result<NativeCatalog, AppError> {
    crate::catalog::get_catalog(&state.paths, refresh)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn latest_omo_version() -> Option<String> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(5)))
        .build()
        .new_agent();
    let mut response = agent
        .get("https://registry.npmjs.org/omo-ai/latest")
        .call()
        .ok()?;
    let body: Value = serde_json::from_str(&response.body_mut().read_to_string().ok()?).ok()?;
    body.get("version")?.as_str().map(str::to_owned)
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

fn provider_models(paths: &Paths) -> Vec<ModelInfo> {
    crate::models::list_models(paths, false).unwrap_or_default()
}

fn provider_list(paths: &Paths) -> Result<ProvidersResult, AppError> {
    providers::list(paths, &provider_models(paths))
}

fn provider_by_id(paths: &Paths, id: &str) -> Result<ProviderInfo, AppError> {
    provider_list(paths)?
        .providers
        .into_iter()
        .find(|provider| provider.id == id)
        .ok_or_else(|| AppError::ProviderNotFound {
            message: id.to_owned(),
        })
}

pub fn provider_key_for_request(paths: &Paths, id: &str) -> Result<Option<String>, AppError> {
    crate::auth::read_key_for_request(&paths.auth_json_path(), id)
}

fn opencode_config_path() -> PathBuf {
    let user_profile = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let directory = user_profile.join(".config").join("opencode");
    let json = directory.join("opencode.json");
    if json.exists() {
        json
    } else {
        directory.join("opencode.jsonc")
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_providers(state: State<'_, AppState>) -> Result<ProvidersResult, AppError> {
    provider_list(&state.paths)
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_provider(
    state: State<'_, AppState>,
    input: ProviderInput,
) -> Result<ProviderInfo, AppError> {
    let id = input.id.clone();
    providers::save(&state.paths, input)?;
    provider_by_id(&state.paths, &id)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderJson {
    pub json: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_provider_json(state: State<'_, AppState>, id: String) -> Result<ProviderJson, AppError> {
    Ok(ProviderJson {
        json: providers::provider_json(&state.paths, &id)?,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_provider_json(
    state: State<'_, AppState>,
    id: String,
    json: String,
) -> Result<ProviderInfo, AppError> {
    providers::save_provider_json(&state.paths, &id, &json)?;
    provider_by_id(&state.paths, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_provider(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    providers::delete(&state.paths, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_provider_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<ProviderInfo, AppError> {
    providers::set_enabled(&state.paths, &id, enabled)?;
    provider_by_id(&state.paths, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_provider_key(
    state: State<'_, AppState>,
    id: String,
    key: String,
) -> Result<ProviderInfo, AppError> {
    provider_by_id(&state.paths, &id)?;
    if key.trim().is_empty() {
        return Err(AppError::InvalidProvider {
            message: "key must not be empty".to_owned(),
            field: "key".to_owned(),
        });
    }
    crate::auth::set_key(&state.paths.auth_json_path(), &id, &key)?;
    provider_by_id(&state.paths, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn clear_provider_key(
    state: State<'_, AppState>,
    id: String,
) -> Result<ProviderInfo, AppError> {
    provider_by_id(&state.paths, &id)?;
    crate::auth::clear_key(&state.paths.auth_json_path(), &id)?;
    provider_by_id(&state.paths, &id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn test_provider(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::net::ProbeResult, AppError> {
    let provider = provider_by_id(&state.paths, &id)?;
    let key = crate::auth::read_key_for_request(&state.paths.auth_json_path(), &id)?;
    Ok(crate::net::probe(&provider.base_url, key.as_deref()))
}

#[tauri::command(rename_all = "camelCase")]
pub fn fetch_provider_models(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::net::FetchedModels, AppError> {
    let provider = provider_by_id(&state.paths, &id)?;
    let key = crate::auth::read_key_for_request(&state.paths.auth_json_path(), &id)?;
    crate::net::fetch_models(&provider.base_url, key.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_providers_from_opencode(
    state: State<'_, AppState>,
) -> Result<ProviderImportResult, AppError> {
    providers::import_from_opencode(&state.paths, &opencode_config_path())
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
