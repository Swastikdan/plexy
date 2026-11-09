package com.plexy.local

import android.app.Service
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import dev.exact.canvas.ExtensionContext
import org.json.JSONObject
import org.json.JSONArray

class PlexyConvert(private val context: ExtensionContext) {
    private val main = Handler(Looper.getMainLooper())
    fun probe(path: String, reply: (JSONObject) -> Unit) {
        val file = context.file(path) ?: return reply(JSONObject().put("error", "NotAllowedError"))
        FFprobeKit.executeWithArgumentsAsync(arrayOf("-v", "error", "-show_format", "-show_streams", "-of", "json", file.path)) { session ->
            main.post {
                if (ReturnCode.isSuccess(session.returnCode)) reply(JSONObject().put("json", session.output))
                else reply(JSONObject().put("error", "OperationError").put("message", session.output))
            }
        }
    }
    fun execute(arguments: String, reply: (JSONObject) -> Unit) {
        if (PlexyConvertService.completion != null) return reply(JSONObject().put("ok", false).put("message", "Another conversion is running"))
        val power = context.application.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= 29 && power.currentThermalStatus >= PowerManager.THERMAL_STATUS_MODERATE)
            return reply(JSONObject().put("ok", false).put("message", "Device is too hot. Try again after it cools."))
        if (power.isPowerSaveMode) return reply(JSONObject().put("ok", false).put("message", "Turn off battery saver before converting"))
        val battery = context.application.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, 100) ?: 100
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        if (plugged == 0 && level * 100 / scale.coerceAtLeast(1) < 15)
            return reply(JSONObject().put("ok", false).put("message", "Charge the device before converting"))
        try {
            val input = JSONArray(arguments)
            val args = (0 until input.length()).map { index ->
                val value = input.getString(index)
                if (value.startsWith("app:/")) (context.file(value) ?: error("Invalid media path")).path else value
            }.toTypedArray()
            PlexyConvertService.arguments = args
            PlexyConvertService.completion = { result -> main.post { reply(result) } }
            val start = {
                try { context.application.startForegroundService(Intent(context.application, PlexyConvertService::class.java)) }
                catch (e: Exception) { PlexyConvertService.completion = null; reply(JSONObject().put("ok", false).put("message", e.message)) }
            }
            if (Build.VERSION.SDK_INT >= 33) context.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS)) { start() } else start()
        } catch (e: Exception) { reply(JSONObject().put("ok", false).put("message", e.message)) }
    }
    fun verifyPlayback(path: String, reply: (JSONObject) -> Unit) {
        val file = context.file(path) ?: return reply(JSONObject().put("ok", false).put("message", "Invalid output"))
        val player = androidx.media3.exoplayer.ExoPlayer.Builder(context.application).build()
        val texture = android.graphics.SurfaceTexture(false).apply { setDefaultBufferSize(16, 16) }
        val surface = android.view.Surface(texture)
        player.setVideoSurface(surface); player.volume = 0f
        var answered = false
        var sought = false
        fun finish(ok: Boolean, message: String) {
            if (answered) return
            answered = true; player.release(); surface.release(); texture.release()
            reply(JSONObject().put("ok", ok).put("message", message))
        }
        main.postDelayed({ finish(false, "Media3 output verification timed out") }, 20000)
        player.addListener(object : androidx.media3.common.Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) { finish(false, error.message ?: "Media3 cannot play output") }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == androidx.media3.common.Player.STATE_READY) {
                    if (sought) finish(true, "Media3 seek verified")
                    else { sought = true; player.seekTo((player.duration / 2).coerceAtLeast(0)); player.play() }
                }
            }
        })
        player.setMediaItem(androidx.media3.common.MediaItem.fromUri(android.net.Uri.fromFile(file))); player.prepare()
    }
    fun cancel() { PlexyConvertService.sessionId?.let { FFmpegKit.cancel(it) } }
}

class PlexyConvertService : Service() {
    companion object {
        var arguments: Array<String> = emptyArray()
        var completion: ((JSONObject) -> Unit)? = null
        var sessionId: Long? = null
    }
    private var wake: PowerManager.WakeLock? = null
    private val main = Handler(Looper.getMainLooper())
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notifications = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notifications.createNotificationChannel(NotificationChannel("conversion", "Media conversion", NotificationManager.IMPORTANCE_LOW))
        fun notification(text: String) = Notification.Builder(this, "conversion").setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Plexy conversion").setContentText(text).setOngoing(true).build()
        startForeground(701, notification("Preparing video…"), if (Build.VERSION.SDK_INT >= 35) android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING else android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        wake = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Plexy:conversion").apply { acquire(6 * 60 * 60 * 1000L) }
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        val session = FFmpegKit.executeWithArgumentsAsync(arguments, { completed ->
            main.post {
                val result = JSONObject().put("ok", ReturnCode.isSuccess(completed.returnCode))
                    .put("message", if (ReturnCode.isSuccess(completed.returnCode)) "Converted" else if (ReturnCode.isCancel(completed.returnCode)) "Canceled" else completed.failStackTrace ?: (completed.output ?: "").takeLast(2000))
                val completedReply = completion; completion = null; sessionId = null
                if (wake?.isHeld == true) wake?.release(); wake = null
                stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
                main.post { completedReply?.invoke(result) }
            }
        }, { _ -> }, { statistics ->
            if (Build.VERSION.SDK_INT >= 29 && power.currentThermalStatus >= PowerManager.THERMAL_STATUS_MODERATE) sessionId?.let { FFmpegKit.cancel(it) }
            notifications.notify(701, notification("Converted ${statistics.time / 1000} seconds"))
        })
        sessionId = session.sessionId
        return START_NOT_STICKY
    }
    override fun onTimeout(startId: Int, fgsType: Int) {
        sessionId?.let { FFmpegKit.cancel(it) }
    }
    override fun onDestroy() {
        sessionId?.let { FFmpegKit.cancel(it) }
        if (wake?.isHeld == true) wake?.release(); wake = null
        super.onDestroy()
    }
}
