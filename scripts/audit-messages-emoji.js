const fs = require("node:fs");
const path = require("node:path");

const EMOJI_RE =
  /(\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)/gu;

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function flattenLeafStrings(value, prefix = "") {
  if (typeof value === "string") return [{ key: prefix, value }];
  if (!value || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((v, index) => {
      const key = prefix ? `${prefix}.${index}` : String(index);
      return flattenLeafStrings(v, key);
    });
  }

  return Object.entries(value).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v) || Array.isArray(v)) return flattenLeafStrings(v, key);
    return flattenLeafStrings(v, key);
  });
}

function listJsonFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

function fileToKeyPrefix(relFile) {
  const segs = relFile.replace(/\.json$/, "").split(path.sep);
  if (segs[segs.length - 1] === "strings") return segs.slice(0, -1).join(".");
  return segs.join(".");
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function countEmojiCodepoints(s) {
  EMOJI_RE.lastIndex = 0;
  let count = 0;
  // eslint-disable-next-line no-unused-vars
  for (const _ of s.matchAll(EMOJI_RE)) count += 1;
  return count;
}

function maskEmoji(s) {
  EMOJI_RE.lastIndex = 0;
  return s.replace(EMOJI_RE, "<emoji>");
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

function findMessagesEmoji({ messagesDir, locales }) {
  const root = messagesDir || path.join(process.cwd(), "messages");
  const targets = normalizeLocales(root, locales);
  const rows = [];

  for (const locale of targets) {
    const localeDir = path.join(root, locale);
    if (!fs.existsSync(localeDir) || !fs.statSync(localeDir).isDirectory()) continue;

    const files = listJsonFiles(localeDir);
    for (const file of files) {
      const relFile = path.relative(localeDir, file);
      const keyPrefix = fileToKeyPrefix(relFile);
      const obj = loadJson(file);

      for (const leaf of flattenLeafStrings(obj)) {
        if (typeof leaf.value !== "string") continue;
        const emojiCount = countEmojiCodepoints(leaf.value);
        if (emojiCount === 0) continue;

        const fullKey = keyPrefix
          ? leaf.key
            ? `${keyPrefix}.${leaf.key}`
            : keyPrefix
          : leaf.key;

        rows.push({
          locale,
          relFile: relFile.replaceAll(path.sep, "/"),
          key: fullKey,
          emojiCount,
          preview: maskEmoji(leaf.value),
        });
      }
    }
  }

  const byLocaleCount = {};
  const byFileCount = {};
  let totalEmojiCount = 0;

  for (const r of rows) {
    byLocaleCount[r.locale] = (byLocaleCount[r.locale] || 0) + 1;
    const fileKey = `${r.locale}/${r.relFile}`;
    byFileCount[fileKey] = (byFileCount[fileKey] || 0) + 1;
    totalEmojiCount += r.emojiCount;
  }

  const sortedRows = rows.sort((a, b) => {
    const c0 = a.locale.localeCompare(b.locale);
    if (c0 !== 0) return c0;
    const c1 = a.relFile.localeCompare(b.relFile);
    if (c1 !== 0) return c1;
    return a.key.localeCompare(b.key);
  });

  return {
    rows: sortedRows,
    totalRowCount: sortedRows.length,
    totalEmojiCount,
    byLocaleCount,
    byFileCount,
  };
}

function topFiles(byFileCount, limit = 10) {
  return Object.entries(byFileCount)
    .map(([k, v]) => ({ key: k, count: v }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ key, count }) => {
      const [locale, ...rest] = key.split("/");
      return { locale, relFile: rest.join("/"), count };
    });
}

function run(argv) {
  const messagesDirArg = argv.find((a) => a.startsWith("--messagesDir="));
  const messagesDir = messagesDirArg ? messagesDirArg.split("=", 2)[1] : undefined;
  const localesArg = argv.find((a) => a.startsWith("--locales="));
  const locales = localesArg ? localesArg.split("=", 2)[1] : undefined;
  const formatArg = argv.find((a) => a.startsWith("--format="));
  const format = formatArg ? formatArg.split("=", 2)[1] : "text";

  const report = findMessagesEmoji({ messagesDir, locales });
  const total = report.totalRowCount;

  if (total === 0) {
    return { exitCode: 0, lines: ["OK: no emoji found in messages JSON."] };
  }

  if (format === "json") {
    return { exitCode: 0, lines: [JSON.stringify(report.rows, null, 2)] };
  }

  if (format === "tsv") {
    const lines = ["locale\trelFile\tkey\temojiCount\tpreview"];
    for (const r of report.rows) {
      lines.push(`${r.locale}\t${r.relFile}\t${r.key}\t${r.emojiCount}\t${r.preview}`);
    }
    return { exitCode: 0, lines };
  }

  const lines = [
    `Found ${total} messages strings containing emoji (${report.totalEmojiCount} total emoji codepoints).`,
    "Top files by row count (locale\trelFile\trows):",
    ...topFiles(report.byFileCount).map((r) => `${r.locale}\t${r.relFile}\t${r.count}`),
    "Rows (locale\trelFile\tkey):",
    ...report.rows.map((r) => `${r.locale}\t${r.relFile}\t${r.key}`),
  ];

  return { exitCode: 0, lines };
}

module.exports = {
  countEmojiCodepoints,
  fileToKeyPrefix,
  findMessagesEmoji,
  flattenLeafStrings,
  listJsonFiles,
  maskEmoji,
  run,
};

if (require.main === module) {
  const out = run(process.argv.slice(2));
  for (const line of out.lines) console.log(line); // eslint-disable-line no-console
  process.exit(out.exitCode);
}
