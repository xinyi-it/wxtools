# 抖音解析服务部署指南

抖音解析**不依赖平台公开接口**，因为抖音反爬较严格（接口需要登录 cookie / 签名），因此本项目使用独立的**解析服务**来获取无水印视频地址。解析服务基于 [f2](https://github.com/Johnserf-Seed/f2)。

> ⚠️ 如果你不需要抖音功能，可以跳过本指南，项目其它功能（B站/快手/小红书/PDF）开箱即用。

## 工作原理

```
用户 (小程序填写自己的Cookie) ──> wxtools 后端 ──DOUYIN_RESOLVER_HOST──> 解析服务 (f2 + 用户Cookie) ──> 抖音无水印直链
```

- **每个用户填写自己的抖音 Cookie**（小程序内设置，仅存本地），由 wxtools 后端透传给解析服务
- 各用户用各的 cookie，**避免服务级共享 cookie 被抖音风控检测封号**
- 解析服务内部用 f2 库 + 用户传入的 cookie 请求抖音接口，拿到无水印地址
- 解析服务独立部署，可以是 Docker 容器、独立进程，甚至是另一台服务器

## 解析服务代码已内置

**解析服务代码已包含在仓库中**：`server/douyin-resolver/`

```
server/douyin-resolver/
├── resolve.py         # 核心解析逻辑（f2 + cookie，支持 --cookie 传入）
├── http_server.py     # HTTP 服务封装（暴露 /parse 和 /cookie/check）
├── requirements.txt   # Python 依赖
├── Dockerfile         # Docker 镜像构建
└── README.md          # 解析服务单独说明
```

你不需要从零写解析服务，直接用仓库里的代码部署即可。

## 快速启动（推荐：直接用仓库代码跑）

### 方式一：本地 Python 直接跑

```bash
# 1. 进入解析服务目录
cd server/douyin-resolver

# 2. 安装依赖（建议虚拟环境）
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. 启动服务（默认 3008 端口）
python http_server.py 3008

# 4. 测试
curl "http://localhost:3008/health"
# 传 cookie 解析（cookie 由 wxtools 后端透传用户 cookie 而来）
curl "http://localhost:3008/parse?url=<抖音分享链接>&cookie=<用户cookie>"
# 验证用户 cookie 是否有效
curl "http://localhost:3008/cookie/check?cookie=<用户cookie>"
```

> 解析服务本身**不需要**配置服务端 cookie——cookie 由每个用户在前端填写，解析时动态传入。未传 cookie 时返回清晰提示。

### 方式二：Docker

```bash
# 构建镜像
docker build -t douyin-resolver server/douyin-resolver

# 运行（无需配置 cookie，cookie 由每个用户解析时动态传入）
docker run -d -p 3008:3008 douyin-resolver
```

### 方式三：直接在已登录抖音的机器上部署

解析服务无需预配置 cookie。cookie 由用户在前端填写、wxtools 后端透传，解析时动态传入。未传 cookie 时返回清晰提示（macOS 同 Linux/Windows 一致）。

## 配置 wxtools 后端

设置环境变量指向解析服务：

```bash
# 如果解析服务和 wxtools 在同一台机器
export DOUYIN_RESOLVER_HOST="http://localhost:3008"

# 如果解析服务在另一台机器（需要网络可达）
export DOUYIN_RESOLVER_HOST="http://你的服务器IP:3008"

# 如果解析服务在 Docker 容器里，wxtools 容器用宿主机地址（Docker 默认网桥网关）
# export DOUYIN_RESOLVER_HOST="http://<宿主机网关IP>:3008"  # 通常是 172.17.0.1 或 docker 网桥网关
```

然后在 `server/` 目录的 `.env` 里配置：

```env
DOUYIN_RESOLVER_HOST=http://localhost:3008
```

## 解析服务返回格式

解析服务需返回以下 JSON：

```json
{
  "code": 200,
  "data": {
    "type": "video",
    "title": "视频标题",
    "author": "作者名",
    "cover": "封面图URL",
    "videoUrl": "无水印视频直链",
    "musicUrl": "背景音乐URL（可选）",
    "duration": 30.5,
    "statistics": { "likes": 1000, "comments": 200, "shares": 50 }
  }
}
```

## 常见问题

### Q: 抖音解析返回 "抖音解析服务不可用"？
A: 后端连不上 `DOUYIN_RESOLVER_HOST` 指向的服务。检查：
1. 解析服务是否启动、端口是否正确
2. `DOUYIN_RESOLVER_HOST` 是否配置正确
3. 网络是否可达（如果是 Docker 容器，注意网桥地址）

### Q: 解析服务说 "无法从链接提取视频ID"？
A: 抖音短链（`v.douyin.com/xxx`）有时效性，过期的短链会重定向到首页而非视频页。用**刚复制的有效分享链接**测试。

### Q: 一定要 cookie 吗？
A: 是的，抖音接口需要登录 cookie。这是抖音反爬机制，f2 用真实 cookie 才能拿到数据。没有 cookie 拿不到无水印直链。cookie 由**每个用户在前端填写自己的**（各用各的，避免共享被封号），wxtools 后端透传给解析服务。

### Q: cookie 从哪来？
A: 用户在小程序抖音页 → "获取Cookie指引" → 浏览器登录 douyin.com → F12 → Application → Cookies → 复制 douyin.com 的完整 Cookie 字符串 → 粘贴到小程序。Cookie 需包含 `sessionid`。Cookie 仅存储在用户本地，不上传服务器持久化。

### Q: 解析服务返回 "未提供 Cookie"？
A: 用户没有设置自己的抖音 Cookie。引导用户在小程序内设置 Cookie 后再解析。服务端**不提供**共享 cookie（避免风控封号）。

## 隐私说明

- cookie 来源：**每个用户自己的抖音登录 cookie**（前端填写，仅存本机）
- cookie 由 wxtools 后端临时透传给解析服务用于解析，**不持久化存储**
- cookie 仅用于请求抖音接口，**不会上传到第三方**
- 各用户用各的 cookie，避免服务级共享被风控检测封号

## 免责声明

本项目仅供学习交流。请遵守抖音平台规则和相关法律法规，尊重原作者版权。不要使用本项目获取或传播未经授权的内容。
