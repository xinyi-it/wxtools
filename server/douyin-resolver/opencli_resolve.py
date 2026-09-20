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
import sys, os, json, re, asyncio, subprocess, shutil, traceback, time

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

OPENCLI = shutil.which('opencli') or 'opencli'
DEFAULT_SESSION = os.environ.get('OPENCLI_SESSION', 'dy')

# 关标签后等浏览器释放资源的时间（秒）。见 _tab_close 注释：
# 关标签是异步的，不等会给下一条解析埋 10 秒以上的尾部波动。
TAB_RELEASE_WAIT = float(os.environ.get('TAB_RELEASE_WAIT', '0.3'))

# 单次探测的超时（秒）。⚠️ 这个必须**短** —— 见 _probe_once/_resolve_in_tab 注释：
# opencli 通道在页面加载时会被反复堵住，长超时会把随后的空闲窗口一起吃掉，
# 越等越慢。短超时 + 立刻重抢反而稳定命中（实测 3/3，1.7~2.6 秒）。
PROBE_TIMEOUT = float(os.environ.get('PROBE_TIMEOUT', '3.5'))

# 探测失败后到下次重试之间的间隔（秒）。同样要**极短** ——
# 通道堵塞是瞬时的，窗口随时会开，等太久窗口就过去了。
PROBE_RETRY_GAP = float(os.environ.get('PROBE_RETRY_GAP', '0.15'))


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


# ---------- 标签页管理 ----------
#
# ⭐ 每条解析用独立标签页，这是提速的关键（实测最慢那条 83s → 5.7s）。
#
# 为什么复用同一个标签页会越来越慢：
#   抖音是重型 SPA，同一标签连续导航时，上一页的资源/Worker/长连接不会立刻
#   释放，逐渐把 opencli 的 eval 通道堵住。实测连续三条：
#     复用标签: 5.0s → 13.9s → 83.5s    （累积恶化 17 倍）
#     独立标签: 5.3s → 5.7s  → 3.9s     （稳定，不恶化）
#   新标签拿到的是干净渲染上下文，用完立刻关掉彻底回收。
#   另外新标签本身就是空白页，连「先重置 about:blank」都省了。
#
# ⚠️ 只加标签隔离，不动轮询时序 —— 之前一并改了 settle 检测和超时，
#    结果图文被误判成 video、耗时反弹到 171s。一次只改一处，才看得清因果。

def _tab_new(session: str, url: str = ''):
    """开一个新标签页，返回 targetId（失败返回 None）

    ⭐ 带 url 开标签是提速关键（实测 A/B 对比，差了 30 倍）：
      A) `tab new <抖音详情页URL>`     → 第2轮探测命中，3.9~4.4 秒
      B) `tab new` 空白 + eval 发导航  → 8 轮探测 124~163 秒都拿不到
    为什么差这么多：B 方案的导航是一条 eval 指令，页面忙时这条通道本身会被
    堵住（实测过 45 秒），而且指令是异步的 —— 返回了不代表页面加载完了，
    紧接着的探测正好撞在资源加载高峰上。A 方案交给浏览器自己带着 URL 开
    标签，加载与探测并行，省掉一次 eval 往返，探测从干净窗口开始。

    ⚠️ tab new 不带 url 时的输出 key 是 "targetId"，带 url 时是 "page"，
       两种都要认（实测确认）。
    """
    args = ['browser', session, 'tab', 'new']
    if url:
        args.append(url)
    out = _run_opencli(args, timeout=40)
    for key in ('targetId', 'page', 'id', 'tabId'):
        m = re.search(r'"%s"\s*:\s*"([^"]+)"' % key, out)
        if m:
            return m.group(1)
    m = re.search(r'([0-9A-F]{16,})', out)
    return m.group(1) if m else None


def _tab_close(session: str, tid):
    """关掉标签页。失败不抛 —— 关闭失败不该影响解析结果

    ⚠️ 关标签是异步的：命令返回了，浏览器内部的资源回收（视频解码器、
       网络连接、Worker）还没结束。紧接着开新标签会撞上这个回收过程，
       实测连续解析时后几条明显变慢（前四条 6~11s，后两条 24s）。
       所以关完给浏览器一个极短的喘息窗口，让资源真正落地。
       （0.3 秒的成本换掉 10 秒以上的尾部波动，很划算）
    """
    if not tid:
        return
    try:
        _run_opencli(['browser', session, 'tab', 'close', tid], timeout=20)
        time.sleep(TAB_RELEASE_WAIT)
    except Exception:
        pass


def _eval_in_tab(session: str, tid, js: str, timeout: int = 45):
    """在指定标签页里执行 JS；tid 为 None 时退回当前标签"""
    args = ['browser', session, 'eval', js]
    if tid:
        args += ['--tab', tid]
    return _run_opencli(args, timeout=timeout)


def resolve_by_opencli(target: str, session: str = DEFAULT_SESSION, retries: int = 2) -> dict:
    """解析（带重试）

    抖音页面偶发不吐数据（渲染慢、风控抽风），单次失败不代表链接有问题，
    所以失败后重试，实测重试一次基本都能成。

    ⚠️ 重试之间**不要 reload + sleep**：reload 会把页面打进资源加载高峰，
    紧接着的探测会被主线程堵住（实测单次往返 1.6s → 45s），越重试越慢。
    _resolve_once 内部已经有导航 + 轮询，直接重跑一遍就是最干净的重试。
    """
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            return _resolve_once(target, session)
        except Exception as e:
            last_err = e
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


def _dedup_images(imgs):
    """图片去重：同一张图常有多种尺寸/格式后缀（~tplv-xxx.webp / .jpeg）"""
    seen = set()
    out = []
    for u in imgs:
        if not u:
            continue
        key = re.sub(r'~\w+\.(jpe?g|png|webp|heic)', '', u)
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


def _probe_once(session: str, vid: str, tid=None, timeout=None) -> dict:
    """一次往返同时取「detail 接口数据」+「DOM 播放器直链」

    为什么要合并成一次：
      每次 `opencli browser eval` 固定有 1~1.5 秒进程往返开销，跟表达式复杂
      程度无关。旧写法是接口一次、DOM 一次，交替轮询，白搭一倍往返。
      实测 detail 接口在正确页面上 1.6 秒就绪，DOM 播放器要等 10 秒以上
      —— 合并后一次往返就能同时拿到两边的进度，轮询轮数直接减半。

    返回 {ok, images, videoUrl, ...}；ok=False 表示页面还没准备好在哪一步。
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
        # DOM 播放器直链（同一次往返里顺带取，仅作兜底）
        "const vs=[...document.querySelectorAll('video source')].map(s=>s.src)"
        "  .filter(x=>x&&x.startsWith('http'));"
        "const vc=[...document.querySelectorAll('video')].map(v=>v.currentSrc)"
        "  .filter(x=>x&&x.startsWith('http')&&x.includes('douyinvod'));"
        "const v=a.video||{};"
        "const pick=o=>{o=o||{};const l=o.url_list||[];return l[0]||'';};"
        # ⭐ 视频直链直接从接口拿，不要等 DOM 播放器！
        #
        # 实测数据（冷启动，导航到视频页后）：
        #   接口就绪        ~1 秒
        #   DOM 播放器就绪  ~115 秒   ← 等它纯属浪费
        # 两者给的 CDN 域名一样（douyinvod），接口还多给 27 档码率可选。
        # play_addr 是「播放地址」（无水印），download_addr 是「带水印下载地址」，
        # 注意别取错 —— 接口的 has_watermark 标志指的是 download_addr。
        "const g=o=>(o&&o.url_list)?o.url_list.filter(Boolean):[];"
        "const vurls=g(v.play_addr).filter(x=>x.includes('douyinvod'));"
        "const vurlsH=g(v.play_addr_h264).filter(x=>x.includes('douyinvod'));"
        # 码率档位：bit_rate 里挑一份更高清的（可选，失败不影响主流程）
        "const brUrls=[];"
        "try{(v.bit_rate||[]).forEach(b=>{const l=g(b.play_addr)"
        "  .filter(x=>x.includes('douyinvod'));if(l[0])brUrls.push(l[0]);});}catch(e){}"
        "const norm=u=>u.replace('/playwm/','/play/');"
        # 图片列表：优先取最大尺寸的那张（url_list 最后一个通常分辨率最高）
        # 动图（实况照片）：live_photo_type == 1，每张自带一个 1~3 秒的小视频，
        #   视频直链在 im.video.play_addr.url_list。
        #   注意 im.clip_type：5 = 有动图，2 = 纯静态图（没有 video 字段）。
        #   这类作品在 App 里叫「动图合集」，如果只取图片会丢掉动态部分；
        #   如果只取第一张的 video 当整条作品，就会变成那个「2 秒视频」的错误。
        "const imgs=(a.images||[]).map(im=>{"
        "  const l=(im.url_list||[]).filter(Boolean);"
        "  const vl=(((im.video||{}).play_addr||{}).url_list||[]).filter(Boolean);"
        "  const dl=(im.download_url_list||[]).filter(Boolean);"
        "  const isLive=(im.live_photo_type===1)&&vl.length>0;"
        "  return {"
        "    url:l[l.length-1]||'',"
        "    live:isLive,"
        "    videoUrl:isLive?(vl[0]||''):'',"
        "    downloadUrl:isLive?(dl[dl.length-1]||''):'',"
        "    dur:isLive?((((im.video||{}).duration)||0)/1000):0"
        "  };"
        "}).filter(x=>x.url||x.videoUrl);"
        "return JSON.stringify({"
        # ok 的判据只看接口有没有给出这条作品 —— 页面播放器可能还在渲染
        "ok:!!a.aweme_id,"
        "apiStatus:r.status,"
        "apiVideoUrls:[...vurls,...vurlsH].map(norm),"
        "apiBitRateUrls:brUrls.map(norm),"
        "videoSrc:(vs[0]||vc[0]||''),"
        "aweme_type:a.aweme_type||0,"
        "desc:a.desc||'',"
        "author:(a.author||{}).nickname||'',"
        "cover:pick(v.cover)||pick(v.origin_cover)||'',"
        "duration:(v.duration||0)/1000,"
        "images:imgs.map(x=>x.url).filter(Boolean),"
        "images_detail:imgs,"
        "liveCount:imgs.filter(x=>x.live).length,"
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
    out = _eval_in_tab(session, tid, js, timeout=timeout or PROBE_TIMEOUT)
    d = _pick_source_json(out)
    return d if isinstance(d, dict) else {}


def _fetch_detail_in_page(session: str, vid: str) -> dict:
    """兼容入口：原来只取接口数据的路径，现在走合并探测。

    保留这个函数名是因为外部（和调试脚本）还在调它；实现委托给 _probe_once。
    """
    return _probe_once(session, vid)


def _dom_only_probe(session: str, deadline: float, tid=None):
    """纯 DOM 兜底：接口整个拿不到时（例如登录态失效）只能读页面

    返回 (meta, sources, slide_images, is_slides)。
    这条路径比接口慢很多，只在接口彻底失败时才走。
    """
    import time
    meta = {}
    best_meta = {}
    sources = []
    slide_images = []
    is_slides = False

    while time.time() < deadline:
        time.sleep(1.2)
        raw = _eval_in_tab(session, tid, (
            # 元数据提取（选择器均在真实页面验证过）：
            #   author —— [data-e2e="user-info"] 里指向 /user/ 的链接文本
            #             （旧的 video-author-name 已失效）
            #   slides —— 图文轮播的图，尽量全取（不只第一张）
            "JSON.stringify({src:[...document.querySelectorAll('video source')].map(s=>s.src),"
            "cur:[...document.querySelectorAll('video')].map(v=>v.currentSrc),"
            "title:document.title,"
            "author:(()=>{const el=document.querySelector('[data-e2e=\\\"user-info\\\"]');"
            "if(!el)return '';"
            "const a=[...el.querySelectorAll('a[href*=\\\"/user/\\\"]')].find(x=>x.innerText.trim());"
            "if(a)return a.innerText.trim();"
            "const t=el.innerText.trim();"
            "const mm=t.match(/^(.+?)(粉丝|获赞|关注)/);"
            "return mm?mm[1].trim():'';})(),"
            "dur:(document.querySelector('video')||{}).duration||0,"
            # 图文：轮播图特征 URL 是 tplv-dy-aweme-images，容器是 player-container。
            # （图文页也有 <video> 元素，所以不能靠「有没有 video」判断类型，
            #   必须看有没有这组图。）
            "slides:[...document.querySelectorAll('img')]"
            ".filter(i=>i.src&&i.src.includes('aweme-images'))"
            ".map(i=>i.src),"
            "info:(()=>{const el=document.querySelector('[data-e2e=\\\"detail-video-info\\\"]');"
            "return el?el.innerText.trim():'';})()})"
        ), timeout=30)
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

        # 图文优先判定！
        #
        # ⚠️ 图文页里也有 <video> 元素（背景/占位），所以不能靠「有没有 video」
        #    来区分类型，否则图文会被当成视频处理。
        #    判据是那组 tplv-dy-aweme-images 的图。
        if imgs:
            slide_images = imgs
            is_slides = True
            break

        # 视频：拿到直链就够
        if srcs:
            break

    merged = dict(meta)
    for k, v in (best_meta or {}).items():
        if v and not merged.get(k):
            merged[k] = v
    return merged, sources, slide_images, is_slides


def _resolve_once(target: str, session: str = DEFAULT_SESSION) -> dict:
    """解析单条作品：开干净标签 → 干活 → 一定关掉标签

    ⭐ 标签页隔离是性能关键（实测最慢那条 83s → 5.7s），所以标签的
    创建和回收统一在这里管，用 try/finally 保证任何退出路径（成功/异常/
    超时）都会把标签关掉，不给浏览器留垃圾。
    """
    url = (target or '').strip()
    m = re.search(r'https?://\S+', url)
    if m:
        url = m.group(0)
    if 'v.douyin.com' in url or 'iesdouyin.com/share' in url:
        url = _resolve_short_sync(url)

    vid = extract_video_id(url)
    if not vid:
        raise RuntimeError(f'无法从链接提取视频ID: {url}')

    # ⭐ 统一用 /video/ 地址：抖音会按作品类型自己跳到 /note/ 或 /slides/。
    #    实测直接上 /note/ 反而渲染不出来（播放器 30 秒都不出）。
    page_url = f'https://www.douyin.com/video/{vid}'

    # ⭐ 把目标 URL 直接交给 tab new，让浏览器开标签时就发起加载。
    #    对比「开空白标签 + eval 发导航」实测 3.9s vs 124s（详见 _tab_new 注释）。
    # ⚠️ 开不了新标签不算错，退化成用当前标签（老路径仍然能跑）
    tid = _tab_new(session, page_url)
    try:
        return _resolve_in_tab(url, vid, session, tid, navigated=bool(tid))
    finally:
        _tab_close(session, tid)


def _resolve_in_tab(url: str, vid: str, session: str, tid, navigated: bool = False) -> dict:
    """在指定标签页里完成解析（标签生命周期由 _resolve_once 管）

    navigated=True 表示标签已由 tab new 带着目标 URL 打开，页面正在加载，
    不需要再发导航指令 —— 少一次 eval 往返，也不会撞进加载高峰。
    """
    import time

    # 1) 导航到目标页面（仅当标签是空白页打开时才需要）
    #
    # ⚠️ 不要用 `browser open` —— 它会等页面完全静止（图片/视频/埋点全停），
    #    实测抖音详情页要 57~60 秒才返回，而真正的数据早就有了。
    if not navigated:
        page_url = f'https://www.douyin.com/video/{vid}'
        _eval_in_tab(session, tid,
                     f'location.href={json.dumps(page_url)}; "nav"', timeout=40)

    # 2) 单循环轮询：一次往返同时看「接口」和「DOM 播放器」
    #
    # ⚠️ 关键认知一：detail 接口的返回依赖「页面当前就在这条作品上」。
    #    Chrome 停在上一个视频时，它返回的是 HTTP 200 但 aweme_id 为空的体，
    #    不报错、静默给空 —— 傻等它永远等不到。
    #
    # ⚠️ 关键认知二（省时间的大头）：视频直链从接口的 video.play_addr 拿，
    #    不要等 DOM 播放器。实测接口就绪 ~1.5 秒就给直链，
    #    而 DOM 播放器要 ~115 秒才渲染出来（两者 CDN 域名和文件路径完全相同，
    #    是同一份文件，所以完全没必要等 DOM）。
    #
    # ⚠️ 关键认知三（时序陷阱，实测踩出来的）：
    #    查得太早和查得太密都会撞墙，必须用**退避**而不是固定间隔：
    #      第 1 轮（导航后 0 秒）: 1.2s 返回 ok=False —— 页面还没就绪，正常
    #      第 2 轮（+0.4 秒）    : 45s 超时     —— 撞进资源加载高峰，白等
    #      第 3 轮（+45 秒）    : 42s，拿到数据
    #    也就是说：紧接着第一次失败后立刻重试，正好撞在页面最忙的时刻。
    #    正确做法是失败后**等页面喘口气**（间隔递增），既不错过干净窗口，
    #    也不在高峰上硬撞。实测这样视频从 104~187s 降到 10 秒内。
    # ⚠️ 关键认知四（最大的一处浪费，实测采样出来的）：
    #    opencli 的 eval 通道在页面加载期间会被**反复堵住**，一堵就是 12~45 秒。
    #    密集采样页面打开后的 157 秒：
    #      @  1.4s 本轮 1.40s  ok=false    ← 页面刚开，通道空闲
    #      @ 14.0s 本轮12.08s  TIMEOUT     ← 撞上堵塞
    #      @ 19.2s 本轮 4.69s  ok=true     ← 数据拿到了，就在这个窗口
    #      @ 31.7s 之后全部 12.02s TIMEOUT
    #
    #    也就是说：**长超时是自伤** —— 傻等 12 秒/45 秒，正好把后面那个空闲
    #    窗口一起吃掉。改成「短超时快速试探」立刻见效：
    #      长超时（12~45s）: 偶尔 2.4s，经常 45s 超时，方差 19 倍
    #      短超时（3.5s）:   3/3 全命中，1.74 / 2.17 / 2.6 秒
    #
    #    所以这里用 PROBE_TIMEOUT 的短超时 + 极短间隔重试抢空闲窗口。
    #    先探一次（页面刚开时通道往往正空闲，能 2 秒内命中），
    #    失败后用 0.15 秒间隔继续抢，而不是拉长等待让出窗口。
    deadline = time.time() + 60
    detail = {}
    meta = {}
    sources = []
    slide_images = []
    is_slides = False
    dom_deadline = time.time() + 90   # 仅当接口没给直链时才启用

    while time.time() < deadline:
        probe = _probe_once(session, vid, tid, timeout=PROBE_TIMEOUT)

        # 超时/异常返回的不是 dict：通道被堵了，立刻重抢（不 sleep 让窗口）
        if not isinstance(probe, dict):
            continue

        if probe.get('ok'):
            # 接口数据每次都要覆盖成最新的 —— 互动数据是实时值
            detail = probe
            # 优先用接口直链；码率档位挑一份更高清的备选
            api_urls = [u for u in (probe.get('apiVideoUrls') or []) if u]
            if api_urls and not sources:
                sources = api_urls
                hi = [u for u in (probe.get('apiBitRateUrls') or []) if u]
                if hi:
                    sources = sources + hi[:3]
        else:
            # 本轮没通也不丢信息：把非空字段并进已有 detail，
            # 避免「最后一轮恰好不带封面」把前面的好数据覆盖成空。
            for k, v in probe.items():
                if v and not detail.get(k):
                    detail[k] = v

        # ---- 图文合集：接口给了图就够，立刻返回 ----
        # （图片是懒加载的，DOM 要 70 秒才渲染完，别等）
        if detail.get('ok') and (detail.get('images') or []):
            break

        # ---- 视频：接口给了直链，立刻返回（不等 DOM）----
        if detail.get('ok') and sources:
            break

        # 接口通了但没给直链（少见）：再等一会儿 DOM 播放器
        if detail.get('ok') and not sources and time.time() < dom_deadline:
            src = probe.get('videoSrc') or ''
            if src:
                sources = [src]
                break

        # 本轮通了但还差东西（如接口通了但直链没到）：极短间隔再抢一次
        time.sleep(PROBE_RETRY_GAP)

    # 统一成后面代码期望的字段名
    meta['title'] = detail.get('desc') or ''
    meta['author'] = detail.get('author') or ''
    meta['cover'] = detail.get('cover') or ''
    meta['dur'] = detail.get('duration') or 0
    meta['api_stats'] = {
        'likes': detail.get('likes') or 0,
        'comments': detail.get('comments') or 0,
        'shares': detail.get('shares') or 0,
        'collects': detail.get('collects') or 0,
    }
    if not detail.get('ok'):
        log_note = detail.get('apiStatus') or detail.get('err') or '未知原因'
        print(f'[opencli] detail 接口未取到元数据（{log_note}），尝试纯 DOM 兜底',
              file=sys.stderr)
        # 接口整个拿不到（比如登录态失效）时，退回纯 DOM 读取
        meta, sources, slide_images, is_slides = _dom_only_probe(
            session, deadline=max(time.time() + 20, deadline), tid=tid
        )

    api_images = detail.get('images') or []

    # 图文：接口给了图就够了，跳过整个 DOM 等待（图文页渲染要 70 秒）
    if api_images:
        st = {
            'likes': detail.get('likes') or 0,
            'comments': detail.get('comments') or 0,
            'shares': detail.get('shares') or 0,
            'collects': detail.get('collects') or 0,
        }
        imgs = _dedup_images(api_images)
        # 动图合集：images_detail 带每张的 live 标记和各自的小视频直链。
        # 前端拿这个列表才能把「动图」还原成动图，而不是退回静态图。
        raw_detail = detail.get('images_detail') or []
        live_items = []
        for idx, it in enumerate(raw_detail):
            if not isinstance(it, dict):
                continue
            live_items.append({
                'index': idx,
                'url': it.get('url') or '',
                'live': bool(it.get('live')),
                'videoUrl': it.get('videoUrl') or '',
                'duration': it.get('dur') or 0,
            })
        live_count = sum(1 for x in live_items if x['live'])
        title = (detail.get('desc') or '').strip()
        # 作品整体时长 = 各动图片段之和（纯图文为 0）
        total_dur = sum(x['duration'] for x in live_items if x['live'])
        return {
            'id': vid,
            'type': 'images',
            'title': title,
            'author': (detail.get('author') or '').strip(),
            'cover': (detail.get('cover') or '').strip() or (imgs[0] if imgs else ''),
            'musicUrl': (detail.get('music') or '').strip(),
            'musicTitle': (detail.get('music_title') or '').strip(),
            'duration': total_dur,
            'likes': st['likes'],
            'comments': st['comments'],
            'shares': st['shares'],
            'collects': st['collects'],
            'images': imgs,
            'imageCount': len(imgs),
            'isLivePhoto': live_count > 0,
            'liveCount': live_count,
            'imagesDetail': live_items,
            'awemeType': detail.get('aweme_type'),
            'source': 'opencli',
        }

    # 3) 非图文（或接口没给图）
    #
    # 走纯 DOM 兜底只有两种情况：接口彻底失败（上面已调 _dom_only_probe），
    # 或者接口给了数据但页面还没渲染出播放器（极少见）。
    # 正常情况下 meta / sources 已经在第 2 步的单循环里备好了，这里不再重复轮询。
    if not sources and not slide_images:
        log_note = detail.get('apiStatus') or detail.get('err') or '播放器未渲染'
        print(f'[opencli] 页面未给出播放器直链（{log_note}），再试一轮 DOM',
              file=sys.stderr)
        dmeta, dsources, dimgs, dis_slides = _dom_only_probe(
            session, deadline=time.time() + 15, tid=tid
        )
        if dsources:
            sources = dsources
        if dimgs:
            slide_images, is_slides = dimgs, dis_slides
        for k, v in (dmeta or {}).items():
            if v and not meta.get(k):
                meta[k] = v

    # ---------- 权威元数据：detail 接口（第 2 步已取，这里直接复用） ----------
    # DOM 上分不清「本作品」和「右侧推荐」，封面也拿错过。
    # 接口返回的才是准确数据。
    # ---------- 图文作品（接口没给图，但页面抓到了） ----------
    # 接口有图的路径在上面第 2 步就 return 了。走到这里说明接口没给图，
    # 但 DOM 认出了图文轮播图，用 DOM 的图作为兜底。
    if api_images or (is_slides and slide_images):
        uniq = _dedup_images(api_images or slide_images)
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
            'musicUrl': (detail.get('music') or '').strip(),
            'musicTitle': (detail.get('music_title') or '').strip(),
            'duration': 0,
            'likes': st['likes'],
            'comments': st['comments'],
            'shares': st['shares'],
            'collects': st['collects'],
            'images': uniq,
            'imageCount': len(uniq),
            'awemeType': detail.get('aweme_type'),
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

    # 去水印兜底：抖音部分直链走 /playwm/ 会带水印，换成 /play/ 即无水印。
    # 正常拿到的 douyinvod 直链本来就没水印，这步只对少数退化情况生效。
    if '/playwm/' in picked:
        picked = picked.replace('/playwm/', '/play/')

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
