#!/usr/bin/env python3
"""
抖音解析（opencli + 本地 Chrome 模式）—— 兜底方案。

为什么需要它：
  抖音 aweme/detail 接口的 a_bogus 签名已跟不上一轮风控升级，
  无论带不带有效 cookie，接口一律返回 200 + 空 body；
  iesdouyin 的 SSR 分享页也不再吐出 play_addr。
  唯一稳定可用的路子是：用真实浏览器打开视频页（带登录态），
  从 <video><source> 标签里读无水印直链。

实现：
  通过 opencli CLI 驱动宿主机常驻的 Chrome（有抖音登录态），
  打开 https://www.douyin.com/video/<id>，
  等播放器渲染后读 <source> 的 src（douyinvod.com 无水印直链）。

  ⚠️ 取 <source> 的 src，不要取 video.currentSrc —— 页面常走 MediaSource，
     currentSrc 是 blob: 地址，下载不了。

依赖（宿主机）：
  - Chrome 在运行且已登录抖音
  - opencli daemon + 扩展已连接（opencli doctor 三个 OK）

用法:
    python3 opencli_resolve.py --session dy <链接或视频ID>
输出: JSON (stdout)，结构与 resolve.py 一致
"""
import sys, os, json, re, asyncio, subprocess, shutil, traceback

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

OPENCLI = shutil.which('opencli') or 'opencli'
DEFAULT_SESSION = os.environ.get('OPENCLI_SESSION', 'dy')


def extract_video_id(text: str):
    text = (text or '').strip()
    m = re.search(r'/(?:video|note)/(\d+)', text)
    if m:
        return m.group(1)
    m = re.search(r'/(?:modal_id|item_ids|aweme_id)=(\d+)', text)
    if m:
        return m.group(1)
    if text.isdigit():
        return text
    return None


def _resolve_short_sync(short_url: str) -> str:
    """跟随短链重定向（用 httpx，同步）"""
    try:
        import httpx
        with httpx.Client(headers={'User-Agent': UA}, follow_redirects=True, timeout=15) as c:
            r = c.get(short_url)
        return str(r.url)
    except Exception:
        return short_url


def _run_opencli(args, timeout=90):
    """跑一条 opencli 命令，返回 stdout"""
    env = dict(os.environ)
    env.pop('BROWSER', None)
    try:
        r = subprocess.run([OPENCLI] + args, capture_output=True, text=True,
                           timeout=timeout, env=env)
        return (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired as e:
        # 超时也要把子进程杀掉，否则会堆积僵尸 opencli 进程
        return '__TIMEOUT__'
    except Exception as e:
        return f'__ERROR__ {e}'


def _pick_source_json(out: str):
    """从 opencli 输出里抠出 JSON 数组/对象（输出夹带升级提示噪音）"""
    m = re.search(r'(\[.*\]|\{.*\})', out, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def resolve_by_opencli(target: str, session: str = DEFAULT_SESSION) -> dict:
    url = (target or '').strip()
    m = re.search(r'https?://\S+', url)
    if m:
        url = m.group(0)
    if 'v.douyin.com' in url or 'iesdouyin.com/share' in url:
        url = _resolve_short_sync(url)

    vid = extract_video_id(url)
    if not vid:
        raise RuntimeError(f'无法从链接提取视频ID: {url}')

    page_url = f'https://www.douyin.com/video/{vid}'

    # 1) 打开页面
    out = _run_opencli(['browser', session, 'open', page_url], timeout=120)
    if out == '__TIMEOUT__':
        # 页面可能已加载完，继续尝试读取；真正超时才放弃
        pass

    # 2) 等播放器渲染（短视频一般 3-6 秒）
    import time
    deadline = time.time() + 45
    sources = []
    meta = {}
    best_meta = {}
    while time.time() < deadline:
        time.sleep(3)
        raw = _run_opencli([
            'browser', session, 'eval',
            "JSON.stringify({src:[...document.querySelectorAll('video source')].map(s=>s.src),"
            "cur:[...document.querySelectorAll('video')].map(v=>v.currentSrc),"
            "title:document.title,"
            "author:(document.querySelector('[data-e2e=\"video-author-name\"]')||{}).innerText||'',"
            "poster:(document.querySelector('video')||{}).poster||'',"
            "dur:(document.querySelector('video')||{}).duration||0})"
        ], timeout=60)
        data = _pick_source_json(raw)
        if isinstance(data, dict):
            meta = data
            # 记录信息最全的一份（作者/封面/时长可能要等页面渲染完才有）
            if data.get('author') or data.get('dur'):
                best_meta = data
            srcs = [s for s in (data.get('src') or []) if s and s.startswith('http')]
            if srcs:
                sources = srcs
                # 拿到直链后，若元数据已齐则提前退出，否则再等一轮补齐
                if data.get('author') and data.get('dur'):
                    break

    # 合并元数据：优先用信息更全的那份
    merged = dict(meta)
    for k, v in (best_meta or {}).items():
        if v and not merged.get(k):
            merged[k] = v
    meta = merged

    if not sources:
        # 退一步：看看 currentSrc 里有没有非 blob 的可用地址
        for c in (meta.get('cur') or []):
            if c and c.startswith('http') and 'douyinvod' in c:
                sources = [c]
                break

    if not sources:
        raise RuntimeError('opencli 模式未能取到播放地址（Chrome 未登录抖音，或页面未渲染出播放器）')

    # 优先 douyinvod（无水印 CDN）
    picked = next((s for s in sources if 'douyinvod' in s), sources[0])

    title = re.sub(r'\s*-\s*抖音\s*$', '', (meta.get('title') or '').strip())
    dur = meta.get('dur') or 0
    try:
        dur_ms = int(float(dur) * 1000)
    except Exception:
        dur_ms = 0

    return {
        'id': vid,
        'type': 'video',
        'title': title,
        'author': (meta.get('author') or '').strip(),
        'cover': meta.get('poster') or '',
        'musicUrl': '',
        'duration': dur_ms,
        'likes': 0,
        'comments': 0,
        'shares': 0,
        'videoUrl': picked,
        'videoUrls': sources,
        'source': 'opencli',
    }


def main():
    args = sys.argv[1:]
    session = DEFAULT_SESSION
    positional = []
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith('--session='):
            session = a.split('=', 1)[1]
        elif a == '--session':
            i += 1
            if i < len(args):
                session = args[i]
        else:
            positional.append(a)
        i += 1

    if not positional:
        print(json.dumps({'ok': False, 'error': '用法: opencli_resolve.py [--session=dy] <链接或视频ID>'}, ensure_ascii=False))
        return

    try:
        result = resolve_by_opencli(positional[0], session)
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
