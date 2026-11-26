//! Seek previews generated off the UI thread by a headless libmpv core.
//!
//! Requests are "latest wins": while the pointer sweeps across the seek bar
//! only the most recent position is decoded. Frames are cached per bucket so
//! sweeping back over the same region is instant. Nothing is written to disk.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;

use crate::mpv::{Preview, PreviewFrame};

const BUCKET_SECONDS: f64 = 2.0;
const CACHE_LIMIT: usize = 400;

pub fn bucket(seconds: f64) -> i64 {
    (seconds.max(0.0) / BUCKET_SECONDS).floor() as i64
}

#[derive(Default)]
struct Shared {
    frames: HashMap<i64, Arc<PreviewFrame>>,
    order: Vec<i64>,
    failed: Option<String>,
    generated: u64,
}

pub struct PreviewService {
    requests: Sender<f64>,
    shared: Arc<Mutex<Shared>>,
}

impl PreviewService {
    pub fn start(libmpv: PathBuf, media: &Path) -> Self {
        let (requests, receiver) = channel::<f64>();
        let shared = Arc::new(Mutex::new(Shared::default()));
        let worker_shared = shared.clone();
        let media = media.to_path_buf();
        std::thread::Builder::new()
            .name("plexy-previews".into())
            .spawn(move || worker(libmpv, media, receiver, worker_shared))
            .expect("preview thread");
        Self { requests, shared }
    }

    /// Returns the cached frame for `seconds`, queueing it if missing.
    pub fn request(&self, seconds: f64) -> Option<Arc<PreviewFrame>> {
        let key = bucket(seconds);
        if let Some(frame) = self.shared.lock().frames.get(&key) {
            return Some(frame.clone());
        }
        let _ = self.requests.send(key as f64 * BUCKET_SECONDS + BUCKET_SECONDS / 2.0);
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

fn worker(libmpv: PathBuf, media: PathBuf, receiver: Receiver<f64>, shared: Arc<Mutex<Shared>>) {
    let mut preview = match Preview::open(&libmpv, &media, 320) {
        Ok(preview) => preview,
        Err(error) => {
            shared.lock().failed = Some(error.to_string());
            return;
        }
    };
    loop {
        // Block for one request, then drain to the newest.
        let mut seconds = match receiver.recv() {
            Ok(seconds) => seconds,
            Err(_) => return,
        };
        loop {
            match receiver.recv_timeout(Duration::from_millis(8)) {
                Ok(newer) => seconds = newer,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        let key = bucket(seconds);
        if shared.lock().frames.contains_key(&key) {
            continue;
        }
        match preview.frame(seconds) {
            Ok(frame) => {
                let mut shared = shared.lock();
                shared.frames.insert(key, Arc::new(frame));
                shared.order.push(key);
                shared.generated += 1;
                if shared.order.len() > CACHE_LIMIT {
                    let oldest = shared.order.remove(0);
                    shared.frames.remove(&oldest);
                }
            }
            Err(error) => eprintln!("[Plexy preview] {error}"),
        }
    }
}
