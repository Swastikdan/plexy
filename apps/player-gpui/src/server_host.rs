//! Hosts the bundled Plexy Server for the unified Mac app.
//!
//! The server runs as a child of the app with its own data directory and the
//! shared `~/Library/Application Support/Plexy` store. Closing the child's
//! stdin triggers the server's soft-shutdown path, so quitting the app stops
//! hosting unless the user keeps the app running in the background.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

static KEEP_RUNNING: AtomicBool = AtomicBool::new(false);
static HOST: OnceLock<Mutex<ServerHost>> = OnceLock::new();

/// The process-wide host. It survives closing the window so the keep-running
/// preference can leave the server available in the background.
pub fn host() -> MutexGuard<'static, ServerHost> {
    HOST.get_or_init(|| Mutex::new(ServerHost::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn set_keep_running(value: bool) {
    KEEP_RUNNING.store(value, Ordering::Relaxed);
}

pub fn keep_running() -> bool {
    KEEP_RUNNING.load(Ordering::Relaxed)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HostState {
    #[default]
    Stopped,
    Starting,
    Running,
    Failed,
}

pub struct ServerHost {
    child: Option<Child>,
    port: Option<u16>,
    state: HostState,
    message: Option<String>,
    started_at: Option<Instant>,
    last_probe: Option<Instant>,
}

impl Default for ServerHost {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerHost {
    pub fn new() -> Self {
        Self {
            child: None,
            port: None,
            state: HostState::Stopped,
            message: None,
            started_at: None,
            last_probe: None,
        }
    }

    pub fn state(&self) -> HostState {
        self.state
    }

    pub fn url(&self) -> Option<String> {
        self.port.map(|port| format!("http://127.0.0.1:{port}"))
    }

    pub fn message(&self) -> Option<&str> {
        self.message.as_deref()
    }

    pub fn is_running(&self) -> bool {
        self.state == HostState::Running
    }

    /// The packaged `Resources/server` folder, or the repository bundle in dev.
    pub fn resources_dir() -> Option<PathBuf> {
        if let Some(value) = std::env::var_os("PLEXY_SERVER_RESOURCES") {
            let path = PathBuf::from(value);
            if path.join("plexy-server").is_file() {
                return Some(path);
            }
        }
        if let Ok(executable) = std::env::current_exe() {
            if let Some(resources) = executable
                .parent()
                .and_then(|path| path.parent())
                .map(|path| path.join("Resources").join("server"))
            {
                if resources.join("plexy-server").is_file() {
                    return Some(resources);
                }
            }
        }
        let cwd = std::env::current_dir().ok()?;
        for candidate in [
            cwd.join("dist").join("server"),
            cwd.join("..").join("..").join("dist").join("server"),
        ] {
            if candidate.join("plexy-server").is_file() {
                return Some(candidate);
            }
        }
        None
    }

    pub fn data_dir() -> Option<PathBuf> {
        let home = std::env::var_os("HOME")?;
        let subdir = crate::variant::current().server_data_subdir()?;
        Some(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(subdir),
        )
    }

    pub fn log_dir() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Logs")
                .join("Plexy")
        })
    }

    fn free_port() -> Option<u16> {
        (8765..=8795).find(|port| {
            let first = TcpListener::bind(("127.0.0.1", *port)).is_ok();
            let second = TcpListener::bind(("127.0.0.1", port + 1)).is_ok();
            first && second
        })
    }

    pub fn start(&mut self) {
        if matches!(self.state, HostState::Starting | HostState::Running) {
            return;
        }
        // Never open the shared Electron/server store from a second process.
        // If a Plexy server already answers on the default port, use it.
        if server_ready(8765) {
            self.child = None;
            self.port = Some(8765);
            self.state = HostState::Running;
            self.message = Some(
                "Using the Plexy Server already running on this Mac (port 8765).".into(),
            );
            return;
        }
        let Some(resources) = Self::resources_dir() else {
            self.state = HostState::Failed;
            self.message = Some(
                "The bundled Plexy Server was not found. Install the full Plexy app."
                    .into(),
            );
            return;
        };
        let Some(data) = Self::data_dir() else {
            self.state = HostState::Failed;
            self.message = Some("The home folder could not be resolved.".into());
            return;
        };
        let log = Self::log_dir().unwrap_or_else(|| data.clone());
        let Some(port) = Self::free_port() else {
            self.state = HostState::Failed;
            self.message = Some("No free port was available for Plexy Server.".into());
            return;
        };
        let binary = resources.join("plexy-server");
        let mut command = Command::new(binary);
        command
            .env("PORT", port.to_string())
            .env("PLEXY_DATA_DIR", &data)
            .env("PLEXY_LOG_DIR", &log)
            .env("PLEXY_FFMPEG", resources.join("ffmpeg"))
            .env("PLEXY_RESOURCES_DIR", &resources)
            .env("PLEXY_DESKTOP", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match command.spawn() {
            Ok(child) => {
                self.child = Some(child);
                self.port = Some(port);
                self.state = HostState::Starting;
                self.started_at = Some(Instant::now());
                self.last_probe = None;
                self.message = Some("Starting Plexy Server…".into());
            }
            Err(error) => {
                self.state = HostState::Failed;
                self.message = Some(format!("Plexy Server could not start: {error}"));
            }
        }
    }

    /// Called from the UI tick; never blocks longer than one short probe.
    pub fn refresh(&mut self) {
        if self.state == HostState::Stopped {
            return;
        }
        if let Some(child) = self.child.as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                self.child = None;
                self.port = None;
                self.state = HostState::Failed;
                self.message = Some(format!("Plexy Server stopped ({status})."));
                return;
            }
        }
        if self.state == HostState::Starting {
            if self
                .started_at
                .is_some_and(|started| started.elapsed() > Duration::from_secs(20))
            {
                self.stop();
                self.state = HostState::Failed;
                self.message = Some("Plexy Server did not become ready.".into());
                return;
            }
            if self
                .last_probe
                .is_some_and(|probe| probe.elapsed() < Duration::from_millis(500))
            {
                return;
            }
            self.last_probe = Some(Instant::now());
            if let Some(port) = self.port {
                if server_ready(port) {
                    self.state = HostState::Running;
                    self.message = Some(format!("Running at http://127.0.0.1:{port}"));
                }
            }
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        }
        self.port = None;
        self.state = HostState::Stopped;
        self.message = Some("Plexy Server is stopped.".into());
        self.started_at = None;
        self.last_probe = None;
    }
}

impl Drop for ServerHost {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn server_ready(port: u16) -> bool {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(400))
        .build();
    let Ok(response) = agent
        .get(&format!("http://127.0.0.1:{port}/api/server/status"))
        .call()
    else {
        return false;
    };
    let Ok(value) = response.into_string() else {
        return false;
    };
    serde_json::from_str::<Value>(&value)
        .ok()
        .and_then(|value| value["serverId"].as_str().map(str::to_owned))
        .is_some()
}
