/** Local intent gate; the theme provider still validates the semantic preference. */
export function isThemeChangeRequest(input: string): boolean {
  const text = input.trim();
  if (
    /如果|假如|假设|举个例子|不要换|别换|不想换|不用换|不需要换|不要改|别改|不用改|不需要改/.test(
      text,
    )
  )
    return false;
  if (/[“「『"].*(?:换|改|喜欢|偏爱).*[”」』"]/.test(text)) return false;
  if (
    /(?:解释|分析|看看|说说|评价).{0,30}(?:颜色|配色|色调|渐变|主题)/.test(text) ||
    /^(?:what|why|when|where|how)\b/i.test(text)
  )
    return false;
  if (
    /衣服|裙子|裤子|头发|发色|头像|壁纸|手机壳|花朵|杯子|汽车|家具/.test(text) &&
    !/\bapp\b|界面|主题|聊天背景|页面背景/.test(text.toLowerCase())
  )
    return false;
  const explicit =
    /(?:换|改|调|设|变|恢复|切换).{0,30}(?:主题|配色|颜色|色调|渐变|纯色|单色|粉|蓝|紫|绿|红|橙|白|黑|灰|黄|薄荷|暗一点|亮一点|深一点|浅一点|深色|浅色)/.test(
      text,
    ) ||
    /(?:关掉|取消|去掉).{0,6}渐变|(?:渐变).{0,6}(?:关掉|取消|去掉)/.test(text) ||
    /(?:主题|界面|背景|配色|\bapp\b).{0,12}(?:调暗|调亮|柔和一点|淡一点|做成|换成|改成|用成)/i.test(
      text,
    ) ||
    /(?:我(?:想)?要|我想用|我想试|给我|能用|可以用|^(?:想要|想用|想试|来个)).{0,35}(?:的颜色|那(?:种|样的)颜色|配色|主题|渐变)(?:吧|呀|吗|么|呢|[。！？?，,]|\s|$)/.test(
      text,
    ) ||
    /(?:我想让|我希望|能不能让).{0,8}(?:主题|界面|聊天背景|配色).{0,6}(?:像|参考)/.test(text) ||
    /\b(?:change|switch|make|i(?:'d| would) like|can (?:we|you))\b.{0,35}\b(?:theme|app colou?r|palette|gradient|pink|blue|purple|dark|light)\b/i.test(
      text,
    );
  if (explicit) return true;
  if (/(?:吗|么|\?|？)\s*$/.test(text)) return false;
  const color =
    /(?:粉|蓝|紫|绿|红|橙|白|黑|灰|黄|棕|青|杏|米|桃)[^，。！？,;；]{0,5}色|粉白|黑白灰|蓝灰|薄荷绿|渐变|的配色|\b(?:pink|blue|purple|green|red|orange|white|black|gray|grey|yellow|mint|gradient)\b/i;
  return text.split(/[，。！？,;；]/).some((clause) => {
    if (
      /不喜欢|不爱|讨厌|不想|(?:他|她|朋友|别人).{0,5}(?:喜欢|偏爱)|你.{0,5}(?:喜欢|偏爱)/.test(
        clause,
      )
    )
      return false;
    return (
      color.test(clause) &&
      (/(?:我|自己|个人).{0,6}(?:喜欢|偏爱|钟意|想要|想用|想试)/.test(clause) ||
        /^(?:比较|更|最|挺|还是)?(?:喜欢|偏爱|钟意|想要|想用|想试)/.test(clause.trim()) ||
        /(?:还是|感觉|觉得).*(?:更|挺|很|比较)?(?:好看|舒服|合适)/.test(clause) ||
        /(?:色|粉白|蓝灰).*(?:好看|舒服|合适|不错)/.test(clause) ||
        /\bi\s+(?:like|love|prefer)\b/i.test(clause))
    );
  });
}
