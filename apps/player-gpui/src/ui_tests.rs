//! GPUI Kit UI integration tests for the real `PlayerView` in a headless
//! window, native pointer and key events (see `docs/GPUI_KIT_MIGRATION.md`).

use std::path::Path;

use gpui_kit::component::WindowExt as _;
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    AnyWindowHandle, AppContext as _, Bounds, Entity, TestAppContext, WindowBounds, WindowOptions,
    px, size,
};

use crate::app::PlayerView;
use crate::catalog::Catalog;
use crate::library_ui::Screen;
use crate::settings_ui::SettingsSection;

fn open_settings(
    cx: &mut TestAppContext,
    data: &Path,
    section: SettingsSection,
) -> (AnyWindowHandle, Entity<PlayerView>) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::apply_kit_theme(cx);
        cx.set_global(crate::assets::ArtworkCache::default());
    });
    let catalog = Catalog::open_in(data.to_path_buf()).expect("open test catalog");
    let (handle, view) = cx.update(|cx| {
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(Default::default(), size(px(1280.), px(900.))))),
                ..Default::default()
            },
            cx,
            move |_, cx| {
                cx.new(|cx| {
                    let mut view = PlayerView::new(0, catalog, cx);
                    view.screen = Screen::Settings;
                    view.settings_section = section;
                    view
                })
            },
        )
        .expect("open test window")
    });
    cx.update_window(handle, |_, window, cx| window.render_frame(cx)).unwrap();
    (handle, view)
}

#[gpui_kit::test]
fn switch_and_select_changes_survive_a_relaunch(cx: &mut TestAppContext) {
    let _guard = crate::catalog::test_support::lock();
    let dir = tempfile::tempdir().unwrap();
    let (handle, view) = open_settings(cx, dir.path(), SettingsSection::Playback);

    let before = cx.update(|cx| view.read(cx).catalog.setting("autoplay"));
    assert_ne!(before.as_deref(), Some("on"), "autoplay starts off");

    cx.update_window(handle, |_, window, cx| {
        window.click("set-autoplay", cx);
        // The subtitle picker: open, move to the first language, confirm.
        window.click("subtitle_lang", cx);
        window.press("down", cx);
        window.press("enter", cx);
    })
    .unwrap();
    cx.run_until_parked();

    // Relaunch: a new catalog on the same folder reads what was written.
    drop(view);
    let reopened = Catalog::open_in(dir.path().to_path_buf()).unwrap();
    assert_eq!(reopened.setting("autoplay").as_deref(), Some("on"));
    assert_eq!(reopened.setting("subtitle_lang").as_deref(), Some("eng"));
}

#[gpui_kit::test]
fn tab_moves_focus_through_settings_controls(cx: &mut TestAppContext) {
    let _guard = crate::catalog::test_support::lock();
    let dir = tempfile::tempdir().unwrap();
    let (handle, _view) = open_settings(cx, dir.path(), SettingsSection::Playback);

    cx.update_window(handle, |_, window, cx| {
        window.click("set-subs-on", cx);
        assert_eq!(window.find("set-subs-on").focused(), Some(true));
        window.press("tab", cx);
        assert_ne!(window.find("set-subs-on").focused(), Some(true), "Tab leaves the switch");
        window.press("shift-tab", cx);
        assert_eq!(window.find("set-subs-on").focused(), Some(true), "Shift-Tab comes back");
    })
    .unwrap();
}

#[gpui_kit::test]
fn escape_cancels_reset_and_restores_focus(cx: &mut TestAppContext) {
    let _guard = crate::catalog::test_support::lock();
    let dir = tempfile::tempdir().unwrap();
    let (handle, view) = open_settings(cx, dir.path(), SettingsSection::Maintenance);

    cx.update_window(handle, |_, window, cx| {
        window.click("reset-data", cx);
        assert!(window.has_active_dialog(cx), "Reset asks for confirmation");
        window.press("escape", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(!window.has_active_dialog(cx), "Escape closes the dialog");
        assert_eq!(window.find("reset-data").focused(), Some(true), "focus returns to Reset");
    })
    .unwrap();
    // Cancelling must not reset anything.
    assert!(cx.update(|cx| view.read(cx).maintenance_message.is_empty()));
}

#[gpui_kit::test]
fn add_library_opens_a_kit_dialog_that_escape_closes(cx: &mut TestAppContext) {
    let _guard = crate::catalog::test_support::lock();
    let dir = tempfile::tempdir().unwrap();
    let (handle, view) = open_settings(cx, dir.path(), SettingsSection::Libraries);

    cx.update_window(handle, |_, window, cx| window.click("add-library", cx)).unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.has_active_dialog(cx), "Add library opens a Kit dialog");
        window.press("escape", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(!window.has_active_dialog(cx), "Escape closes it");
    })
    .unwrap();
    assert!(!cx.update(|cx| view.read(cx).add_library_open), "and clears the view's state");
}

#[gpui_kit::test]
fn collection_tabs_stay_in_place_when_switching_lists(cx: &mut TestAppContext) {
    use gpui_kit::ElementId;

    let _guard = crate::catalog::test_support::lock();
    let dir = tempfile::tempdir().unwrap();
    let (handle, view) = open_settings(cx, dir.path(), SettingsSection::Overview);
    cx.run_until_parked();
    cx.update(|cx| view.update(cx, |view, cx| {
        view.catalog_loaded = true;
        view.screen = Screen::Collections;
        cx.notify();
    }));

    cx.update_window(handle, |_, window, cx| {
        let tab = |index| ElementId::NamedInteger("lists".into(), index);
        window.render_frame(cx);
        let positions = [0, 1, 2, 3].map(|index| window.find(tab(index)).bounds());
        assert_eq!(
            positions[0].top(),
            window.find("top-nav").bounds().bottom() + px(20.),
        );

        for (index, screen) in [
            (0, Screen::Watchlist),
            (1, Screen::Favorites),
            (3, Screen::Hidden),
            (2, Screen::Collections),
        ] {
            window.click(tab(index), cx);
            assert_eq!(view.read(cx).screen, screen);
            assert_eq!(
                [0, 1, 2, 3].map(|index| window.find(tab(index)).bounds()),
                positions,
            );
        }
    }).unwrap();
}

#[gpui_kit::test]
fn title_grid_mounts_rows_on_scroll_and_opens_the_selected_movie(cx: &mut TestAppContext) {
    use gpui_kit::point;
    use rusqlite::{params, Connection};

    let _guard = crate::catalog::test_support::lock();
    let dir = tempfile::tempdir().unwrap();
    let (handle, view) = open_settings(cx, dir.path(), SettingsSection::Overview);
    let library = cx.update(|cx| {
        view.read(cx).catalog.add_library(crate::catalog::LibraryKind::Movies, dir.path()).unwrap()
    });
    let mut db = Connection::open(dir.path().join("library.sqlite")).unwrap();
    let write = db.transaction().unwrap();
    write.execute("UPDATE libraries SET auto_refresh = 0", []).unwrap();
    for index in 0..120 {
        write.execute(
            "INSERT INTO items(library_id, root_id, path, size, mtime, title, added_at)
             SELECT ?1, id, ?2, 0, 0, ?3, 0 FROM roots WHERE library_id = ?1",
            params![library, format!("/Movie {index:03}.mkv"), format!("Movie {index:03}")],
        ).unwrap();
    }
    write.commit().unwrap();
    cx.update(|cx| view.update(cx, |view, cx| {
        view.screen = Screen::Movies;
        view.sort = crate::personal_ui::Sort::Title;
        view.reload_catalog(cx);
        cx.notify();
    }));
    cx.run_until_parked();

    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("movie-m:/Movie 000.mkv").visible());
        assert!(window.try_find("movie-m:/Movie 119.mkv").is_none());
        view.read(cx).shell_scroll.set_offset(point(px(0.), px(-10000.)));
        window.render_frame(cx);
        assert!(window.find("movie-m:/Movie 119.mkv").visible());
        assert!(window.try_find("movie-m:/Movie 000.mkv").is_none());
        window.click("movie-m:/Movie 119.mkv", cx);
    }).unwrap();
    assert_eq!(
        cx.update(|cx| view.read(cx).screen.clone()),
        Screen::Movie("/Movie 119.mkv".into()),
    );
}
