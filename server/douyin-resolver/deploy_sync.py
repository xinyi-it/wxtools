#!/usr/bin/env python3
"""
抖音解析 - 部署同步脚本

用途：改完解析相关代码后，一条命令把改动推到位并验证。

⚠️ 这个脚本存在的原因（踩过的坑）：
  浏览器兜底服务 dy-browser-fallback 是常驻进程，import 之后代码就在内存里了。
  改了 opencli_resolve.py 但不重启它，服务照旧跑旧代码 —— 表现是
  "宿主机手动跑有作者/封面，走接口就没有"，极易误判成代码写错。

执行内容：
  1. 重启 dy-browser-fallback（让兜底服务加载新代码）
  2. 重建 douyin-resolver 容器（让镜像带上新脚本）
  3. 健康检查 + 清缓存
  4. 拿测试链接跑一次公网端到端，打印关键字段

用法：
    python3 deploy_sync.py                 # 用默认测试链接
    python3 deploy_sync.py <抖音链接>       # 指定链接
"""
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request

BASE = 'https://gogkd.com/wxtools/api'
DEFAULT_TEST_URL = 'https://v.douyin.com/Bwc_X6pPeDo/'
PROJECT = '/home/wujianguo/Documents/wxtools'


def sh(cmd, timeout=600):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def http(url, method='GET', payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            'Content-Type': 'application/json',
            # 带个正常 UA：裸 urllib 的默认 UA 会被 Cloudflare 判可疑，偶发 403
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/120.0.0.0 Safari/537.36',
        })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def main():
    test_url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TEST_URL

    print('=== 1/4 重启浏览器兜底服务（关键：不重启就是跑旧代码） ===')
    rc, out = sh('sudo systemctl restart dy-browser-fallback')
    if rc != 0:
        print('重启失败:', out[-300:])
        return 1
    time.sleep(4)
    rc, out = sh('systemctl is-active dy-browser-fallback')
    print('服务状态:', out.strip())
    if 'active' not in out:
        return 1

    print('=== 2/4 重建解析容器 ===')
    rc, out = sh(f'cd {PROJECT} && docker compose build douyin-resolver && '
                 f'docker compose up -d douyin-resolver', timeout=900)
    if rc != 0:
        print('重建失败:', out[-500:])
        return 1
    time.sleep(8)
    rc, out = sh('docker exec wxtools-douyin-resolver-1 sh -c "ls /app"')
    print('容器内文件:', ' '.join(out.split()))

    print('=== 3/4 健康检查 + 清缓存 ===')
    try:
        h = http('http://localhost:3008/health')
        print('解析服务:', h)
    except Exception as e:
        print('解析服务不通:', e)
        return 1
    sh('docker exec wxtools-redis-1 redis-cli FLUSHDB')
    print('缓存已清')

    print('=== 4/4 公网端到端验证 ===')
    try:
        sub = http(f'{BASE}/douyin/parse/async', 'POST', {'url': test_url})
    except Exception as e:
        print('提交失败:', e)
        return 1
    task_id = (sub.get('data') or {}).get('taskId')
    if not task_id:
        print('未拿到 taskId:', sub)
        return 1
    print('taskId:', task_id)

    deadline = time.time() + 180
    result = None
    while time.time() < deadline:
        time.sleep(4)
        try:
            q = http(f'{BASE}/douyin/parse/task?taskId={urllib.parse.quote(task_id)}')
        except Exception:
            continue
        st = (q.get('data') or {}).get('status')
        if st == 'done':
            result = (q.get('data') or {}).get('data')
            break
        if st == 'failed':
            print('解析失败:', q.get('message'))
            return 1
        print('  等待中...', st)

    if not result:
        print('超时未拿到结果')
        return 1

    print()
    print('=== 结果 ===')
    print('标题  :', result.get('title'))
    print('作者  :', repr(result.get('author')))
    print('封面  :', (result.get('cover') or '')[:90])
    print('时长  :', result.get('duration'))
    print('数据  :', result.get('statistics'))
    print('直链  :', (result.get('videoUrl') or '')[:70])

    missing = [k for k in ('author', 'cover') if not result.get(k)]
    if missing:
        print()
        print(f'⚠️ 仍为空: {missing} —— 若宿主机手动跑有值，检查兜底服务是否真的重启了')
        return 1
    print()
    print('✅ 全部字段就位')
    return 0


if __name__ == '__main__':
    sys.exit(main())
