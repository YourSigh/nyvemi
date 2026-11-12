import type { Message } from '../domain/models';

export function wantsVoiceSettings(text: string) {
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
