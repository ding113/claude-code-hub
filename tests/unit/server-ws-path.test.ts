import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const requireFromHere = createRequire(import.meta.url);

type ServerJsModule = {
  isResponsesWsUpgrade: (req: { url?: string }) => boolean;
};

const { isResponsesWsUpgrade } = requireFromHere("../../server.js") as ServerJsModule;

describe("isResponsesWsUpgrade", () => {
  test.each(["/v1/responses", "/v1/responses/", "/responses", "/responses/?model=gpt"])(
    "accepts %s",
    (url) => {
      expect(isResponsesWsUpgrade({ url })).toBe(true);
    }
  );

  test.each(["/v1/messages", "/v1/chat/completions", "/models", "/dashboard", "/"])(
    "rejects %s",
    (url) => {
      expect(isResponsesWsUpgrade({ url })).toBe(false);
    }
  );

  test("rejects missing url", () => {
    expect(isResponsesWsUpgrade({})).toBe(false);
  });
});
