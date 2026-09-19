#!/usr/bin/env python3
"""
抖音浏览器兜底解析 —— 宿主机 HTTP 服务。

为什么需要它：
  opencli 必须跑在宿主机（要连宿主机的 Chrome、要有抖音登录态），
  而 wxtools 的 douyin-resolver 跑在容器里，容器内没有 Chrome/opencli。
  所以把「opencli 取播放地址」这步单独抽成宿主机服务，容器通过
  host.docker.internal 调它。

依赖（宿主机）：
  - Chrome 在运行且已登录抖音
  - opencli daemon + 扩展已连接（opencli doctor 三个 OK）
  - python3

端点:
  GET /resolve?url=<链接或ID>    → {code, message, data:{...}}
  GET /health
用法: python3 dy_browser_service.py [port]   # 默认 3009
"""
import sys, json, logging, os, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from opencli_resolve import resolve_by_opencli, DEFAULT_SESSION

PORT = int(os.environ.get('DY_BROWSER_PORT', '3009'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger('dy-browser')


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """⚠️ 必须多线程：解析一次要 50 秒，单线程 HTTPServer 会被一个慢请求
    堵死（连 /health 都不响应），上层全超时。
    """
    daemon_threads = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.info("%s - %s" % (self.address_string(), fmt % args))

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            log.warning('客户端提前断开，响应未送达')

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)

        if self.path.startswith('/resolve'):
            url = (q.get('url') or [''])[0].strip()
            session = (q.get('session') or [DEFAULT_SESSION])[0].strip()
            if not url:
                self._send_json(400, {'code': 400, 'message': '缺少 url 参数', 'data': None})
                return
            try:
                data = resolve_by_opencli(url, session)
                log.info(f'解析成功: {url[:80]}')
                self._send_json(200, {'code': 200, 'message': 'success', 'data': data})
            except Exception as e:
                log.warning(f'解析失败: {e}')
                self._send_json(500, {'code': 500, 'message': str(e), 'data': None})
        elif self.path.startswith('/health'):
            self._send_json(200, {'status': 'ok'})
        else:
            self._send_json(404, {'code': 404, 'message': 'not found', 'data': None})


def main():
    global PORT
    if len(sys.argv) > 1:
        PORT = int(sys.argv[1])
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    log.info(f'抖音浏览器兜底服务启动（多线程），监听 0.0.0.0:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()
