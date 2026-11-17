package app.nyvemi.nativebridge
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
class NyvemiPublicVoicePolicyTest {
 private val audio="https://patchwiki.biligame.com/images/sr/a/ab/abcdefghijklmnopqrst1234.mp3"
 private fun html(name:String="流萤",labels:String="<th>中</th><th>日</th><th>英</th><th>韩</th>",url:String=audio)="<h1>$name/语音<span></span></h1><table><tr><th colspan='4'>问候</th></tr><tr>$labels</tr><tr><td><div class='bikit-audio' data-src='$url'></div></td><td></td><td></td><td></td></tr></table>"
 @Test fun chineseExact() {
  val page=NyvemiPublicVoicePolicy.pages("流萤").first();val result=NyvemiPublicVoicePolicy.parse(page,html())
  assertEquals(1,result.size);assertEquals(audio,result[0].audioUrl);assertEquals("preview",result[0].asMap()["usage"]);assertTrue(result[0].label.contains("问候"))
  assertTrue(NyvemiPublicVoicePolicy.parse(page,html(labels="<th>日</th><th>中</th><th>英</th><th>韩</th>")).isEmpty())
  assertTrue(NyvemiPublicVoicePolicy.parse(page,html(url="")).isEmpty())
  assertThrows(IllegalArgumentException::class.java){NyvemiPublicVoicePolicy.parse(page,html("卡芙卡"))}
 }
 @Test fun restrictions() {
  for(bad in listOf(audio.replace("https:","http:"),audio+"?token=x",audio.replace("patchwiki.biligame.com","localhost"),audio.replace("/a/ab/","/c/ab/"),audio.replace("/sr/","/../")))
   assertThrows(IllegalArgumentException::class.java){NyvemiPublicVoicePolicy.validateUrl(bad,true)}
  for(ip in listOf("127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.1","169.254.1.1","100.64.0.1","198.18.0.1","203.0.113.1","::1","fc00::1","fe80::1","2001:db8::1"))assertFalse(ip,NyvemiPublicVoicePolicy.publicAddress(InetAddress.getByName(ip)))
  assertTrue(NyvemiPublicVoicePolicy.publicAddress(InetAddress.getByName("1.1.1.1")))
 }
 @Test fun exactQuery() {
  assertEquals("纳西妲",NyvemiPublicVoicePolicy.pages("nahida").first().name)
  assertEquals(listOf("ys"),NyvemiPublicVoicePolicy.pages("原神 纳西妲").map{it.game})
  for(q in listOf("https://example.com","notfirefly","流萤/../../",""))assertThrows(IllegalArgumentException::class.java){NyvemiPublicVoicePolicy.pages(q)}
 }
 @Test fun liveCapturedFixturesWhenProvided() {
  val root=System.getenv("NYVEMI_BWIKI_FIXTURES") ?: return
  val firefly=NyvemiPublicVoicePolicy.parse(NyvemiPublicVoicePolicy.pages("流萤").first(),java.io.File(root,"bwiki-firefly.html").readText())
  assertTrue(firefly.isEmpty())
  val kafka=NyvemiPublicVoicePolicy.parse(NyvemiPublicVoicePolicy.pages("卡芙卡").first(),java.io.File(root,"bwiki-kafka.html").readText())
  assertEquals(5,kafka.size)
  kafka.forEach{println("CANDIDATE ${it.id} ${it.label} ${it.audioUrl} ${it.sourceUrl}")}
 }
 @Test fun exactChineseArchiveFallback() {
  for(name in listOf("流萤","卡芙卡","三月七")) assertNull(NyvemiPublicVoicePolicy.archiveFallback(NyvemiPublicVoicePolicy.pages(name).first { it.game == "ys" }))
  for(name in listOf("纳西妲","芙宁娜","刻晴")) assertNull(NyvemiPublicVoicePolicy.archiveFallback(NyvemiPublicVoicePolicy.pages(name).first { it.game == "sr" }))
  val c=NyvemiPublicVoicePolicy.archiveFallback(NyvemiPublicVoicePolicy.pages("流萤").first())!!
  assertEquals("https://static.wikia.nocookie.net/houkai-star-rail/images/5/57/VO_ZH_Archive_Firefly_1.ogg/revision/latest",c.audioUrl)
  NyvemiPublicVoicePolicy.validateUrl(c.audioUrl,true);NyvemiPublicVoicePolicy.validateUrl(c.sourceUrl,false)
  assertThrows(IllegalArgumentException::class.java){NyvemiPublicVoicePolicy.validateUrl(c.audioUrl.replace("VO_ZH_","VO_JP_"),true)}
  assertThrows(IllegalArgumentException::class.java){NyvemiPublicVoicePolicy.validateUrl(c.audioUrl.replace("Firefly","Kafka"),true)}
 }
}
