/// A Video.js media adapter backed by the embedded mpv session.
///
/// Plexy's native player decodes in libmpv, not in a `<video>` element. The
/// Video.js player store, however, only knows how to read state from a media
/// object: currentTime, duration, paused, volume, text tracks and the DOM-style
/// events that announce changes. This class is that object for mpv, so the
/// desktop player can reuse the exact skin, controls, gestures and hotkeys the
/// browser player uses instead of maintaining a second control surface.
///
/// mpv still renders subtitles into the video frames; the text track objects
/// only carry language/title/mode so the captions menu can drive mpv's `sid`.
import type { NativeAudioTrack, NativePlaybackEvent } from "../../electron";
import { languageName } from "../../lib/language";

type AdapterEventName =
  | "emptied"
  | "loadstart"
  | "loadedmetadata"
  | "loadeddata"
  | "durationchange"
  | "timeupdate"
  | "play"
  | "playing"
  | "pause"
  | "ended"
  | "waiting"
  | "canplay"
  | "canplaythrough"
  | "seeking"
  | "seeked"
  | "progress"
  | "volumechange"
  | "ratechange"
  | "error";

type TextTrackMode = "disabled" | "hidden" | "showing";

/** Commands the adapter sends to the desktop mpv session. */
export interface MpvSessionController {
  resume(): void;
  pause(): void;
  seek(seconds: number): void;
  /** 0–100, mpv's own scale. */
  setVolume(percent: number): void;
  setMute(muted: boolean): void;
  setSpeed(rate: number): void;
  selectAudio(trackId: number): void;
  selectSubtitle(trackId: number): void;
}

interface TimeRangesLike {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}

function timeRanges(end: () => number): TimeRangesLike {
  return {
    get length() {
      return end() > 0 ? 1 : 0;
    },
    start: () => 0,
    end: () => Math.max(0, end()),
  };
}

class MpvTextTrack extends EventTarget {
  readonly id: string;
  readonly kind: "subtitles" = "subtitles";
  readonly label: string;
  readonly language: string;
  readonly mpvId: number;
  cues: never[] = [];
  private modeValue: TextTrackMode = "disabled";
  private readonly owner: MpvTextTrackList;

  constructor(owner: MpvTextTrackList, track: NativeAudioTrack) {
    super();
    this.owner = owner;
    this.mpvId = track.id;
    this.id = `mpv:${track.id}`;
    this.language = track.language ?? "";
    // mpv's track titles often carry the release group ("MoviesMod.ai.in")
    // rather than anything the viewer can choose between, so prefer the
    // language name and fall back to the title only when there is none.
    this.label = languageName(track.language) || track.title || `Track ${track.id}`;
  }

  get mode(): TextTrackMode {
    return this.modeValue;
  }

  set mode(next: TextTrackMode) {
    this.owner.requestMode(this, next);
  }

  /** Applied from mpv state; never sends a command back. */
  applyMode(next: TextTrackMode): void {
    this.modeValue = next;
  }
}

class MpvTextTrackList extends EventTarget {
  [index: number]: MpvTextTrack;
  private items: MpvTextTrack[] = [];
  private adapter: MpvMedia | null = null;

  bind(adapter: MpvMedia): void {
    this.adapter = adapter;
  }

  get length(): number {
    return this.items.length;
  }

  [Symbol.iterator](): Iterator<MpvTextTrack> {
    return this.items[Symbol.iterator]();
  }

  at(index: number): MpvTextTrack | undefined {
    return this.items.at(index);
  }

  replace(tracks: NativeAudioTrack[]): void {
    const next = tracks.map((track) => {
      const existing = this.items.find((item) => item.mpvId === track.id);
      if (existing) return existing;
      return new MpvTextTrack(this, track);
    });
    const changed =
      next.length !== this.items.length ||
      next.some((track, index) => track !== this.items[index]) ||
      tracks.some((track, index) => {
        const current = next[index];
        return current ? Boolean(track.selected) !== (current.mode === "showing") : false;
      });

    this.items = next;
    for (let index = 0; index < next.length; index++) {
      this[index] = next[index]!;
      next[index]!.applyMode(tracks[index]?.selected ? "showing" : "disabled");
    }
    // Drop stale numeric slots after a track disappeared.
    for (let index = next.length; index < 32; index++) {
      delete (this as Record<number, MpvTextTrack | undefined>)[index];
    }

    if (changed) this.dispatchEvent(new Event("change"));
  }

  requestMode(track: MpvTextTrack, next: TextTrackMode): void {
    if (track.mode === next) return;
    const wasShowing = track.mode === "showing";
    track.applyMode(next);
    if (next === "showing") {
      for (const other of this.items) {
        if (other !== track && other.mode === "showing") other.applyMode("disabled");
      }
      this.adapter?.onSubtitleSelected(track.mpvId);
    } else if (wasShowing) {
      this.adapter?.onSubtitleSelected(0);
    }
    this.dispatchEvent(new Event("change"));
  }
}

export interface MpvMediaContentData {
  title?: string;
  poster?: string;
}

export class MpvMedia extends EventTarget {
  // --- HTMLMediaElement-ish capabilities ------------------------------------
  /** Identifies the playback engine to Video.js capability guards. */
  readonly engine = "mpv";
  src = "";
  currentSrc = "";
  preload = "auto";
  crossOrigin: string | null = null;
  readyState = 0;
  networkState = 0;
  loop = false;
  autoplay = false;
  playsInline = true;
  videoWidth = 0;
  videoHeight = 0;
  error: { code: number; message: string } | null = null;
  readonly textTracks = new MpvTextTrackList();
  contentData: MpvMediaContentData = {};

  private currentTimeValue = 0;
  private durationValue = 0;
  private pausedValue = true;
  private endedValue = false;
  private seekingValue = false;
  private volumeValue = 1;
  private mutedValue = false;
  private rateValue = 1;
  private cachedAhead = 0;
  private pendingSeek = false;
  private controller: MpvSessionController | null = null;

  constructor() {
    super();
    this.textTracks.bind(this);
  }

  // --- media properties -----------------------------------------------------

  get currentTime(): number {
    return this.currentTimeValue;
  }

  set currentTime(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    this.currentTimeValue = value;
    this.seekingValue = true;
    this.pendingSeek = true;
    this.dispatch("seeking");
    this.controller?.seek(value);
  }

  get duration(): number {
    return this.durationValue;
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  get ended(): boolean {
    return this.endedValue;
  }

  get seeking(): boolean {
    return this.seekingValue;
  }

  get volume(): number {
    return this.volumeValue;
  }

  set volume(value: number) {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(1, Math.max(0, value));
    this.volumeValue = clamped;
    this.controller?.setVolume(clamped * 100);
    this.dispatch("volumechange");
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(value: boolean) {
    this.mutedValue = Boolean(value);
    this.controller?.setMute(this.mutedValue);
    this.dispatch("volumechange");
  }

  get playbackRate(): number {
    return this.rateValue;
  }

  set playbackRate(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    this.rateValue = value;
    this.controller?.setSpeed(value);
    this.dispatch("ratechange");
  }

  get buffered(): TimeRangesLike {
    return timeRanges(() => Math.min(this.durationValue || Infinity, this.currentTimeValue + this.cachedAhead));
  }

  get seekable(): TimeRangesLike {
    return timeRanges(() => this.durationValue);
  }

  get played(): TimeRangesLike {
    return timeRanges(() => this.currentTimeValue);
  }

  // --- media methods --------------------------------------------------------

  play(): Promise<void> {
    // After EOF mpv keeps the file loaded; restarting means seeking back to
    // the beginning before resuming.
    if (this.endedValue) {
      this.endedValue = false;
      this.currentTimeValue = 0;
      this.controller?.seek(0);
    }
    this.pausedValue = false;
    this.controller?.resume();
    this.dispatch("play");
    this.dispatch("playing");
    return Promise.resolve();
  }

  pause(): void {
    this.pausedValue = true;
    this.controller?.pause();
    this.dispatch("pause");
  }

  load(): void {
    /* the session is opened by MpvVideo, not by the element */
  }

  canPlayType(): "probably" {
    return "probably";
  }

  // --- adapter lifecycle ----------------------------------------------------

  attach(_element: Element | null): void {
    /* The native surface is positioned by the main process, not by the DOM. */
  }

  detach(): void {
    /* no engine teardown here; MpvVideo owns the session lifecycle */
  }

  destroy(): void {
    this.controller = null;
  }

  begin(controller: MpvSessionController, content: MpvMediaContentData = {}): void {
    this.controller = controller;
    this.contentData = content;
    this.endedValue = false;
    this.seekingValue = false;
    this.pendingSeek = false;
    this.cachedAhead = 0;
    this.readyState = 0;
    this.error = null;
    this.dispatch("loadstart");
  }

  end(): void {
    this.controller = null;
    this.pausedValue = true;
    this.readyState = 0;
    this.dispatch("emptied");
  }

  onSubtitleSelected(mpvTrackId: number): void {
    this.controller?.selectSubtitle(mpvTrackId);
  }

  apply(event: NativePlaybackEvent): void {
    switch (event.type) {
      case "ready":
        this.readyState = 4;
        this.error = null;
        this.dispatch("loadedmetadata");
        this.dispatch("durationchange");
        this.dispatch("canplay");
        this.dispatch("canplaythrough");
        this.dispatch("loadeddata");
        return;
      case "time": {
        if (event.position != null) {
          this.currentTimeValue = event.position;
        }
        if (event.duration != null && Number.isFinite(event.duration)) {
          if (this.durationValue !== event.duration) {
            this.durationValue = event.duration;
            this.dispatch("durationchange");
          }
        }
        if (event.cachedSeconds != null) this.cachedAhead = event.cachedSeconds;
        if (this.seekingValue && this.pendingSeek && this.controller) {
          this.seekingValue = false;
          this.pendingSeek = false;
          this.dispatch("seeked");
        }
        this.dispatch("timeupdate");
        this.dispatch("progress");
        return;
      }
      case "duration": {
        const duration = event.duration;
        if (duration == null || !Number.isFinite(duration)) return;
        this.durationValue = duration;
        this.dispatch("durationchange");
        return;
      }
      case "pause": {
        const paused = Boolean(event.paused);
        if (paused === this.pausedValue) return;
        this.pausedValue = paused;
        this.dispatch(paused ? "pause" : "play");
        if (!paused) this.dispatch("playing");
        return;
      }
      case "buffering": {
        if (!event.buffering) {
          this.dispatch("playing");
          return;
        }
        this.dispatch("waiting");
        return;
      }
      case "ended":
        this.endedValue = true;
        this.pausedValue = true;
        if (event.position != null) this.currentTimeValue = event.position;
        this.dispatch("ended");
        this.dispatch("pause");
        return;
      case "closed":
        if (!this.endedValue) {
          this.error = { code: 2, message: "The player stopped." };
          this.dispatch("error");
        }
        return;
      case "error":
        this.error = { code: 2, message: event.message ?? "Playback failed" };
        this.readyState = 0;
        this.dispatch("error");
        return;
      case "volume": {
        if (event.volume != null && Number.isFinite(event.volume)) {
          this.volumeValue = Math.min(1, Math.max(0, event.volume / 100));
        }
        if (event.muted != null) this.mutedValue = Boolean(event.muted);
        this.dispatch("volumechange");
        return;
      }
      case "speed": {
        if (event.speed != null && Number.isFinite(event.speed) && event.speed > 0) {
          this.rateValue = event.speed;
          this.dispatch("ratechange");
        }
        return;
      }
      case "tracks":
        this.textTracks.replace(event.subtitleTracks ?? []);
        return;
      default:
        return;
    }
  }

  private dispatch(type: AdapterEventName): void {
    this.dispatchEvent(new Event(type));
  }
}
