#!/usr/bin/env bash
# 下载 curl-impersonate 静态二进制到 deploy/curl-impersonate/ (Dockerfile COPY 依赖此目录)
# 用法: bash deploy/fetch-curl-impersonate.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/curl-impersonate"
mkdir -p "$DIR"

VERSION="v0.6.1"
TARBALL="/tmp/curl-impersonate-${VERSION}.tar.gz"
URL="https://github.com/lwthiker/curl-impersonate/releases/download/${VERSION}/curl-impersonate-${VERSION}.x86_64-linux-gnu.tar.gz"

echo "下载 $URL"
curl -fsSL -o "$TARBALL" "$URL"

# 从 tar 根提取 wrapper 脚本 + 主二进制
tar xzf "$TARBALL" -C "$DIR" curl_chrome116 curl-impersonate-chrome
chmod +x "$DIR/curl_chrome116" "$DIR/curl-impersonate-chrome"

# CA 证书(容器镜像通常不带系统证书)
if [ -f /etc/ssl/certs/ca-certificates.crt ]; then
  cp -L /etc/ssl/certs/ca-certificates.crt "$DIR/ca-certificates.crt"
elif [ -f /etc/ca-certificates/extracted/tls-ca-bundle.pem ]; then
  cp -L /etc/ca-certificates/extracted/tls-ca-bundle.pem "$DIR/ca-certificates.crt"
else
  echo "警告: 未找到系统 CA 证书,请手动放置 ca-certificates.crt" >&2
fi

echo "完成: $DIR"
ls -la "$DIR"
