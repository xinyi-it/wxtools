# 小程序工具箱 (wxtools)

一个功能丰富的小程序工具箱，提供**视频去水印下载**、**PDF转图片**等功能。基于 UniApp + Koa 开发，支持抖音 / 小红书 / B站 / 快手多平台解析。

> ⚠️ **免责声明**：本项目仅用于**学习交流**，请勿用于商业用途或侵犯他人权益。视频去水印功能旨在方便用户获取已授权内容的本地备份，请遵守平台规则和相关法律法规，尊重原作者版权。因使用本项目产生的任何后果由使用者自行承担。

## ✨ 功能列表

| 功能 | 描述 | 状态 |
|------|------|------|
| 🎵 抖音去水印 | 解析抖音视频/图文，去水印下载 | ✅ |
| 📕 小红书去水印 | 解析小红书视频/图文，支持多图获取，高清无水印 | ✅ |
| 🎬 B站下载 | 解析B站视频，封面代理 | ✅ |
| 🎞️ 快手去水印 | 解析快手视频/图文，去水印下载 | ✅ |
| 📄 PDF转图片 | 将PDF文件转换为图片 | ✅ |

## 🛠️ 技术栈

### 后端
- **框架**: Koa 2
- **数据库**: MongoDB 7.0 (Mongoose ORM)
- **缓存**: Redis 7 (ioredis)
- **PDF处理**: pdf2pic (ImageMagick)
- **参数验证**: Joi
- **HTTP客户端**: Axios
- **加密**: crypto-js

### 前端
- **框架**: UniApp (Vue 3 + Vite)
- **编译目标**: 微信小程序 + H5

## 📁 项目结构

```
wxtools/
├── server/                    # Koa 后端
│   ├── src/
│   │   ├── app.js            # 入口文件
│   │   ├── config/           # 配置
│   │   ├── middlewares/      # 中间件
│   │   ├── models/           # 数据模型
│   │   ├── routes/           # 路由
│   │   ├── services/         # 业务逻辑
│   │   │   ├── cleanup.service.js  # PDF文件清理服务
│   │   │   ├── pdf.service.js      # PDF转换服务
│   │   │   ├── douyin.service.js   # 抖音解析服务
│   │   │   ├── kuaishou.service.js # 快手解析服务
│   │   │   └── xiaohongshu.service.js # 小红书解析服务
│   │   └── utils/            # 工具函数
│   ├── uploads/              # PDF图片临时存储（自动清理）
│   ├── Dockerfile
│   └── package.json
│
└── client/                    # UniApp 前端
    ├── scripts/               # 构建脚本
    │   └── create-share-image.js  # 生成分享图片
    ├── src/
    │   ├── pages/            # 页面
    │   ├── api/              # API接口封装
    │   ├── utils/            # 工具函数
    │   ├── static/           # 静态资源
    │   │   └── share.png     # 小程序分享图片
    │   ├── App.vue
    │   ├── main.js
    │   └── pages.json
    └── package.json
```

## 🚀 快速开始

### 环境要求
- Node.js >= 18
- MongoDB >= 5.0
- Redis >= 6.0 (可选，用于缓存)
- npm 或 pnpm

### 安装依赖

```bash
# 后端
cd server && npm install

# 前端
cd client && npm install
```

### 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| PORT | 否 | 3000 | 服务端口 |
| MONGODB_URI | 是 | - | MongoDB连接地址 |
| REDIS_URL | 否 | - | Redis连接地址（不配置则禁用缓存） |
| DOUYIN_RESOLVER_HOST | 否 | http://localhost:3008 | 抖音解析服务地址（**见下方说明**） |

在 `server/` 目录下创建 `.env` 文件：

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/wxtools
REDIS_URL=redis://localhost:6379
```

### ⚠️ 抖音解析依赖说明

**抖音解析需要一个独立的解析服务**（因为抖音反爬严格，接口需要登录 cookie）。其他平台（B站/快手/小红书/PDF）**开箱即用**，不需要额外配置。

- 如果不配置 `DOUYIN_RESOLVER_HOST`，抖音解析会返回"解析服务不可用"的提示，**不影响其他功能**
- 完整部署教程见 [docs/DOUYIN_RESOLVER.md](./docs/DOUYIN_RESOLVER.md)

```bash
# 如果本地已启动解析服务（3008端口）
export DOUYIN_RESOLVER_HOST="http://localhost:3008"
```

### 启动服务

```bash
# 启动后端 (开发模式)
cd server && npm run dev

# 启动后端 (生产模式)
cd server && npm start

# 启动前端 - 微信小程序
cd client && npm run dev:mp-weixin

# 启动前端 - H5
cd client && npm run dev:h5
```

## 💾 缓存策略

### Redis 缓存
- **用途**: 缓存解析结果，减少重复请求
- **默认TTL**: 1小时
- **配置**:
  ```javascript
  // config/index.js
  cache: {
    enabled: true,
    ttlSeconds: 3600  // 1小时
  }
  ```

## 🧹 PDF文件自动清理

PDF转换生成的图片会自动清理，避免磁盘空间占用过多：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| ttlMinutes | 30 | 文件保留时间（分钟） |
| intervalMinutes | 15 | 清理检查间隔（分钟） |
| maxTotalSizeGB | 10 | 最大总容量（GB） |

### 清理策略
1. **TTL清理**: 超过保留时间的文件自动删除
2. **容量清理**: 总容量超限时，按时间顺序删除最旧文件

## 🛠️ 开发工具

### 生成分享图片

小程序分享功能需要一张分享图片，可通过脚本自动生成：

```bash
cd client
node scripts/create-share-image.js
```

生成的图片位于 `client/src/static/share.png`，用于小程序转发分享时展示。

## 🔌 API 接口

| 模块 | 方法 | 路径 | 描述 |
|------|------|------|------|
| 菜单 | GET | `/wxtools/api/menu/list` | 获取可见菜单 |
| 抖音 | POST | `/wxtools/api/douyin/parse` | 解析分享链接 |
| 抖音 | GET | `/wxtools/api/douyin/download` | 下载视频 |
| 快手 | POST | `/wxtools/api/kuaishou/parse` | 解析分享链接 |
| 快手 | GET | `/wxtools/api/kuaishou/download` | 下载视频 |
| 小红书 | POST | `/wxtools/api/xiaohongshu/parse` | 解析分享链接 |
| 小红书 | GET | `/wxtools/api/xiaohongshu/download` | 下载资源 |
| PDF | POST | `/wxtools/api/pdf/convert` | 转换PDF |
| PDF | GET | `/wxtools/api/pdf/image/:filename` | 获取图片 |

## 🐳 部署

详细部署文档请查看 [DEPLOY.md](./DEPLOY.md)

### Docker 快速部署

```bash
# 使用 Docker Compose 一键部署
docker-compose up -d --build

# 查看服务状态
docker-compose ps
```

### Docker 服务说明

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| server | 自建 | 3000 | Koa后端服务 |
| mongodb | mongo:7.0 | 27017(内部) | 数据库 |
| redis | redis:7-alpine | 6379(内部) | 缓存服务 |

### Redis 内存限制

```yaml
redis:
  command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
```
- 最大内存: 128MB
- 淘汰策略: LRU (最近最少使用)

## 📄 免责声明

本项目代码仅用于**技术学习与交流**，不提供任何形式的商业服务承诺。使用者应遵守：
- 各视频平台的使用条款与版权规定
- 《中华人民共和国著作权法》等相关法律法规
- 尊重原作者的知识产权

去水印功能的设计初衷是方便用户下载**自己拥有版权或已获授权**的内容。任何因使用本项目引发的法律问题，均与项目作者无关。

## License

MIT
