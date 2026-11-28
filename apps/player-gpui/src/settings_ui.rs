//! Settings navigation, preference controls, and library maintenance.

use gpui_kit::{div, prelude::*, px, AnimationExt, AnyElement, Context, SharedString, Window};

use crate::app::PlayerView;
use crate::catalog::TitleKey;
use crate::library_ui::Screen;
use crate::personal_ui::Field;
use crate::shell_ui::PAGE_X;
use crate::ui::motion::MotionSpec;
use crate::theme;
use crate::ui::icon::{icon, Icon};

const LANGUAGES: [(&str, &str); 34] = [
    ("", "Default"),
    ("eng", "English"),
    ("hin", "Hindi"),
    ("ara", "Arabic"),
    ("ben", "Bengali"),
    ("chi", "Chinese"),
    ("cze", "Czech"),
    ("dan", "Danish"),
    ("dut", "Dutch"),
    ("fin", "Finnish"),
    ("fre", "French"),
    ("ger", "German"),
    ("gre", "Greek"),
    ("heb", "Hebrew"),
    ("hun", "Hungarian"),
    ("ind", "Indonesian"),
    ("ita", "Italian"),
    ("jpn", "Japanese"),
    ("kor", "Korean"),
    ("mal", "Malayalam"),
    ("mar", "Marathi"),
    ("nor", "Norwegian"),
    ("pol", "Polish"),
    ("por", "Portuguese"),
    ("rum", "Romanian"),
    ("rus", "Russian"),
    ("spa", "Spanish"),
    ("swe", "Swedish"),
    ("tam", "Tamil"),
    ("tel", "Telugu"),
    ("tha", "Thai"),
    ("tur", "Turkish"),
    ("ukr", "Ukrainian"),
    ("vie", "Vietnamese"),
];

const METADATA_LANGUAGES: [(&str, &str); 7] = [
    ("en-US", "English (US)"), ("en-GB", "English (UK)"), ("hi-IN", "Hindi (India)"),
    ("ja-JP", "Japanese"), ("ko-KR", "Korean"), ("fr-FR", "French"), ("es-ES", "Spanish"),
];
const METADATA_REGIONS: [(&str, &str); 6] = [
    ("US", "United States"), ("IN", "India"), ("GB", "United Kingdom"),
    ("CA", "Canada"), ("AU", "Australia"), ("JP", "Japan"),
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SettingsSection {
    #[default]
    Overview,
    Playback,
    Appearance,
    Libraries,
    FixMatches,
    Metadata,
    Maintenance,
    Server,
}

impl SettingsSection {
    pub(crate) fn from_launch_screen(screen: &str) -> Option<Self> {
        let section = screen.strip_prefix("settings:");
        Some(match section.unwrap_or(screen) {
            "settings" => Self::Overview,
            "playback" => Self::Playback,
            "appearance" => Self::Appearance,
            "libraries" => Self::Libraries,
            "matches" => Self::FixMatches,
            "metadata" => Self::Metadata,
            "maintenance" => Self::Maintenance,
            "server" => Self::Server,
            _ if section.is_some() => Self::Overview,
            _ => return None,
        })
    }
}

/// One option of a preference picker: a stored code and its label.
#[derive(Clone)]
pub struct Choice {
    code: &'static str,
    name: &'static str,
}

impl gpui_kit::component::select::SelectItem for Choice {
    type Value = &'static str;
    fn value(&self) -> &&'static str {
        &self.code
    }
    fn title(&self) -> SharedString {
        self.name.into()
    }
}

pub type ChoiceSelect = gpui_kit::Entity<gpui_kit::component::select::SelectState<Vec<Choice>>>;

#[derive(Clone)]
struct RemapResult {
    id: i64,
    kind: String,
    name: String,
    year: Option<String>,
    overview: String,
}

pub(crate) struct FixMatches {
    rows: Vec<MatchRow>,
    visible: Vec<usize>,
    attention: usize,
}

struct MatchRow {
    key: TitleKey,
    title: String,
    year: Option<u32>,
    poster: Option<std::path::PathBuf>,
    is_show: bool,
    manual: bool,
    state: u8, // 0 matched, 1 needs attention, 2 not matched
    detail: String,
    source: String,
}

/// The open "Remap" dialog for one title.
pub struct Remap {
    pub key: TitleKey,
    pub title: String,
    pub year: Option<u32>,
    pub is_show: bool,
    pub query: String,
    manual: bool,
    results: Vec<RemapResult>,
    busy: bool,
    search_task: Option<gpui_kit::Task<()>>,
    pub message: Option<String>,
}

impl Remap {
    pub(crate) fn set_query(&mut self, query: String) {
        if self.query != query {
            self.query = query;
            self.search_task = None;
            self.busy = false;
            self.results.clear();
            self.message = None;
        }
    }
}

use crate::ui::button::Button;
use crate::ui::surface::{self, alpha, badge, body, caption, card, card_header, row, rows, Tone, PAD, STACK};

/// The settings select width.
const SELECT_W: f32 = 200.;

impl PlayerView {
    // MARK: Settings

    /// A Kit `Switch` bound to a preference. `flip` writes the new value.
    fn toggle(&self, id: &'static str, on: bool, cx: &mut Context<Self>, flip: impl Fn(&mut Self) + 'static) -> impl IntoElement {
        gpui_kit::component::switch::Switch::new(id)
            .checked(on)
            .accessibility_label(id)
            .on_change(cx.listener(move |this, _: &bool, _, cx| {
                flip(this);
                cx.notify();
            }))
    }

    /// Creates the Kit `Select` states for the preference pickers once, with
    /// subscriptions that write the chosen code to the catalog. Called from
    /// `render`, which has the window the states need.
    pub(crate) fn ensure_setting_selects(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::{select::{SelectEvent, SelectState}, IndexPath};
        use gpui_kit::component::input::{InputEvent, InputState};
        if self.token_clear {
            self.token_clear = false;
            if let Some(input) = &self.token_input {
                input.update(cx, |input, cx| input.set_value("", window, cx));
            }
        }
        if !self.setting_selects.is_empty() {
            return;
        }
        let token = cx.new(|cx| InputState::new(window, cx).masked(true).placeholder("Paste your TMDB API Read Access Token"));
        let subscription = cx.subscribe_in(&token, window, |this, input, event: &InputEvent, _, cx| match event {
            InputEvent::Change => this.token_draft = input.read(cx).value().to_string(),
            InputEvent::PressEnter { .. } => this.save_token(cx),
            _ => {}
        });
        self.token_input = Some(token);
        self.select_subscriptions.push(subscription);
        let pickers: [(&'static str, &'static str, &'static [(&'static str, &'static str)]); 4] = [
            ("subtitle_lang", "", &LANGUAGES),
            ("audio_lang", "", &LANGUAGES),
            ("metadata_language", "en-US", &METADATA_LANGUAGES),
            ("metadata_region", "US", &METADATA_REGIONS),
        ];
        for (setting, fallback, options) in pickers {
            let current = self.catalog.setting(setting).unwrap_or_else(|| fallback.into());
            let items: Vec<Choice> = options.iter().map(|(code, name)| Choice { code, name }).collect();
            let selected = items.iter().position(|choice| choice.code == current).map(IndexPath::new);
            let state = cx.new(|cx| SelectState::new(items, selected, window, cx));
            let subscription = cx.subscribe_in(&state, window, move |this, _, event: &SelectEvent<Vec<Choice>>, _, cx| {
                let SelectEvent::Confirm(Some(code)) = event else { return };
                this.catalog.set_setting(setting, code);
                if setting.starts_with("metadata_") {
                    this.metadata_message = "Refresh metadata to apply this to existing titles.".into();
                }
                cx.notify();
            });
            self.setting_selects.push((setting, state));
            self.select_subscriptions.push(subscription);
        }
    }

    /// Whether a preference picker holds focus; while its menu is open the
    /// Kit moves focus into the menu list. Used by the self-test.
    pub(crate) fn select_focused(&self, setting: &str, window: &Window, cx: &gpui_kit::App) -> bool {
        use gpui_kit::Focusable as _;
        self.setting_selects
            .iter()
            .find(|(name, _)| *name == setting)
            .is_some_and(|(_, state)| state.read(cx).focus_handle(cx).contains_focused(window, cx))
    }

    /// The Kit `Select` for a preference created by [`Self::ensure_setting_selects`].
    fn setting_select(&self, setting: &'static str) -> AnyElement {
        match self.setting_selects.iter().find(|(name, _)| *name == setting) {
            Some((_, state)) => gpui_kit::component::select::Select::new(state)
                .id(setting)
                .w(px(SELECT_W))
                .menu_max_h(px(320.))
                .accessibility_label(setting)
                .into_any_element(),
            None => div().into_any_element(),
        }
    }

    fn settings_card(&self, icon_name: Icon, title: &str, items: Vec<AnyElement>) -> impl IntoElement {
        card().child(card_header(Some(icon_name), title.to_string(), None, None)).children(rows(items))
    }

    fn setting_row(label: &str, control: impl IntoElement) -> AnyElement {
        row(label.to_string(), None, control).into_any_element()
    }

    fn run_metadata_job(&mut self, markers: bool, cx: &mut Context<Self>) {
        if self.metadata_busy {
            return;
        }
        self.metadata_busy = true;
        self.metadata_message = if markers { "Looking up markers…" } else { "Refreshing metadata…" }.into();
        cx.notify();
        let catalog = self.catalog.clone();
        let work = cx.background_spawn(async move {
            if markers {
                let (checked, found, failed) = crate::metadata::refresh_missing_markers(&catalog);
                if checked == 0 {
                    "No missing markers for titles matched to IMDb.".into()
                } else {
                    format!("Checked {checked} files. Found markers for {found}. Couldn’t check {failed}.")
                }
            } else {
                let (refreshed, unmatched, interrupted) = crate::metadata::refresh_metadata(&catalog, true);
                if interrupted {
                    format!("Refreshed {refreshed} titles before losing the connection to TMDB.")
                } else {
                    format!("Refreshed {refreshed} titles. {unmatched} couldn’t be matched.")
                }
            }
        });
        cx.spawn(async move |this, cx| {
            let message = work.await;
            this.update(cx, |this, cx| {
                this.metadata_busy = false;
                this.metadata_message = message;
                cx.notify();
            }).ok();
        }).detach();
    }

    pub(crate) fn render_settings_page(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let compact = self.page_width() < 850.;
        let section = if self.screen == Screen::Libraries { SettingsSection::Libraries } else { self.settings_section };

        let content: AnyElement = match section {
            SettingsSection::Playback => {
                let subs_on = self.catalog.setting("subtitles_on").as_deref() != Some("no");
                let autoplay = self.catalog.setting("autoplay").as_deref() == Some("on");
                div()
                    .flex()
                    .flex_col()
                    .gap(px(STACK))
                    .child(self.settings_card(
                        Icon::Captions,
                        "Subtitles",
                        vec![
                            Self::setting_row("Turn on subtitles", self.toggle("set-subs-on", subs_on, cx, move |this| this.catalog.set_setting("subtitles_on", if subs_on { "no" } else { "yes" }))),
                            Self::setting_row("Preferred subtitle language", self.setting_select("subtitle_lang")),
                        ],
                    ))
                    .child(self.settings_card(Icon::AudioLines, "Audio language", vec![Self::setting_row("Preferred audio language", self.setting_select("audio_lang"))]))
                    .child(self.settings_card(
                        Icon::SkipForward,
                        "Episodes",
                        vec![
                            Self::setting_row("Autoplay next episode", self.toggle("set-autoplay", autoplay, cx, move |this| this.catalog.set_setting("autoplay", if autoplay { "off" } else { "on" }))),
                        ],
                    ))
                    .into_any_element()
            }
            SettingsSection::Metadata => self.render_metadata_settings(window, cx),
            SettingsSection::Overview => self.render_overview(cx),
            SettingsSection::FixMatches => self.render_fix_matches(window, cx),
            SettingsSection::Maintenance => self.render_maintenance(cx),
            SettingsSection::Server => self.render_server_settings(cx),
            SettingsSection::Libraries => self.render_libraries_settings(cx),
            SettingsSection::Appearance => {
                let current = self.catalog.setting("theme").unwrap_or_else(|| "dark".into());
                let choice = |value: &'static str, label: &'static str, icon_name: Icon, cx: &mut Context<Self>| {
                    let selected = current == value;
                    // Swatch: a tiny page in that theme (System is split).
                    // GPUI clips without rounding, so each pane rounds its
                    // own outer corners to sit inside the swatch's border.
                    let pane = |bg: u32, card: u32, line: u32, left: bool, right: bool| {
                        let r = px(7.);
                        div()
                            .when(left, |el| el.rounded_tl(r).rounded_bl(r))
                            .when(right, |el| el.rounded_tr(r).rounded_br(r))
                            .flex_1()
                            .h_full()
                            .p(px(8.))
                            .bg(gpui_kit::rgb(bg))
                            .flex()
                            .flex_col()
                            .gap(px(5.))
                            .child(div().w(px(36.)).h(px(5.)).rounded_full().bg(gpui_kit::rgb(line)))
                            .child(div().flex().gap(px(5.)).child(div().w(px(22.)).h(px(28.)).rounded(px(4.)).bg(gpui_kit::rgb(card))).child(div().w(px(22.)).h(px(28.)).rounded(px(4.)).bg(gpui_kit::rgb(card))))
                    };
                    let swatch = div().h(px(64.)).w_full().rounded(px(8.)).overflow_hidden().border_1().border_color(theme::border()).flex().children(match value {
                        "light" => vec![pane(0xf5f5f6, 0xffffff, 0xd4d4d8, true, true)],
                        "dark" => vec![pane(0x060607, 0x232325, 0x46464c, true, true)],
                        _ => vec![pane(0xf5f5f6, 0xffffff, 0xd4d4d8, true, false), pane(0x060607, 0x232325, 0x46464c, false, true)],
                    });
                    div()
                        .id(SharedString::from(format!("theme-{value}")))
                        .flex_1()
                        .min_w(px(150.))
                        .p(px(12.))
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .rounded(px(theme::RADIUS_LG))
                        .border_1()
                        .cursor_pointer()
                        .border_color(if selected { alpha(theme::accent(), 0.55) } else { theme::border() })
                        .bg(if selected { theme::surface_secondary() } else { theme::surface() })
                        .hover(|s| s.border_color(theme::segment()))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.catalog.set_setting("theme", value);
                            cx.notify();
                        }))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(div().size(px(28.)).rounded(px(6.)).border_1().border_color(theme::border()).bg(theme::background()).flex().items_center().justify_center().child(icon(icon_name, 14., theme::foreground())))
                                .when(selected, |el| el.child(div().size(px(20.)).rounded_full().bg(theme::accent()).flex().items_center().justify_center().child(icon(Icon::Check, 12., theme::accent_foreground())))),
                        )
                        .child(div().text_size(px(13.)).font_weight(gpui_kit::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(label))
                        .child(swatch)
                };
                div()
                    .flex()
                    .flex_col()
                    .gap(px(14.))
                    .child(self.settings_card(
                        Icon::Palette,
                        "Theme",
                        vec![div().flex().flex_wrap().gap(px(12.)).child(choice("light", "Light", Icon::Sun, cx)).child(choice("dark", "Dark", Icon::Moon, cx)).child(choice("system", "System", Icon::Monitor, cx)).into_any_element()],
                    ))
                    .child(div().px(px(4.)).child(caption("System follows your Mac's appearance. The player always stays dark.")))
                    .into_any_element()
            }
        };
        let heading = match section {
            SettingsSection::Playback => "Playback",
            SettingsSection::Libraries => "Libraries",
            SettingsSection::Appearance => "Appearance",
            SettingsSection::Metadata => "Metadata & episode markers",
            SettingsSection::Overview => "Overview",
            SettingsSection::FixMatches => "Fix matches",
            SettingsSection::Maintenance => "Maintenance & diagnostics",
            SettingsSection::Server => "Plexy Server",
        };
        div()
            .when(section == SettingsSection::FixMatches, |el| el.h(self.viewport.height).min_h(px(440.)))
            .px(px(PAGE_X))
            .pt(px(86.))
            .pb(px(38.))
            .flex()
            .gap(px(if compact { 16. } else { 28. }))
            .when(compact, |el| el.flex_col())
            .child(self.render_settings_nav(section, compact, cx))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(surface::page_title(heading))
                    .child(content)
                    .with_animation(SharedString::from(format!("settings-{section:?}")), MotionSpec::page().animation(), |el, t| el.relative().opacity(t).top(px(crate::ui::motion::PAGE_RISE * (1. - t)))),
            )
            .into_any_element()
    }

    // MARK: Sidebar

    fn render_settings_nav(&self, section: SettingsSection, compact: bool, cx: &mut Context<Self>) -> AnyElement {
        let item = |id: &'static str, label: &'static str, name: Icon, target: SettingsSection, cx: &mut Context<Self>| {
            let active = section == target;
            div()
                .id(id)
                .h(px(34.))
                .px(px(10.))
                .flex()
                .items_center()
                .gap(px(10.))
                .rounded(px(theme::RADIUS))
                .border_1()
                .cursor_pointer()
                .text_size(px(13.))
                .border_color(gpui_kit::hsla(0., 0., 0., 0.))
                .when(active, |el| el.bg(theme::foreground()).text_color(theme::background()).font_weight(gpui_kit::FontWeight::SEMIBOLD))
                .when(!active, |el| el.text_color(theme::muted()).hover(|s| s.bg(theme::default_soft()).text_color(theme::foreground())))
                .child(icon(name, 16., if active { theme::background() } else { theme::muted() }))
                .child(label)
                .on_click(cx.listener(move |this, _, _, cx| {
                    if !active {
                        this.shell_scroll.set_offset(gpui_kit::point(px(0.), px(0.)));
                        this.open_select = None;
                    }
                    this.settings_section = target;
                    this.screen = Screen::Settings;
                    this.remap = None;
                    cx.notify();
                }))
        };
        let group = |text: &'static str| surface::label(text).px(px(10.)).pt(px(14.)).pb(px(4.));
        div()
            .flex_none()
            .flex()
            .gap(px(2.))
            .when(!compact, |el| el.w(px(196.)).flex_col())
            .when(compact, |el| el.flex_wrap())
            .child(item("settings-overview", "Overview", Icon::Home, SettingsSection::Overview, cx))
            .child(item("settings-playback", "Playback", Icon::Captions, SettingsSection::Playback, cx))
            .child(item("settings-appearance", "Appearance", Icon::Palette, SettingsSection::Appearance, cx))
            .when(!compact, |el| el.child(group("Library")))
            .child(item("settings-libraries", "Libraries", Icon::Library, SettingsSection::Libraries, cx))
            .child(item("settings-matches", "Fix matches", Icon::Search, SettingsSection::FixMatches, cx))
            .child(item("settings-metadata", "Metadata & markers", Icon::Film, SettingsSection::Metadata, cx))
            .when(crate::variant::current().supports_hosting(), |el| el.child(item("settings-server", "Plexy Server", Icon::Server, SettingsSection::Server, cx)))
            .child(item("settings-maintenance", "Maintenance", Icon::Server, SettingsSection::Maintenance, cx))
            .into_any_element()
    }

    // MARK: Overview

    fn render_overview(&self, cx: &mut Context<Self>) -> AnyElement {
        use crate::updates::UpdateStatus;
        let checking = matches!(self.update_status, UpdateStatus::Checking);
        let status = match &self.update_status {
            UpdateStatus::Idle => None,
            UpdateStatus::Checking => Some(("Checking for updates…".to_string(), Tone::Neutral)),
            UpdateStatus::Current => Some(("You’re up to date".to_string(), Tone::Success)),
            UpdateStatus::Available { version, .. } => Some((format!("Plexy {version} is available"), Tone::Accent)),
            UpdateStatus::Failed => Some(("Couldn’t check. Try again in a moment.".to_string(), Tone::Danger)),
        };
        let download = match &self.update_status {
            UpdateStatus::Available { download, .. } => Some(download.clone()),
            _ => None,
        };
        let actions = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .when_some(status, |el, (text, tone)| el.child(badge(text, tone)))
            .when_some(download, |el, url| el.child(Button::new("download-update", "Download update").primary().build().on_click(move |_, _, cx| cx.open_url(&url))))
            .child(Button::new("check-update", if checking { "Checking…" } else { "Check for updates" }).icon(Icon::Refresh).build().loading(checking).on_click(cx.listener(|this, _, _, cx| {
                if matches!(this.update_status, UpdateStatus::Checking) {
                    return;
                }
                this.update_status = UpdateStatus::Checking;
                cx.notify();
                let check = cx.background_spawn(async { crate::updates::check().unwrap_or(UpdateStatus::Failed) });
                cx.spawn(async move |this, cx| {
                    let status = check.await;
                    this.update(cx, |this, cx| {
                        this.update_status = status;
                        cx.notify();
                    })
                    .ok();
                })
                .detach();
            })));
        let updates = card().child(card_header(
            Some(Icon::PlexyLogo),
            "Plexy app updates",
            Some(format!("Installed version {}", crate::updates::version()).into()),
            Some(actions.into_any_element()),
        ));

        let connected = crate::metadata::token(&self.catalog).is_some();
        let summary = card().child(card_header(Some(Icon::Monitor), "This Mac", None, None)).child(
            div()
                .px(px(PAD))
                .pb(px(PAD))
                .flex()
                .flex_wrap()
                .gap(px(10.))
                .child(surface::stat(self.libraries.len().to_string(), "Libraries"))
                .child(surface::stat(self.movies().len().to_string(), "Movies"))
                .child(surface::stat(self.shows().len().to_string(), "TV shows"))
                .child(surface::stat(if connected { "Connected" } else { "Off" }, "TMDB metadata")),
        );
        div().flex().flex_col().gap(px(STACK)).child(updates).child(summary).into_any_element()
    }

    // MARK: Libraries

    fn render_server_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let (running, starting, failed, url, message) = {
            let host = crate::server_host::host();
            (
                host.is_running(),
                host.state() == crate::server_host::HostState::Starting,
                host.state() == crate::server_host::HostState::Failed,
                host.url(),
                host.message()
                    .unwrap_or("Plexy Server is part of the unified Plexy app.")
                    .to_string(),
            )
        };
        let state_label = if running {
            "Running"
        } else if starting {
            "Starting…"
        } else if failed {
            "Stopped with an error"
        } else {
            "Stopped"
        };
        let status_color = if running {
            theme::accent()
        } else if failed {
            theme::warning()
        } else {
            theme::muted()
        };
        let run_on_launch = self.catalog.setting("run_server_on_launch").as_deref() != Some("0");
        let keep = self.keep_server_running;
        let data = crate::server_host::ServerHost::data_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "Unavailable".into());
        let actions = div()
            .flex()
            .gap(px(8.))
            .child(
                Button::new(
                    "server-start-stop",
                    if running || starting { "Stop server" } else { "Start server" },
                )
                .icon(if running || starting { Icon::Pause } else { Icon::Play })
                .primary()
                .build()
                .on_click(cx.listener(|_, _, _, cx| {
                    let mut host = crate::server_host::host();
                    if host.is_running() || host.state() == crate::server_host::HostState::Starting {
                        host.stop();
                    } else {
                        host.start();
                    }
                    cx.notify();
                })),
            )
            .when_some(url.clone(), |el, url| {
                el.child(
                    Button::new("server-open-admin", "Open server admin")
                        .icon(Icon::Server)
                        .build()
                        .on_click(cx.listener(move |_, _, _, cx| cx.open_url(&url))),
                )
            });
        div()
            .flex()
            .flex_col()
            .gap(px(STACK))
            .child(self.settings_card(
                Icon::Server,
                "Plexy Server",
                vec![
                    Self::setting_row(
                        "Status",
                        div()
                            .flex()
                            .flex_col()
                            .items_end()
                            .gap(px(3.))
                            .child(div().text_size(px(13.)).font_weight(gpui_kit::FontWeight::SEMIBOLD).text_color(status_color).child(state_label))
                            .child(div().max_w(px(360.)).text_size(px(11.)).text_color(theme::muted()).child(message)),
                    ),
                    Self::setting_row("Controls", actions.into_any_element()),
                    Self::setting_row(
                        "Run at launch",
                        self.toggle("server-run-launch", run_on_launch, cx, move |this| {
                            this.catalog.set_setting("run_server_on_launch", if run_on_launch { "0" } else { "1" });
                        }),
                    ),
                    Self::setting_row(
                        "Keep running after closing the window",
                        self.toggle("server-keep-running", keep, cx, move |this| {
                            this.keep_server_running = !keep;
                            crate::server_host::set_keep_running(!keep);
                            this.catalog.set_setting("keep_server_running", if keep { "0" } else { "1" });
                        }),
                    ),
                ],
            ))
            .child(self.settings_card(
                Icon::Folder,
                "Server data",
                vec![
                    Self::setting_row("Library and account store", div().font_family("Menlo").text_size(px(11.)).text_color(theme::muted()).child(data)),
                    Self::setting_row("Web UI", body("Open the server address in a browser, or use the admin button above to create the owner, add media folders, and enable LAN access.")),
                ],
            ))
            .into_any_element()
    }

    fn render_libraries_settings(&self, cx: &mut Context<Self>) -> AnyElement {
        let status = self.catalog.status.lock().clone();
        let actions = div()
            .flex()
            .gap(px(8.))
            .child(Button::new("lib-scan-all", if status.running { "Scanning…" } else { "Rescan all" }).icon(Icon::Refresh).build().on_click(cx.listener(|this, _, _, cx| {
                this.catalog.scan(None, false);
                cx.notify();
            })))
            .child(Button::new("add-library", "Add library").icon(Icon::FolderPlus).primary().build().on_click(cx.listener(|this, _, window, cx| {
                this.add_library_open = true;
                this.library_error = None;
                window.focus(&this.focus_handle(), cx);
                cx.notify();
            })));
        let header = card_header(Some(Icon::Library), "On this Mac", Some("Folders Plexy watches for movies and TV shows.".into()), Some(actions.into_any_element()));
        let mut card = card().flex().flex_col().child(header);
        if self.libraries.is_empty() {
            card = card.child(div().border_t_1().border_color(theme::separator()).px(px(PAD)).py(px(20.)).child(body("No libraries yet. Add a Movies or TV folder to start building your library.")));
        }
        for library in &self.libraries {
            let id = library.id;
            let auto = library.auto_refresh;
            let kind_icon = if library.kind == crate::catalog::LibraryKind::Shows { Icon::Tv } else { Icon::Film };
            let paths = div().flex().flex_col().gap(px(3.)).children(library.roots.iter().map(|root| {
                let root_id = root.id;
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().min_w_0().truncate().font_family("Menlo").text_size(px(11.)).text_color(if root.available { theme::muted() } else { theme::warning() }).child(root.path.display().to_string()))
                    .when(!root.available, |el| el.child(div().flex_none().text_size(px(11.)).text_color(theme::warning()).child("Unavailable")))
                    .when(library.roots.len() > 1, |el| {
                        el.child(
                            div()
                                .id(SharedString::from(format!("root-remove-{root_id}")))
                                .flex_none()
                                .cursor_pointer()
                                .child(icon(Icon::Close, 12., theme::muted()))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.catalog.remove_root(root_id);
                                    this.reload_catalog(cx);
                                    cx.notify();
                                })),
                        )
                    })
            }));
            card = card.child(
                div()
                    .border_t_1()
                    .border_color(theme::separator())
                    .px(px(PAD))
                    .py(px(12.))
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(surface::icon_tile(kind_icon, 36.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(surface::title(library.name.clone()))
                            .child(paths),
                    )
                    .child(
                        div()
                            .flex_none()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child(div().min_w(px(24.)).mr(px(6.)).text_size(px(13.)).font_weight(gpui_kit::FontWeight::SEMIBOLD).text_color(theme::muted()).child(library.item_count.to_string()))
                            .child(
                                badge(if auto { "Auto-refresh on" } else { "Auto-refresh off" }, if auto { Tone::Success } else { Tone::Neutral })
                                    .id(SharedString::from(format!("lib-auto-{id}")))
                                    .cursor_pointer()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.catalog.set_auto_refresh(id, !auto);
                                        this.reload_catalog(cx);
                                        cx.notify();
                                    })),
                            )
                            .child(Button::icon_only(format!("lib-root-{id}"), Icon::FolderPlus).build().on_click(cx.listener(move |this, _, window, cx| this.add_root(id, window, cx))))
                            .child(Button::icon_only(format!("lib-scan-{id}"), Icon::Refresh).build().on_click(cx.listener(move |this, _, _, cx| {
                                this.catalog.scan(Some(id), false);
                                cx.notify();
                            })))
                            .child(Button::icon_only(format!("lib-remove-{id}"), Icon::Trash).danger_hover().build().on_click(cx.listener(move |this, _, _, cx| {
                                this.catalog.remove_library(id);
                                this.reload_catalog(cx);
                                cx.notify();
                            }))),
                    ),
            );
        }
        let scan_line = if status.running {
            Some(format!("Scanning {} — {} files checked, {} new", status.library.clone().unwrap_or_default(), status.scanned, status.added))
        } else {
            status.finished_at.map(|_| format!("Last scan: {} files checked, {} new", status.scanned, status.added))
        };
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(card)
            .when_some(scan_line, |el, line| el.child(div().px(px(6.)).text_size(px(12.)).text_color(theme::muted()).child(line)))
            .children(status.errors.iter().map(|error| div().px(px(6.)).text_size(px(12.)).text_color(theme::danger()).child(error.clone())))
            .into_any_element()
    }

    // MARK: Fix matches

    pub(crate) fn load_fix_matches(&mut self) -> bool {
        if self.screen != Screen::Settings
            || self.settings_section != SettingsSection::FixMatches
            || self.fix_matches.is_some()
        {
            return false;
        }
        let (manual_keys, review_keys) = self.catalog.match_review_keys();
        let connected = self.catalog.tmdb_token().is_some();
        let mut rows: Vec<MatchRow> = Vec::new();
        let mut push = |key: TitleKey, title: String, year: Option<u32>, poster: Option<std::path::PathBuf>, is_show: bool| {
            let meta = self.metas.get(&key).filter(|m| m.matched);
            let manual = manual_keys.contains(&key);
            let review = review_keys.contains(&key);
            let (state, detail, source) = match meta {
                Some(meta) => (
                    0,
                    format!("Matched to “{}”{}", meta.name, meta.year.map(|y| format!(" ({y})")).unwrap_or_default()),
                    format!("{} · TMDB {}", if manual || meta.manual { "Matched by you" } else { "Matched by search" }, meta.tmdb_id),
                ),
                None if review => (1, "Several TMDB results fit this title.".into(), "Choose the right one with Remap".into()),
                None => (2, "No TMDB match yet.".into(), if connected { "Refresh metadata or remap it by hand".into() } else { "Connect TMDB in Metadata & markers".into() }),
            };
            let poster = meta.and_then(|m| m.poster.clone()).or(poster);
            let year = meta.and_then(|m| m.year).or(year);
            rows.push(MatchRow { key, title, year, poster, is_show, manual, state, detail, source });
        };
        for show in self.shows() {
            let view = crate::personal_ui::TitleView::from_show(&show);
            push(TitleKey::Show(show.key.clone()), show.title.clone(), view.year, view.poster, true);
        }
        for movie in self.movies() {
            push(TitleKey::Movie(movie.path.clone()), movie.title.clone(), movie.year, movie.poster.clone(), false);
        }
        rows.sort_by(|a, b| a.state.cmp(&b.state).reverse().then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
        let attention = rows.iter().filter(|row| row.state != 0).count();
        self.fix_matches = Some(FixMatches { rows, attention, visible: Vec::new() });
        self.filter_fix_matches();
        true
    }

    pub(crate) fn filter_fix_matches(&mut self) {
        let query = self.fix_query.trim().to_lowercase();
        if let Some(matches) = &mut self.fix_matches {
            matches.visible = matches.rows.iter().enumerate()
                .filter(|(_, row)| match self.fix_filter {
                    1 => row.state != 0,
                    2 => row.state == 0,
                    _ => true,
                })
                .filter(|(_, row)| query.is_empty()
                    || row.title.to_lowercase().contains(&query)
                    || row.detail.to_lowercase().contains(&query))
                .map(|(index, _)| index)
                .collect();
        }
        self.fix_matches_scroll.0.borrow().base_handle.set_offset(gpui_kit::point(px(0.), px(0.)));
    }

    fn render_fix_matches(&self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(matches) = &self.fix_matches else {
            return body("Loading titles…").into_any_element();
        };
        let total = matches.rows.len();
        let attention = matches.attention;
        let matched = total - attention;
        let filter = self.fix_filter;

        let view = cx.entity().downgrade();
        let tabs = crate::ui::controls::segmented(
            "fix-filter",
            [("All titles", Some(total)), ("Needs attention", Some(attention)), ("Matched", Some(matched))],
            filter as usize,
            move |index, _, cx| {
                view.update(cx, |this, cx| {
                    this.fix_filter = index as u8;
                    this.filter_fix_matches();
                    cx.notify();
                })
                .ok();
            },
        );
        let search = crate::ui::controls::search_compact(
            self.text_field("fix-search", Field::FixSearch, &self.fix_focus, &self.fix_query, "Search titles or matches…", window, cx),
        )
        .w(px(280.));
        let toolbar = div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .child(tabs)
            .child(search);

        let list = if matches.visible.is_empty() {
            card().px(px(PAD)).py(px(20.)).child(body(if total == 0 {
                "Add a library to see its titles here."
            } else {
                "No titles match this filter."
            })).into_any_element()
        } else {
            gpui_kit::uniform_list(
                "fix-matches-list",
                matches.visible.len(),
                cx.processor(|this, range: std::ops::Range<usize>, _, cx| {
                    let Some(matches) = &this.fix_matches else { return Vec::new() };
                    range.filter_map(|index| matches.visible.get(index))
                        .map(|&index| this.render_match_row(&matches.rows[index], cx))
                        .collect::<Vec<_>>()
                }),
            )
            .track_scroll(&self.fix_matches_scroll)
            .flex_1()
            .min_h_0()
            .into_any_element()
        };
        div().flex_1().min_h_0().flex().flex_col().gap(px(STACK)).child(toolbar).child(list).into_any_element()
    }

    fn render_match_row(&self, row: &MatchRow, cx: &mut Context<Self>) -> AnyElement {
        let (label, tone) = match row.state {
            0 => ("Matched", Tone::Success),
            1 => ("Needs attention", Tone::Warning),
            _ => ("Not matched", Tone::Neutral),
        };
        let poster = self.poster(row.poster.clone(), &row.title, 40., 60.);
        let key = row.key.clone();
        let (title, year, is_show, manual) = (row.title.clone(), row.year, row.is_show, row.manual);
        let row_card = card()
            .px(px(14.))
            .py(px(10.))
            .flex()
            .items_center()
            .gap(px(14.))
            .child(div().flex_none().child(poster))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(3.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(div().truncate().text_size(px(14.)).font_weight(gpui_kit::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(row.title.clone()))
                            .when_some(row.year, |el, y| el.child(div().text_size(px(13.)).text_color(theme::muted()).child(y.to_string())))
                            .child(badge(label, tone)),
                    )
                    .child(div().truncate().text_size(px(13.)).text_color(alpha(theme::foreground(), 0.8)).child(row.detail.clone()))
                    .child(div().truncate().text_size(px(12.)).text_color(theme::muted()).child(row.source.clone())),
            )
            .child(Button::new(format!("remap-{}", key.encode()), "Remap").build().on_click(cx.listener(move |this, _, window, cx| {
                this.remap = Some(Remap {
                    key: key.clone(),
                    title: title.clone(),
                    year,
                    is_show,
                    query: title.clone(),
                    manual,
                    results: Vec::new(),
                    busy: false,
                    search_task: None,
                    message: None,
                });
                window.focus(&this.remap_focus, cx);
                this.remap_search(cx);
            })));
        div().h(px(90.)).pb(px(8.)).child(row_card).into_any_element()
    }

    pub fn remap_search(&mut self, cx: &mut Context<Self>) {
        let Some(remap) = &mut self.remap else { return };
        let query = remap.query.trim().to_string();
        if query.is_empty() || remap.busy {
            return;
        }
        if crate::metadata::token(&self.catalog).is_none() {
            remap.message = Some("Connect TMDB in Metadata & markers to search.".into());
            cx.notify();
            return;
        }
        remap.busy = true;
        remap.results.clear();
        remap.message = None;
        let kind = if remap.is_show { "tv" } else { "movie" };
        let catalog = self.catalog.clone();
        cx.notify();
        let work = cx.background_spawn(async move {
            let tmdb = crate::metadata::Tmdb::new(&catalog);
            tmdb.search(kind, &query, None).map(|results| {
                results
                    .iter()
                    .filter_map(|r| {
                        Some(RemapResult {
                            id: r.get("id")?.as_i64()?,
                            kind: kind.to_string(),
                            name: r.get("title").or_else(|| r.get("name")).and_then(|v| v.as_str()).unwrap_or("Untitled").to_string(),
                            year: r.get("release_date").or_else(|| r.get("first_air_date")).and_then(|v| v.as_str()).and_then(|d| d.get(..4)).map(str::to_string),
                            overview: r.get("overview").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        })
                    })
                    .take(12)
                    .collect::<Vec<_>>()
            })
        });
        remap.search_task = Some(cx.spawn(async move |this, cx| {
            let result = work.await;
            this.update(cx, |this, cx| {
                if let Some(remap) = &mut this.remap {
                    remap.busy = false;
                    match result {
                        Ok(results) => {
                            if results.is_empty() {
                                remap.message = Some("No TMDB results. Try a different spelling.".into());
                            }
                            remap.results = results;
                        }
                        Err(_) => remap.message = Some("Couldn’t reach TMDB. Try again in a moment.".into()),
                    }
                }
                cx.notify();
            })
            .ok();
        }));
    }

    fn apply_remap(&mut self, choice: Option<RemapResult>, cx: &mut Context<Self>) {
        let Some(remap) = self.remap.take() else { return };
        match &choice {
            Some(choice) => self.catalog.set_manual_match(&remap.key, &choice.kind, choice.id),
            None => self.catalog.clear_manual_match(&remap.key),
        }
        self.metadata_message = format!("Updating “{}”…", remap.title);
        cx.notify();
        let catalog = self.catalog.clone();
        let work = cx.background_spawn(async move {
            let _worker = catalog.metadata_work.lock();
            let tmdb = crate::metadata::Tmdb::new(&catalog);
            crate::metadata::enrich_title(&catalog, &tmdb, &remap.key, &remap.title, remap.year, remap.is_show);
            catalog.bump_metadata_epoch();
        });
        cx.spawn(async move |this, cx| {
            work.await;
            this.update(cx, |this, cx| {
                this.reload_catalog(cx);
                this.metadata_message.clear();
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn render_remap_dialog(&self, window: &Window, cx: &mut Context<Self>) -> Option<crate::ui::controls::DialogParts> {
        let remap = self.remap.as_ref()?;
        let manual = remap.manual;
        let field = self.text_field("remap-query", Field::Remap, &self.remap_focus, &remap.query, "Search TMDB", window, cx).flex_1().h(px(36.));
        let results = div()
            .id("remap-results")
            .max_h(px(320.))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(4.))
            // Kit Skeleton rows while the first TMDB results load.
            .when(remap.busy && remap.results.is_empty(), |el| {
                el.children((0..3).map(|_| {
                    div().px(px(12.)).py(px(10.)).flex().flex_col().gap(px(6.))
                        .child(gpui_kit::component::skeleton::Skeleton::new().h(px(14.)).w(px(180.)).rounded(px(4.)))
                        .child(gpui_kit::component::skeleton::Skeleton::new().secondary().h(px(11.)).w_full().rounded(px(4.)))
                }))
            })
            .children(remap.results.iter().map(|result| {
                let choice = result.clone();
                div()
                    .id(SharedString::from(format!("remap-result-{}-{}", result.kind, result.id)))
                    .px(px(12.))
                    .py(px(10.))
                    .rounded(px(theme::RADIUS_LG))
                    .cursor_pointer()
                    .hover(|s| s.bg(theme::default()))
                    .flex()
                    .flex_col()
                    .gap(px(3.))
                    .child(
                        div()
                            .flex()
                            .gap(px(8.))
                            .items_baseline()
                            .child(div().text_size(px(14.)).font_weight(gpui_kit::FontWeight::SEMIBOLD).text_color(theme::foreground()).child(result.name.clone()))
                            .when_some(result.year.clone(), |el, y| el.child(div().text_size(px(12.)).text_color(theme::muted()).child(y)))
                            .child(div().text_size(px(11.)).text_color(theme::muted()).child(format!("TMDB {}", result.id))),
                    )
                    .when(!result.overview.is_empty(), |el| el.child(div().text_size(px(12.)).line_clamp(2).text_color(theme::muted()).child(result.overview.clone())))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.apply_remap(Some(choice.clone()), cx);
                        window.focus(&this.focus_handle(), cx);
                    }))
            }));
        let body = div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(body(format!("Choose the TMDB title for “{}”.", remap.title)))
            .child(
                div().flex().gap(px(8.)).child(field).child(self.button("remap-search", if remap.busy { "Searching…" } else { "Search" }, true).loading(remap.busy).on_click(cx.listener(|this, _, _, cx| this.remap_search(cx)))),
            )
            .when_some(remap.message.clone(), |el, message| el.child(body(message)))
            .child(results);
        let footer = div()
            .flex()
            .gap(px(8.))
            .when(manual, |el| {
                el.child(self.button("remap-clear", "Use automatic match", false).on_click(cx.listener(|this, _, window, cx| {
                    this.apply_remap(None, cx);
                    window.focus(&this.focus_handle(), cx);
                })))
            })
            .child(self.button("remap-cancel", "Cancel", false).on_click(cx.listener(|this, _, window, cx| {
                this.remap = None;
                window.focus(&this.focus_handle(), cx);
                cx.notify();
            })));
        Some(crate::ui::controls::dialog("Remap title", body, footer))
    }

    // MARK: Metadata & markers

    fn render_metadata_settings(&self, _window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let (ok, message) = self.token_status.lock().clone();
        let connected = crate::metadata::token(&self.catalog).is_some();
        let field = match &self.token_input {
            Some(input) => gpui_kit::component::input::Input::new(input)
                .mask_toggle()
                .aria_label("TMDB token")
                .flex_1()
                .min_w_0()
                .into_any_element(),
            None => div().into_any_element(),
        };
        let skip = self.catalog.setting("skip_markers").as_deref() != Some("off");
        let chapters = self.catalog.setting("chapter_markers").as_deref() != Some("off");
        let busy = self.metadata_busy;

        let token = div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(div().flex().items_center().gap(px(8.)).child(field).child(Button::new("set-token-save", "Save & test").build().on_click(cx.listener(|this, _, _, cx| this.save_token(cx)))))
            .when(!message.is_empty(), |el| el.child(caption(message).when(!ok, |el| el.text_color(theme::danger()))));
        let tmdb = card()
            .child(card_header(
                Some(Icon::Film),
                "TMDB metadata",
                Some("Matches your files to TMDB for titles, artwork, cast and age ratings.".into()),
                Some(if connected { badge("Connected", Tone::Success) } else { badge("Not connected", Tone::Neutral) }.into_any_element()),
            ))
            .children(rows(vec![
                token.into_any_element(),
                row("Metadata language", Some("Language for titles and overviews.".into()), self.setting_select("metadata_language")).into_any_element(),
                row("Region", Some("Used for release dates and age ratings.".into()), self.setting_select("metadata_region")).into_any_element(),
                row(
                    "Refresh metadata",
                    Some("Fetch titles, artwork and ratings again for every title.".into()),
                    Button::new("metadata-refresh", if busy { "Working…" } else { "Refresh" }).icon(Icon::Refresh).build().loading(busy).on_click(cx.listener(|this, _, _, cx| {
                        if crate::metadata::token(&this.catalog).is_some() {
                            this.run_metadata_job(false, cx);
                        } else {
                            this.metadata_message = "Connect TMDB to refresh metadata.".into();
                            cx.notify();
                        }
                    })),
                )
                .into_any_element(),
                row(
                    "Clear TMDB cache",
                    Some("Keeps your library and downloaded artwork.".into()),
                    Button::new("metadata-clear", "Clear cache").outline().build().on_click(cx.listener(|this, _, _, cx| {
                        if !this.metadata_busy {
                            this.metadata_message = match this.catalog.clear_tmdb_cache() {
                                Ok(count) => format!("Cleared {count} cached TMDB responses."),
                                Err(_) => "Couldn’t clear the TMDB cache.".into(),
                            };
                            cx.notify();
                        }
                    })),
                )
                .into_any_element(),
            ]));

        let markers = card()
            .child(card_header(Some(Icon::SkipForward), "Intro, recap & credits", Some("Show a skip button when an episode has markers.".into()), None))
            .children(rows(vec![
                row(
                    "Community skip markers",
                    Some("Look up markers on IntroDB using the show’s IMDb ID.".into()),
                    self.toggle("set-skip", skip, cx, move |this| this.catalog.set_setting("skip_markers", if skip { "off" } else { "on" })),
                )
                .into_any_element(),
                row(
                    "Video chapters",
                    Some("Use chapters named Intro, Recap or Credits.".into()),
                    self.toggle("set-chapter-markers", chapters, cx, move |this| this.catalog.set_setting("chapter_markers", if chapters { "off" } else { "on" })),
                )
                .into_any_element(),
                row(
                    "Refresh markers",
                    Some("Check episodes that have no markers cached yet.".into()),
                    Button::new("markers-refresh", "Refresh").icon(Icon::Refresh).build().on_click(cx.listener(move |this, _, _, cx| {
                        if skip {
                            this.run_metadata_job(true, cx);
                        } else {
                            this.metadata_message = "Turn on community skip markers to refresh them.".into();
                            cx.notify();
                        }
                    })),
                )
                .into_any_element(),
            ]));
        div()
            .flex()
            .flex_col()
            .gap(px(STACK))
            .when(!self.metadata_message.is_empty(), |el| el.child(div().px(px(4.)).child(body(self.metadata_message.clone()))))
            .child(tmdb)
            .child(markers)
            .child(div().px(px(4.)).child(caption("Markers are cached locally and refreshed when you play an episode whose data is missing or stale. Playback works normally without them.")))
            .into_any_element()
    }

    // MARK: Maintenance

    fn render_maintenance(&self, cx: &mut Context<Self>) -> AnyElement {
        let reset = card().border_color(alpha(theme::danger(), 0.35)).child(card_header(
            Some(Icon::Trash),
            "Reset local data",
            Some("Clears the catalog, watch progress, matches and cached artwork, then rescans. Libraries, video files, lists and preferences stay.".into()),
            Some(
                Button::new("reset-data", if self.resetting_local_data { "Resetting…" } else { "Reset…" })
                    .danger()
                    .build()
                    .track_focus(&self.reset_focus)
                    .on_click(cx.listener(|this, _, window, cx| {
                        if !this.resetting_local_data {
                            // Focus first, so the dialog returns focus here.
                            window.focus(&this.reset_focus, cx);
                            this.confirm_reset(window, cx);
                        }
                    }))
                    .into_any_element(),
            ),
        ));
        div()
            .flex()
            .flex_col()
            .gap(px(STACK))
            .child(reset)
            .when(!self.maintenance_message.is_empty(), |el| el.child(div().px(px(4.)).child(body(self.maintenance_message.clone()))))
            .into_any_element()
    }

    fn reset_local_data(&mut self, cx: &mut Context<Self>) {
        if self.resetting_local_data {
            return;
        }
        self.resetting_local_data = true;
        self.maintenance_message.clear();
        let catalog = self.catalog.clone();
        let reset = cx.background_spawn(async move { catalog.reset_local_data() });
        cx.spawn(async move |this, cx| {
            let result = reset.await;
            this.update(cx, |this, cx| {
                this.resetting_local_data = false;
                this.maintenance_message = match result {
                    Ok(errors) => {
                        this.reload_catalog(cx);
                        this.catalog.scan(None, false);
                        if errors.is_empty() {
                            "Local data cleared. Rescanning your libraries…".into()
                        } else {
                            format!("Catalog cleared and rescanning. Couldn’t clear {}.", errors.join("; "))
                        }
                    }
                    Err(error) => format!("Couldn’t reset local data: {error:#}"),
                };
                cx.notify();
            }).ok();
        }).detach();
        cx.notify();
    }

    /// The Kit alert dialog: focus trapped, Escape cancels, focus returns
    /// to the Reset button afterwards.
    fn confirm_reset(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::{button::ButtonVariant, WindowExt as _};
        let view = cx.entity().downgrade();
        window.open_alert_dialog(cx, move |dialog, _, _| {
            let view = view.clone();
            dialog
                .title("Reset local data?")
                .description("Watch progress, matches and cached artwork are removed and can’t be restored. Libraries, folders and preferences stay.")
                .ok_text("Reset")
                .ok_variant(ButtonVariant::Danger)
                .cancel_text("Cancel")
                .show_cancel(true)
                .on_ok(move |_, _, cx| {
                    view.update(cx, |this, cx| this.reset_local_data(cx)).ok();
                    true
                })
        });
    }
}
