package expo.modules.plexymedia

import android.content.ContentResolver
import android.net.Uri
import fi.iki.elonen.NanoHTTPD
import java.io.IOException
import java.io.InputStream
import java.util.UUID

internal class CastFileServer(
  private val host: String,
  private val resolver: ContentResolver,
  private val source: Uri
) : NanoHTTPD(host, 0) {
  private val path = "/${UUID.randomUUID()}/video.mp4"
  private val size = resolver.openAssetFileDescriptor(source, "r")?.use { it.length } ?: -1L
  val url: String get() = "http://$host:$listeningPort$path"

  init {
    require(size > 0) { "This video provider cannot stream a seekable file to the TV." }
  }

  override fun serve(session: IHTTPSession): Response {
    if (session.uri != path) return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "")
    if (session.method != Method.GET && session.method != Method.HEAD && session.method != Method.OPTIONS) {
      return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, MIME_PLAINTEXT, "")
    }
    if (session.method == Method.OPTIONS) return headers(newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, ""))
    val range = session.headers["range"]
    val bytes = if (range == null) 0L..(size - 1) else parseRange(range)
    if (bytes == null) {
      return headers(newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, MIME_PLAINTEXT, ""))
        .apply { addHeader("Content-Range", "bytes */$size") }
    }
    val length = bytes.last - bytes.first + 1
    val input = try {
      if (session.method == Method.HEAD) null else openAt(bytes.first)
    } catch (_: Exception) {
      return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "")
    }
    val status = if (range == null) Response.Status.OK else Response.Status.PARTIAL_CONTENT
    return headers(newFixedLengthResponse(status, "video/mp4", input, length)).apply {
      if (range != null) addHeader("Content-Range", "bytes ${bytes.first}-${bytes.last}/$size")
    }
  }

  private fun headers(response: Response): Response = response.apply {
    addHeader("Accept-Ranges", "bytes")
    addHeader("Cache-Control", "no-store")
    addHeader("Access-Control-Allow-Origin", "*")
    addHeader("Access-Control-Allow-Headers", "Range")
    addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
    addHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges")
  }

  private fun parseRange(value: String): LongRange? {
    val match = Regex("bytes=(\\d*)-(\\d*)").matchEntire(value) ?: return null
    val (start, end) = match.destructured
    if (start.isEmpty()) {
      val suffix = end.toLongOrNull()?.takeIf { it > 0 } ?: return null
      return (size - suffix.coerceAtMost(size))..(size - 1)
    }
    val first = start.toLongOrNull()?.takeIf { it < size } ?: return null
    val last = if (end.isEmpty()) size - 1 else end.toLongOrNull()?.coerceAtMost(size - 1) ?: return null
    return if (last >= first) first..last else null
  }

  private fun openAt(offset: Long): InputStream {
    val descriptor = resolver.openAssetFileDescriptor(source, "r") ?: throw IOException("Video is unavailable")
    val input = try {
      descriptor.createInputStream()
    } catch (error: Exception) {
      descriptor.close()
      throw error
    }
    try {
      var remaining = offset
      while (remaining > 0) {
        val skipped = input.skip(remaining)
        if (skipped <= 0) throw IOException("Could not seek video")
        remaining -= skipped
      }
      return input
    } catch (error: Exception) {
      input.close()
      throw error
    }
  }
}
