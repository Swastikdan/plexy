use gpui_kit::{Context, FocusHandle, Window, div, prelude::*, px};

use crate::{
    app::PlayerView,
    catalog::{SegmentKind, SegmentWindow},
    personal_ui::Field,
    theme,
    ui::controls,
};

pub struct MarkerEditor {
    kind: SegmentKind,
    pub start: String,
    pub end: String,
    pub error: Option<String>,
    start_focus: FocusHandle,
    end_focus: FocusHandle,
}

impl PlayerView {
    #[allow(dead_code)] // Not offered in the player; kept for a future title-page entry.
    pub fn open_marker_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.menu = None;
        self.marker_editor = Some(MarkerEditor {
            kind: SegmentKind::Intro,
            start: String::new(),
            end: String::new(),
            error: None,
            start_focus: cx.focus_handle(),
            end_focus: cx.focus_handle(),
        });
        self.select_marker(SegmentKind::Intro);
        window.focus(&self.focus_handle(), cx);
        cx.notify();
    }

    fn select_marker(&mut self, kind: SegmentKind) {
        let window = self.effective_segments().kind(kind);
        if let Some(editor) = &mut self.marker_editor {
            editor.kind = kind;
            editor.start = window
                .map(|w| format!("{:.2}", w.start))
                .unwrap_or_default();
            editor.end = window.map(|w| format!("{:.2}", w.end)).unwrap_or_default();
            editor.error = None;
        }
    }

    pub fn save_marker(&mut self, reset: bool, cx: &mut Context<Self>) {
        let (Some(editor), Some(path)) = (&mut self.marker_editor, &self.media) else {
            return;
        };
        let marker = if reset {
            None
        } else {
            let parse = || {
                let start = editor.start.trim().parse::<f64>().ok()?;
                let end = editor.end.trim().parse::<f64>().ok()?;
                (start >= 0. && end > start && end <= self.state.duration).then_some(
                    SegmentWindow {
                        start,
                        end,
                        confidence: None,
                        submission_count: None,
                    },
                )
            };
            let Some(marker) = parse() else {
                editor.error = Some("Enter a start and end in seconds within the video.".into());
                cx.notify();
                return;
            };
            Some(marker)
        };
        match self.catalog.save_manual_segment(path, editor.kind, marker) {
            Ok(()) => {
                self.manual_segments.set(editor.kind, marker);
                self.marker_editor = None;
            }
            Err(error) => editor.error = Some(format!("Couldn’t save marker. {error}")),
        }
        cx.notify();
    }

    pub fn render_marker_editor(
        &self,
        cx: &mut Context<Self>,
        window: &Window,
    ) -> Option<controls::DialogParts> {
        let editor = self.marker_editor.as_ref()?;
        let tabs = controls::tabs(
            [
                (SegmentKind::Intro, "Intro"),
                (SegmentKind::Recap, "Recap"),
                (SegmentKind::Outro, "Credits"),
            ]
            .into_iter()
            .map(|(kind, label)| {
                controls::tab(label, label, kind == editor.kind)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.select_marker(kind);
                        window.focus(&this.focus_handle(), cx);
                        cx.notify();
                    }))
                    .into_any_element()
            }),
        );
        let row = |start: bool, cx: &mut Context<Self>| {
            let (id, label, value, focus, field) = if start {
                (
                    "marker-start",
                    "Start",
                    &editor.start,
                    &editor.start_focus,
                    Field::MarkerStart,
                )
            } else {
                (
                    "marker-end",
                    "End",
                    &editor.end,
                    &editor.end_focus,
                    Field::MarkerEnd,
                )
            };
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(div().w(px(40.)).text_size(px(13.)).child(label))
                .child(
                    self.text_field(id, field, focus, value, "Seconds", window, cx)
                        .flex_1()
                        .min_w_0(),
                )
                .child(
                    self.button(format!("{id}-playhead"), "Use playhead", false)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(editor) = &mut this.marker_editor {
                                let field = if start {
                                    &mut editor.start
                                } else {
                                    &mut editor.end
                                };
                                *field = format!("{:.2}", this.state.position);
                                editor.error = None;
                                cx.notify();
                            }
                        })),
                )
        };
        let body = div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(tabs)
            .child(row(true, cx))
            .child(row(false, cx))
            .when_some(editor.error.clone(), |el, error| {
                el.child(
                    div()
                        .text_size(px(12.))
                        .text_color(theme::danger())
                        .child(error),
                )
            });
        let footer = div()
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .when(self.manual_segments.kind(editor.kind).is_some(), |el| {
                el.child(
                    self.button("marker-reset", "Reset to default", false)
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.save_marker(true, cx);
                            window.focus(&this.focus_handle(), cx);
                        })),
                )
            })
            .child(
                self.button("marker-cancel", "Cancel", false)
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.marker_editor = None;
                        window.focus(&this.focus_handle(), cx);
                        cx.notify();
                    })),
            )
            .child(
                self.button("marker-save", "Save marker", true)
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.save_marker(false, cx);
                        if this.marker_editor.is_none() {
                            window.focus(&this.focus_handle(), cx);
                        }
                    })),
            );
        Some(controls::dialog("Edit markers", body, footer))
    }
}
