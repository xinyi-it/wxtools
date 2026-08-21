# 抖音解析服务部署指南

抖音解析**不依赖平台公开接口**，因为抖音反爬较严格（接口需要登录 cookie / 签名），因此本项目使用独立的**解析服务**来获取无水印视频地址。解析服务基于 [f2](https://github.com/Johnserf-Seed/f2) + Chrome 的抖音登录 cookie。

> ⚠️ 如果你不需要抖音功能，可以跳过本指南，项目其它功能（B站/快手/小红书/PDF）开箱即用。

## 工作原理

```
wxtools 后端 (Koa)  ──DOUYIN_RESOLVER_HOST──>  解析服务 (f2 + cookie)  ──>  抖音无水印直链
```

- wxtools 后端调用 `DOUYIN_RESOLVER_HOST` 指向的解析服务
- 解析服务内部用 f2 库 + 抖音登录 cookie 请求抖音接口，拿到无水印地址
- 解析服务独立部署，可以是 Docker 容器、独立进程，甚至是另一台服务器

## 解析服务代码已内置

**解析服务代码已包含在仓库中**：`server/douyin-resolver/`

```
server/douyin-resolver/
├── resolve.py         # 核心解析逻辑（f2 + cookie）
├── http_server.py     # HTTP 服务封装（暴露 /parse 接口）
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

# 3. 提供抖音登录 cookie（二选一）
#   ① 环境变量（推荐，全平台通用，macOS 必须用这个）
#     浏览器登录 douyin.com → F12 → Application/Cookies → 复制整串 douyin cookie
export DOUYIN_COOKIE="sessionid=xxx; ttwid=xxx; ..."
#   ② 本机 Chrome（仅 Linux/Windows，macOS 因 keychain 加密无法读取）

# 4. 启动服务（默认 3008 端口）
python http_server.py 3008

# 5. 测试
curl "http://localhost:3008/health"
curl "http://localhost:3008/parse?url=<抖音分享链接>"
```

> **macOS 注意**：`browser-cookie3` 无法解密 macOS 上 Chrome 的 cookie（keychain 加密机制不同），所以 **macOS 必须通过 `DOUYIN_COOKIE` 环境变量提供 cookie**，不能指望自动读取本机 Chrome。

### 方式二：Docker

```bash
# 构建镜像
docker build -t douyin-resolver server/douyin-resolver

# 运行（通过环境变量注入 cookie，推荐）
docker run -d -p 3008:3008 \
  -e "DOUYIN_COOKIE=sessionid=xxx; ttwid=xxx; ..." \
  douyin-resolver
```

### 方式三：直接在已登录抖音的机器上部署

如果你有一台已用 Chrome 登录抖音的 Linux/Windows 机器，可以直接在 `/parse` 需要时手动起解析服务（会自动读本机 Chrome cookie）。macOS 请改用环境变量 `DOUYIN_COOKIE`。

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

### Q: 一定要 Chrome + cookie 吗？
A: 是的，抖音接口需要登录 cookie。这是抖音反爬机制，f2 用真实 cookie 才能拿到数据。没有 cookie 拿不到无水印直链。cookie 通过环境变量 `DOUYIN_COOKIE` 提供（推荐，全平台通用），或由 Linux/Windows 上已登录的 Chrome 自动读取。

### Q: macOS 上读不到 cookie / 报错？
A: macOS 的 Chrome cookie 用 **keychain（安全钥匙串）加密**，`browser-cookie3` 无法解密。**macOS 必须通过 `DOUYIN_COOKIE` 环境变量提供 cookie**（浏览器登录抖音 → F12 → Application/Cookies → 复制整串 douyin.com 的 cookie）。

## 隐私说明

- cookie 来源：环境变量 `DOUYIN_COOKIE`（推荐）或 Linux/Windows 本机 Chrome 的抖音登录 cookie
- cookie 仅用于请求抖音接口，**不会上传任何 cookie 或数据到第三方**
- 部署时请确保解析服务所在机器是可信环境

## 免责声明

本项目仅供学习交流。请遵守抖音平台规则和相关法律法规，尊重原作者版权。不要使用本项目获取或传播未经授权的内容。
