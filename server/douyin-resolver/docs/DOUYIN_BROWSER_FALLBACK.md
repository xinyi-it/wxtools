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
- **首次解析慢**：要等页面渲染，约 5-15 秒。接口通道若是好的会快很多。
- **解析耗时方差大**：Chrome 热态 18 秒、冷态 37~74 秒。瓶颈在页面播放器渲染，
  不在我们的代码。
- **作者/封面部分取不到**：抖音网页版把这些放在动态渲染的节点里，
  `data-e2e` 选择器不一定命中；标题和时长稳定可用。
  （封面和互动数据已改走 `aweme/detail` 接口，见上文）
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
