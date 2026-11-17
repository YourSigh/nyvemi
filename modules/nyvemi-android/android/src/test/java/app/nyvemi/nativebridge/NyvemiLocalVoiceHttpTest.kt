package app.nyvemi.nativebridge

import java.net.ServerSocket
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicBoolean
import java.net.InetSocketAddress
import java.net.URI
import java.nio.file.Files
import java.io.File
import java.security.MessageDigest
import java.util.Collections
import org.junit.Assert.*
import org.junit.Test

class NyvemiLocalVoiceHttpTest {
  @Test fun actualRangePauseResumeHashAndHostPolicy() {
    val data=ByteArray(1024*1024+123){(it%253).toByte()}
    val sha=MessageDigest.getInstance("SHA-256").digest(data).joinToString(""){"%02x".format(it.toInt() and 255)}
    val server=ServerSocket(0,16,InetAddress.getByName("127.0.0.1"))
    val running=AtomicBoolean(true)
    val requests=Collections.synchronizedList(mutableListOf<String>())
    val serving=Thread {
      while(running.get()) {
        try { server.accept().use { socket ->
          socket.soTimeout=3000
          val reader=socket.getInputStream().bufferedReader(Charsets.US_ASCII)
          reader.readLine()
          var range=""
          while(true){val line=reader.readLine() ?: break;if(line.isEmpty())break;if(line.startsWith("Range:",true))range=line.substringAfter(':').trim()}
          requests.add(range)
          val match=Regex("bytes=(\\d+)-(\\d+)").matchEntire(range)!!
          val first=match.groupValues[1].toInt();val last=match.groupValues[2].toInt()
          val header="HTTP/1.1 206 Partial Content\r\nContent-Range: bytes $first-$last/${data.size}\r\nContent-Length: ${last-first+1}\r\nConnection: close\r\n\r\n"
          socket.getOutputStream().use { out -> out.write(header.toByteArray(Charsets.US_ASCII));out.write(data,first,last-first+1) }
        }} catch(_:java.io.IOException) {}
      }
    }.apply { isDaemon=true;start() }
    val dir=Files.createTempDirectory("voice-real-range-").toFile();val part=File(dir,"model.part");val installed=File(dir,"installed-model");installed.writeText("known-good")
    val url=URI("http://127.0.0.1:${server.localPort}/model")
    fun engine()=NyvemiLocalVoiceTransfer(NyvemiLocalVoiceDownload.PinnedTransport(setOf("127.0.0.1"),true))
    fun progress(action:(Long)->Unit = {})=object:NyvemiLocalVoiceTransfer.Progress { override fun received(bytes:Long){action(bytes)}; override fun verifying(){} }
    try {
      val first=engine();assertFalse(first.download(part,url,data.size.toLong(),sha,progress{if(it>=131072)first.pause()}));val prefix=part.length()
      assertTrue(prefix in 131072 until data.size.toLong())
      assertTrue(engine().download(part,url,data.size.toLong(),sha,progress()))
      assertEquals("bytes=$prefix-${data.size-1}",requests[1]);assertArrayEquals(data,part.readBytes())
      try{engine().download(part,url,data.size.toLong(),"0".repeat(64),progress());fail("corrupt checksum accepted")}catch(_:java.io.IOException){}
      assertFalse(part.exists());assertEquals("known-good",installed.readText())
      val count=requests.size
      try{NyvemiLocalVoiceDownload.PinnedTransport(setOf("127.0.0.1")).open(url,0,9);fail("production HTTP permitted")}catch(_:IllegalArgumentException){}
      assertEquals(count,requests.size)
    } finally { running.set(false);server.close();serving.join(3000);dir.deleteRecursively() }
  }
}
