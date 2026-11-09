package com.plexy.local

import android.Manifest
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.provider.MediaStore
import android.content.ContentUris
import dev.exact.canvas.ExtensionContext
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

class PlexyMediaStore(private val context: ExtensionContext) {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    // Only IDs returned by the current permission-granted query may be imported.
    private data class Video(val uri: android.net.Uri, val name: String, val size: Long)
    private val known = mutableMapOf<String, Video>()
    fun list(reply: (JSONObject) -> Unit) {
        val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_VIDEO else Manifest.permission.READ_EXTERNAL_STORAGE
        context.requestPermissions(arrayOf(permission)) {
            if (context.permission(permission).state != "granted") { reply(JSONObject().put("error", "NotAllowedError")); return@requestPermissions }
            worker.execute {
                try {
                    val found = mutableMapOf<String, Video>()
                    val result = JSONArray()
                    for (volume in MediaStore.getExternalVolumeNames(context.application)) {
                        val collection = MediaStore.Video.Media.getContentUri(volume)
                        context.application.contentResolver.query(collection, arrayOf(MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.SIZE), null, null, null)?.use { cursor ->
                            while (cursor.moveToNext()) {
                                val id = "$volume:${cursor.getLong(0)}"
                                val video = Video(ContentUris.withAppendedId(collection, cursor.getLong(0)), cursor.getString(1), cursor.getLong(2))
                                found[id] = video
                                result.put(JSONObject().put("id", id).put("name", video.name).put("size", video.size))
                            }
                        }
                    }
                    main.post { known.clear(); known.putAll(found); reply(JSONObject().put("exact:answer", result)) }
                } catch (e: Exception) { main.post { reply(JSONObject().put("error", "OperationError").put("message", e.message)) } }
            }
        }
    }
    fun import(id: String, reply: (JSONObject) -> Unit) {
        val video = known[id] ?: return reply(JSONObject().put("ok", false).put("message", "Refresh device videos before importing"))
        worker.execute {
            var partial: File? = null
            try {
                val root = context.file("app:/data/media/Unsorted") ?: error("Private media directory is unavailable")
                root.mkdirs()
                require(video.size > 0 && StatFs(root.path).availableBytes >= video.size * 1.1) { "Not enough free space" }
                val safeName = video.name.replace(Regex("[^\\p{L}\\p{N} ._()-]"), "_").take(180)
                val target = File(root, safeName)
                require(!target.exists()) { "Already imported or filename in use" }
                val temporary = File(root, ".${UUID.randomUUID()}.partial")
                partial = temporary
                context.application.contentResolver.openInputStream(video.uri)?.use { input -> temporary.outputStream().use { output -> input.copyTo(output, 1024 * 1024) } } ?: error("Source is unavailable")
                require(temporary.length() == video.size) { "Import was incomplete; original was kept" }
                val digest = MessageDigest.getInstance("SHA-256")
                digest.update(video.size.toString().toByteArray())
                RandomAccessFile(temporary, "r").use { source ->
                    val buffer = ByteArray(minOf(1024L * 1024, video.size).toInt())
                    source.readFully(buffer); digest.update(buffer)
                    source.seek((video.size - buffer.size).coerceAtLeast(0)); source.readFully(buffer); digest.update(buffer)
                }
                val fingerprint = digest.digest().joinToString("") { "%02x".format(it) }
                val indexFile = context.file("app:/data/import-index.json") ?: error("Import index unavailable")
                val index = if (indexFile.exists()) JSONObject(indexFile.readText()) else JSONObject()
                val priorPath = index.optString(fingerprint)
                if (priorPath.isNotEmpty()) {
                    val prior = context.file(priorPath)
                    val converted = context.file(priorPath.replace(Regex("\\.[^./]+$"), ".mp4"))
                    if (prior?.exists() == true || converted?.exists() == true) {
                        temporary.delete(); main.post { reply(JSONObject().put("ok", true).put("message", "Already in library")) }; return@execute
                    }
                }
                // Hard-link publication fails rather than replacing a raced destination.
                android.system.Os.link(temporary.path, target.path)
                temporary.delete()
                index.put(fingerprint, "app:/data/media/Unsorted/$safeName")
                val indexPartial = File(indexFile.parentFile, "import-index.partial")
                indexPartial.writeText(index.toString()); android.system.Os.rename(indexPartial.path, indexFile.path)
                main.post { reply(JSONObject().put("ok", true).put("message", "Imported ${video.name}")) }
            } catch (e: Exception) {
                partial?.delete()
                main.post { reply(JSONObject().put("ok", false).put("message", e.message ?: "Import failed")) }
            }
        }
    }
}
