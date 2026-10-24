/** A model may interpret the preference only after an explicit request to change the interface. */
export function isThemeChangeRequest(input: string): boolean {
  const text = input.trim();
  if (
    /如果|假如|假设|举个例子|不要换|别换|不想换|不用换|不需要换|不要改|别改|不用改|不需要改/.test(
      text,
    )
  )
    return false;
  if (/[“「『"].*(?:换|改).*[”」』"]/.test(text)) return false;
  if (/衣服|裙子|头发|发色|头像|壁纸|手机壳/.test(text) && !/App|app|界面|主题|配色/.test(text))
    return false;
  return (
    /(?:换|改|调|设|变|恢复|切换).{0,30}(?:主题|配色|颜色|色调|粉|蓝|紫|绿|红|橙|白|黑|灰|黄|薄荷|暗一点|亮一点|深一点|浅一点|深色|浅色)/.test(
      text,
    ) ||
    /(?:主题|界面|背景|配色).{0,12}(?:调暗|调亮|柔和一点|淡一点)/.test(text) ||
    /(?:change|switch|make).{0,25}(?:theme|app colou?r|pink|blue|purple|dark|light)/i.test(text)
  );
}
