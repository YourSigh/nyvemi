package app.nyvemi.nativebridge

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.SystemClock
import app.nyvemi.openvoice.AudioFrontend
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.net.InetAddress
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Anonymous, direct phone retrieval. Never forwards cookies, provider keys or bearer tokens. */
internal class NyvemiPublicVoiceReferences(private val context: Context) {
  private data class Offered(val candidate: NyvemiPublicVoicePolicy.Candidate, val expires: Long)
  private val offered = ConcurrentHashMap<String, Offered>()
  private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
    .connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS)
    .dns(object : Dns {
      override fun lookup(hostname: String): List<InetAddress> {
        require(hostname in setOf("wiki.biligame.com", "patchwiki.biligame.com", "static.wikia.nocookie.net")) { "不支持此公开来源" }
        val addresses = Dns.SYSTEM.lookup(hostname)
        require(addresses.isNotEmpty() && addresses.all(NyvemiPublicVoicePolicy::publicAddress)) { "公开来源解析到非公网地址" }
        return addresses
      }
    }).build()

  fun close() { offered.clear(); client.dispatcher.cancelAll(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown() }

  fun findVoiceReferences(query: String): List<Map<String, Any>> {
    val pages = NyvemiPublicVoicePolicy.pages(query)
    val now = SystemClock.elapsedRealtime()
    offered.entries.removeAll { it.value.expires < now }
    val found = mutableListOf<NyvemiPublicVoicePolicy.Candidate>()
    var failure: Exception? = null
    for (page in pages) {
      try {
        val html = fetch(page.url, false, 3 * 1024 * 1024).toString(Charsets.UTF_8)
        found.addAll(NyvemiPublicVoicePolicy.parse(page, html))
        if (found.size >= 5) break
      } catch (e: Exception) { failure = e }
    }
    if (found.isEmpty()) {
      for (page in pages) {
        val archive = NyvemiPublicVoicePolicy.archiveFallback(page) ?: continue
        try {
          val clip = fetch(archive.audioUrl, true, 2 * 1024 * 1024)
          require(clip.size >= 28 && clip.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "OggS")
          found.add(archive); break
        } catch (e: Exception) { failure = e }
      }
    }
    if (found.isEmpty()) throw IllegalStateException("没有找到可验证的中文公开录音；可导入自己的 WAV。${if (failure != null) "公开来源暂不可用或页面格式变化。" else "未改用其他角色或语种。"}")
    if (offered.size > 100) offered.clear()
    return found.distinctBy { it.audioUrl }.take(5).map {
      offered[it.audioUrl] = Offered(it, now + 30 * 60 * 1000)
      it.asMap()
    }
  }

  fun downloadVoiceReference(audioUrl: String, sourceUrl: String): Map<String, Any> {
    NyvemiPublicVoicePolicy.validateUrl(audioUrl, true)
    NyvemiPublicVoicePolicy.validateUrl(sourceUrl, false)
    val selected = offered[audioUrl]
    require(selected != null && selected.expires >= SystemClock.elapsedRealtime() && selected.candidate.sourceUrl == sourceUrl) { "请重新查找后选择公开试听，不能下载未验证的地址" }
    val bytes = fetch(audioUrl, true, 8 * 1024 * 1024)
    val scratch = File.createTempFile("public-voice-", ".audio", context.cacheDir)
    try {
      scratch.writeBytes(bytes)
      val wav = decode(scratch)
      val directory = File(context.filesDir, "voice-public-previews").apply { mkdirs() }
      require(directory.isDirectory) { "无法保存试听" }
      // Bound cached public previews, not the user's applied reference store.
      directory.listFiles()?.filter { it.isFile && it.name.endsWith(".wav") }?.sortedByDescending { it.lastModified() }?.drop(19)?.forEach { it.delete() }
      val target = File(directory, UUID.randomUUID().toString() + ".wav")
      target.writeBytes(wav)
      return mapOf("uri" to android.net.Uri.fromFile(target).toString(), "sampleRate" to 22050, "usage" to "preview", "sourceUrl" to sourceUrl)
    } finally { scratch.delete() }
  }

  private fun fetch(initial: String, audio: Boolean, limit: Int): ByteArray {
    var current = initial
    repeat(3) {
      val uri = NyvemiPublicVoicePolicy.validateUrl(current, audio)
      val request = Request.Builder().url(uri.toASCIIString()).header("Accept", if (audio) "audio/*,application/ogg;q=0.9" else "text/html")
        .header("User-Agent", "Nyvemi/1.0 (public audio preview)").build()
      client.newCall(request).execute().use { response ->
        if (response.code in setOf(301, 302, 303, 307, 308)) {
          val destination = response.header("Location") ?: error("公开来源跳转无效")
          val next = uri.resolve(destination)
          NyvemiPublicVoicePolicy.validateUrl(next.toString(), audio)
          require(next.host == uri.host && next.path == uri.path) { "公开来源跳转到其他内容，未继续" }
          current = next.toString()
        } else {
          require(response.isSuccessful) { "公开来源暂不可用" }
          val body = response.body ?: error("公开来源返回空内容")
          require(body.contentLength() <= limit) { "公开内容超过大小限制" }
          val out = ByteArrayOutputStream()
          body.byteStream().use { stream ->
            val buffer = ByteArray(16384)
            while (true) { val n = stream.read(buffer); if (n < 0) break
              require(n <= limit - out.size()) { "公开内容超过大小限制" }; out.write(buffer, 0, n)
            }
          }
          require(out.size() > 0) { "公开来源返回空内容" }
          return out.toByteArray()
        }
      }
    }
    error("公开来源跳转次数过多")
  }

  private fun decode(file: File): ByteArray {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      FileInputStream(file).use { extractor.setDataSource(it.fd) }
      val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
        ?: error("公开文件不含音频")
      val format = extractor.getTrackFormat(track)
      val mime = format.getString(MediaFormat.KEY_MIME) ?: error("无法识别音频格式")
      require(mime in setOf("audio/mpeg", "audio/vorbis", "audio/opus", "audio/raw", "audio/mp4a-latm")) { "不支持此音频格式" }
      extractor.selectTrack(track)
      codec = MediaCodec.createDecoderByType(mime)
      format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
      codec.configure(format, null, null, 0); codec.start()
      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var encoding = AudioFormat.ENCODING_PCM_16BIT
      var inputEnded = false
      var outputEnded = false
      var size = 0
      val mono = FloatArray(48000 * 30)
      val info = MediaCodec.BufferInfo()
      val deadline = SystemClock.elapsedRealtime() + 30000
      while (!outputEnded) {
        check(SystemClock.elapsedRealtime() < deadline) { "音频解码超时" }
        require(rate in setOf(16000, 22050, 24000, 44100, 48000) && channels in 1..2) { "音频采样格式不受支持" }
        if (!inputEnded) {
          val index = codec.dequeueInputBuffer(10000)
          if (index >= 0) {
            val buffer = codec.getInputBuffer(index) ?: error("解码器输入不可用")
            val n = extractor.readSampleData(buffer, 0)
            if (n < 0 || extractor.sampleTime >= 30_000_000) {
              codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputEnded = true
            } else {
              codec.queueInputBuffer(index, 0, n, extractor.sampleTime, 0); extractor.advance()
            }
          }
        }
        when (val index = codec.dequeueOutputBuffer(info, 10000)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val next = codec.outputFormat
            val nextRate = next.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val nextChannels = next.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            require(size == 0 || (rate == nextRate && channels == nextChannels)) { "音频中途改变采样格式" }
            rate = nextRate; channels = nextChannels
            encoding = if (next.containsKey(MediaFormat.KEY_PCM_ENCODING)) next.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
          }
          else -> if (index >= 0) {
            try {
              val buffer = codec.getOutputBuffer(index) ?: error("解码器输出不可用")
              require(encoding == AudioFormat.ENCODING_PCM_16BIT || encoding == AudioFormat.ENCODING_PCM_FLOAT) { "解码输出格式不受支持" }
              val unit = if (encoding == AudioFormat.ENCODING_PCM_FLOAT) 4 else 2
              require(info.size % (unit * channels) == 0) { "解码帧不完整" }
              buffer.position(info.offset); buffer.limit(info.offset + info.size); buffer.order(ByteOrder.LITTLE_ENDIAN)
              while (buffer.remaining() >= unit * channels && size < rate * 30) {
                var sum = 0f
                repeat(channels) { sum += if (unit == 4) buffer.float else buffer.short / 32768f }
                val value = sum / channels
                require(value.isFinite()) { "音频包含无效采样" }
                mono[size++] = value.coerceIn(-1f, 1f)
              }
              outputEnded = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0 || size >= rate * 30
            } finally { codec.releaseOutputBuffer(index, false) }
          }
        }
      }
      require(size > 384) { "公开音频过短" }
      return AudioFrontend.wav(AudioFrontend.resample(mono.copyOf(size), rate))
    } finally {
      try { codec?.stop() } catch (_: Exception) { }
      codec?.release(); extractor.release()
    }
  }
}
