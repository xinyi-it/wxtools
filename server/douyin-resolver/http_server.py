#!/usr/bin/env python3
"""
抖音无水印视频解析 HTTP 服务
为 wxtools 提供抖音无水印解析能力。

双通道设计：
  1. 主通道 resolve.py —— 直连抖音 web 详情接口（快，元数据全）
  2. 兜底 opencli_resolve.py —— 用真实浏览器打开视频页读播放地址
     （接口被风控挡住时自动切换；需要宿主机 Chrome 已登录抖音 + opencli 可用）

端点: GET /parse?url=<分享链接或视频ID>            （自动双通道）
      GET /parse?url=...&mode=api                  （只走接口）
      GET /parse?url=...&mode=browser              （只走浏览器兜底）
      GET /cookie/check?cookie=<cookie>
      GET /health
用法: python3 http_server.py [port]
"""
import sys, json, re, subprocess, os, logging, time
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 3008
BASE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(BASE, 'resolve.py')
PY = sys.executable

# 浏览器兜底：opencli 只能跑在宿主机（要连宿主机 Chrome + 抖音登录态），
# 容器内没有 Chrome/opencli，所以通过这个地址转发。
BROWSER_HOST = os.environ.get('DY_BROWSER_HOST', 'http://host.docker.internal:3009')
# 哪些错误值得切兜底（接口被风控/空响应/签名失效类）
FALLBACK_HINTS = ('空', '风控', '403', '接口返回非 JSON', '未返回作品详情', 'Status Code', 'DBUS', 'cookie')

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger('douyin-http')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.info("%s - %s" % (self.address_string(), fmt % args))

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # 客户端（上层服务）已断开，别再抛栈
            log.warning('客户端提前断开，响应未送达')

    # ---------- 内部工具 ----------

    def _run_script(self, script, args, timeout):
        """跑解析脚本，返回 (ok, payload)"""
        r = subprocess.run([PY, script] + args, capture_output=True, text=True, timeout=timeout)
        out = r.stdout or ''
        lines = [l for l in out.splitlines() if l.strip().startswith('{')]
        if not lines:
            return False, {'error': (out[-200:] or '无输出')}
        try:
            result = json.loads(lines[-1])
        except Exception as e:
            return False, {'error': f'解析脚本输出无法解析: {e}'}
        return bool(result.get('ok')), result

    def _format(self, data):
        """把内部数据结构转成 wxtools 前端期望的格式"""
        itype = data.get('type', 'video')
        dur = data.get('duration') or 0
        resp = {
            'type': itype,
            'title': data.get('title', ''),
            'author': data.get('author', ''),
            'cover': data.get('cover', ''),
            'videoUrl': data.get('videoUrl', ''),
            'musicUrl': data.get('musicUrl', ''),
            'duration': round(dur / 1000, 1) if dur > 1000 else dur,
            'statistics': {
                'likes': data.get('likes', 0),
                'comments': data.get('comments', 0),
                'shares': data.get('shares', 0),
                'collects': data.get('collects', 0),
            },
        }
        if itype == 'images':
            resp['images'] = data.get('images', [])
            resp['imageCount'] = data.get('imageCount', 0)
        return resp

    def _fallback_reason(self, err: str) -> bool:
        """判断这个错误是否值得切浏览器兜底"""
        if not err:
            return True          # 没给出原因，试一次兜底也不亏
        return any(h in err for h in FALLBACK_HINTS)

    def _call_browser_fallback(self, url):
        """调宿主机的浏览器兜底服务（opencli + 本地 Chrome）

        返回 (ok, data_or_errmsg)
        """
        import urllib.parse, urllib.request
        target = f'{BROWSER_HOST}/resolve?' + urllib.parse.urlencode({'url': url})
        try:
            # 兜底要等页面渲染，实测 50-90 秒，超时必须给足
            with urllib.request.urlopen(target, timeout=220) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
            if payload.get('code') == 200 and payload.get('data'):
                return True, payload['data']
            return False, payload.get('message') or '浏览器兜底返回异常'
        except Exception as e:
            return False, f'浏览器兜底服务不可用（{BROWSER_HOST}）: {e}'

    # ---------- 主路由 ----------

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)

        if self.path.startswith('/parse'):
            self._handle_parse(q)
        elif self.path.startswith('/cookie/check'):
            self._handle_cookie_check(q)
        elif self.path.startswith('/health'):
            self._send_json(200, {
                'status': 'ok',
                'api': True,
                'browser_fallback': BROWSER_HOST,
            })
        else:
            self._send_json(404, {'code': 404, 'message': 'not found', 'data': None})

    def _handle_parse(self, q):
        url = (q.get('url') or [''])[0].strip()
        cookie = (q.get('cookie') or [''])[0].strip()
        mode = (q.get('mode') or ['auto'])[0].strip()

        if not url:
            self._send_json(400, {'code': 400, 'message': '缺少 url 参数', 'data': None})
            return

        api_error = ''
        # ---- 通道 1：接口 ----
        if mode in ('auto', 'api'):
            args = [SCRIPT]
            if cookie:
                args += ['--cookie', cookie]
            args.append(url)
            try:
                ok, result = self._run_script(SCRIPT, args[1:], timeout=120)
                if ok:
                    log.info('[parse] 接口通道成功')
                    self._send_json(200, {'code': 200, 'message': 'success',
                                          'data': self._format(result['data'])})
                    return
                api_error = result.get('error', '')
                log.info(f'[parse] 接口通道失败: {api_error}')
            except subprocess.TimeoutExpired:
                api_error = '解析超时'
                log.info('[parse] 接口通道超时')
            except Exception as e:
                api_error = f'内部错误: {e}'
                log.warning(f'[parse] 接口通道异常: {e}')

            if mode == 'api':
                self._send_json(500, {'code': 500, 'message': api_error or '解析失败', 'data': None})
                return

        # ---- 通道 2：浏览器兜底 ----
        if mode == 'browser' or self._fallback_reason(api_error):
            log.info(f'[parse] 尝试浏览器兜底（{BROWSER_HOST}）')
            ok, payload = self._call_browser_fallback(url)
            if ok:
                log.info('[parse] 浏览器兜底成功')
                self._send_json(200, {'code': 200, 'message': 'success',
                                      'data': self._format(payload)})
                return
            log.info(f'[parse] 浏览器兜底失败: {payload}')
            self._send_json(500, {'code': 500,
                                  'message': payload or api_error or '解析失败',
                                  'data': None})
            return

    def _handle_cookie_check(self, q):
        cookie = (q.get('cookie') or [''])[0].strip()
        try:
            args = ['--check-cookie']
            if cookie:
                args += ['--cookie', cookie]
            ok, result = self._run_script(SCRIPT, args, timeout=30)
            if ok:
                self._send_json(200, {'code': 200, 'message': 'success', 'data': result['data']})
            else:
                self._send_json(500, {'code': 500, 'message': result.get('error', 'Cookie检测失败'), 'data': None})
        except Exception as e:
            self._send_json(500, {'code': 500, 'message': f'内部错误: {e}', 'data': None})


def main():
    global PORT
    if len(sys.argv) > 1:
        PORT = int(sys.argv[1])
    server = HTTPServer(('0.0.0.0', PORT), Handler)
    log.info(f"抖音解析 HTTP 服务启动，监听 0.0.0.0:{PORT}（浏览器兜底={BROWSER_HOST}）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()
