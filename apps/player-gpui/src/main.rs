//! Plexy Player: local playback for Apple Silicon macOS on GPUI + libmpv.
//!
//! Usage: `plexy-player [FILE] [--self-test REPORT.json]`

mod app;
mod assets;
mod catalog;
mod library_ui;
mod media;
mod mpv;
mod personal_ui;
mod preview;
mod selftest;
mod shell_ui;
mod theme;

use std::path::PathBuf;
use std::sync::Arc;

use gpui::{
    actions, prelude::*, px, size, App, Application, Bounds, KeyBinding, Menu, MenuItem, TitlebarOptions,
    WindowBackgroundAppearance, WindowBounds, WindowOptions,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

use app::PlayerView;

actions!(plexy, [Quit, Open]);

struct Args {
    file: Option<PathBuf>,
    self_test: Option<PathBuf>,
    library_test: Option<PathBuf>,
    add_libraries: Vec<(catalog::LibraryKind, PathBuf)>,
}

fn parse_args() -> Args {
    let mut args = Args { file: None, self_test: None, library_test: None, add_libraries: Vec::new() };
    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--self-test" => args.self_test = iter.next().map(PathBuf::from),
            "--library-test" => args.library_test = iter.next().map(PathBuf::from),
            // `--add-library tv=/path` or `movies=/path` (used by tests and scripts).
            "--add-library" => {
                if let Some((kind, path)) = iter.next().as_deref().and_then(|v| v.split_once('=')) {
                    let kind = if kind == "tv" { catalog::LibraryKind::Shows } else { catalog::LibraryKind::Movies };
                    args.add_libraries.push((kind, PathBuf::from(path)));
                }
            }
            "-h" | "--help" => {
                println!("Usage: plexy-player [FILE] [--self-test REPORT.json]");
                std::process::exit(0);
            }
            _ if !arg.starts_with('-') => args.file = Some(PathBuf::from(arg)),
            other => eprintln!("Ignoring unknown option {other}"),
        }
    }
    args
}

fn main() {
    let args = parse_args();
    let libmpv = match mpv::find_libmpv() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };

    Application::new().with_assets(assets::Assets).run(move |cx: &mut App| {
        mpv::set_app_icon();
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.bind_keys([KeyBinding::new("cmd-q", Quit, None), KeyBinding::new("cmd-o", Open, None)]);
        cx.set_menus(vec![
            Menu { name: "Plexy Player".into(), items: vec![MenuItem::action("Quit Plexy Player", Quit)] },
            Menu { name: "File".into(), items: vec![MenuItem::action("Open…", Open)] },
        ]);
        cx.on_window_closed(|cx| cx.quit()).detach();

        let bounds = Bounds::centered(None, size(px(1280.), px(760.)), cx);
        let player = match mpv::Player::new(&libmpv) {
            Ok(player) => Arc::new(player),
            Err(error) => {
                eprintln!("{error}");
                cx.quit();
                return;
            }
        };

        let file = args.file.clone();
        let self_test = args.self_test.clone();
        let library_test = args.library_test.clone();
        let add_libraries = args.add_libraries.clone();
        let libmpv = libmpv.clone();
        let window = cx
            .open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(TitlebarOptions {
                        title: Some("Plexy Player".into()),
                        appears_transparent: true,
                        traffic_light_position: Some(gpui::point(px(14.), px(14.))),
                    }),
                    window_background: WindowBackgroundAppearance::Opaque,
                    window_min_size: Some(size(px(480.), px(300.))),
                    ..Default::default()
                },
                move |window, cx| {
                    // GPUI draws into a layer-backed NSView inside the
                    // window's content view; the video surface goes directly
                    // beneath it.
                    let gpui_view = match window.window_handle().map(|h| h.as_raw()) {
                        Ok(RawWindowHandle::AppKit(handle)) => handle.ns_view.as_ptr(),
                        _ => std::ptr::null_mut(),
                    };
                    if let Err(error) = player.attach(gpui_view) {
                        eprintln!("{error}");
                    }
                    let catalog = catalog::Catalog::open().expect("open the library database");
                    for (kind, path) in &add_libraries {
                        if !catalog.libraries().iter().any(|l| l.roots.iter().any(|r| &r.path == path)) {
                            let _ = catalog.add_library(*kind, path);
                        }
                    }
                    let view = cx.new(|cx| PlayerView::new(player.clone(), libmpv.clone(), gpui_view as usize, catalog, cx));
                    view.update(cx, |view, cx| {
                        window.focus(view.focus_handle());
                        if let Some(file) = &file {
                            view.open(file, window, cx);
                        }
                        app::start_ticking(window, cx);
                        if let Some(dir) = &library_test {
                            selftest::run_library(dir.clone(), window, cx);
                        }
                        if let Some(report) = &self_test {
                            selftest::run(report.clone(), window, cx);
                        }
                    });
                    view
                },
            )
            .expect("open window");

        cx.on_action(move |_: &Open, cx| {
            window
                .update(cx, |view, window, cx| view.prompt_open(window, cx))
                .ok();
        });
        cx.activate(true);
    });
}
