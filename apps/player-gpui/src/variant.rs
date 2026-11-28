//! Native Mac app variants.
//!
//! One executable is packaged into two bundles: the Beta preview and the
//! stable Plexy client. The bundle path selects the variant, so a local build
//! still behaves like Beta while the stable bundle has its own identity and
//! data directory. `PLEXY_APP_VARIANT` overrides detection for development.

use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppVariant {
    Beta,
    Plexy,
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
            _ => {}
        }
        let executable = std::env::current_exe().unwrap_or_default();
        let path = executable.to_string_lossy();
        if path.contains("/Plexy.app/") {
            Self::Plexy
        } else {
            Self::Beta
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Beta => "Plexy Beta",
            Self::Plexy => "Plexy",
        }
    }

    pub fn bundle_id(self) -> &'static str {
        match self {
            Self::Beta => "com.plexy.beta",
            Self::Plexy => "com.plexy.desktop",
        }
    }

    pub fn version(self) -> &'static str {
        match self {
            Self::Beta => env!("CARGO_PKG_VERSION"),
            Self::Plexy => "1.1.0",
        }
    }

    /// Directory below `~/Library/Application Support`.
    pub fn data_subdir(self) -> PathBuf {
        match self {
            Self::Beta => PathBuf::from("Plexy Player"),
            // Keep the native catalog separate from the standalone Plexy
            // Server store in the parent directory.
            Self::Plexy => PathBuf::from("Plexy").join("Player"),
        }
    }

    /// The stable client can connect to an external Plexy Server.
    pub fn supports_server(self) -> bool {
        matches!(self, Self::Plexy)
    }

    pub fn tag_prefix(self) -> &'static str {
        match self {
            Self::Beta => "plexy-beta-v",
            Self::Plexy => "plexy-v",
        }
    }

    pub fn asset_prefix(self) -> &'static str {
        match self {
            Self::Beta => "Plexy-Beta",
            Self::Plexy => "Plexy",
        }
    }

    pub fn user_agent(self) -> &'static str {
        match self {
            Self::Beta => "Plexy-Beta",
            Self::Plexy => "Plexy",
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
    fn stable_client_has_its_own_identity_and_data() {
        assert_eq!(AppVariant::Plexy.name(), "Plexy");
        assert_eq!(AppVariant::Plexy.bundle_id(), "com.plexy.desktop");
        assert_eq!(AppVariant::Plexy.version(), "1.1.0");
        assert!(AppVariant::Plexy.supports_server());
        assert_ne!(AppVariant::Plexy.data_subdir(), AppVariant::Beta.data_subdir());
    }
}
