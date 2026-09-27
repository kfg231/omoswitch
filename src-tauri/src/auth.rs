use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeySource {
    Auth,
    Inline,
    Env,
    None,
}

pub fn has_key(auth_path: &Path, id: &str) -> Result<bool, AppError> {
    let entries = read_entries(auth_path)?;
    let Some(entry) = entries.get(id).and_then(Value::as_object) else {
        return Ok(false);
    };
    match entry.get("type").and_then(Value::as_str) {
        Some("oauth") => Ok(true),
        Some("api_key") => Ok(entry
            .get("key")
            .and_then(Value::as_str)
            .is_some_and(|key| !key.is_empty())),
        Some(_) | None => Ok(false),
    }
}

pub fn set_key(auth_path: &Path, id: &str, key: &str) -> Result<(), AppError> {
    if key.trim().is_empty() {
        return Err(AppError::InvalidProvider {
            message: "key must not be empty".to_owned(),
            field: "key".to_owned(),
        });
    }

    let mut entries = read_entries(auth_path)?;
    entries.insert(
        id.to_owned(),
        serde_json::json!({
            "type": "api_key",
            "key": key,
        }),
    );
    write_entries(auth_path, &entries)
}

pub fn clear_key(auth_path: &Path, id: &str) -> Result<bool, AppError> {
    let mut entries = read_entries(auth_path)?;
    if entries.remove(id).is_none() {
        return Ok(false);
    }
    write_entries(auth_path, &entries)?;
    Ok(true)
}

pub fn key_source(
    auth_path: &Path,
    id: &str,
    inline_key_present: bool,
    env_present: bool,
) -> Result<KeySource, AppError> {
    if has_key(auth_path, id)? {
        return Ok(KeySource::Auth);
    }
    if inline_key_present {
        return Ok(KeySource::Inline);
    }
    if env_present {
        return Ok(KeySource::Env);
    }
    Ok(KeySource::None)
}

/// Returns API-key material only for the later request-header integration.
/// This is the only function that returns key material so it can be passed into
/// an HTTP Authorization header by that later task.
pub(crate) fn read_key_for_request(auth_path: &Path, id: &str) -> Result<Option<String>, AppError> {
    let entries = read_entries(auth_path)?;
    let Some(entry) = entries.get(id).and_then(Value::as_object) else {
        return Ok(None);
    };
    if entry.get("type").and_then(Value::as_str) != Some("api_key") {
        return Ok(None);
    }
    Ok(entry
        .get("key")
        .and_then(Value::as_str)
        .filter(|key| !key.is_empty())
        .map(str::to_owned))
}

fn read_entries(auth_path: &Path) -> Result<Map<String, Value>, AppError> {
    let bytes = match fs::read(auth_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(io_error(error)),
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| AppError::StoreCorrupt {
        message: "auth.json contains malformed JSON".to_owned(),
    })?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::NotAnObject {
            message: "auth.json must contain an object".to_owned(),
        })
}

fn write_entries(auth_path: &Path, entries: &Map<String, Value>) -> Result<(), AppError> {
    let parent = parent_directory(auth_path);
    fs::create_dir_all(parent).map_err(io_error)?;
    let mut bytes = serde_json::to_vec_pretty(entries).map_err(|_| AppError::StoreCorrupt {
        message: "auth.json could not be serialized".to_owned(),
    })?;
    bytes.push(b'\n');

    let temp = temp_path(auth_path);
    if let Err(error) = fs::write(&temp, bytes) {
        let _ = fs::remove_file(&temp);
        return Err(io_error(error));
    }
    #[cfg(unix)]
    if let Err(error) =
        fs::set_permissions(&temp, std::os::unix::fs::PermissionsExt::from_mode(0o600))
    {
        let _ = fs::remove_file(&temp);
        return Err(io_error(error));
    }

    if let Err(error) = replace_file(&temp, auth_path) {
        let _ = fs::remove_file(&temp);
        return Err(io_error(error));
    }
    Ok(())
}

fn parent_directory(auth_path: &Path) -> &Path {
    auth_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn temp_path(auth_path: &Path) -> PathBuf {
    parent_directory(auth_path).join(format!(".auth.json.tmp-{}", Uuid::new_v4()))
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
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, REPLACEFILE_IGNORE_MERGE_ERRORS,
    };

    let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both UTF-16 buffers are NUL-terminated and alive for this call.
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

    // SAFETY: both UTF-16 buffers are NUL-terminated and alive for this call.
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    const TEST_KEY: &str = "TEST-NOT-A-REAL-KEY";

    fn auth_path() -> (PathBuf, TempDir) {
        let root = tempfile::tempdir().expect("test directory can be created");
        (root.path().join("agent").join("auth.json"), root)
    }

    #[test]
    fn set_then_has_key_is_true_and_request_key_is_available() {
        let (path, _root) = auth_path();
        set_key(&path, "openai", TEST_KEY).expect("set key succeeds");

        assert!(has_key(&path, "openai").expect("has_key succeeds"));
        assert_eq!(
            read_key_for_request(&path, "openai").expect("read key succeeds"),
            Some(TEST_KEY.to_owned())
        );
        assert_eq!(
            fs::read_to_string(&path).expect("auth file exists"),
            "{\n  \"openai\": {\n    \"type\": \"api_key\",\n    \"key\": \"TEST-NOT-A-REAL-KEY\"\n  }\n}\n"
        );
    }

    #[test]
    fn clear_removes_entry_and_preserves_oauth_sibling() {
        let (path, _root) = auth_path();
        let fixture = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/auth_json_mixed.json"
        ));
        fs::create_dir_all(path.parent().expect("auth file has a parent")).expect("parent exists");
        fs::write(&path, fixture).expect("fixture is written");
        let before: Value = serde_json::from_str(fixture).expect("fixture is valid JSON");
        let oauth_before = before
            .get("oauth-provider")
            .cloned()
            .expect("oauth entry exists");

        assert!(clear_key(&path, "api-provider").expect("clear succeeds"));

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).expect("auth file remains"))
                .expect("saved JSON is valid");
        assert!(after.get("api-provider").is_none());
        assert_eq!(after.get("oauth-provider"), Some(&oauth_before));
        assert!(!has_key(&path, "api-provider").expect("has_key succeeds"));
    }

    #[test]
    fn key_source_uses_auth_then_inline_then_env_then_none() {
        let (path, _root) = auth_path();

        assert_eq!(
            key_source(&path, "provider", true, true).expect("source succeeds"),
            KeySource::Inline
        );
        assert_eq!(
            key_source(&path, "provider", false, true).expect("source succeeds"),
            KeySource::Env
        );
        assert_eq!(
            key_source(&path, "provider", false, false).expect("source succeeds"),
            KeySource::None
        );

        set_key(&path, "provider", TEST_KEY).expect("set key succeeds");
        assert_eq!(
            key_source(&path, "provider", true, true).expect("source succeeds"),
            KeySource::Auth
        );
    }

    #[test]
    fn missing_file_is_empty_and_has_key_does_not_create_it() {
        let (path, _root) = auth_path();

        assert!(!has_key(&path, "provider").expect("missing auth is empty"));
        assert!(!path.exists());
    }

    #[test]
    fn empty_or_whitespace_key_is_rejected_without_writing() {
        let (path, _root) = auth_path();

        let error = set_key(&path, "provider", " \t\n").expect_err("empty key is invalid");
        assert!(matches!(
            error,
            AppError::InvalidProvider { field, .. } if field == "key"
        ));
        assert!(!path.exists());
    }

    #[test]
    fn temp_file_is_created_in_auth_parent_directory() {
        let (path, _root) = auth_path();
        let temp = temp_path(&path);

        assert_eq!(temp.parent(), path.parent());
    }

    #[cfg(unix)]
    #[test]
    fn auth_file_is_written_with_private_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let (path, _root) = auth_path();
        set_key(&path, "provider", TEST_KEY).expect("set key succeeds");

        assert_eq!(
            fs::metadata(&path)
                .expect("auth file exists")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    #[test]
    fn malformed_error_does_not_expose_key_material() {
        let (path, _root) = auth_path();
        fs::create_dir_all(path.parent().expect("auth file has a parent")).expect("parent exists");
        fs::write(&path, format!("{{\"provider\": \"{TEST_KEY}\""))
            .expect("malformed fixture is written");

        let error = has_key(&path, "provider").expect_err("malformed JSON is rejected");
        let display = error.to_string();
        let debug = format!("{error:?}");
        assert!(!display.contains(TEST_KEY));
        assert!(!debug.contains(TEST_KEY));
    }

    #[test]
    fn oauth_entry_counts_as_key_but_has_no_request_key() {
        let (path, _root) = auth_path();
        fs::create_dir_all(path.parent().expect("auth file has a parent")).expect("parent exists");
        fs::write(&path, json!({"provider": {"type": "oauth"}}).to_string())
            .expect("oauth fixture is written");

        assert!(has_key(&path, "provider").expect("oauth entry is present"));
        assert_eq!(
            read_key_for_request(&path, "provider").expect("read key succeeds"),
            None
        );
    }
}
