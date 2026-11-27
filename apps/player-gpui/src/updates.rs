use serde_json::Value;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
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
    Failed,
}

pub fn check() -> anyhow::Result<UpdateStatus> {
    let current = version_number(VERSION).ok_or_else(|| anyhow::anyhow!("Invalid app version"))?;
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
            .set("User-Agent", "Plexy-Beta")
            .call()?;
        let more = response
            .header("Link")
            .is_some_and(|link| link.contains("rel=\"next\""));
        let releases: Vec<Value> = serde_json::from_reader(response.into_reader())?;
        for release in releases {
            let Some(tag) = release["tag_name"].as_str() else {
                continue;
            };
            let Some(version) = tag.strip_prefix("plexy-beta-v") else {
                continue;
            };
            let Some(number) = version_number(version) else {
                continue;
            };
            if number <= current || latest.as_ref().is_some_and(|(best, _)| number <= *best) {
                continue;
            }
            let name = format!("Plexy-Beta-{version}-mac-arm64.dmg");
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

fn version_number(version: &str) -> Option<[u64; 3]> {
    let mut parts = version.split('.');
    let number = [
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ];
    parts.next().is_none().then_some(number)
}
