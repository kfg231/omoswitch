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
    pub input: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
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
    pub updated: Vec<String>,
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

const REDACTED: &str = "<redacted>";
const EFFORTS: [&str; 6] = ["minimal", "low", "medium", "high", "xhigh", "max"];

fn sensitive_header_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "authorization",
        "api-key",
        "apikey",
        "token",
        "secret",
        "key",
    ]
    .iter()
    .any(|needle| name.contains(needle))
}

fn api_key_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("apiKey")
}

fn redact_headers(value: &mut Value) {
    match value {
        Value::Object(object) => {
            if let Some(Value::Object(headers)) = object.get_mut("headers") {
                for (name, value) in headers {
                    if sensitive_header_name(name) {
                        *value = Value::String(REDACTED.to_owned());
                    }
                }
            }
            for value in object.values_mut() {
                redact_headers(value);
            }
        }
        Value::Array(values) => {
            for value in values {
                redact_headers(value);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

fn redact_api_keys(value: &mut Value) {
    match value {
        Value::Object(object) => {
            let keys = object.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                if key.eq_ignore_ascii_case("apiKey") {
                    if let Some(value) = object.get_mut(&key) {
                        *value = Value::String(REDACTED.to_owned());
                    }
                } else if let Some(value) = object.get_mut(&key) {
                    redact_api_keys(value);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                redact_api_keys(value);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

fn redacted_model_value(value: &Value) -> Value {
    let mut value = value.clone();
    redact_headers(&mut value);
    redact_api_keys(&mut value);
    value
}

fn restore_header_values(candidate: &mut Value, existing: Option<&Value>) -> Result<(), AppError> {
    let Some(headers) = candidate.as_object_mut() else {
        return Ok(());
    };
    let existing_headers = existing.and_then(Value::as_object);
    for (name, value) in headers {
        if value.as_str() == Some(REDACTED) {
            let Some(existing_value) = existing_headers.and_then(|headers| {
                headers.get(name).or_else(|| {
                    headers
                        .iter()
                        .find(|(existing_name, _)| existing_name.eq_ignore_ascii_case(name))
                        .map(|(_, value)| value)
                })
            }) else {
                return Err(invalid("headers", "redacted header has no existing value"));
            };
            *value = existing_value.clone();
        }
    }
    Ok(())
}

fn restore_api_key_value(candidate: &mut Value, existing: Option<&Value>) -> Result<(), AppError> {
    if candidate.as_str() != Some(REDACTED) {
        return Ok(());
    }
    let Some(existing) = existing else {
        return Err(invalid("apiKey", "redacted value has no existing value"));
    };
    *candidate = existing.clone();
    Ok(())
}

fn restore_redacted_headers(candidate: &mut Value, existing: &Value) -> Result<(), AppError> {
    let (Value::Object(candidate_object), Value::Object(existing_object)) = (candidate, existing)
    else {
        return Ok(());
    };
    let candidate_keys = candidate_object.keys().cloned().collect::<Vec<_>>();
    for key in candidate_keys {
        if key.eq_ignore_ascii_case("apiKey") {
            let existing_value = existing_object.get(&key).or_else(|| {
                existing_object
                    .iter()
                    .find(|(existing_name, _)| existing_name.eq_ignore_ascii_case(&key))
                    .map(|(_, value)| value)
            });
            if let Some(value) = candidate_object.get_mut(&key) {
                restore_api_key_value(value, existing_value)?;
            }
            continue;
        }
        if key == "headers" {
            if let Some(headers) = candidate_object.get_mut(&key) {
                if headers.is_object() {
                    restore_header_values(headers, existing_object.get("headers"))?;
                }
            }
            continue;
        }
        if key == "models" {
            let Some(Value::Array(candidate_models)) = candidate_object.get_mut(&key) else {
                continue;
            };
            let existing_models = existing_object
                .get("models")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for candidate_model in candidate_models {
                let existing_model = candidate_model
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|id| {
                        existing_models
                            .iter()
                            .find(|model| model.get("id").and_then(Value::as_str) == Some(id))
                    })
                    .unwrap_or(&Value::Null);
                restore_redacted_headers(candidate_model, existing_model)?;
            }
            continue;
        }
        if let Some(candidate_child) = candidate_object.get_mut(&key) {
            if let Some(existing_child) = existing_object.get(&key) {
                restore_redacted_headers(candidate_child, existing_child)?;
            }
        }
    }
    Ok(())
}

fn parse_provider_json(text: &str) -> Result<Value, AppError> {
    jsonc_edit::parse_value(text).map_err(|error| match error {
        AppError::MalformedJsonc { line, col, .. } => AppError::MalformedJsonc {
            message: "provider JSON could not be parsed".to_owned(),
            line,
            col,
        },
        error => error,
    })
}

fn replace_provider_value(text: &str, id: &str, value: &Value) -> Result<String, AppError> {
    jsonc_edit::set_object_path(text, &["providers", id], value).map_err(|error| match error {
        AppError::VerifyFailed { .. } => AppError::VerifyFailed {
            message: "provider JSON replacement could not be verified".to_owned(),
        },
        error => error,
    })
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
    if let Some(input) = &model.input {
        value.insert(
            String::from("input"),
            Value::Array(input.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(thinking) = &model.thinking {
        value.insert(String::from("thinking"), thinking.clone());
    }
    if let Some(context_window) = model.context_window {
        value.insert(String::from("contextWindow"), Value::from(context_window));
    }
    if let Some(max_tokens) = model.max_tokens {
        value.insert(String::from("maxTokens"), Value::from(max_tokens));
    }
    for (key, extra) in &model.extra {
        value.entry(key.clone()).or_insert_with(|| extra.clone());
    }
    Value::Object(value)
}

fn provider_value(input: &ProviderInput, existing: Option<Value>) -> Result<Value, AppError> {
    let existing_value = existing.clone();
    let mut value = existing
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    value.insert(String::from("name"), Value::String(input.name.clone()));
    value.insert(
        String::from("baseUrl"),
        Value::String(input.base_url.clone()),
    );
    value.insert(String::from("api"), Value::String(input.api.clone()));
    let existing_models = value.get("models").cloned().unwrap_or(Value::Null);
    let mut models = input.models.iter().map(model_value).collect::<Vec<_>>();
    for model in &mut models {
        let existing_model = model.get("id").and_then(Value::as_str).and_then(|id| {
            existing_models.as_array().and_then(|models| {
                models
                    .iter()
                    .find(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id))
            })
        });
        restore_redacted_headers(model, existing_model.unwrap_or(&Value::Null))?;
    }
    value.insert(String::from("models"), Value::Array(models));
    let mut value = Value::Object(value);
    if let Some(existing) = existing_value.as_ref() {
        restore_redacted_headers(&mut value, existing)?;
    }
    Ok(value)
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
                .filter_map(|value| serde_json::from_value(redacted_model_value(value)).ok())
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
    let value = provider_value(&input, existing.clone())?;
    if existing.as_ref().is_some_and(|existing| existing == &value) {
        return write_models(agent_dir, original.as_ref(), &text);
    }
    let new_text = replace_provider_value(&text, &input.id, &value)?;
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

fn positive_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(Value::as_u64).filter(|value| *value > 0)
}

fn imported_input_values(value: &Map<String, Value>) -> Option<Vec<String>> {
    let values = value.get("modalities")?.get("input")?.as_array()?;
    let values = values
        .iter()
        .filter_map(Value::as_str)
        .filter(|value| matches!(*value, "text" | "image"))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    (!values.is_empty()).then_some(values)
}

fn imported_thinking(value: &Map<String, Value>) -> Option<Value> {
    let variants = value.get("variants")?.as_object()?;
    let mut efforts = variants
        .iter()
        .flat_map(|(key, variant)| {
            let key_effort = EFFORTS.contains(&key.as_str()).then_some(key.as_str());
            let value_effort = variant.as_object().and_then(|variant| {
                ["effort", "reasoningEffort"]
                    .iter()
                    .find_map(|field| variant.get(*field).and_then(Value::as_str))
                    .filter(|effort| EFFORTS.contains(effort))
            });
            key_effort.into_iter().chain(value_effort)
        })
        .collect::<Vec<_>>();
    efforts.sort_by_key(|effort| {
        EFFORTS
            .iter()
            .position(|candidate| candidate == effort)
            .unwrap_or(usize::MAX)
    });
    efforts.dedup();
    if efforts.is_empty() {
        return None;
    }
    Some(serde_json::json!({
        "mode": "effort",
        "efforts": efforts,
    }))
}

fn import_model(value: &Value, id: &str) -> ProviderModel {
    let object = value.as_object();
    let reasoning = object
        .and_then(|object| object.get("reasoning"))
        .and_then(Value::as_bool);
    let thinking = object.and_then(imported_thinking);
    ProviderModel {
        id: id.to_owned(),
        name: object
            .and_then(|object| object.get("name"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        reasoning: reasoning.or_else(|| thinking.as_ref().map(|_| true)),
        input: object.and_then(imported_input_values),
        thinking,
        context_window: object.and_then(|object| {
            positive_u64(object.get("limit").and_then(|limit| limit.get("context")))
        }),
        max_tokens: object.and_then(|object| {
            positive_u64(object.get("limit").and_then(|limit| limit.get("output")))
        }),
        extra: Map::new(),
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

fn fill_model_details(existing: &mut Value, imported: &ProviderModel) -> bool {
    let Some(existing) = existing.as_object_mut() else {
        return false;
    };
    let imported = model_value(imported);
    let Some(imported) = imported.as_object() else {
        return false;
    };
    let mut changed = false;
    for key in [
        "contextWindow",
        "maxTokens",
        "reasoning",
        "input",
        "thinking",
    ] {
        if existing.get(key).is_none_or(Value::is_null) {
            if let Some(value) = imported.get(key) {
                existing.insert(key.to_owned(), value.clone());
                changed = true;
            }
        }
    }
    changed
}

fn update_existing_provider(value: &Value, imported: &ProviderInput) -> (Value, bool) {
    let mut value = value.clone();
    let Some(provider) = value.as_object_mut() else {
        return (value, false);
    };
    let Some(models) = provider.get_mut("models").and_then(Value::as_array_mut) else {
        return (value, false);
    };
    let mut changed = false;
    for imported_model in &imported.models {
        if let Some(existing_model) = models.iter_mut().find(|model| {
            model.get("id").and_then(Value::as_str) == Some(imported_model.id.as_str())
        }) {
            changed |= fill_model_details(existing_model, imported_model);
        }
    }
    (value, changed)
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
                updated: Vec::new(),
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
    let existing_snapshot = read_snapshot(&models_path)?;
    let existing_text = snapshot_text(existing_snapshot.as_ref())?;
    let existing_providers = provider_map(&existing_text)?;
    let mut imported = Vec::new();
    let mut updated = Vec::new();
    let mut skipped = Vec::new();
    let mut keys_found = 0;
    let mut working_text = existing_text.clone();
    let mut existing_changed = false;
    let mut new_providers = Vec::new();
    for (id, value) in providers {
        let (input, key) = imported_input(&id, &value)?;
        if existing_providers.contains_key(&id) {
            let existing = jsonc_edit::get_object_path(&working_text, &["providers", &id])?
                .ok_or_else(|| provider_not_found(&id))?;
            let (updated_value, changed) = update_existing_provider(&existing, &input);
            if changed {
                working_text = replace_provider_value(&working_text, &id, &updated_value)?;
                existing_changed = true;
                updated.push(id.clone());
            } else {
                skipped.push(id.clone());
            }
            continue;
        }
        new_providers.push((id, input, key));
    }
    if existing_changed {
        write_models(agent_dir, existing_snapshot.as_ref(), &working_text)?;
    }
    for (id, input, key) in new_providers {
        save_at(agent_dir, input)?;
        if let Some(key) = key {
            auth::set_key(auth_path, &id, &key)?;
            keys_found += 1;
        }
        imported.push(id);
    }
    Ok(ProviderImportResult {
        imported,
        updated,
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

fn validate_provider_json(value: &Value) -> Result<(), AppError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("json", "provider JSON must be an object"))?;
    if object.keys().any(|key| api_key_name(key)) {
        return Err(invalid("apiKey", "use the key field"));
    }
    let base_url = object
        .get("baseUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("baseUrl", "baseUrl must be a non-empty http or https URL"))?;
    if base_url.is_empty()
        || (!base_url.starts_with("http://") && !base_url.starts_with("https://"))
    {
        return Err(invalid(
            "baseUrl",
            "baseUrl must be a non-empty http or https URL",
        ));
    }
    let api = object
        .get("api")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("api", "api must be a supported protocol"))?;
    if !VALID_APIS.contains(&api) {
        return Err(invalid(
            "api",
            "api must be one of: openai-completions, openai-responses, anthropic-messages",
        ));
    }
    let models = object
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("models", "models must be an array of objects"))?;
    for model in models {
        let model = model
            .as_object()
            .ok_or_else(|| invalid("models", "models must be an array of objects"))?;
        if model
            .get("id")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err(invalid(
                "models",
                "each model must have a non-empty string id",
            ));
        }
        for field in ["contextWindow", "maxTokens"] {
            if let Some(value) = model.get(field) {
                if positive_u64(Some(value)).is_none() {
                    return Err(invalid(field, "must be a positive integer"));
                }
            }
        }
        if let Some(input) = model.get("input") {
            let Some(input) = input.as_array() else {
                return Err(invalid("input", "input must contain only text or image"));
            };
            if input.iter().any(|value| {
                !value
                    .as_str()
                    .is_some_and(|value| matches!(value, "text" | "image"))
            }) {
                return Err(invalid("input", "input must contain only text or image"));
            }
        }
        if let Some(thinking) = model.get("thinking") {
            let Some(thinking) = thinking.as_object() else {
                return Err(invalid(
                    "thinking",
                    "thinking must be an object with a string mode",
                ));
            };
            if thinking.get("mode").and_then(Value::as_str).is_none() {
                return Err(invalid(
                    "thinking",
                    "thinking must be an object with a string mode",
                ));
            }
        }
    }
    Ok(())
}

fn provider_json_value(value: &Value) -> Result<Value, AppError> {
    let mut value = value.clone();
    let Some(object) = value.as_object_mut() else {
        return Err(invalid("json", "provider JSON must be an object"));
    };
    let api_key_names = object
        .keys()
        .filter(|key| api_key_name(key))
        .cloned()
        .collect::<Vec<_>>();
    for key in api_key_names {
        object.remove(&key);
    }
    redact_headers(&mut value);
    redact_api_keys(&mut value);
    Ok(value)
}

fn provider_json_at(agent_dir: &Path, id: &str) -> Result<String, AppError> {
    let (_, text) = load_models(agent_dir)?;
    let value = jsonc_edit::get_object_path(&text, &["providers", id])?
        .ok_or_else(|| provider_not_found(id))?;
    let value = provider_json_value(&value)?;
    let mut output = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"  ");
    let mut serializer = serde_json::Serializer::with_formatter(&mut output, formatter);
    value
        .serialize(&mut serializer)
        .map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
    String::from_utf8(output).map_err(|error| AppError::Io {
        message: error.to_string(),
    })
}

fn save_provider_json_at(agent_dir: &Path, id: &str, json: &str) -> Result<SaveResult, AppError> {
    let (original, text) = load_models(agent_dir)?;
    let existing = jsonc_edit::get_object_path(&text, &["providers", id])?
        .ok_or_else(|| provider_not_found(id))?;
    let mut candidate = parse_provider_json(json)?;
    validate_provider_json(&candidate)?;
    restore_redacted_headers(&mut candidate, &existing)?;
    if let Some((api_key_name, api_key)) = existing
        .as_object()
        .and_then(|object| object.iter().find(|(key, _)| api_key_name(key)))
    {
        if let Some(object) = candidate.as_object_mut() {
            object.insert(api_key_name.clone(), api_key.clone());
        }
    }
    if candidate == existing {
        return write_models(agent_dir, original.as_ref(), &text);
    }
    let new_text = replace_provider_value(&text, id, &candidate)?;
    write_models(agent_dir, original.as_ref(), &new_text)
}

pub fn provider_json(paths: &Paths, id: &str) -> Result<String, AppError> {
    provider_json_at(&paths.agent_dir(), id)
}

pub fn save_provider_json(paths: &Paths, id: &str, json: &str) -> Result<SaveResult, AppError> {
    save_provider_json_at(&paths.agent_dir(), id, json)
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
                    input: None,
                    thinking: None,
                    context_window: Some(4096),
                    max_tokens: Some(1024),
                    extra: Map::new(),
                },
                ProviderModel {
                    id: "model-b".to_owned(),
                    name: None,
                    reasoning: None,
                    input: None,
                    thinking: None,
                    context_window: None,
                    max_tokens: None,
                    extra: Map::new(),
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
            &provider_value(&input("alpha"), None).expect("provider value"),
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

    #[test]
    fn model_extra_input_and_thinking_round_trip() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        let mut extra = Map::new();
        extra.insert("cost".to_owned(), serde_json::json!({"input": 1.5}));
        save_at(
            &agent_dir,
            ProviderInput {
                models: vec![ProviderModel {
                    id: "model-a".to_owned(),
                    name: Some("Model A".to_owned()),
                    reasoning: Some(true),
                    input: Some(vec!["text".to_owned(), "image".to_owned()]),
                    thinking: Some(serde_json::json!({
                        "mode": "effort",
                        "efforts": ["low", "high"]
                    })),
                    context_window: Some(1000),
                    max_tokens: Some(200),
                    extra,
                }],
                ..input("alpha")
            },
        )
        .expect("save succeeds");
        let result = list_at(&agent_dir, &agent_dir.join("auth.json"), &[]).expect("list succeeds");
        let model = &result.providers[0].models[0];
        let expected_input = vec!["text".to_owned(), "image".to_owned()];
        assert_eq!(model.input.as_ref(), Some(&expected_input));
        assert_eq!(
            model.thinking.as_ref().and_then(|value| value.get("mode")),
            Some(&Value::String("effort".to_owned()))
        );
        assert_eq!(
            model.extra.get("cost"),
            Some(&serde_json::json!({"input": 1.5}))
        );
    }

    #[test]
    fn model_headers_are_redacted_in_provider_info() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(
            &agent_dir,
            r#"{"providers":{"alpha":{"baseUrl":"https://alpha.test","api":"openai-completions","models":[{"id":"a","headers":{"Authorization":"TEST-NOT-A-REAL-KEY"}}]}}}"#,
        );
        let result = list_at(&agent_dir, &agent_dir.join("auth.json"), &[]).expect("list succeeds");
        assert_eq!(
            result.providers[0].models[0].extra["headers"]["Authorization"],
            REDACTED
        );
    }

    #[test]
    fn import_maps_limits_modalities_and_variants() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        let source = root.path().join("opencode.json");
        fs::write(
            &source,
            r#"{"provider":{"alpha":{"options":{"baseURL":"https://alpha.test"},"models":{"a":{"limit":{"context":100,"output":20},"modalities":{"input":["text","audio","image"]},"variants":{"high":{"effort":"high"},"low":{"reasoningEffort":"low"}}}}}}}"#,
        )
        .expect("source exists");
        import_at(&agent_dir, &agent_dir.join("auth.json"), &source).expect("import succeeds");
        let result = list_at(&agent_dir, &agent_dir.join("auth.json"), &[]).expect("list succeeds");
        let model = &result.providers[0].models[0];
        assert_eq!(model.context_window, Some(100));
        assert_eq!(model.max_tokens, Some(20));
        let expected_input = vec!["text".to_owned(), "image".to_owned()];
        assert_eq!(model.input.as_ref(), Some(&expected_input));
        assert_eq!(model.reasoning, Some(true));
        assert_eq!(
            model
                .thinking
                .as_ref()
                .and_then(|value| value.get("efforts")),
            Some(&serde_json::json!(["low", "high"]))
        );
    }

    #[test]
    fn import_updates_missing_existing_details_without_overwriting() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(
            &agent_dir,
            r#"{"providers":{"alpha":{"baseUrl":"https://alpha.test","api":"openai-completions","models":[{"id":"a","contextWindow":999}]}}}"#,
        );
        let source = root.path().join("opencode.json");
        fs::write(
            &source,
            r#"{"provider":{"alpha":{"options":{"baseURL":"https://alpha.test"},"models":{"a":{"limit":{"context":100,"output":20},"reasoning":true}}}}}"#,
        )
        .expect("source exists");
        let result =
            import_at(&agent_dir, &agent_dir.join("auth.json"), &source).expect("import succeeds");
        assert_eq!(result.updated, vec!["alpha"]);
        let value = jsonc_edit::parse_value(
            &fs::read_to_string(agent_dir.join("models.json")).expect("models"),
        )
        .expect("models parse");
        assert_eq!(
            value["providers"]["alpha"]["models"][0]["contextWindow"],
            999
        );
        assert_eq!(value["providers"]["alpha"]["models"][0]["maxTokens"], 20);
        let second = import_at(&agent_dir, &agent_dir.join("auth.json"), &source)
            .expect("second import succeeds");
        assert!(second.updated.is_empty());
        assert_eq!(second.skipped, vec!["alpha"]);
    }

    #[test]
    fn provider_json_redacts_api_key_and_authorization() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(
            &agent_dir,
            &format!(
                r#"{{"providers":{{"alpha":{{"apiKey":"{TEST_KEY}","baseUrl":"https://alpha.test","api":"openai-completions","headers":{{"Authorization":"{TEST_KEY}","X-Test":"keep"}},"models":[]}}}}}}"#
            ),
        );
        let json = provider_json_at(&agent_dir, "alpha").expect("provider JSON succeeds");
        assert!(!json.contains(TEST_KEY));
        assert!(json.contains(REDACTED));
        assert!(json.contains("keep"));
    }

    #[test]
    fn save_provider_json_restores_key_and_removes_deleted_field() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(
            &agent_dir,
            &format!(
                r#"{{"providers":{{"alpha":{{"apiKey":"{TEST_KEY}","baseUrl":"https://alpha.test","api":"openai-completions","headers":{{"Authorization":"{TEST_KEY}"}},"custom":true,"models":[]}}}}}}"#
            ),
        );
        save_provider_json_at(
            &agent_dir,
            "alpha",
            r#"{"baseUrl":"https://new.test","api":"openai-responses","headers":{"Authorization":"<redacted>"},"models":[]}"#,
        )
        .expect("provider JSON saves");
        let value = jsonc_edit::parse_value(
            &fs::read_to_string(agent_dir.join("models.json")).expect("models"),
        )
        .expect("models parse");
        assert_eq!(value["providers"]["alpha"]["apiKey"], TEST_KEY);
        assert_eq!(
            value["providers"]["alpha"]["headers"]["Authorization"],
            TEST_KEY
        );
        assert!(value["providers"]["alpha"].get("custom").is_none());
    }

    #[test]
    fn save_provider_json_rejects_api_key_and_non_object_without_echoing_key() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(
            &agent_dir,
            &format!(
                r#"{{"providers":{{"alpha":{{"apiKey":"{TEST_KEY}","baseUrl":"https://alpha.test","api":"openai-completions","models":[]}}}}}}"#
            ),
        );
        let error = save_provider_json_at(
            &agent_dir,
            "alpha",
            &format!(r#"{{"apiKey":"{TEST_KEY}","baseUrl":"https://alpha.test","api":"openai-completions","models":[]}}"#),
        )
        .expect_err("api key must be rejected");
        assert!(matches!(error, AppError::InvalidProvider { ref field, .. } if field == "apiKey"));
        assert!(!error.to_string().contains(TEST_KEY));
        assert!(matches!(
            save_provider_json_at(&agent_dir, "alpha", "[]"),
            Err(AppError::InvalidProvider { field, .. }) if field == "json"
        ));
    }

    #[test]
    fn provider_json_preserves_comments_outside_replaced_provider() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        let before = "// root\n{\n  \"providers\": {\n    // alpha comment\n    \"alpha\": {\"baseUrl\": \"https://alpha.test\", \"api\": \"openai-completions\", \"models\": []}\n  },\n  // sibling comment\n  \"other\": true\n}\n";
        write_models(&agent_dir, before);
        save_provider_json_at(
            &agent_dir,
            "alpha",
            r#"{"baseUrl":"https://new.test","api":"openai-completions","models":[]}"#,
        )
        .expect("provider JSON saves");
        let after = fs::read_to_string(agent_dir.join("models.json")).expect("models");
        assert!(
            after.contains("// root")
                && after.contains("// alpha comment")
                && after.contains("// sibling comment")
        );
    }

    #[test]
    fn provider_json_unknown_id_returns_provider_not_found() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(&agent_dir, r#"{"providers":{}}"#);
        assert!(matches!(
            provider_json_at(&agent_dir, "missing"),
            Err(AppError::ProviderNotFound { .. })
        ));
    }

    #[test]
    fn save_provider_json_validates_model_details() {
        let root = tempfile::tempdir().expect("tempdir");
        let agent_dir = agent(root.path());
        write_models(
            &agent_dir,
            r#"{"providers":{"alpha":{"baseUrl":"https://alpha.test","api":"openai-completions","models":[]}}}"#,
        );
        let bad_input = r#"{"baseUrl":"https://alpha.test","api":"openai-completions","models":[{"id":"a","input":["audio"]}]}"#;
        assert!(matches!(
            save_provider_json_at(&agent_dir, "alpha", bad_input),
            Err(AppError::InvalidProvider { field, .. }) if field == "input"
        ));
        let bad_thinking = r#"{"baseUrl":"https://alpha.test","api":"openai-completions","models":[{"id":"a","thinking":true}]}"#;
        assert!(matches!(
            save_provider_json_at(&agent_dir, "alpha", bad_thinking),
            Err(AppError::InvalidProvider { field, .. }) if field == "thinking"
        ));
    }
}
