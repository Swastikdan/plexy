package expo.modules.plexymedia

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.provider.Settings
import android.view.WindowManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.provider.OpenableColumns
import android.os.Handler
import android.os.Looper
import androidx.fragment.app.FragmentActivity
import androidx.mediarouter.app.MediaRouteChooserDialogFragment
import androidx.mediarouter.media.MediaRouteSelector
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.io.File
import java.net.Inet4Address

class PlexyMediaModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val playbackRemux = PlaybackRemux()
  private var incoming: Intent? = null
  private var externalUri: Uri? = null
  private var castContext: CastContext? = null
  private var server: CastFileServer? = null
  private var pending: CastRequest? = null
  private var active: CastRequest? = null
  private var loaded = false
  private var lastPosition = 0L

  private data class CastRequest(val id: String, val uri: Uri, val title: String, val start: Long)

  private val castListener = object : SessionManagerListener<CastSession> {
    override fun onSessionStarting(session: CastSession) {}
    override fun onSessionStarted(session: CastSession, sessionId: String) = load(session)
    override fun onSessionStartFailed(session: CastSession, error: Int) = fail("Couldn’t connect to the TV.")
    override fun onSessionEnding(session: CastSession) {}
    override fun onSessionEnded(session: CastSession, error: Int) = clearCast()
    override fun onSessionResuming(session: CastSession, sessionId: String) {}
    override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = load(session)
    override fun onSessionResumeFailed(session: CastSession, error: Int) = fail("Couldn’t reconnect to the TV.")
    override fun onSessionSuspended(session: CastSession, reason: Int) {}
  }

  override fun definition() = ModuleDefinition {
    Name("PlexyMedia")
    Events("onCastError")

    OnNewIntent { intent ->
      if (videoUri(intent) != null) incoming = intent
    }
    OnDestroy {
      playbackRemux.releaseAll()
      main.post {
        stopCast()
        castContext?.sessionManager?.removeSessionManagerListener(castListener, CastSession::class.java)
      }
    }

    // Player gestures drive the real device controls: media volume moves the
    // system STREAM_MUSIC level, and brightness overrides this window only, so
    // leaving the player gives the phone its own brightness back.
    Function("getVolume") {
      val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return@Function 1.0
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
      audio.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max
    }
    Function("setVolume") { level: Double ->
      val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return@Function Unit
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(level.coerceIn(0.0, 1.0) * max).toInt(), 0)
    }
    AsyncFunction("getBrightness") {
      val window = appContext.currentActivity?.window
      val current = window?.attributes?.screenBrightness ?: -1f
      if (current >= 0f) return@AsyncFunction current.toDouble()
      val system = try {
        Settings.System.getInt(appContext.reactContext?.contentResolver, Settings.System.SCREEN_BRIGHTNESS)
      } catch (_: Exception) { 128 }
      (system / 255.0).coerceIn(0.0, 1.0)
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
    AsyncFunction("setBrightness") { level: Double ->
      val window = appContext.currentActivity?.window ?: return@AsyncFunction Unit
      val attributes = window.attributes
      attributes.screenBrightness =
        if (level < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        else level.coerceIn(0.01, 1.0).toFloat()
      window.attributes = attributes
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    Function("createPlaybackRemux") { playbackRemux.create() }

    AsyncFunction("preparePlaybackRemux") { id: String, rawUri: String ->
      val context = appContext.reactContext ?: error("Android storage is unavailable.")
      playbackRemux.run(context, id, Uri.parse(rawUri))
    }

    Function("releasePlaybackRemux") { id: String -> playbackRemux.release(id) }

    AsyncFunction("takeVideo") { requestId: String ->
      val intent = listOfNotNull(incoming, appContext.currentActivity?.intent)
        .firstOrNull { it.data?.getQueryParameter("id") == requestId }
      val uri = intent?.let { videoUri(it) }
      uri?.let(::readVideo)
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("openPickedVideo") { rawUri: String ->
      val uri = Uri.parse(rawUri)
      require(uri.scheme == "content" || uri.scheme == "file") { "Choose a video from Android Files." }
      readVideo(uri, validateType = true)
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("importVideo") { rawUri: String, requestedName: String ->
      val context = appContext.reactContext ?: error("Android storage is unavailable.")
      val uri = Uri.parse(rawUri)
      require(uri == externalUri) { "Open the video again before adding it." }
      val name = requestedName.replace(Regex("[^\\p{L}\\p{N} ._()\\[\\]-]"), "_").trim().take(180)
      require(name.matches(Regex(".+\\.(mp4|mkv|m4v|webm|avi|mov|ts)$", RegexOption.IGNORE_CASE))) {
        "Plexy couldn’t identify this video’s file extension."
      }
      val folder = File(context.filesDir, "external-videos/${java.util.UUID.randomUUID()}").apply { mkdirs() }
      val destination = File(folder, name)
      try {
        val source = context.contentResolver.openInputStream(uri) ?: error("This video is unavailable.")
        source.use { input -> destination.outputStream().use { output -> input.copyTo(output) } }
        Uri.fromFile(destination).toString()
      } catch (error: Exception) {
        destination.delete()
        folder.delete()
        throw error
      }
    }

    AsyncFunction("startCasting") { id: String, rawUri: String, title: String, seconds: Double, promise: Promise ->
      try {
        val activity = appContext.currentActivity ?: error("Open Plexy before casting.")
        val uri = Uri.parse(rawUri)
        require(uri.scheme == "file" || uri.scheme == "content") { "Choose a local video to cast." }
        val context = appContext.reactContext ?: error("Android context is unavailable.")
        val mime = context.contentResolver.getType(uri)
        val name = context.contentResolver.takeIf { uri.scheme == "content" }
          ?.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
          ?.use { if (it.moveToFirst()) it.getString(0) else null } ?: uri.lastPathSegment
        require(mime == "video/mp4" || name?.endsWith(".mp4", ignoreCase = true) == true) {
          "Casting currently supports compatible MP4 videos."
        }
        localAddress(context)
        val cast = castContext ?: CastContext.getSharedInstance(activity).also {
          it.sessionManager.addSessionManagerListener(castListener, CastSession::class.java)
          castContext = it
        }
        pending = CastRequest(id, uri, title, (seconds.coerceAtLeast(0.0) * 1000).toLong())
        val connected = cast.sessionManager.currentCastSession
        if (connected?.isConnected == true) load(connected)
        else {
          val manager = (activity as? FragmentActivity)?.supportFragmentManager
            ?: error("Couldn’t open the Cast device picker.")
          val tag = "PlexyCastDevicePicker"
          if (manager.findFragmentByTag(tag) == null) {
            val selector = cast.mergedSelector ?: MediaRouteSelector.Builder()
              .addControlCategory(CastMediaControlIntent.categoryForCast(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID))
              .build()
            MediaRouteChooserDialogFragment().apply {
              routeSelector = selector
            }.show(manager, tag)
          }
        }
        promise.resolve(null)
      } catch (error: Exception) {
        if (pending?.id == id) pending = null
        promise.reject("CAST_UNAVAILABLE", error.message, error)
      }
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("castStatus") { id: String ->
      val remote = castContext?.sessionManager?.currentCastSession?.remoteMediaClient
      if (active?.id == id && loaded && remote != null) {
        lastPosition = remote.approximateStreamPosition
        mapOf(
          "active" to true,
          "playing" to remote.isPlaying,
          "finished" to (remote.mediaStatus?.idleReason == MediaStatus.IDLE_REASON_FINISHED),
          "position" to lastPosition / 1000.0
        )
      } else if (pending?.id == id || active?.id == id) {
        mapOf("active" to false, "position" to lastPosition / 1000.0)
      } else null
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("castCommand") { id: String, command: String, seconds: Double ->
      if (command == "stop") {
        if (active?.id == id || pending?.id == id) stopCast()
      } else if (active?.id == id && loaded) {
        val remote = castContext?.sessionManager?.currentCastSession?.remoteMediaClient
        when (command) {
          "play" -> remote?.play()
          "pause" -> remote?.pause()
          "seek" -> remote?.seek(MediaSeekOptions.Builder().setPosition((seconds * 1000).toLong()).build())
        }
      }
      Unit
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)
  }

  private fun readVideo(uri: Uri, validateType: Boolean = false): Map<String, String> {
    val resolver = appContext.reactContext?.contentResolver ?: error("Android storage is unavailable.")
    val name = if (uri.scheme == "file") uri.lastPathSegment else resolver
      .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { if (it.moveToFirst()) it.getString(0) else null }
    if (validateType) {
      require(isVideoMimeType(resolver.getType(uri)) ||
        name?.matches(Regex(".+\\.(mp4|mkv|m4v|webm|avi|mov|ts|3gp|mpeg|mpg)$", RegexOption.IGNORE_CASE)) == true) {
        "Choose a supported video file."
      }
    }
    resolver.openAssetFileDescriptor(uri, "r")?.close() ?: error("Android did not grant access to this video.")
    externalUri = uri
    return mapOf("uri" to uri.toString(), "name" to (name ?: "Video"))
  }

  private fun videoUri(intent: Intent): Uri? {
    if (intent.action != Intent.ACTION_VIEW) return null
    if (intent.data?.scheme != "plexy-mobile" || intent.data?.host != "external-player") return null
    val grant = intent.clipData ?: return null
    if (grant.itemCount != 1) return null
    return grant.getItemAt(0).uri?.takeIf { it.scheme == "content" }
  }

  private fun localAddress(context: Context): String {
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = connectivity.activeNetwork
    val caps = connectivity.getNetworkCapabilities(network)
    require(network != null && (caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true ||
      caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true)) { "Connect to the same Wi-Fi network as your TV." }
    return connectivity.getLinkProperties(network)?.linkAddresses
      ?.map { it.address }?.filterIsInstance<Inet4Address>()
      ?.firstOrNull { !it.isLoopbackAddress }?.hostAddress ?: error("No local IP address is available.")
  }

  private fun load(session: CastSession) {
    val request = pending ?: return
    pending = null
    clearCast()
    active = request
    try {
      val context = appContext.reactContext ?: error("Android storage is unavailable.")
      val remote = session.remoteMediaClient ?: error("The TV is not ready.")
      val stream = CastFileServer(localAddress(context), context.contentResolver, request.uri)
      server = stream
      stream.start()
      val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE)
      metadata.putString(MediaMetadata.KEY_TITLE, request.title)
      val media = MediaInfo.Builder(stream.url)
        .setContentType("video/mp4")
        .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
        .setMetadata(metadata)
        .build()
      lastPosition = request.start
      remote.load(MediaLoadRequestData.Builder().setMediaInfo(media).setAutoplay(true).setCurrentTime(request.start).build())
        .setResultCallback { result ->
          if (active !== request) return@setResultCallback
          if (result.status.isSuccess) loaded = true else fail("The TV couldn’t play this file.")
        }
    } catch (error: Exception) {
      fail(error.message ?: "Couldn’t start casting.")
    }
  }

  private fun stopCast() {
    if (active != null) {
      castContext?.sessionManager?.currentCastSession?.remoteMediaClient?.stop()
      castContext?.sessionManager?.endCurrentSession(true)
    }
    pending = null
    clearCast()
  }

  private fun clearCast() {
    active = null
    loaded = false
    server?.stop()
    server = null
  }

  private fun fail(message: String) {
    val id = active?.id ?: pending?.id
    pending = null
    clearCast()
    if (id != null) sendEvent("onCastError", mapOf("id" to id, "message" to message))
  }
}
