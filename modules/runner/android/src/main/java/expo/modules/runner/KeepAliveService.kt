package expo.modules.runner

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the app alive while projects run in the background.
 *
 * Android freezes or kills apps that leave the screen. A foreground service
 * (the ongoing "Repo Runner is running" notification) plus a partial wake
 * lock stops that, so dev servers keep serving while you use other apps.
 * It starts with the first process and stops a couple of seconds after the
 * last one (the delay avoids start/stop races on short install steps).
 */
class KeepAliveService : Service() {

  companion object {
    /** Starts, refreshes or (after a short delay) stops the service to match what is running. */
    fun update(context: Context, labels: List<String>) {
      val app = context.applicationContext
      mainHandler.post {
        pendingStop?.let { mainHandler.removeCallbacks(it) }
        pendingStop = null

        when {
          labels.isEmpty() -> {
            if (!started) return@post
            val stop = Runnable {
              started = false
              app.stopService(Intent(app, KeepAliveService::class.java))
            }
            pendingStop = stop
            mainHandler.postDelayed(stop, 2000)
          }
          !started -> {
            val intent = Intent(app, KeepAliveService::class.java)
              .putStringArrayListExtra(EXTRA_LABELS, ArrayList(labels))
            try {
              ContextCompat.startForegroundService(app, intent)
              started = true
            } catch (e: Exception) {
              // Android 12+ refuses while the app is in the background; we'll
              // try again the next time something starts.
            }
          }
          else -> {
            // Already running: just refresh the notification text.
            try {
              NotificationManagerCompat.from(app).notify(NOTIFICATION_ID, buildNotification(app, labels))
            } catch (_: SecurityException) {
              // Notification permission denied; the service keeps running anyway.
            }
          }
        }
      }
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Always call startForeground first: Android crashes the app if a service
    // started with startForegroundService() doesn't, even when it's stopping.
    val labels = intent?.getStringArrayListExtra(EXTRA_LABELS) ?: arrayListOf()
    val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(this, labels), type)

    if (intent?.action == ACTION_STOP_ALL) {
      SessionManager.peek()?.stopAll() // the resulting update(empty) stops us
      return START_NOT_STICKY
    }

    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RepoRunner::processes").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    started = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }
}

private fun buildNotification(ctx: Context, labels: List<String>): Notification {
  val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Running projects", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while projects or terminals are running"
      },
    )
  }

  val immutable = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
  val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
    PendingIntent.getActivity(ctx, 0, it, immutable or PendingIntent.FLAG_UPDATE_CURRENT)
  }
  val stopAll = PendingIntent.getService(
    ctx, 1, Intent(ctx, KeepAliveService::class.java).setAction(ACTION_STOP_ALL),
    immutable or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  val unique = labels.distinct()
  val title = when (labels.size) {
    0 -> "Repo Runner"
    1 -> "Running ${labels[0]}"
    else -> "${labels.size} processes running"
  }

  return NotificationCompat.Builder(ctx, CHANNEL_ID)
    .setSmallIcon(android.R.drawable.ic_media_play) // adaptive app icons can crash as small icons
    .setContentTitle(title)
    .setContentText(unique.joinToString(", ").ifEmpty { "Working…" })
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .setContentIntent(open)
    .addAction(0, "Stop all", stopAll)
    .build()
}

private const val CHANNEL_ID = "runner-processes"
private const val NOTIFICATION_ID = 4210
private const val EXTRA_LABELS = "labels"
private const val ACTION_STOP_ALL = "dev.reporunner.STOP_ALL"

/** State shared by the service and [update]; only touched on the main thread. */
private val mainHandler by lazy { Handler(Looper.getMainLooper()) }
@Volatile private var started = false
private var pendingStop: Runnable? = null
