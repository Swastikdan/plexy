//! Icons compiled into the binary, served to GPUI's `svg()` element. The
//! files are the web app's own icons (Video.js neutral set for the player,
//! lucide for everything else), copied by `tools/extract-icons.ts`.

use std::{
    borrow::Cow,
    cell::RefCell,
    collections::{HashMap, HashSet},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Result;
use gpui_kit::{
    canvas, img, px, App, AssetSource, Corners, Global, ImageCacheError, Img,
    IntoElement, ObjectFit, RenderImage, SharedString, Styled, Window,
};
use image::{Frame, RgbaImage};

include!(concat!(env!("OUT_DIR"), "/icons.rs"));

pub struct Assets;

impl AssetSource for Assets {
    /// Plexy's icons first, then GPUI Kit's (select carets, check marks and
    /// the other icons Kit components draw).
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        match ICONS.iter().find(|(name, _)| *name == path) {
            Some((_, bytes)) => Ok(Some(Cow::Borrowed(*bytes))),
            None => gpui_kit::assets::Assets.load(path),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut names: Vec<SharedString> = ICONS
            .iter()
            .filter(|(name, _)| name.starts_with(path))
            .map(|(name, _)| SharedString::from(*name))
            .collect();
        names.extend(gpui_kit::assets::Assets.list(path)?);
        Ok(names)
    }
}

pub const MAX_ARTWORK_FILE_BYTES: u64 = 24 * 1024 * 1024;
const ARTWORK_CACHE_BYTES: usize = 64 * 1024 * 1024;
const ARTWORK_CACHE_ENTRIES: usize = 128;
const MAX_ARTWORK_DECODES: usize = 2;

#[derive(Clone, PartialEq, Eq, Hash)]
struct ArtworkKey {
    path: PathBuf,
    width: u32,
    height: u32,
    cover: bool,
}

impl ArtworkKey {
    fn new(path: &Path, width: f32, height: f32, scale: f32, cover: bool) -> Self {
        // Quantize size to avoid decoding new variants for tiny window and hover changes.
        let pixels = |points: f32| ((points * scale).ceil() as u32).clamp(1, 1600).div_ceil(64) * 64;
        Self { path: path.into(), width: pixels(width), height: pixels(height), cover }
    }
}

struct CachedArtwork {
    image: Option<Arc<RenderImage>>,
    last_used: u64,
}

#[derive(Default)]
pub struct ArtworkCache(RefCell<ArtworkCacheState>);

impl Global for ArtworkCache {}

#[derive(Default)]
struct ArtworkCacheState {
    images: HashMap<ArtworkKey, CachedArtwork>,
    loading: HashSet<ArtworkKey>,
    bytes: usize,
    clock: u64,
    frame_start: u64,
}

impl ArtworkCacheState {
    fn reserve(&mut self, key: &ArtworkKey) -> (Option<Arc<RenderImage>>, bool) {
        self.clock += 1;
        if let Some(entry) = self.images.get_mut(key) {
            entry.last_used = self.clock;
            return (entry.image.clone(), false);
        }
        let start = self.loading.len() < MAX_ARTWORK_DECODES && self.loading.insert(key.clone());
        (None, start)
    }

    fn insert(&mut self, key: ArtworkKey, image: Option<Arc<RenderImage>>) {
        self.loading.remove(&key);
        self.clock += 1;
        self.bytes += image
            .as_ref()
            .and_then(|i| i.as_bytes(0))
            .map_or(0, <[u8]>::len);
        self.images.insert(
            key,
            CachedArtwork {
                image,
                last_used: self.clock,
            },
        );
    }

    fn over_budget(&self) -> bool {
        self.bytes > ARTWORK_CACHE_BYTES || self.images.len() > ARTWORK_CACHE_ENTRIES
    }

    fn trim(&mut self, mut drop_image: impl FnMut(Arc<RenderImage>)) {
        while self.over_budget() {
            // Keep the current frame's artwork and newly decoded images until
            // the next frame has had a chance to use them.
            let Some(oldest) = self
                .images
                .iter()
                .filter(|(_, entry)| entry.last_used <= self.frame_start)
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(path, _)| path.clone())
            else {
                break;
            };
            if let Some(image) = self.images.remove(&oldest).and_then(|entry| entry.image) {
                self.bytes -= image.as_bytes(0).map_or(0, <[u8]>::len);
                drop_image(image);
            }
        }
    }
}

pub fn begin_artwork_frame(window: &Window, cx: &App) {
    let mut cache = cx.global::<ArtworkCache>().0.borrow_mut();
    cache.frame_start = cache.clock;
    if cache.over_budget() {
        // Wait until paint has recorded which images are still in use.
        window.on_next_frame(trim_artwork);
    }
}

fn trim_artwork(window: &mut Window, cx: &mut App) {
    cx.global::<ArtworkCache>().0.borrow_mut().trim(|image| {
        let _ = window.drop_image(image);
    });
}

fn load_artwork(key: ArtworkKey, window: &mut Window, cx: &mut App) -> Option<Arc<RenderImage>> {
    let (image, start) = cx.global::<ArtworkCache>().0.borrow_mut().reserve(&key);
    if start {
        let decode_key = key.clone();
        let task = cx
            .background_executor()
            .spawn(async move { decode_artwork(&decode_key).ok() });
        let view = window.current_view();
        window
            .spawn(cx, async move |cx| {
                let image = task.await;
                let _ = cx.update(|window, cx| {
                    cx.global::<ArtworkCache>()
                        .0
                        .borrow_mut()
                        .insert(key, image);
                    trim_artwork(window, cx);
                    cx.notify(view);
                });
            })
            .detach();
    }
    image
}

extern "C" {
    fn plexy_artwork_thumbnail(
        bytes: *const u8, len: usize, target_width: u32, target_height: u32, cover: bool,
        width: *mut u32, height: *mut u32,
    ) -> *mut u8;
    fn plexy_artwork_free(pixels: *mut u8);
}

fn decode_artwork(key: &ArtworkKey) -> anyhow::Result<Arc<RenderImage>> {
    let mut bytes = Vec::new();
    std::fs::File::open(&key.path)?
        .take(MAX_ARTWORK_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    anyhow::ensure!(
        bytes.len() as u64 <= MAX_ARTWORK_FILE_BYTES,
        "Artwork file exceeds size limit"
    );
    let (mut width, mut height) = (0, 0);
    // The bridge borrows the encoded bytes and returns a malloc-owned BGRA thumbnail.
    let pixels = unsafe {
        plexy_artwork_thumbnail(bytes.as_ptr(), bytes.len(), key.width, key.height, key.cover, &mut width, &mut height)
    };
    anyhow::ensure!(!pixels.is_null(), "Couldn’t decode artwork");
    let pixels = unsafe {
        let data = std::slice::from_raw_parts(pixels, width as usize * height as usize * 4).to_vec();
        plexy_artwork_free(pixels);
        data
    };
    let frame = RgbaImage::from_raw(width, height, pixels).expect("thumbnail dimensions match BGRA buffer");
    Ok(Arc::new(RenderImage::new(vec![Frame::new(frame)])))
}

/// Intrinsically sized artwork, such as a title logo in a bounded frame.
pub fn artwork_image(path: PathBuf, width: f32, height: f32) -> Img {
    img(move |window: &mut Window, cx: &mut App| {
        let key = ArtworkKey::new(&path, width, height, window.scale_factor(), false);
        load_artwork(key, window, cx).map(Ok::<_, ImageCacheError>)
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
            let key = ArtworkKey::new(&path, bounds.size.width.into(), bounds.size.height.into(), window.scale_factor(), true);
            if let Some(image) = load_artwork(key, window, cx) {
                let target = ObjectFit::Cover.get_bounds(bounds, image.size(0));
                // Round at the visible clip, not at the image's own bounds: a
                // hover-grown image is clipped by its frame, and radii applied
                // to the grown bounds would leave the frame's corners square.
                let clip = window.content_mask().bounds.intersect(&bounds);
                let _ = window.paint_image(clip, target, Corners::all(px(radius)), image, 0, false);
            }
        },
    )
    .size_full()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artwork_downsamples_for_retina_card_size_and_preserves_alpha() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("poster.png");
        RgbaImage::from_pixel(1200, 1800, image::Rgba([204, 102, 51, 128])).save(&path).unwrap();

        let key = ArtworkKey::new(&path, 128., 192., 2., true);
        let image = decode_artwork(&key).unwrap();
        assert_eq!(image.size(0).width, gpui_kit::DevicePixels(256));
        assert_eq!(image.size(0).height, gpui_kit::DevicePixels(384));
        let pixel = &image.as_bytes(0).unwrap()[..4];
        for (actual, expected) in pixel.iter().zip([51_u8, 102, 204, 128]) {
            assert!(actual.abs_diff(expected) <= 1, "pixel {pixel:?}");
        }
    }

    #[test]
    fn visible_artwork_survives_cache_pressure_until_it_leaves_the_frame() {
        let still = Arc::new(RenderImage::new(vec![Frame::new(image::RgbaImage::new(
            1600, 900,
        ))]));
        let paths: Vec<_> = (0..12).map(|i| ArtworkKey::new(Path::new(&format!("{i}.jpg")), 800., 450., 2., true)).collect();
        let mut cache = ArtworkCacheState::default();
        for path in &paths[..11] {
            cache.insert(path.clone(), Some(still.clone()));
        }

        cache.frame_start = cache.clock;
        for path in &paths[..11] {
            assert!(cache.reserve(path).0.is_some());
        }
        assert!(cache.reserve(&paths[11]).1);
        cache.insert(paths[11].clone(), Some(still));
        assert!(cache.over_budget());
        cache.trim(|_| panic!("evicted artwork needed for the next frame"));

        cache.frame_start = cache.clock;
        for path in &paths[1..] {
            assert!(cache.reserve(path).0.is_some());
        }
        let mut evicted = 0;
        cache.trim(|_| evicted += 1);
        assert_eq!(evicted, 1);
        assert!(!cache.over_budget());
        assert!(!cache.images.contains_key(&paths[0]));
    }
}
