//! Icons compiled into the binary, served to GPUI's `svg()` element. The
//! files are the web app's own icons (Video.js neutral set for the player,
//! lucide for everything else), copied by `tools/extract-icons.ts`.

use std::{
    borrow::Cow,
    cell::RefCell,
    collections::{HashMap, HashSet},
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Result;
use gpui::{
    canvas, img, px, App, AssetSource, ContentMask, Corners, Global, ImageCacheError, Img,
    IntoElement, ObjectFit, RenderImage, SharedString, Styled, Window,
};
use image::{Frame, ImageReader};

include!(concat!(env!("OUT_DIR"), "/icons.rs"));

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        Ok(ICONS
            .iter()
            .find(|(name, _)| *name == path)
            .map(|(_, bytes)| Cow::Borrowed(*bytes)))
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        Ok(ICONS
            .iter()
            .filter(|(name, _)| name.starts_with(path))
            .map(|(name, _)| SharedString::from(*name))
            .collect())
    }
}

pub const MAX_ARTWORK_FILE_BYTES: u64 = 24 * 1024 * 1024;
const ARTWORK_CACHE_BYTES: usize = 64 * 1024 * 1024;
const ARTWORK_CACHE_ENTRIES: usize = 128;
const MAX_ARTWORK_DECODES: usize = 2;

struct CachedArtwork {
    image: Option<Arc<RenderImage>>,
    last_used: u64,
}

#[derive(Default)]
pub struct ArtworkCache(RefCell<ArtworkCacheState>);

impl Global for ArtworkCache {}

#[derive(Default)]
struct ArtworkCacheState {
    images: HashMap<PathBuf, CachedArtwork>,
    loading: HashSet<PathBuf>,
    bytes: usize,
    clock: u64,
}

impl ArtworkCacheState {
    fn reserve(&mut self, path: &Path) -> (Option<Arc<RenderImage>>, bool) {
        self.clock += 1;
        if let Some(entry) = self.images.get_mut(path) {
            entry.last_used = self.clock;
            return (entry.image.clone(), false);
        }
        let start = self.loading.len() < MAX_ARTWORK_DECODES && self.loading.insert(path.into());
        (None, start)
    }

    fn insert(&mut self, path: PathBuf, image: Option<Arc<RenderImage>>, window: &mut Window) {
        self.loading.remove(&path);
        self.clock += 1;
        self.bytes += image
            .as_ref()
            .and_then(|i| i.as_bytes(0))
            .map_or(0, <[u8]>::len);
        self.images.insert(
            path,
            CachedArtwork {
                image,
                last_used: self.clock,
            },
        );
        while self.bytes > ARTWORK_CACHE_BYTES || self.images.len() > ARTWORK_CACHE_ENTRIES {
            let Some(oldest) = self
                .images
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(path, _)| path.clone())
            else {
                break;
            };
            if let Some(image) = self.images.remove(&oldest).and_then(|entry| entry.image) {
                self.bytes -= image.as_bytes(0).map_or(0, <[u8]>::len);
                let _ = window.drop_image(image);
            }
        }
    }
}

fn load_artwork(path: &Path, window: &mut Window, cx: &mut App) -> Option<Arc<RenderImage>> {
    let (image, start) = cx.global::<ArtworkCache>().0.borrow_mut().reserve(path);
    if start {
        let path = path.to_path_buf();
        let decode_path = path.clone();
        let task = cx
            .background_executor()
            .spawn(async move { decode_artwork(&decode_path).ok() });
        let view = window.current_view();
        window
            .spawn(cx, async move |cx| {
                let image = task.await;
                let _ = cx.update(|window, cx| {
                    cx.global::<ArtworkCache>()
                        .0
                        .borrow_mut()
                        .insert(path, image, window);
                    cx.notify(view);
                });
            })
            .detach();
    }
    image
}

fn decode_artwork(path: &Path) -> anyhow::Result<Arc<RenderImage>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_ARTWORK_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(
        bytes.len() as u64 <= MAX_ARTWORK_FILE_BYTES,
        "Artwork file exceeds size limit"
    );
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode()?;
    let mut pixels = if decoded.width().max(decoded.height()) > 1600 {
        decoded.thumbnail(1600, 1600).into_rgba8()
    } else {
        decoded.into_rgba8()
    };
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    Ok(Arc::new(RenderImage::new(vec![Frame::new(pixels)])))
}

/// Artwork with an intrinsic size, such as a title logo.
pub fn artwork_image(path: PathBuf) -> Img {
    img(move |window: &mut Window, cx: &mut App| {
        load_artwork(&path, window, cx).map(Ok::<_, ImageCacheError>)
    })
}

/// Full-size cover. Defer the cache lookup to paint so off-screen cards never
/// queue a decode or upload to the sprite atlas.
pub fn artwork_cover(path: PathBuf, radius: f32) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, _, window, cx| {
            if !window.content_mask().bounds.intersects(&bounds) {
                return;
            }
            if let Some(image) = load_artwork(&path, window, cx) {
                let target = ObjectFit::Cover.get_bounds(bounds, image.size(0));
                window.with_content_mask(Some(ContentMask { bounds }), |window| {
                    let _ = window.paint_image(target, Corners::all(px(radius)), image, 0, false);
                });
            }
        },
    )
    .size_full()
}
