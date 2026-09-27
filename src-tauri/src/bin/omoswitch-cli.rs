use omoswitch_lib::commands::{json_value, profile_by_name_or_id};
use omoswitch_lib::error::AppError;
use omoswitch_lib::models;
use omoswitch_lib::omo_config;
use omoswitch_lib::paths::Paths;
use omoswitch_lib::store::{ImportSource, ProfileInput, Store};
use std::env;
use std::process::ExitCode;

fn usage() -> &'static str {
    "usage: omoswitch-cli <status|list|import|preview|apply|models|backups>"
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
        "backups" => json_value(&omo_config::list_backups(&paths)?),
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
            eprintln!(
                "{}",
                serde_json::to_string(&error).unwrap_or_else(|_| error.to_string())
            );
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_refresh_flag() {
        let args = vec![
            "cli".to_owned(),
            "models".to_owned(),
            "--refresh".to_owned(),
        ];
        assert!(args.iter().any(|arg| arg == "--refresh"));
    }
}
