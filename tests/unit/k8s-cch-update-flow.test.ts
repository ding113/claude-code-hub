import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runCchHelper(scriptBody: string) {
  return execFileSync(
    "bash",
    [
      "-lc",
      `
set -euo pipefail
export CCH_SOURCE_ONLY=1
source scripts/cch
${scriptBody}
      `,
    ],
    {
      encoding: "utf8",
      cwd: process.cwd(),
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    }
  ).trim();
}

function runK3sUpdateHarness(options: { k3sBody: string; kubectlBody?: string; tail?: string }) {
  const kubectlBody =
    options.kubectlBody ??
    `
  printf '%s\\n' "$*" >> "$LOG_FILE"
`;
  const tail =
    options.tail ??
    `
update_k3s_image_by_digest_or_restart "$IMAGE"
cat "$LOG_FILE"
`;

  return runCchHelper(`
LOG_FILE=$(mktemp)
KUBECTL=kubectl_stub
NAMESPACE=test-ns
IMAGE=ghcr.io/ding113/claude-code-hub:latest

kubectl_stub() {
${kubectlBody}
}

sudo() {
  "$@"
}

k3s() {
${options.k3sBody}
}

${tail}
  `);
}

describe("scripts/cch k3s update flow", () => {
  it("pins the deployment image by digest when ctr returns a sha256 digest", () => {
    const output = runK3sUpdateHarness({
      k3sBody: `
  cat <<'EOF'
ghcr.io/ding113/claude-code-hub:latest READY sha256:abc123
EOF
`,
    });

    expect(output).toContain(
      "-n test-ns set image deployment/claude-code-hub app=ghcr.io/ding113/claude-code-hub@sha256:abc123"
    );
    expect(output).not.toContain("rollout restart deployment/claude-code-hub");
  });

  it("replaces an existing digest ref instead of appending a second @sha256 segment", () => {
    const output = runCchHelper(`
printf '%s' "$(build_image_ref_with_digest 'ghcr.io/ding113/claude-code-hub@sha256:old' 'sha256:new')"
    `);

    expect(output).toBe("ghcr.io/ding113/claude-code-hub@sha256:new");
  });

  it("keeps registry ports intact when converting a tagged ref to digest form", () => {
    const output = runCchHelper(`
printf '%s' "$(build_image_ref_with_digest 'registry.example.com:5000/team/cch:latest' 'sha256:new')"
    `);

    expect(output).toBe("registry.example.com:5000/team/cch@sha256:new");
  });

  it("falls back to rollout restart when ctr succeeds but no matching digest is found", () => {
    const output = runK3sUpdateHarness({
      k3sBody: `
  cat <<'EOF'
ghcr.io/ding113/claude-code-hub:dev READY sha256:def456
EOF
`,
    });

    expect(output).toContain(
      "-n test-ns set image deployment/claude-code-hub app=ghcr.io/ding113/claude-code-hub:latest"
    );
    expect(output).toContain("-n test-ns rollout restart deployment/claude-code-hub");
  });

  it("falls back to rollout restart when ctr exits non-zero", () => {
    const output = runK3sUpdateHarness({
      k3sBody: "  return 1",
    });

    expect(output).toContain(
      "-n test-ns set image deployment/claude-code-hub app=ghcr.io/ding113/claude-code-hub:latest"
    );
    expect(output).toContain("-n test-ns rollout restart deployment/claude-code-hub");
  });

  it("fails fast when fallback set image itself fails", () => {
    expect(() =>
      runK3sUpdateHarness({
        kubectlBody: `
  if [[ "$3" == "set" && "$4" == "image" ]]; then
    return 1
  fi
  printf '%s\\n' "$*" >> "$LOG_FILE"
`,
        k3sBody: "  return 1",
        tail: 'update_k3s_image_by_digest_or_restart "$IMAGE"',
      })
    ).toThrow(/set image 失败，未能应用目标镜像/);
  });

  it("reads kubectl client version without an awk early-exit pipeline", () => {
    const output = runCchHelper(`
command() {
  if [[ "$1" == "-v" && "$2" == "kubectl" ]]; then
    return 0
  fi
  if [[ "$1" == "-v" && "$2" == "k3s" ]]; then
    return 1
  fi
  builtin command "$@"
}

kubectl() {
  if [[ "$1" == "cluster-info" ]]; then
    return 0
  fi
  if [[ "$1" == "get" && "$2" == "nodes" ]]; then
    printf 'v1.31.0+k3s1'
    return 0
  fi
  if [[ "$1" == "version" ]]; then
    printf 'v1.31.0'
    return 0
  fi
  return 1
}

detect_runtime
cmd_doctor
    `);

    expect(output).toContain("kubectl installed: v1.31.0");
    expect(output).toContain("Runtime detected (runtime=k3s, kubectl=kubectl)");
  });
});
