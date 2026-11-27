package expo.modules.plexydownloads

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PlexyDownloadsModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("PlexyDownloads")
    Events("onProgress", "onCompleted", "onFailed")

    OnCreate {
      DownloadEvents.module = this@PlexyDownloadsModule
    }

    OnDestroy {
      if (DownloadEvents.module === this@PlexyDownloadsModule) {
        DownloadEvents.module = null
      }
    }

    AsyncFunction("start") { jobJson: String ->
      val context = context() ?: return@AsyncFunction
      val intent = Intent(context, DownloadService::class.java)
        .setAction(DownloadService.ACTION_START)
        .putExtra(DownloadService.EXTRA_JOB, jobJson)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    AsyncFunction("pause") { id: String ->
      sendAction(id, DownloadService.ACTION_PAUSE)
    }

    AsyncFunction("resume") { id: String ->
      sendAction(id, DownloadService.ACTION_RESUME)
    }

    AsyncFunction("cancel") { id: String ->
      sendAction(id, DownloadService.ACTION_CANCEL)
    }

    AsyncFunction("state") {
      val context = context() ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      val state = DownloadStore(context).state()
      if (state != null) listOf(state) else emptyList<Map<String, Any?>>()
    }

    AsyncFunction("completed") {
      val context = context() ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      DownloadStore(context).completed()
    }

    AsyncFunction("clearCompleted") { id: String ->
      val context = context() ?: return@AsyncFunction
      DownloadStore(context).clearCompleted(id)
    }
  }

  private fun context(): Context? =
    appContext.reactContext ?: appContext.currentActivity?.applicationContext

  private fun sendAction(id: String, action: String) {
    val context = context() ?: return
    val intent = Intent(context, DownloadService::class.java)
      .setAction(action)
      .putExtra(DownloadService.EXTRA_ID, id)
    try {
      context.startService(intent)
    } catch (_: Exception) {
      // The service is already stopped; the JS record remains for retry.
    }
  }

  fun emitProgress(id: String, bytes: Long, expected: Long?, progress: Double) {
    main.post {
      if (DownloadEvents.module !== this) return@post
      sendEvent(
        "onProgress",
        mapOf(
          "id" to id,
          "bytes" to bytes,
          "expectedBytes" to expected,
          "progress" to progress,
        ),
      )
    }
  }

  fun emitCompleted(
    id: String,
    fileUri: String,
    bytes: Long,
    container: String,
    extension: String,
  ) {
    main.post {
      if (DownloadEvents.module !== this) return@post
      sendEvent(
        "onCompleted",
        mapOf(
          "id" to id,
          "fileUri" to fileUri,
          "bytes" to bytes,
          "container" to container,
          "extension" to extension,
        ),
      )
    }
  }

  fun emitFailed(id: String, error: String) {
    main.post {
      if (DownloadEvents.module !== this) return@post
      sendEvent("onFailed", mapOf("id" to id, "error" to error))
    }
  }
}
