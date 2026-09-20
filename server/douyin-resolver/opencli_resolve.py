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


def resolve_by_opencli(target: str, session: str = DEFAULT_SESSION, retries: int = 2) -> dict:
    """解析（带重试）

    抖音页面偶发不吐播放器（渲染慢、风控抽风），单次失败不代表链接有问题，
    所以失败后重新打开页面再试，实测重试一次基本都能成。
    """
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            return _resolve_once(target, session)
        except Exception as e:
            last_err = e
            if attempt < retries:
                # 重试前重开一次页面，别在同一个坏状态上反复读
                try:
                    _run_opencli(['browser', session, 'eval', 'location.reload()'], timeout=30)
                except Exception:
                    pass
                import time as _t
                _t.sleep(3)
    raise last_err if last_err else RuntimeError('解析失败')


def _parse_wan(s: str) -> int:
    """把「7.9万」「6027」这类计数文本转成整数"""
    s = (s or '').strip().replace(',', '')
    if not s:
        return 0
    try:
        if s.endswith('万'):
            return int(float(s[:-1]) * 10000)
        if s.endswith('亿'):
            return int(float(s[:-1]) * 100000000)
        return int(float(s))
    except Exception:
        return 0


def _parse_stats(info: str) -> dict:
    """从 detail-video-info 文本里抠出互动数据

    文本形如：
      文案...#话题
      7.9万      <- 点赞
      6027       <- 评论
      9476       <- 收藏
      1.1万      <- 分享
      举报
    前 4 行数字即为 赞/评/藏/转（顺序与页面一致）。
    """
    out = {'likes': 0, 'comments': 0, 'shares': 0, 'collects': 0}
    lines = [l.strip() for l in (info or '').splitlines() if l.strip()]
    nums = []
    for l in lines:
        if re.fullmatch(r'[\d.,]+[万亿]?', l):
            nums.append(l)
        if len(nums) >= 4:
            break
    keys = ['likes', 'comments', 'collects', 'shares']
    for k, v in zip(keys, nums):
        out[k] = _parse_wan(v)
    return out


def _fetch_detail_in_page(session: str, vid: str) -> dict:
    """在浏览器页面上下文里调 aweme/detail 接口，拿权威元数据

    为什么必须走这条路：
      页面上那些 img/背景图不区分「本条作品」和「右侧推荐」，取到的常常是
      related 视频的缩略图（URL 里带 PackSourceEnum_WEBPC_RELATED_AWEME）。
      实测拿错过封面 —— 取到的是推荐位另一条视频的图。
      而 detail 接口返回的 cover 带 PackSourceEnum_AWEME_DETAIL，
      是这条作品自己的封面，唯一可靠来源。

      图文笔记同理：DOM 里的轮播图是懒加载的，只能看到当前渲染的那几张，
      所以永远只拿到第一张。接口的 images 数组才是完整列表。

    注意：接口要在页面上下文里 fetch（带登录态 + 页面自带的签名逻辑），
         从容器/命令行裸调会因签名失效返回空 body。
    """
    js = (
        "(async()=>{try{"
        "const u='https://www.douyin.com/aweme/v1/web/aweme/detail/"
        "?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=" + vid +
        "&request_source=600&origin_type=video_page&pc_client_type=1"
        "&version_code=170400&version_name=17.4.0&cookie_enabled=true"
        "&platform=PC&downlink=10&effective_type=4g&round_trip_time=50';"
        "const r=await fetch(u,{credentials:'include'});"
        "const j=await r.json();"
        "const a=j.aweme_detail||{};"
        "if(!a.aweme_id)return JSON.stringify({ok:false,status:r.status});"
        "const v=a.video||{};"
        "const pick=o=>{o=o||{};const l=o.url_list||[];return l[0]||'';};"
        # 图片列表：优先取最大尺寸的那张（url_list 最后一个通常分辨率最高）
        "const imgs=(a.images||[]).map(im=>{"
        "  const l=(im.url_list||[]).filter(Boolean);"
        "  return l[l.length-1]||'';"
        "}).filter(Boolean);"
        "return JSON.stringify({ok:true,"
        "aweme_type:a.aweme_type||0,"
        "desc:a.desc||'',"
        "author:(a.author||{}).nickname||'',"
        "cover:pick(v.cover)||pick(v.origin_cover)||'',"
        "duration:(v.duration||0)/1000,"
        "images:imgs,"
        # 背景音乐（黑屏/静态图 + 音乐的作品靠这条）
        # 注意：music 的直链在 play_url.url_list，不是 music.url_list
        "music:((m=>{const l=((m.play_url||{}).url_list||[]).filter(Boolean);"
        "return l[0]||'';})(a.music||{})),"
        "music_title:(a.music||{}).title||'',"
        "likes:(a.statistics||{}).digg_count||0,"
        "comments:(a.statistics||{}).comment_count||0,"
        "shares:(a.statistics||{}).share_count||0,"
        "collects:(a.statistics||{}).collect_count||0});"
        "}catch(e){return JSON.stringify({ok:false,err:String(e)});}})()"
    )
    out = _run_opencli(['browser', session, 'eval', js], timeout=60)
    d = _pick_source_json(out)
    return d if isinstance(d, dict) else {}


def _resolve_once(target: str, session: str = DEFAULT_SESSION) -> dict:
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

    import time

    # 1) 导航到页面
    #
    # ⚠️ 不要用 `browser open` —— 它会等页面完全静止（图片/视频/埋点全停），
    #    实测抖音详情页要 57 秒才返回，而真正的数据早就有了。
    #    改成发一条导航指令（0.5 秒返回），然后自己轮询读取，13 秒就能出结果。
    _run_opencli(['browser', session, 'eval',
                  f'location.href={json.dumps(page_url)}; "nav"'], timeout=30)
    time.sleep(2)

    # 2) 等页面把播放器/图片渲染出来
    #    视频看 <video><source>，图文看轮播图；哪边先出就按哪边处理。
    deadline = time.time() + 40
    sources = []
    meta = {}
    best_meta = {}
    slide_images = []
    is_slides = False

    while time.time() < deadline:
        time.sleep(1.5)
        raw = _run_opencli([
            'browser', session, 'eval',
            # 元数据提取（选择器均在真实页面验证过）：
            #   author —— [data-e2e="user-info"] 里指向 /user/ 的链接文本
            #             （旧的 video-author-name 已失效）
            #   slides —— 图文轮播的图，尽量全取（不只第一张）
            "JSON.stringify({src:[...document.querySelectorAll('video source')].map(s=>s.src),"
            "cur:[...document.querySelectorAll('video')].map(v=>v.currentSrc),"
            "title:document.title,"
            "author:(()=>{const el=document.querySelector('[data-e2e=\"user-info\"]');"
            "if(!el)return '';"
            "const a=[...el.querySelectorAll('a[href*=\"/user/\"]')].find(x=>x.innerText.trim());"
            "if(a)return a.innerText.trim();"
            "const t=el.innerText.trim();"
            "const mm=t.match(/^(.+?)(粉丝|获赞|关注)/);"
            "return mm?mm[1].trim():'';})(),"
            "dur:(document.querySelector('video')||{}).duration||0,"
            # 图文：轮播容器里所有图（含懒加载的 data-src）
            "slides:[...document.querySelectorAll("
            "'[data-e2e=\"slides-item\"] img, [class*=slides] img, "
            "[class*=swiper-slide] img, [class*=image-carousel] img')]"
            ".map(i=>i.currentSrc||i.src||i.getAttribute('data-src')||'')"
            ".filter(s=>s&&s.startsWith('http')),"
            "imgCount:document.querySelectorAll('[class*=swiper-slide]').length,"
            "info:(()=>{const el=document.querySelector('[data-e2e=\"detail-video-info\"]');"
            "return el?el.innerText.trim():'';})()})"
        ], timeout=30)
        data = _pick_source_json(raw)
        if not isinstance(data, dict):
            continue

        meta = data
        if data.get('author') or data.get('dur'):
            best_meta = data
        srcs = [s for s in (data.get('src') or []) if s and s.startswith('http')]
        if srcs:
            sources = srcs
        imgs = [s for s in (data.get('slides') or []) if s and s.startswith('http')]

        # 图文页没有播放器；只要探到图就按图文处理，别硬等播放器
        if imgs and not srcs:
            slide_images = imgs
            is_slides = True
            # 轮播可能还没全部渲染，等多一拍把后面的图收全
            if len(imgs) >= (data.get('imgCount') or 0) or len(imgs) >= 18:
                break
            time.sleep(1.5)
            continue

        # 视频：拿到直链就够，元数据统一由 detail 接口补
        if srcs:
            break

    # 合并元数据：优先用信息更全的那份
    merged = dict(meta)
    for k, v in (best_meta or {}).items():
        if v and not merged.get(k):
            merged[k] = v
    meta = merged

    # ---------- 权威元数据：detail 接口 ----------
    # DOM 上分不清「本作品」和「右侧推荐」，封面也拿错过；
    # 图文的轮播图是懒加载的，DOM 里只能看到第一张。
    # 接口返回的才是完整、准确的数据。
    detail = _fetch_detail_in_page(session, vid)
    api_images = []
    if detail.get('ok'):
        if detail.get('author'):
            meta['author'] = detail['author']
        if detail.get('cover'):
            meta['cover'] = detail['cover']
        if detail.get('desc'):
            meta['title'] = detail['desc']
        if detail.get('duration'):
            meta['dur'] = detail['duration']
        api_images = detail.get('images') or []
        meta['api_stats'] = {
            'likes': detail.get('likes') or 0,
            'comments': detail.get('comments') or 0,
            'shares': detail.get('shares') or 0,
            'collects': detail.get('collects') or 0,
        }
    else:
        log_note = detail.get('status') or detail.get('err') or '未知原因'
        print(f'[opencli] detail 接口未取到元数据（{log_note}），沿用页面数据', file=sys.stderr)

    # ---------- 图文作品 ----------
    # 判定优先级：接口给了 images 就用它（完整列表）；否则退回 DOM 抓到的图。
    if api_images or (is_slides and slide_images):
        imgs = api_images or slide_images
        # 去重（同一张图常有多种尺寸后缀）
        seen = set()
        uniq = []
        for u in imgs:
            key = re.sub(r'~\w+\.(jpe?g|png|webp|heic)', '', u)
            if key in seen:
                continue
            seen.add(key)
            uniq.append(u)
        if not uniq:
            raise RuntimeError('图文作品未取到图片')
        st = meta.get('api_stats') or _parse_stats(meta.get('info') or '')
        title = re.sub(r'\s*-\s*抖音\s*$', '', (meta.get('title') or '').strip())
        return {
            'id': vid,
            'type': 'images',
            'title': title,
            'author': (meta.get('author') or '').strip(),
            'cover': (meta.get('cover') or '').strip() or uniq[0],
            'musicUrl': '',
            'duration': 0,
            'likes': st['likes'],
            'comments': st['comments'],
            'shares': st['shares'],
            'collects': st['collects'],
            'images': uniq,
            'imageCount': len(uniq),
            'source': 'opencli',
        }

    if not sources:
        # 退一步：看看 currentSrc 里有没有非 blob 的可用地址
        for c in (meta.get('cur') or []):
            if c and c.startswith('http') and 'douyinvod' in c:
                sources = [c]
                break

    if not sources:
        # 走到这说明：接口没给图片、页面也没抓到图片，但也没有播放地址。
        # 常见于「单图当视频发」或页面没渲染出来。把接口信息带出去，便于排查。
        atype = detail.get('aweme_type')
        raise RuntimeError(
            f'未取到播放地址或图片（aweme_type={atype}，'
            f'Chrome 未登录抖音或页面未渲染出播放器）'
        )


    # 优先 douyinvod（无水印 CDN）
    picked = next((s for s in sources if 'douyinvod' in s), sources[0])

    title = re.sub(r'\s*-\s*抖音\s*$', '', (meta.get('title') or '').strip())
    dur = meta.get('dur') or 0
    try:
        dur_ms = int(float(dur) * 1000)
    except Exception:
        dur_ms = 0

    st = meta.get('api_stats') or _parse_stats(meta.get('info') or '')

    return {
        'id': vid,
        'type': 'video',
        'title': title,
        'author': (meta.get('author') or '').strip(),
        'cover': (meta.get('cover') or '').strip(),
        # 背景音乐直链：有些作品本体是黑屏/静态图 + 音乐，这条才有用
        'musicUrl': (detail.get('music') or '').strip(),
        'musicTitle': (detail.get('music_title') or '').strip(),
        'duration': dur_ms,
        'likes': st['likes'],
        'comments': st['comments'],
        'shares': st['shares'],
        'collects': st['collects'],
        'videoUrl': picked,
        'videoUrls': sources,
        'awemeType': detail.get('aweme_type'),
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
