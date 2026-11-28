//! Time-based motion primitives for the Plexy UI.
//!
//! This module follows `docs/MOTION.md` sections 4 and 5. It owns the shared
//! durations, curves and the target-driven [`Tween`]; screens should not name
//! raw UI durations or easing functions themselves.
//!
//! The foundation here is deliberately small:
//!
//! - [`Easing`] samples the exact CSS cubic-beziers used by the web app.
//! - [`MotionSpec`] groups a duration, delay and easing into a token.
//! - [`Tween`] animates toward a target and rebases from its current value when
//!   that target changes, so interactions are interruptible.
//! - [`PresenceState`] is the mount/unmount bookkeeping an exit helper needs.
//!   A full `Presence` element is intentionally not included yet; the tween
//!   element is the part the rest of the engine builds on.

use std::{
    panic::Location,
    time::{Duration, Instant},
};

use gpui_kit::{
    AnyElement, App, Bounds, Element, ElementId, GlobalElementId, InspectorElementId, IntoElement,
    LayoutId, Pixels, Window,
};

/// How far (px) a page rises while it fades in with [`MotionSpec::page`].
pub const PAGE_RISE: f32 = 10.;

/// The shortest tween duration the engine will run.
///
/// A zero duration would divide by zero while sampling. One millisecond is
/// effectively a cut, but keeps the math well-defined.
const MIN_DURATION: Duration = Duration::from_millis(1);

/// A cubic-bezier UI easing curve.
///
/// The control points match the web app's tokens. [`Easing::Linear`] and
/// [`Easing::OutQuint`] are specialized so they do not pay for a bezier solve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Easing {
    /// `cubic-bezier(0.23, 1, 0.32, 1)` — entrances, hovers and most
    /// transitions.
    Standard,
    /// `cubic-bezier(0.16, 1, 0.30, 1)` — overlays and page content.
    Enter,
    /// `cubic-bezier(0.40, 0, 1, 1)` — dismissals.
    Exit,
    /// `cubic-bezier(0.65, 0, 0.35, 1)` — size and position moves.
    InOut,
    /// Linear; use for continuous rotation (the spinner), not for UI fades.
    Linear,
    /// `1 - (1 - t)^5`, the ease-out-quint approximation used by the current
    /// hero and card animations.
    OutQuint,
}

impl Easing {
    /// Sample the easing curve at `t`.
    ///
    /// `t` is clamped to `0..=1` and the result is clamped to `0..=1` as well.
    /// The output clamp matters for opacity and colors; a spring, if added
    /// later, can be allowed to overshoot in its animator instead.
    pub fn sample(self, t: f32) -> f32 {
        let t = t.clamp(0.0, 1.0);

        let value = match self {
            Easing::Linear => t,
            Easing::OutQuint => 1.0 - (1.0 - t).powi(5),
            Easing::Standard => cubic_bezier(0.23, 1.0, 0.32, 1.0, t),
            Easing::Enter => cubic_bezier(0.16, 1.0, 0.30, 1.0, t),
            Easing::Exit => cubic_bezier(0.40, 0.0, 1.0, 1.0, t),
            Easing::InOut => cubic_bezier(0.65, 0.0, 0.35, 1.0, t),
        };

        value.clamp(0.0, 1.0)
    }
}

/// A duration, delay and easing curve for one transition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MotionSpec {
    /// How long the transition runs, excluding the delay.
    pub duration: Duration,
    /// How long to wait before sampling the curve.
    pub delay: Duration,
    /// The curve applied to normalized progress.
    pub easing: Easing,
}

impl MotionSpec {
    /// Build a custom spec.
    pub const fn new(duration: Duration, delay: Duration, easing: Easing) -> Self {
        Self {
            duration,
            delay,
            easing,
        }
    }

    /// 90 ms: press feedback, icon swaps and focus rings.
    pub const fn instant() -> Self {
        Self::new(Duration::from_millis(90), Duration::ZERO, Easing::Standard)
    }

    /// 140 ms: hover, chip/tab selection and tiny fades.
    pub const fn fast() -> Self {
        Self::new(Duration::from_millis(140), Duration::ZERO, Easing::Standard)
    }

    /// 200 ms: buttons, fields, toggles and chevrons.
    pub const fn base() -> Self {
        Self::new(Duration::from_millis(200), Duration::ZERO, Easing::Standard)
    }

    /// 300 ms: dots, selected indicators and page content.
    pub const fn slow() -> Self {
        Self::new(Duration::from_millis(300), Duration::ZERO, Easing::Standard)
    }

    /// 180 ms enter: menus, popovers, dropdowns and the volume panel.
    pub const fn overlay_in() -> Self {
        Self::new(Duration::from_millis(180), Duration::ZERO, Easing::Enter)
    }

    /// 140 ms exit. Exits are intentionally faster than entrances.
    pub const fn overlay_out() -> Self {
        Self::new(Duration::from_millis(140), Duration::ZERO, Easing::Exit)
    }

    /// 240 ms enter: a page or settings section arriving. Pair with
    /// [`PAGE_RISE`]: fade from 0 and rise into place.
    pub const fn page() -> Self {
        Self::new(Duration::from_millis(240), Duration::ZERO, Easing::Enter)
    }

    /// 700 ms: the hero crossfade and hero copy timeline.
    pub const fn hero() -> Self {
        Self::new(Duration::from_millis(700), Duration::ZERO, Easing::Standard)
    }
}

impl MotionSpec {
    /// A one-shot GPUI [`gpui_kit::Animation`] for `with_animation`, using this
    /// token's duration and curve. A delay is not representable here; use
    /// `with_animations` with a leading hold step, or a [`Tween`].
    pub fn animation(self) -> gpui_kit::Animation {
        let easing = self.easing;
        gpui_kit::Animation::new(self.duration.max(MIN_DURATION)).with_easing(move |t| easing.sample(t))
    }

    /// The same token, repeating (spinners).
    pub fn repeating(self) -> gpui_kit::Animation {
        self.animation().repeat()
    }

    /// The same token with another duration (rare; prefer a named token).
    pub const fn with_duration(mut self, duration: Duration) -> Self {
        self.duration = duration;
        self
    }
}

/// Linear interpolation. `t` is not clamped; callers animating opacity should
/// pass an eased value from [`Easing::sample`] or clamp it themselves.
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// State for a tween, kept across frames by GPUI's element-state store.
///
/// The fields are deliberately private: the element owns the transition
/// lifecycle, and callers only see the sampled value through their animator.
#[derive(Clone, Copy, Debug)]
struct TweenState {
    value: f32,
    from: f32,
    target: f32,
    started: Instant,
    delay_until: Instant,
    done: bool,
}

impl TweenState {
    /// Start a new tween at zero. A target of zero is already settled, so it
    /// does not schedule any frames.
    fn new(target: f32, spec: MotionSpec, now: Instant) -> Self {
        let mut state = Self {
            value: 0.0,
            from: 0.0,
            target,
            started: now,
            delay_until: now.checked_add(spec.delay).unwrap_or(now),
            done: false,
        };

        if state.from == state.target {
            state.value = state.target;
            state.done = true;
        }

        state
    }

    /// Advance the tween to `now`, rebasing if the requested target changed.
    ///
    /// Returns `true` when the tween is settled and no more animation frames
    /// are needed.
    fn advance(&mut self, target: f32, spec: MotionSpec, now: Instant) -> bool {
        if self.target != target {
            // Interruption: continue from wherever the old tween is now rather
            // than snapping back to 0 or 1.
            self.from = self.value;
            self.target = target;
            self.started = now;
            self.delay_until = now.checked_add(spec.delay).unwrap_or(now);
            self.done = false;
        }

        if self.done {
            return true;
        }

        // A target equal to the current start value needs no frames. This also
        // covers the common "animate from 0 to 0" mount case.
        if self.from == self.target {
            self.value = self.target;
            self.done = true;
            return true;
        }

        let elapsed = now.saturating_duration_since(self.started);
        let delay = self.delay_until.saturating_duration_since(self.started);
        if elapsed < delay {
            self.value = self.from;
            return false;
        }

        let active = elapsed.saturating_sub(delay);
        let duration = spec.duration.max(MIN_DURATION);
        let t = (active.as_secs_f32() / duration.as_secs_f32()).clamp(0.0, 1.0);

        self.value = lerp(self.from, self.target, spec.easing.sample(t));
        self.done = t >= 1.0;

        self.done
    }
}

/// A target-driven element that interpolates a value and rewrites its child
/// with an animator closure.
///
/// This is modeled on GPUI's `AnimationElement`, with two differences that
/// matter for interactive UI:
///
/// - It animates toward a caller-supplied target instead of always running
///   `0 -> 1`.
/// - When the target changes mid-flight, it rebases from the current value and
///   resets the delay, so a hover or menu can reverse without a snap.
///
/// Frames are requested only while the tween is active. A settled tween costs
/// nothing until its target changes again.
///
/// The free [`tween`] function creates a tween without a child because its
/// signature is animator-only. Attach the child with [`Tween::child`], or use
/// [`TweenExt::with_tween`] for the natural element-first form:
///
/// ```ignore
/// div()
///     .opacity(0.5)
///     .with_tween("menu", if open { 1.0 } else { 0.0 }, MotionSpec::overlay_in(), |el, t| {
///         el.opacity(0.5 + 0.5 * t)
///     })
/// ```
pub struct Tween<E> {
    id: ElementId,
    target: f32,
    spec: MotionSpec,
    element: Option<E>,
    animator: Box<dyn Fn(E, f32) -> E + 'static>,
    source: Option<&'static Location<'static>>,
}

impl<E: IntoElement + 'static> Tween<E> {
    /// Create a tween with no child yet.
    #[track_caller]
    pub fn new(
        id: impl Into<ElementId>,
        target: f32,
        spec: MotionSpec,
        animator: impl Fn(E, f32) -> E + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            target,
            spec,
            element: None,
            animator: Box::new(animator),
            source: Some(Location::caller()),
        }
    }

    /// Attach the element that the animator rewrites each frame.
    #[must_use]
    pub fn child(mut self, element: E) -> Self {
        self.element = Some(element);
        self
    }
}

/// Create a target-driven tween.
///
/// The returned tween has no child yet; attach one with [`Tween::child`]:
///
/// ```ignore
/// tween("card-hover", if hovered { 1.0 } else { 0.0 }, MotionSpec::fast(), |el, t| {
///     el.opacity(0.85 + 0.15 * t)
/// })
/// .child(card)
/// ```
#[track_caller]
pub fn tween<E: IntoElement + 'static>(
    id: impl Into<ElementId>,
    target: f32,
    spec: MotionSpec,
    animator: impl Fn(E, f32) -> E + 'static,
) -> Tween<E> {
    Tween::new(id, target, spec, animator)
}

/// Element-first convenience for building tweens.
///
/// This mirrors GPUI's `with_animation` extension and lets `E` be inferred
/// from the element itself.
pub trait TweenExt: IntoElement + Sized + 'static {
    /// Wrap this element in a [`Tween`] targeting `target`.
    #[track_caller]
    fn with_tween(
        self,
        id: impl Into<ElementId>,
        target: f32,
        spec: MotionSpec,
        animator: impl Fn(Self, f32) -> Self + 'static,
    ) -> Tween<Self> {
        Tween::new(id, target, spec, animator).child(self)
    }
}

impl<E: IntoElement + 'static> TweenExt for E {}

impl<E: IntoElement + 'static> Element for Tween<E> {
    type RequestLayoutState = AnyElement;
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }

    fn source_location(&self) -> Option<&'static Location<'static>> {
        self.source
    }

    fn request_layout(
        &mut self,
        global_id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let global_id = global_id.expect("Tween elements must be given an ElementId");
        let target = self.target;
        let spec = self.spec;
        let element = self.element.take();
        let animator = &self.animator;

        window.with_element_state(global_id, |state, window| {
            let now = Instant::now();
            let mut state = state.unwrap_or_else(|| TweenState::new(target, spec, now));
            let done = state.advance(target, spec, now);
            let value = state.value;

            let element = element.expect("Tween must have a child before it is rendered");
            let mut element = animator(element, value).into_any_element();
            let layout_id = element.request_layout(window, cx);

            if !done {
                window.request_animation_frame();
            }

            ((layout_id, element), state)
        })
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) {
        request_layout.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        request_layout: &mut Self::RequestLayoutState,
        _prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        request_layout.paint(window, cx);
    }
}

/// Mount bookkeeping for an exit animation.
///
/// GPUI removes an element as soon as its parent stops rendering it. A presence
/// wrapper keeps a closing child mounted until its exit tween has finished.
/// This struct is only the state machine; the wrapper element itself follows in
/// a later pass.
///
/// `value` is the last sampled presence value (normally set by the future
/// wrapper from its tween), `visible` says whether the child must stay mounted,
/// and `closing_since` marks when the current close began.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PresenceState {
    pub value: f32,
    pub visible: bool,
    pub closing_since: Option<Instant>,
}

impl PresenceState {
    /// A hidden, unmounted presence.
    pub const fn new() -> Self {
        Self {
            value: 0.0,
            visible: false,
            closing_since: None,
        }
    }

    /// Advance the mount state from the owner's `open` flag.
    ///
    /// Returns the tween target for this frame, or `None` once a closed
    /// presence has finished its exit and should be unmounted. Reopening while
    /// the exit is running clears `closing_since`; the tween then reverses from
    /// its current value.
    ///
    /// This does not sample `value`; the wrapper records that from its tween.
    pub fn advance(&mut self, open: bool, now: Instant, exit: Duration) -> Option<f32> {
        let target = presence_target(open, self, now, exit);

        if open {
            self.visible = true;
            self.closing_since = None;
        } else if self.visible {
            self.closing_since.get_or_insert(now);
        }

        if target.is_none() {
            self.visible = false;
            self.closing_since = None;
        }

        target
    }
}

impl Default for PresenceState {
    fn default() -> Self {
        Self::new()
    }
}

/// The tween target for a presence-backed child.
///
/// - `Some(1.0)` while `open`.
/// - `Some(0.0)` while a visible presence is closing and its `exit` window has
///   not elapsed.
/// - `None` when there is nothing to mount, or when the exit has completed.
///
/// This is a pure query. Use [`PresenceState::advance`] to update the
/// `visible`/`closing_since` bookkeeping.
pub fn presence_target(
    open: bool,
    state: &PresenceState,
    now: Instant,
    exit: Duration,
) -> Option<f32> {
    if open {
        return Some(1.0);
    }

    if !state.visible {
        return None;
    }

    match state.closing_since {
        Some(since) if now.saturating_duration_since(since) >= exit => None,
        _ => Some(0.0),
    }
}

fn cubic_bezier(x1: f32, y1: f32, x2: f32, y2: f32, t: f32) -> f32 {
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }

    let u = solve_bezier_x(x1, x2, t);
    let (a, b, c) = bezier_coefficients(y1, y2);
    sample_bezier(a, b, c, u)
}

/// Coefficients for `f(u) = ((a * u + b) * u + c) * u`, the cubic bezier with
/// implicit endpoints 0 and 1.
fn bezier_coefficients(p1: f32, p2: f32) -> (f32, f32, f32) {
    let c = 3.0 * p1;
    let b = 3.0 * (p2 - p1) - c;
    let a = 1.0 - c - b;
    (a, b, c)
}

fn sample_bezier(a: f32, b: f32, c: f32, u: f32) -> f32 {
    ((a * u + b) * u + c) * u
}

fn sample_bezier_derivative(a: f32, b: f32, c: f32, u: f32) -> f32 {
    (3.0 * a * u + 2.0 * b) * u + c
}

/// Solve `x(u) = t` for `u`, where `x` is the cubic bezier's x component.
///
/// Newton-Raphson handles the common case quickly; if it fails to converge or
/// steps outside the curve, a bounded bisection fallback finishes the job.
fn solve_bezier_x(x1: f32, x2: f32, t: f32) -> f32 {
    const NEWTON_ITERATIONS: usize = 8;
    const BISECTION_ITERATIONS: usize = 32;
    const EPSILON: f32 = 1e-6;

    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }

    let (a, b, c) = bezier_coefficients(x1, x2);
    let mut u = t;

    for _ in 0..NEWTON_ITERATIONS {
        let error = sample_bezier(a, b, c, u) - t;
        if error.abs() <= EPSILON {
            return u;
        }

        let derivative = sample_bezier_derivative(a, b, c, u);
        if derivative.abs() <= EPSILON {
            break;
        }

        let next = u - error / derivative;
        if !(0.0..=1.0).contains(&next) {
            break;
        }
        u = next;
    }

    let mut low = 0.0;
    let mut high = 1.0;
    let mut u = t;

    for _ in 0..BISECTION_ITERATIONS {
        let error = sample_bezier(a, b, c, u) - t;
        if error.abs() <= EPSILON {
            return u;
        }

        if error < 0.0 {
            low = u;
        } else {
            high = u;
        }
        u = (low + high) * 0.5;
    }

    u
}

#[cfg(test)]
mod tests {
    use super::*;

    const EASINGS: [Easing; 6] = [
        Easing::Standard,
        Easing::Enter,
        Easing::Exit,
        Easing::InOut,
        Easing::Linear,
        Easing::OutQuint,
    ];

    fn linear_spec(millis: u64) -> MotionSpec {
        MotionSpec::new(
            Duration::from_millis(millis),
            Duration::ZERO,
            Easing::Linear,
        )
    }

    fn assert_close(actual: f32, expected: f32) {
        assert!(
            (actual - expected).abs() <= 1e-5,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn easing_endpoints_are_exact_and_clamped() {
        for easing in EASINGS {
            assert_eq!(easing.sample(0.0), 0.0, "{easing:?} at 0");
            assert_eq!(easing.sample(1.0), 1.0, "{easing:?} at 1");
            assert_eq!(easing.sample(-2.0), 0.0, "{easing:?} below 0");
            assert_eq!(easing.sample(2.0), 1.0, "{easing:?} above 1");
        }
    }

    #[test]
    fn easing_is_monotonic_and_in_range() {
        for easing in EASINGS {
            let mut previous = 0.0;
            for step in 0..=1000 {
                let t = step as f32 / 1000.0;
                let value = easing.sample(t);

                assert!(
                    (0.0..=1.0).contains(&value),
                    "{easing:?} left the unit range at {t}: {value}"
                );
                assert!(
                    value + 1e-5 >= previous,
                    "{easing:?} went backwards at {t}: {previous} -> {value}"
                );
                previous = value;
            }
        }
    }

    #[test]
    fn bezier_sampling_matches_reference_values() {
        // Values computed by solving x(u) = t with bisection at high precision.
        let references = [
            (Easing::Standard, [0.398124, 0.965983, 0.999865]),
            (Easing::Enter, [0.494391, 0.971779, 0.999878]),
            (Easing::Exit, [0.018373, 0.324815, 0.843750]),
            (Easing::InOut, [0.008943, 0.500000, 0.991057]),
        ];
        let times = [0.1, 0.5, 0.9];

        for (easing, expected) in references {
            for (t, expected) in times.into_iter().zip(expected) {
                let actual = easing.sample(t);
                assert!(
                    (actual - expected).abs() <= 1e-4,
                    "{easing:?} at {t}: expected {expected}, got {actual}"
                );
            }
        }
    }

    #[test]
    fn motion_tokens_match_the_documented_values() {
        assert_eq!(MotionSpec::instant().duration, Duration::from_millis(90));
        assert_eq!(MotionSpec::fast().duration, Duration::from_millis(140));
        assert_eq!(MotionSpec::base().duration, Duration::from_millis(200));
        assert_eq!(MotionSpec::slow().duration, Duration::from_millis(300));
        assert_eq!(
            MotionSpec::overlay_in().duration,
            Duration::from_millis(180)
        );
        assert_eq!(
            MotionSpec::overlay_out().duration,
            Duration::from_millis(140)
        );
        assert_eq!(MotionSpec::hero().duration, Duration::from_millis(700));

        assert_eq!(MotionSpec::overlay_in().easing, Easing::Enter);
        assert_eq!(MotionSpec::overlay_out().easing, Easing::Exit);
        assert_eq!(MotionSpec::hero().easing, Easing::Standard);
    }

    #[test]
    fn tween_advances_and_stops_at_target() {
        let now = Instant::now();
        let spec = linear_spec(200);
        let mut state = TweenState::new(1.0, spec, now);

        assert_eq!(state.value, 0.0);
        assert!(!state.advance(1.0, spec, now));

        assert!(!state.advance(1.0, spec, now + Duration::from_millis(100)));
        assert_close(state.value, 0.5);

        assert!(state.advance(1.0, spec, now + Duration::from_millis(200)));
        assert_eq!(state.value, 1.0);
        assert!(state.done);

        // Settled with an unchanged target: still done, no further movement.
        assert!(state.advance(1.0, spec, now + Duration::from_secs(1)));
        assert_eq!(state.value, 1.0);
    }

    #[test]
    fn tween_delay_holds_then_starts() {
        let now = Instant::now();
        let spec = MotionSpec::new(
            Duration::from_millis(200),
            Duration::from_millis(100),
            Easing::Linear,
        );
        let mut state = TweenState::new(1.0, spec, now);

        assert!(!state.advance(1.0, spec, now + Duration::from_millis(50)));
        assert_eq!(state.value, 0.0);

        assert!(!state.advance(1.0, spec, now + Duration::from_millis(150)));
        assert_close(state.value, 0.25);

        assert!(state.advance(1.0, spec, now + Duration::from_millis(300)));
        assert_eq!(state.value, 1.0);
    }

    #[test]
    fn tween_interruption_rebases_from_current_value() {
        let now = Instant::now();
        let spec = linear_spec(200);
        let mut state = TweenState::new(1.0, spec, now);

        state.advance(1.0, spec, now + Duration::from_millis(100));
        let midpoint = state.value;
        assert_close(midpoint, 0.5);

        // Reverse at the midpoint: the next frame continues from 0.5 and
        // starts a fresh 200 ms run back to zero.
        assert!(!state.advance(0.0, spec, now + Duration::from_millis(100)));
        assert_close(state.value, midpoint);
        assert_close(state.from, midpoint);
        assert_eq!(state.target, 0.0);

        assert!(!state.advance(0.0, spec, now + Duration::from_millis(200)));
        assert_close(state.value, 0.25);

        assert!(state.advance(0.0, spec, now + Duration::from_millis(300)));
        assert_eq!(state.value, 0.0);
    }

    #[test]
    fn tween_to_current_value_settles_immediately() {
        let now = Instant::now();
        let spec = linear_spec(200);
        let mut state = TweenState::new(1.0, spec, now);

        state.advance(1.0, spec, now + Duration::from_millis(100));
        let midpoint = state.value;

        assert!(state.advance(midpoint, spec, now + Duration::from_millis(100)));
        assert!(state.done);
        assert_eq!(state.value, midpoint);
    }

    #[test]
    fn zero_target_mount_is_already_settled() {
        let now = Instant::now();
        let state = TweenState::new(0.0, MotionSpec::fast(), now);

        assert!(state.done);
        assert_eq!(state.value, 0.0);
    }

    #[test]
    fn presence_opens_closes_and_unmounts() {
        let now = Instant::now();
        let exit = Duration::from_millis(140);
        let mut state = PresenceState::new();

        assert_eq!(presence_target(false, &state, now, exit), None);
        assert_eq!(state.advance(true, now, exit), Some(1.0));
        assert!(state.visible);

        let close_at = now + Duration::from_millis(10);
        assert_eq!(state.advance(false, close_at, exit), Some(0.0));
        assert_eq!(state.closing_since, Some(close_at));
        assert!(state.visible);

        // Still inside the exit window.
        assert_eq!(
            state.advance(false, close_at + Duration::from_millis(100), exit),
            Some(0.0)
        );
        assert!(state.visible);

        // Exit finished: the wrapper should unmount.
        assert_eq!(
            state.advance(false, close_at + Duration::from_millis(150), exit),
            None
        );
        assert!(!state.visible);
        assert_eq!(state.closing_since, None);
    }

    #[test]
    fn presence_reopen_cancels_the_exit() {
        let now = Instant::now();
        let exit = Duration::from_millis(140);
        let mut state = PresenceState::new();

        state.advance(true, now, exit);
        state.advance(false, now + Duration::from_millis(10), exit);

        assert_eq!(
            state.advance(true, now + Duration::from_millis(20), exit),
            Some(1.0)
        );
        assert!(state.visible);
        assert_eq!(state.closing_since, None);
    }
}
