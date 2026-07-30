# CC Hub — K8s Manifests

本目录是 Kubernetes 部署清单模板,由 `scripts/deploy-k8s.sh` 在部署时做占位符替换后下发到集群。
不建议直接 `kubectl apply -f` 本目录 — 文件中包含 `{{VAR}}` 占位符,需先渲染。

## 目录结构

```
deploy/k8s/
├── namespace.yaml                     # 命名空间
├── app/                               # 应用层
│   ├── deployment.yaml                #   Deployment (2 副本基线;Session 快照使用节点 hostPath)
│   ├── service.yaml                   #   Service (可渲染为 ClusterIP/NodePort)
│   ├── hpa.yaml                       #   HPA (CPU 70%)
│   ├── pdb.yaml                       #   PodDisruptionBudget (maxUnavailable=1)
│   └── networkpolicy.yaml             #   NetworkPolicy (仅在 Ingress 模式应用)
├── postgres/                          # PostgreSQL StatefulSet
│   ├── statefulset.yaml
│   ├── service.yaml                   #   ClusterIP (不对外)
│   └── networkpolicy.yaml             #   仅允许 app 访问
├── redis/                             # Redis StatefulSet
│   ├── statefulset.yaml               #   密码保护 + AOF
│   ├── service.yaml                   #   ClusterIP (不对外)
│   └── networkpolicy.yaml             #   仅允许 app 访问
└── ingress/
    ├── ingress.yaml                   # 标准 Ingress (nginx/traefik/其他)
    └── traefik-ingressroute.yaml      # Traefik IngressRoute 备选 (k3s 默认)
```

## 客户端 IP 透传

- `ingress/ingress.yaml` 不默认依赖 `configuration-snippet`; 标准 Ingress 路径要求你在
  controller 级别打开 forwarded-header / real-ip 配置,避免被
  `allow-snippet-annotations=false` 的默认安装直接拒绝。
- 若你还希望应用优先信任 `X-Real-IP`,请先在 ingress controller / 上游 LB 上正确配置
  trusted proxies / real-ip(`use-forwarded-headers`、`proxy-real-ip-cidr` 等)。
- `ingress/traefik-ingressroute.yaml` 依赖 Traefik 默认透传 `X-Forwarded-For`;
  `X-Real-Ip` 是否可信取决于 `forwardedHeaders.trustedIPs` 等 entrypoint 配置。
- 应用侧的默认提取链仍等价于
  `{ headers: [{ name: "x-real-ip" }, { name: "x-forwarded-for", pick: "rightmost" }] }`。

## 占位符参考

| 占位符 | 含义 | 默认值 |
|-------|------|--------|
| `{{NAMESPACE}}` | K8s namespace | `claude-code-hub` |
| `{{APP_IMAGE}}` | 应用镜像 | `ghcr.io/ding113/claude-code-hub:latest` |
| `{{APP_REPLICAS}}` | 基线副本数 | `2` |
| `{{APP_HPA_MIN}}` / `{{APP_HPA_MAX}}` | HPA 上下限 | `2` / `6` |
| `{{APP_SERVICE_TYPE}}` | Service 类型 | `ClusterIP` (有 Ingress) / `NodePort` (回落) |
| `{{STORAGE_CLASS}}` | PVC storageClassName | k3s `local-path` / 其他空串 |
| `{{PG_STORAGE_SIZE}}` / `{{REDIS_STORAGE_SIZE}}` | PVC 大小 | `50Gi` / `10Gi` |
| `{{INGRESS_HOST}}` | 绑定域名 | 用户参数 |
| `{{INGRESS_CLASS}}` | Ingress className | 自动探测 |
| `{{TIMEZONE}}` | 容器时区 | `Asia/Shanghai` |

> App 的 filesystem Session 快照不使用 PVC,而是挂载节点本地
> `/var/lib/claude-code-hub/session-snapshots` hostPath。这个目录只在同一节点上的 Pod 间共享;
> 默认配置适用于单节点 k3s,或明确保证所有 App Pod 位于同一节点的部署。多节点集群应在系统设置中
> 切换为 Redis,或自行提供真正的共享文件系统。PostgreSQL/Redis 仍使用 StorageClass/PVC。

> NodePort 回落模式下,`scripts/deploy-k8s.sh` 会自动跳过 `app/networkpolicy.yaml`,
> 避免默认的 Ingress 命名空间白名单阻断外部访问。

## Secret 约定

所有 manifest 都引用 `claude-code-hub-secrets` 里的以下 key,由 `deploy-k8s.sh` 自动生成:

- `pg-password` — PostgreSQL 密码
- `redis-password` — Redis 密码
- `admin-token` — Dashboard 管理员 Token
- `dsn` — PostgreSQL 连接串 (由 `pg-password` 拼装)
- `redis-url` — Redis 连接串 (由 `redis-password` 拼装)

## 典型调用

```bash
# 集群侧一键部署 (推荐)
# 默认等价 main 分支发布镜像 -> ghcr.io/ding113/claude-code-hub:latest
bash scripts/deploy-k8s.sh -y

# 自定义 namespace / 镜像 / 域名
bash scripts/deploy-k8s.sh \
  -n my-hub -i ghcr.io/ding113/claude-code-hub:dev \
  --ingress-host hub.example.com -y

# 仅渲染不部署 (用于审阅)
bash scripts/deploy-k8s.sh --dry-render --deploy-dir /tmp/cch-k8s -y
```

详见 `docs/k8s-deployment.md`。
