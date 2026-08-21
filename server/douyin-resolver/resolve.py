#!/usr/bin/env python3
"""
抖音无水印视频解析器 — 基于 f2 库 + Chrome 真实 cookie
供 wxtools (Node) 服务调用。用法:
    python3 douyin_resolve.py <分享链接或视频ID>
输出: JSON (stdout)
"""
import sys, json, asyncio, re, traceback, urllib.parse

def get_cookie():
    """从 Chrome 读取 douyin cookie 字符串"""
    import browser_cookie3
    cj = browser_cookie3.chrome(domain_name='.douyin.com')
    names = ['sessionid','sessionid_ss','passport_csrf_token','passport_csrf_token_default',
             'sid_tt','uid_tt','ttwid','odin_tt','passport_auth_status','passport_auth_status_ss',
             'n_mh','sid_guard','trusted_device_id','iid','d_ticket','s_v_web_id']
    pairs = [f'{c.name}={c.value}' for c in cj if c.name in names]
    if not pairs:
        raise RuntimeError('未从Chrome获取到douyin cookie，请先登录抖音并关闭浏览器')
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

async def resolve(url: str):
    from f2.apps.douyin.crawler import DouyinCrawler
    from f2.apps.douyin.model import PostDetail
    from f2.apps.douyin.filter import PostDetailFilter

    cookie = get_cookie()
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

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': '用法: douyin_resolve.py <链接或ID>'}, ensure_ascii=False))
        return
    url = sys.argv[1].strip()
    try:
        result = asyncio.run(resolve(url))
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
