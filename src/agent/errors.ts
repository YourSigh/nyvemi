/** Separate user-facing errors from redacted developer detail; never show DSH internals. */
export function agentFailure(error: unknown) {
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const root = object(error),
    reason = object(root.reason),
    cause = object(root.cause),
    failure = object(reason.error);
  const messages = [root.message, cause.message, failure.message].filter(
    (s): s is string => typeof s === 'string',
  );
  const detail = messages.join('\n').slice(0, 1200),
    status = Number(detail.match(/HTTP\s+(\d{3})/)?.[1]);
  let code = 'agent_runtime_error',
    message = '这轮聊天没能完成，请重试；详细原因已记录在开发者模式';
  if (reason.kind === 'aborted' || /DSH canceled|已取消/.test(detail)) {
    code = 'canceled';
    message = '这轮已取消，可以重新发送';
  } else if (/timed out|超时/.test(detail)) {
    code = 'timeout';
    message = '模型响应超时，请稍后重试';
  } else if (/step budget/.test(detail)) {
    code = 'step_limit';
    message = '这次处理步骤过多，请简化要求后重试';
  } else if (reason.kind === 'max-tokens') {
    code = 'output_limit';
    message = '模型输出过长被截断，请缩短这次要求后重试';
  } else if (status === 401 || status === 403) {
    code = 'provider_auth';
    message = `模型鉴权失败（HTTP ${status}），请检查当前服务的Key和权限`;
  } else if (status === 402) {
    code = 'provider_credit';
    message = '模型额度不足（HTTP 402），请检查服务商额度';
  } else if (status === 429) {
    code = 'provider_limit';
    message = '模型服务限流（HTTP 429），请稍后重试或检查额度限制';
  } else if (status === 400 || status === 422) {
    code = 'provider_request';
    message = `模型拒绝本次请求（HTTP ${status}），请检查模型与兼容接口配置`;
  } else if (status === 404) {
    code = 'provider_model';
    message = '模型或接口地址不可用（HTTP 404），请检查模型设置';
  } else if (status >= 500 && status <= 599) {
    code = 'provider_unavailable';
    message = `模型服务暂不可用（HTTP ${status}），请稍后重试`;
  } else if (/模型连接|响应解析/.test(detail)) {
    code = 'provider_connection';
    message = '模型连接或响应解析失败，请检查网络与模型设置';
  } else if (/is not a function|not defined/.test(detail)) {
    code = 'runtime_compatibility';
    message = '聊天运行时遇到兼容错误，详细原因已记录在开发者模式';
  } else if (
    /^(请先|当前 Provider|角色不存在|角色已清空|当前不能来信|约定尚未履行)/.test(messages[0] ?? '')
  ) {
    message = messages[0];
  }
  return { code, message, detail, kind: typeof reason.kind === 'string' ? reason.kind : undefined };
}
