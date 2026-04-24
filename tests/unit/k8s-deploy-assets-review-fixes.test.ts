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
    const traefikIngressRoute = readRepoFile("deploy/k8s/ingress/traefik-ingressroute.yaml");

    expect(pdb).toContain("maxUnavailable: 1");
    expect(pdb).not.toContain("minAvailable: 1");
    expect(ingress).toContain(
      'traefik.ingress.kubernetes.io/router.middlewares: "{{NAMESPACE}}-streaming-headers@kubernetescrd"'
    );
    expect(ingress).not.toContain("nginx.ingress.kubernetes.io/configuration-snippet: |");
    expect(ingress).toContain("allow-snippet-annotations=false");
    expect(ingress).toContain("trusted proxies / real-ip");
    expect(ingress).toContain('ingressClassName: "{{INGRESS_CLASS}}"');
    expect(ingress).toContain('- host: "{{INGRESS_HOST}}"');
    expect(traefikIngressRoute).toContain("Traefik 默认会继续透传 X-Forwarded-For");
    expect(traefikIngressRoute).toContain("forwardedHeaders.trustedIPs");
  });

  it("documents and enforces the NodePort-safe deployment path", () => {
    const deployScript = readRepoFile("scripts/deploy-k8s.sh");

    expect(deployScript).toContain('DEFAULT_IMAGE="ghcr.io/ding113/claude-code-hub:latest"');
    expect(deployScript).toContain("默认跟随 main 分支发布镜像");
    expect(deployScript).toContain("分支捷径 默认 main→:latest / dev→:dev");
    expect(deployScript).toContain("NodePort 模式下跳过 app NetworkPolicy");
    expect(deployScript).toContain("删除 namespace=$NAMESPACE 并重建所有资源");
    expect(deployScript).toContain("storageclass\\.beta\\.kubernetes\\.io/is-default-class");
    expect(deployScript).toContain("reclaimPolicy");
    expect(deployScript).not.toContain("| head -1");
    expect(deployScript).not.toContain('| head -c "$length"');
    expect(deployScript).not.toContain("dd if=/dev/urandom bs=256 count=1 status=none 2>/dev/null");
    expect(deployScript).not.toContain("| grep -q 'k3s'");
    expect(deployScript).not.toContain("| grep -q '^ingresses.*networking.k8s.io'");
    expect(deployScript).toContain("default_sc=\"${default_sc%%$'\\n'*}\"");
    expect(deployScript).toContain("api-resources --api-group=networking.k8s.io -o name");
    expect(deployScript).toContain("ingresses.networking.k8s.io");
    expect(deployScript).toContain('while [[ "${#random}" -lt "$length" ]]');
    expect(deployScript).toContain('if [[ "${DEPLOY_K8S_SOURCE_ONLY:-0}" != "1" ]]; then');
    expect(deployScript).toContain('if ! [[ "$APP_HPA_MIN" =~ ^[0-9]+$ ]]');
    expect(deployScript).toContain("node_ip=$($KUBECTL get nodes");
  });

  it("hardens cch config parsing and rollout diagnostics", () => {
    const cchScript = readRepoFile("scripts/cch");

    expect(cchScript).not.toContain('source "$CCH_CONFIG_FILE"');
    expect(cchScript).not.toContain(
      "IMAGE_DIGEST=$(sudo k3s ctr images ls 2>/dev/null | awk -v img=\"$IMAGE\" '$1==img {print $3; exit}')"
    );
    expect(cchScript).not.toContain("| grep -q 'k3s'");
    expect(cchScript).toContain("load_config_file()");
    expect(cchScript).toContain("resolve_k3s_image_digest()");
    expect(cchScript).toContain("build_image_ref_with_digest()");
    expect(cchScript).toContain("update_k3s_image_by_digest_or_restart");
    expect(cchScript).toContain(
      "kubectl version --client -o jsonpath='{.clientVersion.gitVersion}'"
    );
    expect(cchScript).toContain('if [[ -z "${!key:-}" ]]; then');
    expect(cchScript).toContain('if [[ "${1:-}" =~ ^[0-9]+$ ]]; then');
    expect(cchScript).toContain("if image_digest=$(resolve_k3s_image_digest");
    expect(cchScript).toContain("found==0 && $1==img { print $3; found=1 }");
    expect(cchScript).toContain("k3s ctr images ls 失败,回落到 rollout restart");
    expect(cchScript).toContain('if [[ "${CCH_SOURCE_ONLY:-0}" != "1" ]]; then');
    expect(cchScript).toContain("wait_for_deployment_rollout()");
    expect(cchScript).toContain('if ! wait_for_deployment_rollout 180s "缩容到 1 副本"; then');
    expect(cchScript).toContain('local desired_replicas="$CURRENT_REPLICAS"');
    expect(cchScript).toContain('restore_update_scaling "$desired_replicas" "$MIN_REPLICAS"');
    expect(cchScript).toContain("HPA minReplicas=");
    expect(cchScript).toContain("keep=30");
    expect(cchScript).toContain("if detect_runtime; then");
  });

  it("keeps the restore playbook compatible with CPU/memory HPA", () => {
    const docs = readRepoFile("docs/k8s-deployment.md");
    const k8sReadme = readRepoFile("deploy/k8s/README.md");

    expect(docs).toContain("默认 k8s 部署保持 `main -> ghcr.io/ding113/claude-code-hub:latest`");
    expect(docs).toContain("controller 级别配置 forwarded headers / real-ip");
    expect(docs).toContain("allow-snippet-annotations=true");
    expect(docs).toContain("proxy-real-ip-cidr");
    expect(docs).toContain("forwardedHeaders.trustedIPs");
    expect(docs).toContain("不保证严格回到上一份镜像 digest");
    expect(docs).toContain(
      '{ headers: [{ name: "x-real-ip" }, { name: "x-forwarded-for", pick: "rightmost" }] }'
    );
    expect(docs).toContain("kubectl -n claude-code-hub delete hpa claude-code-hub");
    expect(docs).toContain("恢复到 max(升级前实际副本数, HPA minReplicas)");
    expect(docs).toContain("<repeat-your-original-cli-args>");
    expect(docs).not.toContain('minReplicas":0');
    expect(docs).toContain("```text");
    expect(docs).toContain("```console");
    expect(k8sReadme).toContain(
      "默认等价 main 分支发布镜像 -> ghcr.io/ding113/claude-code-hub:latest"
    );
    expect(k8sReadme).toContain("X-Forwarded-For");
    expect(k8sReadme).toContain("allow-snippet-annotations=false");
    expect(k8sReadme).toContain("proxy-real-ip");
  });
});
