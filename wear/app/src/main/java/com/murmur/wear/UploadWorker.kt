package com.murmur.wear

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.DateFormat
import java.util.Date

/** Uploads one finished recording; the file is deleted only after the server has it. */
class UploadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        val token = Store.token(ctx) ?: return@withContext Result.failure()
        val name = inputData.getString("file") ?: return@withContext Result.failure()
        val file = File(Store.pendingDir(ctx), name)
        if (!file.exists()) return@withContext Result.success()
        val idFile = File(file.parentFile, "$name.id") // remembers the recording id across retries
        try {
            val title = "Watch recording " + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(file.lastModified()))
            Api.upload(token, file, title, inputData.getString("consent") ?: "not_confirmed", inputData.getLong("duration", 0), idFile.takeIf { it.exists() }?.readText()) { idFile.writeText(it) }
            file.delete()
            idFile.delete()
            Result.success()
        } catch (e: Api.ApiError) {
            if (e.status == 401) { Store.setToken(ctx, null); Result.failure() } else if (runAttemptCount < 10) Result.retry() else Result.failure()
        } catch (e: Exception) {
            if (runAttemptCount < 10) Result.retry() else Result.failure()
        }
    }
}
