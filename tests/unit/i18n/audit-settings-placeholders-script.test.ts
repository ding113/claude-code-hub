import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import audit from "../../../scripts/audit-settings-placeholders.js";

describe("scripts/audit-settings-placeholders.js", () => {
  test("findSettingsPlaceholders() reports leaf strings that equal zh-CN at the same key path", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-settings-placeholders",
      String(Date.now())
    );
    const messagesDir = path.join(tmpRoot, "messages");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      // canonical (zh-CN)
      writeJson(path.join(messagesDir, "zh-CN", "settings", "config.json"), {
        form: {
          enableHttp2: "启用 HTTP/2",
          enableHttp2Desc: "启用后，代理请求将优先使用 HTTP/2 协议。",
        },
      });
      writeJson(
        path.join(messagesDir, "zh-CN", "settings", "providers", "form", "maxRetryAttempts.json"),
        {
          label: "单供应商最大尝试次数",
          desc: "包含首次调用在内，单个供应商最多尝试几次后切换。",
          placeholder: "2",
        }
      );

      // target (en) has one placeholder leaf copied from zh-CN, and one translated value
      writeJson(path.join(messagesDir, "en", "settings", "config.json"), {
        form: {
          enableHttp2: "Enable HTTP/2",
          enableHttp2Desc: "启用后，代理请求将优先使用 HTTP/2 协议。",
        },
      });
      writeJson(
        path.join(messagesDir, "en", "settings", "providers", "form", "maxRetryAttempts.json"),
        {
          label: "single provider max retry attempts",
          desc: "包含首次调用在内，单个供应商最多尝试几次后切换。",
          placeholder: "2",
        }
      );

      const report = audit.findSettingsPlaceholders({ messagesDir, locales: ["en"] });
      expect(report.rows.length).toBe(2);

      const keys = report.rows.map((r: { key: string }) => r.key).sort();
      expect(keys).toEqual(["config.form.enableHttp2Desc", "providers.form.maxRetryAttempts.desc"]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("CLI prints OK and exits 0 when no placeholders exist", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-settings-placeholders-cli",
      `ok-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "zh-CN", "settings", "config.json"), {
        form: { enableHttp2: "启用 HTTP/2" },
      });
      writeJson(path.join(messagesDir, "en", "settings", "config.json"), {
        form: { enableHttp2: "Enable HTTP/2" },
      });

      const out = audit.run([`--messagesDir=${messagesDir}`]);
      expect(out.exitCode).toBe(0);
      expect(out.lines.join("\n")).toContain("OK: no zh-CN placeholder candidates");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("CLI prints matches and exits 1 when --fail and placeholders exist", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-settings-placeholders-cli",
      `fail-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "zh-CN", "settings", "config.json"), {
        form: { enableHttp2Desc: "启用后，代理请求将优先使用 HTTP/2 协议。" },
      });
      writeJson(path.join(messagesDir, "en", "settings", "config.json"), {
        form: { enableHttp2Desc: "启用后，代理请求将优先使用 HTTP/2 协议。" },
      });

      const out = audit.run([`--messagesDir=${messagesDir}`, "--fail"]);
      expect(out.exitCode).toBe(1);
      expect(out.lines[0]).toBe("Found 1 zh-CN placeholder candidates:");
      expect(out.lines).toContain("en\tconfig.json\tconfig.form.enableHttp2Desc");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("CLI supports --scope and --format=tsv for stable machine parsing", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-settings-placeholders-cli",
      `tsv-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "zh-CN", "dashboard.json"), {
        hero: { title: "仪表盘" },
      });
      writeJson(path.join(messagesDir, "en", "dashboard.json"), {
        hero: { title: "仪表盘" },
      });

      const out = audit.run([
        `--messagesDir=${messagesDir}`,
        "--scope=dashboard",
        "--locales=en",
        "--format=tsv",
      ]);
      expect(out.exitCode).toBe(0);
      expect(out.lines[0]).toBe("locale\trelFile\tkey\tvalue\treason");
      expect(out.lines).toContain(
        "en\tdashboard.json\tdashboard.hero.title\t仪表盘\tsame_as_zh-CN"
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("allowlist filters false positives (exact/keyPrefix/keyRegex/valueRegex/glossary)", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-settings-placeholders-allowlist",
      `allowlist-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");
    const allowlistPath = path.join(tmpRoot, "allowlist.json");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(allowlistPath, {
        entries: [
          { key: "config.form.exactKey", reason: "test-exact" },
          { keyPrefix: "config.form.prefix.", reason: "test-prefix" },
          { keyRegex: "^config\\.form\\.re\\.", reason: "test-key-regex" },
          { valueRegex: "KEEP_AS_CN$", reason: "test-value-regex" },
        ],
        glossary: ["GLOSSARY_TERM"],
      });

      writeJson(path.join(messagesDir, "zh-CN", "settings", "config.json"), {
        form: {
          exactKey: "精确豁免",
          prefix: {
            a: "前缀豁免",
          },
          re: {
            b: "正则豁免",
          },
          value: "触发 KEEP_AS_CN",
          glossary: "包含 GLOSSARY_TERM 的句子",
        },
      });
      writeJson(path.join(messagesDir, "en", "settings", "config.json"), {
        form: {
          exactKey: "精确豁免",
          prefix: {
            a: "前缀豁免",
          },
          re: {
            b: "正则豁免",
          },
          value: "触发 KEEP_AS_CN",
          glossary: "包含 GLOSSARY_TERM 的句子",
        },
      });

      const report = audit.findSettingsPlaceholders({
        messagesDir,
        locales: ["en"],
        scopes: ["settings"],
        allowlistPath,
      });
      expect(report.rows).toEqual([]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
