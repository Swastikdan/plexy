package expo.modules.plexydownloads

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Native foreground downloader. The JS queue mints one signed URL at a time
 * and starts this service; the service owns the bytes, resume state, progress
 * notification, and the multi-stream range requests.
 */
class DownloadService : Service() {
  private data class Job(
    val id: String,
    val url: String,
    val destination: String,
    val expectedBytes: Long?,
    val etag: String?,
    val title: String,
    val display: String,
    val accountUsername: String,
    val multiStream: Boolean,
    val wifiOnly: Boolean,
  )

  private data class Chunk(
    val start: Long,
    val end: Long,
    @Volatile var done: Boolean,
  )

  private data class Probe(
    val expectedBytes: Long?,
    val ranges: Boolean,
    val etag: String?,
    val contentType: String?,
  )

  private val store by lazy { DownloadStore(this) }
  private val client by lazy {
    OkHttpClient.Builder()
      .connectTimeout(20, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .writeTimeout(30, TimeUnit.SECONDS)
      .build()
  }
  private val activeCalls = CopyOnWriteArrayList<Call>()
  private val activeFiles = ConcurrentHashMap<String, RandomAccessFile>()
  @Volatile private var paused = false
  @Volatile private var cancelled = false
  @Volatile private var worker: Thread? = null
  @Volatile private var pendingStart = false
  @Volatile private var pendingJobJson: String? = null
  @Volatile private var runId = 0L
  @Volatile private var currentJob: Job? = null
  @Volatile private var currentBytes = 0L
  @Volatile private var expectedBytes: Long? = null
  @Volatile private var currentChunks: List<Chunk>? = null
  @Volatile private var expectedIsExact = false
  @Volatile private var lastNotifyAt = 0L
  @Volatile private var lastStateAt = 0L
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onCreate() {
    super.onCreate()
    DownloadNotifications.ensureChannel(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val requestedId = intent?.getStringExtra(EXTRA_ID)
    when (intent?.action) {
      ACTION_PAUSE -> {
        if (requestedId == null || requestedId == activeJobId()) {
          pauseWork()
        } else if (activeJobId() == null) {
          stopSelf()
        }
      }
      ACTION_CANCEL -> {
        if (requestedId == null || requestedId == activeJobId()) {
          cancelWork()
        } else if (activeJobId() == null) {
          store.clearActive()
          stopSelf()
        }
      }
      ACTION_RESUME -> {
        if (requestedId == null || requestedId == activeJobId()) {
          startWork()
        } else if (activeJobId() == null) {
          stopSelf()
        }
      }
      ACTION_START -> {
        val jobJson = intent.getStringExtra(EXTRA_JOB) ?: return START_NOT_STICKY
        if (worker?.isAlive == true) {
          if (parseJob(jobJson)?.id == activeJobId()) {
            // A duplicate start for the job already running.
            return START_NOT_STICKY
          }
          // Keep the next job separate until the active worker has finished;
          // otherwise its completion would clear the newly saved job.
          pendingJobJson = jobJson
          pendingStart = true
          paused = false
          cancelled = false
          currentJob?.let {
            startForegroundCompat(it, currentBytes, expectedBytes, false)
          }
        } else {
          store.saveJob(jobJson)
          startWork()
        }
      }
    }
    return START_NOT_STICKY
  }

  private fun activeJobId(): String? =
    currentJob?.id ?: store.job()?.let { parseJob(it)?.id }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping the app away must not stop an active foreground download.
  }

  override fun onDestroy() {
    releaseLocks()
    super.onDestroy()
  }

  private fun startWork() {
    val job = parseJob(store.job() ?: return stopSelf()) ?: return stopSelf()
    if (worker?.isAlive == true) {
      // The JS queue can hand over the next job before the previous service
      // thread has returned. Start it from the current worker's finally block.
      pendingStart = true
      return
    }
    currentJob = job
    paused = false
    cancelled = false
    expectedIsExact = false
    if (job.wifiOnly && !onWifi()) {
      paused = true
      startForegroundCompat(job, currentBytes, expectedBytes, true)
      saveState("paused", currentBytes, expectedBytes, "Waiting for Wi-Fi.", null, null)
      DownloadEvents.failed(job.id, "Waiting for Wi-Fi. Connect and retry the download.")
      stopForegroundCompat(remove = true)
      stopSelf()
      return
    }
    val snapshot = readState()?.takeIf { it.id == job.id }
    val existing = if (snapshot != null && fileFor(job).exists()) snapshot else null
    currentChunks = existing?.chunks
    currentBytes = existing?.bytes ?: fileFor(job).let { if (it.exists()) it.length() else 0L }
    expectedBytes = job.expectedBytes ?: existing?.expectedBytes
    startForegroundCompat(job, currentBytes, expectedBytes, false)
    acquireLocks(job)
    val id = ++runId
    worker = Thread({ runDownload(job, existing, id) }, "plexy-download-${job.id}").apply {
      start()
    }
  }

  private fun runDownload(job: Job, existing: StateSnapshot?, id: Long) {
    try {
      if (paused || cancelled || id != runId) return
      val probe = probe(job.url)
      if (paused || cancelled || id != runId) return
      expectedIsExact = probe.expectedBytes != null
      val total = probe.expectedBytes ?: job.expectedBytes ?: existing?.expectedBytes
      expectedBytes = total
      if (probe.contentType?.contains("mpegurl", ignoreCase = true) == true ||
        job.url.substringBefore('?').endsWith(".m3u8", ignoreCase = true)
      ) {
        throw IOException("This source is a stream playlist, not a single video file.")
      }

      val usedMulti = job.multiStream && probe.ranges &&
        probe.expectedBytes != null && probe.expectedBytes > 32L * 1024 * 1024
      if (usedMulti) {
        saveState("downloading", currentBytes, total, null, "multi", existing?.chunks)
        val complete = downloadMulti(job, total!!, existing?.chunks, id)
        if (cancelled || paused) return
        if (!complete) {
          // A chunk failed repeatedly. Restart cleanly with one stream.
          fileFor(job).delete()
          currentBytes = 0
          saveState("downloading", 0, total, null, "resume", null)
          downloadSingle(job, probe, id)
        }
      } else {
        saveState("downloading", currentBytes, total, null, "resume", null)
        downloadSingle(job, probe, id)
      }
      if (cancelled || paused || id != runId) return

      val file = fileFor(job)
      val validation = validate(file, expectedBytes, expectedIsExact)
      val result = JSONObject()
        .put("id", job.id)
        .put("fileUri", Uri.fromFile(file).toString())
        .put("bytes", file.length())
        .put("container", validation.first)
        .put("extension", validation.second)
      store.addCompleted(result.toString())
      store.clearActive()
      notifyCompleted(job)
      DownloadEvents.completed(
        job.id,
        Uri.fromFile(file).toString(),
        file.length(),
        validation.first,
        validation.second,
      )
    } catch (error: Exception) {
      if (cancelled || paused || id != runId) return
      val message = when (error) {
        is IOException -> error.message ?: "The download failed."
        else -> error.message ?: "The download failed."
      }
      saveState("failed", currentBytes, expectedBytes, message, null, null)
      notifyFailed(job, message)
      DownloadEvents.failed(job.id, message)
    } finally {
      if (id == runId) {
        worker = null
        releaseLocks()
        if (paused || cancelled) {
          // Pause/cancel handled the foreground notification and service stop.
        } else if (pendingStart) {
          pendingStart = false
          val next = pendingJobJson
          pendingJobJson = null
          if (next != null) {
            // The old job's state must not leak into the next title.
            store.clearActive()
            store.saveJob(next)
            startWork()
          } else {
            stopForegroundCompat(remove = false)
            stopSelf()
          }
        } else {
          stopForegroundCompat(remove = false)
          stopSelf()
        }
      }
    }
  }

  private fun downloadSingle(job: Job, probe: Probe, id: Long) {
    currentChunks = null
    val file = fileFor(job)
    file.parentFile?.mkdirs()
    var existing = if (file.exists()) file.length() else 0L
    if (expectedIsExact && expectedBytes != null && existing >= expectedBytes!!) {
      currentBytes = existing
      return
    }
    var attempts = 0
    while (attempts < 3) {
      attempts += 1
      try {
        val builder = Request.Builder().url(job.url)
        if (existing > 0) {
          builder.header("Range", "bytes=$existing-")
          job.etag?.takeIf { it.isNotBlank() }?.let { builder.header("If-Range", it) }
        }
        val call = client.newCall(builder.build())
        activeCalls.add(call)
        try {
          call.execute().use { response ->
            if (existing > 0 && response.code != 206) {
              // The host ignored the range; restart from zero.
              file.delete()
              existing = 0L
              currentBytes = 0L
              throw IOException("The source restarted the download.")
            }
            val rangeStart = response.header("Content-Range")
              ?.removePrefix("bytes ")
              ?.substringBefore('-')
              ?.toLongOrNull()
            if (existing > 0 && rangeStart != null && rangeStart != existing) {
              file.delete()
              existing = 0L
              currentBytes = 0L
              throw IOException("The source returned a different range.")
            }
            if (!response.isSuccessful) {
              throw IOException("The source returned ${response.code}.")
            }
            val body = response.body ?: throw IOException("The source returned an empty response.")
            val bodyLength = body.contentLength()
            if (!expectedIsExact && bodyLength > 0) {
              expectedIsExact = true
              expectedBytes = existing + bodyLength
            }
            val total = probe.expectedBytes ?: expectedBytes ?: bodyLength.takeIf { it > 0 }?.plus(existing)
            expectedBytes = total
            RandomAccessFile(file, "rw").use { output ->
              output.seek(existing)
              body.byteStream().use { input ->
                val buffer = ByteArray(256 * 1024)
                while (true) {
                  if (paused || cancelled || id != runId) return
                  if (job.wifiOnly && !onWifi()) {
                    throw IOException("Wi-Fi disconnected. Connect and retry the download.")
                  }
                  val read = input.read(buffer)
                  if (read < 0) break
                  output.write(buffer, 0, read)
                  existing += read
                  currentBytes = existing
                  if (paused || cancelled || id != runId) return
                  publish(job, total)
                }
              }
            }
            if (expectedIsExact && expectedBytes != null && file.length() < expectedBytes!!) {
              throw IOException("The download ended before the file was complete.")
            }
            return
          }
        } catch (error: IOException) {
          if (paused || cancelled || id != runId) return
          if (attempts >= 3) throw error
          Thread.sleep(1_200L * attempts)
        } finally {
          activeCalls.remove(call)
        }
      } catch (error: Exception) {
        if (paused || cancelled || id != runId) return
        if (attempts >= 3) throw error
        Thread.sleep(1_200L * attempts)
      }
    }
  }

  private fun downloadMulti(job: Job, total: Long, saved: List<Chunk>?, id: Long): Boolean {
    val file = fileFor(job)
    file.parentFile?.mkdirs()
    if (!file.exists() || file.length() != total) {
      RandomAccessFile(file, "rw").use { it.setLength(total) }
    }
    val chunks = if (saved != null && saved.isNotEmpty()) {
      saved.map { Chunk(it.start, it.end, it.done) }
    } else {
      buildChunks(total)
    }
    currentChunks = chunks
    val pending = chunks.filter { !it.done }
    if (pending.isEmpty()) return true
    val done = AtomicLong(chunks.filter { it.done }.sumOf { it.end - it.start + 1 })
    currentBytes = done.get()
    val fallback = AtomicBoolean(false)
    val latch = CountDownLatch(pending.size)
    val executor = Executors.newFixedThreadPool(minOf(3, pending.size))
    for (chunk in pending) {
      executor.execute {
        try {
          var attempts = 0
          while (attempts < 3 && !paused && !cancelled && !fallback.get() && id == runId) {
            attempts += 1
            try {
              val call = client.newCall(
                Request.Builder()
                  .url(job.url)
                  .header("Range", "bytes=${chunk.start}-${chunk.end}")
                  .build(),
              )
              activeCalls.add(call)
              try {
                call.execute().use { response ->
                  if (response.code != 206) {
                    throw IOException("The source does not support range downloads.")
                  }
                  val rangeStart = response.header("Content-Range")
                    ?.removePrefix("bytes ")
                    ?.substringBefore('-')
                    ?.toLongOrNull()
                  if (rangeStart != null && rangeStart != chunk.start) {
                    throw IOException("The source returned a different range.")
                  }
                  val body = response.body ?: throw IOException("The source returned an empty range.")
                  var chunkBytes = 0L
                  RandomAccessFile(file, "rw").use { output ->
                    output.seek(chunk.start)
                    body.byteStream().use { input ->
                      val buffer = ByteArray(256 * 1024)
                      while (true) {
                        if (paused || cancelled || fallback.get() || id != runId) return@execute
                        if (job.wifiOnly && !onWifi()) {
                          throw IOException("Wi-Fi disconnected. Connect and retry the download.")
                        }
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        chunkBytes += read
                        currentBytes = done.addAndGet(read.toLong())
                        if (paused || cancelled || id != runId) return@execute
                        publish(job, total)
                      }
                    }
                  }
                  if (chunkBytes != chunk.end - chunk.start + 1) {
                    throw IOException("A range ended before the chunk was complete.")
                  }
                  chunk.done = true
                  saveState("downloading", currentBytes, total, null, "multi", chunks)
                }
              } finally {
                activeCalls.remove(call)
              }
              break
            } catch (error: Exception) {
              if (paused || cancelled || id != runId) return@execute
              if (attempts >= 3) {
                fallback.set(true)
                activeCalls.forEach { it.cancel() }
                return@execute
              }
              Thread.sleep(900L * attempts)
            }
          }
        } finally {
          latch.countDown()
        }
      }
    }
    executor.shutdown()
    latch.await()
    if (paused || cancelled || id != runId) {
      if (id == runId) {
        saveState("paused", currentBytes, total, null, "multi", chunks)
      }
      return false
    }
    if (fallback.get() || chunks.any { !it.done }) return false
    return file.length() == total
  }

  private fun buildChunks(total: Long): List<Chunk> {
    val size = if (total > 2L * 1024 * 1024 * 1024) 16L * 1024 * 1024 else 8L * 1024 * 1024
    val chunks = ArrayList<Chunk>()
    var start = 0L
    while (start < total) {
      val end = minOf(total - 1, start + size - 1)
      chunks.add(Chunk(start, end, false))
      start = end + 1
    }
    return chunks
  }

  private fun probe(url: String): Probe {
    var expected: Long? = null
    var ranges = false
    var etag: String? = null
    var contentType: String? = null
    try {
      val head = client.newCall(Request.Builder().url(url).head().build()).execute()
      head.use { response ->
        if (response.isSuccessful) {
          expected = response.header("Content-Length")?.toLongOrNull()?.takeIf { it > 0 }
          ranges = response.header("Accept-Ranges")?.contains("bytes", ignoreCase = true) == true
          etag = response.header("ETag")
          contentType = response.header("Content-Type")
        }
      }
    } catch (_: Exception) {
      // Some signed URLs reject HEAD; try a one-byte GET below.
    }
    if (expected == null || !ranges) {
      try {
        val range = client.newCall(
          Request.Builder().url(url).header("Range", "bytes=0-0").build(),
        ).execute()
        range.use { response ->
          if (response.code == 206) {
            ranges = true
            response.header("Content-Range")
              ?.substringAfter('/', "")
              ?.toLongOrNull()
              ?.takeIf { it > 0 }
              ?.let { expected = it }
          }
          if (contentType == null) contentType = response.header("Content-Type")
          if (etag == null) etag = response.header("ETag")
        }
      } catch (_: Exception) {
        // A plain download will still work.
      }
    }
    return Probe(expected, ranges, etag, contentType)
  }

  private fun validate(file: File, expected: Long?, exact: Boolean): Pair<String, String> {
    if (!file.exists() || file.length() <= 0L) {
      throw IOException("The downloaded file is empty.")
    }
    if (exact && expected != null && file.length() != expected) {
      throw IOException("The download is incomplete (${file.length()} of $expected bytes).")
    }
    val head = ByteArray(64)
    RandomAccessFile(file, "r").use { input ->
      val read = input.read(head)
      if (read <= 0) throw IOException("The downloaded file is empty.")
    }
    val ascii = String(head, Charsets.ISO_8859_1).lowercase()
    if (ascii.contains("<html") || ascii.contains("<!doctype")) {
      throw IOException("The source returned an error page instead of a video.")
    }
    val container = when {
      head[0].toInt() == 0x1a && head[1].toInt() == 0x45 &&
        head[2].toInt() == 0xdf && head[3].toInt() == 0xa3 -> "mkv"
      head[0].toInt() == 0x52 && head[1].toInt() == 0x49 &&
        head[2].toInt() == 0x46 && head[3].toInt() == 0x46 -> "avi"
      head[4].toInt() == 0x66 && head[5].toInt() == 0x74 &&
        head[6].toInt() == 0x79 && head[7].toInt() == 0x70 -> "mp4"
      head[0].toInt() == 0x47 -> "ts"
      else -> throw IOException("The downloaded file is not a supported video container.")
    }
    val extension = if (container == "mkv" && file.name.endsWith(".webm", ignoreCase = true)) {
      "webm"
    } else {
      container
    }
    return container to extension
  }

  private fun publish(job: Job, total: Long?) {
    expectedBytes = total
    val now = System.currentTimeMillis()
    if (now - lastNotifyAt < 500L) return
    lastNotifyAt = now
    val progress = if (total != null && total > 0) {
      ((currentBytes * 100) / total).toInt().coerceIn(0, 99)
    } else {
      0
    }
    DownloadEvents.progress(
      job.id,
      currentBytes,
      total,
      if (total != null && total > 0) currentBytes.toDouble() / total else 0.0,
    )
    val notification = DownloadNotifications.progress(
      this,
      job.id,
      job.title,
      job.display,
      currentBytes,
      total,
      progress,
      false,
    )
    try {
      NotificationManagerCompat.from(this).notify(DownloadNotifications.NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // Notification permission was denied; the service still downloads.
    }
    if (now - lastStateAt > 1_000L) {
      lastStateAt = now
      saveState("downloading", currentBytes, total, null, null, currentChunks)
    }
  }

  private fun saveState(
    status: String,
    bytes: Long,
    expected: Long?,
    error: String?,
    strategy: String?,
    chunks: List<Chunk>?,
  ) {
    val json = JSONObject()
      .put("id", currentJob?.id ?: "")
      .put("status", status)
      .put("bytes", bytes)
      .put("expectedBytes", expected ?: JSONObject.NULL)
      .put("progress", if (expected != null && expected > 0) bytes.toDouble() / expected else 0.0)
      .put("error", error ?: JSONObject.NULL)
      .put("strategy", strategy ?: JSONObject.NULL)
      .put("updatedAt", System.currentTimeMillis())
    if (chunks != null) {
      json.put(
        "chunks",
        JSONArray().apply {
          chunks.forEach { chunk ->
            put(
              JSONObject()
                .put("start", chunk.start)
                .put("end", chunk.end)
                .put("done", chunk.done),
            )
          }
        },
      )
    }
    store.saveState(json.toString())
  }

  private fun readState(): StateSnapshot? {
    val raw = store.state() ?: return null
    val chunks = (raw["chunks"] as? List<*>)?.mapNotNull { entry ->
      val map = entry as? Map<*, *> ?: return@mapNotNull null
      val start = (map["start"] as? Number)?.toLong() ?: return@mapNotNull null
      val end = (map["end"] as? Number)?.toLong() ?: return@mapNotNull null
      Chunk(start, end, map["done"] == true)
    }
    return StateSnapshot(
      id = raw["id"] as? String,
      status = raw["status"] as? String ?: "paused",
      bytes = (raw["bytes"] as? Number)?.toLong() ?: 0L,
      expectedBytes = (raw["expectedBytes"] as? Number)?.toLong(),
      chunks = chunks,
    )
  }

  private fun parseJob(raw: String): Job? {
    return try {
      val json = JSONObject(raw)
      val id = json.optString("id")
      val url = json.optString("url")
      val destination = json.optString("destination")
      if (id.isBlank() || url.isBlank() || destination.isBlank()) return null
      Job(
        id = id,
        url = url,
        destination = destination,
        expectedBytes = if (json.has("expectedBytes") && !json.isNull("expectedBytes")) json.optLong("expectedBytes") else null,
        etag = if (json.has("etag") && !json.isNull("etag")) json.optString("etag") else null,
        title = json.optString("title", "Plexy download"),
        display = json.optString("display", ""),
        accountUsername = json.optString("accountUsername", ""),
        multiStream = json.optBoolean("multiStream", true),
        wifiOnly = json.optBoolean("wifiOnly", true),
      )
    } catch (_: Exception) {
      null
    }
  }

  private fun fileFor(job: Job): File {
    val path = Uri.parse(job.destination).path ?: job.destination
    return File(path)
  }

  private fun onWifi(): Boolean {
    val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = manager.activeNetwork ?: return false
    val capabilities = manager.getNetworkCapabilities(network) ?: return false
    return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
  }

  private fun acquireLocks(job: Job) {
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Plexy:download").apply {
      setReferenceCounted(false)
      acquire(10L * 60L * 60L * 1000L)
    }
    if (job.wifiOnly) {
      val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Plexy:download").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  private fun releaseLocks() {
    try {
      wakeLock?.takeIf { it.isHeld }?.release()
    } catch (_: Exception) {
    }
    wakeLock = null
    try {
      wifiLock?.takeIf { it.isHeld }?.release()
    } catch (_: Exception) {
    }
    wifiLock = null
  }

  private fun pauseWork() {
    paused = true
    pendingStart = false
    pendingJobJson = null
    runId++
    worker = null
    activeCalls.forEach { it.cancel() }
    currentJob?.let { job ->
      saveState("paused", currentBytes, expectedBytes, null, null, currentChunks)
      val notification = DownloadNotifications.progress(
        this,
        job.id,
        job.title,
        job.display,
        currentBytes,
        expectedBytes,
        0,
        true,
      )
      try {
        NotificationManagerCompat.from(this).notify(DownloadNotifications.NOTIFICATION_ID, notification)
      } catch (_: SecurityException) {
      }
    }
    releaseLocks()
    stopForegroundCompat(remove = false)
    stopSelf()
  }

  private fun cancelWork() {
    cancelled = true
    pendingStart = false
    pendingJobJson = null
    runId++
    worker = null
    activeCalls.forEach { it.cancel() }
    (currentJob ?: store.job()?.let(::parseJob))?.let { fileFor(it).delete() }
    store.clearActive()
    releaseLocks()
    stopForegroundCompat(remove = true)
    stopSelf()
  }

  private fun startForegroundCompat(
    job: Job,
    bytes: Long,
    expected: Long?,
    paused: Boolean,
  ) {
    val notification = DownloadNotifications.progress(
      this,
      job.id,
      job.title,
      job.display,
      bytes,
      expected,
      0,
      paused,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        DownloadNotifications.NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(DownloadNotifications.NOTIFICATION_ID, notification)
    }
  }

  private fun notifyCompleted(job: Job) {
    val manager = NotificationManagerCompat.from(this)
    manager.cancel(DownloadNotifications.NOTIFICATION_ID)
    val notification = DownloadNotifications.completed(this, job.title, job.display)
    try {
      manager.notify(DownloadNotifications.NOTIFICATION_ID + 1, notification)
    } catch (_: SecurityException) {
    }
  }

  private fun notifyFailed(job: Job, error: String) {
    val manager = NotificationManagerCompat.from(this)
    manager.cancel(DownloadNotifications.NOTIFICATION_ID)
    val notification = DownloadNotifications.failed(this, job.title, job.display, error)
    try {
      manager.notify(DownloadNotifications.NOTIFICATION_ID + 1, notification)
    } catch (_: SecurityException) {
    }
  }

  private fun stopForegroundCompat(remove: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(
        if (remove) Service.STOP_FOREGROUND_REMOVE else Service.STOP_FOREGROUND_DETACH,
      )
    } else {
      @Suppress("DEPRECATION")
      stopForeground(remove)
    }
  }

  private data class StateSnapshot(
    val id: String?,
    val status: String,
    val bytes: Long,
    val expectedBytes: Long?,
    val chunks: List<Chunk>?,
  )

  companion object {
    const val ACTION_START = "expo.modules.plexydownloads.START"
    const val ACTION_PAUSE = "expo.modules.plexydownloads.PAUSE"
    const val ACTION_RESUME = "expo.modules.plexydownloads.RESUME"
    const val ACTION_CANCEL = "expo.modules.plexydownloads.CANCEL"
    const val EXTRA_JOB = "job"
    const val EXTRA_ID = "id"
  }
}

/** Event bridge from the service back to the Expo module, if the app is alive. */
object DownloadEvents {
  @Volatile var module: PlexyDownloadsModule? = null

  fun progress(id: String, bytes: Long, expected: Long?, progress: Double) {
    module?.emitProgress(id, bytes, expected, progress)
  }

  fun completed(id: String, fileUri: String, bytes: Long, container: String, extension: String) {
    module?.emitCompleted(id, fileUri, bytes, container, extension)
  }

  fun failed(id: String, error: String) {
    module?.emitFailed(id, error)
  }
}
