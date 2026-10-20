import { describe, expect, it } from "vitest";
import {
  detectGeminiFunctionIdRectifierTrigger,
  rectifyGeminiFunctionIds,
} from "@/app/v1/_lib/proxy/gemini-function-id-rectifier";

describe("GeminiFunctionIdRectifier", () => {
  describe("detectGeminiFunctionIdRectifierTrigger", () => {
    it("should detect typical Vertex function_call error", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Invalid JSON payload received. Unknown name "id" at 'contents[1].parts[0].function_call': Cannot find field.`
      );
      expect(trigger).toBe("unknown_function_id_field");
    });

    it("should detect typical Vertex function_response error", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Invalid JSON payload received. Unknown name "id" at 'contents[2].parts[0].function_response': Cannot find field.`
      );
      expect(trigger).toBe("unknown_function_id_field");
    });

    it("should detect multi-path error covering both fields", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Invalid JSON payload received. Unknown name "id" at 'contents[1].parts[0].function_call': Cannot find field.
Invalid JSON payload received. Unknown name "id" at 'contents[2].parts[0].function_response': Cannot find field.`
      );
      expect(trigger).toBe("unknown_function_id_field");
    });

    it("should detect camelCase path variants from compatible gateways", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Unknown name "id" at 'contents[0].parts[0].functionCall'`
      );
      expect(trigger).toBe("unknown_function_id_field");
    });

    it("should detect unquoted path variants from rewritten gateway errors", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Invalid JSON: Unknown name "id" at contents[1].parts[0].function_call`
      );
      expect(trigger).toBe("unknown_function_id_field");
    });

    it("should detect JSON-escaped quotes in forwarder detailed error messages", () => {
      // 转发链路把上游 JSON body 原样拼进错误消息，message 字段内层引号为 \" 转义形态
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Provider Vertex AI returned 400: Provider returned 400: Bad Request | Upstream: {
  "error": {
    "code": 400,
    "message": "Invalid JSON payload received. Unknown name \\"id\\" at 'contents[2].parts[0].function_call': Cannot find field.\\nInvalid JSON payload received. Unknown name \\"id\\" at 'contents[3].parts[0].function_response': Cannot find field.",
    "status": "INVALID_ARGUMENT"
  }
}`
      );
      expect(trigger).toBe("unknown_function_id_field");
    });

    it("should not detect JSON-escaped id violation on unrelated path", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Provider returned 400 | Upstream: {"error":{"message":"Invalid JSON payload received. Unknown name \\"id\\" at 'generation_config': Cannot find field."}}`
      );
      expect(trigger).toBeNull();
    });

    it("should not cross-match id violation on one path with function field on another", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Invalid JSON payload received. Unknown name "id" at 'generation_config': Cannot find field.
Invalid JSON payload received. Unknown name "foo" at 'contents[0].parts[0].function_call': Cannot find field.`
      );
      expect(trigger).toBeNull();
    });

    it("should not cross-match unquoted violations joined on a single line", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Unknown name "id" at generation_config Unknown name "foo" at contents[0].parts[0].function_call`
      );
      expect(trigger).toBeNull();
    });

    it("should still detect unquoted function path among joined single-line violations", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Unknown name "foo" at generation_config Unknown name "id" at contents[0].parts[0].function_call`
      );
      expect(trigger).toBe("unknown_function_id_field");
    });

    it("should not match function_calling_config paths via substring", () => {
      expect(
        detectGeminiFunctionIdRectifierTrigger(
          `Invalid JSON payload received. Unknown name "id" at 'tool_config.function_calling_config': Cannot find field.`
        )
      ).toBeNull();
      expect(
        detectGeminiFunctionIdRectifierTrigger(
          `Unknown name "id" at 'toolConfig.functionCallingConfig'`
        )
      ).toBeNull();
    });

    it("should return null when unknown field is not id", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Invalid JSON payload received. Unknown name "foo" at 'contents[0].parts[0].function_call': Cannot find field.`
      );
      expect(trigger).toBeNull();
    });

    it("should return null when id error is unrelated to function fields", () => {
      const trigger = detectGeminiFunctionIdRectifierTrigger(
        `Invalid JSON payload received. Unknown name "id" at 'generation_config': Cannot find field.`
      );
      expect(trigger).toBeNull();
    });

    it("should return null for unrelated errors", () => {
      expect(detectGeminiFunctionIdRectifierTrigger("rate limit exceeded")).toBeNull();
    });

    it("should return null for null/undefined input", () => {
      expect(detectGeminiFunctionIdRectifierTrigger(null)).toBeNull();
      expect(detectGeminiFunctionIdRectifierTrigger(undefined)).toBeNull();
    });
  });

  describe("rectifyGeminiFunctionIds", () => {
    it("should strip id from functionCall and functionResponse across contents", () => {
      const message: Record<string, unknown> = {
        contents: [
          { role: "user", parts: [{ text: "list files" }] },
          {
            role: "model",
            parts: [
              {
                functionCall: { id: "call-1", name: "list_files", args: { path: "." } },
                thoughtSignature: "sig-abc",
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call-1",
                  name: "list_files",
                  response: { output: "a.txt" },
                },
              },
            ],
          },
        ],
      };

      const result = rectifyGeminiFunctionIds(message);

      expect(result.applied).toBe(true);
      expect(result.strippedFunctionCallIds).toBe(1);
      expect(result.strippedFunctionResponseIds).toBe(1);

      const contents = message.contents as Array<{ parts: Array<Record<string, unknown>> }>;
      expect(contents[1].parts[0].functionCall).toEqual({
        name: "list_files",
        args: { path: "." },
      });
      // thoughtSignature 等兄弟字段必须原样保留
      expect(contents[1].parts[0].thoughtSignature).toBe("sig-abc");
      expect(contents[2].parts[0].functionResponse).toEqual({
        name: "list_files",
        response: { output: "a.txt" },
      });
    });

    it("should strip ids from multiple parallel calls in one message", () => {
      const message: Record<string, unknown> = {
        contents: [
          {
            role: "model",
            parts: [
              { functionCall: { id: "c1", name: "f", args: {} } },
              { functionCall: { id: "c2", name: "f", args: {} } },
            ],
          },
        ],
      };

      const result = rectifyGeminiFunctionIds(message);
      expect(result.applied).toBe(true);
      expect(result.strippedFunctionCallIds).toBe(2);
      expect(result.strippedFunctionResponseIds).toBe(0);
    });

    it("should strip ids under gemini-cli request wrapper", () => {
      const message: Record<string, unknown> = {
        project: "my-project",
        request: {
          contents: [
            {
              role: "model",
              parts: [{ functionCall: { id: "c1", name: "f", args: {} } }],
            },
          ],
        },
      };

      const result = rectifyGeminiFunctionIds(message);
      expect(result.applied).toBe(true);
      expect(result.strippedFunctionCallIds).toBe(1);

      const wrapped = message.request as {
        contents: Array<{ parts: Array<Record<string, unknown>> }>;
      };
      expect(wrapped.contents[0].parts[0].functionCall).toEqual({ name: "f", args: {} });
    });

    it("should strip ids from snake_case function fields", () => {
      const message: Record<string, unknown> = {
        contents: [
          { role: "model", parts: [{ function_call: { id: "c1", name: "f", args: {} } }] },
          { role: "user", parts: [{ function_response: { id: "c1", name: "f", response: {} } }] },
        ],
      };

      const result = rectifyGeminiFunctionIds(message);
      expect(result.applied).toBe(true);
      expect(result.strippedFunctionCallIds).toBe(1);
      expect(result.strippedFunctionResponseIds).toBe(1);

      const contents = message.contents as Array<{ parts: Array<Record<string, unknown>> }>;
      expect(contents[0].parts[0].function_call).toEqual({ name: "f", args: {} });
      expect(contents[1].parts[0].function_response).toEqual({ name: "f", response: {} });
    });

    it("should not apply when function fields carry no id", () => {
      const message: Record<string, unknown> = {
        contents: [
          { role: "model", parts: [{ functionCall: { name: "f", args: {} } }] },
          { role: "user", parts: [{ functionResponse: { name: "f", response: {} } }] },
        ],
      };

      const result = rectifyGeminiFunctionIds(message);
      expect(result.applied).toBe(false);
      expect(result.strippedFunctionCallIds).toBe(0);
      expect(result.strippedFunctionResponseIds).toBe(0);
    });

    it("should tolerate malformed shapes without throwing", () => {
      expect(rectifyGeminiFunctionIds({}).applied).toBe(false);
      expect(rectifyGeminiFunctionIds({ contents: "not-an-array" }).applied).toBe(false);
      expect(
        rectifyGeminiFunctionIds({ contents: [null, { parts: "nope" }, { parts: [null, 42] }] })
          .applied
      ).toBe(false);
      expect(rectifyGeminiFunctionIds({ request: "not-an-object" }).applied).toBe(false);
    });
  });
});
