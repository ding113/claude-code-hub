import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import { ERROR_CODES, getErrorMessageServer } from "@/lib/utils/error-messages";

export async function buildLocalCapacityResponse(): Promise<Response> {
  let message = "Local request capacity exhausted; retry later.";
  try {
    const { getLocale } = await import("next-intl/server");
    message = await getErrorMessageServer(await getLocale(), ERROR_CODES.LOCAL_CAPACITY_EXCEEDED);
  } catch {
    /* 无 locale 的网关入口仍返回标准过载响应。 */
  }
  const response = ProxyResponses.buildError(429, message, "local_capacity_exceeded");
  response.headers.set("retry-after", "1");
  return response;
}
