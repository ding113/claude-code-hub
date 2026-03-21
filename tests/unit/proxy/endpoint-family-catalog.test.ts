import { describe, expect, test } from "vitest";
import {
  isStandardProxyEndpointPath,
  listKnownEndpointFamilies,
  resolveEndpointFamilyByPath,
} from "@/app/v1/_lib/proxy/endpoint-family-catalog";
import { detectClientFormat, detectFormatByEndpoint } from "@/app/v1/_lib/proxy/format-mapper";

const FAMILY_SAMPLES = [
  {
    id: "claude-messages",
    path: "/v1/messages",
    format: "claude",
    accountingTier: "required_usage",
    modelRequired: false,
  },
  {
    id: "claude-count-tokens",
    path: "/v1/messages/count_tokens",
    format: "claude",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "response-execution",
    path: "/v1/responses",
    format: "response",
    accountingTier: "required_usage",
    modelRequired: false,
  },
  {
    id: "response-resources",
    path: "/v1/responses/resp_123/input_items",
    format: "response",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "response-compact",
    path: "/v1/responses/compact",
    format: "response",
    accountingTier: "required_usage",
    modelRequired: false,
  },
  {
    id: "openai-chat-completions",
    path: "/v1/chat/completions",
    format: "openai",
    accountingTier: "required_usage",
    modelRequired: true,
  },
  {
    id: "openai-chat-completions-resources",
    path: "/v1/chat/completions/cmpl_123/messages",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-completions",
    path: "/v1/completions",
    format: "openai",
    accountingTier: "required_usage",
    modelRequired: true,
  },
  {
    id: "openai-embeddings",
    path: "/v1/embeddings",
    format: "openai",
    accountingTier: "required_usage",
    modelRequired: true,
  },
  {
    id: "openai-moderations",
    path: "/v1/moderations",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-audio-generation",
    path: "/v1/audio/speech",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-audio-transcription",
    path: "/v1/audio/transcriptions",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-audio-resources",
    path: "/v1/audio/voices",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-images",
    path: "/v1/images/generations",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-files",
    path: "/v1/files/file_123/content",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-uploads",
    path: "/v1/uploads/upload_123/complete",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-batches",
    path: "/v1/batches/batch_123/cancel",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-models",
    path: "/v1/models/gpt-4o",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-fine-tuning",
    path: "/v1/fine_tuning/jobs/job_123/events",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-evals",
    path: "/v1/evals/eval_123/runs",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-assistants",
    path: "/v1/assistants/asst_123",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-threads",
    path: "/v1/threads/thread_123/runs",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-conversations",
    path: "/v1/conversations/conv_123/items",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-vector-stores",
    path: "/v1/vector_stores/vs_123/search",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-containers",
    path: "/v1/containers/container_123/files",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-realtime-http",
    path: "/v1/realtime/sessions",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-videos",
    path: "/v1/videos/edits",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-skills",
    path: "/v1/skills/skill_123/content",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "openai-chatkit",
    path: "/v1/chatkit/threads/thread_123/items",
    format: "openai",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "gemini-generate-content",
    path: "/v1beta/models/gemini-2.5-flash:generateContent",
    format: "gemini",
    accountingTier: "required_usage",
    modelRequired: true,
  },
  {
    id: "gemini-stream-generate-content",
    path: "/v1beta/models/gemini-2.5-flash:streamGenerateContent",
    format: "gemini",
    accountingTier: "required_usage",
    modelRequired: true,
  },
  {
    id: "gemini-count-tokens",
    path: "/v1beta/models/gemini-2.5-flash:countTokens",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-embed-content",
    path: "/v1beta/models/gemini-embedding-001:embedContent",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-batch-generate-content",
    path: "/v1beta/models/gemini-2.5-flash:batchGenerateContent",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-batch-embed-contents",
    path: "/v1beta/models/gemini-embedding-001:batchEmbedContents",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-async-batch-embed-content",
    path: "/v1beta/models/gemini-embedding-001:asyncBatchEmbedContent",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-predict",
    path: "/v1beta/models/imagen-3.0-generate-002:predict",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-predict-long-running",
    path: "/v1beta/models/veo-3.0-generate-preview:predictLongRunning",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-files",
    path: "/v1beta/files/file-123",
    format: "gemini",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "gemini-models-resource",
    path: "/v1beta/models/gemini-2.5-flash",
    format: "gemini",
    accountingTier: "none",
    modelRequired: false,
  },
  {
    id: "gemini-batch-embed-contents",
    path: "/v1/publishers/google/models/gemini-embedding-001:batchEmbedContents",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-batch-embed-contents",
    path: "/v1/models/gemini-2.5-flash:batchEmbedContents",
    format: "gemini",
    accountingTier: "optional_usage",
    modelRequired: true,
  },
  {
    id: "gemini-cli-generate-content",
    path: "/v1internal/models/gemini-2.5-flash:generateContent",
    format: "gemini-cli",
    accountingTier: "required_usage",
    modelRequired: true,
  },
  {
    id: "gemini-cli-stream-generate-content",
    path: "/v1internal/models/gemini-2.5-flash:streamGenerateContent",
    format: "gemini-cli",
    accountingTier: "required_usage",
    modelRequired: true,
  },
] as const;

describe("endpoint family catalog", () => {
  test("样例应覆盖所有已知端点族", () => {
    expect(new Set(FAMILY_SAMPLES.map((entry) => entry.id))).toEqual(
      new Set(listKnownEndpointFamilies().map((entry) => entry.id))
    );
  });

  test.each(FAMILY_SAMPLES)("%s 应解析到正确端点族", ({ id, path, format, accountingTier }) => {
    const family = resolveEndpointFamilyByPath(path);

    expect(family?.id).toBe(id);
    expect(family?.surface).toBe(format);
    expect(family?.accountingTier).toBe(accountingTier);
    expect(detectFormatByEndpoint(path)).toBe(format);
    expect(isStandardProxyEndpointPath(path)).toBe(true);
  });

  test.each(FAMILY_SAMPLES.filter((entry) => entry.modelRequired))("%s 应要求模型", ({ path }) => {
    expect(resolveEndpointFamilyByPath(path)?.modelRequired).toBe(true);
  });

  test.each(FAMILY_SAMPLES.filter((entry) => !entry.modelRequired))("%s 不应要求模型", ({
    path,
  }) => {
    expect(resolveEndpointFamilyByPath(path)?.modelRequired).toBe(false);
  });

  test("Gemini batch body fallback 应识别为 gemini", () => {
    expect(
      detectClientFormat({
        requests: [
          {
            model: "models/gemini-embedding-001",
            content: {
              parts: [{ text: "hello" }],
            },
          },
        ],
      })
    ).toBe("gemini");
  });

  test.each([
    "/v1/organization/users",
    "/v1/projects/proj_123/service_accounts",
    "/v1beta/upload/v1beta/files",
    "/v1internal/models/gemini-2.5-flash:embedContent",
  ])("%s 不应被误判为受支持代理端点", (path) => {
    expect(resolveEndpointFamilyByPath(path)).toBeNull();
    expect(detectFormatByEndpoint(path)).toBeNull();
    expect(isStandardProxyEndpointPath(path)).toBe(false);
  });
});
