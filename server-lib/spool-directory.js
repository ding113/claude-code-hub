"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function getSpoolRoot(env = process.env) {
  return path.resolve(/*turbopackIgnore: true*/ env.CCH_MEMORY_SPILL_DIR || path.join(os.tmpdir(), "cch-spool"));
}
function processStart(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch { return "unknown"; }
}
const identity = processStart(process.pid);
function spoolPrefix() { return `cch-${process.pid}-${identity}-`; }
function getSpoolBudget() {
  const key = Symbol.for("cch.spoolDiskBudget");
  globalThis[key] ||= { bytes: 0, files: 0 };
  return globalThis[key];
}

/** 专用目录只能属于一个部署。只有确认进程已退出或 PID 已复用才删除遗留文件。 */
async function cleanupOrphanSpools(root = getSpoolRoot()) {
  const absoluteRoot = path.resolve(/*turbopackIgnore: true*/ root);
  let entries;
  try { entries = await fs.promises.readdir(absoluteRoot, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    const match = /^cch-(\d+)-(\d+|unknown)-[a-zA-Z0-9]+$/.exec(entry.name);
    if (!match || !entry.isDirectory()) continue;
    const pid = Number(match[1]);
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { alive = error.code !== "ESRCH"; }
    const start = alive ? processStart(pid) : "unknown";
    if (alive && (start === "unknown" || match[2] === "unknown" || start === match[2])) continue;
    const target = path.resolve(absoluteRoot, entry.name);
    if (path.dirname(target) !== absoluteRoot) continue;
    await fs.promises.rm(target, { recursive: true, force: true });
  }
}

module.exports = { getSpoolRoot, spoolPrefix, cleanupOrphanSpools, getSpoolBudget };
