package expo.modules.murmurforeground

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MurmurForegroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MurmurForeground")

    // Must be called while the app is in the foreground (Android 14 rule for microphone services).
    Function("start") { title: String, body: String ->
      val ctx = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val intent = Intent(ctx, RecordingService::class.java)
        .putExtra(RecordingService.EXTRA_TITLE, title)
        .putExtra(RecordingService.EXTRA_BODY, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
    }

    Function("stop") {
      val ctx = appContext.reactContext
      if (ctx != null) {
        ctx.stopService(Intent(ctx, RecordingService::class.java))
      }
    }
  }
}
