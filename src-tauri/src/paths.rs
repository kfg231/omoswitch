use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub omo_home: PathBuf,
    pub store_home: PathBuf,
    pub omo_bin: String,
}

impl Paths {
    pub fn resolve() -> Self {
        Self::resolve_with(|key| env::var_os(key))
    }

    pub fn resolve_with<F>(lookup: F) -> Self
    where
        F: Fn(&str) -> Option<std::ffi::OsString>,
    {
        let user_profile = lookup("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let omo_home = lookup("OMOSWITCH_OMO_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| user_profile.join(".omo"));
        let store_home = lookup("OMOSWITCH_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| user_profile.join(".omoswitch"));
        let omo_bin = lookup("OMOSWITCH_OMO_BIN")
            .and_then(|value| value.into_string().ok())
            .unwrap_or_else(|| "omo".to_owned());
        Self {
            omo_home,
            store_home,
            omo_bin,
        }
    }

    pub fn config_path(&self) -> PathBuf {
        self.omo_home.join("omo.jsonc")
    }

    pub fn agent_dir(&self) -> PathBuf {
        self.agent_dir_with(|key| env::var_os(key))
    }

    pub fn models_json_path(&self) -> PathBuf {
        self.models_json_path_with(|key| env::var_os(key))
    }

    pub fn auth_json_path(&self) -> PathBuf {
        self.auth_json_path_with(|key| env::var_os(key))
    }

    fn agent_dir_with<F>(&self, lookup: F) -> PathBuf
    where
        F: Fn(&str) -> Option<std::ffi::OsString>,
    {
        lookup("OMOSWITCH_OMO_AGENT_DIR")
            .or_else(|| lookup("OMO_CODING_AGENT_DIR"))
            .map(PathBuf::from)
            .unwrap_or_else(|| self.omo_home.join("agent"))
    }

    fn models_json_path_with<F>(&self, lookup: F) -> PathBuf
    where
        F: Fn(&str) -> Option<std::ffi::OsString>,
    {
        self.agent_dir_with(lookup).join("models.json")
    }

    fn auth_json_path_with<F>(&self, lookup: F) -> PathBuf
    where
        F: Fn(&str) -> Option<std::ffi::OsString>,
    {
        self.agent_dir_with(lookup).join("auth.json")
    }
}

#[cfg(test)]
mod tests {
    use super::Paths;
    use std::{collections::HashMap, ffi::OsString, path::PathBuf};

    #[test]
    fn resolves_defaults_without_overrides() {
        let values =
            HashMap::from([(String::from("USERPROFILE"), OsString::from("C:/Users/test"))]);
        let paths = Paths::resolve_with(|key| values.get(key).cloned());
        assert_eq!(paths.omo_home, PathBuf::from("C:/Users/test/.omo"));
        assert_eq!(paths.store_home, PathBuf::from("C:/Users/test/.omoswitch"));
        assert_eq!(paths.omo_bin, "omo");
    }

    #[test]
    fn resolves_explicit_overrides() {
        let values = HashMap::from([
            (String::from("USERPROFILE"), OsString::from("C:/Users/test")),
            (String::from("OMOSWITCH_OMO_HOME"), OsString::from("D:/omo")),
            (String::from("OMOSWITCH_HOME"), OsString::from("D:/store")),
            (
                String::from("OMOSWITCH_OMO_BIN"),
                OsString::from("fake-omo"),
            ),
        ]);
        let paths = Paths::resolve_with(|key| values.get(key).cloned());
        assert_eq!(paths.omo_home, PathBuf::from("D:/omo"));
        assert_eq!(paths.store_home, PathBuf::from("D:/store"));
        assert_eq!(paths.omo_bin, "fake-omo");
    }

    #[test]
    fn agent_dir_is_derived_from_omo_home() {
        let values =
            HashMap::from([(String::from("OMOSWITCH_OMO_HOME"), OsString::from("D:/omo"))]);
        let paths = Paths::resolve_with(|key| values.get(key).cloned());
        assert_eq!(
            paths.agent_dir_with(|key| values.get(key).cloned()),
            PathBuf::from("D:/omo/agent")
        );
        assert_eq!(
            paths.models_json_path_with(|key| values.get(key).cloned()),
            PathBuf::from("D:/omo/agent/models.json")
        );
        assert_eq!(
            paths.auth_json_path_with(|key| values.get(key).cloned()),
            PathBuf::from("D:/omo/agent/auth.json")
        );
    }

    #[test]
    fn agent_dir_honors_omo_coding_agent_dir() {
        let values = HashMap::from([
            (String::from("OMOSWITCH_OMO_HOME"), OsString::from("D:/omo")),
            (
                String::from("OMO_CODING_AGENT_DIR"),
                OsString::from("D:/coding-agent"),
            ),
        ]);
        let paths = Paths::resolve_with(|key| values.get(key).cloned());
        assert_eq!(
            paths.agent_dir_with(|key| values.get(key).cloned()),
            PathBuf::from("D:/coding-agent")
        );
    }

    #[test]
    fn omoswitch_agent_dir_wins_over_omo_coding_agent_dir() {
        let values = HashMap::from([
            (
                String::from("OMO_CODING_AGENT_DIR"),
                OsString::from("D:/coding-agent"),
            ),
            (
                String::from("OMOSWITCH_OMO_AGENT_DIR"),
                OsString::from("D:/omoswitch-agent"),
            ),
        ]);
        let paths = Paths::resolve_with(|key| values.get(key).cloned());
        assert_eq!(
            paths.agent_dir_with(|key| values.get(key).cloned()),
            PathBuf::from("D:/omoswitch-agent")
        );
    }

    #[test]
    fn agent_dir_defaults_when_no_environment_overrides_exist() {
        let paths = Paths::resolve_with(|_| None);
        assert_eq!(
            paths.agent_dir_with(|_| None),
            PathBuf::from("./.omo/agent")
        );
    }
}
