use crate::error::AppError;
use crate::paths::Paths;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::PathBuf;

const BUILTIN_AGENTS: &[&str] = &[
    "explore",
    "librarian",
    "plan-consultant",
    "plan-reviewer",
    "omo-native-code-reviewer",
    "omo-native-qa-executor",
    "omo-native-gate-reviewer",
];
const BUILTIN_CATEGORIES: &[&str] = &[
    "visual-engineering",
    "ultrabrain",
    "deep-low",
    "deep-high",
    "artistry",
    "quick",
    "architect",
    "unspecified-low",
    "unspecified-high",
    "writing",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCatalog {
    pub agents: Vec<String>,
    pub categories: Vec<String>,
    pub source: CatalogSource,
    pub omo_version: Option<String>,
    pub fetched_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CatalogSource {
    Installed,
    Cache,
    Builtin,
}

#[derive(Debug, Clone, Copy)]
enum CatalogFailure {
    PackageNotFound,
    PackageUnreadable,
    PackageMalformed,
    CacheWrite,
}

impl CatalogFailure {
    fn message(self) -> &'static str {
        match self {
            Self::PackageNotFound => "installed omo-ai package was not found",
            Self::PackageUnreadable => "installed omo-ai package could not be read",
            Self::PackageMalformed => "installed omo-ai package could not be parsed",
            Self::CacheWrite => "native catalog cache could not be written",
        }
    }
}

fn builtin_catalog() -> NativeCatalog {
    NativeCatalog {
        agents: BUILTIN_AGENTS
            .iter()
            .map(|name| (*name).to_owned())
            .collect(),
        categories: BUILTIN_CATEGORIES
            .iter()
            .map(|name| (*name).to_owned())
            .collect(),
        source: CatalogSource::Builtin,
        omo_version: None,
        fetched_at: None,
    }
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(character) if character.is_ascii_lowercase() || character.is_ascii_digit())
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn valid_lists(agents: &[String], categories: &[String]) -> bool {
    !agents.is_empty()
        && !categories.is_empty()
        && agents.iter().all(|name| valid_name(name))
        && categories.iter().all(|name| valid_name(name))
}

fn parse_agents(source: &str) -> Result<Vec<String>, ()> {
    let marker = "NATIVE_AGENT_NAMES = [";
    let start = source.find(marker).ok_or(())? + marker.len();
    let end = source[start..].find(']').ok_or(())? + start;
    let body = &source[start..end];
    let mut names = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = body[cursor..].find('"') {
        let quote_start = cursor + relative_start;
        let after_quote = &body[quote_start + 1..];
        let quote_end = after_quote.find('"').ok_or(())?;
        names.push(after_quote[..quote_end].to_owned());
        cursor = quote_start + quote_end + 2;
    }
    if valid_lists(&names, &[String::from("catalog")]) {
        Ok(names)
    } else {
        Err(())
    }
}

fn parse_categories(source: &str) -> Result<Vec<String>, ()> {
    let prefix = "{name:\"";
    let suffix = "\",config:{";
    let mut categories = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = source[cursor..].find(prefix) {
        let name_start = cursor + relative_start + prefix.len();
        let remainder = &source[name_start..];
        let quote_end = remainder.find('"').ok_or(())?;
        let name = &remainder[..quote_end];
        if remainder[quote_end..].starts_with(suffix) {
            if !valid_name(name) {
                return Err(());
            }
            if !categories.iter().any(|existing| existing == name) {
                categories.push(name.to_owned());
            }
        }
        cursor = name_start + quote_end + 1;
    }
    if categories.is_empty() {
        Err(())
    } else {
        Ok(categories)
    }
}

fn package_dir_with<F>(lookup: F) -> Option<PathBuf>
where
    F: Fn(&str) -> Option<OsString>,
{
    let user_profile = lookup("USERPROFILE").map(PathBuf::from);
    let app_data = lookup("APPDATA").map(PathBuf::from);
    let candidates = [
        lookup("OMOSWITCH_OMO_PACKAGE_DIR").map(PathBuf::from),
        user_profile.map(|path| {
            path.join(".bun")
                .join("install")
                .join("global")
                .join("node_modules")
                .join("omo-ai")
        }),
        app_data.map(|path| path.join("npm").join("node_modules").join("omo-ai")),
    ];
    candidates.into_iter().flatten().find(|path| path.is_dir())
}

#[derive(Deserialize)]
struct PackageMetadata {
    version: String,
}

fn cache_path(paths: &Paths) -> PathBuf {
    paths.store_home.join("native-catalog.json")
}

fn read_cache(paths: &Paths) -> Result<NativeCatalog, CatalogFailure> {
    let text =
        fs::read_to_string(cache_path(paths)).map_err(|_| CatalogFailure::PackageUnreadable)?;
    let mut catalog: NativeCatalog =
        serde_json::from_str(&text).map_err(|_| CatalogFailure::PackageMalformed)?;
    if !valid_lists(&catalog.agents, &catalog.categories) {
        return Err(CatalogFailure::PackageMalformed);
    }
    catalog.source = CatalogSource::Cache;
    Ok(catalog)
}

fn write_cache(paths: &Paths, catalog: &NativeCatalog) -> Result<(), CatalogFailure> {
    fs::create_dir_all(&paths.store_home).map_err(|_| CatalogFailure::CacheWrite)?;
    let bytes = serde_json::to_vec_pretty(catalog).map_err(|_| CatalogFailure::CacheWrite)?;
    fs::write(cache_path(paths), bytes).map_err(|_| CatalogFailure::CacheWrite)
}

fn load_installed<F>(lookup: &F) -> Result<NativeCatalog, CatalogFailure>
where
    F: Fn(&str) -> Option<OsString>,
{
    let package_dir = package_dir_with(lookup).ok_or(CatalogFailure::PackageNotFound)?;
    let agents_source = fs::read_to_string(
        package_dir
            .join("bin")
            .join("lib")
            .join("setup-opencode-models.js"),
    )
    .map_err(|_| CatalogFailure::PackageUnreadable)?;
    let categories_source = fs::read_to_string(
        package_dir
            .join("plugin")
            .join("extensions")
            .join("omo-task.js"),
    )
    .map_err(|_| CatalogFailure::PackageUnreadable)?;
    let package_source = fs::read_to_string(package_dir.join("package.json"))
        .map_err(|_| CatalogFailure::PackageUnreadable)?;
    let metadata: PackageMetadata =
        serde_json::from_str(&package_source).map_err(|_| CatalogFailure::PackageMalformed)?;
    let agents = parse_agents(&agents_source).map_err(|_| CatalogFailure::PackageMalformed)?;
    let categories =
        parse_categories(&categories_source).map_err(|_| CatalogFailure::PackageMalformed)?;
    Ok(NativeCatalog {
        agents,
        categories,
        source: CatalogSource::Installed,
        omo_version: Some(metadata.version),
        fetched_at: Some(Utc::now().to_rfc3339()),
    })
}

fn get_catalog_with_lookup<F>(
    paths: &Paths,
    refresh: bool,
    lookup: F,
) -> Result<NativeCatalog, AppError>
where
    F: Fn(&str) -> Option<OsString>,
{
    if !refresh {
        if let Ok(catalog) = read_cache(paths) {
            return Ok(catalog);
        }
    }
    match load_installed(&lookup).and_then(|catalog| write_cache(paths, &catalog).map(|()| catalog))
    {
        Ok(catalog) => Ok(catalog),
        Err(_error) if !refresh => Ok(builtin_catalog()),
        Err(error) => Err(AppError::Io {
            message: error.message().to_owned(),
        }),
    }
}

pub fn get_catalog(paths: &Paths, refresh: bool) -> Result<NativeCatalog, AppError> {
    get_catalog_with_lookup(paths, refresh, |key| env::var_os(key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::Path;

    fn paths(root: &Path) -> Paths {
        Paths {
            omo_home: root.join("omo"),
            store_home: root.join("store"),
            omo_bin: "omo".to_owned(),
        }
    }

    fn package(root: &Path, agents: &str, categories: &str) -> PathBuf {
        let package = root.join("omo-ai");
        fs::create_dir_all(package.join("bin/lib")).expect("agent directory");
        fs::create_dir_all(package.join("plugin/extensions")).expect("category directory");
        fs::write(package.join("bin/lib/setup-opencode-models.js"), agents).expect("agents");
        fs::write(package.join("plugin/extensions/omo-task.js"), categories).expect("categories");
        fs::write(package.join("package.json"), r#"{"version":"5.0.1"}"#).expect("package");
        package
    }

    #[test]
    fn parses_agents_fixture() {
        let names =
            parse_agents(include_str!("../tests/fixtures/catalog_agents.js")).expect("agents");
        assert_eq!(names, ["explore", "librarian", "plan-consultant"]);
    }

    #[test]
    fn parses_categories_fixture_in_order_without_duplicates() {
        let names = parse_categories(include_str!("../tests/fixtures/catalog_categories.js"))
            .expect("categories");
        assert_eq!(names, ["quick", "deep-low", "writing"]);
    }

    #[test]
    fn refresh_without_package_returns_io_error() {
        let root = tempfile::tempdir().expect("tempdir");
        let result = get_catalog_with_lookup(&paths(root.path()), true, |_| None);
        assert!(matches!(result, Err(AppError::Io { .. })));
    }

    #[test]
    fn missing_cache_and_package_fall_back_to_builtin() {
        let root = tempfile::tempdir().expect("tempdir");
        let result =
            get_catalog_with_lookup(&paths(root.path()), false, |_| None).expect("builtin");
        assert_eq!(result.source, CatalogSource::Builtin);
        assert_eq!(result.agents.len(), BUILTIN_AGENTS.len());
        assert_eq!(result.categories.len(), BUILTIN_CATEGORIES.len());
    }

    #[test]
    fn refresh_writes_cache_and_cache_read_preserves_lists() {
        let root = tempfile::tempdir().expect("tempdir");
        let agents = include_str!("../tests/fixtures/catalog_agents.js");
        let categories = include_str!("../tests/fixtures/catalog_categories.js");
        let package = package(root.path(), agents, categories);
        let lookup = |key: &str| {
            (key == "OMOSWITCH_OMO_PACKAGE_DIR").then(|| package.clone().into_os_string())
        };
        let installed =
            get_catalog_with_lookup(&paths(root.path()), true, lookup).expect("installed");
        let cached = get_catalog_with_lookup(&paths(root.path()), false, |_| None).expect("cache");
        assert_eq!(installed.source, CatalogSource::Installed);
        assert_eq!(cached.source, CatalogSource::Cache);
        assert_eq!(cached.agents, installed.agents);
        assert_eq!(cached.categories, installed.categories);
        assert_eq!(installed.omo_version.as_deref(), Some("5.0.1"));
        assert!(installed.fetched_at.is_some());
    }

    #[test]
    fn invalid_category_name_is_a_parse_failure() {
        let source = include_str!("../tests/fixtures/catalog_invalid.js");
        assert!(parse_categories(source).is_err());
    }

    #[test]
    fn package_override_wins_over_default_locations() {
        let root = tempfile::tempdir().expect("tempdir");
        let override_dir = package(
            root.path(),
            include_str!("../tests/fixtures/catalog_agents.js"),
            include_str!("../tests/fixtures/catalog_categories.js"),
        );
        let user_profile = root.path().join("user");
        fs::create_dir_all(user_profile.join(".bun/install/global/node_modules/omo-ai"))
            .expect("default package");
        let values = HashMap::from([
            (
                "OMOSWITCH_OMO_PACKAGE_DIR",
                override_dir.clone().into_os_string(),
            ),
            ("USERPROFILE", user_profile.into_os_string()),
        ]);
        assert_eq!(
            package_dir_with(|key| values.get(key).cloned()),
            Some(override_dir)
        );
    }
}
