package app.nyvemi.nativebridge
import org.junit.Assert.*
import org.junit.Test
class NyvemiSpeechPolicyTest {
  private fun v(id:String,network:Boolean=false,installed:Boolean=true,language:String="zh") = NyvemiSpeechPolicy.Candidate(id,language,network,installed,300)
  @Test fun neverChoosesNetworkMissingOrForeignVoices() {
    assertNull(NyvemiSpeechPolicy.choose(listOf(v("female-cloud",true),v("female-missing",installed=false),v("english",language="en")),"female-cloud",null))
  }
  @Test fun respectsAnOfflineSelectionThenPrefersGentleVoiceHintsWithoutClaimingGender() {
    val voices=listOf(v("default"),v("female-local"),v("chosen"))
    assertEquals("chosen",NyvemiSpeechPolicy.choose(voices,"chosen","default"))
    assertEquals("female-local",NyvemiSpeechPolicy.choose(voices,null,"default"))
    assertEquals("default",NyvemiSpeechPolicy.choose(listOf(v("default"),v("other")),null,"default"))
  }
}
