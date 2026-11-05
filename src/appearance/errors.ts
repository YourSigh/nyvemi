/** Safe provider diagnostics. Raw bodies, prompts, image data and headers are never retained. */
export interface ImageRequestFailure {
  httpStatus: number;
  code?: string;
  parameter?: string;
  imageReason?: 'format' | 'decode' | 'dimensions' | 'size' | 'fetch' | 'reference_count';
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
  // Classify known image rejection reasons; never store or display an arbitrary server message.
  const message = typeof error.message === 'string' ? error.message.slice(0, 4000) : '';
  const imageReason: ImageRequestFailure['imageReason'] =
    parameter !== 'image'
      ? undefined
      : /unsupported.*format|format.*(?:invalid|not support)|图片格式|图像格式/i.test(message)
        ? 'format'
        : /decod|base64|corrupt|解码|编码/i.test(message)
          ? 'decode'
          : /dimension|resolution|aspect|pixel|宽高|像素|分辨率/i.test(message)
            ? 'dimensions'
            : /too large|file size|image size|megabyte|\bMB\b|文件大小|图片大小/i.test(message)
              ? 'size'
              : /download|fetch|image.*url|下载|无法访问/i.test(message)
                ? 'fetch'
                : /single image|multiple images|only one|单张|多张/i.test(message)
                  ? 'reference_count'
                  : undefined;
  return {
    httpStatus: response.status,
    code,
    parameter,
    requestId,
    category,
    ...(imageReason ? { imageReason } : {}),
  };
}
export class ImageProviderError extends Error {
  constructor(readonly failure: ImageRequestFailure) {
    const reviewHint = failure.code?.startsWith('InputImage')
      ? '参考图未通过服务商审核，请更换参考图后重试'
      : failure.code?.startsWith('OutputImage')
        ? '本次生成结果未通过服务商审核，已暂停；这不等于你的描述或参考图违规'
        : failure.code?.startsWith('InputText')
          ? '绘图文字未通过服务商审核，请检查并调整描述'
          : '服务商内容审核未通过，已暂停；请展开错误详情查看拒绝环节';
    const hint: Record<ImageRequestFailure['category'], string> = {
      configuration: '模型尚未开通，请先在火山方舟控制台开通此模型',
      credentials: '密钥校验失败，请检查豆包 API Key',
      quota: '服务额度不可用，请查看火山方舟账户状态',
      content_review: reviewHint,
      rate_limit: '请求过于频繁，请稍后手动重试',
      parameters:
        failure.parameter === 'image'
          ? `服务商未接受这张图片${failure.imageReason ? `（${{ format: '格式', decode: '编码', dimensions: '尺寸', size: '文件大小', fetch: '下载失败', reference_count: '图片数量' }[failure.imageReason]}）` : ''}，当前成果已保留`
          : `请求参数不被接受${failure.parameter ? `（${failure.parameter}）` : ''}，请展开错误详情`,
      service: '服务暂不可用，结果可能不确定，请先核对服务商记录',
      unknown: '请查看开发者模式中的错误码和请求编号，或火山方舟调用记录',
    };
    super(`生图接口返回 HTTP ${failure.httpStatus}：${hint[failure.category]}`);
    this.name = 'ImageProviderError';
  }
}
