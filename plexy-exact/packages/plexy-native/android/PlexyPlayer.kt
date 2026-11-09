package com.plexy.local

import android.content.Context
import android.view.TextureView
import android.view.View
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.exoplayer.ExoPlayer
import dev.exact.canvas.ExactExtension
import dev.exact.canvas.ExtensionContext
import org.json.JSONObject
import org.json.JSONArray

// Contract owns controls: the pinned host does not forward MotionEvents to child widgets.
class PlexyNative(context: ExtensionContext) : ExactExtension(context) {
    private data class State(val player: ExoPlayer, val emit: (String, String) -> Unit, var source: String = "", var seek: Long = -1, var props: JSONObject = JSONObject(), var pip: Int = 0, var pipRequested: Boolean = false, var fullScreen: Boolean = false, var shown: Boolean = true, val id: String = "", val session: String = "")
    private val converter = PlexyConvert(context)
    private val media = PlexyMediaStore(context)
    private val players = mutableMapOf<View, State>()
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            players.values.forEach { s ->
                if (!context.foreground && context.activity?.isInPictureInPictureMode != true) { s.pipRequested = false; s.player.pause() }
                if (s.player.duration > 0) s.emit("message", JSONObject().put("position", s.player.currentPosition / 1000.0)
                    .put("audioChoice", s.props.optInt("audio", -2)).put("subtitleChoice", s.props.optInt("subtitle", -1)).put("duration", s.player.duration / 1000.0).put("audio", labels(s.player, C.TRACK_TYPE_AUDIO)).put("subtitles", labels(s.player, C.TRACK_TYPE_TEXT)).put("error", s.player.playerError?.message ?: "").toString())
            }
            if (players.isNotEmpty()) handler.postDelayed(this, 2000)
        }
    }
    private fun labels(player: ExoPlayer, type: Int): JSONArray {
        val result = JSONArray()
        player.currentTracks.groups.filter { it.type == type }.forEach { group ->
            for (i in 0 until group.length) {
                val format = group.getTrackFormat(i)
                result.put(format.label ?: format.language ?: "Track ${result.length() + 1}")
            }
        }
        return result
    }
    override fun later(name: String, args: JSONObject, reply: (JSONObject) -> Unit) { when (name) {
        "verifyPlayback" -> converter.verifyPlayback(args.optString("path"), reply)
        "probeMedia" -> converter.probe(args.optString("path"), reply)
        "executeConversion" -> converter.execute(args.optString("arguments"), reply)
        "cancelNativeConversion" -> { converter.cancel(); reply(JSONObject().put("ok", true).put("message", "Canceled")) }
        "codecSupport" -> {
            val mime = when (args.optString("codec")) { "hevc" -> "video/hevc"; "h264" -> "video/avc"; "av1" -> "video/av01"; else -> "" }
            val supported = android.media.MediaCodecList(android.media.MediaCodecList.ALL_CODECS).codecInfos.any { codec ->
                !codec.isEncoder && codec.supportedTypes.any { it.equals(mime, true) } && runCatching {
                    codec.getCapabilitiesForType(mime).videoCapabilities?.isSizeSupported(args.optInt("width", 1920).coerceAtLeast(16), args.optInt("height", 1080).coerceAtLeast(16)) == true
                }.getOrDefault(false)
            }
            reply(JSONObject().put("supported", supported))
        }
        "freeSpace" -> {
            val file = context.file(args.optString("path"))
            reply(JSONObject().put("bytes", if (file == null) 0 else android.os.StatFs(file.path).availableBytes).put("onBattery", false))
        }
        "resolveLocalPath" -> { reply(JSONObject().put("path", context.file(args.optString("path"))?.path ?: "")) }
        "reservePartial" -> {
            val file = context.file(args.optString("path"))
            try { reply(JSONObject().put("ok", file?.createNewFile() == true).put("message", "Partial output must not already exist")) }
            catch (e: Exception) { reply(JSONObject().put("ok", false).put("message", e.message)) }
        }
        "publishMedia" -> {
            try {
                val partial = context.file(args.optString("partial")) ?: error("Invalid partial")
                val destination = context.file(args.optString("destination")) ?: error("Invalid destination")
                android.system.Os.link(partial.path, destination.path); partial.delete()
                reply(JSONObject().put("ok", true).put("message", "Published"))
            } catch (e: Exception) { reply(JSONObject().put("ok", false).put("message", e.message ?: "Publication failed")) }
        }
        "openUpdate" -> {
            val path = args.optString("path")
            if (path != "app:/data/plexy-exact-android.apk") { reply(JSONObject().put("ok", false).put("message", "Invalid update")); return }
            val uri = context.contentUri(path)
            if (uri == null) { reply(JSONObject().put("ok", false).put("message", "Verified update is unavailable")); return }
            try {
                val intent = if (context.application.packageManager.canRequestPackageInstalls())
                    android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                else android.content.Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:${context.application.packageName}"))
                context.application.startActivity(intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                reply(JSONObject().put("ok", true).put("message", "Continue in Android's installer. If permission was requested, enable it and tap Install again."))
            } catch (e: Exception) { reply(JSONObject().put("ok", false).put("message", e.message ?: "Installer could not open")) }
        }
        "listDeviceVideos" -> media.list(reply)
        "importVideo" -> media.import(args.optString("id"), reply)
        else -> reply(JSONObject().put("error", "NotSupportedError"))
    } }
    override fun view(tag: String, session: String, id: String, context: Context, props: JSONObject, emit: (String, String) -> Unit): View {
        require(tag == "plexy-player")
        val view = TextureView(context)
        val player = ExoPlayer.Builder(context).setAudioAttributes(androidx.media3.common.AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true).setHandleAudioBecomingNoisy(true).build()
        player.setVideoTextureView(view)
        players[view] = State(player, emit, id=id, session=session)
        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                emit("message", JSONObject().put("position", 0).put("duration", 0).put("audio", JSONArray()).put("subtitles", JSONArray()).put("error", error.message ?: "This device cannot play the media. Convert it on your Mac.").toString())
            }
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                update(view, players[view]?.props ?: props)
            }
        })
        update(view, props)
        handler.removeCallbacks(tick); handler.post(tick)
        return view
    }
    override fun update(view: View, props: JSONObject) {
        val s = players[view] ?: return
        s.props = props
        val activity = context.activity
        val fullscreen = props.optBoolean("fullScreen")
        if (fullscreen != s.fullScreen) {
            s.fullScreen = fullscreen
            activity?.requestedOrientation = if (fullscreen) android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            if (fullscreen) activity?.window?.insetsController?.hide(android.view.WindowInsets.Type.systemBars())
            else activity?.window?.insetsController?.show(android.view.WindowInsets.Type.systemBars())
        }
        val pip = props.optInt("pipRequest")
        if (pip > s.pip) { s.pip = pip; s.pipRequested = true; s.pipRequested = activity?.enterPictureInPictureMode(android.app.PictureInPictureParams.Builder().setAspectRatio(android.util.Rational(16, 9)).build()) == true }

        val source = props.optString("source")
        if (source != s.source) {
            val file = context.file(source) ?: throw IllegalArgumentException("Local media access denied")
            s.source = source; s.seek = -1
            s.player.setMediaItem(MediaItem.fromUri(android.net.Uri.fromFile(file)))
            s.player.prepare()
        }
        s.player.playWhenReady = s.shown && !props.optBoolean("isPaused", false)
        val seek = (props.optDouble("seek", 0.0) * 1000).toLong()
        if (seek >= 0 && seek != s.seek) { s.seek = seek; s.player.seekTo(seek) }
        val builder = s.player.trackSelectionParameters.buildUpon().setPreferredAudioLanguage(props.optString("audioLanguage", "en")).setPreferredTextLanguage(props.optString("subtitleLanguage", "en"))
        for ((key, type) in listOf("audio" to C.TRACK_TYPE_AUDIO, "subtitle" to C.TRACK_TYPE_TEXT)) {
            val index = props.optInt(key, -2)
            if (index == -1 && type == C.TRACK_TYPE_TEXT) builder.setTrackTypeDisabled(type, true)
            else if (index == -2) builder.setTrackTypeDisabled(type, false).clearOverridesOfType(type)
            else if (index >= 0) {
                val tracks = s.player.currentTracks.groups.filter { it.type == type }.flatMap { group -> (0 until group.length).map { group to it } }
                tracks.getOrNull(index)?.let { (group, track) -> builder.setTrackTypeDisabled(type, false).setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, listOf(track))) }
            }
        }
        s.player.trackSelectionParameters = builder.build()
    }
    override fun destroyView(view: View) {
        players.remove(view)?.player?.release()
        if (players.isEmpty()) {
            handler.removeCallbacks(tick)
            context.activity?.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            context.activity?.window?.insetsController?.show(android.view.WindowInsets.Type.systemBars())
        }
    }
    override fun displayed(session: String, id: String, shown: Boolean, origin: String) {
        val s = players.values.firstOrNull { it.id == id && it.session == session } ?: return; s.shown = shown; s.player.playWhenReady = shown && !s.props.optBoolean("isPaused", false)
    }
    override fun foreground(shown: Boolean) { if (shown) players.values.forEach { it.player.playWhenReady = it.shown && !it.props.optBoolean("isPaused", false) } }
    override fun paused() { if (context.activity?.isInPictureInPictureMode != true && players.values.none { it.pipRequested }) players.values.forEach { it.player.pause() } }
    override fun destroy(done: () -> Unit) { players.keys.toList().forEach { destroyView(it) }; done() }
}
