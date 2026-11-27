//! Seek previews generated off the UI thread by a headless libmpv core.
//!
//! Requests are "latest wins": while the pointer sweeps across the seek bar
//! only the most recent position is decoded. Frames are cached per bucket so
//! sweeping back over the same region is instant. Every decoded frame is
//! also saved as a small JPEG under the data directory, keyed by the file's
//! path, size and modification time, so the next session serves it from disk
//! instead of decoding it again.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;

use crate::mpv::{Preview, PreviewFrame};

const BUCKET_SECONDS: f64 = 2.0;
const CACHE_LIMIT: usize = 64;
const CACHE_BYTES: usize = 12 * 1024 * 1024;
const DECODER_IDLE: Duration = Duration::from_secs(15);
const JPEG_QUALITY: u8 = 82;

pub fn bucket(seconds: f64) -> i64 {
    (seconds.max(0.0) / BUCKET_SECONDS).floor() as i64
}

#[derive(Default)]
struct Shared {
    frames: HashMap<i64, Arc<PreviewFrame>>,
    order: VecDeque<i64>,
    bytes: usize,
    pending: Option<i64>,
    in_flight: Option<i64>,
    failed_key: Option<i64>,
    failed: Option<String>,
    generated: u64,
    from_disk: u64,
}

pub struct PreviewService {
    requests: std::cell::OnceCell<SyncSender<()>>,
    libmpv: PathBuf,
    media: PathBuf,
    shared: Arc<Mutex<Shared>>,
}

impl PreviewService {
    pub fn new(libmpv: PathBuf, media: &Path) -> Self {
        Self {
            requests: Default::default(),
            libmpv,
            media: media.to_path_buf(),
            shared: Default::default(),
        }
    }

    /// Returns the cached frame for `seconds`, queueing it if missing.
    pub fn request(&self, seconds: f64) -> Option<Arc<PreviewFrame>> {
        let key = bucket(seconds);
        {
            let mut shared = self.shared.lock();
            if let Some(frame) = shared.frames.get(&key).cloned() {
                shared.pending = None;
                return Some(frame);
            }
            if shared.failed.is_some() || shared.failed_key == Some(key) {
                shared.pending = None;
                return None;
            }
            shared.pending = (shared.in_flight != Some(key)).then_some(key);
        }
        let requests = self.requests.get_or_init(|| {
            let (requests, receiver) = sync_channel(1);
            let shared = self.shared.clone();
            let libmpv = self.libmpv.clone();
            let media = self.media.clone();
            if let Err(error) = std::thread::Builder::new()
                .name("plexy-previews".into())
                .spawn(move || worker(libmpv, media, receiver, shared))
            {
                self.shared.lock().failed = Some(error.to_string());
            }
            requests
        });
        // The channel only wakes the worker. The pending slot always holds the
        // latest position, even when the decoder is busy.
        let _ = requests.try_send(());
        None
    }

    /// The nearest cached frame, shown while the exact one decodes.
    pub fn nearest(&self, seconds: f64) -> Option<Arc<PreviewFrame>> {
        let key = bucket(seconds);
        let shared = self.shared.lock();
        shared
            .frames
            .iter()
            .min_by_key(|(k, _)| (*k - key).abs())
            .filter(|(k, _)| (*k - key).abs() <= 15)
            .map(|(_, frame)| frame.clone())
    }

    pub fn generated(&self) -> u64 {
        self.shared.lock().generated
    }

    /// Frames served from the on-disk cache instead of being decoded.
    pub fn from_disk(&self) -> u64 {
        self.shared.lock().from_disk
    }

    pub fn failure(&self) -> Option<String> {
        self.shared.lock().failed.clone()
    }
}

/// `<data>/previews/<fingerprint>`: one folder per file version, so an
/// edited or replaced file never shows stale frames.
pub fn cache_dir(media: &Path) -> Option<PathBuf> {
    let meta = std::fs::metadata(media).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // FNV-1a: stable across builds, unlike std's hasher.
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in format!("{}\0{}\0{modified}", media.display(), meta.len()).bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Some(crate::catalog::data_dir().join("previews").join(format!("{hash:016x}")))
}

fn load_frame(dir: &Path, key: i64) -> Option<PreviewFrame> {
    let bytes = std::fs::read(dir.join(format!("{key}.jpg"))).ok()?;
    let mut rgba = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).ok()?.to_rgba8();
    for pixel in rgba.pixels_mut() {
        pixel.0.swap(0, 2);
    }
    let (width, height) = rgba.dimensions();
    Some(PreviewFrame { seconds: key as f64 * BUCKET_SECONDS + BUCKET_SECONDS / 2.0, width, height, bgra: rgba.into_raw() })
}

fn save_frame(dir: &Path, key: i64, frame: &PreviewFrame) {
    let rgb: Vec<u8> = frame.bgra.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0]]).collect();
    let mut out = Vec::new();
    let encoded = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .encode(&rgb, frame.width, frame.height, image::ExtendedColorType::Rgb8);
    if encoded.is_err() || std::fs::create_dir_all(dir).is_err() {
        return;
    }
    // Write then rename, so a crash never leaves a truncated frame behind.
    let temp = dir.join(format!("{key}.jpg.tmp"));
    if std::fs::write(&temp, &out).is_ok() {
        let _ = std::fs::rename(&temp, dir.join(format!("{key}.jpg")));
    }
}

fn store(shared: &mut Shared, key: i64, frame: PreviewFrame) {
    shared.bytes += frame.bgra.len();
    shared.frames.insert(key, Arc::new(frame));
    shared.order.push_back(key);
    while shared.order.len() > CACHE_LIMIT || shared.bytes > CACHE_BYTES {
        let oldest = shared.order.pop_front().expect("cached frame");
        let frame = shared.frames.remove(&oldest).expect("cached frame");
        shared.bytes -= frame.bgra.len();
    }
}

fn worker(libmpv: PathBuf, media: PathBuf, receiver: Receiver<()>, shared: Arc<Mutex<Shared>>) {
    let disk = cache_dir(&media);
    let mut decoder = None;
    loop {
        match receiver.recv_timeout(DECODER_IDLE) {
            Ok(()) => {}
            Err(RecvTimeoutError::Timeout) => {
                decoder = None;
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let key = {
            let mut shared = shared.lock();
            let Some(key) = shared.pending.take() else {
                continue;
            };
            shared.in_flight = Some(key);
            key
        };
        if let Some(frame) = disk.as_deref().and_then(|dir| load_frame(dir, key)) {
            let mut shared = shared.lock();
            shared.in_flight = None;
            shared.from_disk += 1;
            store(&mut shared, key, frame);
            continue;
        }
        if decoder.is_none() {
            match Preview::open(&libmpv, &media, 320) {
                Ok(preview) => decoder = Some(preview),
                Err(error) => {
                    shared.lock().failed = Some(error.to_string());
                    return;
                }
            }
        }
        let seconds = key as f64 * BUCKET_SECONDS + BUCKET_SECONDS / 2.0;
        let frame = decoder.as_mut().expect("opened preview").frame(seconds);
        if let (Ok(frame), Some(dir)) = (&frame, disk.as_deref()) {
            save_frame(dir, key, frame);
        }
        let mut shared = shared.lock();
        shared.in_flight = None;
        match frame {
            Ok(frame) => {
                shared.generated += 1;
                store(&mut shared, key, frame);
            }
            Err(error) => {
                shared.failed_key = Some(key);
                eprintln!("[Plexy preview] {error}");
            }
        }
    }
}
