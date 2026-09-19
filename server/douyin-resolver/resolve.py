#!/usr/bin/env python3
"""
抖音无水印视频解析器 —— 直连抖音 web 详情接口（不依赖 f2）

背景：f2 0.0.1.7 调 aweme/detail 会被抖音风控挡在 403，
但直接用同样的 cookie + 带上 web 端签名相关头，官方接口返回 200。
本实现走官方接口，稳定拿无水印直链。

用法:
    python3 resolve.py [--cookie=<cookies>] <分享链接或视频ID>
    python3 resolve.py --check-cookie [--cookie=<cookies>]
输出: JSON (stdout)
"""
import sys, json, asyncio, re, traceback
import urllib.parse

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')


def get_cookie(user_cookie=''):
    """获取抖音 cookie，优先级：用户传入 --cookie > 环境变量 DOUYIN_COOKIE > 本机 Chrome

    macOS / 容器内取不到 Chrome cookie（keychain / 无 DBUS），须显式提供。
    """
    user_cookie = (user_cookie or '').strip()
    if user_cookie:
        return user_cookie
    import os
    env_cookie = os.environ.get('DOUYIN_COOKIE', '').strip()
    if env_cookie:
        return env_cookie
    if sys.platform == 'darwin':
        raise RuntimeError('未提供抖音 cookie。请在解析时填写你的抖音 cookie')
    try:
        import browser_cookie3
    except ImportError:
        raise RuntimeError('未提供抖音 cookie。请在页面填写你的抖音登录 cookie')
    try:
        cj = browser_cookie3.chrome(domain_name='.douyin.com')
    except Exception as e:
        # 容器内没有 Chrome / DBUS，读不到 cookie 是预期内的 —— 给一句人话，
        # 不要让 DBUS_SESSION_BUS_ADDRESS 这种栈信息冒到用户面前。
        raise RuntimeError('未提供抖音 cookie（容器环境无法自动读取浏览器 cookie）。'
                           '请在页面设置你的抖音登录 cookie')
    names = ['sessionid', 'sessionid_ss', 'passport_csrf_token', 'passport_csrf_token_default',
             'sid_tt', 'uid_tt', 'ttwid', 'odin_tt', 'passport_auth_status', 'passport_auth_status_ss',
             'n_mh', 'sid_guard', 'trusted_device_id', 'iid', 'd_ticket', 's_v_web_id']
    pairs = [f'{c.name}={c.value}' for c in cj if c.name in names]
    if not pairs:
        raise RuntimeError('未获取到douyin cookie。请通过 --cookie 或 DOUYIN_COOKIE 提供你的抖音登录 cookie')
    return '; '.join(pairs)


def extract_url(text: str) -> str:
    """从分享文本/链接提取抖音URL"""
    m = re.search(r'https?://v\.douyin\.com/[A-Za-z0-9_-]+/?', text)
    if m:
        return m.group(0)
    m = re.search(r'https?://www\.douyin\.com/video/(\d+)', text)
    if m:
        return 'https://www.douyin.com/video/' + m.group(1)
    m = re.search(r'https?://www\.douyin\.com/note/(\d+)', text)
    if m:
        return 'https://www.douyin.com/note/' + m.group(1)
    m = re.search(r'https?://www\.iesdouyin\.com/share/video/(\d+)', text)
    if m:
        return 'https://www.douyin.com/video/' + m.group(1)
    m = re.search(r'https?://www\.iesdouyin\.com/share/slides/(\d+)', text)
    if m:
        return 'https://www.douyin.com/note/' + m.group(1)
    if text.strip().startswith('http'):
        return text.strip()
    if text.strip().isdigit():
        return 'https://www.douyin.com/video/' + text.strip()
    raise ValueError('无法提取抖音链接')


def extract_video_id(url: str):
    """从URL提取视频/图文ID（短链需先解析重定向）"""
    m = re.search(r'/(?:video|note)/(\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'/share/slides/(\d+)', url)
    if m:
        return m.group(1)
    m = re.search(r'(?:modal_id|item_ids|aweme_id)=(\d+)', url)
    if m:
        return m.group(1)
    return None


def _headers(cookie: str) -> dict:
    return {
        'User-Agent': UA,
        'Referer': 'https://www.douyin.com/',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cookie': cookie,
    }


async def _resolve_redirect(short_url: str, headers: dict) -> str:
    """解析短链接重定向"""
    import httpx
    h = {k: v for k, v in headers.items() if k != 'Cookie'}
    async with httpx.AsyncClient(headers=h, follow_redirects=True, timeout=15) as client:
        resp = await client.get(short_url)
    return str(resp.url)


async def fetch_detail(aweme_id: str, cookie: str) -> dict:
    """直连官方 web 详情接口拿 aweme_detail"""
    import httpx
    params = {
        'aweme_id': aweme_id,
        'device_platform': 'webapp',
        'aid': '6383',
        'channel': 'channel_pc_web',
        'pc_client_type': '1',
        'version_code': '170400',
        'version_name': '17.4.0',
        'cookie_enabled': 'true',
        'screen_width': '1920',
        'screen_height': '1080',
        'browser_language': 'zh-CN',
        'browser_platform': 'Win32',
        'browser_name': 'Chrome',
        'browser_version': '120.0.0.0',
        'browser_online': 'true',
        'engine_name': 'Blink',
        'engine_version': '120.0.0.0',
        'os_name': 'Windows',
        'os_version': '10',
        'cpu_core_num': '8',
        'device_memory': '8',
        'platform': 'PC',
        'downlink': '10',
        'effective_type': '4g',
        'round_trip_time': '50',
    }
    url = 'https://www.douyin.com/aweme/v1/web/aweme/detail/'
    async with httpx.AsyncClient(headers=_headers(cookie), timeout=30, follow_redirects=True) as client:
        resp = await client.get(url, params=params)
    if resp.status_code != 200:
        raise RuntimeError(f'HTTP状态码错误： Status Code: {resp.status_code}')
    try:
        data = resp.json()
    except Exception:
        raise RuntimeError('接口返回非 JSON（可能被风控拦截）')
    detail = data.get('aweme_detail')
    if not detail:
        fw = data.get('filter_detail') or {}
        reason = fw.get('filter_reason') or data.get('status_msg') or '接口未返回作品详情（可能被风控或作品不可见）'
        raise RuntimeError(str(reason))
    return detail


async def resolve(url: str, cookie: str = ''):
    cookie = get_cookie(cookie)

    short = extract_url(url)
    if 'v.douyin.com' in short:
        final_url = await _resolve_redirect(short, _headers(cookie))
    else:
        final_url = short
    aweme_id = extract_video_id(final_url)
    if not aweme_id:
        raise RuntimeError(f'无法从链接提取视频/图文ID: {final_url}')

    detail = await fetch_detail(aweme_id, cookie)

    aweme_type = detail.get('aweme_type', 0)
    is_note = aweme_type == 68

    v = detail.get('video') or {}
    # play_addr 为无水印直链（download_addr 带 watermark=1）
    vurls = [u for u in ((v.get('play_addr') or {}).get('url_list') or []) if u]
    vurl = vurls[0] if vurls else ''

    cover = ((v.get('cover') or {}).get('url_list') or [''])
    cover = cover[0] if cover else ''
    # 有些作品封面在 origin_cover
    if not cover:
        oc = ((v.get('origin_cover') or {}).get('url_list') or [''])
        cover = oc[0] if oc else ''

    images = []
    if is_note:
        for img in (detail.get('images') or []):
            urls = (img.get('url_list') or [])
            if urls:
                images.append(urls[-1] if isinstance(urls, list) else str(urls))

    stats = detail.get('statistics') or {}
    music = ((detail.get('music') or {}).get('play_url') or {}).get('uri', '')

    base = {
        'id': aweme_id,
        'type': 'images' if is_note else 'video',
        'title': detail.get('desc', ''),
        'author': (detail.get('author') or {}).get('nickname', ''),
        'cover': cover,
        'musicUrl': music,
        'duration': v.get('duration') or detail.get('duration') or 0,
        'likes': stats.get('digg_count', 0),
        'comments': stats.get('comment_count', 0),
        'shares': stats.get('share_count', 0),
    }
    if is_note:
        base['images'] = images
        base['imageCount'] = len(images)
        base['videoUrl'] = ''
        base['videoUrls'] = []
    else:
        base['videoUrl'] = vurl
        base['videoUrls'] = vurls
    return base


async def check_cookie(cookie: str):
    """验证抖音 cookie 是否有效，并返回用户真实昵称"""
    cookie = (cookie or '').strip()
    if not cookie:
        return {'valid': False, 'isLogin': False, 'message': '未提供 Cookie，请先填写', 'hasCookie': False}
    import httpx
    headers = {
        'User-Agent': ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                       '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'),
        'Referer': 'https://www.douyin.com/',
        'Cookie': cookie,
    }
    async with httpx.AsyncClient(headers=headers, timeout=15, follow_redirects=True) as client:
        try:
            resp = await client.get('https://www.douyin.com/passport/account/info/v2/?device_platform=webapp&aid=6383')
            data = (resp.json().get('data') or {}) if resp.status_code == 200 else {}
            sec_uid = str(data.get('sec_user_id') or '')
            user_id = str(data.get('user_id') or data.get('user_id_str') or '')
            if not sec_uid:
                return {'valid': False, 'isLogin': False, 'message': 'Cookie 无效或未登录', 'hasCookie': True}
            nickname = ''
            try:
                profile = await client.get(
                    f'https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id={sec_uid}'
                    '&device_platform=webapp&aid=6383')
                u = (profile.json().get('user') or {})
                if isinstance(u, dict) and 'user' in u:
                    u = u['user']
                nickname = u.get('nickname') or ''
            except Exception:
                nickname = ''
            return {'valid': True, 'isLogin': True, 'message': 'Cookie 有效', 'hasCookie': True,
                    'userName': nickname, 'userId': user_id, 'secUid': sec_uid}
        except Exception as e:
            return {'valid': False, 'isLogin': False, 'message': f'Cookie 检测失败: {e}', 'hasCookie': True}


def main():
    args = sys.argv[1:]
    cookie = ''
    check_only = False
    positional = []
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith('--cookie='):
            cookie = a.split('=', 1)[1]
        elif a == '--cookie':
            i += 1
            if i < len(args):
                cookie = args[i]
        elif a == '--check-cookie':
            check_only = True
        else:
            positional.append(a)
        i += 1

    if check_only:
        try:
            result = asyncio.run(check_cookie(cookie))
            print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
        return

    if not positional:
        print(json.dumps({'ok': False, 'error': '用法: resolve.py [--cookie=<cookies>] <链接或ID> 或 resolve.py --check-cookie [--cookie=<cookies>]'},
                         ensure_ascii=False))
        return
    url = positional[0].strip()
    try:
        result = asyncio.run(resolve(url, cookie))
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
