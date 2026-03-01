import { createCoverageConfig } from "../vitest.base";

export default createCoverageConfig({
  name: "codex-session-id-completer",
  environment: "happy-dom",
  testFiles: ["tests/unit/codex/session-completer.test.ts"],
  sourceFiles: ["src/app/v1/_lib/codex/session-completer.ts"],
  thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
});
