export type GeminiFunctionIdRectifierTrigger = "unknown_function_id_field";

export type GeminiFunctionIdRectifierResult = {
  applied: boolean;
  strippedFunctionCallIds: number;
  strippedFunctionResponseIds: number;
};

/**
 * 检测是否需要触发「Gemini function id 整流器」
 *
 * 背景：Gemini Dev API（generativelanguage）协议允许 functionCall/functionResponse 携带
 * 可选 `id` 字段，gemini-cli 等客户端会主动填充；而 Vertex AI（aiplatform）的 proto
 * 严格校验不认识该字段，直接拒绝：
 * - `Invalid JSON payload received. Unknown name "id" at 'contents[1].parts[0].function_call': Cannot find field.`
 * - `Invalid JSON payload received. Unknown name "id" at 'contents[2].parts[0].function_response': Cannot find field.`
 *
 * 注意：与其他整流器一致，这里不依赖错误规则开关，仅做字符串判断。
 */
// 逐条提取 `unknown name "id" at <path>` 违规中的 path（引号可选，兼容网关改写文案），
// 在 `:`（Vertex 的 `: Cannot find field.` 尾缀）或换行处截断，避免吞掉下一条违规。
const ID_VIOLATION_PATTERN = /unknown name "id" at '?([^':\n]*)/g;

export function detectGeminiFunctionIdRectifierTrigger(
  errorMessage: string | null | undefined
): GeminiFunctionIdRectifierTrigger | null {
  if (!errorMessage) return null;

  const lower = errorMessage.toLowerCase();

  // id 违规必须与其自身路径中的函数字段绑定判断，而非全文独立子串匹配——
  // 防止多违规消息中「id 在无关路径 + 函数字段见于另一条违规」造成串扰误触发。
  // 兼容 snake_case（Vertex 错误文案）与 camelCase（部分兼容网关）两种路径写法。
  for (const match of lower.matchAll(ID_VIOLATION_PATTERN)) {
    const path = match[1] ?? "";
    if (
      path.includes("function_call") ||
      path.includes("function_response") ||
      path.includes("functioncall") ||
      path.includes("functionresponse")
    ) {
      return "unknown_function_id_field";
    }
  }

  return null;
}

function stripIdsFromContents(contents: unknown): {
  strippedFunctionCallIds: number;
  strippedFunctionResponseIds: number;
} {
  let strippedFunctionCallIds = 0;
  let strippedFunctionResponseIds = 0;

  if (!Array.isArray(contents)) {
    return { strippedFunctionCallIds, strippedFunctionResponseIds };
  }

  for (const content of contents) {
    if (!content || typeof content !== "object") continue;
    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const partObj = part as Record<string, unknown>;

      // 请求体字段名兼容 camelCase 与 snake_case（proto JSON 两种写法均合法）
      for (const key of ["functionCall", "function_call"]) {
        const functionCall = partObj[key];
        if (functionCall && typeof functionCall === "object" && "id" in functionCall) {
          delete (functionCall as Record<string, unknown>).id;
          strippedFunctionCallIds += 1;
        }
      }

      for (const key of ["functionResponse", "function_response"]) {
        const functionResponse = partObj[key];
        if (functionResponse && typeof functionResponse === "object" && "id" in functionResponse) {
          delete (functionResponse as Record<string, unknown>).id;
          strippedFunctionResponseIds += 1;
        }
      }
    }
  }

  return { strippedFunctionCallIds, strippedFunctionResponseIds };
}

/**
 * 对 Gemini 请求体做最小侵入整流：移除 contents[].parts[] 中
 * functionCall.id / functionResponse.id 字段（其余字段如 thoughtSignature 原样保留）。
 *
 * 说明：
 * - 删除 id 等价于把请求还原为 Vertex 原生格式；Vertex 侧按顺序 + name 配对
 *   函数调用与响应，不依赖该字段，无功能损失。
 * - 同时兼容两种请求形状：官方 Gemini API 的顶层 `contents`，
 *   以及 gemini-cli（cloudcode）协议包裹在 `request.contents` 下的形状。
 * - 仅在上游报错后、同供应商重试前调用；原地修改 message 对象（与其他整流器一致）。
 */
export function rectifyGeminiFunctionIds(
  message: Record<string, unknown>
): GeminiFunctionIdRectifierResult {
  const topLevel = stripIdsFromContents(message.contents);

  const wrappedRequest = message.request;
  const wrapped =
    wrappedRequest && typeof wrappedRequest === "object"
      ? stripIdsFromContents((wrappedRequest as Record<string, unknown>).contents)
      : { strippedFunctionCallIds: 0, strippedFunctionResponseIds: 0 };

  const strippedFunctionCallIds =
    topLevel.strippedFunctionCallIds + wrapped.strippedFunctionCallIds;
  const strippedFunctionResponseIds =
    topLevel.strippedFunctionResponseIds + wrapped.strippedFunctionResponseIds;

  return {
    applied: strippedFunctionCallIds > 0 || strippedFunctionResponseIds > 0,
    strippedFunctionCallIds,
    strippedFunctionResponseIds,
  };
}
