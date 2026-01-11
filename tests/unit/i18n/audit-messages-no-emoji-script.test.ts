import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import audit from "../../../scripts/audit-messages-no-emoji.js";

describe("scripts/audit-messages-no-emoji.js", () => {
  test("CLI exits 0 and prints OK when no emoji exist", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-messages-no-emoji-cli",
      `ok-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "en", "settings", "common.json"), { greeting: "Hello" });

      const out = audit.run([`--messagesDir=${messagesDir}`]);
      expect(out.exitCode).toBe(0);
      expect(out.lines.join("\n")).toContain("OK: no emoji found");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("CLI supports --fail and outputs codepoints without printing emoji characters", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-messages-no-emoji-cli",
      `fail-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");
    const emoji = String.fromCodePoint(0x1f600);

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "en", "provider-chain.json"), {
        timeline: { circuitTriggered: `Warning ${emoji}` },
      });

      const out = audit.run([`--messagesDir=${messagesDir}`, "--format=tsv", "--fail"]);
      expect(out.exitCode).toBe(1);
      expect(out.lines[0]).toBe("file\tkey\temojiCount\tcodepoints");
      expect(out.lines.join("\n")).toContain("messages/en/provider-chain.json");
      expect(out.lines.join("\n")).toContain("provider-chain.timeline.circuitTriggered");
      expect(out.lines.join("\n")).toContain("U+1F600");
      expect(out.lines.join("\n")).not.toContain(emoji);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("regression: detects keycap and flag emoji sequences", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-messages-no-emoji-cli",
      `sequences-${Date.now()}`
    );
    const messagesDir = path.join(tmpRoot, "messages");
    const keycap = "1\uFE0F\u20E3";
    const flag = String.fromCodePoint(0x1f1fa, 0x1f1f8);

    const writeJson = (p: string, data: unknown) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    };

    try {
      writeJson(path.join(messagesDir, "en", "provider-chain.json"), {
        timeline: { circuitTriggered: `Warning ${keycap} ${flag}` },
      });

      const out = audit.run([`--messagesDir=${messagesDir}`, "--format=tsv", "--fail"]);
      expect(out.exitCode).toBe(1);
      expect(out.lines.join("\n")).toContain("U+0031+U+FE0F+U+20E3");
      expect(out.lines.join("\n")).toContain("U+1F1FA+U+1F1F8");
      expect(out.lines.join("\n")).not.toContain(keycap);
      expect(out.lines.join("\n")).not.toContain(flag);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("helpers format codepoints and list emoji codepoints in order", () => {
    expect(audit.toCodepoint(0x1f600)).toBe("U+1F600");
    expect(audit.toCodepoint(0x2639)).toBe("U+2639");

    const emojiA = String.fromCodePoint(0x1f600);
    const emojiB = String.fromCodePoint(0x1f680);
    expect(audit.listEmojiCodepoints(`x ${emojiA}${emojiB}${emojiA}`)).toEqual([
      "U+1F600",
      "U+1F680",
      "U+1F600",
    ]);

    const keycap = "1\uFE0F\u20E3";
    const flag = String.fromCodePoint(0x1f1fa, 0x1f1f8);
    expect(audit.listEmojiCodepoints(`a${keycap}b${flag}c`)).toEqual([
      "U+0031+U+FE0F+U+20E3",
      "U+1F1FA+U+1F1F8",
    ]);
  });

  test("run() supports text/json output and locales filtering", () => {
    const tmpRoot = path.join(
      process.cwd(),
      "tests",
      ".tmp-audit-messages-no-emoji-cli",
      `formats-${Date.now()}`
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
      });
      writeJson(path.join(messagesDir, "ja", "dashboard.json"), {
        hero: { title: `Dash ${emoji}` },
      });

      const outText = audit.run([`--messagesDir=${messagesDir}`, "--locales=en,ja"]);
      expect(outText.exitCode).toBe(0);
      expect(outText.lines[0]).toBe("Found 2 messages strings containing emoji:");

      const outJson = audit.run([`--messagesDir=${messagesDir}`, "--locales=en", "--format=json"]);
      expect(outJson.exitCode).toBe(0);
      const parsed = JSON.parse(outJson.lines.join("\n")) as Array<{ file: string; key: string }>;
      expect(parsed).toEqual([
        {
          codepoints: ["U+1F600"],
          emojiCount: 1,
          file: "messages/en/settings/common.json",
          key: "settings.common.greeting",
        },
      ]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("regression: repo messages JSON stays emoji-free", () => {
    const out = audit.run(["--fail"]);
    expect(out.exitCode).toBe(0);
  });
});
