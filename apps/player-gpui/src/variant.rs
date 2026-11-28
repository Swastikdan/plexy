//! Build variants of the native Mac app.
//!
//! One executable is packaged into three bundles. The bundle path selects the
//! variant, so a local build still behaves like the Beta preview while the two
//! stable bundles stay independent. `PLEXY_APP_VARIANT` overrides detection
//! for development and tests.

use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppVariant {
    Beta,
    Plexy,
    Local,
}

impl AppVariant {
    pub fn detect() -> Self {
        match std::env::var("PLEXY_APP_VARIANT")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "beta" => return Self::Beta,
            "plexy" | "unified" => return Self::Plexy,
            "local" => return Self::Local,
            _ => {}
        }
        let executable = std::env::current_exe().unwrap_or_default();
        let path = executable.to_string_lossy();
        if path.contains("/Plexy Local.app/") {
            Self::Local
        } else if path.contains("/Plexy.app/") {
            Self::Plexy
        } else {
            Self::Beta
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Beta => "Plexy Beta",
            Self::Plexy => "Plexy",
            Self::Local => "Plexy Local",
        }
    }

    pub fn bundle_id(self) -> &'static str {
        match self {
            Self::Beta => "com.plexy.beta",
            Self::Plexy => "com.plexy.desktop",
            Self::Local => "com.plexy.local",
        }
    }

    pub fn version(self) -> &'static str {
        match self {
            Self::Beta => env!("CARGO_PKG_VERSION"),
            Self::Plexy => "1.1.0",
            Self::Local => "1.0.0",
        }
    }

    /// Directory below `~/Library/Application Support`.
    pub fn data_subdir(self) -> PathBuf {
        match self {
            Self::Beta => PathBuf::from("Plexy Player"),
            // Keep the native catalog separate from the hosted server's
            // library.sqlite in the parent directory.
            Self::Plexy => PathBuf::from("Plexy").join("Player"),
            Self::Local => PathBuf::from("Plexy Local"),
        }
    }

    /// The hosted Plexy Server store, shared with the Electron app.
    pub fn server_data_subdir(self) -> Option<PathBuf> {
        match self {
            Self::Plexy => Some(PathBuf::from("Plexy")),
            _ => None,
        }
    }

    pub fn supports_server(self) -> bool {
        matches!(self, Self::Plexy)
    }

    pub fn supports_hosting(self) -> bool {
        matches!(self, Self::Plexy)
    }

    pub fn tag_prefix(self) -> &'static str {
        match self {
            Self::Beta => "plexy-beta-v",
            Self::Plexy => "plexy-v",
            Self::Local => "plexy-local-v",
        }
    }

    pub fn asset_prefix(self) -> &'static str {
        match self {
            Self::Beta => "Plexy-Beta",
            Self::Plexy => "Plexy",
            Self::Local => "Plexy-Local",
        }
    }

    pub fn user_agent(self) -> &'static str {
        match self {
            Self::Beta => "Plexy-Beta",
            Self::Plexy => "Plexy",
            Self::Local => "Plexy-Local",
        }
    }
}

pub fn current() -> AppVariant {
    AppVariant::detect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_variants_have_distinct_identities() {
        assert_eq!(AppVariant::Plexy.name(), "Plexy");
        assert_eq!(AppVariant::Plexy.bundle_id(), "com.plexy.desktop");
        assert_eq!(AppVariant::Local.name(), "Plexy Local");
        assert_eq!(AppVariant::Local.bundle_id(), "com.plexy.local");
        assert_ne!(AppVariant::Plexy.data_subdir(), AppVariant::Local.data_subdir());
        assert!(AppVariant::Plexy.supports_hosting());
        assert!(!AppVariant::Local.supports_server());
    }
}
