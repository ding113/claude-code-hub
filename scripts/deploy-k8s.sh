#!/usr/bin/env bash
# Claude Code Hub - Kubernetes / k3s One-Click Deployment
# 兼容 k3s 与标准 Kubernetes (EKS/GKE/AKS/self-hosted)
# 详见: docs/k8s-deployment.md
set -euo pipefail

###############################################################################
# Colors (在非 TTY 或 NO_COLOR 环境自动降级)
###############################################################################
if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    RED=$'\033[0;31m'
    GREEN=$'\033[0;32m'
    YELLOW=$'\033[1;33m'
    BLUE=$'\033[0;34m'
    CYAN=$'\033[0;36m'
    NC=$'\033[0m'
else
    RED=""
    GREEN=""
    YELLOW=""
    BLUE=""
    CYAN=""
    NC=""
fi

###############################################################################
# Script metadata
###############################################################################
VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_MANIFEST_DIR="$REPO_ROOT/deploy/k8s"

###############################################################################
# Logging
###############################################################################
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# 跨平台 base64 decode (macOS BSD 旧版只认 -D)
b64d() {
    if base64 -d </dev/null >/dev/null 2>&1; then
        base64 -d
    elif base64 -D </dev/null >/dev/null 2>&1; then
        base64 -D
    else
        openssl base64 -d
    fi
}

###############################################################################
# Defaults
###############################################################################
DEFAULT_NAMESPACE="claude-code-hub"
DEFAULT_IMAGE="ghcr.io/ding113/claude-code-hub:latest"
DEFAULT_REPLICAS=2
DEFAULT_HPA_MIN=2
DEFAULT_HPA_MAX=6
DEFAULT_PG_SIZE="50Gi"
DEFAULT_REDIS_SIZE="10Gi"
DEFAULT_TIMEZONE="Asia/Shanghai"

###############################################################################
# CLI argument variables
###############################################################################
NAMESPACE_ARG=""
IMAGE_ARG=""
BRANCH_ARG=""
TOKEN_ARG=""
REPLICAS_ARG=""
HPA_MIN_ARG=""
HPA_MAX_ARG=""
STORAGE_CLASS_ARG=""
PG_SIZE_ARG=""
REDIS_SIZE_ARG=""
TIMEZONE_ARG=""
INGRESS_HOST_ARG=""
INGRESS_CLASS_ARG=""
DISABLE_INGRESS=false
DISABLE_NETWORKPOLICY=false
DEPLOY_DIR_ARG=""
KUBE_CONTEXT_ARG=""
INSTALL_K3S=false
INSTALL_CCH=false
FORCE_NEW=false
DRY_RENDER=false
NON_INTERACTIVE=false

###############################################################################
# Runtime state
###############################################################################
NAMESPACE=""
APP_IMAGE=""
APP_REPLICAS=""
APP_HPA_MIN=""
APP_HPA_MAX=""
STORAGE_CLASS=""
PG_STORAGE_SIZE=""
REDIS_STORAGE_SIZE=""
TIMEZONE=""
INGRESS_HOST=""
INGRESS_CLASS=""
INGRESS_VARIANT=""           # standard | traefik | nodeport
APP_SERVICE_TYPE=""          # ClusterIP | NodePort
DEPLOY_DIR=""
RUNTIME=""                    # k3s | kubectl
RUNTIME_OVERRIDE="${RUNTIME_OVERRIDE:-}"
KUBECTL=""
UPDATE_MODE=false
ADMIN_TOKEN=""
PG_PASSWORD=""
REDIS_PASSWORD=""

###############################################################################
# Help
###############################################################################
show_help() {
    cat << EOF
Claude Code Hub - K8s/k3s One-Click Deployment Script v${VERSION}

Usage: $0 [OPTIONS]

Cluster:
  -n, --namespace <ns>          K8s namespace (default: ${DEFAULT_NAMESPACE})
      --kube-context <ctx>      kubectl context (default: current)
      --install-k3s             本机无集群时自动安装 k3s (需要 sudo)

Application:
  -i, --image <ref>             应用镜像 (default: ${DEFAULT_IMAGE})
  -b, --branch <name>           分支捷径 main→:latest / dev→:dev
  -t, --admin-token <token>     自定义 ADMIN_TOKEN (default: auto-generated)
      --replicas <n>            Deployment 基线副本数 (default: ${DEFAULT_REPLICAS})
      --hpa-min <n>             HPA 最小副本 (default: ${DEFAULT_HPA_MIN})
      --hpa-max <n>             HPA 最大副本 (default: ${DEFAULT_HPA_MAX})
      --timezone <tz>           容器时区 (default: ${DEFAULT_TIMEZONE})

Storage:
      --storage-class <name>    PVC storageClassName (default: 自动探测)
      --pg-size <size>          PostgreSQL PVC 大小 (default: ${DEFAULT_PG_SIZE})
      --redis-size <size>       Redis PVC 大小 (default: ${DEFAULT_REDIS_SIZE})

Ingress:
      --ingress-host <host>     启用 Ingress 并绑定域名
      --ingress-class <cls>     Ingress className (default: 自动探测)
      --disable-ingress         跳过 Ingress,使用 NodePort
      --disable-networkpolicy   跳过 NetworkPolicy (Ingress Controller 不在标准 ns 时需要)

Deployment:
  -d, --deploy-dir <path>       manifest + cch 安装目录 (default: auto)
      --force-new               删除已有 namespace 后强制重装 (会提示)
      --install-cch             把 cch 软链接到 /usr/local/bin/cch (需 sudo)
      --dry-render              只渲染 manifest 不 apply (用于审阅)

Misc:
  -y, --yes                     非交互模式 (用默认值)
  -h, --help                    显示帮助
      --version                 显示版本号

Examples:
  # 最简,交互式
  $0

  # 非交互,纯默认
  $0 -y

  # 部署 dev 分支,自定义命名空间与域名
  $0 -b dev -n my-hub --ingress-host hub.example.com -y

  # 标准 K8s,指定 storage class
  $0 --storage-class standard -y

  # 仅渲染 manifest 不应用 (用于离线审阅)
  $0 --dry-render --deploy-dir /tmp/cch-k8s -y

For more information: https://github.com/ding113/claude-code-hub
EOF
}

###############################################################################
# Arg parsing
###############################################################################
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -n|--namespace)          NAMESPACE_ARG="$2"; shift 2 ;;
            --kube-context)          KUBE_CONTEXT_ARG="$2"; shift 2 ;;
            --install-k3s)           INSTALL_K3S=true; shift ;;
            -i|--image)              IMAGE_ARG="$2"; shift 2 ;;
            -b|--branch)             BRANCH_ARG="$2"; shift 2 ;;
            -t|--admin-token)        TOKEN_ARG="$2"; shift 2 ;;
            --replicas)              REPLICAS_ARG="$2"; shift 2 ;;
            --hpa-min)               HPA_MIN_ARG="$2"; shift 2 ;;
            --hpa-max)               HPA_MAX_ARG="$2"; shift 2 ;;
            --timezone)              TIMEZONE_ARG="$2"; shift 2 ;;
            --storage-class)         STORAGE_CLASS_ARG="$2"; shift 2 ;;
            --pg-size)               PG_SIZE_ARG="$2"; shift 2 ;;
            --redis-size)            REDIS_SIZE_ARG="$2"; shift 2 ;;
            --ingress-host)          INGRESS_HOST_ARG="$2"; shift 2 ;;
            --ingress-class)         INGRESS_CLASS_ARG="$2"; shift 2 ;;
            --disable-ingress)       DISABLE_INGRESS=true; shift ;;
            --disable-networkpolicy) DISABLE_NETWORKPOLICY=true; shift ;;
            -d|--deploy-dir)         DEPLOY_DIR_ARG="$2"; shift 2 ;;
            --force-new)             FORCE_NEW=true; shift ;;
            --install-cch)           INSTALL_CCH=true; shift ;;
            --dry-render)            DRY_RENDER=true; shift ;;
            -y|--yes)                NON_INTERACTIVE=true; shift ;;
            -h|--help)               show_help; exit 0 ;;
            --version)               echo "deploy-k8s.sh v${VERSION}"; exit 0 ;;
            *)                       log_error "Unknown argument: $1"; show_help; exit 1 ;;
        esac
    done
}

###############################################################################
# Banner
###############################################################################
print_header() {
    echo -e "${BLUE}"
    echo "+=================================================================+"
    echo "|                                                                 |"
    echo "|       Claude Code Hub - K8s / k3s One-Click Deployment          |"
    echo "|                    Version ${VERSION}                                  |"
    echo "|                                                                 |"
    echo "+=================================================================+"
    echo -e "${NC}"
}

###############################################################################
# OS & runtime detection
###############################################################################
detect_os() {
    local os_type
    case "$OSTYPE" in
        linux*)   os_type="linux" ;;
        darwin*)  os_type="macos" ;;
        *)        log_error "Unsupported OS: $OSTYPE"; exit 1 ;;
    esac
    log_info "Detected OS: $os_type"

    # Default deploy dir depends on permissions
    if [[ -z "$DEPLOY_DIR_ARG" ]]; then
        if [[ $EUID -eq 0 ]]; then
            DEPLOY_DIR="/opt/claude-code-hub"
        else
            DEPLOY_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/cch"
        fi
    else
        DEPLOY_DIR="$DEPLOY_DIR_ARG"
    fi
    log_info "Deploy directory: $DEPLOY_DIR"
}

detect_runtime() {
    # 显式覆盖
    if [[ -n "$RUNTIME_OVERRIDE" ]]; then
        RUNTIME="$RUNTIME_OVERRIDE"
        KUBECTL="kubectl"
        if [[ -n "$KUBE_CONTEXT_ARG" ]]; then
            KUBECTL="kubectl --context=$KUBE_CONTEXT_ARG"
        fi
        log_info "Runtime: $RUNTIME (override)"
        return
    fi
    # 如果用户显式指定了 kube-context,则直接用 kubectl
    if [[ -n "$KUBE_CONTEXT_ARG" ]]; then
        if ! command -v kubectl &>/dev/null; then
            log_error "kubectl 不可用,无法使用 --kube-context"
            exit 1
        fi
        RUNTIME="kubectl"
        KUBECTL="kubectl --context=$KUBE_CONTEXT_ARG"
        log_info "Runtime: kubectl (context=$KUBE_CONTEXT_ARG)"
        return
    fi

    # 标准 kubectl 优先
    if command -v kubectl &>/dev/null; then
        if kubectl cluster-info &>/dev/null; then
            RUNTIME="kubectl"
            KUBECTL="kubectl"
            # 探测当前集群是否是 k3s (观察节点 kubelet version 或 rancher 标识)
            if kubectl get nodes -o jsonpath='{.items[*].status.nodeInfo.kubeletVersion}' 2>/dev/null | grep -q 'k3s'; then
                RUNTIME="k3s"
                log_info "Runtime: k3s (via kubectl)"
            else
                log_info "Runtime: standard Kubernetes (via kubectl)"
            fi
            return
        fi
    fi

    # 没有 kubectl 但本机有 k3s
    if command -v k3s &>/dev/null; then
        RUNTIME="k3s"
        KUBECTL="sudo k3s kubectl"
        log_info "Runtime: k3s (via \`k3s kubectl\`)"
        return
    fi

    # 什么都没有
    if [[ "$INSTALL_K3S" == true ]]; then
        install_k3s
        return
    fi
    log_error "未检测到可用的 K8s 集群 (缺少 kubectl 或 k3s)。"
    log_info  "可选方案:"
    log_info  "  1. 安装 kubectl 并确保 ~/.kube/config 指向可用集群"
    log_info  "  2. 传入 --install-k3s 让本脚本为你安装 k3s (单机场景)"
    exit 1
}

install_k3s() {
    if [[ "$NON_INTERACTIVE" != true ]]; then
        echo ""
        log_warning "即将在本机安装 k3s (官方脚本,curl | sh),这会修改系统服务。"
        log_warning "生产环境请先审阅 https://get.k3s.io 返回的脚本内容后再执行。"
        read -p "继续?(y/N) " -n 1 -r confirm
        echo ""
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            log_error "已取消"; exit 1
        fi
    fi
    log_info "Installing k3s via official installer..."
    if ! curl -fsSL https://get.k3s.io | sh -; then
        log_error "k3s 安装失败"; exit 1
    fi
    # 让 kubectl 可以读取 k3s config
    if [[ -r /etc/rancher/k3s/k3s.yaml ]]; then
        export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
    fi
    if command -v kubectl &>/dev/null; then
        KUBECTL="kubectl"
    else
        KUBECTL="sudo k3s kubectl"
    fi
    RUNTIME="k3s"
    log_success "k3s installed"
    # 等 API 就绪
    local i=0
    until $KUBECTL get nodes &>/dev/null; do
        if [[ $i -ge 30 ]]; then log_error "k3s API 长时间不可达"; exit 1; fi
        sleep 2; i=$((i+1))
    done
}

###############################################################################
# Preflight
###############################################################################
preflight_checks() {
    if ! $KUBECTL get nodes &>/dev/null; then
        log_error "kubectl 无法连接集群。请检查 kubeconfig / context。"
        exit 1
    fi
    local node_count
    node_count=$($KUBECTL get nodes --no-headers 2>/dev/null | wc -l)
    log_info "Cluster reachable. Node count: $node_count"

    # 一些基础权限试探 (create ns 的权限)
    if ! $KUBECTL auth can-i create namespace &>/dev/null; then
        log_warning "当前用户可能无 create namespace 权限,如部署失败请用 cluster-admin 重试"
    fi
}

###############################################################################
# 应用配置合并 (CLI > 默认)
###############################################################################
resolve_config() {
    NAMESPACE="${NAMESPACE_ARG:-$DEFAULT_NAMESPACE}"

    # 分支捷径
    if [[ -n "$BRANCH_ARG" ]]; then
        case "$BRANCH_ARG" in
            main|master) APP_IMAGE="ghcr.io/ding113/claude-code-hub:latest" ;;
            dev)         APP_IMAGE="ghcr.io/ding113/claude-code-hub:dev" ;;
            *)           log_error "Unknown branch: $BRANCH_ARG (expected: main|dev)"; exit 1 ;;
        esac
    fi
    APP_IMAGE="${IMAGE_ARG:-${APP_IMAGE:-$DEFAULT_IMAGE}}"

    APP_REPLICAS="${REPLICAS_ARG:-$DEFAULT_REPLICAS}"
    APP_HPA_MIN="${HPA_MIN_ARG:-$DEFAULT_HPA_MIN}"
    APP_HPA_MAX="${HPA_MAX_ARG:-$DEFAULT_HPA_MAX}"
    PG_STORAGE_SIZE="${PG_SIZE_ARG:-$DEFAULT_PG_SIZE}"
    REDIS_STORAGE_SIZE="${REDIS_SIZE_ARG:-$DEFAULT_REDIS_SIZE}"
    TIMEZONE="${TIMEZONE_ARG:-$DEFAULT_TIMEZONE}"
    INGRESS_HOST="${INGRESS_HOST_ARG:-}"

    # 校验
    if ! [[ "$APP_REPLICAS" =~ ^[0-9]+$ ]] || [[ "$APP_REPLICAS" -lt 1 ]]; then
        log_error "--replicas 必须是正整数: $APP_REPLICAS"; exit 1
    fi
    if [[ "$APP_HPA_MIN" -gt "$APP_HPA_MAX" ]]; then
        log_error "--hpa-min ($APP_HPA_MIN) 不能大于 --hpa-max ($APP_HPA_MAX)"; exit 1
    fi

    log_info "Namespace:       $NAMESPACE"
    log_info "App image:       $APP_IMAGE"
    log_info "Replicas:        $APP_REPLICAS (HPA: $APP_HPA_MIN-$APP_HPA_MAX)"
    log_info "PG storage:      $PG_STORAGE_SIZE"
    log_info "Redis storage:   $REDIS_STORAGE_SIZE"
    log_info "Timezone:        $TIMEZONE"
    if [[ "$APP_REPLICAS" -gt 1 ]]; then
        log_info "AUTO_MIGRATE 由 PostgreSQL advisory lock 串行化,首次多副本启动会排队等待迁移完成"
    fi
}

detect_storage_class() {
    if [[ -n "$STORAGE_CLASS_ARG" ]]; then
        STORAGE_CLASS="$STORAGE_CLASS_ARG"
        log_info "Storage class (user): $STORAGE_CLASS"
        return
    fi
    # k3s → local-path
    if [[ "$RUNTIME" == "k3s" ]] && $KUBECTL get sc local-path &>/dev/null; then
        STORAGE_CLASS="local-path"
        log_info "Storage class (k3s default): local-path"
        return
    fi
    # 尝试找默认 StorageClass
    local default_sc
    default_sc=$($KUBECTL get sc -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{"\n"}{end}' 2>/dev/null | head -1)
    if [[ -z "$default_sc" ]]; then
        default_sc=$($KUBECTL get sc -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.beta\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{"\n"}{end}' 2>/dev/null | head -1)
    fi
    if [[ -n "$default_sc" ]]; then
        STORAGE_CLASS="$default_sc"
        log_info "Storage class (cluster default): $default_sc"
        return
    fi
    # 找不到默认,用空串让集群自行决定
    STORAGE_CLASS=""
    log_warning "未检测到默认 StorageClass。PVC 将使用集群默认设置,可能无法自动绑定卷"
    log_info    "如有需要,请传入 --storage-class <name> 指定"
}

detect_ingress_variant() {
    if [[ "$DISABLE_INGRESS" == true ]]; then
        INGRESS_VARIANT="nodeport"
        APP_SERVICE_TYPE="NodePort"
        log_info "Ingress: disabled (Service=NodePort)"
        return
    fi
    if [[ -z "$INGRESS_HOST" ]]; then
        INGRESS_VARIANT="nodeport"
        APP_SERVICE_TYPE="NodePort"
        log_warning "未指定 --ingress-host,将使用 NodePort 暴露"
        return
    fi

    # 检测 Traefik CRD
    if $KUBECTL get crd ingressroutes.traefik.io &>/dev/null; then
        INGRESS_VARIANT="traefik"
        APP_SERVICE_TYPE="ClusterIP"
        log_info "Ingress: Traefik IngressRoute (host=$INGRESS_HOST)"
        return
    fi

    # 标准 Ingress
    if $KUBECTL api-resources 2>/dev/null | grep -q '^ingresses.*networking.k8s.io'; then
        INGRESS_CLASS="${INGRESS_CLASS_ARG:-}"
        if [[ -z "$INGRESS_CLASS" ]]; then
            # 查找 IngressClass
            local first_ic
            first_ic=$($KUBECTL get ingressclass -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
            if [[ -n "$first_ic" ]]; then
                INGRESS_CLASS="$first_ic"
            else
                INGRESS_CLASS="nginx"
                log_warning "集群无 IngressClass,默认填 nginx。请通过 --ingress-class 显式指定"
            fi
        fi
        INGRESS_VARIANT="standard"
        APP_SERVICE_TYPE="ClusterIP"
        log_info "Ingress: standard (className=$INGRESS_CLASS, host=$INGRESS_HOST)"
        return
    fi

    # 都不可用
    INGRESS_VARIANT="nodeport"
    APP_SERVICE_TYPE="NodePort"
    log_warning "集群不支持 Ingress,回落到 NodePort"
}

###############################################################################
# Existing deployment detection
###############################################################################
force_new_reset_existing_namespace() {
    if ! $KUBECTL get namespace "$NAMESPACE" &>/dev/null; then
        log_info "--force-new 已启用,但 namespace=$NAMESPACE 当前不存在,将按新装模式继续"
        return
    fi

    if [[ "$NON_INTERACTIVE" != true ]]; then
        echo ""
        log_warning "--force-new 将删除 namespace=$NAMESPACE 并重建所有资源"
        log_warning "这会清空 Deployment / StatefulSet / Secret / PVC,现有数据不会保留"
        read -p "输入 yes 继续: " confirm
        echo ""
        if [[ "$confirm" != "yes" ]]; then
            log_error "已取消"
            exit 1
        fi
    else
        log_warning "--force-new 已启用: 删除 namespace=$NAMESPACE 并重建所有资源"
    fi
    log_warning "PV 是否真正释放取决于 StorageClass reclaimPolicy; 若为 Retain,旧 PV 会进入 Released,需手动清理"

    log_info "删除旧 namespace: $NAMESPACE"
    if ! $KUBECTL delete namespace "$NAMESPACE" --timeout=180s >/dev/null; then
        log_error "删除 namespace 失败: $NAMESPACE"
        exit 1
    fi
    log_success "旧部署已清理,将按新装模式继续"
}

detect_existing_deployment() {
    if [[ "$FORCE_NEW" == true ]]; then
        force_new_reset_existing_namespace
        UPDATE_MODE=false
        return
    fi
    if $KUBECTL get namespace "$NAMESPACE" &>/dev/null && \
       $KUBECTL -n "$NAMESPACE" get deployment claude-code-hub &>/dev/null; then
        UPDATE_MODE=true
        log_info "检测到已有部署(namespace=$NAMESPACE),进入升级模式"
    else
        UPDATE_MODE=false
        log_info "未检测到已有部署,进入新装模式"
    fi
}

###############################################################################
# Secret generation
###############################################################################
generate_random() {
    local length="${1:-32}"
    if command -v openssl &>/dev/null; then
        openssl rand -base64 48 | tr -d '=/+' | head -c "$length"
    else
        tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$length"
    fi
}

prepare_secret_values() {
    if [[ "$UPDATE_MODE" == true ]] && \
       $KUBECTL -n "$NAMESPACE" get secret claude-code-hub-secrets &>/dev/null; then
        log_info "升级模式:复用已有 Secret 中的密码"
        PG_PASSWORD=$($KUBECTL -n "$NAMESPACE" get secret claude-code-hub-secrets \
            -o jsonpath='{.data.pg-password}' | b64d)
        REDIS_PASSWORD=$($KUBECTL -n "$NAMESPACE" get secret claude-code-hub-secrets \
            -o jsonpath='{.data.redis-password}' | b64d)
        if [[ -n "$TOKEN_ARG" ]]; then
            ADMIN_TOKEN="$TOKEN_ARG"
            log_info "使用 CLI 传入的 admin-token 覆盖"
        else
            ADMIN_TOKEN=$($KUBECTL -n "$NAMESPACE" get secret claude-code-hub-secrets \
                -o jsonpath='{.data.admin-token}' | b64d)
        fi
    else
        log_info "生成随机凭据..."
        PG_PASSWORD=$(generate_random 40)
        REDIS_PASSWORD=$(generate_random 40)
        ADMIN_TOKEN="${TOKEN_ARG:-$(generate_random 48)}"
    fi
}

apply_secret() {
    local dsn redis_url tmp
    dsn="postgresql://claude_code_hub:${PG_PASSWORD}@postgres:5432/claude_code_hub"
    redis_url="redis://:${REDIS_PASSWORD}@redis:6379/0"

    # 避免把凭据写进命令行参数 (ps / /proc/<pid>/cmdline 会暴露 --from-literal=...)
    # 改为先把密码落到 600 权限的临时文件,通过 --from-file 引用,再渲染 YAML 并 apply
    tmp=$(mktemp -d)
    chmod 700 "$tmp"
    trap 'rm -rf "$tmp"' EXIT
    printf '%s' "$PG_PASSWORD"    > "$tmp/pg-password";   chmod 600 "$tmp/pg-password"
    printf '%s' "$REDIS_PASSWORD" > "$tmp/redis-password"; chmod 600 "$tmp/redis-password"
    printf '%s' "$ADMIN_TOKEN"    > "$tmp/admin-token";   chmod 600 "$tmp/admin-token"
    printf '%s' "$dsn"            > "$tmp/dsn";           chmod 600 "$tmp/dsn"
    printf '%s' "$redis_url"      > "$tmp/redis-url";     chmod 600 "$tmp/redis-url"

    $KUBECTL -n "$NAMESPACE" create secret generic claude-code-hub-secrets \
        --from-file=pg-password="$tmp/pg-password" \
        --from-file=redis-password="$tmp/redis-password" \
        --from-file=admin-token="$tmp/admin-token" \
        --from-file=dsn="$tmp/dsn" \
        --from-file=redis-url="$tmp/redis-url" \
        --dry-run=client -o yaml | $KUBECTL apply -f -

    rm -rf "$tmp"
    trap - EXIT
    log_success "Secret claude-code-hub-secrets applied"
}

###############################################################################
# Manifest rendering
###############################################################################
render_manifests() {
    if [[ ! -d "$SOURCE_MANIFEST_DIR" ]]; then
        log_error "未找到源 manifest 目录: $SOURCE_MANIFEST_DIR"
        exit 1
    fi

    local target="$DEPLOY_DIR/k8s"
    mkdir -p "$target"

    log_info "复制 manifest 模板 -> $target"
    # 使用 `src/.` + trailing slash 写法,兼容 BSD (macOS) 与 GNU cp。
    # `cp -RT` 是 GNU 专有选项,BSD cp 会报错。
    cp -R "$SOURCE_MANIFEST_DIR/." "$target/"

    log_info "渲染占位符..."
    # 处理 storageClass 的特殊情况:空串时整行删除
    local sc_line_action
    if [[ -z "$STORAGE_CLASS" ]]; then
        sc_line_action="delete"
    else
        sc_line_action="replace"
    fi

    # 对所有 yaml 做占位符替换
    local f
    while IFS= read -r -d '' f; do
        # 跳过 README
        [[ "$f" == *"README.md" ]] && continue
        # 用 python 一次性渲染 (避免 sed 引号/特殊字符问题)
        python3 - "$f" "$NAMESPACE" "$APP_IMAGE" "$APP_REPLICAS" \
            "$APP_HPA_MIN" "$APP_HPA_MAX" "$STORAGE_CLASS" \
            "$PG_STORAGE_SIZE" "$REDIS_STORAGE_SIZE" \
            "$TIMEZONE" "$INGRESS_HOST" "$INGRESS_CLASS" \
            "$APP_SERVICE_TYPE" "$sc_line_action" <<'PY'
import sys, re
path = sys.argv[1]
ns, image, replicas, hpa_min, hpa_max, sc, pg_size, redis_size, tz, ing_host, ing_class, svc_type, sc_action = sys.argv[2:]
with open(path) as f:
    text = f.read()
if sc_action == "delete":
    # 删除包含 storageClassName: {{STORAGE_CLASS}} 的整行
    text = "\n".join(l for l in text.splitlines() if "{{STORAGE_CLASS}}" not in l) + ("\n" if text.endswith("\n") else "")
repl = {
    "{{NAMESPACE}}": ns,
    "{{APP_IMAGE}}": image,
    "{{APP_REPLICAS}}": replicas,
    "{{APP_HPA_MIN}}": hpa_min,
    "{{APP_HPA_MAX}}": hpa_max,
    "{{STORAGE_CLASS}}": sc,
    "{{PG_STORAGE_SIZE}}": pg_size,
    "{{REDIS_STORAGE_SIZE}}": redis_size,
    "{{TIMEZONE}}": tz,
    "{{INGRESS_HOST}}": ing_host,
    "{{INGRESS_CLASS}}": ing_class,
    "{{APP_SERVICE_TYPE}}": svc_type,
}
for k, v in repl.items():
    text = text.replace(k, v)
with open(path, "w") as f:
    f.write(text)
PY
    done < <(find "$target" -type f -name '*.yaml' -print0)

    log_success "Manifest 渲染完成: $target"
}

###############################################################################
# Apply
###############################################################################
kube_apply() {
    local f="$1"
    if [[ ! -f "$f" ]]; then
        log_warning "跳过 (文件不存在): $f"
        return
    fi
    $KUBECTL apply -f "$f"
}

apply_manifests() {
    local base="$DEPLOY_DIR/k8s"
    log_info "应用 manifest (按依赖顺序)..."

    kube_apply "$base/namespace.yaml"
    apply_secret

    # NetworkPolicy (可选,失败不致命 — 集群可能不启用 NP)
    # 注意:默认 app/networkpolicy.yaml 仅放行 namespace 标签为
    # kube-system / ingress-nginx / traefik 的 Ingress Controller。
    # 若你的 Ingress Controller 位于其他 namespace,传 --disable-networkpolicy
    # 并改用自定义 NP,或者编辑 deploy/k8s/app/networkpolicy.yaml
    if [[ "$DISABLE_NETWORKPOLICY" == true ]]; then
        log_info "已跳过 NetworkPolicy (--disable-networkpolicy)"
    else
        kube_apply "$base/postgres/networkpolicy.yaml"  || log_warning "postgres networkpolicy 应用失败,忽略"
        kube_apply "$base/redis/networkpolicy.yaml"     || log_warning "redis networkpolicy 应用失败,忽略"
        if [[ "$INGRESS_VARIANT" == "nodeport" ]]; then
            log_warning "NodePort 模式下跳过 app NetworkPolicy,避免阻断外部访问"
        else
            kube_apply "$base/app/networkpolicy.yaml"   || log_warning "app networkpolicy 应用失败,忽略"
        fi
    fi

    # DB & Cache
    kube_apply "$base/postgres/service.yaml"
    kube_apply "$base/postgres/statefulset.yaml"
    kube_apply "$base/redis/service.yaml"
    kube_apply "$base/redis/statefulset.yaml"

    log_info "等待 Postgres / Redis 就绪 (最长 5 分钟)..."
    if ! $KUBECTL -n "$NAMESPACE" rollout status statefulset/postgres --timeout=300s; then
        log_error "Postgres StatefulSet 未就绪,请检查 PVC / StorageClass / 节点资源"
        log_info  "  kubectl -n $NAMESPACE describe pod -l app=postgres"
        exit 1
    fi
    if ! $KUBECTL -n "$NAMESPACE" rollout status statefulset/redis --timeout=300s; then
        log_error "Redis StatefulSet 未就绪,请检查 PVC / StorageClass"
        exit 1
    fi

    # 已移除独立的 migration Job (deploy/k8s/jobs/ 目录不再存在):
    #   1. 应用启动时 instrumentation.ts 会自动执行 drizzle migrations (AUTO_MIGRATE=true 默认开)
    #   2. Job 需要 devDependency drizzle-kit,在 standalone 运行时镜像里不可用
    #   3. 避免 Job 与应用 AUTO_MIGRATE 的并发迁移竞态

    # App
    kube_apply "$base/app/deployment.yaml"
    kube_apply "$base/app/service.yaml"
    kube_apply "$base/app/hpa.yaml"
    kube_apply "$base/app/pdb.yaml"

    log_info "等待 App 滚动更新完成 (最长 10 分钟)..."
    if ! $KUBECTL -n "$NAMESPACE" rollout status deployment/claude-code-hub --timeout=600s; then
        log_error "App Deployment 滚动未能在 10 分钟内完成"
        log_info  "诊断建议:"
        log_info  "  kubectl -n $NAMESPACE describe deployment claude-code-hub"
        log_info  "  kubectl -n $NAMESPACE logs deploy/claude-code-hub --tail=100"
        if [[ "$UPDATE_MODE" == true ]]; then
            log_warning "升级模式失败,执行 rollout undo 回滚..."
            $KUBECTL -n "$NAMESPACE" rollout undo deployment/claude-code-hub || true
            $KUBECTL -n "$NAMESPACE" rollout status deployment/claude-code-hub --timeout=300s || true
        fi
        exit 1
    fi

    # Ingress
    case "$INGRESS_VARIANT" in
        standard) kube_apply "$base/ingress/ingress.yaml" ;;
        traefik)  kube_apply "$base/ingress/traefik-ingressroute.yaml" ;;
        nodeport) log_info "Ingress variant=nodeport,跳过 ingress manifest" ;;
    esac

    log_success "所有 manifest 已应用"
}

###############################################################################
# Post-install
###############################################################################
install_cch_cli_if_requested() {
    if [[ "$INSTALL_CCH" != true ]]; then return; fi
    local src="$SCRIPT_DIR/cch"
    local dst="/usr/local/bin/cch"
    if [[ ! -x "$src" ]]; then
        log_warning "$src 不存在或不可执行,跳过 cch 安装"
        return
    fi
    log_info "将 cch 软链到 $dst (需要 sudo)"
    if sudo ln -sf "$src" "$dst"; then
        log_success "cch 已安装: $(which cch)"
    else
        log_warning "cch 软链失败,可手动: sudo ln -sf $src $dst"
    fi
}

write_cch_config() {
    # 写一份配置供 cch 读取 (namespace / image / deploy-dir)
    local cfg_dir="${XDG_CONFIG_HOME:-$HOME/.config}/cch"
    mkdir -p "$cfg_dir"
    # 使用 POSIX 可移植的时间戳格式,避免 GNU 专有的 `date -Iseconds`
    local ts
    ts=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
    cat > "$cfg_dir/config" <<EOF
# Auto-generated by deploy-k8s.sh v${VERSION} at $ts
CCH_NAMESPACE="$NAMESPACE"
CCH_IMAGE="$APP_IMAGE"
CCH_DEPLOY_DIR="$DEPLOY_DIR"
CCH_RUNTIME="$RUNTIME"
CCH_INGRESS_HOST="$INGRESS_HOST"
CCH_INGRESS_VARIANT="$INGRESS_VARIANT"
EOF
    log_info "cch 配置已写入: $cfg_dir/config"
}

get_node_ip() {
    $KUBECTL get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}' 2>/dev/null \
        || $KUBECTL get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null \
        || echo "<your-node-ip>"
}

print_success_message() {
    local url admin_note
    case "$INGRESS_VARIANT" in
        standard|traefik)
            url="http://$INGRESS_HOST"
            ;;
        nodeport)
            local np node_ip
            np=$($KUBECTL -n "$NAMESPACE" get svc claude-code-hub \
                -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo "")
            node_ip=$(get_node_ip)
            if [[ -n "$np" ]]; then
                url="http://${node_ip}:${np}"
            else
                url="(kubectl port-forward svc/claude-code-hub -n $NAMESPACE 13500:80)"
            fi
            ;;
    esac

    echo ""
    echo -e "${GREEN}+================================================================+${NC}"
    echo -e "${GREEN}|                                                                |${NC}"
    if [[ "$UPDATE_MODE" == true ]]; then
        echo -e "${GREEN}|              Claude Code Hub Upgrade Complete!                 |${NC}"
    else
        echo -e "${GREEN}|              Claude Code Hub Deployment Complete!              |${NC}"
    fi
    echo -e "${GREEN}|                                                                |${NC}"
    echo -e "${GREEN}+================================================================+${NC}"
    echo ""
    echo -e "${BLUE}Access URL:${NC}           ${GREEN}$url${NC}"
    echo -e "${BLUE}Namespace:${NC}            $NAMESPACE"
    echo -e "${BLUE}Image:${NC}                $APP_IMAGE"
    echo ""
    if [[ "$UPDATE_MODE" == false ]]; then
        echo -e "${BLUE}Admin Token (保管好):${NC}"
        echo -e "    ${YELLOW}${ADMIN_TOKEN}${NC}"
        echo ""
    fi
    echo -e "${BLUE}常用命令 (cch):${NC}"
    echo -e "    cch status         # 查看 Pod / HPA / 资源"
    echo -e "    cch logs           # 查看日志"
    echo -e "    cch update         # 拉新镜像 + 滚动更新"
    echo -e "    cch backup         # 备份 PostgreSQL"
    echo -e "    cch info           # 展示访问地址与 Admin Token"
    echo ""
    if [[ "$INSTALL_CCH" != true ]]; then
        echo -e "${YELLOW}提示:${NC} cch CLI 未安装到 PATH。你可以:"
        echo -e "    bash scripts/deploy-k8s.sh --install-cch   # 软链到 /usr/local/bin/cch"
        echo -e "    或直接: bash scripts/cch status"
    fi
    echo ""
    if [[ "$UPDATE_MODE" == false ]]; then
        echo -e "${RED}IMPORTANT:${NC} 请妥善保存 Admin Token,丢失后只能通过集群 Secret 找回"
    fi
    echo ""
}

###############################################################################
# Main
###############################################################################
main() {
    parse_args "$@"
    print_header
    detect_os

    if [[ "$DRY_RENDER" == true ]]; then
        # 离线模式:不探测集群,用用户传入或默认值渲染 manifest
        log_info "Dry-render mode: 跳过集群探测"
        RUNTIME="${RUNTIME_OVERRIDE:-kubectl}"
        resolve_config
        STORAGE_CLASS="${STORAGE_CLASS_ARG:-local-path}"
        log_info "Storage class (dry-render): $STORAGE_CLASS"
        if [[ "$DISABLE_INGRESS" == true ]] || [[ -z "$INGRESS_HOST" ]]; then
            INGRESS_VARIANT="nodeport"
            APP_SERVICE_TYPE="NodePort"
        else
            INGRESS_VARIANT="standard"
            APP_SERVICE_TYPE="ClusterIP"
            INGRESS_CLASS="${INGRESS_CLASS_ARG:-nginx}"
        fi
        UPDATE_MODE=false
        render_manifests
        log_success "Dry render 完成,manifest 位于: $DEPLOY_DIR/k8s"
        log_info    "可用于审阅: kubectl apply --dry-run=client -R -f $DEPLOY_DIR/k8s/"
        exit 0
    fi

    detect_runtime
    preflight_checks
    resolve_config
    detect_existing_deployment
    detect_storage_class
    detect_ingress_variant
    prepare_secret_values
    render_manifests
    apply_manifests
    install_cch_cli_if_requested
    write_cch_config
    print_success_message
}

main "$@"
