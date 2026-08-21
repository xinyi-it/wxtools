#!/usr/bin/env python3
"""
抖音无水印视频解析 HTTP 服务 — 封装 f2 + Chrome cookie 解析
为 wxtools 提供抖音无水印解析能力。
用法: python3 douyin_http_server.py [port]
端点: GET /parse?url=<分享链接或视频ID>
"""
import sys, json, re, subprocess, os, logging
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 3008
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'douyin_resolve.py')
PY = sys.executable

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger('douyin-http')

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.info("%s - %s" % (self.address_string(), fmt % args))

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/parse'):
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            url = (q.get('url') or [''])[0].strip()
            if not url:
                self._send_json(400, {'code': 400, 'message': '缺少 url 参数', 'data': None})
                return
            try:
                r = subprocess.run(
                    [PY, SCRIPT, url],
                    capture_output=True, text=True, timeout=120
                )
                out = r.stdout.strip()
                # 取最后一行 JSON
                lines = [l for l in out.splitlines() if l.strip().startswith('{')]
                result = json.loads(lines[-1]) if lines else {'ok': False, 'error': out[-200:] or '无输出'}
                if result.get('ok'):
                    data = result['data']
                    # 转成 wxtools 原接口格式
                    resp = {
                        'type': 'video',
                        'title': data.get('title', ''),
                        'author': data.get('author', ''),
                        'cover': data.get('cover', ''),
                        'videoUrl': data.get('videoUrl', ''),
                        'musicUrl': data.get('musicUrl', ''),
                        'duration': round((data.get('duration') or 0) / 1000, 1) if (data.get('duration') or 0) > 1000 else (data.get('duration') or 0),
                        'statistics': {
                            'likes': data.get('likes', 0),
                            'comments': data.get('comments', 0),
                            'shares': data.get('shares', 0),
                        },
                    }
                    self._send_json(200, {'code': 200, 'message': 'success', 'data': resp})
                else:
                    self._send_json(500, {'code': 500, 'message': result.get('error', '解析失败'), 'data': None})
            except subprocess.TimeoutExpired:
                self._send_json(500, {'code': 500, 'message': '解析超时', 'data': None})
            except Exception as e:
                self._send_json(500, {'code': 500, 'message': f'内部错误: {e}', 'data': None})
        elif self.path == '/health':
            self._send_json(200, {'status': 'ok'})
        else:
            self._send_json(404, {'code': 404, 'message': 'not found', 'data': None})

def main():
    global PORT
    if len(sys.argv) > 1:
        PORT = int(sys.argv[1])
    # 绑定所有网卡，供 docker 通过网桥访问
    server = HTTPServer(('0.0.0.0', PORT), Handler)
    log.info(f"抖音解析 HTTP 服务启动，监听 0.0.0.0:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()

if __name__ == '__main__':
    main()
