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
        Self { omo_home, store_home, omo_bin }
    }

    pub fn config_path(&self) -> PathBuf { self.omo_home.join("omo.jsonc") }
}

#[cfg(test)]
mod tests {
    use super::Paths;
    use std::{collections::HashMap, ffi::OsString, path::PathBuf};

    #[test]
    fn resolves_defaults_without_overrides() {
        let values = HashMap::from([(String::from("USERPROFILE"), OsString::from("C:/Users/test"))]);
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
            (String::from("OMOSWITCH_OMO_BIN"), OsString::from("fake-omo")),
        ]);
        let paths = Paths::resolve_with(|key| values.get(key).cloned());
        assert_eq!(paths.omo_home, PathBuf::from("D:/omo"));
        assert_eq!(paths.store_home, PathBuf::from("D:/store"));
        assert_eq!(paths.omo_bin, "fake-omo");
    }
}
