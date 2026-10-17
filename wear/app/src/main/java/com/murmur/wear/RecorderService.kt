package com.murmur.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.SystemClock
import androidx.lifecycle.LifecycleService
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.io.File
import java.util.UUID

/** Records in a foreground service so it keeps going with the screen off. AAC .m4a, mono, 22 kHz. */
class RecorderService : LifecycleService() {
    companion object {
        @Volatile var startedAt: Long = 0L
        val isRecording get() = startedAt != 0L
        fun start(ctx: Context, consent: String) = ctx.startForegroundService(Intent(ctx, RecorderService::class.java).putExtra("consent", consent))
        fun stop(ctx: Context) = ctx.startService(Intent(ctx, RecorderService::class.java).setAction("stop"))
    }

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var consent = "not_confirmed"

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == "stop") { finish(); return START_NOT_STICKY }
        if (recorder != null) return START_NOT_STICKY
        consent = intent?.getStringExtra("consent") ?: "not_confirmed"
        startForeground(1, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        val f = File(Store.pendingDir(this), "rec-${UUID.randomUUID()}.m4a.part")
        recorder = MediaRecorder(this).apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioChannels(1)
            setAudioSamplingRate(22_050)
            setAudioEncodingBitRate(48_000)
            setOutputFile(f.absolutePath)
            prepare()
            start()
        }
        file = f
        startedAt = SystemClock.elapsedRealtime()
        return START_NOT_STICKY
    }

    private fun finish() {
        val ms = if (startedAt == 0L) 0L else SystemClock.elapsedRealtime() - startedAt
        runCatching { recorder?.stop() }
        recorder?.release()
        recorder = null
        startedAt = 0L
        file?.let { part ->
            if (ms > 1000) {
                // Ready to upload: drop ".part"; WorkManager retries until it succeeds.
                val done = File(part.parentFile, part.name.removeSuffix(".part"))
                part.renameTo(done)
                val input = Data.Builder().putString("file", done.name).putString("consent", consent).putLong("duration", ms).build()
                val work = OneTimeWorkRequestBuilder<UploadWorker>().setInputData(input)
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
                WorkManager.getInstance(this).enqueue(work)
            } else part.delete()
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("rec", "Recording", NotificationManager.IMPORTANCE_LOW))
        return Notification.Builder(this, "rec").setContentTitle("Murmur is recording").setSmallIcon(android.R.drawable.ic_btn_speak_now).setOngoing(true).build()
    }
}
