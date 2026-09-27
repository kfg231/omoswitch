use crate::error::AppError;
use crate::paths::Paths;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub context: Option<String>,
    #[serde(rename = "maxOut")]
    pub max_out: Option<String>,
    pub thinking: bool,
    pub images: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelsCache {
    fetched_at: String,
    models: Vec<ModelInfo>,
}

fn split_columns(line: &str) -> Vec<&str> {
    let columns: Vec<_> = line
        .split("  ")
        .map(str::trim)
        .filter(|column| !column.is_empty())
        .collect();
    if columns.len() >= 6 {
        columns
    } else {
        line.split_whitespace().collect()
    }
}

fn optional_value(value: &str) -> Option<String> {
    match value.trim() {
        "" | "-" | "—" => None,
        value => Some(value.to_owned()),
    }
}

fn flag(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "yes" | "true" | "✓"
    )
}

pub fn parse_list_models(stdout: &str) -> Result<Vec<ModelInfo>, AppError> {
    let mut lines = stdout.lines();
    if !lines.by_ref().any(|line| {
        line.split_whitespace().eq([
            "provider", "model", "context", "max-out", "thinking", "images",
        ])
    }) {
        return Err(AppError::OmoListParse {
            message: "model list header is missing".to_owned(),
        });
    }
    let models: Vec<_> = lines
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || trimmed
                    .chars()
                    .all(|character| character == '-' || character.is_whitespace())
            {
                return None;
            }
            let columns = split_columns(trimmed);
            if columns.len() < 6 || columns[0] == "provider" {
                return None;
            }
            let provider = columns[0].to_owned();
            let model = columns[1].to_owned();
            Some(ModelInfo {
                id: format!("{provider}/{model}"),
                provider,
                model,
                context: optional_value(columns[2]),
                max_out: optional_value(columns[3]),
                thinking: flag(columns[4]),
                images: flag(columns[5]),
            })
        })
        .collect();
    if models.is_empty() {
        Err(AppError::OmoListParse {
            message: "model list contains no rows".to_owned(),
        })
    } else {
        Ok(models)
    }
}

fn io_error(error: std::io::Error) -> AppError {
    AppError::Io {
        message: error.to_string(),
    }
}

fn run_process(bin: String) -> Result<String, AppError> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let result = (|| {
            let mut command = Command::new(bin);
            command
                .args(["--list-models"])
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            #[cfg(windows)]
            std::os::windows::process::CommandExt::creation_flags(&mut command, 0x08000000);
            let mut child = command.spawn().map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    AppError::OmoNotFound {
                        message: error.to_string(),
                    }
                } else {
                    io_error(error)
                }
            })?;
            let stdout = child.stdout.take().ok_or_else(|| AppError::OmoListParse {
                message: "omo stdout was unavailable".to_owned(),
            })?;
            let reader = thread::spawn(move || {
                let mut output = String::new();
                let mut stdout = stdout;
                let result = stdout.read_to_string(&mut output);
                (result, output)
            });
            let deadline = Instant::now() + Duration::from_secs(20);
            loop {
                match child.try_wait().map_err(io_error)? {
                    Some(status) => {
                        let (read_result, output) =
                            reader.join().map_err(|_| AppError::OmoListParse {
                                message: "omo output reader stopped unexpectedly".to_owned(),
                            })?;
                        read_result.map_err(io_error)?;
                        if !status.success() {
                            return Err(AppError::OmoListParse {
                                message: format!("omo exited with {status}"),
                            });
                        }
                        return Ok(output);
                    }
                    None if Instant::now() >= deadline => {
                        child.kill().map_err(io_error)?;
                        let _ = reader.join();
                        return Err(AppError::OmoListParse {
                            message: "omo --list-models timed out".to_owned(),
                        });
                    }
                    None => thread::sleep(Duration::from_millis(25)),
                }
            }
        })();
        let _ = sender.send(result);
    });
    receiver.recv().map_err(|_| AppError::OmoListParse {
        message: "omo runner stopped unexpectedly".to_owned(),
    })?
}

pub fn run_list_models(paths: &Paths) -> Result<Vec<ModelInfo>, AppError> {
    parse_list_models(&run_process(paths.omo_bin.clone())?)
}
fn cache_path(paths: &Paths) -> std::path::PathBuf {
    paths.store_home.join("models-cache.json")
}
fn read_cache(paths: &Paths) -> Result<Vec<ModelInfo>, AppError> {
    let cache: ModelsCache = serde_json::from_str(
        &fs::read_to_string(cache_path(paths)).map_err(io_error)?,
    )
    .map_err(|error| AppError::StoreCorrupt {
        message: error.to_string(),
    })?;
    if cache.models.is_empty() {
        return Err(AppError::StoreCorrupt {
            message: "model cache is empty".to_owned(),
        });
    }
    Ok(cache.models)
}
fn write_cache(paths: &Paths, models: &[ModelInfo]) -> Result<(), AppError> {
    fs::create_dir_all(&paths.store_home).map_err(io_error)?;
    let cache = ModelsCache {
        fetched_at: Utc::now().to_rfc3339(),
        models: models.to_owned(),
    };
    fs::write(
        cache_path(paths),
        serde_json::to_vec_pretty(&cache).map_err(|error| AppError::Io {
            message: error.to_string(),
        })?,
    )
    .map_err(io_error)
}
pub fn list_models(paths: &Paths, refresh: bool) -> Result<Vec<ModelInfo>, AppError> {
    if !refresh {
        if let Ok(models) = read_cache(paths) {
            return Ok(models);
        }
    }
    match run_list_models(paths) {
        Ok(models) => {
            write_cache(paths, &models)?;
            Ok(models)
        }
        Err(error) => read_cache(paths).or(Err(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn paths(root: &std::path::Path, bin: &str) -> Paths {
        Paths {
            omo_home: root.join("omo"),
            store_home: root.join("store"),
            omo_bin: bin.to_owned(),
        }
    }
    #[test]
    fn parses_fixture_rows_and_fields() {
        let models = parse_list_models(include_str!("../tests/fixtures/list_models.txt"))
            .expect("fixture parses");
        assert!(!models.is_empty());
        assert_eq!(models[0].id, "alibaba-token-plan/deepseek-v3.2");
        assert_eq!(models[0].context.as_deref(), Some("131.1K"));
        assert!(models[0].thinking);
        assert!(!models[0].images);
    }
    #[test]
    fn rejects_garbage_without_header() {
        assert!(matches!(
            parse_list_models("garbage"),
            Err(AppError::OmoListParse { .. })
        ));
    }
    #[test]
    fn missing_binary_is_omo_not_found() {
        let root = tempfile::tempdir().expect("tempdir");
        assert!(matches!(
            run_list_models(&paths(root.path(), "definitely-missing-omo")),
            Err(AppError::OmoNotFound { .. })
        ));
    }
    #[test]
    fn cache_round_trip_and_fallback() {
        let root = tempfile::tempdir().expect("tempdir");
        let paths = paths(root.path(), "definitely-missing-omo");
        let models = vec![ModelInfo {
            id: "p/m".to_owned(),
            provider: "p".to_owned(),
            model: "m".to_owned(),
            context: None,
            max_out: Some("1K".to_owned()),
            thinking: true,
            images: false,
        }];
        write_cache(&paths, &models).expect("write cache");
        assert_eq!(list_models(&paths, false).expect("read cache"), models);
        assert_eq!(list_models(&paths, true).expect("fallback cache"), models);
    }
}
