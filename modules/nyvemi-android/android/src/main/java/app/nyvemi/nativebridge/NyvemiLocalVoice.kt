package app.nyvemi.nativebridge

import android.content.Context
import android.net.Uri
import app.nyvemi.openvoice.AudioFrontend
import app.nyvemi.openvoice.OpenVoicePipeline
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import java.util.zip.ZipInputStream

/** Opt-in, offline converter. Only this audited, self-exported official model pack is accepted. */
class NyvemiLocalVoice {
  companion object {
    private val hashes = mapOf(
      "tone_encoder.onnx" to "64bd5e39bc92b1265e35eeb73e9e30558de6c54f15c176bff6f9b7543a0a2c91",
      "tone_converter.onnx" to "19ced6f4232d212e21ebd8562bd10eae7b5731610587dcdb691c1cedcf2f7507"
    )
    private const val MAX_PACK = 140L * 1024 * 1024
    private const val MAX_WAV = 3L * 1024 * 1024
  }
  private val lock = Any()
  private val epoch = AtomicLong(0)
  @Volatile private var pipeline: OpenVoicePipeline? = null
  private fun prefs(ctx: Context) = ctx.getSharedPreferences("local-openvoice", Context.MODE_PRIVATE)
  private fun dir(ctx: Context) = File(ctx.filesDir, "local-openvoice-v1")
  private fun installed(ctx: Context) = hashes.keys.all { File(dir(ctx), it).isFile }
  fun state(ctx: Context): Map<String, Any> = mapOf(
    "available" to installed(ctx), "enabled" to prefs(ctx).getBoolean("enabled", false),
    "detail" to if (installed(ctx)) "本机 OpenVoice V2 实验版 · CPU · 不上传参考音频" else "未导入经过校验的本地 OpenVoice V2 模型包"
  )
  fun setEnabled(ctx: Context, enabled: Boolean): Map<String, Any> {
    if (enabled && !installed(ctx)) throw IllegalStateException("请先导入本地模型包")
    cancel()
    prefs(ctx).edit().putBoolean("enabled", enabled).apply()
    return state(ctx)
  }
  fun cancel() { epoch.incrementAndGet(); pipeline?.cancel() }
  fun release() { cancel(); synchronized(lock) { pipeline?.close(); pipeline = null } }
  private fun digest(file: File): String {
    val sha = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val bytes=ByteArray(65536); while (true) { val n=input.read(bytes); if(n<0) break; sha.update(bytes,0,n) } }
    return sha.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
  }
  fun importPack(ctx: Context, value: String): Map<String, Any> {
    val uri=Uri.parse(value)
    require(uri.scheme=="content" || uri.scheme=="file") { "请选择本地模型 ZIP" }
    cancel()
    synchronized(lock) {
      val stage=File(ctx.filesDir,"local-openvoice-stage-${UUID.randomUUID()}")
      check(stage.mkdir())
      try {
        var total=0L
        val seen=mutableSetOf<String>()
        val input=ctx.contentResolver.openInputStream(uri) ?: throw IllegalArgumentException("模型包无法读取")
        ZipInputStream(input.buffered()).use { zip ->
          while (true) {
            val e=zip.nextEntry ?: break
            require(!e.isDirectory && hashes.containsKey(e.name) && seen.add(e.name)) { "模型包内容不受支持" }
            val out=File(stage,e.name)
            out.outputStream().use { output ->
              val buffer=ByteArray(65536)
              while(true) { val n=zip.read(buffer); if(n<0) break; total+=n; require(total<=MAX_PACK) { "模型包过大" }; output.write(buffer,0,n) }
            }
            require(digest(out)==hashes[e.name]) { "模型文件校验失败；仅接受已验证的官方权重导出包" }
          }
        }
        require(seen==hashes.keys) { "模型包不完整" }
        // Check actual runtime loading before replacing an existing working pack.
        OpenVoicePipeline(File(stage,"tone_encoder.onnx"),File(stage,"tone_converter.onnx")).close()
        pipeline?.close(); pipeline=null
        val previous=File(ctx.filesDir,"local-openvoice-old-${UUID.randomUUID()}")
        val current=dir(ctx)
        if(current.exists()) check(current.renameTo(previous))
        if(!stage.renameTo(current)) { previous.renameTo(current); error("模型包保存失败") }
        previous.deleteRecursively()
        // Import does not opt the user in; explicit switch is required.
        return state(ctx)
      } finally { stage.deleteRecursively() }
    }
  }
  private fun privateWav(ctx: Context, value: String): ByteArray {
    val uri=Uri.parse(value)
    require(uri.scheme=="file") { "只接受应用内的本地 WAV" }
    val f=File(uri.path ?: "").canonicalFile
    require(listOf(ctx.filesDir,ctx.cacheDir).any { f.path.startsWith(it.canonicalPath+File.separator) }) { "录音必须保存在应用内" }
    require(f.isFile && f.length() in 44..MAX_WAV) { "录音过大或无效" }
    return f.readBytes()
  }
  fun convert(ctx: Context, sourceUri: String, referenceUri: String): String {
    val generation=epoch.get()
    fun active() { check(epoch.get()==generation && prefs(ctx).getBoolean("enabled",false)) { "本地换声已取消" } }
    synchronized(lock) {
      active(); check(installed(ctx)) { "本地模型不可用" }
      val source=AudioFrontend.readWav(privateWav(ctx,sourceUri))
      val reference=AudioFrontend.readWav(privateWav(ctx,referenceUri))
      require(source.samples.size.toLong()<=source.rate.toLong()*10) { "本地换声单段不能超过 10 秒" }
      val samples=AudioFrontend.resample(source.samples,source.rate)
      val ref=AudioFrontend.resample(reference.samples,reference.rate)
      active()
      val engine=pipeline ?: OpenVoicePipeline(File(dir(ctx),"tone_encoder.onnx"),File(dir(ctx),"tone_converter.onnx")).also { pipeline=it }
      active()
      val output=engine.convert(samples,ref,SecureRandom().nextLong())
      active()
      val wav=AudioFrontend.wav(output)
      val file=File(ctx.cacheDir,"openvoice-${UUID.randomUUID()}.wav")
      try { file.writeBytes(wav); active(); return Uri.fromFile(file).toString() }
      catch(e:Exception) { file.delete(); throw e }
    }
  }
}
