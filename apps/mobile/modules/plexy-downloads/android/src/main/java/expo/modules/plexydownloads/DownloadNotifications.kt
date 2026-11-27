package expo.modules.plexydownloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

object DownloadNotifications {
  const val CHANNEL_ID = "plexy-downloads"
  const val NOTIFICATION_ID = 4101

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "Plexy downloads",
          NotificationManager.IMPORTANCE_LOW,
        ).apply {
          description = "Movie and episode downloads"
          setShowBadge(false)
        },
      )
    }
  }

  fun progress(
    context: Context,
    id: String,
    title: String,
    display: String,
    bytes: Long,
    expected: Long?,
    percent: Int,
    paused: Boolean,
  ): Notification {
    val text = if (paused) {
      "Paused · $display"
    } else {
      val total = expected?.takeIf { it > 0 }?.let { " of ${formatBytes(it)}" } ?: ""
      "$percent% · $display · ${formatBytes(bytes)}$total"
    }
    val builder = base(context, id, title, text)
      .setProgress(100, percent.coerceIn(0, 100), expected == null)
      .setOngoing(!paused)
    if (paused) {
      builder.addAction(
        android.R.drawable.ic_media_play,
        "Resume",
        action(context, id, DownloadService.ACTION_RESUME, 1),
      )
    } else {
      builder.addAction(
        android.R.drawable.ic_media_pause,
        "Pause",
        action(context, id, DownloadService.ACTION_PAUSE, 1),
      )
    }
    builder.addAction(
      android.R.drawable.ic_menu_close_clear_cancel,
      "Cancel",
      action(context, id, DownloadService.ACTION_CANCEL, 2),
    )
    return builder.build()
  }

  fun completed(context: Context, title: String, display: String): Notification =
    base(context, null, title, "$display · Downloaded — adding to your library")
      .setAutoCancel(true)
      .build()

  fun failed(context: Context, title: String, display: String, error: String): Notification =
    base(context, null, title, "$display · $error")
      .setAutoCancel(true)
      .build()

  private fun base(
    context: Context,
    id: String?,
    title: String,
    text: String,
  ): NotificationCompat.Builder {
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(title)
      .setContentText(text)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
    launchIntent(context)?.let { builder.setContentIntent(it) }
    return builder
  }

  private fun launchIntent(context: Context): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return null
    return PendingIntent.getActivity(
      context,
      40,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun action(
    context: Context,
    id: String,
    action: String,
    offset: Int,
  ): PendingIntent {
    val intent = Intent(context, DownloadService::class.java)
      .setAction(action)
      .putExtra(DownloadService.EXTRA_ID, id)
    return PendingIntent.getService(
      context,
      id.hashCode() + offset,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  fun formatBytes(bytes: Long): String {
    if (bytes >= 1024L * 1024L * 1024L) {
      return String.format("%.2f GB", bytes / (1024.0 * 1024.0 * 1024.0))
    }
    if (bytes >= 1024L * 1024L) {
      return String.format("%.1f MB", bytes / (1024.0 * 1024.0))
    }
    return "${bytes / 1024L} KB"
  }
}
