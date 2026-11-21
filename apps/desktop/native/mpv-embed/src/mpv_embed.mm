/// Embedded libmpv surface for the Plexy desktop app.
///
/// libmpv renders into an NSOpenGLView that lives *below* Chromium's compositor
/// view inside the main window. The renderer keeps its page transparent over the
/// video rectangle, so the React player chrome draws on top of the native video
/// frames instead of beside them in a second window.
///
/// The module intentionally exposes a small surface: attach/detach, bounds,
/// playback commands and a typed event stream. It never accepts a filesystem
/// path or an arbitrary executable from the renderer.
#import <AppKit/AppKit.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl3.h>
#include <dlfcn.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "mpv/client.h"
#include "mpv/render.h"
#include "mpv/render_gl.h"

#define NAPI_VERSION 8
#include "node_api.h"

struct MpvEmbed;

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

  bool load(const std::string &path, std::string &error) {
    handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
      const char *reason = dlerror();
      error = reason ? reason : "Could not load libmpv";
      return false;
    }
#define PLEXY_LOAD_SYMBOL(field, name)                                                  \
  do {                                                                                  \
    *(void **)(&field) = dlsym(handle, name);                                           \
    if (!field) {                                                                        \
      error = std::string("libmpv is missing ") + name;                                  \
      return false;                                                                      \
    }                                                                                    \
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
#undef PLEXY_LOAD_SYMBOL
    return true;
  }
};

static MpvApi gApi;
static std::once_flag gApiOnce;

static bool loadLibmpv(const std::string &path, std::string &error) {
  std::call_once(gApiOnce, [&]() { gApi.load(path, error); });
  if (!gApi.handle && error.empty()) error = "libmpv is not loaded";
  return gApi.handle != nullptr;
}

// MARK: - Event payloads

enum PayloadKind {
  kPayloadPropertyNumber = 1,
  kPayloadPropertyFlag = 2,
  kPayloadPropertyInt = 3,
  kPayloadEvent = 4,
  kPayloadError = 5,
  kPayloadPropertyString = 6,
};

struct EventPayload {
  PayloadKind kind;
  std::string name;
  std::string text;
  double number = 0;
  int64_t integer = 0;
  bool flag = false;
};

// MARK: - MpvEmbed

struct MpvEmbed {
  mpv_handle *mpv = nullptr;
  mpv_render_context *render = nullptr;
  napi_threadsafe_function tsfn = nullptr;
  std::thread eventThread;
  std::atomic<bool> running{false};
  std::atomic<bool> stopping{false};
  std::atomic<bool> framePending{false};
  std::string libPath;

  NSView *view = nil;
  NSView *host = nil;

  std::mutex renderMutex;

  void post(EventPayload *payload) {
    if (!tsfn) {
      delete payload;
      return;
    }
    if (napi_call_threadsafe_function(tsfn, payload, napi_tsfn_nonblocking) != napi_ok) {
      delete payload;
    }
  }

  void postEvent(const char *name) {
    auto *p = new EventPayload();
    p->kind = kPayloadEvent;
    p->name = name;
    post(p);
  }

  void postError(const std::string &message) {
    auto *p = new EventPayload();
    p->kind = kPayloadError;
    p->text = message;
    post(p);
  }

  void scheduleFrame() {
    if (framePending.exchange(true)) return;
    dispatch_async(dispatch_get_main_queue(), ^{
      framePending.store(false);
      NSView *target = view;
      if (target && !target.hidden) [target setNeedsDisplay:YES];
    });
  }

  void handleEvent(mpv_event *event);
  void startLoop();
  void createRenderContext(CGLContextObj ctx);
  void destroyRenderContext();
  void destroy();
};

// MARK: - Video view

/// libmpv's OpenGL render API draws straight into an NSOpenGLView.
///
/// A CAOpenGLLayer looked like the natural fit, but on current macOS it is
/// never asked to draw when it sits below Chromium's compositor view. An
/// NSOpenGLView is a real view surface, composites correctly there, and keeps
/// the React chrome above the video inside a single window.
@interface PlexyGLView : NSOpenGLView
@property (nonatomic, assign) MpvEmbed *owner;
- (instancetype)initWithFrame:(NSRect)frame owner:(MpvEmbed *)owner;
@end

@implementation PlexyGLView

- (instancetype)initWithFrame:(NSRect)frame owner:(MpvEmbed *)owner {
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
  MpvEmbed *owner = self.owner;
  if (!owner) return;
  mpv_render_context *render = owner->render;
  if (!render) {
    return;
  }

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
  CGLFlushDrawable(cgl);
  CGLUnlockContext(cgl);
}

@end

// MARK: - Embed implementation

void MpvEmbed::createRenderContext(CGLContextObj ctx) {
  std::lock_guard<std::mutex> lock(renderMutex);
  if (render || !mpv) return;

  mpv_opengl_init_params glInit = {
      [](void *, const char *name) -> void * {
        return (void *)dlsym(RTLD_DEFAULT, name);
      },
      nullptr,
  };
  int advanced = 1;
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_API_TYPE, (void *)MPV_RENDER_API_TYPE_OPENGL},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
      {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced},
      {MPV_RENDER_PARAM_INVALID, nullptr},
  };
  mpv_render_context *created = nullptr;
  int result = gApi.mpv_render_context_create(&created, mpv, params);
  if (result < 0) {
    postError(std::string("Could not start the video renderer: ") + gApi.mpv_error_string(result));
    return;
  }
  render = created;
  gApi.mpv_render_context_set_update_callback(
      render,
      [](void *data) {
        auto *self = static_cast<MpvEmbed *>(data);
        self->scheduleFrame();
      },
      this);
  dispatch_async(dispatch_get_main_queue(), ^{
    NSView *target = view;
    if (target) [target setNeedsDisplay:YES];
  });
  postEvent("render-ready");
}

void MpvEmbed::destroyRenderContext() {
  std::lock_guard<std::mutex> lock(renderMutex);
  if (render) {
    PlexyGLView *glView = [view isKindOfClass:[PlexyGLView class]] ? (PlexyGLView *)view : nil;
    if (glView) [[glView openGLContext] makeCurrentContext];
    gApi.mpv_render_context_free(render);
    render = nullptr;
  }
}

void MpvEmbed::handleEvent(mpv_event *event) {
  switch (event->event_id) {
    case MPV_EVENT_LOG_MESSAGE: {
      // libmpv reports recoverable problems (a malformed subtitle packet, a
      // decoder fallback, a failed cover-art probe) at error level while
      // playback continues. They belong in the console, not in the player's
      // fatal dialog; only renderer/end-file failures below are user-facing.
      auto *message = (mpv_event_log_message *)event->data;
      if (message && message->level && strcmp(message->level, "error") == 0) {
        fprintf(stderr, "[Plexy mpv] %s\n", message->text ? message->text : "Playback error");
      }
      break;
    }
    case MPV_EVENT_FILE_LOADED:
      postEvent("loaded");
      break;
    case MPV_EVENT_VIDEO_RECONFIG:
      postEvent("video-reconfig");
      break;
    case MPV_EVENT_PLAYBACK_RESTART:
      postEvent("playback-restart");
      break;
    case MPV_EVENT_END_FILE: {
      auto *end = (mpv_event_end_file *)event->data;
      if (!end) break;
      if (end->reason == MPV_END_FILE_REASON_EOF) {
        postEvent("ended");
      } else if (end->reason == MPV_END_FILE_REASON_ERROR) {
        postError(std::string("Playback failed: ") + gApi.mpv_error_string(end->error));
      } else {
        postEvent("stopped");
      }
      break;
    }
    case MPV_EVENT_PROPERTY_CHANGE: {
      auto *property = (mpv_event_property *)event->data;
      if (!property || !property->data) break;
      auto *payload = new EventPayload();
      payload->name = property->name ? property->name : "";
      switch (property->format) {
        case MPV_FORMAT_DOUBLE:
          payload->kind = kPayloadPropertyNumber;
          payload->number = *(double *)property->data;
          break;
        case MPV_FORMAT_FLAG:
          payload->kind = kPayloadPropertyFlag;
          payload->flag = *(int *)property->data != 0;
          break;
        case MPV_FORMAT_INT64:
          payload->kind = kPayloadPropertyInt;
          payload->integer = *(int64_t *)property->data;
          break;
        case MPV_FORMAT_STRING:
          payload->kind = kPayloadPropertyString;
          payload->text = *(char **)property->data ? *(char **)property->data : "";
          break;
        default:
          delete payload;
          return;
      }
      post(payload);
      break;
    }
    case MPV_EVENT_SHUTDOWN:
      running.store(false);
      break;
    default:
      break;
  }
}

void MpvEmbed::startLoop() {
  running.store(true);
  eventThread = std::thread([this]() {
    while (running.load() && !stopping.load()) {
      mpv_event *event = gApi.mpv_wait_event(mpv, 0.5);
      if (!event || event->event_id == MPV_EVENT_NONE) continue;
      handleEvent(event);
    }
  });
}

void MpvEmbed::destroy() {
  if (stopping.exchange(true)) return;
  running.store(false);
  if (mpv) gApi.mpv_wakeup(mpv);
  if (eventThread.joinable()) eventThread.join();

  destroyRenderContext();

  if (tsfn) {
    napi_threadsafe_function tsfnCopy = tsfn;
    tsfn = nullptr;
    napi_release_threadsafe_function(tsfnCopy, napi_tsfn_release);
  }

  if (view) {
    [view removeFromSuperview];
    view = nil;
  }
  host = nil;
  if (mpv) {
    gApi.mpv_terminate_destroy(mpv);
    mpv = nullptr;
  }
}

// MARK: - N-API plumbing

static void callJs(napi_env env, napi_value callback, void *, void *data) {
  auto *payload = static_cast<EventPayload *>(data);
  if (!env || !callback) {
    delete payload;
    return;
  }
  napi_value object;
  napi_create_object(env, &object);
  auto setString = [&](const char *key, const std::string &value) {
    napi_value string;
    napi_create_string_utf8(env, value.c_str(), NAPI_AUTO_LENGTH, &string);
    napi_set_named_property(env, object, key, string);
  };
  auto setNumber = [&](const char *key, double value) {
    napi_value number;
    napi_create_double(env, value, &number);
    napi_set_named_property(env, object, key, number);
  };
  auto setFlag = [&](const char *key, bool value) {
    napi_value flag;
    napi_get_boolean(env, value, &flag);
    napi_set_named_property(env, object, key, flag);
  };

  switch (payload->kind) {
    case kPayloadPropertyNumber:
      setString("type", "property");
      setString("name", payload->name);
      setNumber("value", payload->number);
      break;
    case kPayloadPropertyFlag:
      setString("type", "property");
      setString("name", payload->name);
      setFlag("value", payload->flag);
      break;
    case kPayloadPropertyInt:
      setString("type", "property");
      setString("name", payload->name);
      setNumber("value", (double)payload->integer);
      break;
    case kPayloadPropertyString:
      setString("type", "property");
      setString("name", payload->name);
      setString("value", payload->text);
      break;
    case kPayloadEvent:
      setString("type", "event");
      setString("name", payload->name);
      break;
    case kPayloadError:
      setString("type", "error");
      setString("message", payload->text);
      break;
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_call_function(env, undefined, callback, 1, &object, nullptr);
  delete payload;
}

static void finalizeEmbed(napi_env, void *data, void *) {
  auto *embed = static_cast<MpvEmbed *>(data);
  if (!embed) return;
  embed->destroy();
  delete embed;
}

static double getArgNumber(napi_env env, napi_value value, double fallback = 0) {
  double result = fallback;
  if (napi_get_value_double(env, value, &result) != napi_ok) return fallback;
  return result;
}

static bool isString(napi_env env, napi_value value) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok) return false;
  return type == napi_string;
}

static std::string getArgString(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return "";
  std::string result(length, '\0');
  size_t copied = 0;
  if (napi_get_value_string_utf8(env, value, &result[0], length + 1, &copied) != napi_ok) return "";
  result.resize(copied);
  return result;
}

static napi_value makeBoolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static MpvEmbed *unwrapThis(napi_env env, napi_callback_info info, size_t *argc, napi_value *argv) {
  napi_value self;
  void *data = nullptr;
  napi_get_cb_info(env, info, argc, argv, &self, nullptr);
  napi_unwrap(env, self, &data);
  return static_cast<MpvEmbed *>(data);
}

// MARK: - N-API methods

static napi_value Construct(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_value self;
  napi_get_cb_info(env, info, &argc, argv, &self, nullptr);

  if (argc < 2 || !isString(env, argv[0])) {
    napi_throw_type_error(env, nullptr, "MpvEmbed(libmpvPath, onEvent)");
    return nullptr;
  }
  napi_value callback = argv[1];
  napi_valuetype callbackType;
  if (napi_typeof(env, callback, &callbackType) != napi_ok || callbackType != napi_function) {
    napi_throw_type_error(env, nullptr, "The event callback must be a function");
    return nullptr;
  }

  std::string libPath = getArgString(env, argv[0]);
  std::string loadError;
  if (!loadLibmpv(libPath, loadError)) {
    napi_throw_error(env, nullptr, loadError.c_str());
    return nullptr;
  }

  auto *embed = new MpvEmbed();
  embed->libPath = libPath;
  embed->mpv = gApi.mpv_create();
  if (!embed->mpv) {
    delete embed;
    napi_throw_error(env, nullptr, "Could not create the libmpv player");
    return nullptr;
  }

  // One video surface per window: no embedded windowing, no player chrome.
  gApi.mpv_set_property_string(embed->mpv, "vo", "libmpv");
  gApi.mpv_set_property_string(embed->mpv, "ao", "coreaudio");
  gApi.mpv_set_property_string(embed->mpv, "hwdec", "auto-safe");
  gApi.mpv_set_property_string(embed->mpv, "keep-open", "yes");
  gApi.mpv_set_property_string(embed->mpv, "idle", "yes");
  gApi.mpv_set_property_string(embed->mpv, "pause", "yes");
  gApi.mpv_set_property_string(embed->mpv, "osc", "no");
  gApi.mpv_set_property_string(embed->mpv, "input-default-bindings", "no");
  gApi.mpv_set_property_string(embed->mpv, "input-vo-keyboard", "no");
  gApi.mpv_set_property_string(embed->mpv, "save-position-on-quit", "no");
  gApi.mpv_set_property_string(embed->mpv, "sub-auto", "no");
  gApi.mpv_set_property_string(embed->mpv, "audio-file-auto", "no");
  gApi.mpv_set_property_string(embed->mpv, "user-agent", "Plexy-Native");
  gApi.mpv_set_property_string(embed->mpv, "title", "Plexy");

  int result = gApi.mpv_initialize(embed->mpv);
  if (result < 0) {
    std::string message = std::string("Could not initialise libmpv: ") + gApi.mpv_error_string(result);
    gApi.mpv_terminate_destroy(embed->mpv);
    delete embed;
    napi_throw_error(env, nullptr, message.c_str());
    return nullptr;
  }

  napi_value resourceName;
  napi_create_string_utf8(env, "PlexyMpvEmbed", NAPI_AUTO_LENGTH, &resourceName);
  if (napi_create_threadsafe_function(env, callback, nullptr, resourceName, 0, 1, nullptr, nullptr, nullptr, callJs,
                                      &embed->tsfn) != napi_ok) {
    gApi.mpv_terminate_destroy(embed->mpv);
    delete embed;
    napi_throw_error(env, nullptr, "Could not create the player event channel");
    return nullptr;
  }

  napi_wrap(env, self, embed, finalizeEmbed, nullptr, nullptr);

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
       }) {
    gApi.mpv_observe_property(embed->mpv, 0, name, format);
  }

  embed->startLoop();
  return self;
}

static napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value argv[5];
  MpvEmbed *embed = unwrapThis(env, info, &argc, argv);
  if (!embed || argc < 5) {
    napi_throw_type_error(env, nullptr, "attach(view, x, y, width, height)");
    return nullptr;
  }

  void *raw = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, argv[0], &raw, &length) != napi_ok || length < sizeof(void *)) {
    napi_throw_type_error(env, nullptr, "attach expects the window's native handle");
    return nullptr;
  }
  void *handle = *reinterpret_cast<void **>(raw);
  double x = getArgNumber(env, argv[1]);
  double y = getArgNumber(env, argv[2]);
  double width = getArgNumber(env, argv[3]);
  double height = getArgNumber(env, argv[4]);

  __block bool attached = false;
  __block std::string failure;
  auto attachWork = ^{
    NSView *host = (__bridge NSView *)handle;
    if (!host) {
      failure = "The Plexy window is not available";
      return;
    }
    // Electron hands us the window's content view. The video surface goes
    // below Chromium's compositor view so the page stays on top, while its
    // transparent pixels let the video through.
    embed->host = host;
    PlexyGLView *video = [[PlexyGLView alloc] initWithFrame:NSMakeRect(0, 0, width, height) owner:embed];
    video.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    video.hidden = YES;
    embed->view = video;

    // Sit underneath the view Chromium composites the page into. Placing the
    // surface below the web contents wrapper alone is not enough on macOS:
    // the compositor superview is what actually paints the page.
    NSView *below = nil;
    for (NSView *child in host.subviews) {
      NSString *name = NSStringFromClass([child class]);
      if ([name containsString:@"Compositor"]) {
        below = child;
        break;
      }
    }
    if (!below) below = host.subviews.firstObject;
    [host addSubview:video positioned:NSWindowBelow relativeTo:below];
    CGFloat hostHeight = host.bounds.size.height;
    BOOL flipped = host.isFlipped;
    CGFloat top = flipped ? y : hostHeight - y - height;
    video.frame = NSMakeRect(x, top, width, height);
    attached = true;
  };

  if ([NSThread isMainThread]) {
    attachWork();
  } else {
    dispatch_sync(dispatch_get_main_queue(), attachWork);
  }

  if (!attached) {
    napi_throw_error(env, nullptr, failure.empty() ? "Could not attach the video surface" : failure.c_str());
    return nullptr;
  }
  return makeBoolean(env, true);
}

static napi_value SetBounds(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  MpvEmbed *embed = unwrapThis(env, info, &argc, argv);
  if (!embed || argc < 4) return nullptr;
  double x = getArgNumber(env, argv[0]);
  double y = getArgNumber(env, argv[1]);
  double width = getArgNumber(env, argv[2]);
  double height = getArgNumber(env, argv[3]);

  NSView *view = embed->view;
  if (!view) return makeBoolean(env, false);
  dispatch_async(dispatch_get_main_queue(), ^{
    NSView *host = view.superview;
    if (!host) return;
    CGFloat top = host.isFlipped ? y : host.bounds.size.height - y - height;
    view.frame = NSMakeRect(x, top, width, height);
    [view setNeedsDisplay:YES];
  });
  return makeBoolean(env, true);
}

static napi_value SetVisible(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  MpvEmbed *embed = unwrapThis(env, info, &argc, argv);
  if (!embed || argc < 1) return nullptr;
  bool visible = false;
  napi_get_value_bool(env, argv[0], &visible);
  NSView *view = embed->view;
  dispatch_async(dispatch_get_main_queue(), ^{
    view.hidden = !visible;
    if (visible) [view setNeedsDisplay:YES];
  });
  return makeBoolean(env, true);
}

static napi_value Load(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  MpvEmbed *embed = unwrapThis(env, info, &argc, argv);
  if (!embed || argc < 1 || !isString(env, argv[0])) {
    napi_throw_type_error(env, nullptr, "load(url, startSeconds, title, audioLanguage)");
    return nullptr;
  }
  std::string url = getArgString(env, argv[0]);
  double start = argc > 1 ? getArgNumber(env, argv[1]) : 0;
  std::string title = argc > 2 && isString(env, argv[2]) ? getArgString(env, argv[2]) : "";
  std::string audioLanguage = argc > 3 && isString(env, argv[3]) ? getArgString(env, argv[3]) : "";

  dispatch_async(dispatch_get_main_queue(), ^{
    NSView *view = embed->view;
    view.hidden = NO;
    [view setNeedsDisplay:YES];
  });

  if (!title.empty()) gApi.mpv_set_property_string(embed->mpv, "title", title.c_str());
  gApi.mpv_set_property_string(embed->mpv, "alang", audioLanguage.empty() ? "auto" : audioLanguage.c_str());
  gApi.mpv_set_property_string(embed->mpv, "pause", "no");

  // Options are per-file so a later title never inherits this one's resume
  // point. `start=+N` seeks N seconds into the file when demuxing begins.
  std::string options;
  if (start > 0) options += "start=+" + std::to_string(start);
  if (!audioLanguage.empty()) {
    if (!options.empty()) options += ",";
    options += "alang=" + audioLanguage;
  }

  const char *command[] = {"loadfile", url.c_str(), "replace", "-1", options.empty() ? nullptr : options.c_str(),
                           nullptr};
  int result = gApi.mpv_command(embed->mpv, command);
  if (result < 0) {
    napi_throw_error(env, nullptr, gApi.mpv_error_string(result));
    return nullptr;
  }
  return makeBoolean(env, true);
}

static napi_value SetProperty(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  MpvEmbed *embed = unwrapThis(env, info, &argc, argv);
  if (!embed || argc < 2 || !isString(env, argv[0])) {
    napi_throw_type_error(env, nullptr, "setProperty(name, value)");
    return nullptr;
  }
  std::string name = getArgString(env, argv[0]);
  napi_valuetype type;
  napi_typeof(env, argv[1], &type);
  int result = 0;
  if (type == napi_boolean) {
    bool value = false;
    napi_get_value_bool(env, argv[1], &value);
    int flag = value ? 1 : 0;
    result = gApi.mpv_set_property(embed->mpv, name.c_str(), MPV_FORMAT_FLAG, &flag);
  } else if (type == napi_number) {
    double value = 0;
    napi_get_value_double(env, argv[1], &value);
    // Integer properties such as `aid`/`sid` reject MPV_FORMAT_DOUBLE; double
    // properties such as `volume`/`speed` reject MPV_FORMAT_INT64. Try the
    // natural type for an integral number first, then fall back.
    if (std::trunc(value) == value) {
      int64_t integer = (int64_t)value;
      result = gApi.mpv_set_property(embed->mpv, name.c_str(), MPV_FORMAT_INT64, &integer);
      if (result < 0) {
        result = gApi.mpv_set_property(embed->mpv, name.c_str(), MPV_FORMAT_DOUBLE, &value);
      }
    } else {
      result = gApi.mpv_set_property(embed->mpv, name.c_str(), MPV_FORMAT_DOUBLE, &value);
    }
    if (result < 0) {
      const std::string text = std::to_string(value);
      result = gApi.mpv_set_property_string(embed->mpv, name.c_str(), text.c_str());
    }
  } else if (type == napi_string) {
    std::string value = getArgString(env, argv[1]);
    result = gApi.mpv_set_property_string(embed->mpv, name.c_str(), value.c_str());
  } else if (type == napi_null || type == napi_undefined) {
    result = gApi.mpv_set_property_string(embed->mpv, name.c_str(), "no");
  } else {
    napi_throw_type_error(env, nullptr, "Unsupported property value");
    return nullptr;
  }
  if (result < 0) {
    napi_throw_error(env, nullptr, gApi.mpv_error_string(result));
    return nullptr;
  }
  return makeBoolean(env, true);
}

static napi_value GetPropertyString(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  MpvEmbed *embed = unwrapThis(env, info, &argc, argv);
  if (!embed || argc < 1 || !isString(env, argv[0])) return nullptr;
  std::string name = getArgString(env, argv[0]);
  char *value = gApi.mpv_get_property_string(embed->mpv, name.c_str());
  if (!value) {
    napi_value nullValue;
    napi_get_null(env, &nullValue);
    return nullValue;
  }
  napi_value result;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
  gApi.mpv_free(value);
  return result;
}

static napi_value Command(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  MpvEmbed *embed = unwrapThis(env, info, &argc, argv);
  if (!embed || argc < 1) {
    napi_throw_type_error(env, nullptr, "command(parts)");
    return nullptr;
  }
  bool isArray = false;
  napi_is_array(env, argv[0], &isArray);
  if (!isArray) {
    napi_throw_type_error(env, nullptr, "command expects an array of strings");
    return nullptr;
  }
  uint32_t length = 0;
  napi_get_array_length(env, argv[0], &length);
  std::vector<std::string> storage;
  storage.reserve(length);
  for (uint32_t index = 0; index < length; index++) {
    napi_value item;
    napi_get_element(env, argv[0], index, &item);
    storage.push_back(getArgString(env, item));
  }
  std::vector<const char *> parts;
  parts.reserve(storage.size() + 1);
  for (const auto &part : storage) parts.push_back(part.c_str());
  parts.push_back(nullptr);
  int result = gApi.mpv_command(embed->mpv, parts.data());
  if (result < 0) {
    napi_throw_error(env, nullptr, gApi.mpv_error_string(result));
    return nullptr;
  }
  return makeBoolean(env, true);
}

static napi_value Destroy(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  MpvEmbed *embed = unwrapThis(env, info, &argc, nullptr);
  if (embed) embed->destroy();
  return makeBoolean(env, true);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
      {"attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setBounds", nullptr, SetBounds, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setVisible", nullptr, SetVisible, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"load", nullptr, Load, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setProperty", nullptr, SetProperty, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getPropertyString", nullptr, GetPropertyString, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"command", nullptr, Command, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"destroy", nullptr, Destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };

  napi_value constructor;
  napi_define_class(env, "MpvEmbed", NAPI_AUTO_LENGTH, Construct, nullptr,
                    sizeof(methods) / sizeof(methods[0]), methods, &constructor);
  napi_set_named_property(env, exports, "MpvEmbed", constructor);

  napi_value apiVersion;
  napi_create_int32(env, MPV_CLIENT_API_VERSION, &apiVersion);
  napi_set_named_property(env, exports, "mpvClientApiVersion", apiVersion);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
