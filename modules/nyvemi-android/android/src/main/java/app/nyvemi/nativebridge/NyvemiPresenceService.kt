package app.nyvemi.nativebridge

import android.app.Service
import android.os.IBinder
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import kotlinx.coroutines.*
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/** User-started, visible companion session. No alarms, silent audio, or automatic boot launch. */
class NyvemiPresenceService : Service() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var ticker: Job? = null
  private var fullCycle: Job? = null
  private var displayCharacter = ""
  private var displayName = "Nyvemi"
  private var displayText = "正在接上之前的相处"
  override fun onCreate() {
    super.onCreate()
    instance = this
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "常驻陪伴状态", NotificationManager.IMPORTANCE_LOW).apply {
      description = "用户开启的持续陪伴会话，可随时结束"
      setShowBadge(false)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
    })
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP) {
      preferences(this).edit().putBoolean("enabled", false).apply()
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    val prefs = preferences(this)
    if (!prefs.getBoolean("enabled", false)) { stopSelf(); return START_NOT_STICKY }
    displayCharacter = prefs.getString("characterId", "") ?: ""
    displayName = prefs.getString("name", "Nyvemi") ?: "Nyvemi"
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
    if (ticker?.isActive != true) ticker = scope.launch {
      val cadence = NyvemiPresenceCadence()
      while (isActive && preferences(this@NyvemiPresenceService).getBoolean("enabled", false)) {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        val online = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
          ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        if (online) {
          // Separate lanes: slow RSS/extraction must not block a due conversation intention.
          if (fullCycle?.isActive != true && cadence.fullDue(SystemClock.elapsedRealtime())) {
            fullCycle = launch {
              val done = NyvemiMaintenance.execute(applicationContext, true, "presence_service")
              cadence.fullFinished(SystemClock.elapsedRealtime(), done)
            }
          }
          NyvemiMaintenance.execute(applicationContext, false, "presence_service")
        } else update(displayCharacter, displayName, "暂时离线，等网络恢复再接上")
        // Native coroutine delay, independent of RN foreground frame/JS timer lifecycle.
        delay(30_000)
      }
    }
    return START_STICKY
  }
  override fun onBind(intent: Intent?): IBinder? = null
  private fun notification(): android.app.Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)!!.apply {
      action = Intent.ACTION_VIEW
      data = Uri.Builder().scheme("nyvemi").authority("chat").appendPath(displayCharacter).build()
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val open = PendingIntent.getActivity(this, NOTIFICATION_ID, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val stop = PendingIntent.getService(this, NOTIFICATION_ID + 1, Intent(this, NyvemiPresenceService::class.java).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val icon = resources.getIdentifier("nyvemi_notification", "drawable", packageName).takeIf { it != 0 } ?: applicationInfo.icon
    return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(icon)
      .setContentTitle("$displayName · 常驻陪伴").setContentText(displayText)
      .setStyle(NotificationCompat.BigTextStyle().bigText(displayText))
      .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .addAction(0, "结束常驻", stop).build()
  }
  fun update(characterId: String, name: String, text: String) {
    if (displayCharacter == characterId && displayName == name && displayText == text) return
    displayCharacter = characterId; displayName = name.take(80); displayText = text.take(180)
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
  }
  override fun onDestroy() {
    instance = null
    scope.cancel()
    // Keep preference on OS destruction for START_STICKY recovery; explicit stop clears it.
    super.onDestroy()
  }
  companion object {
    const val CHANNEL = "nyvemi-presence-v1"
    const val NOTIFICATION_ID = 73021
    const val STOP = "app.nyvemi.PRESENCE_STOP"
    @Volatile var instance: NyvemiPresenceService? = null
    fun preferences(context: Context) = context.getSharedPreferences("nyvemi-presence", Context.MODE_PRIVATE)
  }
}
