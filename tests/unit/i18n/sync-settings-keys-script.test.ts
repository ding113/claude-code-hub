import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import sync from "../../../scripts/sync-settings-keys.js";

describe("scripts/sync-settings-keys.js", () => {
  test("flatten() flattens nested objects into dot-keys", () => {
    const input = { a: { b: 1, c: { d: "x" } }, e: true };
    const out = sync.flatten(input);
    expect(out).toEqual({ "a.b": 1, "a.c.d": "x", e: true });
  });

  test("mergeWithCanonical() keeps canonical shape and preserves existing leaves", () => {
    const canonical = {
      a: { b: "cn", c: { d: "cn" } },
      x: "cn",
    };
    const target = {
      a: { b: "t", c: "wrong-type" },
      x: { y: "wrong-type" },
      extra: "should-drop",
    };

    const merged = sync.mergeWithCanonical(canonical, target);
    expect(merged).toEqual({
      a: { b: "t", c: { d: "cn" } },
      x: "cn",
    });
  });

  test("loadSplitSettings() reads split settings layout for zh-CN", () => {
    const settings = sync.loadSplitSettings("zh-CN");
    expect(settings).toBeTruthy();
    expect(settings).toHaveProperty("providers");
    expect(settings).toHaveProperty("mcpPassthroughConfig");
  });

  test("ensureSettings() can generate split files from canonical", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-sync-settings-keys",
      String(Date.now())
    );
    const messagesDir = path.join(tmpRoot, "messages");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      // canonical (zh-CN)
      writeJson(path.join(messagesDir, "zh-CN", "settings", "a.json"), { k: "cn" });
      writeJson(path.join(messagesDir, "zh-CN", "settings", "strings.json"), { s: "cn" });
      writeJson(path.join(messagesDir, "zh-CN", "settings", "providers", "strings.json"), {
        title: "cn",
      });
      writeJson(path.join(messagesDir, "zh-CN", "settings", "providers", "form", "apiTest.json"), {
        enabled: "cn",
      });
      writeJson(path.join(messagesDir, "zh-CN", "settings", "providers", "form", "strings.json"), {
        x: "cn",
      });

      const report = sync.ensureSettings("en", messagesDir);
      expect(report.after.missing).toBe(0);
      expect(report.after.extra).toBe(0);

      const enA = JSON.parse(
        fs.readFileSync(path.join(messagesDir, "en", "settings", "a.json"), "utf8")
      );
      expect(enA).toEqual({ k: "cn" });

      const enStrings = JSON.parse(
        fs.readFileSync(path.join(messagesDir, "en", "settings", "strings.json"), "utf8")
      );
      expect(enStrings).toEqual({ s: "cn" });

      const enFormApiTest = JSON.parse(
        fs.readFileSync(
          path.join(messagesDir, "en", "settings", "providers", "form", "apiTest.json"),
          "utf8"
        )
      );
      expect(enFormApiTest).toEqual({ enabled: "cn" });
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("ensureSettings() supports legacy settings.json layout", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-sync-settings-keys",
      `legacy-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "zh-CN", "settings.json"), {
        a: { b: "cn" },
        x: "cn",
      });
      writeJson(path.join(messagesDir, "en", "settings.json"), {
        a: { b: "en" },
        x: { y: "wrong-type" },
        extra: "drop",
      });

      const report = sync.ensureSettings("en", messagesDir);
      expect(report.after.missing).toBe(0);
      expect(report.after.extra).toBe(0);

      const out = JSON.parse(
        fs.readFileSync(path.join(messagesDir, "en", "settings.json"), "utf8")
      );
      expect(out).toEqual({ a: { b: "en" }, x: "cn" });
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
