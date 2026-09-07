import { createCoverageConfig } from "../vitest.base.mts";

export default createCoverageConfig({
  name: "memory-aware",
  environment: "node",
  testFiles: [
    "tests/unit/server-memory-*.test.ts",
    "tests/unit/server-spool-directory.test.ts",
    "tests/unit/proxy/memory-aware-*.test.ts",
    "tests/unit/proxy/stream-gate-frame-probe.test.ts",
    "tests/unit/proxy/stream-gate-ttft-regression.test.ts",
    "tests/unit/proxy/stream-gate-content-gate.test.ts",
    "src/app/v1/_lib/proxy/stream-gate/prebuffer-budget.test.ts",
  ],
  sourceFiles: [
    "server-lib/memory-*.js",
    "server-lib/resource-snapshot.js",
    "server-lib/spool-directory.js",
    "src/lib/body-store/*.ts",
    "src/lib/memory/json-probe.ts",
    "src/lib/memory/http.ts",
    "src/lib/memory/request-lifetime.ts",
    "src/app/v1/_lib/proxy/stream-gate/frame-probe.ts",
    "src/app/v1/_lib/proxy/stream-gate/probed-sse-frames.ts",
    "src/app/v1/_lib/proxy/stream-gate/prepared-gate.ts",
  ],
  thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
});
