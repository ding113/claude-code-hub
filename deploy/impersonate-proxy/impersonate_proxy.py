#!/usr/bin/env python3
"""
impersonate-proxy: 本地常驻伪装转发代理(curl multi + 连接缓存)。

架构: 全局一个 curl_multi handle。每个 /impersonate 请求创建一个 easy handle
(完整 Chrome 指纹 via curl_easy_impersonate),挂到 multi 上由驱动线程驱动。
multi 内部自带连接缓存: 同一上游的后续请求自动复用 TCP+TLS 连接(keep-alive),
HTTP/2 下同连接多路复用。并发数 = 请求线程数,无固定池限制。

协议(与旧版兼容):
  POST /impersonate   X-CCH-Method / X-CCH-Target / X-CCH-Timeout 头,body 为请求体
  GET  /health        {"ok": true}
"""
import ctypes
import os
import queue
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SO_PATH = os.environ.get("LIB_CURL_IMPERSONATE_SO", "/usr/local/lib/libcurl-impersonate-chrome.so.4.8.0")

lib = ctypes.CDLL(SO_PATH)

# ---------- 类型 ----------
class CURL(ctypes.Structure):
    pass

class CURLM(ctypes.Structure):
    pass

class CurlSlist(ctypes.Structure):
    pass

CurlSlist._fields_ = [("data", ctypes.c_char_p), ("next", ctypes.POINTER(CurlSlist))]

class CURLMsg(ctypes.Structure):
    class _u(ctypes.Union):
        _fields_ = [("whatever", ctypes.c_void_p), ("result", ctypes.c_int)]

    _fields_ = [("msg", ctypes.c_int), ("easy_handle", ctypes.POINTER(CURL)), ("data", _u)]

# ---------- API ----------
lib.curl_easy_impersonate.restype = ctypes.c_int
lib.curl_easy_impersonate.argtypes = [ctypes.POINTER(CURL), ctypes.c_char_p, ctypes.c_int]
lib.curl_easy_init.restype = ctypes.POINTER(CURL)
lib.curl_easy_cleanup.argtypes = [ctypes.POINTER(CURL)]
lib.curl_easy_setopt.argtypes = [ctypes.POINTER(CURL), ctypes.c_int, ctypes.c_void_p]
lib.curl_easy_setopt.restype = ctypes.c_int
lib.curl_slist_append.argtypes = [ctypes.POINTER(CurlSlist), ctypes.c_char_p]
lib.curl_slist_append.restype = ctypes.POINTER(CurlSlist)
lib.curl_slist_free_all.argtypes = [ctypes.POINTER(CurlSlist)]
lib.curl_multi_init.restype = ctypes.POINTER(CURLM)
lib.curl_multi_add_handle.argtypes = [ctypes.POINTER(CURLM), ctypes.POINTER(CURL)]
lib.curl_multi_add_handle.restype = ctypes.c_int
lib.curl_multi_remove_handle.argtypes = [ctypes.POINTER(CURLM), ctypes.POINTER(CURL)]
lib.curl_multi_remove_handle.restype = ctypes.c_int
lib.curl_multi_perform.argtypes = [ctypes.POINTER(CURLM), ctypes.POINTER(ctypes.c_int)]
lib.curl_multi_perform.restype = ctypes.c_int
lib.curl_multi_info_read.argtypes = [ctypes.POINTER(CURLM), ctypes.POINTER(ctypes.c_int)]
lib.curl_multi_info_read.restype = ctypes.POINTER(CURLMsg)
lib.curl_multi_poll.argtypes = [ctypes.POINTER(CURLM), ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
lib.curl_multi_poll.restype = ctypes.c_int
lib.curl_multi_wakeup.argtypes = [ctypes.POINTER(CURLM)]
lib.curl_multi_wakeup.restype = ctypes.c_int

# ---------- 常量 ----------
CURLOPT_URL = 10002
CURLOPT_HTTPHEADER = 10023
CURLOPT_CUSTOMREQUEST = 10036
CURLOPT_POSTFIELDS = 10015
CURLOPT_POSTFIELDSIZE = 60
CURLOPT_WRITEFUNCTION = 20011
CURLOPT_WRITEDATA = 10001
CURLOPT_HEADERFUNCTION = 20079
CURLOPT_HEADERDATA = 10029
CURLOPT_TIMEOUT_MS = 155
CURLOPT_CONNECTTIMEOUT_MS = 156
CURLOPT_HTTP_VERSION = 84
CURLOPT_ACCEPT_ENCODING = 10102
CURLOPT_NOSIGNAL = 99
CURLOPT_SSL_VERIFYPEER = 64
CURLOPT_SSL_VERIFYHOST = 81
CURLOPT_SSL_CIPHER_LIST = 83
CURLOPT_SSLVERSION = 32
CURLOPT_SSL_ENABLE_ALPS = 325
CURLOPT_SSL_CERT_COMPRESSION = 326
CURLOPT_SSL_ENABLE_TICKET = 327
CURLOPT_HTTP2_PSEUDO_HEADERS_ORDER = 328
CURLOPT_HTTP2_NO_SERVER_PUSH = 329
CURLOPT_SSL_PERMUTE_EXTENSIONS = 330
CURL_SSLVERSION_TLSv1_2 = 5
CURL_HTTP_VERSION_1_1 = 2
CURL_HTTP_VERSION_2_0 = 3
CURL_HTTP_VERSION_2TLS = 4
CURLMSG_DONE = 1

# ---------- 全局 multi ----------
MULTI = lib.curl_multi_init()
MULTI_LOCK = threading.Lock()
STATES = {}
STATES_LOCK = threading.Lock()


class State:
    """一个在途请求的状态。驱动线程写,请求线程读。"""

    def __init__(self):
        self.chunks = queue.Queue()  # ('header', None) | ('body', bytes) | ('done', err|None)
        self.status = 0
        self.resp_headers = {}
        self.first_body_at = None
        self.header_at = None
        self.started = time.monotonic()
        self.ttfb_ms = 0
        self.done = threading.Event()


WRITEFUNC = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p)
HEADERFUNC = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p)


def _state_of(userdata):
    easy_ptr = ctypes.cast(userdata, ctypes.c_void_p).value
    with STATES_LOCK:
        return STATES.get(easy_ptr)


@WRITEFUNC
def write_cb(ptr, size, nmemb, userdata):
    n = size * nmemb
    st = _state_of(userdata)
    if st is not None:
        if st.first_body_at is None:
            st.first_body_at = time.monotonic()
        st.chunks.put(("body", ptr[:n]))
    return n


@HEADERFUNC
def header_cb(ptr, size, nmemb, userdata):
    n = size * nmemb
    line = ptr[:n].decode("utf-8", errors="replace").rstrip("\r\n")
    st = _state_of(userdata)
    if st is not None:
        if line.startswith("HTTP/"):
            parts = line.split(" ", 2)
            try:
                st.status = int(parts[1])
            except (ValueError, IndexError):
                st.status = 0
        elif line and ":" in line:
            k, _, v = line.partition(":")
            st.resp_headers.setdefault(k.strip().lower(), v.strip())
        elif line == "":
            if st.header_at is None:
                st.header_at = time.monotonic()
                if os.environ.get("IMPERSONATE_PROXY_DEBUG"):
                    print(f"[impersonate-proxy] headers done at {(st.header_at - st.started)*1000:.0f}ms status={st.status}", flush=True)
            st.chunks.put(("header", None))
    return n


def _drive_once():
    running = ctypes.c_int()
    lib.curl_multi_perform(MULTI, ctypes.byref(running))
    q = ctypes.c_int()
    while True:
        msg = lib.curl_multi_info_read(MULTI, ctypes.byref(q))
        if not msg:
            break
        if msg.contents.msg == CURLMSG_DONE:
            easy_ptr = ctypes.cast(msg.contents.easy_handle, ctypes.c_void_p).value
            with STATES_LOCK:
                st = STATES.pop(easy_ptr, None)
            if st is not None:
                err = None
                if msg.contents.data.result != 0:
                    err = f"curl rc={msg.contents.data.result}"
                if st.first_body_at is not None:
                    st.ttfb_ms = int((st.first_body_at - st.started) * 1000)
                    if os.environ.get("IMPERSONATE_PROXY_DEBUG"):
                        print(f"[impersonate-proxy] done: ttfb={st.ttfb_ms}ms status={st.status}", flush=True)
                st.chunks.put(("done", err))
                st.done.set()
    n = ctypes.c_int()
    # poll 超时短: curl_multi_wakeup 是 8.2+ API,此 8.1.1 fork 中可能无效,
    # 靠短超时保证 add_handle 后 ≤50ms 被驱动;fd 活动时 poll 立即返回不受影响
    lib.curl_multi_poll(MULTI, None, 0, 50, ctypes.byref(n))


def _drive_loop():
    while True:
        try:
            _drive_once()
        except Exception as e:  # noqa: BLE001 - 驱动线程必须存活
            print(f"[impersonate-proxy] drive error: {e}", flush=True)
            time.sleep(0.1)


threading.Thread(target=_drive_loop, daemon=True).start()


def _build_easy(url, method, headers, body, timeout_ms):
    easy = lib.curl_easy_init()
    if not easy:
        raise RuntimeError("curl_easy_init failed")
    # gcc9 官方构建的 .so:curl_easy_impersonate API 与 CLI 二进制同速
    # (实测 ttfb 0.56s vs CLI 0.57s;旧 gcc15 编译 .so 的 API 路径慢 4-10 倍,
    #  那是构建环境问题,已由官方 gcc9 复刻构建解决,不再需要手动逐项对照)
    rc = lib.curl_easy_impersonate(easy, b"chrome116", 1)
    if rc != 0:
        lib.curl_easy_cleanup(easy)
        raise RuntimeError(f"curl_easy_impersonate rc={rc}")
    lib.curl_easy_setopt(easy, CURLOPT_URL, url.encode())
    lib.curl_easy_setopt(easy, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_2_0)
    lib.curl_easy_setopt(easy, CURLOPT_TIMEOUT_MS, timeout_ms)
    lib.curl_easy_setopt(easy, CURLOPT_CONNECTTIMEOUT_MS, 10000)
    lib.curl_easy_setopt(easy, CURLOPT_NOSIGNAL, 1)
    lib.curl_easy_setopt(easy, CURLOPT_SSL_VERIFYPEER, 1)
    lib.curl_easy_setopt(easy, CURLOPT_SSL_VERIFYHOST, 2)
    # --http2-no-server-push / --compressed (impersonate API 不含 accept-encoding)
    lib.curl_easy_setopt(easy, CURLOPT_HTTP2_NO_SERVER_PUSH, 1)
    lib.curl_easy_setopt(easy, CURLOPT_ACCEPT_ENCODING, b"")
    if method:
        lib.curl_easy_setopt(easy, CURLOPT_CUSTOMREQUEST, method.encode())
    if body is not None:
        lib.curl_easy_setopt(easy, CURLOPT_POSTFIELDS, ctypes.cast(body, ctypes.c_void_p))
        lib.curl_easy_setopt(easy, CURLOPT_POSTFIELDSIZE, len(body))
        easy._body_ref = body  # 保持引用防 GC
    slist = None
    # impersonate API 已设 Chrome 默认头;这里只追加转发头(Authorization/Content-Type 等)
    for h in headers or []:
        slist = lib.curl_slist_append(slist, h.encode())
    if slist:
        lib.curl_easy_setopt(easy, CURLOPT_HTTPHEADER, ctypes.cast(slist, ctypes.c_void_p))
    return easy, slist


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "impersonate-proxy/1.0"

    def log_message(self, format, *args):  # noqa: A002 - 静默访问日志
        return

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return None
        data = self.rfile.read(length)
        # ctypes 需要 bytes; body 原样转发
        return data

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            body = b'{"ok": true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") != "/impersonate":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        try:
            self._handle_impersonate()
        except Exception as e:  # noqa: BLE001
            print(f"[impersonate-proxy] handler error: {e}", flush=True)
            try:
                self.send_response(502)
                self.send_header("Content-Length", "0")
                self.end_headers()
            except Exception:  # noqa: BLE001 - 连接可能已断
                pass

    def _handle_impersonate(self):
        target = self.headers.get("X-CCH-Target", "")
        method = self.headers.get("X-CCH-Method", "GET")
        try:
            timeout_ms = int(self.headers.get("X-CCH-Timeout") or 120000)
        except ValueError:
            timeout_ms = 120000
        if not target:
            self.send_response(400)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        # 转发头: 去掉 hop-by-hop / 代理私有头 / curl 客户端自动头
        # (curl CLI 默认 UA=curl/8.x、Accept=*/* 会覆盖 impersonate 的 Chrome 指纹头,
        #  导致上游按非浏览器客户端慢速惩罚,必须剥掉)
        fwd = []
        for k, v in self.headers.items():
            kl = k.lower()
            if (kl in ("host", "content-length", "connection", "keep-alive",
                       "transfer-encoding", "te", "trailer", "upgrade",
                       "proxy-authorization", "proxy-connection",
                       "user-agent", "accept", "accept-encoding")
                    or kl.startswith("x-cch-")):
                continue
            fwd.append(f"{k}: {v}")

        body = self._read_body()
        st = State()
        easy, slist = _build_easy(target, method, fwd, body, timeout_ms)
        easy_ptr = ctypes.cast(easy, ctypes.c_void_p).value
        with STATES_LOCK:
            STATES[easy_ptr] = st
        lib.curl_easy_setopt(easy, CURLOPT_WRITEFUNCTION, write_cb)
        lib.curl_easy_setopt(easy, CURLOPT_WRITEDATA, ctypes.cast(easy, ctypes.c_void_p))
        lib.curl_easy_setopt(easy, CURLOPT_HEADERFUNCTION, header_cb)
        lib.curl_easy_setopt(easy, CURLOPT_HEADERDATA, ctypes.cast(easy, ctypes.c_void_p))

        with MULTI_LOCK:
            mrc = lib.curl_multi_add_handle(MULTI, easy)
        if mrc != 0:
            lib.curl_slist_free_all(slist)
            lib.curl_easy_cleanup(easy)
            self.send_response(502)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        # add_handle 不会唤醒 multi_wait,必须显式 wakeup 让驱动线程立即调度
        lib.curl_multi_wakeup(MULTI)

        # 流式转发: 等 header 事件 → 写响应头; body 事件 → 逐块写; done/超时 → 收尾
        wrote_headers = False
        err = None
        timeout_at = time.monotonic() + timeout_ms / 1000 + 5
        try:
            while time.monotonic() < timeout_at:
                try:
                    kind, payload = st.chunks.get(timeout=1)
                except queue.Empty:
                    continue
                if kind == "header":
                    status = st.status or 200
                    reason = "OK" if status == 200 else ("Error" if status >= 400 else "OK")
                    self.send_response(status, reason)
                    self.send_header("Transfer-Encoding", "chunked")
                    # 转发少量上游头(chunked 下丢弃 content-length)
                    for k, v in st.resp_headers.items():
                        if k in ("content-length", "transfer-encoding", "connection", "keep-alive"):
                            continue
                        if k == "content-type":
                            self.send_header(k, v)
                    self.end_headers()
                    wrote_headers = True
                    self.wfile.flush()
                elif kind == "body":
                    if not wrote_headers:
                        continue  # 理论不会发生; 等 header 先
                    chunk = payload
                    if chunk:
                        self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                        self.wfile.flush()
                elif kind == "done":
                    err = payload
                    if wrote_headers:
                        self.wfile.write(b"0\r\n\r\n")
                        self.wfile.flush()
                    break
            else:
                err = "timeout"
                if wrote_headers:
                    self.wfile.write(b"0\r\n\r\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, socket.error):  # noqa: BLE001
            pass
        finally:
            with MULTI_LOCK:
                lib.curl_multi_remove_handle(MULTI, easy)
            lib.curl_slist_free_all(slist)
            lib.curl_easy_cleanup(easy)
            with STATES_LOCK:
                STATES.pop(ctypes.cast(easy, ctypes.c_void_p).value, None)

        if not wrote_headers:
            code = 504 if err == "timeout" else 502
            try:
                self.send_response(code)
                self.send_header("Content-Length", "0")
                self.end_headers()
            except Exception:  # noqa: BLE001
                pass


def main():
    import os
    port = int(os.environ.get("IMPERSONATE_PROXY_PORT", "18686"))
    host = os.environ.get("IMPERSONATE_PROXY_HOST", "127.0.0.1")
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    print(f"[impersonate-proxy] listening {host}:{port} (multi + keep-alive, .so={SO_PATH})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
