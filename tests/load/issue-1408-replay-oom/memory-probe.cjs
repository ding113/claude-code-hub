"use strict";

const v8 = require("node:v8");

const rawInterval = process.env.CCH_MEMORY_PROBE_INTERVAL_MS || "1000";
const intervalMs = Number(rawInterval);
if (!Number.isInteger(intervalMs) || intervalMs < 10 || intervalMs > 60000) {
  throw new Error("CCH_MEMORY_PROBE_INTERVAL_MS must be an integer between 10 and 60000");
}

function toMiB(value) {
  return Number((value / 1048576).toFixed(2));
}

function sample() {
  const memory = process.memoryUsage();
  const resources =
    typeof process.getActiveResourcesInfo === "function" ? process.getActiveResourcesInfo() : [];
  const resourceCounts = {};
  for (const name of resources) {
    resourceCounts[name] = (resourceCounts[name] || 0) + 1;
  }

  process.stdout.write(
    `${JSON.stringify({
      cchMemoryProbe: true,
      ts: Date.now(),
      rssMiB: toMiB(memory.rss),
      heapUsedMiB: toMiB(memory.heapUsed),
      heapTotalMiB: toMiB(memory.heapTotal),
      externalMiB: toMiB(memory.external),
      arrayBuffersMiB: toMiB(memory.arrayBuffers),
      mallocedMiB: toMiB(v8.getHeapStatistics().malloced_memory),
      resources: resourceCounts,
    })}\n`
  );
}

const timer = setInterval(sample, intervalMs);
timer.unref();
sample();
