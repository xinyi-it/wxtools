# 抖音解析服务

独立的抖音无水印视频解析 HTTP 服务，基于 [f2](https://github.com/Johnserf-Seed/f2) 库 + 抖音登录 cookie。

## 为什么需要它

抖音反爬严格，解析视频地址需要登录 cookie。因此本项目把解析逻辑独立成服务，wxtools 后端通过 HTTP 调用它获取无水印直链。

## 目录结构

```
douyin-resolver/
├── resolve.py         # 核心解析逻辑（f2 + cookie）
├── http_server.py     # HTTP 服务封装（暴露 /parse 接口）
└── requirements.txt   # Python 依赖
```

## 快速启动

### 方式一：直接用 Python 跑

```bash
# 1. 安装依赖（建议用虚拟环境）
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. 确保本机 Chrome 已登录抖音（解析需要读取 douyin cookie）

# 3. 启动服务（默认 3008 端口）
python http_server.py 3008

# 4. 测试
curl "http://localhost:3008/health"          # {"status": "ok"}
curl "http://localhost:3008/parse?url=<抖音分享链接>"
```

### 方式二：Docker

```bash
# 构建镜像
docker build -t douyin-resolver .

# 运行（挂载 Chrome 配置以便读取 cookie）
docker run -d -p 3008:3008 \
  -v ~/.config/google-chrome:/home/user/.config/google-chrome \
  douyin-resolver
```

## 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/parse?url=<链接>` | GET | 解析视频，返回无水印地址 |

`/parse` 返回格式：

```json
{
  "code": 200,
  "data": {
    "type": "video",
    "title": "视频标题",
    "author": "作者",
    "cover": "封面URL",
    "videoUrl": "无水印视频直链",
    "musicUrl": "",
    "duration": 30.5,
    "statistics": { "likes": 1000, "comments": 200, "shares": 50 }
  }
}
```

## Cookie 说明

- 解析服务通过 `browser-cookie3` 读取**本机 Chrome 的抖音登录 cookie**
- 因此运行解析服务的机器需要满足：**Chrome 已安装 + 已登录抖音**
- 没有有效 cookie 时，抖音接口会拒绝返回数据（解析失败）

## 与 wxtools 后端对接

wxtools 后端通过环境变量 `DOUYIN_RESOLVER_HOST` 指向本服务：

```bash
export DOUYIN_RESOLVER_HOST="http://localhost:3008"
```

完整说明见 [../docs/DOUYIN_RESOLVER.md](../docs/DOUYIN_RESOLVER.md)
