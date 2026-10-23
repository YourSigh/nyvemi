package app.nyvemi.nativebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.Icon
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.core.view.WindowCompat
import androidx.core.content.ContextCompat
import android.net.Uri
import android.provider.Settings
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class NyvemiAndroidModule : Module() {
  private val channelId = "nyvemi-companions-v1"
  private fun context(): Context = appContext.reactContext ?: throw IllegalStateException("Android context unavailable")
  private fun manager(ctx: Context): NotificationManager = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  private fun channel(ctx: Context) {
    if (Build.VERSION.SDK_INT >= 26) {
      manager(ctx).createNotificationChannel(NotificationChannel(channelId, "角色来信", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "有上下文且经过限频的角色主动消息"
        lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
      })
    }
  }
  private fun avatar(ctx: Context, name: String, uri: String?): Bitmap {
    if (uri != null && uri.startsWith("file://")) {
      // App-owned image only; never fetch network avatars or expose arbitrary content providers.
      val path = Uri.parse(uri).path
      if (path != null && java.io.File(path).canonicalPath.startsWith(ctx.filesDir.canonicalPath + "/")) {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, options)
        var sample = 1
        while (options.outWidth / sample > 512 || options.outHeight / sample > 512) sample *= 2
        val bitmap = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
        if (bitmap != null) return bitmap
      }
    }
    val bitmap = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.rgb(252, 228, 238))
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(216, 107, 150); textSize = 86f; textAlign = Paint.Align.CENTER }
    canvas.drawText(name.take(1).ifBlank { "N" }, 96f, 96f - (paint.ascent() + paint.descent()) / 2, paint)
    return bitmap
  }
  private fun launchIntent(ctx: Context, characterId: String, notificationId: String? = null): Intent {
    val uri = Uri.Builder().scheme("nyvemi").authority("chat").appendPath(characterId).apply {
      if (notificationId != null) appendQueryParameter("notificationId", notificationId)
    }.build()
    return (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: throw IllegalStateException("Launch intent unavailable")).apply {
      action = Intent.ACTION_VIEW
      data = uri
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
  }
  override fun definition() = ModuleDefinition {
    Name("NyvemiAndroid")
    AsyncFunction("scheduleRequested") { id: String, cid: String, dueAt: Double ->
      NyvemiRequestedWork.schedule(context().applicationContext, id, cid, dueAt.toLong())
    }
    AsyncFunction("cancelRequested") { id: String -> NyvemiRequestedWork.cancel(context(), id) }
    AsyncFunction("cancelRequestedCharacter") { cid: String -> NyvemiRequestedWork.cancelCharacter(context(), cid) }
    Function("completeRequestedRun") { runId: String, done: Boolean -> NyvemiRequestedWork.complete(runId, done) }
    Function("presenceState") {
      val prefs = NyvemiPresenceService.preferences(context())
      mapOf("enabled" to prefs.getBoolean("enabled", false), "running" to (NyvemiPresenceService.instance != null), "characterId" to (prefs.getString("characterId", "") ?: ""))
    }
    AsyncFunction("openNotificationSettings") {
      val ctx = context(); channel(ctx)
      val intent = if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
        putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
      } else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
      ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    AsyncFunction("openBatterySettings") {
      val ctx = context()
      ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    Function("removeShortcut") { characterId: String ->
      if (Build.VERSION.SDK_INT >= 26) context().getSystemService(ShortcutManager::class.java)
        .disableShortcuts(listOf("character:$characterId"), "这个角色已重新创建")
    }
    AsyncFunction("setNavigationBarDark") { dark: Boolean ->
      appContext.currentActivity?.let { activity ->
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).isAppearanceLightNavigationBars = !dark
      }
    }.runOnQueue(Queues.MAIN)
    Function("hasNetwork") {
      val connectivity = context().getSystemService(ConnectivityManager::class.java)
      val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
      capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
    }
    AsyncFunction("startPresence") { characterId: String, name: String ->
      val ctx = context()
      if (appContext.currentActivity == null) throw IllegalStateException("Open the app to start a companion session")
      if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) throw IllegalStateException("Notification permission missing")
      val prefs = NyvemiPresenceService.preferences(ctx)
      prefs.edit().putBoolean("enabled", true).putString("characterId", characterId).putString("name", name.take(80)).apply()
      try { ContextCompat.startForegroundService(ctx, Intent(ctx, NyvemiPresenceService::class.java)) }
      catch (error: Exception) { prefs.edit().putBoolean("enabled", false).apply(); throw error }
    }.runOnQueue(Queues.MAIN)
    Function("stopPresence") {
      val ctx = context()
      NyvemiPresenceService.preferences(ctx).edit().putBoolean("enabled", false).apply()
      ctx.stopService(Intent(ctx, NyvemiPresenceService::class.java))
    }
    Function("updatePresence") { characterId: String, name: String, text: String -> NyvemiPresenceService.instance?.update(characterId, name, text) }

    Function("canNotify") {
      val ctx = context(); channel(ctx)
      NotificationManagerCompat.from(ctx).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 26 || manager(ctx).getNotificationChannel(channelId)?.importance != NotificationManager.IMPORTANCE_NONE)
    }
    AsyncFunction("notify") { notificationId: String, characterId: String, name: String, body: String, avatarUri: String? ->
      val ctx = context(); channel(ctx)
      if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled() || (Build.VERSION.SDK_INT >= 26 && manager(ctx).getNotificationChannel(channelId)?.importance == NotificationManager.IMPORTANCE_NONE)) throw IllegalStateException("Notification permission missing")
      val pending = PendingIntent.getActivity(ctx, notificationId.hashCode(), launchIntent(ctx, characterId, notificationId), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val smallIcon = ctx.resources.getIdentifier("nyvemi_notification", "drawable", ctx.packageName).takeIf { it != 0 } ?: ctx.applicationInfo.icon
      val notification = NotificationCompat.Builder(ctx, channelId)
        .setSmallIcon(smallIcon).setLargeIcon(avatar(ctx, name, avatarUri))
        .setContentTitle(name).setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setCategory(NotificationCompat.CATEGORY_MESSAGE).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setAutoCancel(true).setOnlyAlertOnce(true).setContentIntent(pending).build()
      // String tag gives exact idempotence without relying on hash uniqueness.
      manager(ctx).notify(notificationId, 0, notification)
      true
    }
    Function("cancelNotification") { notificationId: String -> manager(context()).cancel(notificationId, 0) }
    AsyncFunction("pinShortcut") { characterId: String, name: String, avatarUri: String? ->
      val ctx = context()
      if (Build.VERSION.SDK_INT < 26) return@AsyncFunction false
      val shortcuts = ctx.getSystemService(ShortcutManager::class.java)
      if (!shortcuts.isRequestPinShortcutSupported) return@AsyncFunction false
      val shortcut = ShortcutInfo.Builder(ctx, "character:$characterId")
        .setShortLabel(name.take(40)).setLongLabel(name.take(80))
        .setIcon(Icon.createWithAdaptiveBitmap(avatar(ctx, name, avatarUri)))
        .setIntent(launchIntent(ctx, characterId)).build()
      shortcuts.requestPinShortcut(shortcut, null)
    }.runOnQueue(Queues.MAIN)
  }
}
