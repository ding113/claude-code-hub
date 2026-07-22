import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "session-binding",
  environment: "node",
  testFiles: ["tests/unit/lib/redis/session-binding.test.ts"],
  sourceFiles: ["src/lib/redis/session-binding.ts"],
  thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
});
