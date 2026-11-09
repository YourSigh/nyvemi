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
    message = '暂时没能回复，请重试';
  if (reason.kind === 'aborted' || /DSH canceled|已取消/.test(detail)) {
    code = 'canceled';
    message = '这轮已取消，可以重新发送';
  } else if (/timed out|超时/.test(detail)) {
    code = 'timeout';
    message = '模型响应超时，请稍后重试';
  } else if (/step budget/.test(detail)) {
    code = 'step_limit';
    message = '这次没能处理完，试着分开说';
  } else if (reason.kind === 'max-tokens') {
    code = 'output_limit';
    message = '回复太长，试着分开问';
  } else if (status === 401 || status === 403) {
    code = 'provider_auth';
    message = '请在聊天模型设置里检查密钥和权限';
  } else if (status === 402) {
    code = 'provider_credit';
    message = '请检查模型服务的可用额度';
  } else if (status === 429) {
    code = 'provider_limit';
    message = '请求太频繁，请稍后重试';
  } else if (status === 400 || status === 422) {
    code = 'provider_request';
    message = '模型无法处理这次请求，请检查聊天模型设置';
  } else if (status === 404) {
    code = 'provider_model';
    message = '当前模型不可用，请检查聊天模型设置';
  } else if (status >= 500 && status <= 599) {
    code = 'provider_unavailable';
    message = '模型暂不可用，请稍后重试';
  } else if (/模型连接|响应解析/.test(detail)) {
    code = 'provider_connection';
    message = '连接失败，请检查网络和聊天模型设置';
  } else if (/is not a function|not defined/.test(detail)) {
    code = 'runtime_compatibility';
    message = '暂时没能回复，请重试';
  } else if (
    /^(请先|当前 Provider|角色不存在|角色已清空|当前不能来信|约定尚未履行)/.test(messages[0] ?? '')
  ) {
    message = messages[0];
  }
  return { code, message, detail, kind: typeof reason.kind === 'string' ? reason.kind : undefined };
}
