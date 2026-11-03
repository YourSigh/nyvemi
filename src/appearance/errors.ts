/** Safe provider diagnostics. Raw bodies, prompts, image data and headers are never retained. */
export interface ImageRequestFailure {
  httpStatus: number;
  code?: string;
  parameter?: string;
  requestId?: string;
  category:
    | 'configuration'
    | 'credentials'
    | 'quota'
    | 'content_review'
    | 'rate_limit'
    | 'parameters'
    | 'service'
    | 'unknown';
}
const parameters = new Set([
  'model',
  'size',
  'image',
  'prompt',
  'layer_decomposition',
  'response_format',
  'watermark',
]);
const token = (value: unknown, secret: string): string | undefined =>
  typeof value === 'string' &&
  value.length <= 128 &&
  /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) &&
  (!secret || !value.includes(secret))
    ? value
    : undefined;
export async function readImageFailure(
  response: Response,
  secret: string,
): Promise<ImageRequestFailure> {
  const raw: unknown = await response.json().catch(() => undefined);
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const error =
    root.error && typeof root.error === 'object' ? (root.error as Record<string, unknown>) : {};
  const code = token(error.code, secret);
  const parameter =
    typeof error.param === 'string' &&
    parameters.has(error.param) &&
    (!secret || !error.param.includes(secret))
      ? error.param
      : undefined;
  const messageId =
    typeof error.message === 'string'
      ? /Request[\s_-]*ID[:：=\s]+([A-Za-z0-9][A-Za-z0-9_.-]{7,127})/i.exec(error.message)?.[1]
      : undefined;
  const requestId = [
    response.headers.get('x-request-id'),
    response.headers.get('x-tt-logid'),
    root.request_id,
    error.request_id,
    messageId,
  ]
    .map((value) => token(value, secret))
    .find(Boolean);
  const category: ImageRequestFailure['category'] =
    code === 'ModelNotOpen' || code?.startsWith('OperationDenied.ServiceNotOpen')
      ? 'configuration'
      : response.status === 401 || code?.startsWith('Authentication')
        ? 'credentials'
        : code?.startsWith('OperationDenied.ServiceOverdue') ||
            code?.includes('InsufficientBalance')
          ? 'quota'
          : code && /SensitiveContentDetected|(?:Input|Output)ImageRiskDetection/.test(code)
            ? 'content_review'
            : response.status === 429
              ? 'rate_limit'
              : code &&
                  /^(?:InvalidParameter|MissingParameter|InvalidImageURL|InvalidArgument)/.test(
                    code,
                  )
                ? 'parameters'
                : response.status >= 500
                  ? 'service'
                  : 'unknown';
  return { httpStatus: response.status, code, parameter, requestId, category };
}
export class ImageProviderError extends Error {
  constructor(readonly failure: ImageRequestFailure) {
    const hint: Record<ImageRequestFailure['category'], string> = {
      configuration: '模型尚未开通，请先在火山方舟控制台开通此模型',
      credentials: '密钥校验失败，请检查豆包 API Key',
      quota: '服务额度不可用，请查看火山方舟账户状态',
      content_review: '服务商内容审核未通过，请查看控制台记录或更换内容',
      rate_limit: '请求过于频繁，请稍后手动重试',
      parameters: `请求参数不被接受${failure.parameter ? `（${failure.parameter}）` : ''}，请查看开发者模式中的错误码和请求编号`,
      service: '服务暂不可用，结果可能不确定，请先核对服务商记录',
      unknown: '请查看开发者模式中的错误码和请求编号，或火山方舟调用记录',
    };
    super(`生图接口返回 HTTP ${failure.httpStatus}：${hint[failure.category]}`);
    this.name = 'ImageProviderError';
  }
}
