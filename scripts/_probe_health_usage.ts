
import { executeProviderTest } from "@/lib/provider-testing/test-service";

const targets = [{"name": "247kan-Pro", "url": "https://api.247kan.com/v1", "key": "sk-00224582915fb8f96ea72f4f24488d815281895419dca4f35d6ceeb0b83feba0"}, {"name": "皓悦API-Plus-稳定", "url": "https://1pkapi.com/v1", "key": "sk-2172c25e14fb6b0a1a3e6cbd596f970e8bac4f2d880084cfb16c314d84ec6b8d"}];

for (const t of targets) {
  const result = await executeProviderTest({
    providerUrl: t.url,
    apiKey: t.key,
    providerType: "codex",
    model: "gpt-5.6-terra",
    timeoutMs: 60000,
  });
  const raw = result.rawResponse || "";
  console.log(JSON.stringify({
    name: t.name,
    success: result.success,
    status: result.status,
    subStatus: result.subStatus,
    http: result.httpStatusCode,
    latencyMs: result.latencyMs,
    firstByteMs: result.firstByteMs,
    model: result.model,
    usage: result.usage,
    requestUrl: result.requestUrl,
    content: (result.content || "").slice(0,80),
    rawLen: raw.length,
    hasCompleted: raw.includes("response.completed"),
    hasUsage: raw.includes('"usage"'),
    rawTail: raw.slice(-500),
  }, null, 2));
}
