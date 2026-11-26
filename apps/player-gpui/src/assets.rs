//! Icons compiled into the binary, served to GPUI's `svg()` element. The
//! files are the web app's own icons (Video.js neutral set for the player,
//! lucide for everything else), copied by `tools/extract-icons.ts`.

use std::borrow::Cow;

use anyhow::Result;
use gpui::{AssetSource, SharedString};

include!(concat!(env!("OUT_DIR"), "/icons.rs"));

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        Ok(ICONS.iter().find(|(name, _)| *name == path).map(|(_, bytes)| Cow::Borrowed(*bytes)))
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        Ok(ICONS.iter().filter(|(name, _)| name.starts_with(path)).map(|(name, _)| SharedString::from(*name)).collect())
    }
}
