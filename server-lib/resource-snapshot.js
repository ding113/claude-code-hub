"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path").posix;

function finiteBytes(raw) {
  if (raw == null || String(raw).trim() === "" || String(raw).trim() === "max") return null;
  const value = Number(String(raw).trim());
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** 只计算当前进程还可以增长的容量；可见祖先的限制同样有效。 */
function readResourceSnapshot(options = {}) {
  const read = options.readFileSync || fs.readFileSync;
  const safeRead = (name) => {
    try { return String(read(name, "utf8")).trim(); } catch { return null; }
  };
  let ram = Math.max(0, (options.freeMemory || os.freemem)());
  let swap = 0;
  if ((options.platform || process.platform) !== "linux") {
    return { availableRamBytes: ram, availableSwapBytes: swap };
  }
  const meminfo = safeRead("/proc/meminfo") || "";
  const memValue = (key) => {
    const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, "m"));
    return match ? finiteBytes(Number(match[1]) * 1024) : null;
  };
  ram = memValue("MemAvailable") ?? ram;
  swap = memValue("SwapFree") ?? 0;
  const memberships = (safeRead("/proc/self/cgroup") || "").split("\n");
  const mounts = (safeRead("/proc/self/mountinfo") || "").split("\n");
  let combinedRemaining = Infinity;
  let hasMemoryController = false;
  let hasSwapAccounting = false;
  for (const line of mounts) {
    const [left, right] = line.split(" - ");
    if (!right) continue;
    const fields = left.split(" ");
    if (fields.length < 5) continue;
    const [kind, , flags = ""] = right.split(" ");
    const v2 = kind === "cgroup2";
    if (!v2 && !(kind === "cgroup" && flags.split(",").includes("memory"))) continue;
    const membership = memberships.find((entry) => {
      const parts = entry.split(":");
      return v2 ? parts[0] === "0" : (parts[1] || "").split(",").includes("memory");
    });
    if (!membership) continue;
    const decode = (value) => value.replace(/\\([0-7]{3})/g, (_, n) => String.fromCharCode(Number.parseInt(n, 8)));
    const root = path.normalize(decode(fields[3]));
    const mount = path.normalize(decode(fields[4]));
    const member = path.normalize(membership.slice(membership.indexOf(":", membership.indexOf(":") + 1) + 1));
    const inside = root === "/" || member === root || member.startsWith(`${root}/`);
    // cgroup namespace 可将 membership 显示为 /，而 mountinfo 保留宿主机 root。
    // 无法映射成员路径时仍检查可见挂载根的限制。
    let directory = inside ? path.join(mount, path.relative(root, member)) : mount;
    while (directory === mount || directory.startsWith(`${mount}/`)) {
      const number = (file) => finiteBytes(safeRead(path.join(directory, file)));
      const current = number(v2 ? "memory.current" : "memory.usage_in_bytes");
      if (current !== null) hasMemoryController = true;
      for (const limitFile of v2 ? ["memory.max", "memory.high"] : ["memory.limit_in_bytes"]) {
        const limit = number(limitFile);
        if (limit !== null) {
          hasMemoryController = true;
          ram = Math.min(ram, current === null ? 0 : Math.max(0, limit - current));
        }
      }
      if (v2) {
        const rawLimit = safeRead(path.join(directory, "memory.swap.max"));
        const limit = finiteBytes(rawLimit);
        const used = number("memory.swap.current");
        if (rawLimit === "max" || (limit !== null && used !== null)) hasSwapAccounting = true;
        if (limit !== null) swap = Math.min(swap, used === null ? 0 : Math.max(0, limit - used));
      } else {
        const limit = number("memory.memsw.limit_in_bytes");
        const used = number("memory.memsw.usage_in_bytes");
        if (limit !== null && used !== null) {
          hasSwapAccounting = true;
          combinedRemaining = Math.min(combinedRemaining, Math.max(0, limit - used));
        }
      }
      if (directory === mount) break;
      directory = path.dirname(directory);
    }
  }
  ram = Math.min(ram, combinedRemaining);
  swap = Math.min(swap, Math.max(0, combinedRemaining - ram));
  if (hasMemoryController && !hasSwapAccounting) swap = 0;
  const psi = safeRead("/proc/pressure/memory") || "";
  const full = psi.match(/^full avg10=([\d.]+)/m);
  const vmstat = safeRead("/proc/vmstat") || "";
  const swapIO = ["pswpin", "pswpout"].reduce((sum, key) => {
    const match = vmstat.match(new RegExp(`^${key} (\\d+)$`, "m"));
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
  return { availableRamBytes: ram, availableSwapBytes: swap, memoryPressure: Number(full?.[1] || 0), swapIO };
}

module.exports = { readResourceSnapshot };
