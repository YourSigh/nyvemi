export type CompanionActivity =
  | 'checking'
  | 'remembering'
  | 'experiencing'
  | 'considering'
  | 'writing'
  | 'sent';
export const activityText: Record<CompanionActivity, string> = {
  checking: '正在看看有没有值得记住和分享的小事',
  remembering: '正在整理刚才聊过的事',
  experiencing: '正在读一点感兴趣的内容',
  considering: '正在想这件事值不值得打扰你',
  writing: '想起你了，正在写一条消息',
  sent: '刚给你留了一条消息',
};
export class ActivityMonitor {
  private listeners = new Set<(activity: CompanionActivity, characterId?: string) => void>();
  report(activity: CompanionActivity, characterId?: string): void {
    for (const listener of this.listeners) listener(activity, characterId);
  }
  subscribe(listener: (activity: CompanionActivity, characterId?: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
