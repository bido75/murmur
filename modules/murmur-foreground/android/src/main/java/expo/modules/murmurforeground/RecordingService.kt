package expo.modules.murmurforeground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps the app's process (and so the microphone stream) alive while recording with the screen
 * off. The recording itself is done in JS; this only holds the foreground status, a partial wake
 * lock, and the "Recording" notification Android requires.
 */
class RecordingService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Recording"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW))
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    val notification = builder
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .apply { if (open != null) setContentIntent(open) }
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    if (wakeLock == null) {
      wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "murmur:recording")
        .apply { acquire(6 * 60 * 60 * 1000L) } // released on stop; capped at 6 h
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    super.onDestroy()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    private const val CHANNEL = "murmur-recording"
    private const val NOTIFICATION_ID = 4711
  }
}
