const fs = require("node:fs");
const path = require("node:path");
const emojiAudit = require("./audit-messages-emoji.js");

const EMOJI_RE =
  /(\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)/gu;

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function normalizeLocales(messagesRoot, locales) {
  if (typeof locales === "string") return normalizeLocales(messagesRoot, [locales]);
  if (Array.isArray(locales) && locales.length > 0) {
    return locales
      .flatMap((s) => String(s).split(","))
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const dirs = fs.readdirSync(messagesRoot, { withFileTypes: true });
  return dirs
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

function toCodepoint(cp) {
  const hex = cp.toString(16).toUpperCase();
  return `U+${hex.padStart(4, "0")}`;
}

function listEmojiCodepoints(value) {
  EMOJI_RE.lastIndex = 0;
  const out = [];
  for (const m of value.matchAll(EMOJI_RE)) {
    const seq = Array.from(m[0])
      .map((ch) => ch.codePointAt(0))
      .filter((cp) => typeof cp === "number")
      .map((cp) => toCodepoint(cp))
      .join("+");
    if (seq) out.push(seq);
  }
  return out;
}

function findMessagesEmojiMatches({ messagesDir, locales }) {
  const root = messagesDir || path.join(process.cwd(), "messages");
  const targets = normalizeLocales(root, locales);
  const rows = [];

  for (const locale of targets) {
    const localeDir = path.join(root, locale);
    if (!fs.existsSync(localeDir) || !fs.statSync(localeDir).isDirectory()) continue;

    const files = emojiAudit.listJsonFiles(localeDir);
    for (const file of files) {
      const relFileNative = path.relative(localeDir, file);
      const relFilePosix = relFileNative.replaceAll(path.sep, "/");
      const keyPrefix = emojiAudit.fileToKeyPrefix(relFileNative);
      const obj = loadJson(file);

      for (const leaf of emojiAudit.flattenLeafStrings(obj)) {
        if (typeof leaf.value !== "string") continue;
        const emojiCount = emojiAudit.countEmojiCodepoints(leaf.value);
        if (emojiCount === 0) continue;

        const fullKey = keyPrefix
          ? leaf.key
            ? `${keyPrefix}.${leaf.key}`
            : keyPrefix
          : leaf.key;

        const codepoints = Array.from(new Set(listEmojiCodepoints(leaf.value))).sort((a, b) =>
          a.localeCompare(b)
        );

        rows.push({
          file: path.posix.join("messages", locale, relFilePosix),
          key: fullKey,
          emojiCount,
          codepoints,
        });
      }
    }
  }

  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key));
}

function run(argv) {
  const fail = argv.includes("--fail");
  const messagesDirArg = argv.find((a) => a.startsWith("--messagesDir="));
  const messagesDir = messagesDirArg ? messagesDirArg.split("=", 2)[1] : undefined;
  const localesArg = argv.find((a) => a.startsWith("--locales="));
  const locales = localesArg ? localesArg.split("=", 2)[1] : undefined;
  const formatArg = argv.find((a) => a.startsWith("--format="));
  const format = formatArg ? formatArg.split("=", 2)[1] : "text";

  const rows = findMessagesEmojiMatches({ messagesDir, locales });
  const total = rows.length;

  if (total === 0) {
    return { exitCode: 0, lines: ["OK: no emoji found in messages JSON."] };
  }

  const exitCode = fail ? 1 : 0;

  if (format === "json") {
    return { exitCode, lines: [JSON.stringify(rows, null, 2)] };
  }

  if (format === "tsv") {
    const lines = ["file\tkey\temojiCount\tcodepoints"];
    for (const r of rows) {
      lines.push(`${r.file}\t${r.key}\t${r.emojiCount}\t${r.codepoints.join(",")}`);
    }
    return { exitCode, lines };
  }

  const lines = [`Found ${total} messages strings containing emoji:`];
  for (const r of rows) lines.push(`${r.file}\t${r.key}\t${r.codepoints.join(",")}`);
  return { exitCode, lines };
}

module.exports = {
  findMessagesEmojiMatches,
  listEmojiCodepoints,
  run,
  toCodepoint,
};

if (require.main === module) {
  const out = run(process.argv.slice(2));
  for (const line of out.lines) console.log(line); // eslint-disable-line no-console
  process.exit(out.exitCode);
}
