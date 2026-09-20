#!/usr/bin/env python3
"""
抖音解析 —— iesdouyin 分享页 SSR 通道（纯 HTTP，主通道）

为什么需要它：
  抖音的网页详情接口（aweme/v1/web/aweme/detail）已被风控锁死：无论带不带
  cookie、无论用什么 TLS 指纹，一律返回 200 空 body，响应头里写着
  {"name":"强制阻断"}。opencli 浏览器方案能绕过，但每次要 5~9 秒、
  还要常驻一个登录态 Chrome。

解法（本文件）：
  走移动端分享页 https://www.iesdouyin.com/share/video/<id>/，
  页面 HTML 里内联了 window._ROUTER_DATA，其中
  loaderData["video_(id)/page"].videoInfoRes.item_list[0] 就是完整的作品数据
  —— 视频直链、图文图片、动图、音乐、互动数据全在里面。
  纯 HTTP 一次请求，实测 2.1~2.6 秒，比浏览器方案快一倍多。

⚠️ 三个必须遵守的点（都是实测撞出来的）：

  1) 必须用 iPhone UA。
     桌面 UA 拿到的页面是空骨架，_ROUTER_DATA 里没有 item_list。

  2) 请求前必须先 GET 一次 https://www.douyin.com/ 拿 cookie，并等 1 秒。
     少了这一步，分享页同样不吐数据。

  3) 路径统一用 /video/<id>/，不要用 /note/ 或 /slides/。
     /note/ 和 /slides/ 的 loaderData key 是 note_(id)/page，结构不同、
     拿不到 item_list；/video/ 会自动适配所有作品类型（视频/图文/动图）。

⚠️ 频率限制（重要）：
  同一个出口 IP 短时间内重复请求同一作品，抖音会返回
  videoInfoRes = {}（HTTP 依然 200，静默给空）。表现是「第一次成功、
  紧接着重试就空」。所以本模块内置：
    - 进程内结果缓存（TTL 可配）
    - 最小请求间隔（令牌桶式节流）
    - 命中空体时的退避重试
"""
import json
import os
import re
import threading
import time

import requests

MOBILE_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) '
             'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 '
             'Mobile/15E148 Safari/604.1')

HOME_URL = 'https://www.douyin.com/'
SHARE_URL = 'https://www.iesdouyin.com/share/video/{vid}/'

# 最小请求间隔（秒）：两个作品之间至少隔这么久，避免触发限流
MIN_INTERVAL = float(os.environ.get('SSR_MIN_INTERVAL', '1.5'))
# 结果缓存 TTL（秒）
CACHE_TTL = float(os.environ.get('SSR_CACHE_TTL', '600'))
# 撞到限流空体时的重试次数与基础退避
RETRY_TIMES = int(os.environ.get('SSR_RETRY', '3'))
RETRY_BACKOFF = float(os.environ.get('SSR_BACKOFF', '4'))

_UA_HEADERS = {
    'User-Agent': MOBILE_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

_lock = threading.Lock()
_last_request_at = [0.0]          # 上次请求时刻（全局节流）
_cache = {}                       # vid -> (expire_at, payload)


# ---------- 工具 ----------

def extract_share_id(text: str):
    """从任意形式的分享内容里取作品 ID

    支持的形态：
      https://v.douyin.com/xxx/                 短链（需先跟重定向）
      https://www.douyin.com/video/123          完整链接
      https://www.douyin.com/note/123
      https://www.douyin.com/slides/123
      ?modal_id=123
      纯数字 ID
    ⚠️ 短链的字符集要包含 - 和 _（参考实现里用 [A-Za-z0-9]+ 会断）
    """
    text = (text or '').strip()
    if not text:
        return None

    # 纯数字 ID
    if re.fullmatch(r'\d{6,}', text):
        return text

    m = re.search(r'/(?:video|note|slides)/(\d+)', text)
    if m:
        return m.group(1)

    m = re.search(r'modal_id=(\d+)', text)
    if m:
        return m.group(1)

    return None


def resolve_short_url(text: str, timeout: int = 12):
    """跟短链重定向，返回最终 URL（取不到就返回原串）"""
    m = re.search(r'https?://v\.douyin\.com/[A-Za-z0-9_-]+/?', text or '')
    if not m:
        m = re.search(r'https?://\S+', text or '')
        if not m:
            return text
    url = m.group(0)
    try:
        r = requests.head(url, headers=_UA_HEADERS, allow_redirects=True, timeout=timeout)
        return r.url or url
    except Exception:
        # HEAD 偶发被拒，退化成 GET（不读 body）
        try:
            r = requests.get(url, headers=_UA_HEADERS, allow_redirects=True,
                             timeout=timeout, stream=True)
            final = r.url or url
            r.close()
            return final
        except Exception:
            return url


def _throttle():
    """全局节流：保证两次请求之间至少间隔 MIN_INTERVAL"""
    with _lock:
        now = time.time()
        wait = MIN_INTERVAL - (now - _last_request_at[0])
        if wait > 0:
            time.sleep(wait)
        _last_request_at[0] = time.time()


# ---------- 核心 ----------

def _fetch_router_data(vid: str, timeout: int = 20, prime_url: str = ''):
    """请求分享页并取出 _ROUTER_DATA 里的 item_list[0]

    返回 (item, err)：item 为 None 时 err 说明原因
    """
    sess = requests.Session()
    sess.headers.update(_UA_HEADERS)
    try:
        # ⚠️⚠️ 顺序是成败关键（实测撞出来的，别改）：
        #   1) 先用同一个 session HEAD 一次分享短链
        #      —— 这一步会在 iesdouyin.com 域下种 cookie，缺了它分享页不吐数据
        #   2) 再 GET 抖音首页，等 1 秒
        #   3) 最后请求分享页
        #
        # 我们一度以为「item_list 为空」是出口 IP 被限流，其实是漏了第 1 步：
        #   直接 get(首页) → get(分享页)                   → item_list 空
        #   head(短链) → get(首页) → get(分享页)           → item_list 有数据
        # 同一个 session 是必要的，用独立请求做 HEAD 不算数。
        if prime_url:
            try:
                sess.head(prime_url, allow_redirects=True, timeout=timeout)
            except Exception:
                try:
                    r0 = sess.get(prime_url, allow_redirects=True,
                                  timeout=timeout, stream=True)
                    r0.close()
                except Exception:
                    pass

        sess.get(HOME_URL, timeout=10)
        time.sleep(1)

        resp = sess.get(SHARE_URL.format(vid=vid), timeout=timeout)
        m = re.search(r'window\._ROUTER_DATA\s*=\s*({.*?});?\s*</script>',
                      resp.text, re.DOTALL)
        if not m:
            return None, f'分享页无 _ROUTER_DATA（HTML {len(resp.text)} 字节）'

        try:
            data = json.loads(m.group(1))
        except Exception as e:
            return None, f'_ROUTER_DATA 解析失败: {e}'

        page = (data.get('loaderData') or {}).get('video_(id)/page') or {}
        vres = page.get('videoInfoRes') or {}
        items = vres.get('item_list') or []
        if not items:
            # 这个空体既可能是限流，也可能是作品被删；调用方靠重试区分
            return None, '限流或作品不可用（item_list 为空）'
        return items[0], ''
    except Exception as e:
        return None, f'请求分享页失败: {e}'


def _pick(url_list, prefer_last=False, want_ext=None):
    """从 url_list 里挑一条可用地址

    ⚠️ 图片的 url_list 前几条常是 .webp，最后一条是 .jpeg —— 兼容性更好，
       所以图片取 prefer_last=True。
    """
    urls = [u for u in (url_list or []) if u]
    if not urls:
        return ''
    if want_ext:
        for u in reversed(urls):
            if want_ext in u:
                return u
    return urls[-1] if prefer_last else urls[0]


def _norm(u: str) -> str:
    """去水印兜底：/playwm/ 是带水印路径，/play/ 是无水印"""
    return (u or '').replace('/playwm/', '/play/')


# ⚠️ 实测结论：图文/动图作品的 video.play_addr 里塞的是**背景音乐 mp3**，
#    不是视频（形如 .../play/?video_id=https://.../obj/ies-music/xxx.mp3）。
#    老代码直接拿它当视频，用户下到 0 字节 mp4。这里用双重判定拦掉：
#      1) 地址里出现 ies-music / .mp3 / music 字样
#      2) aweme_type == 2（图文/动图，实测；视频是 4）
_MUSIC_HINTS = ('ies-music', '.mp3', 'music-east', 'music-hj')


def _is_music_url(u: str) -> bool:
    """这条"视频地址"其实是背景音乐吗"""
    low = (u or '').lower()
    return any(h in low for h in _MUSIC_HINTS)


# aweme_type 类型表（实测得出，不是官方文档）
#   2 = 图文 / 动图（实况照片）
#   4 = 普通视频
AWEME_TYPE_IMAGE = 2
AWEME_TYPE_VIDEO = 4


def _build_item(item: dict) -> dict:
    """把 SSR item 转成内部统一结构（与 opencli_resolve 的输出对齐）

    ⚠️ 类型判定不能只看「有没有 images」，要以 aweme_type 为准：
       图文作品的 images 字段偶发返回空（限流/精简），但 video.play_addr
       里是背景音乐——这时候如果 fallback 成「视频」，就会把一个音乐地址
       当视频直链吐给前端。所以这里判死的顺序是：
         1) 有 images              → images
         2) aweme_type == 2        → images（但没图，标 degraded）
         3) play_addr 是音乐地址   → images（同理）
         4) 否则                   → video
    """
    v = item.get('video') or {}
    a = item.get('author') or {}
    mu = item.get('music') or {}

    # 视频直链：play_addr 是播放地址（无水印），download_addr 可能带水印
    play_urls = [_norm(u) for u in ((v.get('play_addr') or {}).get('url_list') or []) if u]
    video_url = play_urls[0] if play_urls else ''
    raw_images = item.get('images') or []

    aweme_type = item.get('aweme_type') or 0
    # 是不是图文/动图：三个信号任一命中即算
    looks_image = bool(raw_images) or aweme_type == AWEME_TYPE_IMAGE or _is_music_url(video_url)
    # 确认这个"视频地址"确实是音乐（图文类的典型特征）
    video_is_music = _is_music_url(video_url)

    images_detail = []
    for im in raw_images:
        # 图片地址：取 jpeg（url_list 最后一条），webp 兼容性差
        img_url = _pick(im.get('url_list'), prefer_last=True, want_ext='.jpeg') \
            or _pick(im.get('url_list'), prefer_last=True)
        # 动图（实况照片）：live_photo_type==1，每张自带一个 1~3 秒小视频
        live_v = ((im.get('video') or {}).get('play_addr') or {}).get('url_list') or []
        is_live = (im.get('live_photo_type') == 1) and bool([x for x in live_v if x])
        dur = 0
        if is_live:
            dur = round((((im.get('video') or {}).get('duration') or 0)) / 1000.0, 2)
        images_detail.append({
            'url': img_url,
            'live': is_live,
            'videoUrl': _norm(live_v[0]) if is_live else '',
            'duration': dur,
        })

    images = [d['url'] for d in images_detail if d['url']]
    live_count = sum(1 for d in images_detail if d['live'])

    # 音乐直链
    music_url = _pick((mu.get('play_url') or {}).get('url_list'))

    stats = item.get('statistics') or {}
    dur_ms = v.get('duration') or 0

    # ⚠️ 类型以 aweme_type / 图片存在性为准，别用「videoUrl 非空」反推：
    #    图文类的 videoUrl 即使有值也是音乐地址，不构成「这是个视频」的证据
    itype = 'images' if looks_image else 'video'

    out = {
        'ok': True,
        'source': 'iesdouyin-ssr',
        'type': itype,
        'id': str(item.get('aweme_id') or item.get('awemeId') or ''),
        'title': item.get('desc') or '',
        'author': a.get('nickname') or '',
        'cover': _pick((v.get('cover') or {}).get('url_list'))
                 or _pick((v.get('origin_cover') or {}).get('url_list'))
                 or _pick((v.get('dynamic_cover') or {}).get('url_list')),
        # 图文类不吐 videoUrl —— 那个值是背景音乐，吐出去下游会当视频下
        'videoUrl': '' if itype == 'images' else video_url,
        'videoUrls': [] if itype == 'images' else play_urls,
        'musicUrl': music_url,
        'musicTitle': mu.get('title') or '',
        'duration': round(dur_ms / 1000.0, 1) if dur_ms > 1000 else dur_ms,
        'awemeType': aweme_type,
        'likes': stats.get('digg_count') or 0,
        'comments': stats.get('comment_count') or 0,
        'shares': stats.get('share_count') or 0,
        'collects': stats.get('collect_count') or 0,
    }
    if itype == 'images':
        # degraded：判定为图文，但一张图都没拿到（限流把 images 精简掉了）。
        # 这种情况宁可直接报错让上游重试，也不要吐半条数据出去。
        degraded = not images
        out.update({
            'images': images,
            'imageCount': len(images),
            'isLivePhoto': live_count > 0,
            'liveCount': live_count,
            'imagesDetail': images_detail,
            'degraded': degraded,
        })
        if degraded:
            out['error'] = ('图文/动图作品但未取到图片列表'
                            + ('（视频字段实为背景音乐，已忽略）' if video_is_music else '')
                            + '，建议重试')
    return out


def resolve(target: str, timeout: int = 20) -> dict:
    """解析入口：分享链接/完整链接/作品 ID → 统一结构

    ⚠️ 会做节流 + 缓存 + 重试，批量调用安全。
    """
    text = (target or '').strip()
    vid = extract_share_id(text)

    # 短链形态：原串就是那条分享短链，要留给 _fetch_router_data 做 priming
    # （⚠️ priming 必须用短链，用完整链接 head 到的是 www.douyin.com，种不到 cookie）
    prime = ''
    if not vid:
        final = resolve_short_url(text)
        vid = extract_share_id(final)
        prime = text          # 原始短链
    elif 'v.douyin.com' in text:
        prime = text

    if not vid:
        raise RuntimeError(f'无法提取作品ID: {text[:60]}')

    # 缓存命中
    now = time.time()
    hit = _cache.get(vid)
    if hit and hit[0] > now:
        return hit[1]

    last_err = ''
    for attempt in range(1, RETRY_TIMES + 1):
        _throttle()
        item, err = _fetch_router_data(vid, timeout=timeout, prime_url=prime)
        if item:
            out = _build_item(item)
            # 图文类拿到空图片列表 = 数据被精简，当成失败重试，别吐半条出去
            if out.get('degraded'):
                last_err = out.get('error') or '图文数据不完整'
                if attempt < RETRY_TIMES:
                    time.sleep(RETRY_BACKOFF * attempt)
                continue
            _cache[vid] = (time.time() + CACHE_TTL, out)
            if len(_cache) > 500:            # 简单的容量控制
                for k in list(_cache)[:100]:
                    _cache.pop(k, None)
            return out
        last_err = err
        if attempt < RETRY_TIMES:
            time.sleep(RETRY_BACKOFF * attempt)

    raise RuntimeError(last_err or '解析失败')


if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print('用法: python3 ssr_resolve.py <链接或ID>')
        sys.exit(1)
    try:
        print(json.dumps(resolve(sys.argv[1]), ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
        sys.exit(1)
