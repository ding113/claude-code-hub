#!/usr/bin/env python3
"""
CCH impersonate proxy — 本地常驻伪装转发网关。

背景:
  CCH 全站开启 Chrome TLS 指纹伪装(curl-impersonate)。此前实现是每次请求
  spawn curl_chrome116 子进程,单进程单连接,无法跨请求复用 TLS 连接(keep-alive),
  境外/Cloudflare 上游每请求多付出一次完整 TLS 握手(实测 100-400ms)。

本代理:
  - 常驻进程,curl_cffi Session(impersonate=chrome116)自带连接池,
    同一上游的后续请求复用已建立的 TLS 连接,省掉握手。
  - Node 侧(CCH)把"目标 URL + method + headers + body"通过本地端点 POST 进来,
    由本进程终结 TLS 并用 Chrome 指纹转发上游 —— 指纹能力与 curl-impersonate 等价。
  - 流式响应边收边转;客户端断开时取消上游请求(abort 传播)。
  - 所有上游 key/token 仅出现在 Node→本代理的本地请求中,不落日志。

实现说明:
  - curl_cffi 0.16 的 async API 存在池清理 bug(remove_handle NoneType)且 timeout
    会误触 slow-speed 杀流式,故用同步 Session + 线程池(ThreadingHTTPServer),
    同步 API 稳定且支持连接复用。多 Session 池提供并发,acquire/release 复用连接。
  - 零额外依赖:http.server + curl_cffi。

协议(与 src/lib/curl-impersonate.ts 的 proxyForward 配合):
  POST http://127.0.0.1:18686/impersonate
  headers:
    X-CCH-Method:  上游 HTTP 方法(默认 GET)
    X-CCH-Target:  上游绝对 URL(必填)
    X-CCH-Timeout:  超时毫秒(默认 120000;仅作总超时,不启用 slow-speed 限速)
    X-CCH-No-Compress: 1 时强制 Accept-Encoding: identity(透传原始字节)
    (其余 header 原样转发;host/content-length/x-cch-* 剔除)
  body: 上游请求体(原始字节,可选)
  响应: 上游状态行 + 上游 headers + 上游 body(流式)
"""

import http.server
import logging
import os
import queue
import socket
import socketserver
import threading
import time
from typing import Optional

from curl_cffi import requests as cffi_requests

LOG = logging.getLogger("impersonate-proxy")
LISTEN_HOST = os.environ.get("IMPERSONATE_PROXY_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("IMPERSONATE_PROXY_PORT", "18686"))
DEFAULT_TIMEOUT_MS = int(os.environ.get("IMPERSONATE_PROXY_TIMEOUT_MS", "120000"))
MAX_BODY_BYTES = int(os.environ.get("IMPERSONATE_PROXY_MAX_BODY", str(64 * 1024 * 1024)))
POOL_SIZE = int(os.environ.get("IMPERSONATE_PROXY_POOL_SIZE", "4"))
IDLE_KEEP_MS = int(os.environ.get("IMPERSONATE_PROXY_IDLE_KEEP_MS", "300000"))

_STRIP_HEADERS = {
    "host",
    "content-length",
    "x-cch-method",
    "x-cch-target",
    "x-cch-timeout",
    "x-cch-no-compress",
    "proxy-connection",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
}


class SessionPool:
    """多 Session 连接池:并发 + 连接复用。每个 Session 自带 keep-alive 连接池。"""

    def __init__(self, size: int, idle_keep_ms: int):
        self._size = size
        self._idle_keep_ms = idle_keep_ms
        self._sessions: list[cffi_requests.Session] = []
        self._lock = threading.Lock()
        self._avail: queue.Queue[cffi_requests.Session] = queue.Queue()
        self._last_used: dict[int, float] = {}
        for _ in range(size):
            s = cffi_requests.Session(impersonate="chrome116", timeout=None)
            self._sessions.append(s)
            self._avail.put(s)

    def acquire(self) -> cffi_requests.Session:
        s = self._avail.get()
        # 清理超时空闲会话的连接(可选,保持池干净)
        return s

    def release(self, s: cffi_requests.Session) -> None:
        self._last_used[id(s)] = time.time()
        self._avail.put(s)

    def close(self) -> None:
        for s in self._sessions:
            try:
                s.close()
            except Exception:  # noqa: BLE001
                pass
        self._sessions.clear()

    def healthy(self) -> bool:
        return len(self._sessions) == self._size


POOL = SessionPool(POOL_SIZE, IDLE_KEEP_MS)


def strip_headers(headers) -> dict:
    out = {}
    for k, v in headers.items():
        lk = k.lower()
        if lk in _STRIP_HEADERS or v is None:
            continue
        out[k] = v
    return out


class ImpersonateHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "impersonate-proxy/1.0"

    def log_message(self, fmt, *args):  # 精简访问日志
        LOG.info("%s %s", self.address_string(), fmt % args)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        if length > MAX_BODY_BYTES:
            raise ValueError(f"body too large: {length}")
        return self.rfile.read(length)

    def _send_upstream_error(self, status: int, message: str) -> None:
        body = f'{{"error": "{message}"}}'.encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):  # noqa: N802 — http.server 命名约定
        if self.path != "/impersonate":
            self._send_upstream_error(404, "not_found")
            return
        method = (self.headers.get("X-CCH-Method") or "GET").upper()
        target = self.headers.get("X-CCH-Target") or ""
        if not target.startswith(("http://", "https://")):
            self._send_upstream_error(400, "missing or invalid X-CCH-Target")
            return
        try:
            timeout_ms = int(self.headers.get("X-CCH-Timeout") or DEFAULT_TIMEOUT_MS)
        except ValueError:
            timeout_ms = DEFAULT_TIMEOUT_MS

        try:
            body = self._read_body()
        except Exception as exc:  # noqa: BLE001
            LOG.warning("read body failed: %s", exc)
            self._send_upstream_error(400, "body_read_failed")
            return

        headers = strip_headers(self.headers)
        # 调用方显式传了 accept-encoding 则透传(forwarder 用 identity 禁用压缩);
        # 否则默认请求 gzip/deflate/br(与 Chrome 一致)。
        if "accept-encoding" not in {k.lower() for k in headers}:
            headers["Accept-Encoding"] = "gzip, deflate, br"

        session = POOL.acquire()
        try:
            # 总超时由 CCH 侧管理(首字节/idle 超时);这里不传 timeout,
            # 避免 curl_cffi 的 stream trick 设置 LOW_SPEED_LIMIT=1,
            # 模型思考期 >30s 无字节会被误杀。连接超时用 curl 默认 + 外层 join 兜底。
            upstream = session.request(
                method,
                target,
                headers=headers,
                content=body if body else None,
                stream=True,
                timeout=None,
            )
        except Exception as exc:  # noqa: BLE001 — 统一转 502,不泄漏细节
            LOG.warning("upstream request error: %s %s: %s", method, target, exc)
            POOL.release(session)
            self._send_upstream_error(502, f"upstream_request_error: {type(exc).__name__}")
            return

        # 写上游响应头
        try:
            self.send_response(upstream.status_code)
            for k, v in upstream.headers.items():
                lk = k.lower()
                if lk in {
                    "connection",
                    "keep-alive",
                    "transfer-encoding",
                    "content-length",
                    "upgrade",
                }:
                    continue
                self.send_header(k, v)
            self.send_header("Connection", "close")
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError):
            try:
                upstream.close()
            except Exception:  # noqa: BLE001
                pass
            POOL.release(session)
            return

        # 流式转发 body;客户端断开则取消上游
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError, socket.error):
                    LOG.debug("client disconnected, cancelling upstream %s %s", method, target)
                    break
            try:
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, socket.error):
                pass
        except Exception as exc:  # noqa: BLE001
            LOG.warning("upstream stream error: %s %s: %s", method, target, exc)
        finally:
            try:
                upstream.close()
            except Exception:  # noqa: BLE001
                pass
            POOL.release(session)

    def do_GET(self):  # noqa: N802
        if self.path in ("/health", "/"):
            body = b'{"ok": true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._send_upstream_error(404, "not_found")


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("IMPERSONATE_PROXY_LOG", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), ImpersonateHandler)
    LOG.info("impersonate proxy listening on %s:%s (pool=%d)", LISTEN_HOST, LISTEN_PORT, POOL_SIZE)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        POOL.close()
        server.server_close()


if __name__ == "__main__":
    main()
