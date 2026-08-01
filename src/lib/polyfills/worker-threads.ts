import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);
const workerThreads = nodeRequire("node:worker_threads") as {
  markAsUncloneable?: (...args: unknown[]) => void;
};

// undici >= 8 destructures markAsUncloneable from node:worker_threads without
// a fallback. Bun (Docker build stage) does not implement this Node.js 23+ API,
// so next build crashes during page data collection.
if (typeof workerThreads.markAsUncloneable !== "function") {
  workerThreads.markAsUncloneable = function markAsUncloneable() {};
}
