use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

pub fn version() -> &'static str {
    crate::variant::current().version()
}

const RELEASES_API: &str = "https://api.github.com/repos/Swastikdan/plexy/releases";
const DOWNLOADS: &str = "https://github.com/Swastikdan/plexy/releases/download";

#[derive(Clone, Default)]
pub enum UpdateStatus {
    #[default]
    Idle,
    Checking,
    Current,
    Available {
        version: String,
        download: String,
    },
    Installing,
    Failed,
}

pub fn check() -> anyhow::Result<UpdateStatus> {
    let variant = crate::variant::current();
    let current = version_number(variant.version())
        .ok_or_else(|| anyhow::anyhow!("Invalid app version"))?;
    if let Ok(feed) = std::env::var("PLEXY_UPDATE_FEED") {
        if !feed.trim().is_empty() {
            return feed_status(&feed, current);
        }
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .build();
    let mut latest = None;
    for page in 1.. {
        let response = agent
            .get(RELEASES_API)
            .query("per_page", "100")
            .query("page", &page.to_string())
            .set("Accept", "application/vnd.github+json")
            .set("User-Agent", variant.user_agent())
            .call()?;
        let more = response
            .header("Link")
            .is_some_and(|link| link.contains("rel=\"next\""));
        let releases: Vec<Value> = serde_json::from_str(&response.into_string()?)?;
        for release in releases {
            let Some(tag) = release["tag_name"].as_str() else {
                continue;
            };
            let Some(version) = tag.strip_prefix(variant.tag_prefix()) else {
                continue;
            };
            let Some(number) = version_number(version) else {
                continue;
            };
            if number <= current || latest.as_ref().is_some_and(|(best, _)| number <= *best) {
                continue;
            }
            let name = format!("{}-{version}-mac-arm64.dmg", variant.asset_prefix());
            let download = format!("{DOWNLOADS}/{tag}/{name}");
            let published = release["draft"] == false
                && release["assets"].as_array().is_some_and(|assets| {
                    assets
                        .iter()
                        .any(|asset| asset["browser_download_url"] == download)
                });
            if published {
                latest = Some((
                    number,
                    UpdateStatus::Available {
                        version: version.into(),
                        download,
                    },
                ));
            }
        }
        if !more {
            break;
        }
    }
    Ok(latest
        .map(|(_, status)| status)
        .unwrap_or(UpdateStatus::Current))
}

fn feed_status(feed: &str, current: [u64; 3]) -> anyhow::Result<UpdateStatus> {
    let text = if let Some(path) = local_path(feed) {
        std::fs::read_to_string(path)?
    } else {
        ureq::get(feed)
            .set("User-Agent", crate::variant::current().user_agent())
            .call()?
            .into_string()?
    };
    let value: Value = serde_json::from_str(&text)?;
    let version = value["version"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("The update feed has no version."))?;
    let download = value["download"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("The update feed has no download URL."))?;
    let number = version_number(version)
        .ok_or_else(|| anyhow::anyhow!("The update feed has an invalid version."))?;
    if number <= current {
        return Ok(UpdateStatus::Current);
    }
    Ok(UpdateStatus::Available {
        version: version.to_string(),
        download: download.to_string(),
    })
}

fn version_number(version: &str) -> Option<[u64; 3]> {
    let mut parts = version.split('.');
    let number = [
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ];
    parts.next().is_none().then_some(number)
}

fn local_path(value: &str) -> Option<PathBuf> {
    if let Some(rest) = value.strip_prefix("file://") {
        return Some(PathBuf::from(rest));
    }
    let path = PathBuf::from(value);
    (!value.contains("://") && path.is_absolute()).then_some(path)
}

/// Locates the running `.app` bundle so the helper can replace it after exit.
pub fn app_bundle() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let app = executable.parent()?.parent()?.parent()?;
    (app.extension().is_some_and(|extension| extension == "app"))
        .then(|| app.to_path_buf())
}

const UPDATE_SCRIPT: &str = r#"#!/bin/bash
set -euo pipefail
dmg="$1"
target="$2"
pid="$3"
app_name="$4"
tmp="$(mktemp -d)"
mount="$tmp/mnt"
mkdir -p "$mount"
mounted=0
cleanup() { if [ "$mounted" = 1 ]; then hdiutil detach "$mount" -force >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
mounted=1
source_app="$mount/$app_name.app"
new_app="$tmp/$app_name.app"
ditto "$source_app" "$new_app"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
hdiutil detach "$mount" -force >/dev/null 2>&1 || true
mounted=0
previous="$target.previous"
rm -rf "$previous"
mv "$target" "$previous"
ditto "$new_app" "$target"
xattr -dr com.apple.quarantine "$target" >/dev/null 2>&1 || true
open "$target"
rm -rf "$previous" "$tmp"
"#;

/// Downloads a release DMG and starts a detached helper that waits for this
/// process to exit, replaces the bundle, and relaunches the new app.
pub fn install(download: &str) -> anyhow::Result<PathBuf> {
    let app = app_bundle().ok_or_else(|| anyhow::anyhow!("The app bundle could not be located."))?;
    let app_name = crate::variant::current().name();
    let temp = std::env::temp_dir().join(format!("plexy-update-{}", std::process::id()));
    std::fs::create_dir_all(&temp)?;
    let dmg = temp.join("update.dmg");
    download_to(download, &dmg)?;
    let script = temp.join("install-update.sh");
    std::fs::write(&script, UPDATE_SCRIPT)?;
    Command::new("/bin/bash")
        .arg(&script)
        .arg(&dmg)
        .arg(&app)
        .arg(std::process::id().to_string())
        .arg(app_name)
        .spawn()?;
    Ok(script)
}

fn download_to(source: &str, destination: &Path) -> anyhow::Result<()> {
    if let Some(path) = local_path(source) {
        std::fs::copy(path, destination)?;
        return Ok(());
    }
    if !source.starts_with("http://") && !source.starts_with("https://") {
        anyhow::bail!("The update URL is not a file or HTTP address.");
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout_read(std::time::Duration::from_secs(120))
        .build();
    let response = agent.get(source).call()?;
    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(destination)?;
    std::io::copy(&mut reader, &mut file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_three_numbers() {
        assert_eq!(version_number("1.2.3"), Some([1, 2, 3]));
        assert_eq!(version_number("1.2"), None);
        assert_eq!(version_number("1.2.3.4"), None);
        assert!(version_number("1.2.3") > version_number("1.1.9"));
    }

    #[test]
    fn local_feed_offers_a_newer_dmg() {
        let dir = tempfile::tempdir().expect("tempdir");
        let feed = dir.path().join("feed.json");
        std::fs::write(
            &feed,
            r#"{"version":"1.2.0","download":"/tmp/Plexy-1.2.0-mac-arm64.dmg"}"#,
        )
        .expect("feed");
        match feed_status(feed.to_str().unwrap(), [1, 1, 0]).expect("status") {
            UpdateStatus::Available { version, download } => {
                assert_eq!(version, "1.2.0");
                assert_eq!(download, "/tmp/Plexy-1.2.0-mac-arm64.dmg");
            }
            _ => panic!("expected an available update"),
        }
        assert!(matches!(
            feed_status(feed.to_str().unwrap(), [1, 2, 0]).expect("status"),
            UpdateStatus::Current
        ));
    }
}
