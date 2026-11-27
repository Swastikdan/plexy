package expo.modules.plexydownloads

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Private persistence for the single active download job and completed results.
 * The JS queue owns ordering; the service owns only the job it is currently
 * executing. Everything here is written before/after network work so a process
 * kill can be recovered on the next app launch.
 */
class DownloadStore(context: Context) {
  private val prefs = context.getSharedPreferences("plexy_downloads", Context.MODE_PRIVATE)

  fun saveJob(json: String) {
    prefs.edit().putString(KEY_JOB, json).apply()
  }

  fun job(): String? = prefs.getString(KEY_JOB, null)

  fun saveState(json: String) {
    prefs.edit().putString(KEY_STATE, json).apply()
  }

  fun state(): Map<String, Any?>? {
    val raw = prefs.getString(KEY_STATE, null) ?: return null
    return try {
      JSONObject(raw).toMap()
    } catch (_: Exception) {
      null
    }
  }

  fun addCompleted(json: String) {
    val array = completedArray()
    array.put(JSONObject(json))
    prefs.edit().putString(KEY_COMPLETED, array.toString()).apply()
  }

  fun completed(): List<Map<String, Any?>> {
    val array = completedArray()
    return buildList {
      for (index in 0 until array.length()) {
        val value = array.optJSONObject(index) ?: continue
        add(value.toMap())
      }
    }
  }

  fun clearCompleted(id: String) {
    val array = completedArray()
    val kept = JSONArray()
    for (index in 0 until array.length()) {
      val value = array.optJSONObject(index) ?: continue
      if (value.optString("id") != id) kept.put(value)
    }
    prefs.edit().putString(KEY_COMPLETED, kept.toString()).apply()
  }

  fun clearActive() {
    prefs.edit().remove(KEY_JOB).remove(KEY_STATE).apply()
  }

  private fun completedArray(): JSONArray {
    val raw = prefs.getString(KEY_COMPLETED, null) ?: return JSONArray()
    return try {
      JSONArray(raw)
    } catch (_: Exception) {
      JSONArray()
    }
  }

  companion object {
    private const val KEY_JOB = "job"
    private const val KEY_STATE = "state"
    private const val KEY_COMPLETED = "completed"
  }
}

private fun JSONObject.toMap(): Map<String, Any?> {
  val output = LinkedHashMap<String, Any?>()
  val iterator = keys()
  while (iterator.hasNext()) {
    val key = iterator.next()
    output[key] = when (val value = opt(key)) {
      null, JSONObject.NULL -> null
      is JSONObject -> value.toMap()
      is JSONArray -> value.toList()
      else -> value
    }
  }
  return output
}

private fun JSONArray.toList(): List<Any?> {
  val output = ArrayList<Any?>(length())
  for (index in 0 until length()) {
    output.add(
      when (val value = opt(index)) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.toMap()
        is JSONArray -> value.toList()
        else -> value
      },
    )
  }
  return output
}
