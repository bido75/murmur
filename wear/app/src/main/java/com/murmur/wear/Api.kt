package com.murmur.wear

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Calls the Murmur `ingest` function. The device token can only create and upload recordings. */
object Api {
    class ApiError(message: String, val status: Int) : Exception(message)

    private val base get() = BuildConfig.SERVER_URL.trimEnd('/') + "/functions/v1/ingest"

    fun call(path: String, body: JSONObject, token: String?): JSONObject {
        val c = URL("$base/$path").openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.connectTimeout = 15_000
        c.readTimeout = 30_000
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.setRequestProperty("apikey", BuildConfig.ANON_KEY)
        c.setRequestProperty("Authorization", "Bearer ${token ?: BuildConfig.ANON_KEY}")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val status = c.responseCode
        val text = (if (status < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
        if (status >= 300 || json.has("error")) throw ApiError(json.optString("error", "Request failed ($status)"), status)
        return json
    }

    fun link(code: String): String =
        call("link", JSONObject().put("code", code).put("name", "Wear OS watch").put("kind", "wear"), null).getString("token")

    /** Start → signed upload URL → PUT → finish. Each step is safe to retry. Returns the recording id. */
    fun upload(token: String, file: File, title: String, consent: String, durationMs: Long, existingId: String?, onId: (String) -> Unit): String {
        val id = existingId ?: call("start", JSONObject().put("title", title).put("template", "general").put("consent_method", consent), token).getString("recording_id").also(onId)
        val url = call("upload-url", JSONObject().put("recording_id", id).put("idx", 1).put("content_type", "audio/mp4"), token).getString("url")
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = "PUT"
        c.doOutput = true
        c.setFixedLengthStreamingMode(file.length())
        c.setRequestProperty("Content-Type", "audio/mp4")
        c.setRequestProperty("x-upsert", "true")
        file.inputStream().use { input -> c.outputStream.use { input.copyTo(it) } }
        if (c.responseCode >= 300) throw ApiError("Upload failed (${c.responseCode})", c.responseCode)
        val seg = JSONObject().put("idx", 1).put("ext", "m4a").put("duration_ms", durationMs)
        call("finish", JSONObject().put("recording_id", id).put("duration_ms", durationMs).put("segments", JSONArray().put(seg)), token)
        return id
    }
}
