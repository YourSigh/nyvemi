package app.nyvemi.nativebridge

import android.content.Context
import android.net.Uri
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.Authenticator
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.net.InetAddress
import java.net.Proxy
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean

/** Explicit user-triggered download only. No startup networking and no provider credentials. */
internal class NyvemiLocalVoiceDownload(private val voice: NyvemiLocalVoice) {
  companion object {
    const val SIZE = 122874105L
    const val SHA256 = "9f6d7822c57371227e70803481c7c8cddcbbc5848f0d9e8234bbe941f3bb64e6"
    // Public v1 artifact pinned to its verified immutable repository revision.
    private const val URL = "https://modelscope.cn/api/v1/models/YourSigh/nyvemi-openvoice-android/repo?Revision=0d1ddd2f60fd1bc4cd4bc6ee032fc34f422e8d51&FilePath=openvoice-v2-android-1.zip"
    private val HOSTS = setOf("modelscope.cn", "cdn-lfs-cn-1.modelscope.cn")
  }
  private val worker = Executors.newSingleThreadExecutor()
  private val epoch = AtomicLong()
  @Volatile private var phase: String? = null
  @Volatile private var bytes = 0L
  @Volatile private var failure: String? = null
  @Volatile private var engine: NyvemiLocalVoiceTransfer? = null
  private fun partial(ctx: Context) = File(ctx.noBackupFilesDir, "openvoice-v2-android-1.zip.part")
  @Synchronized fun state(ctx: Context): Map<String, Any?> {
    val installed = voice.state(ctx)["available"] == true
    val current = when {
      phase in setOf("downloading", "verifying", "installing", "error") -> phase!!
      installed -> "ready"
      URL.isEmpty() -> "unconfigured"
      partial(ctx).length() > 0 || phase == "paused" -> "paused"
      else -> "missing"
    }
    return mapOf("phase" to current, "bytes" to if(current=="ready") SIZE else if(current in setOf("downloading","verifying","installing")) bytes else partial(ctx).length(), "size" to SIZE, "error" to failure, "configured" to URL.isNotEmpty())
  }
  @Synchronized fun start(ctx: Context) {
    if (phase in setOf("downloading", "verifying", "installing") || voice.state(ctx)["available"] == true) return
    check(engine == null) { "正在暂停下载，请稍后继续" }
    check(URL.isNotEmpty()) { "下载地址尚未配置，请先手动导入模型包" }
    val app = ctx.applicationContext
    val token = epoch.incrementAndGet()
    val transfer = NyvemiLocalVoiceTransfer(PinnedTransport())
    engine = transfer; failure = null; phase = "downloading"; bytes = partial(app).length()
    worker.execute {
      try {
        val part = partial(app)
        check(app.noBackupFilesDir.usableSpace > maxOf(0L, SIZE-part.length()) + 160L*1024*1024) { "可用空间不足，请保留模型下载和解压空间" }
        val complete = transfer.download(part, URI(URL), SIZE, SHA256, object : NyvemiLocalVoiceTransfer.Progress {
          override fun received(value: Long) { if(epoch.get()==token) bytes = value }
          override fun verifying() { if(epoch.get()==token) phase = "verifying" }
        })
        synchronized(this) {
          if (!complete || epoch.get()!=token) { phase="paused"; return@execute }
          // Installation is a short atomic replacement, not interruptible once entered.
          phase="installing"
        }
        voice.importPack(app, Uri.fromFile(part).toString())
        part.delete()
        synchronized(this) { phase="ready"; bytes=SIZE; failure=null }
      } catch (_: Exception) {
        synchronized(this) {
          if(epoch.get()!=token) phase="paused"
          else { phase="error"; failure="模型下载或校验失败；已有模型未改动，可重试或手动导入" }
        }
      } finally { synchronized(this) { if(engine===transfer) engine=null } }
    }
  }
  @Synchronized fun pause() {
    if(phase !in setOf("downloading","verifying")) return
    epoch.incrementAndGet(); engine?.pause(); phase="paused"
  }
  fun close() { pause(); worker.shutdown() }

  internal class PinnedTransport(private val hosts: Set<String> = HOSTS, private val allowLoopbackHttpForTests: Boolean = false) : NyvemiLocalVoiceTransfer.Transport {
    @Volatile private var active: Call? = null
    private val cancelled = AtomicBoolean(false)
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
      .retryOnConnectionFailure(false).cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE)
      .proxyAuthenticator(Authenticator.NONE).proxy(Proxy.NO_PROXY)
      .connectTimeout(15,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).callTimeout(90,TimeUnit.SECONDS)
      .dns(object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
          require(hostname in hosts) { "模型下载域名不受支持" }
          val addresses = Dns.SYSTEM.lookup(hostname)
          require(addresses.isNotEmpty() && addresses.all { NyvemiPublicVoicePolicy.publicAddress(it) || (allowLoopbackHttpForTests && it.isLoopbackAddress) }) { "模型来源不是公网地址" }
          return addresses
        }
      }).build()
    private fun validate(url: URI) {
      val testHttp = allowLoopbackHttpForTests && url.scheme=="http" && url.host in setOf("127.0.0.1", "localhost", "::1")
      require(((url.scheme=="https" && url.port == -1) || testHttp) && url.host in hosts && url.rawUserInfo==null && url.rawFragment==null && url.toString().length<=8192) { "模型下载地址不受支持" }
    }
    override fun cancel() { cancelled.set(true); active?.cancel() }
    override fun open(url: URI, start: Long, end: Long): NyvemiLocalVoiceTransfer.Response {
      var current=url
      for(hop in 0..3) {
        if(cancelled.get()) throw IOException("模型下载已暂停")
        validate(current)
        val call=client.newCall(Request.Builder().url(current.toString()).header("Range","bytes=$start-$end").header("Accept-Encoding","identity").build())
        active=call
        if(cancelled.get()) { call.cancel(); throw IOException("模型下载已暂停") }
        val response=call.execute()
        if(response.code in setOf(301,302,303,307,308)) {
          val next=response.header("Location");response.close()
          if(next==null || hop==3) throw IOException("模型下载重定向无效")
          current=current.resolve(next)
        } else {
          val body=response.body ?: run { response.close(); throw IOException("模型下载内容为空") }
          return NyvemiLocalVoiceTransfer.Response(response.code,response.header("Content-Range"),response.header("Content-Length"),response.header("Content-Encoding"),body.byteStream()) { response.close(); active=null }
        }
      }
      throw IOException("模型下载重定向过多")
    }
  }
}
