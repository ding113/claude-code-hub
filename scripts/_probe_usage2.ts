
import { executeProviderTest } from "@/lib/provider-testing/test-service";
const targets = [{"name": "247kan-Pro", "url": "https://api.247kan.com/v1", "key": "sk-00224582915fb8f96ea72f4f24488d815281895419dca4f35d6ceeb0b83feba0", "providerType": "codex"}, {"name": "瑞科-Claude MAX 满血", "url": "https://ai.ruikon.com", "key": "sk-2f767976d08c88ee2183c6d23d4137dd64d801a4c914ba56ba3887ec18073b5d", "providerType": "claude"}, {"name": "皓悦API-plus-特惠", "url": "https://1pkapi.com/v1", "key": "sk-9bb00473deff0c906ae5450b5aef0fad3922b411ad7bfd74f633172ba3235be8", "providerType": "codex"}];
for (const t of targets) {
  const result = await executeProviderTest({
    providerUrl: t.url,
    apiKey: t.key,
    providerType: t.providerType as any,
    model: t.providerType === "claude" ? "claude-opus-4-6" : "gpt-5.6-terra",
    timeoutMs: 60000,
  });
  const raw = result.rawResponse || "";
  // find usage snippets
  const usages = [...raw.matchAll(/"usage"\s*:\s*(\{[^\n]{0,200}|null)/g)].map(m=>m[1]).slice(0,6);
  console.log(JSON.stringify({
    name: t.name,
    type: t.providerType,
    success: result.success,
    usage: result.usage,
    firstByteMs: result.firstByteMs,
    latencyMs: result.latencyMs,
    rawLen: raw.length,
    hasCompleted: raw.includes("response.completed") || raw.includes("message_delta") || raw.includes("message_stop"),
    usages,
    headTypes: [...raw.matchAll(/"type"\s*:\s*"([^"]+)"/g)].map(m=>m[1]).slice(0,15),
  }, null, 2));
}
