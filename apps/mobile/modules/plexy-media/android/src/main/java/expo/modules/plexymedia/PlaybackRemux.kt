package expo.modules.plexymedia

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** An optimized copy belongs to one player session and lives in app cache. */
internal class PlaybackRemux {
  private class Job {
    var output: File? = null
  }

  private val jobs = ConcurrentHashMap<String, Job>()

  fun create(): String = UUID.randomUUID().toString().also { jobs[it] = Job() }

  fun release(id: String) {
    val job = jobs.remove(id) ?: return
    synchronized(job) { job.output?.delete() }
  }

  fun releaseAll() = jobs.keys.forEach(::release)

  fun run(context: Context, id: String, uri: Uri): String {
    val job = jobs[id] ?: error("Playback optimization was cancelled.")
    require(uri.scheme == "file" || uri.scheme == "content") { "Choose a local video." }
    val cache = File(context.cacheDir, "playback-optimization").apply { mkdirs() }
    val staleBefore = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
    cache.listFiles()?.forEach { file ->
      if (!jobs.containsKey(file.nameWithoutExtension) && file.lastModified() < staleBefore) file.delete()
    }
    val output = synchronized(job) {
      check(jobs[id] === job && job.output == null)
      File(cache, "$id.mp4").also { job.output = it }
    }
    try {
      val extractor = MediaExtractor()
      try {
        extractor.setDataSource(context, uri, null)
        remux(extractor, output) { jobs[id] === job }
      } finally {
        extractor.release()
      }
      check(jobs[id] === job)
      return Uri.fromFile(output).toString()
    } catch (error: Exception) {
      release(id)
      throw error
    } finally {
      if (jobs[id] !== job) output.delete()
    }
  }

  private fun remux(extractor: MediaExtractor, output: File, active: () -> Boolean) {
    val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var lastVideoKeyframe = 0L
    var videoTrack = -1
    try {
      val tracks = IntArray(extractor.trackCount) { -1 }
      for (index in tracks.indices) {
        val format = extractor.getTrackFormat(index)
        val mime = format.getString(MediaFormat.KEY_MIME).orEmpty()
        if (mime.startsWith("video/")) {
          require(videoTrack == -1) { "Multiple video tracks cannot be optimized." }
          videoTrack = index
          if (format.containsKey(MediaFormat.KEY_ROTATION)) {
            muxer.setOrientationHint(format.getInteger(MediaFormat.KEY_ROTATION))
          }
        } else if (!mime.startsWith("audio/")) {
          continue
        }
        tracks[index] = muxer.addTrack(format)
        extractor.selectTrack(index)
      }
      require(videoTrack != -1) { "No video track was found." }
      muxer.start()
      val info = MediaCodec.BufferInfo()
      val maxSampleSize = 32 * 1024 * 1024
      val canReadSampleSize = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
      var buffer = ByteBuffer.allocateDirect(if (canReadSampleSize) 1024 * 1024 else maxSampleSize)
      while (true) {
        check(active()) { "Playback optimization was cancelled." }
        val index = extractor.sampleTrackIndex
        if (index < 0) break
        val size = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) extractor.sampleSize else null
        require(size == null || size in 0L..maxSampleSize.toLong()) { "Unsupported video sample size." }
        val flags = extractor.sampleFlags
        require(flags and (MediaExtractor.SAMPLE_FLAG_ENCRYPTED or MediaExtractor.SAMPLE_FLAG_PARTIAL_FRAME) == 0) {
          "This video has unsupported samples."
        }
        if (size != null && buffer.capacity() < size) buffer = ByteBuffer.allocateDirect(size.toInt())
        buffer.clear()
        val count = extractor.readSampleData(buffer, 0)
        check(if (size == null) count in 0 until maxSampleSize else count.toLong() == size) {
          "Could not read the whole video sample."
        }
        val time = extractor.sampleTime
        val keyframe = flags and MediaExtractor.SAMPLE_FLAG_SYNC != 0
        if (index == videoTrack && keyframe) lastVideoKeyframe = maxOf(lastVideoKeyframe, time)
        info.set(0, count, time, if (keyframe) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        muxer.writeSampleData(tracks[index], buffer, info)
        extractor.advance()
      }
      muxer.stop()
    } finally {
      muxer.release()
    }

    require(lastVideoKeyframe > 0) { "No seekable video keyframes were found." }
    val result = MediaExtractor()
    try {
      result.setDataSource(output.absolutePath)
      val track = (0 until result.trackCount).first {
        result.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
      }
      result.selectTrack(track)
      result.seekTo(lastVideoKeyframe, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
      check(result.sampleTime > 0) { "The optimized copy could not seek." }
    } finally {
      result.release()
    }
  }
}
