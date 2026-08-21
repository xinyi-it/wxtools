#!/usr/bin/env python3
"""
抖音无水印视频解析器 — 基于 f2 库 + Chrome 真实 cookie
供 wxtools (Node) 服务调用。用法:
    python3 douyin_resolve.py <分享链接或视频ID>
输出: JSON (stdout)
"""
import sys, json, asyncio, re, traceback, urllib.parse

def get_cookie(user_cookie=''):
    """获取抖音 cookie，优先级：用户传入 --cookie > 环境变量 DOUYIN_COOKIE > 本机 Chrome（仅 Linux/Windows）

    macOS 注意：Chrome cookie 用 keychain 加密，browser-cookie3 无法读取，
    因此 macOS 必须通过 --cookie 或环境变量 DOUYIN_COOKIE 提供 cookie。
    """
    # 1. 用户传入的 cookie（最优先，各用户用自己的，避免服务级共享被封号）
    user_cookie = (user_cookie or '').strip()
    if user_cookie:
        return user_cookie
    # 2. 环境变量
    import os
    env_cookie = os.environ.get('DOUYIN_COOKIE', '').strip()
    if env_cookie:
        return env_cookie
    # 3. macOS 无法解密 Chrome cookie（keychain 加密机制不同），直接跳过
    if sys.platform == 'darwin':
        raise RuntimeError('未提供抖音 cookie。请在解析时填写你的抖音 cookie（浏览器登录抖音后，从 DevTools/Application/Cookies 复制整串 cookie）')
    try:
        import browser_cookie3
    except ImportError:
        raise RuntimeError('未提供 DOUYIN_COOKIE 或 --cookie，且未安装 browser-cookie3。请提供你的抖音登录 cookie')
    try:
        cj = browser_cookie3.chrome(domain_name='.douyin.com')
    except Exception as e:
        raise RuntimeError(f'读取 Chrome cookie 失败（{e}）。请改用 --cookie 提供你的抖音登录 cookie')
    names = ['sessionid','sessionid_ss','passport_csrf_token','passport_csrf_token_default',
             'sid_tt','uid_tt','ttwid','odin_tt','passport_auth_status','passport_auth_status_ss',
             'n_mh','sid_guard','trusted_device_id','iid','d_ticket','s_v_web_id']
    pairs = [f'{c.name}={c.value}' for c in cj if c.name in names]
    if not pairs:
        raise RuntimeError('未获取到douyin cookie。请通过 --cookie 或 DOUYIN_COOKIE 提供你的抖音登录 cookie')
    return '; '.join(pairs)

def extract_url(text: str) -> str:
    """从分享文本/链接提取抖音URL"""
    m = re.search(r'https?://v\.douyin\.com/[A-Za-z0-9_-]+/?', text)
    if m: return m.group(0)
    m = re.search(r'https?://www\.douyin\.com/video/(\d+)', text)
    if m: return 'https://www.douyin.com/video/' + m.group(1)
    m = re.search(r'https?://www\.iesdouyin\.com/share/video/(\d+)', text)
    if m: return 'https://www.douyin.com/video/' + m.group(1)
    if text.strip().startswith('http'): return text.strip()
    # 纯ID
    if text.strip().isdigit(): return 'https://www.douyin.com/video/' + text.strip()
    raise ValueError('无法提取抖音链接')

def extract_video_id(url: str):
    """从URL提取视频ID（短链需先解析重定向）"""
    m = re.search(r'/video/(\d+)', url)
    if m: return m.group(1)
    m = re.search(r'(?:modal_id|item_ids|aweme_id)=(\d+)', url)
    if m: return m.group(1)
    return None

async def resolve(url: str, cookie: str = ''):
    from f2.apps.douyin.crawler import DouyinCrawler
    from f2.apps.douyin.model import PostDetail
    from f2.apps.douyin.filter import PostDetailFilter

    cookie = get_cookie(cookie)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.douyin.com/',
    }
    kwargs = {'headers': headers, 'cookie': cookie, 'proxies': {},
              'timeout': 30, 'max_retries': 3, 'max_connections': 1, 'max_tasks': 1}

    async with DouyinCrawler(kwargs) as crawler:
        # 1. 短链接解析出完整URL
        short = extract_url(url)
        if 'v.douyin.com' in short:
            final_url = await _resolve_redirect(short, headers)
        else:
            final_url = short
        aweme_id = extract_video_id(final_url)
        if not aweme_id:
            raise RuntimeError(f'无法从链接提取视频ID: {final_url}')
        # 2. 获取详情
        params = PostDetail(aweme_id=aweme_id)
        data = await crawler.fetch_post_detail(params)
        detail = PostDetailFilter(data)
        # video_play_addr 是列表(多清晰度)，取第一个为主，保留全部
        vurls = detail.video_play_addr or []
        vurl = vurls[0] if vurls else ''
        return {
            'id': aweme_id,
            'type': 'video',
            'title': detail.desc,
            'author': detail.nickname,
            'cover': detail.cover,
            'videoUrl': vurl,
            'videoUrls': vurls,
            'musicUrl': detail.music_play_url,
            'duration': detail.duration,
            'likes': detail.digg_count,
            'comments': detail.comment_count,
            'shares': detail.share_count,
        }
    raise RuntimeError('解析失败：未获取到数据')

async def _resolve_redirect(short_url: str, headers: dict) -> str:
    """解析短链接重定向"""
    import httpx
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=15) as client:
        resp = await client.get(short_url)
    return str(resp.url)

async def check_cookie(cookie: str):
    """验证抖音 cookie 是否有效（请求推荐流接口，能拿到 aweme_list 即有效）"""
    cookie = (cookie or '').strip()
    if not cookie:
        return {'valid': False, 'isLogin': False, 'message': '未提供 Cookie，请先填写'}
    import httpx
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'Referer': 'https://www.douyin.com/',
        'Cookie': cookie,
    }
    # 抖音推荐流接口：有效 cookie 返回 aweme_list（含视频），无效 cookie 返回非 JSON 或空
    async with httpx.AsyncClient(headers=headers, timeout=15, follow_redirects=True) as client:
        try:
            resp = await client.get('https://www.douyin.com/aweme/v1/web/tab/feed/?device_platform=webapp&aid=6383&channel=channel_pc_web')
            try:
                items = resp.json().get('aweme_list') or []
            except Exception:
                items = []
            if items:
                return {'valid': True, 'isLogin': True, 'message': 'Cookie 有效'}
            return {'valid': False, 'isLogin': False, 'message': 'Cookie 无效或未登录'}
        except Exception as e:
            return {'valid': False, 'isLogin': False, 'message': f'Cookie 检测失败: {e}'}

def main():
    args = sys.argv[1:]
    cookie = ''
    check_only = False
    # 解析 --cookie=<value> 和 --check-cookie
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
        print(json.dumps({'ok': False, 'error': '用法: resolve.py [--cookie=<cookies>] <链接或ID> 或 resolve.py --check-cookie [--cookie=<cookies>]'}, ensure_ascii=False))
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
