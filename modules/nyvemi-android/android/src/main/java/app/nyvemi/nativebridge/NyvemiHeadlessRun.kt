package app.nyvemi.nativebridge

import android.content.Context
import android.os.PowerManager
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import kotlinx.coroutines.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** A finite, acknowledged native -> JS execution. Never hold a wake lock between ticks. */
object NyvemiHeadlessRun {
  private val receipts = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()
  private val flights = ConcurrentHashMap<String, CompletableDeferred<Boolean>>()

  fun complete(runId: String, done: Boolean) { receipts[runId]?.complete(done) }

  suspend fun execute(
    context: Context,
    key: String,
    task: String,
    timeout: Long,
    data: (String) -> WritableMap,
    record: (String) -> Unit = {}
  ): Boolean {
    val result = CompletableDeferred<Boolean>()
    val existing = flights.putIfAbsent(key, result)
    if (existing != null) return existing.await()
    val runId = UUID.randomUUID().toString()
    val receipt = CompletableDeferred<Boolean>()
    receipts[runId] = receipt
    var taskContext: HeadlessJsTaskContext? = null
    var taskId: Int? = null
    var wake: PowerManager.WakeLock? = null
    var done = false
    var outcome = "runtime_unavailable"
    try {
      record("starting_runtime")
      wake = context.getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Nyvemi:background-run").apply {
          setReferenceCounted(false)
          acquire(timeout + 5000)
        }
      done = withTimeout(timeout) {
        val host = (context.applicationContext as ReactApplication).reactHost
          ?: return@withTimeout false
        val startup = withContext(Dispatchers.Main) { host.start() }
        val ready = withContext(Dispatchers.IO) { startup.waitForCompletion(30, TimeUnit.SECONDS) }
        if (!ready || startup.isFaulted() || startup.isCancelled()) return@withTimeout false
        withContext(Dispatchers.Main) {
          val reactContext = host.currentReactContext ?: error("React runtime unavailable")
          taskContext = HeadlessJsTaskContext.getInstance(reactContext)
          taskId = taskContext!!.startTask(HeadlessJsTaskConfig(task, data(runId), timeout, true))
        }
        record("running_js")
        receipt.await().also { outcome = if (it) "finished" else "retry_pending" }
      }
    } catch (cancelled: CancellationException) {
      outcome = if (cancelled is TimeoutCancellationException) "runtime_timeout" else "cancelled"
      if (cancelled !is TimeoutCancellationException) throw cancelled
    } catch (_: Exception) {
      // Do not persist URLs, credentials, prompts or raw native exceptions.
      outcome = "runtime_error"
    } finally {
      runCatching { record(outcome) }
      receipts.remove(runId)
      result.complete(done)
      flights.remove(key, result)
      withContext(NonCancellable + Dispatchers.Main) {
        taskId?.let { if (taskContext?.isTaskRunning(it) == true) taskContext?.finishTask(it) }
      }
      wake?.let { if (it.isHeld) it.release() }
    }
    return done
  }
}
