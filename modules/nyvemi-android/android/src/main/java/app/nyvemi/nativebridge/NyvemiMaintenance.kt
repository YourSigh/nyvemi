package app.nyvemi.nativebridge

import android.content.Context
import android.os.PowerManager
import androidx.work.*
import com.facebook.react.bridge.Arguments
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Durable recovery independent of an Activity, Expo scheduling or the visible service. */
object NyvemiMaintenance {
  private const val WORK = "nyvemi-maintenance-v2"
  private fun prefs(context: Context) = context.getSharedPreferences(WORK, Context.MODE_PRIVATE)

  fun register(context: Context) {
    val work = PeriodicWorkRequestBuilder<NyvemiMaintenanceWorker>(15, TimeUnit.MINUTES)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, work).result.get()
  }

  suspend fun execute(context: Context, full: Boolean, source: String): Boolean {
    val mode = if (full) "full" else "fast"
    return NyvemiHeadlessRun.execute(context, "maintenance:$mode", "NyvemiMaintenance", if (full) 480_000 else 150_000,
      data = { id -> Arguments.createMap().apply {
        putString("runId", id); putString("source", source); putBoolean("full", full)
      } },
      record = { stage -> runCatching {
        val value = JSONObject(prefs(context).getString(mode, "{}") ?: "{}")
        value.put("stage", stage).put("updatedAt", System.currentTimeMillis()).put("source", source)
        if (stage == "starting_runtime") value.put("startedAt", System.currentTimeMillis())
        if (stage !in listOf("starting_runtime", "running_js")) value.put("finishedAt", System.currentTimeMillis())
        prefs(context).edit().putString(mode, value.toString()).apply()
      }; Unit }
    )
  }

  fun status(context: Context): Map<String, Any> {
    val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork(WORK).get()
    fun snapshot(mode: String): Map<String, Any> {
      val value = runCatching { JSONObject(prefs(context).getString(mode, "{}") ?: "{}") }.getOrDefault(JSONObject())
      return mapOf("stage" to value.optString("stage", "never"), "source" to value.optString("source", "unknown"),
        "startedAt" to value.optLong("startedAt"), "finishedAt" to value.optLong("finishedAt"), "updatedAt" to value.optLong("updatedAt"))
    }
    val power = context.getSystemService(PowerManager::class.java)
    return mapOf("fast" to snapshot("fast"), "full" to snapshot("full"),
      "workStates" to work.map { it.state.name }.distinct(),
      "batteryUnrestricted" to power.isIgnoringBatteryOptimizations(context.packageName), "deviceIdle" to power.isDeviceIdleMode)
  }
}

class NyvemiMaintenanceWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result =
    if (NyvemiMaintenance.execute(applicationContext, true, "periodic_worker")) Result.success() else Result.retry()
}
