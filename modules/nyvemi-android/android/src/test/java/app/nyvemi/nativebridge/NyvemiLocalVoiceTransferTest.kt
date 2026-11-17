package app.nyvemi.nativebridge

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.nio.file.Files

class NyvemiLocalVoiceTransferTest {
  private val url = URI("https://modelscope.cn/test-only-not-requested")
  private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
  private class Fake(private val data: ByteArray, val mode: String = "ok") : NyvemiLocalVoiceTransfer.Transport {
    val ranges = mutableListOf<Pair<Long,Long>>()
    override fun cancel() {}
    override fun open(url: URI,start: Long,end: Long): NyvemiLocalVoiceTransfer.Response {
      ranges.add(start to end)
      val count=(end-start+1).toInt()
      val content=data.copyOfRange(start.toInt(),end.toInt()+1)
      return NyvemiLocalVoiceTransfer.Response(if(mode=="status")200 else 206,
        "bytes ${if(mode=="range")start+1 else start}-$end/${data.size}",
        "${if(mode=="length")count+1 else count}",if(mode=="encoding")"gzip" else null,
        ByteArrayInputStream(if(mode=="truncated")content.copyOf(count-1) else if(mode=="extra")content+byteArrayOf(0) else content))
    }
  }
  private fun progress(onBytes:(Long)->Unit = {}) = object:NyvemiLocalVoiceTransfer.Progress {
    override fun received(bytes:Long) { onBytes(bytes) }
    override fun verifying() {}
  }
  private fun scoped(run:(File)->Unit) { val dir=Files.createTempDirectory("voice-transfer-").toFile();try{run(File(dir,"model.part"))}finally{dir.deleteRecursively()} }
  @Test fun pauseResumeChunksAndChecksum() = scoped { part ->
    val data=ByteArray(32*1024*1024+123) { (it%251).toByte() }
    val firstTransport=Fake(data);val first=NyvemiLocalVoiceTransfer(firstTransport)
    assertFalse(first.download(part,url,data.size.toLong(),sha(data),progress { if(it>=131072)first.pause() }))
    val prefix=part.length();assertTrue(prefix in 131072 until data.size.toLong())
    val secondTransport=Fake(data);val second=NyvemiLocalVoiceTransfer(secondTransport)
    assertTrue(second.download(part,url,data.size.toLong(),sha(data),progress()))
    assertEquals(prefix,secondTransport.ranges.first().first);assertArrayEquals(data,part.readBytes())
    assertTrue(secondTransport.ranges.all { it.second-it.first+1 <= 32L*1024*1024 })
    val calls=secondTransport.ranges.size
    assertTrue(second.download(part,url,data.size.toLong(),sha(data),progress()));assertEquals(calls,secondTransport.ranges.size)
  }
  @Test fun corruptFinalHashDeletesPartial() = scoped { part ->
    val data=ByteArray(1024){1};val transfer=NyvemiLocalVoiceTransfer(Fake(data))
    try{transfer.download(part,url,1024,"0".repeat(64),progress());fail("corruption accepted")}catch(_:java.io.IOException){}
    assertFalse(part.exists())
  }
  @Test fun invalidResponsesKeepTrustedPrefix() {
    for(mode in listOf("range","length","status","encoding","truncated","extra")) scoped { part ->
      val data=ByteArray(1024){1};part.writeBytes(data.copyOf(3))
      try{NyvemiLocalVoiceTransfer(Fake(data,mode)).download(part,url,1024,sha(data),progress());fail(mode)}catch(_:Exception){}
      assertEquals(mode,3L,part.length())
    }
  }
  @Test fun oversizedLocalFileRejected() = scoped { part ->
    part.writeBytes(ByteArray(12));val fake=Fake(ByteArray(10))
    try{NyvemiLocalVoiceTransfer(fake).download(part,url,10,sha(ByteArray(10)),progress());fail()}catch(_:java.io.IOException){}
    assertFalse(part.exists());assertTrue(fake.ranges.isEmpty())
  }
  @Test fun pauseDuringVerificationPreservesAllBytes() = scoped { part ->
    val data=ByteArray(1024){3};val transfer=NyvemiLocalVoiceTransfer(Fake(data))
    assertFalse(transfer.download(part,url,1024,sha(data),object:NyvemiLocalVoiceTransfer.Progress{
      override fun received(bytes:Long){}
      override fun verifying(){transfer.pause()}
    }))
    assertArrayEquals(data,part.readBytes())
  }
}
