//! Plexy Beta: local playback for Apple Silicon macOS on GPUI + libmpv.
//!
//! Usage: `plexy-player [FILE] [--self-test REPORT.json]`

mod app;
mod assets;
mod catalog;
mod credentials;
mod library_ui;
mod marker_ui;
mod media;
mod metadata;
mod migrate;
mod mpv;
mod personal_ui;
mod preview;
mod selftest;
mod settings_ui;
#[cfg(test)]
mod ui_tests;
mod server_host;
mod shell_ui;
mod theme;
mod ui;
mod updates;
mod variant;

use std::path::PathBuf;

use gpui_kit::{
    actions, prelude::*, px, size, App, Bounds, KeyBinding, Menu, MenuItem, TitlebarOptions,
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
    let app_name = variant::current().name();
    gpui_kit::application().with_assets(assets::Assets).run(move |cx: &mut App| {
        // Kit first: theme, Root overlays, component keybindings.
        gpui_kit::init(cx);
        theme::apply_kit_theme(cx);
        cx.set_global(assets::ArtworkCache::default());
        cx.background_executor().spawn(async { preview::prune_disk_cache(); }).detach();
        mpv::set_app_icon();
        // Archivo, the web app's UI font (SIL OFL, assets/fonts/OFL.txt).
        let fonts: Vec<std::borrow::Cow<'static, [u8]>> = vec![
            include_bytes!("../assets/fonts/Archivo_400Regular.ttf").as_slice().into(),
            include_bytes!("../assets/fonts/Archivo_500Medium.ttf").as_slice().into(),
            include_bytes!("../assets/fonts/Archivo_600SemiBold.ttf").as_slice().into(),
            include_bytes!("../assets/fonts/Archivo_700Bold.ttf").as_slice().into(),
            include_bytes!("../assets/fonts/Archivo_800ExtraBold.ttf").as_slice().into(),
            include_bytes!("../assets/fonts/Archivo_900Black.ttf").as_slice().into(),
        ];
        if let Err(error) = cx.text_system().add_fonts(fonts) {
            eprintln!("fonts: {error}");
        }
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.bind_keys([KeyBinding::new("cmd-q", Quit, None), KeyBinding::new("cmd-o", Open, None)]);
        cx.set_menus(vec![
            Menu { name: app_name.into(), disabled: false, items: vec![MenuItem::action(format!("Quit {app_name}"), Quit)] },
            Menu { name: "File".into(), disabled: false, items: vec![MenuItem::action("Open…", Open)] },
        ]);
        cx.on_window_closed(|cx, _| {
            if crate::variant::current().supports_hosting()
                && crate::server_host::keep_running()
            {
                return;
            }
            cx.quit();
        }).detach();

        let bounds = Bounds::centered(None, size(px(1280.), px(760.)), cx);
        let file = args.file.clone();
        let self_test = args.self_test.clone();
        let library_test = args.library_test.clone();
        let add_libraries = args.add_libraries.clone();
        // `gpui_kit::open_window` mounts the Kit Root (dialogs, tooltips,
        // notifications) around the player view.
        let (window, view) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(TitlebarOptions {
                        title: Some(app_name.into()),
                        appears_transparent: true,
                        traffic_light_position: Some(gpui_kit::point(px(14.), px(14.))),
                    }),
                    // GPUI 0.3 makes the Metal layer opaque for `Opaque`, hiding the libmpv
                    // view beneath it. Every screen paints its own background.
                    window_background: WindowBackgroundAppearance::Transparent,
                    window_min_size: Some(size(px(600.), px(360.))),
                    ..Default::default()
                },
                cx,
                move |window, cx: &mut App| {
                    // GPUI draws into a layer-backed NSView inside the
                    // window's content view; the video surface goes directly
                    // beneath it.
                    let gpui_view = match window.window_handle().map(|h| h.as_raw()) {
                        Ok(RawWindowHandle::AppKit(handle)) => handle.ns_view.as_ptr(),
                        _ => std::ptr::null_mut(),
                    };
                    let catalog = catalog::Catalog::open().expect("open the library database");
                    if let Err(error) = migrate::run(&catalog) {
                        eprintln!("migration: {error:#}");
                    }
                    for (kind, path) in &add_libraries {
                        if !catalog.libraries().iter().any(|l| l.roots.iter().any(|r| &r.path == path)) {
                            let _ = catalog.add_library(*kind, path);
                        }
                    }
                    let view = cx.new(|cx| PlayerView::new(gpui_view as usize, catalog, cx));
                    view.update(cx, |view, cx| {
                        window.focus(view.focus_handle(), cx);
                        cx.observe_window_bounds(window, |view, _, cx| {
                            view.episode_menu = None;
                            cx.notify();
                        }).detach();
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
            let view = view.clone();
            window
                .update(cx, |_, window, cx| view.update(cx, |view, cx| view.prompt_open(window, cx)))
                .ok();
        });
        cx.activate(true);
    });
}
