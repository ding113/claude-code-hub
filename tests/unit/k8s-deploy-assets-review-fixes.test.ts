import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("k8s deploy review regressions", () => {
  it("keeps redis probes off the command-line password path and leaves memory headroom", () => {
    const redisStatefulSet = readRepoFile("deploy/k8s/redis/statefulset.yaml");

    expect(redisStatefulSet).toContain(
      'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning ping'
    );
    expect(redisStatefulSet).not.toContain('redis-cli -a "$REDIS_PASSWORD" ping');
    expect(redisStatefulSet).toContain("maxmemory 3gb");
    expect(redisStatefulSet).not.toContain("maxmemory 4gb");
  });

  it("removes the stale migration allowlist from postgres NetworkPolicy", () => {
    const postgresNetworkPolicy = readRepoFile("deploy/k8s/postgres/networkpolicy.yaml");
    const postgresStatefulSet = readRepoFile("deploy/k8s/postgres/statefulset.yaml");

    expect(postgresNetworkPolicy).not.toContain("component: migration");
    expect(postgresStatefulSet).toContain("shared_buffers=1GB");
    expect(postgresStatefulSet).not.toContain("statement_timeout=60000");
    expect(postgresStatefulSet).not.toContain("idle_in_transaction_session_timeout=30000");
  });

  it("uses replica-safe disruption settings and lint-safe ingress placeholders", () => {
    const pdb = readRepoFile("deploy/k8s/app/pdb.yaml");
    const ingress = readRepoFile("deploy/k8s/ingress/ingress.yaml");

    expect(pdb).toContain("maxUnavailable: 1");
    expect(pdb).not.toContain("minAvailable: 1");
    expect(ingress).toContain(
      'traefik.ingress.kubernetes.io/router.middlewares: "{{NAMESPACE}}-streaming-headers@kubernetescrd"'
    );
    expect(ingress).toContain('ingressClassName: "{{INGRESS_CLASS}}"');
    expect(ingress).toContain('- host: "{{INGRESS_HOST}}"');
  });

  it("documents and enforces the NodePort-safe deployment path", () => {
    const deployScript = readRepoFile("scripts/deploy-k8s.sh");

    expect(deployScript).toContain("NodePort 模式下跳过 app NetworkPolicy");
    expect(deployScript).toContain("删除 namespace=$NAMESPACE 并重建所有资源");
  });

  it("hardens cch config parsing and rollout diagnostics", () => {
    const cchScript = readRepoFile("scripts/cch");

    expect(cchScript).not.toContain('source "$CCH_CONFIG_FILE"');
    expect(cchScript).toContain("load_config_file()");
    expect(cchScript).toContain('if [[ "${1:-}" =~ ^[0-9]+$ ]]; then');
    expect(cchScript).toContain("wait_for_deployment_rollout()");
    expect(cchScript).toContain('if ! wait_for_deployment_rollout 180s "缩容到 1 副本"; then');
    expect(cchScript).toContain("if detect_runtime; then");
  });

  it("keeps the restore playbook compatible with CPU/memory HPA", () => {
    const docs = readRepoFile("docs/k8s-deployment.md");

    expect(docs).toContain("kubectl -n claude-code-hub delete hpa claude-code-hub");
    expect(docs).not.toContain('minReplicas":0');
  });
});
