# 抖音解析：双通道设计（接口 + 浏览器兜底）

## 为什么要改

2026-09 抖音又升了一轮风控，原来的解析链路**彻底不可用**：

| 方案 | 状态 | 原因 |
|------|------|------|
| `aweme/v1/web/aweme/detail` 接口 | ❌ 失效 | 带有效 cookie 也返回 **200 + 空 body**。`a_bogus` 签名算得再对也没用——浏览器自己发的请求同样是空 body |
| iesdouyin 分享页 SSR | ❌ 失效 | `_ROUTER_DATA` 里不再有 `play_addr` / `videoInfoRes` |
| f2 库 | ❌ 失效 | 底层就是上面那个接口 |
| 旧 `/web/api/v2/aweme/iteminfo` | ❌ 失效 | 返回空 |

所以症状是：**cookie 检测正常（`/cookie/check` 返回有效）、但解析一律失败**。
cookie 没问题，接口这条路的门被关了。

## 现在的设计

`douyin-resolver` 容器内两个通道，自动切换：

```
POST /douyin/parse（wxtools 后端）
        ↓
  douyin-resolver:3008
        ├─ 通道 1：resolve.py      直连接口（快，元数据全）
        │        └─ 失败（风控/空响应）↓
        └─ 通道 2：host.docker.internal:3009
                 opencli 驱动宿主机 Chrome，从 <video><source> 读无水印直链
```

**为什么兜底要放在宿主机而不是容器里**：
容器里没有 Chrome、没有 opencli，也没有抖音登录态。装一套 Chromium 进镜像
要涨到 400MB+，而且**无头浏览器拿不到直链**——实测无头模式下 `<video>` 的
`currentSrc` 是 `blob:` 地址（MediaSource 流式），必须用**有登录态的真实浏览器**。

## 关键实现点

### 1. 取 `<video source>` 的 src，不要取 currentSrc

```js
// ✅ 对：source 标签里是 douyinvod.com 的无水印直链
[...document.querySelectorAll('video source')].map(s => s.src)

// ❌ 错：currentSrc 经常是 blob:https://www.douyin.com/xxx
//        这是 MediaSource 流式地址，curl 下载不了
document.querySelector('video').currentSrc
```

### 2. 容器访问宿主机

`docker-compose.yml` 里给 `douyin-resolver` 加了：

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

宿主机兜底服务必须绑 `0.0.0.0`（不是 `127.0.0.1`），否则容器流量到不了。

### 3. 空 cookie 不再抛 DBUS 栈

原来没有 cookie 时，容器内 `browser_cookie3` 会抛
`KeyError: 'DBUS_SESSION_BUS_ADDRESS'`，一路冒到用户面前。
现在改成明确提示「请在页面设置你的抖音登录 cookie」。

## 部署

### 宿主机兜底服务（首次 / 重启后需要拉起）

依赖：Chrome 在运行 + 已登录抖音 + opencli 可用（`opencli doctor` 三个 OK）

```bash
# 1. 启动 Chrome（如果没跑）
unset BROWSER; DISPLAY=:0 google-chrome --profile-directory="Default" &

# 2. 确认 opencli 连上
opencli doctor     # 三个 [OK] 才算好

# 3. 启动兜底服务
cd ~/Documents/wxtools/server/douyin-resolver
~/venvs/f2env/bin/python dy_browser_service.py 3009
```

### 容器

```bash
cd ~/Documents/wxtools
docker compose up -d --build douyin-resolver
```

## 验证

```bash
# 兜底服务本身
curl "http://localhost:3009/health"
curl --max-time 170 "http://localhost:3009/resolve?url=https%3A%2F%2Fv.douyin.com%2Fxxx%2F"

# 容器内双通道（auto）
curl "http://localhost:3008/parse?url=https://v.douyin.com/xxx/"

# 只走某一条通道（排查用）
curl "http://localhost:3008/parse?url=...&mode=api"
curl "http://localhost:3008/parse?url=...&mode=browser"
```

拿到的 `videoUrl` 可以直接下载：

```bash
curl -L -o video.mp4 \
  -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Referer: https://www.douyin.com/" "<videoUrl>"
```

## 性能：为什么快、为什么慢（实测数据）

解析链路：短链 HEAD 解析 → 重置空白页 → eval 导航 → 单循环探测 → 返回。

### 关键实测数字

| 环节 | 耗时 | 说明 |
|------|------|------|
| 短链 HEAD 解析 | 0.6~0.8s | 纯网络，不是瓶颈 |
| `opencli browser eval` 单次往返 | 0.4~1.5s | 纯 JS 表达式，与复杂度无关 |
| 导航（从 about:blank 出发） | **0.42s** | 快 |
| 探测到接口数据（从 blank 出发） | **1.48s** | 快 |
| **导航/探测（上一页是抖音）** | **40~60s** | ⚠️ 慢在这儿 |
| DOM 播放器渲染出直链 | ~115s | 已经不等它了 |
| `browser open`（等页面静止） | 57~60s | 已弃用 |

### 三条核心结论

**1. 别等 DOM 播放器，视频直链从接口拿**

`video.play_addr.url_list` 里的 `douyinvod` 直链和 DOM 播放器给的是**同一份文件**
（实测文件路径段完全相同，只有 CDN 节点与签名不同），而接口 ~1.5 秒就给，
DOM 要 ~115 秒。`play_addr`（无水印播放地址）别和 `download_addr`（带水印下载地址）
搞混 —— 接口的 `has_watermark` 标志说的是后者。

**2. 慢的根源是「上一个页面是不是抖音」，不是我们抠的轮询**

抖音是 SPA，切走之后还残留大量资源与长连接，**opencli 的 eval 通道会被堵住**，
单次往返从 0.4 秒涨到 40~60 秒，连 `location.href='about:blank'` 都能超时。

所以解析前先重置到 `about:blank`。实测对比（同一条链接连续解析）：

```
直接解析:     4.5s ✓ / 138.9s ✗ / 24.1s ✓    ← 会失败
先重置再解析: 13.3s ✓ / 5.9s ✓ / 59.5s ✓     ← 都成功
```

重置本身也可能被堵，所以给了 **12 秒短超时**，超时就放弃重置直接往下走 ——
不能因为优化把主流程搞挂。

**3. 别在导航后 sleep，也别 reload 重试**

- 导航后 `sleep` 会让页面进入资源加载高峰，紧接着的探测正好撞上去。
  轮询间隔压到 0.4 秒，尽快抓那个干净窗口。
- 重试时**不要 `location.reload()` + sleep**：reload 必然把页面打进加载高峰，
  紧接着的探测被堵（1.6s → 45s），**越重试越慢**。直接重跑一遍 `_resolve_once`
  就是最干净的重试。

### 数字的方差来自哪里

同一条链接可能 4 秒也可能 60 秒。方差**不来自代码**，来自 Chrome 侧的页面状态：
Chrome 热态（SPA 已在内存）~2s 导航；冷态（首次加载抖音重资源）~60s。
测速时务必说明冷热，否则数字差 30 倍没有可比性。

## 作品形态与字段对照（踩过的坑）

抖音的作品不止「视频」和「图文」两种，还有**动图合集（实况照片）**。三类判据：

| 形态 | 判据 | 取什么 |
|------|------|--------|
| 视频 | `aweme_type` 非 68 | `video.play_addr` |
| 纯图文 | `images[].clip_type == 2` | `images[].url_list` 最后一项 |
| **动图合集** | `images[].live_photo_type == 1` | 每张的 `images[].video.play_addr.url_list` |

**动图合集是最容易做错的一类**：
- 每条作品里 8 张图可能 6 张是动图、2 张是静图，**同一作品混排**。
- 每张动图自带一个 1.5~2.8 秒的小视频（h264+aac, 720×960），
  直链在 `images[i].video.play_addr.url_list`。
- 只取 `images[i].url_list` → 动态部分全丢，用户看到的是「静态图」。
- 只取第一张的 `video` 当整条作品返回 → 用户看到「2 秒视频」，这就是那个 bug。
- `clip_type`：5 = 有动图，2 = 纯静图（没有 `video` 字段）。

返回字段给前端用：`isLivePhoto` / `liveCount` / `imagesDetail[]`
（每项含 `index` / `url` / `live` / `videoUrl` / `duration`）。
作品整体 `duration` = 各动图片段之和（纯图文才是 0，不要再写死 0）。

**黑屏+背景音乐**：音乐直链在 `music.play_url.url_list`（**不是** `music.url_list`，
后者不存在）。字段 `musicUrl` / `musicTitle`。

## 已知限制

- **兜底依赖宿主机 Chrome 常驻且登录抖音**。Chrome 关了或登录态失效 → 兜底失败。
  这是架构取舍：换来的是不用在镜像里塞 Chromium、不用维护无头浏览器。
- **首次解析慢**：要等页面渲染。现有实现已压到 **平均 5.9 秒**（9/9 成功，
  最快 4.7s / 最慢 6.6s），见下方「提速两板斧」。
- **解析耗时方差大**：Chrome 热态 5~7 秒、冷态（久未解析）10~30 秒。
  瓶颈在浏览器侧首次加载抖音重资源，不在我们的代码。
- **作者/封面部分取不到**：抖音网页版把这些放在动态渲染的节点里，
  `data-e2e` 选择器不一定命中；标题和时长稳定可用。
  （封面和互动数据已改走 `aweme/detail` 接口，见上文）

## 提速两板斧（实测出来的，别改）

### 一、`tab new` 直接带目标 URL，不要开空白标签再发导航

```
A) opencli browser dy tab new "https://www.douyin.com/video/<id>"    → 3.9~4.4s 命中
B) opencli browser dy tab new  +  eval 'location.href=...' 导航       → 124~163s 拿不到
```

差 30 倍。原因：B 方案的导航是一条 eval 指令，页面忙时这条通道本身会被堵住
（实测过 45 秒），而且**指令是异步的** —— 返回了不代表页面加载完，紧接着的
探测正好撞在资源加载高峰上。A 方案交给浏览器自己带着 URL 开标签，加载和探测
并行，省掉一次 eval 往返。

⚠️ `tab new` 的输出 key 随参数变：不带 URL 是 `"targetId"`，带 URL 是 `"page"`，
两种都要认。

### 二、关标签后等 0.3 秒再返回（`TAB_RELEASE_WAIT`）

关标签是**异步**的：命令返回了，浏览器内部的资源回收（视频解码器、连接、
Worker）还没结束。紧接着开新标签会撞上回收过程。

实测证据（改前）：连续解析 7 条 → 前四条 6~11s，后两条 24s，明显累积恶化。
改后：9 条全部 4.7~6.6s，**无累积恶化，第 9 条和第 1 条一样快**。

```python
# opencli_resolve.py
_run_opencli(['browser', session, 'tab', 'close', tid], timeout=20)
time.sleep(TAB_RELEASE_WAIT)   # 默认 0.3s，环境变量可调
```

### 为什么不用等 DOM 播放器

视频直链从接口 `a.video.play_addr.url_list` 拿，**1.5 秒就返回**；
DOM 播放器的 `<source>` 要 **115 秒**才渲染出来。两者 CDN 域名和文件路径段
完全一致（`tos-cn-ve-15/<fileid>`），是同一份文件，所以完全没必要等 DOM。

### 纯 HTTP 路线已确认死路（实测，别再试）

| 尝试 | 结果 |
|------|------|
| `curl_cffi` 5 种浏览器 TLS 指纹（chrome/120/124/safari17/edge101） | 200 **0 字节** |
| 带真实登录 cookie（sessionid/ttwid/odin_tt/s_v_web_id，70 条） | 200 **0 字节** |
| 空签名 / 带签名占位 | 200 **0 字节** |

根因写在响应头里：

```
x-whale-throughput-abort-data: {"content":"anonymous","id":53,"name":"强制阻断"}
```

抖音在边缘层直接判定「强制阻断」，请求根本没进业务逻辑 —— 签名、TLS 指纹、
cookie 三样全给对了也照样空 body。它要的是浏览器现场执行 JS 生成的环境证明
（`msToken`/`webid`/`verifyFp`）且与 TLS 会话绑定。要在 Python 里复现，等于用
JS 引擎把抖音的混淆代码整个跑一遍 —— 那是把浏览器重新实现一遍。

**结论：浏览器这层拆不掉，别往这个方向投入。**

- **opencli 输出夹带升级提示噪音**，提取 JSON 要用正则 `(\[.*\]|\{.*\})` 抠。
- ⚠️ **Hermes 终端工具会吞含 `Traceback` 的输出**——脚本报错时 `cat` 只显示
  一个孤零零的 `Traceback:`。诊断用 `od -c` / `xxd` 看真实字节。
- ⚠️ 容器 `--force-recreate` 会丢容器内改动，改动必须落到
  `server/douyin-resolver/` 的 git 仓库里（镜像从这里 build）。
- ⚠️ **改完解析代码必须 `systemctl restart dy-browser-fallback`**。
  宿主机 3009 服务是常驻进程，跑内存里的旧代码，只重建容器没用。
  用 `deploy_sync.py` 一条命令搞定（重启服务 + 重建容器 + 公网验证）。
- ⚠️ **改代码后先 `git status` 确认 `deploy_sync.py` 的位置**，别猜路径。
- ⚠️ opencli 的可执行文件在 nvm 当前版本下（例：`~/.nvm/versions/node/v25.9.0/bin`），
  版本号会变，别写死；`opencli browser <session> eval` 才是求值命令，
  `opencli eval` 不存在。

## 相关文件

| 文件 | 作用 |
|------|------|
| `resolve.py` | 接口通道（原逻辑，保留） |
| `http_server.py` | 容器内的 HTTP 服务，双通道调度 |
| `opencli_resolve.py` | opencli 浏览器兜底核心逻辑 |
| `dy_browser_service.py` | 宿主机 HTTP 服务，包装 opencli_resolve |
