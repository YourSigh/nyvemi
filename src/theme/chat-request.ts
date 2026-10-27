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
    /衣服|裙子|裤子|头发|发色|头像|壁纸|手机壳|花朵|杯子|汽车|家具/.test(text) &&
    !/App|app|界面|主题|配色/.test(text)
  )
    return false;
  const explicit =
    /(?:换|改|调|设|变|恢复|切换).{0,30}(?:主题|配色|颜色|色调|粉|蓝|紫|绿|红|橙|白|黑|灰|黄|薄荷|暗一点|亮一点|深一点|浅一点|深色|浅色)/.test(
      text,
    ) ||
    /(?:主题|界面|背景|配色).{0,12}(?:调暗|调亮|柔和一点|淡一点)/.test(text) ||
    /(?:change|switch|make).{0,25}(?:theme|app colou?r|pink|blue|purple|dark|light)/i.test(text);
  if (explicit) return true;
  if (/(?:吗|么|\?|？)\s*$/.test(text)) return false;
  const color =
    /(?:粉|蓝|紫|绿|红|橙|白|黑|灰|黄|棕|青|杏|米|桃)[^，。！？,;；]{0,5}色|粉白|黑白灰|蓝灰|薄荷绿|\b(?:pink|blue|purple|green|red|orange|white|black|gray|grey|yellow|mint)\b/i;
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
