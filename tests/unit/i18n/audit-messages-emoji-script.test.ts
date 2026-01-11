import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import audit from "../../../scripts/audit-messages-emoji.js";

describe("scripts/audit-messages-emoji.js", () => {
  test("fileToKeyPrefix() drops trailing strings segment for stable key paths", () => {
    expect(audit.fileToKeyPrefix(path.join("settings", "providers", "strings.json"))).toBe(
      "settings.providers"
    );
    expect(audit.fileToKeyPrefix(path.join("settings", "common.json"))).toBe("settings.common");
  });

  test("flattenLeafStrings() flattens objects and arrays to leaf key paths", () => {
    const rows = audit.flattenLeafStrings({
      a: ["x", { b: "y" }],
      n: 1,
      nil: null,
    });

    const keys = rows.map((r: { key: string }) => r.key).sort();
    expect(keys).toEqual(["a.0", "a.1.b"]);
  });

  test("countEmojiCodepoints()/maskEmoji() include keycap and flag sequences", () => {
    const keycap = "1\uFE0F\u20E3";
    const flag = String.fromCodePoint(0x1f1fa, 0x1f1f8);
    const emoji = String.fromCodePoint(0x1f600);

    const input = `a${keycap}b${flag}c${emoji}d`;
    expect(audit.countEmojiCodepoints(input)).toBe(3);
    expect(audit.maskEmoji(input)).toBe("a<emoji>b<emoji>c<emoji>d");
  });

  test("findMessagesEmoji() reports leaf strings that contain emoji (stable key paths)", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-messages-emoji",
      String(Date.now())
    );
    const messagesDir = path.join(tmpRoot, "messages");
    const emoji = String.fromCodePoint(0x1f600);

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "en", "settings", "common.json"), {
        greeting: `Hello ${emoji}`,
        nested: { ok: "No emoji" },
      });

      const report = audit.findMessagesEmoji({ messagesDir, locales: ["en"] });
      expect(report.totalRowCount).toBe(1);
      expect(report.totalEmojiCount).toBe(1);

      expect(report.rows[0]).toMatchObject({
        locale: "en",
        relFile: "settings/common.json",
        key: "settings.common.greeting",
        emojiCount: 1,
      });
      expect(report.rows[0].preview).toContain("<emoji>");
      expect(report.rows[0].preview).not.toContain(emoji);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("findMessagesEmoji() supports auto locale detection and text/json output", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-messages-emoji-multi",
      String(Date.now())
    );
    const messagesDir = path.join(tmpRoot, "messages");
    const emojiA = String.fromCodePoint(0x1f600);
    const emojiB = String.fromCodePoint(0x1f680);

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      fs.mkdirSync(path.join(messagesDir, ".ignored"), { recursive: true });

      writeJson(path.join(messagesDir, "en", "settings", "common.json"), {
        arr: ["no", `${emojiA}`],
        nested: { label: `Hi ${emojiB}` },
      });
      writeJson(path.join(messagesDir, "en", "settings", "providers", "strings.json"), {
        title: `Providers ${emojiA}`,
      });
      fs.mkdirSync(path.join(messagesDir, "ja"), { recursive: true });
      fs.writeFileSync(
        path.join(messagesDir, "ja", "dashboard.json"),
        `${JSON.stringify(`Dash ${emojiB}`)}\n`,
        "utf8"
      );

      const report = audit.findMessagesEmoji({ messagesDir });
      expect(report.totalRowCount).toBe(4);
      expect(report.byLocaleCount).toEqual({ en: 3, ja: 1 });

      const outText = audit.run([`--messagesDir=${messagesDir}`]);
      expect(outText.exitCode).toBe(0);
      expect(outText.lines.join("\n")).toContain("Top files by row count");
      expect(outText.lines.join("\n")).toContain("Rows (locale\trelFile\tkey):");

      const outJson = audit.run([`--messagesDir=${messagesDir}`, "--format=json"]);
      expect(outJson.exitCode).toBe(0);
      const parsed = JSON.parse(outJson.lines.join("\n")) as Array<{ preview: string }>;
      expect(parsed.length).toBe(4);
      for (const row of parsed) expect(row.preview).toContain("<emoji>");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("CLI prints OK and exits 0 when no emoji exist", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-messages-emoji-cli",
      `ok-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "en", "settings", "common.json"), {
        greeting: "Hello",
      });

      const out = audit.run([`--messagesDir=${messagesDir}`]);
      expect(out.exitCode).toBe(0);
      expect(out.lines.join("\n")).toContain("OK: no emoji found");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("CLI supports --format=tsv for stable machine parsing", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-messages-emoji-cli",
      `tsv-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");
    const emoji = String.fromCodePoint(0x1f680);

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "en", "settings", "common.json"), {
        greeting: `Hello ${emoji}`,
      });

      const out = audit.run([`--messagesDir=${messagesDir}`, "--format=tsv"]);
      expect(out.exitCode).toBe(0);
      expect(out.lines[0]).toBe("locale\trelFile\tkey\temojiCount\tpreview");
      expect(out.lines).toContain(
        "en\tsettings/common.json\tsettings.common.greeting\t1\tHello <emoji>"
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
