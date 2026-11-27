//! Seek previews generated off the UI thread by a headless libmpv core.
//!
//! Requests are "latest wins": while the pointer sweeps across the seek bar
//! only the most recent position is decoded. Frames are cached per bucket so
//! sweeping back over the same region is instant. Nothing is written to disk.

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

    pub fn failure(&self) -> Option<String> {
        self.shared.lock().failed.clone()
    }
}

fn worker(libmpv: PathBuf, media: PathBuf, receiver: Receiver<()>, shared: Arc<Mutex<Shared>>) {
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
        let mut shared = shared.lock();
        shared.in_flight = None;
        match frame {
            Ok(frame) => {
                shared.bytes += frame.bgra.len();
                shared.frames.insert(key, Arc::new(frame));
                shared.order.push_back(key);
                shared.generated += 1;
                while shared.order.len() > CACHE_LIMIT || shared.bytes > CACHE_BYTES {
                    let oldest = shared.order.pop_front().expect("cached frame");
                    let frame = shared.frames.remove(&oldest).expect("cached frame");
                    shared.bytes -= frame.bgra.len();
                }
            }
            Err(error) => {
                shared.failed_key = Some(key);
                eprintln!("[Plexy preview] {error}");
            }
        }
    }
}
