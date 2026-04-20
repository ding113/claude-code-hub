# Claude Code Hub — K8s Manifests

本目录是 Kubernetes 部署清单模板,由 `scripts/deploy-k8s.sh` 在部署时做占位符替换后下发到集群。
不建议直接 `kubectl apply -f` 本目录 — 文件中包含 `{{VAR}}` 占位符,需先渲染。

## 目录结构

```
deploy/k8s/
├── namespace.yaml                     # 命名空间
├── app/                               # 应用层
│   ├── deployment.yaml                #   Deployment (2 副本基线;迁移由 PG advisory lock 串行化)
│   ├── service.yaml                   #   Service (可渲染为 ClusterIP/NodePort)
│   ├── hpa.yaml                       #   HPA (CPU 70% / 内存 80%)
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
bash scripts/deploy-k8s.sh -y

# 自定义 namespace / 镜像 / 域名
bash scripts/deploy-k8s.sh \
  -n my-hub -i ghcr.io/ding113/claude-code-hub:dev \
  --ingress-host hub.example.com -y

# 仅渲染不部署 (用于审阅)
bash scripts/deploy-k8s.sh --dry-render --deploy-dir /tmp/cch-k8s -y
```

详见 `docs/k8s-deployment.md`。
