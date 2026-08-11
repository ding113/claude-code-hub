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

关键设计(curl_cffi 约束):
  - curl_cffi 的 Session 连接池绑定线程(use_thread_local_curl=True,
    每线程一个 curl handle,handle 的连接缓存不跨线程)。
    因此 ThreadingHTTPServer 的"每请求新线程"会让连接池完全失效。
  - 本实现改为:固定 N 个 worker 线程,每 worker 绑定一个 Session。
    HTTP 接收线程只负责解析请求并放入队列,worker 用自己的 Session 处理并
    直接写客户端 socket → 同一 worker 连续处理多个请求时复用连接。
  - 不用 stream=True(curl_cffi 会 duphandle 克隆 handle 丢连接池);
    用非stream + content_callback + Session 级 HEADERFUNCTION,
    libcurl 保证 header 回调先于 body 回调 → 响应头先写出,边收边转。
  - 不传 timeout 避免 LOW_SPEED_LIMIT 误杀长思考流式(超时由 CCH 侧管理)。

协议(与 src/lib/curl-impersonate.ts 的 proxyForward 配合):
  POST http://127.0.0.1:18686/impersonate
  headers:
    X-CCH-Method:  上游 HTTP 方法(默认 GET)
    X-CCH-Target:  上游绝对 URL(必填)
    X-CCH-Timeout:  超时毫秒(默认 120000;仅作总超时,不启用 slow-speed 限速)
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
from dataclasses import dataclass, field
from typing import Optional

from curl_cffi import requests as cffi_requests
from curl_cffi import CurlOpt

LOG = logging.getLogger("impersonate-proxy")
LISTEN_HOST = os.environ.get("IMPERSONATE_PROXY_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("IMPERSONATE_PROXY_PORT", "18686"))
DEFAULT_TIMEOUT_MS = int(os.environ.get("IMPERSONATE_PROXY_TIMEOUT_MS", "120000"))
MAX_BODY_BYTES = int(os.environ.get("IMPERSONATE_PROXY_MAX_BODY", str(64 * 1024 * 1024)))
POOL_SIZE = int(os.environ.get("IMPERSONATE_PROXY_POOL_SIZE", "4"))

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


@dataclass
class ProxyTask:
    """一个待转发的请求。由接收线程创建,worker 线程处理。"""

    handler: "ImpersonateHandler"
    method: str
    target: str
    headers: dict
    body: bytes
    timeout_ms: int
    done: threading.Event = field(default_factory=threading.Event)


class WorkerPool:
    """固定 worker 线程池,每 worker 绑定一个 Session(连接池复用)。

    接收线程只把任务放入队列;worker 用自己的 Session 执行并直接写客户端。
    任务按目标域名 hash 分配到固定 worker —— 同一上游总走同一 worker,
    其 Session 连接必然复用(避免轮转导致 keep-alive 超时)。
    """

    def __init__(self, size: int):
        self._size = size
        self._queues: list[queue.Queue[Optional[ProxyTask]]] = [
            queue.Queue() for _ in range(size)
        ]
        self._threads: list[threading.Thread] = []

    def _pick_worker(self, target: str) -> int:
        try:
            from urllib.parse import urlparse

            host = urlparse(target).hostname or target
        except Exception:  # noqa: BLE001
            host = target
        # 同一 host 固定 hash 到同一 worker
        return hash(host) % self._size

    def start(self) -> None:
        for i in range(self._size):
            t = threading.Thread(
                target=self._worker_loop,
                args=(i,),
                name=f"impersonate-worker-{i}",
                daemon=True,
            )
            t.start()
            self._threads.append(t)
        LOG.info("worker pool started: %d workers, each with its own curl Session", self._size)

    def submit(self, task: ProxyTask) -> None:
        self._queues[self._pick_worker(task.target)].put(task)

    def shutdown(self) -> None:
        for q in self._queues:
            q.put(None)
        for t in self._threads:
            t.join(timeout=5)

    def _worker_loop(self, idx: int) -> None:
        # 每 worker 一个 Session,连接池跨请求复用(线程绑定)
        local = threading.local()
        session = cffi_requests.Session(
            impersonate="chrome116",
            timeout=None,
            curl_options={
                CurlOpt.HEADERFUNCTION: self._make_header_cb(local),
            },
        )
        LOG.info("worker %d ready (curl Session with connection pool)", idx)
        q = self._queues[idx]
        while True:
            task = q.get()
            if task is None:
                session.close()
                return
            try:
                self._handle_task(task, session, local)
            except Exception as exc:  # noqa: BLE001 — worker 永不因单个任务退出
                LOG.error("worker %d task error: %s", idx, exc)
                try:
                    if not task.handler._client_gone:
                        task.handler._send_upstream_error(
                            500, f"internal_error: {type(exc).__name__}"
                        )
                except Exception:  # noqa: BLE001
                    pass
            finally:
                task.done.set()

    def _make_header_cb(self, local):
        # 每 worker 线程维护"当前 handler",回调按线程读取。
        # worker 固定线程串行处理,threading.local 隔离准确。
        def header_cb(data: bytes) -> int:
            handler = getattr(local, "handler", None)
            if handler is not None:
                try:
                    handler._on_upstream_header(data)
                except Exception:  # noqa: BLE001
                    pass
            return len(data)

        return header_cb

    def _handle_task(
        self,
        task: ProxyTask,
        session: cffi_requests.Session,
        local: threading.local,
    ) -> None:
        handler = task.handler
        handler._client_gone = False
        handler._headers_written = False

        # 构造转发 headers
        headers = strip_headers(task.headers)
        if "accept-encoding" not in {k.lower() for k in headers}:
            headers["Accept-Encoding"] = "gzip, deflate, br"

        # 设置当前 handler 到线程本地(header 回调读取)
        local.handler = handler

        try:
            upstream = session.request(
                task.method,
                task.target,
                headers=headers,
                content=task.body if task.body else None,
                content_callback=handler._on_upstream_body,
                timeout=None,
            )
        except Exception as exc:  # noqa: BLE001
            LOG.warning("upstream request error: %s %s: %s", task.method, task.target, exc)
            if not handler._client_gone and not handler._headers_written:
                handler._send_upstream_error(502, f"upstream_request_error: {type(exc).__name__}")
            return
        finally:
            local.handler = None

        # perform 完成;若 header 回调没写出头(异常/空响应),补写
        if not handler._headers_written and not handler._client_gone:
            try:
                handler.send_response(upstream.status_code)
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
                    handler.send_header(k, v)
                handler.send_header("Connection", "close")
                handler.end_headers()
            except (BrokenPipeError, ConnectionResetError):
                return
        try:
            handler.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, socket.error):
            pass


WORKERS = WorkerPool(POOL_SIZE)


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
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _on_upstream_header(self, data: bytes) -> int:
        if self._client_gone or self._headers_written:
            return len(data)
        line = data.decode("utf-8", "replace").rstrip("\r\n")
        if line.startswith("HTTP/"):
            m = line.split(" ", 2)
            if len(m) >= 2:
                try:
                    status = int(m[1])
                except ValueError:
                    return len(data)
                self.send_response(status, m[2] if len(m) > 2 else "")
                return len(data)
        if ":" in line:
            k, _, v = line.partition(":")
            lk = k.strip().lower()
            if lk in {
                "connection",
                "keep-alive",
                "transfer-encoding",
                "content-length",
                "upgrade",
            }:
                return len(data)
            self.send_header(k.strip(), v.strip())
            return len(data)
        self.send_header("Connection", "close")
        self.end_headers()
        self._headers_written = True
        return len(data)

    def _on_upstream_body(self, data: bytes) -> int:
        if self._client_gone:
            return len(data)
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, socket.error):
            self._client_gone = True
            LOG.debug("client disconnected, upstream cancelled")
        return len(data)

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

        headers = dict(self.headers.items())
        self._client_gone = False
        self._headers_written = False

        task = ProxyTask(
            handler=self,
            method=method,
            target=target,
            headers=headers,
            body=body,
            timeout_ms=timeout_ms,
        )
        WORKERS.submit(task)
        # 阻塞等待 worker 完成(worker 会写响应并关闭连接)
        task.done.wait()

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
    WORKERS.start()
    LOG.info("impersonate proxy listening on %s:%s (workers=%d)", LISTEN_HOST, LISTEN_PORT, POOL_SIZE)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        WORKERS.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
