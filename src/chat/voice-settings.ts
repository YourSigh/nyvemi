import type { Message } from '../domain/models';

export function requestedVoiceReference(text: string): string | undefined {
  const request = text.trim().replace(/\s+/g, ' ');
  if (
    request.length > 120 ||
    /(?:别|不要|不用|不想|不是|不像|假如|比如|举例|能否|能不能)/u.test(request)
  )
    return undefined;
  if (/我的(?:音色|声线|声音)/u.test(request) && !/你的(?:音色|声线|声音)/u.test(request))
    return undefined;
  const rules = [
    /^(?:(?:我想要|我希望|希望|请|以后|从今以后|想要)[，、：:\s]*)*(?:把)?你(?:的)?(?:说话的)?(?:音色|声线|声音)[\s]*(?:跟|像|和|模仿)\s*(.+?)(?:这样|一样|相似)[。！!\s]*$/u,
    /^(?:(?:请|帮我|以后|我希望|想让)[，、：:\s]*)*(?:把)?你(?:的)?(?:音色|声线|声音)[\s]*(?:换成|改成|设成)\s*(.+?)(?:的(?:音色|声线|声音))?[。！!\s]*$/u,
    /^(?:(?:请|以后|我希望你|让你|你就)[，、：:\s]*)*用\s*(.+?)的(?:音色|声线|声音)(?:说话|回复|跟我聊天)[。！!\s]*$/u,
  ];
  for (const rule of rules) {
    const role = rule
      .exec(request)?.[1]
      ?.trim()
      .replace(/^[「“"《]+|[」”"》]+$/g, '');
    if (
      role &&
      /^[\p{L}\p{N}·・ _：:\-—]{1,40}$/u.test(role) &&
      !/^(?:更|有点|原来|平时|以前|我|你|她|他|它|温柔|甜美|可爱|低沉|清亮|成熟|好听|正常|自然|以前一样)/u.test(
        role,
      )
    )
      return role;
  }
  return undefined;
}

export function wantsVoiceSettings(text: string) {
  if (requestedVoiceReference(text)) return true;
  const request = text.trim().replace(/\s+/g, ' ');
  if (
    request.length > 120 ||
    (/我的(?:音色|声线|声音)/.test(request) && !/你的(?:音色|声线|声音)/.test(request)) ||
    /(?:别|不用|不要|不想|没想)(?:再)?(?:换|改|调|下载|安装)/.test(request)
  )
    return false;
  return (
    /(?:换|改|调|设置|自定义)(?:个|一下|一换|一改|一调)?(?:你(?:的)?|个新的|种|个别的)?(?:说话的)?(?:音色|声线|声音|语音模型)/i.test(
      request,
    ) ||
    /(?:音色|声线|声音|语音模型).{0,10}(?:怎么换|怎么调|能否换|能不能换|可以换|换一下|改一下|调一下)/.test(
      request,
    ) ||
    /(?:下载|安装|试试).{0,12}(?:离线语音|本地语音|语音模型|语音包|Qwen)/i.test(request) ||
    /\b(?:change|adjust|switch|customize|tune)\s+(?:(?:your|the|a different|another)\s+)?voice\b/i.test(
      request,
    )
  );
}

export function voiceSettingsMessage(user: Message, content = '可以在这里换我的声音。'): Message {
  return {
    id: `${user.id}:voice-settings`,
    characterId: user.characterId,
    role: 'assistant',
    content,
    origin: 'chat',
    status: 'complete',
    groupId: user.id,
    voiceSettings: true,
    createdAt: Math.max(Date.now(), user.createdAt + 1),
  };
}
