/// libmpv bridge for the GPUI player.
///
/// This is the Electron `mpv-embed` module (apps/desktop/native/mpv-embed)
/// with its N-API layer replaced by a small C ABI that Rust calls directly:
///
/// - the same runtime `dlopen` loader, so a Homebrew or bundled libmpv works;
/// - the same `NSOpenGLView` render surface, inserted *below* GPUI's Metal view
///   (where Electron put it below Chromium's compositor view), so GPUI paints
///   its controls over the video in one window;
/// - the same observed properties and event mapping, delivered through a C
///   callback instead of a N-API threadsafe function;
/// - plus a headless second core that renders seek previews in software, so
///   preview scrubbing never touches the playing core.
///
/// The player only opens local filesystem paths. Network protocols, ytdl,
/// scripts and user config are disabled on both cores.
#import <AppKit/AppKit.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl3.h>
#import <QuartzCore/QuartzCore.h>
#include <dlfcn.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "mpv/client.h"
#include "mpv/render.h"
#include "mpv/render_gl.h"

// MARK: - libmpv entry points (loaded at runtime)

struct MpvApi {
  void *handle = nullptr;

  mpv_handle *(*mpv_create)(void) = nullptr;
  int (*mpv_initialize)(mpv_handle *) = nullptr;
  void (*mpv_terminate_destroy)(mpv_handle *) = nullptr;
  void (*mpv_wakeup)(mpv_handle *) = nullptr;
  const char *(*mpv_error_string)(int) = nullptr;
  char *(*mpv_get_property_string)(mpv_handle *, const char *) = nullptr;
  int (*mpv_set_property_string)(mpv_handle *, const char *, const char *) = nullptr;
  int (*mpv_set_property)(mpv_handle *, const char *, mpv_format, void *) = nullptr;
  int (*mpv_command)(mpv_handle *, const char **) = nullptr;
  int (*mpv_observe_property)(mpv_handle *, uint64_t, const char *, mpv_format) = nullptr;
  mpv_event *(*mpv_wait_event)(mpv_handle *, double) = nullptr;
  void (*mpv_free)(void *) = nullptr;

  int (*mpv_render_context_create)(mpv_render_context **, mpv_handle *, mpv_render_param *) = nullptr;
  void (*mpv_render_context_free)(mpv_render_context *) = nullptr;
  void (*mpv_render_context_set_update_callback)(mpv_render_context *, mpv_render_update_fn, void *) = nullptr;
  int (*mpv_render_context_render)(mpv_render_context *, mpv_render_param *) = nullptr;
  uint64_t (*mpv_render_context_update)(mpv_render_context *) = nullptr;

  bool load(const std::string &path, std::string &error) {
    handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
      const char *reason = dlerror();
      error = reason ? reason : "Could not load libmpv";
      return false;
    }
#define PLEXY_LOAD_SYMBOL(field, name)                \
  do {                                                \
    *(void **)(&field) = dlsym(handle, name);         \
    if (!field) {                                     \
      error = std::string("libmpv is missing ") + name; \
      handle = nullptr;                               \
      return false;                                   \
    }                                                 \
  } while (0)
    PLEXY_LOAD_SYMBOL(mpv_create, "mpv_create");
    PLEXY_LOAD_SYMBOL(mpv_initialize, "mpv_initialize");
    PLEXY_LOAD_SYMBOL(mpv_terminate_destroy, "mpv_terminate_destroy");
    PLEXY_LOAD_SYMBOL(mpv_wakeup, "mpv_wakeup");
    PLEXY_LOAD_SYMBOL(mpv_error_string, "mpv_error_string");
    PLEXY_LOAD_SYMBOL(mpv_get_property_string, "mpv_get_property_string");
    PLEXY_LOAD_SYMBOL(mpv_set_property_string, "mpv_set_property_string");
    PLEXY_LOAD_SYMBOL(mpv_set_property, "mpv_set_property");
    PLEXY_LOAD_SYMBOL(mpv_command, "mpv_command");
    PLEXY_LOAD_SYMBOL(mpv_observe_property, "mpv_observe_property");
    PLEXY_LOAD_SYMBOL(mpv_wait_event, "mpv_wait_event");
    PLEXY_LOAD_SYMBOL(mpv_free, "mpv_free");
    PLEXY_LOAD_SYMBOL(mpv_render_context_create, "mpv_render_context_create");
    PLEXY_LOAD_SYMBOL(mpv_render_context_free, "mpv_render_context_free");
    PLEXY_LOAD_SYMBOL(mpv_render_context_set_update_callback, "mpv_render_context_set_update_callback");
    PLEXY_LOAD_SYMBOL(mpv_render_context_render, "mpv_render_context_render");
    PLEXY_LOAD_SYMBOL(mpv_render_context_update, "mpv_render_context_update");
#undef PLEXY_LOAD_SYMBOL
    return true;
  }
};

static MpvApi gApi;
static std::once_flag gApiOnce;
static std::string gApiError;

static bool loadLibmpv(const std::string &path, std::string &error) {
  std::call_once(gApiOnce, [&]() { gApi.load(path, gApiError); });
  if (!gApi.handle) error = gApiError.empty() ? "libmpv is not loaded" : gApiError;
  return gApi.handle != nullptr;
}

static void copyError(const std::string &message, char *buffer, size_t length) {
  if (!buffer || length == 0) return;
  snprintf(buffer, length, "%s", message.c_str());
}

/// Options shared by the playback and preview cores: local files only, no
/// user configuration, no scripts, nothing that could reach the network.
static void applyOfflineOptions(mpv_handle *mpv) {
  gApi.mpv_set_property_string(mpv, "config", "no");
  gApi.mpv_set_property_string(mpv, "load-scripts", "no");
  gApi.mpv_set_property_string(mpv, "ytdl", "no");
  gApi.mpv_set_property_string(mpv, "osc", "no");
  gApi.mpv_set_property_string(mpv, "input-default-bindings", "no");
  gApi.mpv_set_property_string(mpv, "input-vo-keyboard", "no");
  gApi.mpv_set_property_string(mpv, "save-position-on-quit", "no");
  gApi.mpv_set_property_string(mpv, "resume-playback", "no");
  gApi.mpv_set_property_string(mpv, "access-references", "no");
  gApi.mpv_set_property_string(mpv, "load-unsafe-playlists", "no");
  gApi.mpv_set_property_string(mpv, "cache", "no");
  gApi.mpv_set_property_string(mpv, "terminal", "no");
}

// MARK: - Events delivered to Rust

extern "C" {
/// kind: 1 number property, 2 flag property, 3 int property, 4 event,
///       5 error, 6 string property. Called on libmpv's event thread.
typedef void (*plexy_event_fn)(void *context, int kind, const char *name, const char *text, double number);
}

enum PayloadKind {
  kPayloadPropertyNumber = 1,
  kPayloadPropertyFlag = 2,
  kPayloadPropertyInt = 3,
  kPayloadEvent = 4,
  kPayloadError = 5,
  kPayloadPropertyString = 6,
};

// MARK: - Playback core

// Queued redraws can outlive the player. Only the main queue touches the view.
struct FrameSignal {
  std::atomic<bool> pending{false};
  NSView *view = nil;
};

struct PlexyPlayer {
  mpv_handle *mpv = nullptr;
  mpv_render_context *render = nullptr;
  plexy_event_fn callback = nullptr;
  void *callbackContext = nullptr;
  std::thread eventThread;
  std::atomic<bool> running{false};
  std::atomic<bool> stopping{false};
  std::shared_ptr<FrameSignal> frameSignal = std::make_shared<FrameSignal>();

  NSView *view = nil;
  std::mutex renderMutex;

  void emit(int kind, const char *name, const char *text, double number) {
    if (callback) callback(callbackContext, kind, name ? name : "", text ? text : "", number);
  }

  void scheduleFrame() {
    auto signal = frameSignal;
    if (signal->pending.exchange(true)) return;
    dispatch_async(dispatch_get_main_queue(), ^{
      signal->pending.store(false);
      NSView *target = signal->view;
      if (target && !target.hidden) [target setNeedsDisplay:YES];
    });
  }

  void handleEvent(mpv_event *event);
  void createRenderContext(CGLContextObj context);
  void destroyRenderContext();
  void destroy();
};

@interface PlexyGLView : NSOpenGLView
@property(nonatomic, assign) PlexyPlayer *owner;
- (instancetype)initWithFrame:(NSRect)frame owner:(PlexyPlayer *)owner;
@end

@implementation PlexyGLView

- (instancetype)initWithFrame:(NSRect)frame owner:(PlexyPlayer *)owner {
  NSOpenGLPixelFormatAttribute attributes[] = {
      NSOpenGLPFAAccelerated,
      NSOpenGLPFADoubleBuffer,
      NSOpenGLPFAOpenGLProfile,
      (NSOpenGLPixelFormatAttribute)NSOpenGLProfileVersion3_2Core,
      NSOpenGLPFAColorSize,
      (NSOpenGLPixelFormatAttribute)24,
      NSOpenGLPFAAlphaSize,
      (NSOpenGLPixelFormatAttribute)8,
      (NSOpenGLPixelFormatAttribute)0,
  };
  NSOpenGLPixelFormat *format = [[NSOpenGLPixelFormat alloc] initWithAttributes:attributes];
  self = [super initWithFrame:frame pixelFormat:format];
  if (self) {
    _owner = owner;
    self.wantsBestResolutionOpenGLSurface = YES;
  }
  return self;
}

- (BOOL)isOpaque {
  return YES;
}

// GPUI's view sits above this one and owns every mouse and keyboard event.
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}

- (BOOL)acceptsFirstResponder {
  return NO;
}

- (void)prepareOpenGL {
  [super prepareOpenGL];
  NSOpenGLContext *context = [self openGLContext];
  [context makeCurrentContext];
  GLint swapInterval = 1;
  [context setValues:&swapInterval forParameter:NSOpenGLContextParameterSwapInterval];
  if (self.owner) self.owner->createRenderContext([context CGLContextObj]);
}

- (void)reshape {
  [super reshape];
  [[self openGLContext] update];
  [self setNeedsDisplay:YES];
}

- (void)drawRect:(NSRect)dirtyRect {
  PlexyPlayer *owner = self.owner;
  if (!owner) return;
  NSOpenGLContext *context = [self openGLContext];
  [context makeCurrentContext];
  CGLContextObj cgl = [context CGLContextObj];
  CGLLockContext(cgl);

  NSRect backing = [self convertRectToBacking:self.bounds];
  int width = (int)llround(backing.size.width);
  int height = (int)llround(backing.size.height);
  if (width <= 0 || height <= 0) {
    CGLUnlockContext(cgl);
    return;
  }

  glViewport(0, 0, width, height);
  glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
  glClear(GL_COLOR_BUFFER_BIT);

  mpv_render_context *render = owner->render;
  if (render) {
    GLint framebuffer = 0;
    glGetIntegerv(GL_FRAMEBUFFER_BINDING, &framebuffer);
    mpv_opengl_fbo fbo = {(int)framebuffer, width, height, 0};
    int flip = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
        {MPV_RENDER_PARAM_FLIP_Y, &flip},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    gApi.mpv_render_context_render(render, params);
  }
  CGLFlushDrawable(cgl);
  CGLUnlockContext(cgl);
}

@end

void PlexyPlayer::createRenderContext(CGLContextObj) {
  std::lock_guard<std::mutex> lock(renderMutex);
  if (render || !mpv) return;

  mpv_opengl_init_params glInit = {
      [](void *, const char *name) -> void * { return (void *)dlsym(RTLD_DEFAULT, name); },
      nullptr,
  };
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
      {MPV_RENDER_PARAM_INVALID, nullptr},
  };
  mpv_render_context *created = nullptr;
  int result = gApi.mpv_render_context_create(&created, mpv, params);
  if (result < 0) {
    emit(kPayloadError, "", (std::string("Could not start the video renderer: ") + gApi.mpv_error_string(result)).c_str(), 0);
    return;
  }
  render = created;
  gApi.mpv_render_context_set_update_callback(
      render, [](void *data) { static_cast<PlexyPlayer *>(data)->scheduleFrame(); }, this);
  scheduleFrame();
  emit(kPayloadEvent, "render-ready", "", 0);
}

void PlexyPlayer::destroyRenderContext() {
  std::lock_guard<std::mutex> lock(renderMutex);
  if (render) {
    PlexyGLView *glView = [view isKindOfClass:[PlexyGLView class]] ? (PlexyGLView *)view : nil;
    if (glView) [[glView openGLContext] makeCurrentContext];
    gApi.mpv_render_context_set_update_callback(render, nullptr, nullptr);
    gApi.mpv_render_context_free(render);
    [NSOpenGLContext clearCurrentContext];
    render = nullptr;
  }
}

void PlexyPlayer::handleEvent(mpv_event *event) {
  switch (event->event_id) {
    case MPV_EVENT_LOG_MESSAGE: {
      auto *message = (mpv_event_log_message *)event->data;
      if (message && message->level && strcmp(message->level, "error") == 0) {
        fprintf(stderr, "[Plexy mpv] %s", message->text ? message->text : "Playback error\n");
      }
      break;
    }
    case MPV_EVENT_FILE_LOADED:
      emit(kPayloadEvent, "loaded", "", 0);
      break;
    case MPV_EVENT_VIDEO_RECONFIG:
      emit(kPayloadEvent, "video-reconfig", "", 0);
      break;
    case MPV_EVENT_PLAYBACK_RESTART:
      emit(kPayloadEvent, "playback-restart", "", 0);
      break;
    case MPV_EVENT_END_FILE: {
      auto *end = (mpv_event_end_file *)event->data;
      if (!end) break;
      if (end->reason == MPV_END_FILE_REASON_EOF) {
        emit(kPayloadEvent, "ended", "", 0);
      } else if (end->reason == MPV_END_FILE_REASON_ERROR) {
        emit(kPayloadError, "", (std::string("Playback failed: ") + gApi.mpv_error_string(end->error)).c_str(), 0);
      } else {
        emit(kPayloadEvent, "stopped", "", 0);
      }
      break;
    }
    case MPV_EVENT_PROPERTY_CHANGE: {
      auto *property = (mpv_event_property *)event->data;
      if (!property || !property->name) break;
      if (property->format == MPV_FORMAT_NONE || !property->data) {
        // track-list and friends are observed without a value: Rust re-reads
        // the structured sub-properties it needs.
        emit(kPayloadEvent, (std::string("changed:") + property->name).c_str(), "", 0);
        break;
      }
      switch (property->format) {
        case MPV_FORMAT_DOUBLE:
          emit(kPayloadPropertyNumber, property->name, "", *(double *)property->data);
          break;
        case MPV_FORMAT_FLAG:
          emit(kPayloadPropertyFlag, property->name, "", *(int *)property->data != 0 ? 1 : 0);
          break;
        case MPV_FORMAT_INT64:
          emit(kPayloadPropertyInt, property->name, "", (double)*(int64_t *)property->data);
          break;
        case MPV_FORMAT_STRING: {
          const char *text = *(char **)property->data;
          emit(kPayloadPropertyString, property->name, text ? text : "", 0);
          break;
        }
        default:
          break;
      }
      break;
    }
    case MPV_EVENT_SHUTDOWN:
      running.store(false);
      break;
    default:
      break;
  }
}

void PlexyPlayer::destroy() {
  if (stopping.exchange(true)) return;
  running.store(false);
  if (mpv) gApi.mpv_wakeup(mpv);
  if (eventThread.joinable()) eventThread.join();
  callback = nullptr;

  auto teardown = ^{
    frameSignal->view = nil;
    destroyRenderContext();
    if (view) {
      [(PlexyGLView *)view setOwner:nullptr];
      [view removeFromSuperview];
      view = nil;
    }
  };
  if ([NSThread isMainThread]) teardown();
  else dispatch_sync(dispatch_get_main_queue(), teardown);

  if (mpv) {
    gApi.mpv_terminate_destroy(mpv);
    mpv = nullptr;
  }
}

// MARK: - Headless preview core

/// A second libmpv core that never outputs audio or presents frames. It seeks
/// to a requested time and renders that frame through the software render API
/// into a caller-owned buffer. Nothing it does reaches the playback core, and
/// nothing is written to disk.
struct PlexyPreview {
  mpv_handle *mpv = nullptr;
  mpv_render_context *render = nullptr;
  std::mutex mutex;  // one request at a time
  bool loaded = false;
  int videoWidth = 0;
  int videoHeight = 0;

  /// Waits for one of the given events, or an error, for up to `timeout`.
  bool waitFor(mpv_event_id wanted, double timeout) {
    auto deadline = std::chrono::steady_clock::now() + std::chrono::duration<double>(timeout);
    while (std::chrono::steady_clock::now() < deadline) {
      double left = std::chrono::duration<double>(deadline - std::chrono::steady_clock::now()).count();
      mpv_event *event = gApi.mpv_wait_event(mpv, left > 0 ? left : 0);
      if (!event || event->event_id == MPV_EVENT_NONE) continue;
      if (event->event_id == wanted) return true;
      if (event->event_id == MPV_EVENT_END_FILE) {
        auto *end = (mpv_event_end_file *)event->data;
        if (end && end->reason == MPV_END_FILE_REASON_ERROR) return false;
      }
      if (event->event_id == MPV_EVENT_SHUTDOWN) return false;
    }
    return false;
  }
};

// MARK: - C ABI

extern "C" {

PlexyPlayer *plexy_player_create(const char *libmpvPath, plexy_event_fn callback, void *context, char *error,
                                 size_t errorLength) {
  std::string loadError;
  if (!libmpvPath || !loadLibmpv(libmpvPath, loadError)) {
    copyError(loadError.empty() ? "No libmpv path" : loadError, error, errorLength);
    return nullptr;
  }
  auto *player = new PlexyPlayer();
  player->callback = callback;
  player->callbackContext = context;
  player->mpv = gApi.mpv_create();
  if (!player->mpv) {
    delete player;
    copyError("Could not create the libmpv player", error, errorLength);
    return nullptr;
  }

  mpv_handle *mpv = player->mpv;
  applyOfflineOptions(mpv);
  gApi.mpv_set_property_string(mpv, "vo", "libmpv");
  gApi.mpv_set_property_string(mpv, "ao", "coreaudio");
  gApi.mpv_set_property_string(mpv, "hwdec", "auto-safe");
  gApi.mpv_set_property_string(mpv, "keep-open", "yes");
  gApi.mpv_set_property_string(mpv, "idle", "yes");
  gApi.mpv_set_property_string(mpv, "pause", "yes");
  // Local playback: pick up sidecar subtitles (`Movie.en.srt` beside
  // `Movie.mkv`) the way a file browser user expects; no external audio.
  gApi.mpv_set_property_string(mpv, "sub-auto", "fuzzy");
  gApi.mpv_set_property_string(mpv, "audio-file-auto", "no");
  gApi.mpv_set_property_string(mpv, "title", "Plexy");
  gApi.mpv_set_property_string(mpv, "hr-seek", "yes");

  int result = gApi.mpv_initialize(mpv);
  if (result < 0) {
    copyError(std::string("Could not initialise libmpv: ") + gApi.mpv_error_string(result), error, errorLength);
    gApi.mpv_terminate_destroy(mpv);
    delete player;
    return nullptr;
  }

  for (const auto &[name, format] : std::vector<std::pair<const char *, mpv_format>>{
           {"time-pos", MPV_FORMAT_DOUBLE},
           {"duration", MPV_FORMAT_DOUBLE},
           {"pause", MPV_FORMAT_FLAG},
           {"paused-for-cache", MPV_FORMAT_FLAG},
           {"demuxer-cache-time", MPV_FORMAT_DOUBLE},
           {"volume", MPV_FORMAT_DOUBLE},
           {"mute", MPV_FORMAT_FLAG},
           {"speed", MPV_FORMAT_DOUBLE},
           {"aid", MPV_FORMAT_INT64},
           {"sid", MPV_FORMAT_INT64},
           {"sub-delay", MPV_FORMAT_DOUBLE},
           {"sub-pos", MPV_FORMAT_DOUBLE},
           {"sub-visibility", MPV_FORMAT_FLAG},
           {"eof-reached", MPV_FORMAT_FLAG},
           {"media-title", MPV_FORMAT_STRING},
           {"track-list", MPV_FORMAT_NONE},
           {"chapter-list", MPV_FORMAT_NONE},
       }) {
    gApi.mpv_observe_property(mpv, 0, name, format);
  }

  player->running.store(true);
  player->eventThread = std::thread([player]() {
    while (player->running.load() && !player->stopping.load()) {
      mpv_event *event = gApi.mpv_wait_event(player->mpv, -1.0);
      if (!event || event->event_id == MPV_EVENT_NONE) continue;
      player->handleEvent(event);
    }
  });
  return player;
}

/// Puts the video surface into the window that owns `gpuiView`, directly
/// below it, filling the window and following its size. Main thread only.
int plexy_player_attach(PlexyPlayer *player, void *gpuiView) {
  if (!player || !gpuiView) return -1;
  if (![NSThread isMainThread]) return -2;
  NSView *above = (__bridge NSView *)gpuiView;
  NSView *host = above.superview;
  if (!host) return -3;
  PlexyGLView *video = [[PlexyGLView alloc] initWithFrame:host.bounds owner:player];
  NSOpenGLContext *context = [video openGLContext];
  if (!context) return -4;
  player->view = video;
  player->frameSignal->view = video;
  video.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [host addSubview:video positioned:NSWindowBelow relativeTo:above];
  // AppKit may defer prepareOpenGL until the first draw, but libmpv must
  // already have a render context when the caller starts loading a video.
  [context makeCurrentContext];
  player->createRenderContext([context CGLContextObj]);
  [NSOpenGLContext clearCurrentContext];
  return player->render ? 0 : -5;
}

int plexy_player_load(PlexyPlayer *player, const char *path, double startSeconds) {
  if (!player || !path || path[0] != '/') return MPV_ERROR_INVALID_PARAMETER;
  std::string options;
  if (startSeconds > 0) options = "start=+" + std::to_string(startSeconds);
  gApi.mpv_set_property_string(player->mpv, "pause", "no");
  const char *command[] = {"loadfile", path, "replace", "-1", options.empty() ? nullptr : options.c_str(), nullptr};
  return gApi.mpv_command(player->mpv, command);
}

int plexy_player_command(PlexyPlayer *player, const char **args) {
  if (!player || !args) return MPV_ERROR_INVALID_PARAMETER;
  return gApi.mpv_command(player->mpv, args);
}

int plexy_player_set_property(PlexyPlayer *player, const char *name, const char *value) {
  if (!player || !name || !value) return MPV_ERROR_INVALID_PARAMETER;
  return gApi.mpv_set_property_string(player->mpv, name, value);
}

/// Returned strings are released with `plexy_free`.
char *plexy_player_get_property(PlexyPlayer *player, const char *name) {
  if (!player || !name) return nullptr;
  return gApi.mpv_get_property_string(player->mpv, name);
}

void plexy_free(char *value) {
  if (value && gApi.mpv_free) gApi.mpv_free(value);
}

const char *plexy_error_string(int code) {
  return gApi.mpv_error_string ? gApi.mpv_error_string(code) : "libmpv is not loaded";
}

void plexy_player_redraw(PlexyPlayer *player) {
  if (player) player->scheduleFrame();
}

void plexy_player_destroy(PlexyPlayer *player) {
  if (!player) return;
  player->destroy();
  delete player;
}

/// Hides the pointer until the mouse moves (auto-hidden player chrome).
void plexy_hide_cursor_until_moved(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSCursor setHiddenUntilMouseMoves:YES];
  });
}

PlexyPreview *plexy_preview_create(const char *libmpvPath, const char *path, char *error, size_t errorLength) {
  std::string loadError;
  if (!libmpvPath || !loadLibmpv(libmpvPath, loadError)) {
    copyError(loadError, error, errorLength);
    return nullptr;
  }
  if (!path || path[0] != '/') {
    copyError("Previews need an absolute file path", error, errorLength);
    return nullptr;
  }
  auto *preview = new PlexyPreview();
  preview->mpv = gApi.mpv_create();
  if (!preview->mpv) {
    delete preview;
    copyError("Could not create the preview core", error, errorLength);
    return nullptr;
  }
  mpv_handle *mpv = preview->mpv;
  applyOfflineOptions(mpv);
  gApi.mpv_set_property_string(mpv, "vo", "libmpv");
  gApi.mpv_set_property_string(mpv, "ao", "null");
  gApi.mpv_set_property_string(mpv, "aid", "no");
  gApi.mpv_set_property_string(mpv, "sid", "no");
  gApi.mpv_set_property_string(mpv, "sub-auto", "no");
  gApi.mpv_set_property_string(mpv, "audio-file-auto", "no");
  gApi.mpv_set_property_string(mpv, "pause", "yes");
  gApi.mpv_set_property_string(mpv, "keep-open", "always");
  gApi.mpv_set_property_string(mpv, "idle", "yes");
  gApi.mpv_set_property_string(mpv, "hwdec", "no");
  gApi.mpv_set_property_string(mpv, "hr-seek", "no");
  gApi.mpv_set_property_string(mpv, "vd-lavc-skiploopfilter", "all");
  gApi.mpv_set_property_string(mpv, "vd-lavc-fast", "yes");
  gApi.mpv_set_property_string(mpv, "vd-lavc-threads", "2");
  gApi.mpv_set_property_string(mpv, "demuxer-readahead-secs", "0");

  int result = gApi.mpv_initialize(mpv);
  if (result >= 0) {
    int advanced = 0;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_SW},
        {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    result = gApi.mpv_render_context_create(&preview->render, mpv, params);
  }
  if (result >= 0) {
    const char *command[] = {"loadfile", path, "replace", nullptr};
    result = gApi.mpv_command(mpv, command);
  }
  if (result < 0) {
    copyError(std::string("Could not start previews: ") + gApi.mpv_error_string(result), error, errorLength);
    if (preview->render) gApi.mpv_render_context_free(preview->render);
    gApi.mpv_terminate_destroy(mpv);
    delete preview;
    return nullptr;
  }
  return preview;
}

/// Renders the frame nearest `seconds` (keyframe-accurate, which is what
/// scrubbing wants) as BGR0 into `pixels` (`stride * height` bytes). Returns 0
/// on success. Blocking; call it off the UI thread.
int plexy_preview_frame(PlexyPreview *preview, double seconds, int width, int height, int stride, void *pixels) {
  if (!preview || !pixels || width <= 0 || height <= 0) return MPV_ERROR_INVALID_PARAMETER;
  std::lock_guard<std::mutex> lock(preview->mutex);
  if (!preview->loaded) {
    if (!preview->waitFor(MPV_EVENT_FILE_LOADED, 10.0)) return MPV_ERROR_LOADING_FAILED;
    preview->loaded = true;
  }
  std::string target = std::to_string(seconds < 0 ? 0 : seconds);
  const char *command[] = {"seek", target.c_str(), "absolute+keyframes", nullptr};
  int result = gApi.mpv_command(preview->mpv, command);
  if (result < 0) return result;
  if (!preview->waitFor(MPV_EVENT_PLAYBACK_RESTART, 4.0)) return MPV_ERROR_GENERIC;

  // The decoded frame reaches the render context shortly after the restart.
  for (int attempt = 0; attempt < 200; attempt++) {
    uint64_t flags = gApi.mpv_render_context_update(preview->render);
    if (flags & MPV_RENDER_UPDATE_FRAME) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  int size[2] = {width, height};
  size_t strideValue = (size_t)stride;
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_SW_SIZE, size},
      {MPV_RENDER_PARAM_SW_FORMAT, (void *)"bgr0"},
      {MPV_RENDER_PARAM_SW_STRIDE, &strideValue},
      {MPV_RENDER_PARAM_SW_POINTER, pixels},
      {MPV_RENDER_PARAM_INVALID, nullptr},
  };
  return gApi.mpv_render_context_render(preview->render, params);
}

char *plexy_preview_get_property(PlexyPreview *preview, const char *name) {
  if (!preview || !name) return nullptr;
  return gApi.mpv_get_property_string(preview->mpv, name);
}

void plexy_preview_destroy(PlexyPreview *preview) {
  if (!preview) return;
  {
    std::lock_guard<std::mutex> lock(preview->mutex);
    if (preview->render) gApi.mpv_render_context_free(preview->render);
    if (preview->mpv) gApi.mpv_terminate_destroy(preview->mpv);
    preview->render = nullptr;
    preview->mpv = nullptr;
  }
  delete preview;
}

}  // extern "C"


/// The window's frame in global top-left screen points, for `screencapture -R`.
extern "C" int plexy_window_frame(void *gpuiView, double *out) {
  NSView *view = (__bridge NSView *)gpuiView;
  NSWindow *window = view.window;
  NSScreen *primary = NSScreen.screens.firstObject;
  if (!window || !primary || !out) return -1;
  NSRect frame = window.frame;
  out[0] = frame.origin.x;
  out[1] = primary.frame.size.height - (frame.origin.y + frame.size.height);
  out[2] = frame.size.width;
  out[3] = frame.size.height;
  return 0;
}

extern "C" void plexy_set_app_icon(const unsigned char *bytes, size_t len) {
    @autoreleasepool {
        NSData *data = [NSData dataWithBytes:bytes length:len];
        NSImage *image = [[NSImage alloc] initWithData:data];
        if (image) [NSApp setApplicationIconImage:image];
    }
}
