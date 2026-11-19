package expo.modules.plexymedia

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import java.util.UUID

/** Keep the document grant while handing Expo Router an ordinary app link. */
class VideoIntentActivity : Activity() {
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    try {
      val source = intent.data
      if (intent.action != Intent.ACTION_VIEW || source?.scheme != "content" ||
        intent.type?.startsWith("video/") != true) return
      val link = Uri.Builder().scheme("plexy-mobile").authority("external-player")
        .appendQueryParameter("id", UUID.randomUUID().toString()).build()
      val playback = Intent(Intent.ACTION_VIEW, link)
        .setClassName(packageName, "$packageName.MainActivity")
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      playback.clipData = ClipData.newRawUri("Video", source)
      startActivity(playback)
    } finally {
      finish()
    }
  }
}
