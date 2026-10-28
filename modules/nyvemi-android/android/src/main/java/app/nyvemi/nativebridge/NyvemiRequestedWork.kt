package app.nyvemi.nativebridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import androidx.work.*
import com.facebook.react.bridge.Arguments
import kotlinx.coroutines.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** All intention kinds share durable dispatch. Class/work names remain compatible with 0.3.1 jobs. */
object NyvemiRequestedWork {
  private val handler = Handler(Looper.getMainLooper())
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val timers = ConcurrentHashMap<String, Pair<String, Runnable>>()
  private fun name(id: String) = "nyvemi-requested:$id"
  private fun tag(cid: String) = "nyvemi-requested-character:$cid"

  @Synchronized private fun record(context: Context, id: String, stage: String, extra: Map<String, Any> = emptyMap()) {
    // Diagnostic persistence must never interrupt message delivery.
    runCatching {
    val prefs = context.getSharedPreferences("nyvemi-delivery-status", Context.MODE_PRIVATE)
    val value = runCatching { JSONObject(prefs.getString(id, "{}") ?: "{}") }.getOrDefault(JSONObject())
    value.put("stage", stage).put("updatedAt", System.currentTimeMillis())
    for ((key, item) in extra) value.put(key, item)
    val editor = prefs.edit().putString(id, value.toString())
    if (!prefs.contains(id) && prefs.all.size >= 100) {
      prefs.all.entries.sortedBy { runCatching { JSONObject(it.value as String).optLong("updatedAt") }.getOrDefault(0) }
        .take(prefs.all.size - 99).forEach { editor.remove(it.key) }
    }
    editor.apply()
    }
  }

  fun status(context: Context, id: String): Map<String, Any> {
    val prefs = context.getSharedPreferences("nyvemi-delivery-status", Context.MODE_PRIVATE)
    val value = runCatching { JSONObject(prefs.getString(id, "{}") ?: "{}") }.getOrDefault(JSONObject())
    val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork(name(id)).get()
    return mapOf(
      "stage" to value.optString("stage", "unknown"),
      "scheduledAt" to value.optLong("scheduledAt"), "startedAt" to value.optLong("startedAt"),
      "finishedAt" to value.optLong("finishedAt"), "outcome" to value.optString("outcome", "unknown"),
      "source" to value.optString("source", "unknown"),
      "workStates" to work.map { it.state.name }.distinct(),
      "attempts" to (work.maxOfOrNull { it.runAttemptCount } ?: 0)
    )
  }

  fun schedule(context: Context, id: String, cid: String, dueAt: Long) {
    require(id.isNotBlank() && cid.isNotBlank() && dueAt > 0)
    val request = OneTimeWorkRequestBuilder<NyvemiRequestedWorker>()
      .setInputData(workDataOf("intentionId" to id))
      .setInitialDelay((dueAt - System.currentTimeMillis()).coerceAtLeast(0), TimeUnit.MILLISECONDS)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .addTag(tag(cid)).build()
    // Waiting for the operation makes the acknowledgement conditional on durable registration.
    WorkManager.getInstance(context).enqueueUniqueWork(name(id), ExistingWorkPolicy.KEEP, request).result.get()
    record(context, id, "registered", mapOf("scheduledAt" to System.currentTimeMillis()))
    // While the visible companion service is alive, also dispatch at the deadline directly.
    // The durable worker remains the recovery path after process death / Doze.
    val timer = Runnable {
      timers.remove(id)
      if (NyvemiPresenceService.instance != null) scope.launch { execute(context.applicationContext, id, "presence_deadline") }
    }
    timers.put(id, cid to timer)?.let { handler.removeCallbacks(it.second) }
    handler.postDelayed(timer, (dueAt - System.currentTimeMillis()).coerceAtLeast(0))
  }

  fun cancel(context: Context, id: String) {
    timers.remove(id)?.let { handler.removeCallbacks(it.second) }
    WorkManager.getInstance(context).cancelUniqueWork(name(id)).result.get()
  }

  fun cancelCharacter(context: Context, cid: String) {
    for ((id, timer) in timers) {
      if (timer.first == cid && timers.remove(id, timer)) handler.removeCallbacks(timer.second)
    }
    // Reset obtains the requested-delivery lease before cancelling native jobs and erasing.
    WorkManager.getInstance(context).cancelAllWorkByTag(tag(cid)).result.get()
  }

  fun complete(runId: String, done: Boolean) { NyvemiHeadlessRun.complete(runId, done) }

  suspend fun execute(context: Context, intentionId: String, source: String = "worker"): Boolean =
    NyvemiHeadlessRun.execute(context, "intention:$intentionId", "NyvemiRequestedDelivery", 150_000,
      data = { runId -> Arguments.createMap().apply {
        putString("intentionId", intentionId)
        putString("runId", runId)
      } },
      record = { stage ->
        val timing = when (stage) {
          "starting_runtime" -> mapOf<String, Any>("startedAt" to System.currentTimeMillis(), "source" to source)
          "running_js" -> emptyMap()
          else -> mapOf<String, Any>("finishedAt" to System.currentTimeMillis(), "outcome" to stage)
        }
        record(context, intentionId, stage, timing)
      }
    )
}

class NyvemiRequestedWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val id = inputData.getString("intentionId") ?: return Result.failure()
    return if (NyvemiRequestedWork.execute(applicationContext, id)) Result.success() else Result.retry()
  }
}
