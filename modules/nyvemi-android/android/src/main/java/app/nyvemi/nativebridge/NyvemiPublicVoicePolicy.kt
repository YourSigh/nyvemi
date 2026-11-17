package app.nyvemi.nativebridge

import java.net.InetAddress
import java.net.URI
import java.net.URLEncoder
import java.security.MessageDigest

/** Narrow BWIKI policy. Public audio is always preview, never a grant to clone. */
internal object NyvemiPublicVoicePolicy {
  data class Page(val name: String, val game: String, val url: String)
  data class Candidate(val id: String, val label: String, val sourceUrl: String, val audioUrl: String) {
    fun asMap(): Map<String, Any> = mapOf("id" to id, "label" to label, "sourceUrl" to sourceUrl,
      "audioUrl" to audioUrl, "language" to "zh", "usage" to "preview")
  }
  private val aliases = mapOf("firefly" to "流萤", "nahida" to "纳西妲", "furina" to "芙宁娜", "keqing" to "刻晴", "kafka" to "卡芙卡", "march 7th" to "三月七")
  fun pages(query: String): List<Page> {
    var name = query.trim()
    require(name.length in 1..40 && name.none { it.code < 32 }) { "请输入准确的角色名称" }
    // Only strip one exact, anchored game prefix. Never search/replace inside a role name.
    val starRailPrefix = listOf("崩坏：星穹铁道", "崩坏:星穹铁道", "崩坏 星穹铁道", "崩坏星穹铁道", "星穹铁道", "崩铁", "星铁")
      .firstOrNull { name.startsWith(it) }
    val games = when {
      name.startsWith("原神") -> { name = name.removePrefix("原神").trim(' ', '：', ':'); listOf("ys") }
      starRailPrefix != null -> { name = name.removePrefix(starRailPrefix).trim(' ', '：', ':'); listOf("sr") }
      else -> listOf("sr", "ys")
    }
    name = aliases[name.lowercase()] ?: name
    require(Regex("[\\p{IsHan}·•]{1,32}").matches(name)) { "目前支持 BWIKI 原神/星铁的准确中文角色名" }
    return games.map { game ->
      val title = if (game == "sr") "$name/语音" else "${name}语音"
      Page(name, game, "https://wiki.biligame.com/$game/" + title.split('/').joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") })
    }
  }
  private val archiveNames = mapOf("流萤" to "Firefly", "卡芙卡" to "Kafka", "三月七" to "March_7th", "纳西妲" to "Nahida", "芙宁娜" to "Furina", "刻晴" to "Keqing")
  fun archiveFallback(page: Page): Candidate? {
    val english = archiveNames[page.name] ?: return null
    val game = mapOf("流萤" to "sr", "卡芙卡" to "sr", "三月七" to "sr", "纳西妲" to "ys", "芙宁娜" to "ys", "刻晴" to "ys")[page.name]
    if (page.game != game) return null
    val genshin = page.game == "ys"
    val file = if (genshin) "VO_ZH_${english}_Hello.ogg" else "VO_ZH_Archive_${english}_1.ogg"
    val hash = MessageDigest.getInstance("MD5").digest(file.toByteArray()).joinToString("") { "%02x".format(it) }
    val source = "https://${if (genshin) "genshin-impact" else "honkai-star-rail"}.fandom.com/wiki/File:$file"
    val audio = "https://static.wikia.nocookie.net/${if (genshin) "gensin-impact" else "houkai-star-rail"}/images/${hash[0]}/${hash.take(2)}/$file/revision/latest"
    return Candidate("archive-" + hash.take(16), "${page.name} · 中文初次见面 · Fandom", source, audio)
  }
  private fun archives() = archiveNames.keys.flatMap { pages(it).mapNotNull(::archiveFallback) }
  fun validateUrl(input: String, audio: Boolean): URI {
    require(input.length <= 2048 && input.none { it.isWhitespace() || it == '\\' || it.code < 32 }) { "公开音频地址无效" }
    val u = URI(input)
    require(u.scheme == "https" && u.rawUserInfo == null && u.port == -1 && u.rawQuery == null && u.rawFragment == null) { "只允许固定站点 HTTPS 公开地址" }
    if (u.host == "static.wikia.nocookie.net" || u.host == "honkai-star-rail.fandom.com" || u.host == "genshin-impact.fandom.com") {
      require(archives().any { if (audio) it.audioUrl == input else it.sourceUrl == input }) { "仅允许已知角色的确切中文公开文件" }
      return u
    }
    require(u.host == if (audio) "patchwiki.biligame.com" else "wiki.biligame.com") { "公开音频来源不受支持" }
    val pattern = if (audio) "/images/(sr|ys)/[0-9a-f]/[0-9a-f]{2}/[a-z0-9]{20,64}\\.mp3" else "/(sr/[\\p{IsHan}·•]{1,32}/语音|ys/[\\p{IsHan}·•]{1,32}语音)"
    require(Regex(pattern).matches(u.path)) { "公开音频地址格式变化，未猜测其他地址" }
    if (audio) { val parts = u.path.split('/'); require(parts[3][0] == parts[4][0]) }
    return u
  }
  fun publicAddress(a: InetAddress): Boolean {
    if (a.isAnyLocalAddress || a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress || a.isMulticastAddress) return false
    val b = a.address.map { it.toInt() and 255 }
    if (b.size == 16) return (b[0] and 0xe0) == 0x20 && !(b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8)
    if (b.size != 4) return false
    return !(b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224 ||
      (b[0] == 100 && b[1] in 64..127) || (b[0] == 169 && b[1] == 254) ||
      (b[0] == 172 && b[1] in 16..31) || (b[0] == 192 && (b[1] == 0 || b[1] == 168 || (b[1] == 88 && b[2] == 99))) ||
      (b[0] == 198 && (b[1] in 18..19 || (b[1] == 51 && b[2] == 100))) || (b[0] == 203 && b[1] == 0 && b[2] == 113))
  }
  private val opts = setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)
  private fun entities(s: String): String = Regex("&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);", RegexOption.IGNORE_CASE).replace(s) {
    val v = it.groupValues[1]
    if (v.startsWith("#")) {
      val n = if (v.startsWith("#x", true)) v.drop(2).toIntOrNull(16) else v.drop(1).toIntOrNull()
      if (n != null && n in 1..0x10ffff && n !in 0xd800..0xdfff) String(Character.toChars(n)) else "�"
    } else mapOf("amp" to "&", "quot" to "\"", "apos" to "'", "lt" to "<", "gt" to ">", "nbsp" to " ").getValue(v.lowercase())
  }
  private fun plain(s: String) = entities(s.replace(Regex("<[^>]*>"), "")).trim()
  private fun attr(s: String, name: String): String? {
    val matches = Regex("(?:^|\\s)$name\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", RegexOption.IGNORE_CASE).findAll(s).toList()
    if (matches.size != 1) return null
    return entities(matches[0].groupValues[1].ifEmpty { matches[0].groupValues[2] })
  }
  private fun cells(row: String, tag: String): List<String> {
    val cells = Regex("<$tag\\b([^>]*)>(.*?)</$tag\\s*>", opts).findAll(row).toList()
    if (cells.any { Regex("\\b(?:rowspan|colspan)\\s*=", RegexOption.IGNORE_CASE).containsMatchIn(it.groupValues[1]) }) return emptyList()
    return cells.map { it.groupValues[2] }
  }
  fun parse(page: Page, html: String): List<Candidate> {
    require(html.toByteArray(Charsets.UTF_8).size <= 3 * 1024 * 1024) { "公开页面过大" }
    val clean = html.replace(Regex("<!--.*?-->", opts), "").replace(Regex("<(script|style)\\b[^>]*>.*?</\\1\\s*>", opts), "")
    val heading = Regex("<h1\\b[^>]*>(.*?)</h1\\s*>", opts).find(clean)?.groupValues?.get(1)?.let(::plain)
    require(heading == if (page.game == "sr") "${page.name}/语音" else "${page.name}语音") { "页面角色名称不匹配，未使用其他角色录音" }
    val out = LinkedHashMap<String, Candidate>()
    for (table in Regex("<table\\b[^>]*>(.*?)</table\\s*>", opts).findAll(clean).take(1000)) {
      if (Regex("<table\\b", RegexOption.IGNORE_CASE).containsMatchIn(table.groupValues[1])) continue
      val rows = Regex("<tr\\b[^>]*>(.*?)</tr\\s*>", opts).findAll(table.groupValues[1]).map { it.groupValues[1] }.toList()
      for (i in 0 until rows.size - 1) {
        val labels = cells(rows[i], "th").map(::plain)
        if (labels.size != 4 || labels.toSet() != setOf("中", "日", "英", "韩")) continue
        val columns = cells(rows[i + 1], "td"); if (columns.size != 4) continue
        val players = Regex("<div\\b([^>]*)>", opts).findAll(columns[labels.indexOf("中")]).filter { attr(it.groupValues[1], "class")?.split(Regex("\\s+"))?.contains("bikit-audio") == true }.toList()
        if (players.size != 1) continue
        val audio = attr(players[0].groupValues[1], "data-src")?.takeIf { it.isNotBlank() } ?: continue
        val uri = validateUrl(audio, true); require(uri.path.startsWith("/images/${page.game}/"))
        val caption = if (i > 0) Regex("<th\\b[^>]*>(.*?)</th\\s*>", opts).find(rows[i - 1])?.groupValues?.get(1)?.let(::plain) else null
        if (caption != null && Regex("攻击|受击|战斗|终结技|战技|倒下|重伤|击破|胜利|死亡|冲刺").containsMatchIn(caption)) continue
        val label = "${page.name} · ${if (page.game == "sr") "星穹铁道" else "原神"} · ${caption?.take(40)?.takeIf { it.isNotBlank() } ?: "中文试听 ${out.size + 1}"}"
        val id = MessageDigest.getInstance("SHA-256").digest((page.url + "\n" + audio).toByteArray()).joinToString("") { "%02x".format(it) }.take(24)
        out[audio] = Candidate(id, label, page.url, audio)
        if (out.size >= 100) break
      }
    }
    return out.values.sortedBy { c -> when { c.label.contains("初次见面") -> 0; c.label.contains("问候") -> 1; c.label.contains("闲聊") || c.label.contains("聊天") -> 2; c.label.contains("关于自己") -> 3; else -> 4 } }.take(5)
  }
}
