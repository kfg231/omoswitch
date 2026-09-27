use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    #[error("configuration file is missing: {message}")]
    ConfigMissing { message: String },
    #[error("malformed JSONC at {line}:{col}: {message}")]
    MalformedJsonc { message: String, line: usize, col: usize },
    #[error("duplicate key {key}: {message}")]
    DuplicateKey { message: String, key: String },
    #[error("configuration changed on disk: {message}")]
    ChangedOnDisk { message: String },
    #[error("verification failed: {message}")]
    VerifyFailed { message: String },
    #[error("omo was not found: {message}")]
    OmoNotFound { message: String },
    #[error("omo model list could not be parsed: {message}")]
    OmoListParse { message: String },
    #[error("I/O error: {message}")]
    Io { message: String },
    #[error("profile store is corrupt: {message}")]
    StoreCorrupt { message: String },
    #[error("profile was not found: {message}")]
    ProfileNotFound { message: String },
    #[error("invalid profile field {field}: {message}")]
    InvalidProfile { message: String, field: String },
    #[error("expected an object: {message}")]
    NotAnObject { message: String },
}
