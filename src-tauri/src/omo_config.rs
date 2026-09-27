use crate::error::AppError;
use crate::jsonc_edit;
use crate::paths::Paths;
use crate::store::{canonical_eq, Profile, ProfileInput, Store};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Loaded {
    pub text: String,
    pub hash: String,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Drift {
    InSync,
    Drifted,
    NoActive,
    ConfigMissing,
    ConfigInvalid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub config_path: String,
    pub config_exists: bool,
    pub active_profile_id: Option<String>,
    pub drift: Drift,
    pub native_block_present: bool,
    pub legacy_senpi_present: bool,
    pub omo_available: bool,
    pub config_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchPreview {
    pub profile_id: String,
    pub base_hash: String,
    pub before_native: String,
    pub after_native: String,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub changed: bool,
    pub backup_path: Option<String>,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub created_at: String,
    pub size_bytes: u64,
}

fn io(error: std::io::Error) -> AppError {
    AppError::Io {
        message: error.to_string(),
    }
}
fn config_missing(path: &Path) -> AppError {
    AppError::ConfigMissing {
        message: path.display().to_string(),
    }
}
fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn load(paths: &Paths) -> Result<Loaded, AppError> {
    let bytes = fs::read(paths.config_path()).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            config_missing(&paths.config_path())
        } else {
            io(error)
        }
    })?;
    let text = String::from_utf8(bytes.clone()).map_err(|error| AppError::MalformedJsonc {
        message: error.to_string(),
        line: 1,
        col: 1,
    })?;
    let value = jsonc_edit::parse_value(&text)?;
    Ok(Loaded {
        text,
        hash: hash(&bytes),
        value,
    })
}

pub fn status(paths: &Paths, store: &Store) -> Status {
    let path = paths.config_path();
    let active = store.active_profile_id().map(str::to_owned);
    let available = omo_available(&paths.omo_bin);
    let missing = !path.exists();
    if missing {
        return Status {
            config_path: path.display().to_string(),
            config_exists: false,
            active_profile_id: active,
            drift: Drift::ConfigMissing,
            native_block_present: false,
            legacy_senpi_present: false,
            omo_available: available,
            config_hash: None,
        };
    }
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return Status {
                config_path: path.display().to_string(),
                config_exists: true,
                active_profile_id: active,
                drift: Drift::ConfigInvalid,
                native_block_present: false,
                legacy_senpi_present: false,
                omo_available: available,
                config_hash: None,
            }
        }
    };
    let config_hash = Some(hash(&bytes));
    let loaded = match load(paths) {
        Ok(value) => value,
        Err(_) => {
            return Status {
                config_path: path.display().to_string(),
                config_exists: true,
                active_profile_id: active,
                drift: Drift::ConfigInvalid,
                native_block_present: false,
                legacy_senpi_present: false,
                omo_available: available,
                config_hash,
            }
        }
    };
    let native = jsonc_edit::native_subtrees(&loaded.text);
    let native_present = jsonc_edit::has_key(&loaded.text, "[native]").unwrap_or(false);
    let senpi = jsonc_edit::has_key(&loaded.text, "[senpi]").unwrap_or(false);
    let drift = if native.is_err() {
        Drift::ConfigInvalid
    } else {
        match active.as_deref().and_then(|id| store.get(id).ok()) {
            None => Drift::NoActive,
            Some(profile) => match native {
                Ok((agents, categories)) => {
                    let current = Value::Object(Map::from_iter([
                        (String::from("agents"), Value::Object(agents)),
                        (String::from("categories"), Value::Object(categories)),
                    ]));
                    let expected = Value::Object(Map::from_iter([
                        (
                            String::from("agents"),
                            Value::Object(profile.agents.clone()),
                        ),
                        (
                            String::from("categories"),
                            Value::Object(profile.categories.clone()),
                        ),
                    ]));
                    if canonical_eq(&current, &expected) {
                        Drift::InSync
                    } else {
                        Drift::Drifted
                    }
                }
                Err(_) => Drift::ConfigInvalid,
            },
        }
    };
    Status {
        config_path: path.display().to_string(),
        config_exists: true,
        active_profile_id: active,
        drift,
        native_block_present: native_present,
        legacy_senpi_present: senpi,
        omo_available: available,
        config_hash: Some(loaded.hash),
    }
}

pub fn preview(paths: &Paths, store: &Store, id: &str) -> Result<SwitchPreview, AppError> {
    let loaded = load(paths)?;
    let profile = store.get(id)?;
    let after =
        jsonc_edit::set_native_subtrees(&loaded.text, &profile.agents, &profile.categories)?;
    let before_native = native_text(&loaded.text);
    let after_native = native_text(&after);
    Ok(SwitchPreview {
        profile_id: id.to_owned(),
        base_hash: loaded.hash,
        changed: before_native != after_native,
        before_native,
        after_native,
    })
}

pub fn apply(
    paths: &Paths,
    store: &mut Store,
    id: &str,
    expected_hash: Option<&str>,
) -> Result<ApplyResult, AppError> {
    let loaded = load(paths)?;
    let profile = store.get(id)?.clone();
    let new_text =
        jsonc_edit::set_native_subtrees(&loaded.text, &profile.agents, &profile.categories)?;
    let config_path = paths.config_path();
    if expected_hash.is_some_and(|value| value != loaded.hash) {
        return Err(AppError::ChangedOnDisk {
            message: config_path.display().to_string(),
        });
    }
    if new_text == loaded.text {
        store.set_active(Some(id.to_owned()))?;
        return Ok(ApplyResult {
            changed: false,
            backup_path: None,
            config_path: config_path.display().to_string(),
        });
    }
    let current = load(paths)?;
    if current.hash != loaded.hash || expected_hash.is_some_and(|value| value != current.hash) {
        return Err(AppError::ChangedOnDisk {
            message: config_path.display().to_string(),
        });
    }
    let backup = create_backup(paths, loaded.text.as_bytes())?;
    atomic_write(&config_path, new_text.as_bytes())?;
    store.set_active(Some(id.to_owned()))?;
    Ok(ApplyResult {
        changed: true,
        backup_path: Some(backup.display().to_string()),
        config_path: config_path.display().to_string(),
    })
}

pub fn capture_active(paths: &Paths, store: &mut Store) -> Result<Profile, AppError> {
    let id = store
        .active_profile_id()
        .ok_or_else(|| AppError::ProfileNotFound {
            message: "no active profile".into(),
        })?
        .to_owned();
    let loaded = load(paths)?;
    let (agents, categories) = jsonc_edit::native_subtrees(&loaded.text)?;
    let old = store.get(&id)?.clone();
    store.save(ProfileInput {
        id: Some(id),
        name: old.name,
        note: old.note,
        agents,
        categories,
    })
}

pub fn list_backups(paths: &Paths) -> Result<Vec<BackupInfo>, AppError> {
    let mut result = Vec::new();
    let config_path = paths.config_path();
    let directory = config_path.parent().ok_or_else(|| AppError::Io {
        message: "configuration has no parent directory".into(),
    })?;
    let prefix = "omo.jsonc.bak.omoswitch-";
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(error) => return Err(io(error)),
    };
    for entry in entries {
        let entry = entry.map_err(io)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(prefix) {
            continue;
        }
        let metadata = entry.metadata().map_err(io)?;
        if !metadata.is_file() {
            continue;
        }
        let created = metadata.modified().map_err(io)?;
        let created: DateTime<Utc> = created.into();
        result.push(BackupInfo {
            path: entry.path().display().to_string(),
            created_at: created.to_rfc3339_opts(SecondsFormat::Secs, true),
            size_bytes: metadata.len(),
        });
    }
    result.sort_by(|left, right| right.path.cmp(&left.path));
    Ok(result)
}

pub fn restore_backup(
    paths: &Paths,
    store: &mut Store,
    path: &str,
) -> Result<ApplyResult, AppError> {
    let allowed = list_backups(paths)?
        .into_iter()
        .find(|backup| backup.path == path)
        .ok_or_else(|| AppError::Io {
            message: "backup path is not allowed".into(),
        })?;
    let target = paths.config_path();
    let bytes = fs::read(&allowed.path).map_err(io)?;
    let current = load(paths)?;
    jsonc_edit::parse_value(std::str::from_utf8(&bytes).map_err(|error| AppError::Io {
        message: error.to_string(),
    })?)?;
    let backup = create_backup(paths, current.text.as_bytes())?;
    if bytes == current.text.as_bytes() {
        return Ok(ApplyResult {
            changed: false,
            backup_path: Some(backup.display().to_string()),
            config_path: target.display().to_string(),
        });
    }
    atomic_write(&target, &bytes)?;
    store.set_active(None)?;
    Ok(ApplyResult {
        changed: true,
        backup_path: Some(backup.display().to_string()),
        config_path: target.display().to_string(),
    })
}

fn create_backup(paths: &Paths, bytes: &[u8]) -> Result<PathBuf, AppError> {
    let config_path = paths.config_path();
    let directory = config_path.parent().ok_or_else(|| AppError::Io {
        message: "configuration has no parent directory".into(),
    })?;
    fs::create_dir_all(directory).map_err(io)?;
    let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let base = directory.join(format!("omo.jsonc.bak.omoswitch-{stamp}"));
    let mut path = base.clone();
    let mut suffix = 2u32;
    while path.exists() {
        path = directory.join(format!("omo.jsonc.bak.omoswitch-{stamp}-{suffix}"));
        suffix += 1;
    }
    fs::write(&path, bytes).map_err(io)?;
    let backups = list_backups(paths)?;
    for old in backups.into_iter().skip(20) {
        fs::remove_file(old.path).map_err(io)?;
    }
    Ok(path)
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let temp = target.with_file_name("omo.jsonc.omoswitch.tmp");
    fs::write(&temp, bytes).map_err(io)?;
    let result = replace_file(&temp, target);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(io)
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(temp, target)
}

#[cfg(windows)]
fn replace_file(temp: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, REPLACEFILE_IGNORE_MERGE_ERRORS,
    };
    let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let replaced = unsafe {
        ReplaceFileW(
            destination.as_ptr(),
            source.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced != 0 {
        return Ok(());
    }
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING,
        )
    };
    if moved != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn omo_available(bin: &str) -> bool {
    let path = Path::new(bin);
    if path.is_absolute() {
        return path.is_file();
    }
    let paths = std::env::var_os("PATH").unwrap_or_default();
    for directory in std::env::split_paths(&paths) {
        if directory.join(bin).is_file() {
            return true;
        }
        #[cfg(windows)]
        for extension in [".exe", ".cmd", ".bat"] {
            if directory.join(format!("{bin}{extension}")).is_file() {
                return true;
            }
        }
    }
    false
}

fn native_text(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut index = 0usize;
    while index < bytes.len() {
        if depth == 1 && text[index..].starts_with("\"[native]\"") {
            let key_end = index + "\"[native]\"".len();
            let colon = skip_ws(text, key_end);
            if text.as_bytes().get(colon) == Some(&b':') {
                let start = skip_ws(text, colon + 1);
                let end = value_end(text, start);
                return text[start..end].to_owned();
            }
        }
        if bytes[index] == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'/' {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if bytes[index] == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'*' {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            index = index.saturating_add(2).min(bytes.len());
            continue;
        }
        if bytes[index] == b'"' || bytes[index] == b'\'' {
            index = quoted_end(text, index);
            continue;
        }
        if bytes[index] == b'/' && index + 1 < bytes.len() && bytes[index + 1] == b'/' {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if bytes[index] == b'{' {
            depth += 1;
            index += 1;
            continue;
        }
        if bytes[index] == b'}' {
            depth = depth.saturating_sub(1);
            index += 1;
            continue;
        }
        index += 1;
    }
    String::new()
}
fn quoted_end(text: &str, mut index: usize) -> usize {
    let quote = text.as_bytes()[index];
    index += 1;
    while index < text.len() {
        if text.as_bytes()[index] == b'\\' {
            index += 2;
        } else if text.as_bytes()[index] == quote {
            return index + 1;
        } else {
            index += 1;
        }
    }
    text.len()
}
fn skip_ws(text: &str, mut index: usize) -> usize {
    while index < text.len() && text.as_bytes()[index].is_ascii_whitespace() {
        index += 1;
    }
    index
}
fn value_end(text: &str, start: usize) -> usize {
    let mut depth = 0usize;
    let mut index = start;
    while index < text.len() {
        let byte = text.as_bytes()[index];
        if byte == b'"' || byte == b'\'' {
            index = quoted_end(text, index);
            continue;
        }
        if byte == b'/' && index + 1 < text.len() && text.as_bytes()[index + 1] == b'/' {
            index += 2;
            while index < text.len() && text.as_bytes()[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if byte == b'/' && index + 1 < text.len() && text.as_bytes()[index + 1] == b'*' {
            index += 2;
            while index + 1 < text.len()
                && !(text.as_bytes()[index] == b'*' && text.as_bytes()[index + 1] == b'/')
            {
                index += 1;
            }
            index = index.saturating_add(2).min(text.len());
            continue;
        }
        if byte == b'{' || byte == b'[' {
            depth += 1;
        } else if byte == b'}' || byte == b']' {
            if depth == 0 {
                return index;
            }
            depth -= 1;
        } else if byte == b',' && depth == 0 {
            return index;
        }
        index += 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixture(name: &str) -> &'static str {
        match name {
            "user" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/user_shaped.jsonc"
            )),
            "crlf" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/user_shaped_crlf.jsonc"
            )),
            "native" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/with_native.jsonc"
            )),
            "bad" => include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/malformed.jsonc"
            )),
            _ => "{}",
        }
    }

    fn paths(root: &Path) -> Paths {
        Paths {
            omo_home: root.join("omo"),
            store_home: root.join("store"),
            omo_bin: "definitely-missing-omo".to_owned(),
        }
    }

    fn profile_input() -> ProfileInput {
        ProfileInput {
            id: None,
            name: "One".to_owned(),
            note: String::new(),
            agents: Map::from_iter([(
                String::from("sisyphus"),
                serde_json::json!({"model":"p/m"}),
            )]),
            categories: Map::from_iter([(
                String::from("quick"),
                serde_json::json!({"model":"p/c"}),
            )]),
        }
    }

    fn setup(config: &str) -> (tempfile::TempDir, Paths, Store, Profile) {
        let root = tempdir().unwrap();
        let paths = paths(root.path());
        fs::create_dir_all(&paths.omo_home).unwrap();
        fs::write(paths.config_path(), config).unwrap();
        let mut store = Store::load(&paths.store_home).unwrap();
        let profile = store.save(profile_input()).unwrap();
        (root, paths, store, profile)
    }

    #[test]
    fn apply_succeeds_and_preserves_opencode_bytes() {
        let (_root, paths, mut store, profile) = setup(fixture("user"));
        let before = load(&paths).unwrap().text;
        let opencode = before
            .split_once("\"[opencode]\"")
            .unwrap()
            .1
            .split_once("\"_migrations\"")
            .unwrap()
            .0
            .to_owned();
        let result = apply(&paths, &mut store, &profile.id, None).unwrap();
        assert!(result.changed);
        assert!(result.backup_path.is_some());
        let after = load(&paths).unwrap().text;
        // Not assert_eq: `[native]` is inserted right after `[opencode]`, so the slice up to
        // `_migrations` grows by design; the invariant is that the `[opencode]` bytes survive.
        assert!(
            after.contains(&opencode),
            "[opencode] bytes were modified by apply"
        );
        assert!(after.contains("\"[native]\""));
        assert_eq!(list_backups(&paths).unwrap().len(), 1);
    }

    #[test]
    fn second_apply_is_idempotent_without_backup() {
        let (_root, paths, mut store, profile) = setup(fixture("user"));
        assert!(
            apply(&paths, &mut store, &profile.id, None)
                .unwrap()
                .changed
        );
        let count = list_backups(&paths).unwrap().len();
        let result = apply(&paths, &mut store, &profile.id, None).unwrap();
        assert!(!result.changed);
        assert_eq!(list_backups(&paths).unwrap().len(), count);
    }

    #[test]
    fn apply_rejects_changed_on_disk() {
        let (_root, paths, mut store, profile) = setup(fixture("user"));
        let base = load(&paths).unwrap();
        fs::write(paths.config_path(), format!("{}\n", base.text)).unwrap();
        let changed = fs::read(&paths.config_path()).unwrap();
        let error = apply(&paths, &mut store, &profile.id, Some(&base.hash)).unwrap_err();
        assert!(matches!(error, AppError::ChangedOnDisk { .. }));
        assert_eq!(fs::read(&paths.config_path()).unwrap(), changed);
    }

    #[test]
    fn status_reports_drift_and_sync() {
        let (_root, paths, mut store, profile) = setup(fixture("user"));
        store.set_active(Some(profile.id.clone())).unwrap();
        assert_eq!(status(&paths, &store).drift, Drift::Drifted);
        apply(&paths, &mut store, &profile.id, None).unwrap();
        assert_eq!(status(&paths, &store).drift, Drift::InSync);
        fs::write(paths.config_path(), fixture("native")).unwrap();
        assert_eq!(status(&paths, &store).drift, Drift::Drifted);
    }

    #[test]
    fn status_reports_config_missing() {
        let root = tempdir().unwrap();
        let paths = paths(root.path());
        let store = Store::load(&paths.store_home).unwrap();
        let result = status(&paths, &store);
        assert!(!result.config_exists);
        assert_eq!(result.drift, Drift::ConfigMissing);
    }

    #[test]
    fn status_reports_malformed_config() {
        let (_root, paths, store, _profile) = setup(fixture("bad"));
        let result = status(&paths, &store);
        assert_eq!(result.drift, Drift::ConfigInvalid);
    }

    #[test]
    fn restore_backup_round_trip() {
        let (_root, paths, mut store, profile) = setup(fixture("user"));
        let original = fs::read(paths.config_path()).unwrap();
        apply(&paths, &mut store, &profile.id, None).unwrap();
        let backup = list_backups(&paths).unwrap().first().unwrap().path.clone();
        restore_backup(&paths, &mut store, &backup).unwrap();
        assert_eq!(fs::read(paths.config_path()).unwrap(), original);
        assert!(list_backups(&paths).unwrap().len() >= 2);
    }

    #[test]
    fn prune_keeps_newest_twenty() {
        let (_root, paths, mut store, profile) = setup(fixture("user"));
        for index in 0..22 {
            let path = paths.omo_home.join(format!(
                "omo.jsonc.bak.omoswitch-2026-01-01T00-00-{index:02}Z"
            ));
            fs::write(path, index.to_string()).unwrap();
        }
        apply(&paths, &mut store, &profile.id, None).unwrap();
        assert_eq!(list_backups(&paths).unwrap().len(), 20);
    }

    #[test]
    fn crlf_is_preserved_end_to_end() {
        let (_root, paths, mut store, profile) = setup(fixture("crlf"));
        apply(&paths, &mut store, &profile.id, None).unwrap();
        let bytes = fs::read(paths.config_path()).unwrap();
        assert!(!String::from_utf8(bytes)
            .unwrap()
            .replace("\r\n", "")
            .contains('\n'));
    }

    #[test]
    fn preview_returns_native_member_text() {
        let (_root, paths, store, profile) = setup(fixture("native"));
        let result = preview(&paths, &store, &profile.id).unwrap();
        assert!(!result.before_native.is_empty());
        assert!(result.after_native.contains("agents"));
        assert!(result.changed);
    }
}
