// Schema notes fetched from omo.schema.json (the schema does not enumerate concrete agent or category names).
// Agent names: not listed by the schema; category names: not listed by the schema.
// Reasoning enum: off, minimal, low, medium, high, xhigh, max, auto.
// Other relevant schema enums include format mode off/best-effort/required and thinking enabled/disabled.

use crate::error::AppError;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub type Assignment = Map<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub note: String,
    pub agents: Map<String, Value>,
    pub categories: Map<String, Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub note: String,
    pub agents: Map<String, Value>,
    pub categories: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub profile: Profile,
    pub renamed: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreFile {
    pub version: u32,
    pub active_profile_id: Option<String>,
    pub profiles: Vec<Profile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportSource {
    Opencode,
    Native,
}

#[derive(Debug, Clone)]
pub struct Store {
    dir: PathBuf,
    data: StoreFile,
}

impl Store {
    pub fn load(dir: impl AsRef<Path>) -> Result<Self, AppError> {
        let dir = dir.as_ref().to_path_buf();
        let path = dir.join("store.json");
        let data = match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).map_err(|error| AppError::StoreCorrupt {
                message: error.to_string(),
            })?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => StoreFile::empty(),
            Err(error) => return Err(io_error(error)),
        };
        if data.version != 1 {
            return Err(AppError::StoreCorrupt {
                message: format!("unsupported store version {}", data.version),
            });
        }
        Ok(Self { dir, data })
    }

    pub fn list(&self) -> &[Profile] {
        &self.data.profiles
    }

    pub fn get(&self, id: &str) -> Result<&Profile, AppError> {
        self.data
            .profiles
            .iter()
            .find(|profile| profile.id == id)
            .ok_or_else(|| AppError::ProfileNotFound {
                message: id.to_owned(),
            })
    }

    pub fn active_profile_id(&self) -> Option<&str> {
        self.data.active_profile_id.as_deref()
    }

    pub fn save(&mut self, input: ProfileInput) -> Result<Profile, AppError> {
        validate_input(&input, &self.data.profiles, input.id.as_deref())?;
        let now = timestamp();
        let profile = if let Some(id) = input.id {
            let existing = self
                .data
                .profiles
                .iter_mut()
                .find(|profile| profile.id == id)
                .ok_or_else(|| AppError::ProfileNotFound {
                    message: id.clone(),
                })?;
            existing.name = input.name;
            existing.note = input.note;
            existing.agents = input.agents;
            existing.categories = input.categories;
            existing.updated_at = now;
            existing.clone()
        } else {
            let profile = Profile {
                id: Uuid::new_v4().to_string(),
                name: input.name,
                note: input.note,
                agents: input.agents,
                categories: input.categories,
                created_at: now.clone(),
                updated_at: now,
            };
            self.data.profiles.push(profile.clone());
            profile
        };
        self.persist()?;
        Ok(profile)
    }

    pub fn delete(&mut self, id: &str) -> Result<(), AppError> {
        let index = self
            .data
            .profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| AppError::ProfileNotFound {
                message: id.to_owned(),
            })?;
        self.data.profiles.remove(index);
        if self.data.active_profile_id.as_deref() == Some(id) {
            self.data.active_profile_id = None;
        }
        self.persist()
    }

    pub fn duplicate(&mut self, id: &str, name: String) -> Result<Profile, AppError> {
        let source = self.get(id)?.clone();
        self.save(ProfileInput {
            id: None,
            name,
            note: source.note,
            agents: source.agents,
            categories: source.categories,
        })
    }

    pub fn set_active(&mut self, id: Option<String>) -> Result<(), AppError> {
        if let Some(ref id) = id {
            self.get(id)?;
        }
        self.data.active_profile_id = id;
        self.persist()
    }

    pub fn import_profile(
        config: &Value,
        source: ImportSource,
        name: String,
    ) -> Result<ImportResult, AppError> {
        let root = config.as_object().ok_or_else(|| AppError::NotAnObject {
            message: "configuration root".to_owned(),
        })?;
        let section_name = match source {
            ImportSource::Opencode => "[opencode]",
            ImportSource::Native => "[native]",
        };
        let section = match root.get(section_name) {
            Some(value) => Some(value.as_object().ok_or_else(|| AppError::NotAnObject {
                message: section_name.to_owned(),
            })?),
            None => None,
        };
        let (agents, renamed_agents) =
            import_map(section.and_then(|value| value.get("agents")), source)?;
        let (categories, renamed_categories) =
            import_map(section.and_then(|value| value.get("categories")), source)?;
        let now = timestamp();
        let profile = Profile {
            id: Uuid::new_v4().to_string(),
            name,
            note: String::new(),
            agents,
            categories,
            created_at: now.clone(),
            updated_at: now,
        };
        Ok(ImportResult {
            profile,
            renamed: renamed_agents
                .into_iter()
                .chain(renamed_categories)
                .collect(),
        })
    }

    fn persist(&self) -> Result<(), AppError> {
        fs::create_dir_all(&self.dir).map_err(io_error)?;
        let bytes = serde_json::to_vec_pretty(&self.data).map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
        let temp = self.dir.join(format!("store.json.tmp-{}", Uuid::new_v4()));
        fs::write(&temp, bytes).map_err(io_error)?;
        if let Err(error) = replace_file(&temp, &self.dir.join("store.json")) {
            let _ = fs::remove_file(&temp);
            return Err(io_error(error));
        }
        Ok(())
    }
}

impl StoreFile {
    fn empty() -> Self {
        Self {
            version: 1,
            active_profile_id: None,
            profiles: Vec::new(),
        }
    }
}

pub fn canonical_eq(left: &Value, right: &Value) -> bool {
    canonical(left) == canonical(right)
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.iter().collect();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key.clone(), canonical(value)))
                    .collect(),
            )
        }
        Value::Array(values) => Value::Array(values.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

fn import_map(
    value: Option<&Value>,
    source: ImportSource,
) -> Result<(Map<String, Value>, Vec<(String, String)>), AppError> {
    let Some(value) = value else {
        return Ok((Map::new(), Vec::new()));
    };
    let object = value.as_object().ok_or_else(|| AppError::NotAnObject {
        message: "agents or categories".to_owned(),
    })?;
    let mut result = Map::new();
    let mut renamed = Vec::new();
    for (key, assignment) in object {
        let target = match (source, key.as_str()) {
            (ImportSource::Opencode, "metis") => "plan-consultant",
            (ImportSource::Opencode, "momus") => "plan-reviewer",
            _ => key,
        };
        if target != key {
            renamed.push((key.clone(), target.to_owned()));
        }
        result.insert(target.to_owned(), assignment.clone());
    }
    Ok((result, renamed))
}

fn validate_input(
    input: &ProfileInput,
    profiles: &[Profile],
    updating: Option<&str>,
) -> Result<(), AppError> {
    let length = input.name.chars().count();
    if !(1..=64).contains(&length) {
        return invalid("name");
    }
    if profiles.iter().any(|profile| {
        Some(profile.id.as_str()) != updating && profile.name.eq_ignore_ascii_case(&input.name)
    }) {
        return invalid("name");
    }
    for (kind, assignments) in [("agents", &input.agents), ("categories", &input.categories)] {
        for (key, assignment) in assignments {
            if !valid_key(key) {
                return invalid(&format!("{kind}.{key}"));
            }
            let object = assignment
                .as_object()
                .ok_or_else(|| AppError::InvalidProfile {
                    message: "assignment must be an object".to_owned(),
                    field: format!("{kind}.{key}"),
                })?;
            let model = object.get("model").and_then(Value::as_str).unwrap_or("");
            if model.is_empty() {
                return invalid(&format!("{kind}.{key}.model"));
            }
            if let Some(reasoning) = object.get("reasoning") {
                let valid = [
                    "off", "minimal", "low", "medium", "high", "xhigh", "max", "auto",
                ]
                .contains(&reasoning.as_str().unwrap_or(""));
                if !valid {
                    return invalid(&format!("{kind}.{key}.reasoning"));
                }
            }
        }
    }
    Ok(())
}

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' && index > 0
        })
}

fn invalid(field: &str) -> Result<(), AppError> {
    Err(AppError::InvalidProfile {
        message: "invalid value".to_owned(),
        field: field.to_owned(),
    })
}
fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn io_error(error: std::io::Error) -> AppError {
    AppError::Io {
        message: error.to_string(),
    }
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(temp, target)
}

#[cfg(windows)]
fn replace_file(temp: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both UTF-16 buffers are NUL-terminated and alive for this call.
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn assignment(model: &str) -> Map<String, Value> {
        Map::from_iter([(String::from("model"), Value::String(model.to_owned()))])
    }
    fn input(name: &str) -> ProfileInput {
        ProfileInput {
            id: None,
            name: name.to_owned(),
            note: String::new(),
            agents: Map::from_iter([(String::from("sisyphus"), Value::Object(assignment("p/m")))]),
            categories: Map::new(),
        }
    }

    #[test]
    fn missing_store_is_empty_v1() {
        let store = Store::load(tempdir().expect("temp").path()).expect("load");
        assert!(store.list().is_empty());
    }
    #[test]
    fn create_update_and_reload() {
        let dir = tempdir().expect("temp");
        let mut store = Store::load(dir.path()).expect("load");
        let profile = store.save(input("One")).expect("save");
        let mut changed = input("Two");
        changed.id = Some(profile.id.clone());
        store.save(changed).expect("update");
        assert_eq!(
            Store::load(dir.path())
                .expect("reload")
                .get(&profile.id)
                .expect("get")
                .name,
            "Two"
        );
    }
    #[test]
    fn duplicate_names_are_rejected_case_insensitively() {
        let dir = tempdir().expect("temp");
        let mut store = Store::load(dir.path()).expect("load");
        store.save(input("One")).expect("save");
        assert!(
            matches!(store.save(input("one")), Err(AppError::InvalidProfile { field, .. }) if field == "name")
        );
    }
    #[test]
    fn delete_active_clears_active_id() {
        let dir = tempdir().expect("temp");
        let mut store = Store::load(dir.path()).expect("load");
        let profile = store.save(input("One")).expect("save");
        store.set_active(Some(profile.id.clone())).expect("active");
        store.delete(&profile.id).expect("delete");
        assert_eq!(store.active_profile_id(), None);
    }
    #[test]
    fn import_renames_opencode_agents() {
        let config = serde_json::json!({"[opencode]":{"agents":{"metis":{"model":"p/m"},"momus":{"model":"p/n"}}}});
        let result = Store::import_profile(&config, ImportSource::Opencode, "Imported".to_owned())
            .expect("import");
        assert!(result.profile.agents.contains_key("plan-consultant"));
        assert_eq!(result.renamed.len(), 2);
    }
    #[test]
    fn native_import_does_not_rename() {
        let config = serde_json::json!({"[native]":{"agents":{"metis":{"model":"p/m"}}}});
        let result = Store::import_profile(&config, ImportSource::Native, "Imported".to_owned())
            .expect("import");
        assert!(result.profile.agents.contains_key("metis"));
        assert!(result.renamed.is_empty());
    }
    #[test]
    fn non_object_import_is_rejected() {
        let config = serde_json::json!({"[native]":{"agents":[]}});
        assert!(matches!(
            Store::import_profile(&config, ImportSource::Native, "x".to_owned()),
            Err(AppError::NotAnObject { .. })
        ));
    }
    #[test]
    fn canonical_comparison_ignores_object_order() {
        let left = serde_json::json!({"b":{"y":2,"x":1},"a":[{"d":4,"c":3}]});
        let right = serde_json::json!({"a":[{"c":3,"d":4}],"b":{"x":1,"y":2}});
        assert!(canonical_eq(&left, &right));
    }
    #[test]
    fn invalid_assignment_model_is_rejected() {
        let dir = tempdir().expect("temp");
        let mut store = Store::load(dir.path()).expect("load");
        let mut value = input("x");
        value
            .agents
            .get_mut("sisyphus")
            .expect("entry")
            .as_object_mut()
            .expect("object")
            .insert("model".to_owned(), Value::String(String::new()));
        assert!(
            matches!(store.save(value), Err(AppError::InvalidProfile { field, .. }) if field.ends_with("model"))
        );
    }
}
