use omoswitch_lib::catalog;
use omoswitch_lib::commands::{
    error_value, json_value, profile_by_name_or_id, provider_key_for_request,
};
use omoswitch_lib::error::AppError;
use omoswitch_lib::models;
use omoswitch_lib::omo_config;
use omoswitch_lib::paths::Paths;
use omoswitch_lib::providers::{self, ProviderInfo, ProviderInput, ProviderModel, ProvidersResult};
use omoswitch_lib::store::{ImportSource, ProfileInput, Store};
use std::env;
use std::io::Read;
use std::path::PathBuf;
use std::process::ExitCode;

fn usage() -> &'static str {
    "usage: omoswitch-cli <status|list|import|preview|apply|models|catalog|backups|providers|provider-add|provider-enable|provider-disable|provider-key|provider-json|provider-json-set|provider-test|provider-models|providers-import>"
}

fn arg_value(args: &[String], name: &str) -> Result<String, AppError> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
        .ok_or_else(|| AppError::InvalidProfile {
            message: format!("missing {name}"),
            field: name.to_owned(),
        })
}

fn provider_id(args: &[String]) -> Result<&str, AppError> {
    args.get(2)
        .map(String::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| AppError::InvalidProvider {
            message: "missing provider id".to_owned(),
            field: "id".to_owned(),
        })
}

fn provider_models(args: &[String]) -> Result<Vec<ProviderModel>, AppError> {
    let mut models = Vec::new();
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--model" {
            let model_id = args
                .get(index + 1)
                .filter(|value| !value.starts_with('-'))
                .ok_or_else(|| AppError::InvalidProvider {
                    message: "missing model id".to_owned(),
                    field: "model".to_owned(),
                })?;
            models.push(ProviderModel {
                id: model_id.clone(),
                name: None,
                reasoning: None,
                input: None,
                thinking_level_map: None,
                context_window: None,
                max_tokens: None,
                extra: serde_json::Map::new(),
            });
            index += 2;
        } else {
            index += 1;
        }
    }
    Ok(models)
}

fn list_providers(paths: &Paths) -> Result<ProvidersResult, AppError> {
    providers::list(
        paths,
        &models::list_models(paths, false).unwrap_or_default(),
    )
}

fn provider_info(paths: &Paths, id: &str) -> Result<ProviderInfo, AppError> {
    list_providers(paths)?
        .providers
        .into_iter()
        .find(|provider| provider.id == id)
        .ok_or_else(|| AppError::ProviderNotFound {
            message: id.to_owned(),
        })
}

fn opencode_config_path() -> PathBuf {
    let user_profile = env::var_os("USERPROFILE")
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

fn read_stdin_key() -> Result<String, AppError> {
    let mut key = String::new();
    std::io::stdin()
        .read_to_string(&mut key)
        .map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
    Ok(key.trim_end().to_owned())
}

fn read_stdin_json() -> Result<String, AppError> {
    let mut json = String::new();
    std::io::stdin()
        .read_to_string(&mut json)
        .map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
    Ok(json)
}

fn run(args: &[String]) -> Result<String, AppError> {
    let paths = Paths::resolve();
    let command = args
        .get(1)
        .map(String::as_str)
        .ok_or_else(|| AppError::Io {
            message: usage().to_owned(),
        })?;
    match command {
        "status" => {
            let store = Store::load(&paths.store_home)?;
            json_value(&omo_config::status(&paths, &store))
        }
        "list" => json_value(&Store::load(&paths.store_home)?.list()),
        "import" => {
            let source = match arg_value(args, "--from")?.as_str() {
                "opencode" => ImportSource::Opencode,
                "native" => ImportSource::Native,
                value => {
                    return Err(AppError::InvalidProfile {
                        message: format!("unknown source {value}"),
                        field: "--from".to_owned(),
                    })
                }
            };
            let name = arg_value(args, "--name")?;
            let loaded = omo_config::load(&paths)?;
            let result = Store::import_profile(&loaded.value, source, name)?;
            let mut store = Store::load(&paths.store_home)?;
            let profile = store.save(ProfileInput {
                id: None,
                name: result.profile.name.clone(),
                note: result.profile.note.clone(),
                agents: result.profile.agents.clone(),
                categories: result.profile.categories.clone(),
            })?;
            json_value(&omoswitch_import(result, profile))
        }
        "preview" => {
            let store = Store::load(&paths.store_home)?;
            let profile =
                profile_by_name_or_id(&store, args.get(2).map(String::as_str).unwrap_or(""))?;
            json_value(&omo_config::preview(&paths, &store, &profile.id)?)
        }
        "apply" => {
            let mut store = Store::load(&paths.store_home)?;
            let name_or_id = args.get(2).map(String::as_str).unwrap_or("");
            let id = profile_by_name_or_id(&store, name_or_id)?.id.clone();
            json_value(&omo_config::apply(&paths, &mut store, &id, None)?)
        }
        "models" => json_value(&models::list_models(
            &paths,
            args.iter().any(|arg| arg == "--refresh"),
        )?),
        "catalog" => json_value(&catalog::get_catalog(
            &paths,
            args.iter().any(|arg| arg == "--refresh"),
        )?),
        "backups" => json_value(&omo_config::list_backups(&paths)?),
        "providers" => json_value(&list_providers(&paths)?),
        "provider-add" => {
            let id = arg_value(args, "--id")?;
            let name = args
                .windows(2)
                .find(|pair| pair[0] == "--name")
                .map(|pair| pair[1].clone())
                .unwrap_or_else(|| id.clone());
            let input = ProviderInput {
                id: id.clone(),
                name,
                base_url: arg_value(args, "--base-url")?,
                api: arg_value(args, "--api")?,
                models: provider_models(args)?,
                inline_key: false,
            };
            providers::save(&paths, input)?;
            json_value(&provider_info(&paths, &id)?)
        }
        "provider-enable" => {
            let id = provider_id(args)?;
            providers::set_enabled(&paths, id, true)?;
            json_value(&provider_info(&paths, id)?)
        }
        "provider-disable" => {
            let id = provider_id(args)?;
            providers::set_enabled(&paths, id, false)?;
            json_value(&provider_info(&paths, id)?)
        }
        "provider-key" => {
            let id = provider_id(args)?;
            if !args.iter().any(|arg| arg == "--stdin") {
                return Err(AppError::InvalidProvider {
                    message: "key input must use stdin".to_owned(),
                    field: "stdin".to_owned(),
                });
            }
            provider_info(&paths, id)?;
            let key = read_stdin_key()?;
            omoswitch_lib::auth::set_key(&paths.auth_json_path(), id, &key)?;
            json_value(&serde_json::json!({"ok": true, "id": id}))
        }
        "provider-json" => {
            let id = provider_id(args)?;
            providers::provider_json(&paths, id)
        }
        "provider-json-set" => {
            let id = provider_id(args)?;
            if !args.iter().any(|arg| arg == "--stdin") {
                return Err(AppError::InvalidProvider {
                    message: "JSON input must use stdin".to_owned(),
                    field: "stdin".to_owned(),
                });
            }
            providers::save_provider_json(&paths, id, &read_stdin_json()?)?;
            json_value(&provider_info(&paths, id)?)
        }
        "provider-test" => {
            let id = provider_id(args)?;
            let provider = provider_info(&paths, id)?;
            let key = provider_key_for_request(&paths, id)?;
            json_value(&omoswitch_lib::net::probe(
                &provider.base_url,
                key.as_deref(),
            ))
        }
        "provider-models" => {
            let id = provider_id(args)?;
            let provider = provider_info(&paths, id)?;
            let key = provider_key_for_request(&paths, id)?;
            json_value(&omoswitch_lib::net::fetch_models(
                &provider.base_url,
                key.as_deref(),
            )?)
        }
        "providers-import" => json_value(&providers::import_from_opencode(
            &paths,
            &opencode_config_path(),
        )?),
        _ => Err(AppError::Io {
            message: usage().to_owned(),
        }),
    }
}

fn omoswitch_import(
    mut result: omoswitch_lib::store::ImportResult,
    profile: omoswitch_lib::store::Profile,
) -> omoswitch_lib::store::ImportResult {
    result.profile = profile;
    result
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    match run(&args) {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            let output = error_value(&error)
                .unwrap_or_else(|serialization_error| serialization_error.to_string());
            eprintln!("{output}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_refresh_flag() {
        let args = vec![
            "cli".to_owned(),
            "models".to_owned(),
            "--refresh".to_owned(),
        ];
        assert!(args.iter().any(|arg| arg == "--refresh"));
    }

    #[test]
    fn parses_catalog_refresh_flag() {
        let args = vec![
            "cli".to_owned(),
            "catalog".to_owned(),
            "--refresh".to_owned(),
        ];
        assert!(args.iter().any(|arg| arg == "--refresh"));
    }

    #[test]
    fn parses_repeated_provider_models() {
        let args = vec![
            "cli".to_owned(),
            "provider-add".to_owned(),
            "--model".to_owned(),
            "first".to_owned(),
            "--model".to_owned(),
            "second".to_owned(),
        ];
        let models = provider_models(&args).expect("repeated models parse");
        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["first", "second"]
        );
    }
}
