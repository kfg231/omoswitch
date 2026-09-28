use crate::auth::{self, KeySource};
use crate::error::AppError;
use crate::jsonc_edit;
use crate::models::ModelInfo;
use crate::omo_config;
use crate::paths::Paths;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_MODELS_JSON: &str = "{\n  \"providers\": {}\n}\n";
const VALID_APIS: [&str; 3] = [
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api: String,
    pub models: Vec<ProviderModel>,
    pub enabled: bool,
    pub has_key: bool,
    pub key_source: KeySource,
    pub inline_key: bool,
    pub known_to_omo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api: String,
    pub models: Vec<ProviderModel>,
    pub inline_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersResult {
    pub agent_dir: String,
    pub models_json_path: String,
    pub providers: Vec<ProviderInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub changed: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderImportResult {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
    pub keys_found: usize,
}

struct Snapshot {
    bytes: Vec<u8>,
    hash: String,
}

fn io(error: std::io::Error) -> AppError {
    AppError::Io {
        message: error.to_string(),
    }
}

fn provider_not_found(id: &str) -> AppError {
    AppError::ProviderNotFound {
        message: id.to_owned(),
    }
}

fn invalid(field: &str, message: &str) -> AppError {
    AppError::InvalidProvider {
        message: message.to_owned(),
        field: field.to_owned(),
    }
}

fn read_snapshot(path: &Path) -> Result<Option<Snapshot>, AppError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(Snapshot {
            hash: omo_config::hash(&bytes),
            bytes,
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io(error)),
    }
}

fn snapshot_text(snapshot: Option<&Snapshot>) -> Result<String, AppError> {
    match snapshot {
        Some(snapshot) => {
            String::from_utf8(snapshot.bytes.clone()).map_err(|error| AppError::MalformedJsonc {
                message: error.to_string(),
                line: 1,
                col: 1,
            })
        }
        None => Ok(DEFAULT_MODELS_JSON.to_owned()),
    }
}

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars
        .next()
        .is_some_and(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn validate(input: &ProviderInput) -> Result<(), AppError> {
    if !valid_id(&input.id) {
        return Err(invalid("id", "id must match ^[a-z0-9][a-z0-9-]*$"));
    }
    if input.base_url.is_empty()
        || (!input.base_url.starts_with("http://") && !input.base_url.starts_with("https://"))
    {
        return Err(invalid(
            "baseUrl",
            "baseUrl must start with http:// or https://",
        ));
    }
    if !VALID_APIS.contains(&input.api.as_str()) {
        return Err(invalid(
            "api",
            "api must be one of: openai-completions, openai-responses, anthropic-messages",
        ));
    }
    Ok(())
}

fn model_value(model: &ProviderModel) -> Value {
    let mut value = Map::from_iter([(String::from("id"), Value::String(model.id.clone()))]);
    if let Some(name) = &model.name {
        value.insert(String::from("name"), Value::String(name.clone()));
    }
    if let Some(reasoning) = model.reasoning {
        value.insert(String::from("reasoning"), Value::Bool(reasoning));
    }
    if let Some(context_window) = model.context_window {
        value.insert(String::from("contextWindow"), Value::from(context_window));
    }
    if let Some(max_tokens) = model.max_tokens {
        value.insert(String::from("maxTokens"), Value::from(max_tokens));
    }
    Value::Object(value)
}

fn provider_value(input: &ProviderInput, existing: Option<Value>) -> Value {
    let mut value = existing
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    value.insert(String::from("name"), Value::String(input.name.clone()));
    value.insert(
        String::from("baseUrl"),
        Value::String(input.base_url.clone()),
    );
    value.insert(String::from("api"), Value::String(input.api.clone()));
    value.insert(
        String::from("models"),
        Value::Array(input.models.iter().map(model_value).collect()),
    );
    Value::Object(value)
}

fn provider_map(text: &str) -> Result<Map<String, Value>, AppError> {
    match jsonc_edit::get_object_path(text, &["providers"])? {
        None => Ok(Map::new()),
        Some(Value::Object(providers)) => Ok(providers),
        Some(_) => Err(AppError::NotAnObject {
            message: "providers must be an object".to_owned(),
        }),
    }
}

fn string_field(object: &Map<String, Value>, key: &str, default: &str) -> String {
    object
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(default)
        .to_owned()
}

fn models_field(object: &Map<String, Value>) -> Vec<ProviderModel> {
    object
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|value| {
                    let object = value.as_object()?;
                    Some(ProviderModel {
                        id: object.get("id")?.as_str()?.to_owned(),
                        name: object
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        reasoning: object.get("reasoning").and_then(Value::as_bool),
                        context_window: object.get("contextWindow").and_then(Value::as_u64),
                        max_tokens: object.get("maxTokens").and_then(Value::as_u64),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn env_key_name(id: &str) -> String {
    let mut name = id.to_ascii_uppercase();
    name = name.replace('-', "_");
    format!("{name}_API_KEY")
}

fn provider_info(
    id: &str,
    value: &Value,
    disabled: &[String],
    auth_path: &Path,
    omo_models: &[ModelInfo],
) -> Result<ProviderInfo, AppError> {
    let object = value.as_object().ok_or_else(|| AppError::NotAnObject {
        message: format!("providers.{id} must be an object"),
    })?;
    let inline_key = object.contains_key("apiKey");
    let env_present = std::env::var_os(env_key_name(id)).is_some_and(|value| !value.is_empty());
    let key_source = auth::key_source(auth_path, id, inline_key, env_present)?;
    Ok(ProviderInfo {
        id: id.to_owned(),
        name: string_field(object, "name", id),
        base_url: string_field(object, "baseUrl", ""),
        api: string_field(object, "api", "openai-completions"),
        models: models_field(object),
        enabled: !disabled.iter().any(|disabled_id| disabled_id == id),
        has_key: !matches!(key_source, KeySource::None),
        key_source,
        inline_key,
        known_to_omo: omo_models.iter().any(|model| model.provider == id),
    })
}

fn disabled_ids(text: &str) -> Result<Vec<String>, AppError> {
    match jsonc_edit::get_object_path(text, &["disabledProviders"])? {
        None => Ok(Vec::new()),
        Some(Value::Array(values)) => Ok(values
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()),
        Some(_) => Err(AppError::NotAnObject {
            message: "disabledProviders must be an array".to_owned(),
        }),
    }
}

fn list_at(
    agent_dir: &Path,
    auth_path: &Path,
    omo_models: &[ModelInfo],
) -> Result<ProvidersResult, AppError> {
    let models_json_path = agent_dir.join("models.json");
    let Some(snapshot) = read_snapshot(&models_json_path)? else {
        return Ok(ProvidersResult {
            agent_dir: agent_dir.display().to_string(),
            models_json_path: models_json_path.display().to_string(),
            providers: Vec::new(),
        });
    };
    let text = snapshot_text(Some(&snapshot))?;
    let disabled = disabled_ids(&text)?;
    let providers = provider_map(&text)?
        .iter()
        .map(|(id, value)| provider_info(id, value, &disabled, auth_path, omo_models))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ProvidersResult {
        agent_dir: agent_dir.display().to_string(),
        models_json_path: models_json_path.display().to_string(),
        providers,
    })
}

pub fn list(paths: &Paths, omo_models: &[ModelInfo]) -> Result<ProvidersResult, AppError> {
    let agent_dir = paths.agent_dir();
    list_at(&agent_dir, &agent_dir.join("auth.json"), omo_models)
}

fn backup_path(agent_dir: &Path) -> Result<PathBuf, AppError> {
    let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let base = agent_dir.join(format!("models.json.bak.omoswitch-{stamp}"));
    let mut path = base;
    let mut suffix = 2u32;
    while path.exists() {
        path = agent_dir.join(format!("models.json.bak.omoswitch-{stamp}-{suffix}"));
        suffix += 1;
    }
    Ok(path)
}

fn list_backup_paths(agent_dir: &Path) -> Result<Vec<PathBuf>, AppError> {
    let prefix = "models.json.bak.omoswitch-";
    let entries = match fs::read_dir(agent_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io(error)),
    };
    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry.map_err(io)?;
        if entry.file_name().to_string_lossy().starts_with(prefix)
            && entry.metadata().map_err(io)?.is_file()
        {
            paths.push(entry.path());
        }
    }
    paths.sort_by(|left, right| right.cmp(left));
    Ok(paths)
}

fn prune_backups(agent_dir: &Path) -> Result<(), AppError> {
    for path in list_backup_paths(agent_dir)?.into_iter().skip(20) {
        fs::remove_file(path).map_err(io)?;
    }
    Ok(())
}

fn write_models(
    agent_dir: &Path,
    original: Option<&Snapshot>,
    new_text: &str,
) -> Result<SaveResult, AppError> {
    if original.is_some_and(|snapshot| snapshot.bytes == new_text.as_bytes()) {
        return Ok(SaveResult {
            changed: false,
            backup_path: None,
        });
    }
    let models_json_path = agent_dir.join("models.json");
    let current = read_snapshot(&models_json_path)?;
    let original_hash = original.map(|snapshot| snapshot.hash.as_str());
    let current_hash = current.as_ref().map(|snapshot| snapshot.hash.as_str());
    if original_hash != current_hash || original.is_none() != current.is_none() {
        return Err(AppError::ChangedOnDisk {
            message: models_json_path.display().to_string(),
        });
    }
    fs::create_dir_all(agent_dir).map_err(io)?;
    let current = read_snapshot(&models_json_path)?;
    let current_hash = current.as_ref().map(|snapshot| snapshot.hash.as_str());
    if original_hash != current_hash || original.is_none() != current.is_none() {
        return Err(AppError::ChangedOnDisk {
            message: models_json_path.display().to_string(),
        });
    }
    let backup = if let Some(snapshot) = original {
        let path = backup_path(agent_dir)?;
        fs::write(&path, &snapshot.bytes).map_err(io)?;
        Some(path)
    } else {
        None
    };
    prune_backups(agent_dir)?;
    let current = read_snapshot(&models_json_path)?;
    let current_hash = current.as_ref().map(|snapshot| snapshot.hash.as_str());
    if original_hash != current_hash || original.is_none() != current.is_none() {
        if let Some(path) = &backup {
            fs::remove_file(path).map_err(io)?;
        }
        return Err(AppError::ChangedOnDisk {
            message: models_json_path.display().to_string(),
        });
    }
    omo_config::atomic_write(&models_json_path, new_text.as_bytes())?;
    Ok(SaveResult {
        changed: true,
        backup_path: backup.map(|path| path.display().to_string()),
    })
}

fn load_models(agent_dir: &Path) -> Result<(Option<Snapshot>, String), AppError> {
    let snapshot = read_snapshot(&agent_dir.join("models.json"))?;
    let text = snapshot_text(snapshot.as_ref())?;
    if snapshot.is_some() {
        jsonc_edit::parse_value(&text)?;
    }
    Ok((snapshot, text))
}

fn save_at(agent_dir: &Path, input: ProviderInput) -> Result<SaveResult, AppError> {
    validate(&input)?;
    let (original, text) = load_models(agent_dir)?;
    let existing = jsonc_edit::get_object_path(&text, &["providers", &input.id])?;
    let value = provider_value(&input, existing);
    let new_text = jsonc_edit::set_object_path(&text, &["providers", &input.id], &value)?;
    write_models(agent_dir, original.as_ref(), &new_text)
}

pub fn save(paths: &Paths, input: ProviderInput) -> Result<SaveResult, AppError> {
    save_at(&paths.agent_dir(), input)
}

fn provider_exists(text: &str, id: &str) -> Result<bool, AppError> {
    Ok(provider_map(text)?.contains_key(id))
}

fn delete_at(agent_dir: &Path, id: &str) -> Result<SaveResult, AppError> {
    let (original, text) = load_models(agent_dir)?;
    if !provider_exists(&text, id)? {
        return Err(provider_not_found(id));
    }
    let without_provider = jsonc_edit::remove_object_path(&text, &["providers", id])?;
    let disabled = match jsonc_edit::get_object_path(&without_provider, &["disabledProviders"])? {
        Some(Value::Array(values)) if values.iter().any(|value| value.as_str() == Some(id)) => {
            Some(Value::Array(
                values
                    .into_iter()
                    .filter(|value| value.as_str() != Some(id))
                    .collect(),
            ))
        }
        Some(Value::Array(_)) => None,
        None => None,
        Some(_) => {
            return Err(AppError::NotAnObject {
                message: "disabledProviders must be an array".to_owned(),
            })
        }
    };
    let without_disabled = match disabled {
        Some(value) => {
            jsonc_edit::set_object_path(&without_provider, &["disabledProviders"], &value)?
        }
        None => without_provider,
    };
    write_models(agent_dir, original.as_ref(), &without_disabled)
}

pub fn delete(paths: &Paths, id: &str) -> Result<(), AppError> {
    delete_at(&paths.agent_dir(), id).map(|_| ())
}

fn set_enabled_at(agent_dir: &Path, id: &str, enabled: bool) -> Result<SaveResult, AppError> {
    let (original, text) = load_models(agent_dir)?;
    if !provider_exists(&text, id)? {
        return Err(provider_not_found(id));
    }
    let values = match jsonc_edit::get_object_path(&text, &["disabledProviders"])? {
        Some(Value::Array(values)) => values,
        None if enabled => return write_models(agent_dir, original.as_ref(), &text),
        None => Vec::new(),
        Some(_) => {
            return Err(AppError::NotAnObject {
                message: "disabledProviders must be an array".to_owned(),
            })
        }
    };
    let already_enabled = !values.iter().any(|value| value.as_str() == Some(id));
    if enabled && already_enabled {
        return write_models(agent_dir, original.as_ref(), &text);
    }
    if !enabled && !already_enabled {
        return write_models(agent_dir, original.as_ref(), &text);
    }
    let values = if enabled {
        values
            .into_iter()
            .filter(|value| value.as_str() != Some(id))
            .collect()
    } else if values.iter().any(|value| value.as_str() == Some(id)) {
        values
    } else {
        values
            .into_iter()
            .chain(Some(Value::String(id.to_owned())))
            .collect()
    };
    let new_text =
        jsonc_edit::set_object_path(&text, &["disabledProviders"], &Value::Array(values))?;
    write_models(agent_dir, original.as_ref(), &new_text)
}

pub fn set_enabled(paths: &Paths, id: &str, enabled: bool) -> Result<(), AppError> {
    set_enabled_at(&paths.agent_dir(), id, enabled).map(|_| ())
}

fn import_model(value: &Value, id: &str) -> ProviderModel {
    ProviderModel {
        id: id.to_owned(),
        name: value
            .as_object()
            .and_then(|object| object.get("name"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        reasoning: None,
        context_window: None,
        max_tokens: None,
    }
}

fn imported_input(id: &str, value: &Value) -> Result<(ProviderInput, Option<String>), AppError> {
    let object = value.as_object().ok_or_else(|| AppError::NotAnObject {
        message: format!("provider.{id} must be an object"),
    })?;
    let options = object
        .get("options")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::NotAnObject {
            message: format!("provider.{id}.options must be an object"),
        })?;
    let base_url = options
        .get("baseURL")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let models = object
        .get("models")
        .and_then(Value::as_object)
        .map(|models| {
            models
                .iter()
                .map(|(model_id, value)| import_model(value, model_id))
                .collect()
        })
        .unwrap_or_default();
    let api = (object.get("npm").and_then(Value::as_str) == Some("@ai-sdk/anthropic"))
        .then_some("anthropic-messages")
        .unwrap_or("openai-completions");
    let key = options
        .get("apiKey")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
        .map(str::to_owned);
    Ok((
        ProviderInput {
            id: id.to_owned(),
            name: object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_owned(),
            base_url,
            api: api.to_owned(),
            models,
            inline_key: false,
        },
        key,
    ))
}

fn import_at(
    agent_dir: &Path,
    auth_path: &Path,
    opencode_path: &Path,
) -> Result<ProviderImportResult, AppError> {
    let opencode = match fs::read_to_string(opencode_path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ProviderImportResult {
                imported: Vec::new(),
                skipped: Vec::new(),
                keys_found: 0,
            })
        }
        Err(error) => return Err(io(error)),
    };
    let value = jsonc_edit::parse_value(&opencode)?;
    let providers = match value.get("provider") {
        None => Map::new(),
        Some(Value::Object(providers)) => providers.clone(),
        Some(_) => {
            return Err(AppError::NotAnObject {
                message: "provider must be an object".to_owned(),
            })
        }
    };
    let models_path = agent_dir.join("models.json");
    let existing = read_snapshot(&models_path)?;
    let existing_text = snapshot_text(existing.as_ref())?;
    let existing_providers = provider_map(&existing_text)?;
    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    let mut keys_found = 0;
    for (id, value) in providers {
        if existing_providers.contains_key(&id) {
            skipped.push(id);
            continue;
        }
        let (input, key) = imported_input(&id, &value)?;
        save_at(agent_dir, input)?;
        if let Some(key) = key {
            auth::set_key(auth_path, &id, &key)?;
            keys_found += 1;
        }
        imported.push(id);
    }
    Ok(ProviderImportResult {
        imported,
        skipped,
        keys_found,
    })
}

pub fn import_from_opencode(
    paths: &Paths,
    opencode_path: &Path,
) -> Result<ProviderImportResult, AppError> {
    let agent_dir = paths.agent_dir();
    let auth_path = agent_dir.join("auth.json");
    import_at(&agent_dir, &auth_path, opencode_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const TEST_KEY: &str = "TEST-NOT-A-REAL-KEY";

    fn paths(root: &Path) -> Paths {
        let values = HashMap::from([(
            String::from("OMOSWITCH_OMO_HOME"),
            root.join("omo").into_os_string(),
        )]);
        Paths::resolve_with(|key| values.get(key).cloned())
    }

    fn agent(root: &Path) -> PathBuf {
        paths(root).omo_home.join("agent")
    }

    fn input(id: &str) -> ProviderInput {
        ProviderInput {
            id: id.to_owned(),
            name: format!("{id} provider"),
            base_url: format!("https://{id}.example.test/v1"),
            api: "openai-completions".to_owned(),
            models: vec![
                ProviderModel {
                    id: "model-a".to_owned(),
                    name: Some("Model A".to_owned()),
                    reasoning: Some(false),
                    context_window: Some(4096),
                    max_tokens: Some(1024),
                },
                ProviderModel {
                    id: "model-b".to_owned(),
                    name: None,
                    reasoning: None,
                    context_window: None,
                    max_tokens: None,
                },
            ],
            inline_key: false,
        }
    }

    fn write_models(agent_dir: &Path, text: &str) {
        fs::create_dir_all(agent_dir).expect("agent directory exists");
        fs::write(agent_dir.join("models.json"), text).expect("models fixture is written");
    }

    #[test]
    fn list_missing_file_returns_empty_without_creating_file() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        let result = list_at(&agent_dir, &agent_dir.join("auth.json"), &[]).expect("list succeeds");
        assert!(result.providers.is_empty());
        assert!(!agent_dir.join("models.json").exists());
    }

    #[test]
    fn save_creates_parseable_file_with_both_models() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        let text = fs::read_to_string(agent_dir.join("models.json")).expect("models exists");
        let value = jsonc_edit::parse_value(&text).expect("models are parseable");
        assert_eq!(
            value["providers"]["alpha"]["models"]
                .as_array()
                .map(Vec::len),
            Some(2)
        );
    }

    #[test]
    fn save_preserves_line_and_block_comments() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(
            &agent_dir,
            "// before\n{\n  /* inside */\n  \"providers\": {\n    \"alpha\": {\n      \"name\": \"old\"\n    }\n  } // after\n}\n",
        );
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        let text = fs::read_to_string(agent_dir.join("models.json")).expect("models exists");
        assert!(
            text.contains("// before")
                && text.contains("/* inside */")
                && text.contains("// after")
        );
    }

    #[test]
    fn save_preserves_sibling_provider_bytes() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        let fixture = "{\n  \"providers\": {\n    \"sibling\": {\n      \"name\": \"keep\",\n      \"custom\": [1, 2, 3]\n    },\n    \"alpha\": {\n      \"name\": \"old\"\n    }\n  }\n}\n";
        write_models(&agent_dir, fixture);
        let sibling = fixture.split_once("    \"alpha\"").expect("alpha exists").0;
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        let after = fs::read_to_string(agent_dir.join("models.json")).expect("models exists");
        assert!(after.starts_with(sibling));
    }

    #[test]
    fn save_merges_existing_unknown_provider_fields() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(
            &agent_dir,
            "{\n  \"providers\": {\n    \"alpha\": {\n      \"name\": \"old\",\n      \"headers\": {\"X-Test\": \"keep\"},\n      \"compat\": {\"supports\": [\"a\"]}\n    }\n  }\n}\n",
        );
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        let text = fs::read_to_string(agent_dir.join("models.json")).expect("models exists");
        let value = jsonc_edit::parse_value(&text).expect("models parse");
        assert_eq!(value["providers"]["alpha"]["headers"]["X-Test"], "keep");
        assert_eq!(value["providers"]["alpha"]["compat"]["supports"][0], "a");
    }

    #[test]
    fn set_enabled_false_keeps_definition_and_models() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        set_enabled_at(&agent_dir, "alpha", false).expect("disable succeeds");
        let result = list_at(&agent_dir, &agent_dir.join("auth.json"), &[]).expect("list succeeds");
        assert!(!result.providers[0].enabled);
        assert_eq!(result.providers[0].models.len(), 2);
    }

    #[test]
    fn set_enabled_true_removes_disabled_provider() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        set_enabled_at(&agent_dir, "alpha", false).expect("disable succeeds");
        set_enabled_at(&agent_dir, "alpha", true).expect("enable succeeds");
        let text = fs::read_to_string(agent_dir.join("models.json")).expect("models exists");
        assert_eq!(
            jsonc_edit::get_object_path(&text, &["disabledProviders"]).expect("path parses"),
            Some(Value::Array(Vec::new()))
        );
    }

    #[test]
    fn idempotent_save_does_not_create_backup() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        save_at(&agent_dir, input("alpha")).expect("first save succeeds");
        let backups_before = list_backup_paths(&agent_dir).expect("backups list").len();
        let result = save_at(&agent_dir, input("alpha")).expect("second save succeeds");
        assert!(!result.changed);
        assert_eq!(
            list_backup_paths(&agent_dir).expect("backups list").len(),
            backups_before
        );
    }

    #[test]
    fn prune_keeps_newest_twenty_backups() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        fs::create_dir_all(&agent_dir).expect("agent exists");
        for index in 0..22 {
            fs::write(
                agent_dir.join(format!(
                    "models.json.bak.omoswitch-2026-01-01T00-00-{index:02}Z"
                )),
                index.to_string(),
            )
            .expect("backup exists");
        }
        write_models(&agent_dir, "{\"providers\":{}}\n");
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        assert_eq!(
            list_backup_paths(&agent_dir).expect("backups list").len(),
            20
        );
    }

    #[test]
    fn inline_false_never_writes_key_material_to_models() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        let text = fs::read_to_string(agent_dir.join("models.json")).expect("models exists");
        assert!(!text.contains(TEST_KEY));
    }

    #[test]
    fn import_routes_key_to_auth_only() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        let opencode = root.path().join("opencode.jsonc");
        fs::write(
            &opencode,
            format!(
                "{{\n  \"provider\": {{\n    \"alpha\": {{\n      \"name\": \"Alpha\",\n      \"npm\": \"@ai-sdk/openai-compatible\",\n      \"options\": {{\"baseURL\": \"https://alpha.test\", \"apiKey\": \"{TEST_KEY}\"}},\n      \"models\": {{\"a\": {{\"name\": \"A\"}}, \"b\": {{}}}}\n    }}\n  }}\n}}"
            ),
        )
        .expect("opencode fixture is written");
        let result = import_at(&agent_dir, &agent_dir.join("auth.json"), &opencode)
            .expect("import succeeds");
        assert_eq!(result.imported, vec!["alpha"]);
        assert_eq!(result.keys_found, 1);
        let models = fs::read_to_string(agent_dir.join("models.json")).expect("models exists");
        let auth = fs::read_to_string(agent_dir.join("auth.json")).expect("auth exists");
        assert!(!models.contains(TEST_KEY));
        assert!(auth.contains(TEST_KEY));
    }

    #[test]
    fn validation_reports_id_base_url_and_api_fields() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        for (field, modified) in [
            (
                "id",
                ProviderInput {
                    id: "Bad_id".to_owned(),
                    ..input("alpha")
                },
            ),
            (
                "baseUrl",
                ProviderInput {
                    base_url: "ftp://alpha".to_owned(),
                    ..input("alpha")
                },
            ),
            (
                "api",
                ProviderInput {
                    api: "unknown".to_owned(),
                    ..input("alpha")
                },
            ),
        ] {
            assert!(
                matches!(save_at(&agent_dir, modified), Err(AppError::InvalidProvider { field: actual, .. }) if actual == field)
            );
        }
    }

    #[test]
    fn delete_unknown_returns_provider_not_found() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        assert!(matches!(
            delete_at(&agent_dir, "missing"),
            Err(AppError::ProviderNotFound { .. })
        ));
    }

    #[test]
    fn changed_on_disk_guard_rejects_replacement() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(&agent_dir, "{\"providers\":{}}\n");
        let (original, text) = load_models(&agent_dir).expect("models load");
        let new_text = jsonc_edit::set_object_path(
            &text,
            &["providers", "alpha"],
            &provider_value(&input("alpha"), None),
        )
        .expect("edit succeeds");
        fs::write(
            agent_dir.join("models.json"),
            "{\"providers\":{\"other\":{}}}\n",
        )
        .expect("changed fixture written");
        assert!(matches!(
            super::write_models(&agent_dir, original.as_ref(), &new_text),
            Err(AppError::ChangedOnDisk { .. })
        ));
    }

    #[test]
    fn import_skips_existing_and_missing_source_is_empty() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        save_at(&agent_dir, input("alpha")).expect("provider exists");
        let opencode = root.path().join("missing.json");
        let missing = import_at(&agent_dir, &agent_dir.join("auth.json"), &opencode)
            .expect("missing source succeeds");
        assert!(missing.imported.is_empty() && missing.skipped.is_empty());
        let source = root.path().join("opencode.json");
        fs::write(
            &source,
            "{\"provider\":{\"alpha\":{\"options\":{\"baseURL\":\"https://a.test\"}}}}\n",
        )
        .expect("source exists");
        let skipped =
            import_at(&agent_dir, &agent_dir.join("auth.json"), &source).expect("import succeeds");
        assert_eq!(skipped.skipped, vec!["alpha"]);
    }

    #[test]
    fn list_reports_known_models_and_disabled_state() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        save_at(&agent_dir, input("alpha")).expect("save succeeds");
        set_enabled_at(&agent_dir, "alpha", false).expect("disable succeeds");
        let model = ModelInfo {
            id: "alpha/model-a".to_owned(),
            provider: "alpha".to_owned(),
            model: "model-a".to_owned(),
            context: None,
            max_out: None,
            thinking: false,
            images: false,
        };
        let result =
            list_at(&agent_dir, &agent_dir.join("auth.json"), &[model]).expect("list succeeds");
        assert!(!result.providers[0].enabled && result.providers[0].known_to_omo);
    }
}
