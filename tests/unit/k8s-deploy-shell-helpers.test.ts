import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runDeployHelper(scriptBody: string) {
  return execFileSync(
    "bash",
    [
      "-lc",
      `
set -euo pipefail
export DEPLOY_K8S_SOURCE_ONLY=1
source scripts/deploy-k8s.sh
${scriptBody}
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    }
  ).trim();
}

describe("scripts/deploy-k8s.sh shell helpers", () => {
  it("generate_random fallback returns exact-length alnum output without openssl", () => {
    const output = runDeployHelper(`
has_command() {
  if [[ "$1" == "openssl" ]]; then
    return 1
  fi
  return 0
}

value=$(generate_random 40)
printf '%s\\n%s' "$value" "\${#value}"
    `);

    const [value, length] = output.split("\n");
    expect(length).toBe("40");
    expect(value).toMatch(/^[A-Za-z0-9]{40}$/);
  });

  it("detect_storage_class picks the first discovered default class without head pipelines", () => {
    const output = runDeployHelper(`
KUBECTL=kubectl_stub
RUNTIME=kubectl
STORAGE_CLASS=""
STORAGE_CLASS_ARG=""

log_info() { :; }
head() {
  printf 'unexpected head invocation\\n' >&2
  return 99
}

kubectl_stub() {
  if [[ "$1" == "get" && "$2" == "sc" ]]; then
    printf 'fast\\nslow\\n'
    return 0
  fi
  return 1
}

detect_storage_class
printf '%s' "$STORAGE_CLASS"
    `);

    expect(output).toBe("fast");
  });

  it("detect_runtime and detect_ingress_variant use full output matching instead of grep pipes", () => {
    const output = runDeployHelper(`
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
  if [[ "$1" == "get" && "$2" == "crd" ]]; then
    return 1
  fi
  if [[ "$1" == "api-resources" && "$2" == "--api-group=networking.k8s.io" && "$3" == "-o" && "$4" == "name" ]]; then
    printf 'ingresses.networking.k8s.io\\n'
    return 0
  fi
  if [[ "$1" == "get" && "$2" == "ingressclass" ]]; then
    printf 'nginx'
    return 0
  fi
  return 1
}

log_info() { :; }
log_warning() { :; }

INGRESS_HOST=hub.example.com
INGRESS_CLASS_ARG=""
DISABLE_INGRESS=false

detect_runtime
detect_ingress_variant
printf '%s\\n%s\\n%s' "$RUNTIME" "$INGRESS_VARIANT" "$INGRESS_CLASS"
    `);

    expect(output).toBe("k3s\nstandard\nnginx");
  });

  it("detect_ingress_variant ignores unrelated networking.k8s.io resource names", () => {
    const output = runDeployHelper(`
KUBECTL=kubectl_stub
INGRESS_HOST=hub.example.com
INGRESS_CLASS_ARG=""
DISABLE_INGRESS=false

log_info() { :; }
log_warning() { :; }

kubectl_stub() {
  if [[ "$1" == "get" && "$2" == "crd" ]]; then
    return 1
  fi
  if [[ "$1" == "api-resources" && "$2" == "--api-group=networking.k8s.io" && "$3" == "-o" && "$4" == "name" ]]; then
    printf 'gateways.gateway.networking.k8s.io\\ningresses.extensions\\n'
    return 0
  fi
  return 1
}

detect_ingress_variant
printf '%s\\n%s' "$INGRESS_VARIANT" "$APP_SERVICE_TYPE"
    `);

    expect(output).toBe("nodeport\nNodePort");
  });
});
