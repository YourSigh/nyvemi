package app.nyvemi.nativebridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.work.*
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import kotlinx.coroutines.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Persist deadlines in WorkManager, not a JS timer. Only opaque local IDs enter WorkManager. */
object NyvemiRequestedWork {
  private val handler = Handler(Looper.getMainLooper())
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val timers = ConcurrentHashMap<String, Pair<String, Runnable>>()
  private val receipts = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
  private val flights = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
  private fun name(id: String) = "nyvemi-requested:$id"
  private fun tag(cid: String) = "nyvemi-requested-character:$cid"

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
    // While the visible companion service is alive, also dispatch at the deadline directly.
    // The durable worker remains the recovery path after process death / Doze.
    val timer = Runnable {
      timers.remove(id)
      if (NyvemiPresenceService.instance != null) scope.launch { execute(context.applicationContext, id) }
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

  fun complete(runId: String, done: Boolean) { receipts[runId]?.complete(done) }

  suspend fun execute(context: Context, intentionId: String): Boolean {
    val result = CompletableDeferred<Boolean>()
    val existing = flights.putIfAbsent(intentionId, result)
    if (existing != null) return existing.await()
    val runId = UUID.randomUUID().toString()
    val receipt = CompletableDeferred<Boolean>()
    receipts[runId] = receipt
    var taskContext: HeadlessJsTaskContext? = null
    var taskId: Int? = null
    var done = false
    try {
      done = withTimeout(150_000) {
        val host = (context.applicationContext as ReactApplication).reactHost
          ?: return@withTimeout false
        val startup = withContext(Dispatchers.Main) { host.start() }
        val ready = withContext(Dispatchers.IO) { startup.waitForCompletion(30, TimeUnit.SECONDS) }
        if (!ready || startup.isFaulted() || startup.isCancelled()) return@withTimeout false
        withContext(Dispatchers.Main) {
          val reactContext = host.currentReactContext ?: error("React runtime unavailable")
          taskContext = HeadlessJsTaskContext.getInstance(reactContext)
          taskId = taskContext!!.startTask(HeadlessJsTaskConfig("NyvemiRequestedDelivery", Arguments.createMap().apply {
            putString("intentionId", intentionId)
            putString("runId", runId)
          }, 140_000, true))
        }
        receipt.await()
      }
    } catch (cancelled: CancellationException) {
      if (cancelled !is TimeoutCancellationException) throw cancelled
    } catch (_: Exception) {
      // No prompt, model response, URL or credential is logged by native scheduling.
    } finally {
      receipts.remove(runId)
      result.complete(done)
      flights.remove(intentionId, result)
      withContext(NonCancellable + Dispatchers.Main) {
        taskId?.let { if (taskContext?.isTaskRunning(it) == true) taskContext?.finishTask(it) }
      }
    }
    return done
  }
}

class NyvemiRequestedWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val id = inputData.getString("intentionId") ?: return Result.failure()
    return if (NyvemiRequestedWork.execute(applicationContext, id)) Result.success() else Result.retry()
  }
}
