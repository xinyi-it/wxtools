# Docker 部署文档

## 服务器要求

- Docker >= 20.0
- Docker Compose >= 2.0
- 至少 1GB 可用内存

## 快速部署

### 1. 上传项目到服务器

```bash
# 方式一：Git克隆（推荐）
cd /var/www
git clone https://github.com/xinyi-it/wxtools.git
cd wxtools

# 方式二：SCP上传
scp -r wxtools root@your-server:/var/www/
```

### 2. 启动服务

```bash
cd /var/www/wxtools
docker-compose up -d --build
```

### 3. 查看服务状态

```bash
docker-compose ps
docker-compose logs -f server
```

## 常用命令

```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 查看日志
docker-compose logs -f server

# 重新构建并启动
docker-compose up -d --build

# 进入容器
docker exec -it wxtools-server sh
```

## Nginx 配置

```nginx
# API 接口代理（默认端口 3005，见 docker-compose.yml 的 server.ports）
location /wxtools/api {
    proxy_pass http://127.0.0.1:3005;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_cache_bypass $http_upgrade;

    # 文件上传大小限制
    client_max_body_size 20m;
}

# PDF图片静态文件代理
location /wxtools/api/pdf/image/ {
    proxy_pass http://127.0.0.1:3005/pdf/image/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # 图片缓存
    expires 7d;
    add_header Cache-Control "public, immutable";
}
```

修改后重载 Nginx：
```bash
nginx -t && nginx -s reload
```

## 前端部署

### 微信小程序

1. 修改API地址 `client/src/utils/request.js`：
```javascript
const BASE_URL = 'https://your-domain.com/wxtools/api'
```

2. 构建：
```bash
cd client
npm run build:mp-weixin
```

3. 使用微信开发者工具上传 `dist/build/mp-weixin` 目录

### H5 部署

1. 修改API地址后构建：
```bash
cd client
npm run build:h5
```

2. 将 `dist/build/h5` 目录内容上传到服务器

## 数据备份

```bash
# 备份 MongoDB 数据
docker exec wxtools-mongodb mongodump --db wxtools --out /tmp/backup
docker cp wxtools-mongodb:/tmp/backup ./mongodb_backup

# 恢复数据
docker cp ./mongodb_backup wxtools-mongodb:/tmp/backup
docker exec wxtools-mongodb mongorestore --db wxtools /tmp/backup/wxtools
```

## 更新部署

> **⚠️ 关键提醒**
>
> **不要每次部署都使用 `--build`！** 这会导致每次都重新安装系统依赖（ImageMagick、Ghostscript 等），耗时很长。
>
> - **日常更新**（只改了 src 代码）：用 `./deploy.sh` 或 `docker-compose restart server`，**秒级完成**
> - **完整构建**（改了 package.json 或 Dockerfile）：才用 `./deploy.sh --build`
>
> Docker 缓存机制：只有当文件变化时才会重新执行对应的构建步骤。

### ⚠️ 重要：部署后必须验证代码同步

**问题背景**：Docker容器内的代码是在构建镜像时COPY进去的，`docker-compose restart` 只会重启容器，不会更新容器内的代码。

**正确流程**：

```bash
# 1. 拉取代码
git pull

# 2. 重新构建镜像（src代码变化也需要这一步！）
docker-compose up -d --build server

# 3. 验证容器内代码是否同步
docker exec wxtools-server cat /app/src/services/xiaohongshu.service.js | grep -n "关键代码"

# 4. 查看服务日志确认正常运行
docker-compose logs --tail=20 server
```

**验证命令示例**：

```bash
# 检查某个文件的行数是否正确
docker exec wxtools-server wc -l /app/src/services/xiaohongshu.service.js

# 检查关键函数是否存在
docker exec wxtools-server grep -c "spectrum" /app/src/services/xiaohongshu.service.js
```

### 日常更新（推荐）

当只有源代码（src 目录）变化时，使用快速部署：

```bash
# 使用部署脚本（推荐）
./deploy.sh

# 或手动执行
git pull
docker-compose restart server
```

### 完整构建

当 `package.json` 或 `Dockerfile` 变化时，需要重新构建镜像：

```bash
# 使用部署脚本
./deploy.sh --build

# 或手动执行
git pull
docker-compose up -d --build
docker image prune -f
```

## 故障排查

### 服务无法启动

```bash
# 查看详细日志
docker-compose logs server

# 检查端口占用
netstat -tlnp | grep 3005
```

### MongoDB 连接失败

```bash
# 检查 MongoDB 容器状态
docker-compose logs mongodb

# 进入 MongoDB 容器
docker exec -it wxtools-mongodb mongosh
```

### API 请求 502

1. 检查后端服务是否运行：
```bash
docker-compose ps
curl http://127.0.0.1:3005/wxtools/api/menu/list
```

2. 检查 Nginx 配置：
```bash
nginx -t
nginx -s reload
```

## 本地开发

### 后端

```bash
cd server

# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

### 前端

```bash
cd client

# 安装依赖
npm install

# 微信小程序开发
npm run dev:mp-weixin

# H5开发
npm run dev:h5
```

## 环境变量说明

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| PORT | 服务端口 | 3000 |
| MONGODB_URI | MongoDB连接地址 | mongodb://localhost:27017/wxtools |
| NODE_ENV | 运行环境 | development |

## PDF文件清理机制

PDF转换后的图片文件采用自动清理策略，避免服务器存储压力。

### 清理策略

| 参数 | 值 | 说明 |
|------|-----|------|
| 文件保留时间 | 30分钟 | 超时自动删除 |
| 清理间隔 | 15分钟 | 定时任务执行频率 |
| 最大存储容量 | 10GB | 超限返回错误提示 |

### 工作流程

1. 用户上传PDF时检查存储容量
2. 已满10GB则返回错误："服务空间不足，请30分钟后再试"
3. 转换成功后注册文件元数据
4. 定时任务自动清理过期文件

### 相关配置

配置文件：`server/src/config/index.js`

```javascript
pdfCleanup: {
  enabled: true,
  ttlMinutes: 30,        // 文件保留时间（分钟）
  intervalMinutes: 15,   // 清理间隔（分钟）
  maxTotalSizeGB: 10,    // 最大总容量（GB）
}
```

### 查看清理日志

```bash
docker logs wxtools-server 2>&1 | grep Cleanup
```

输出示例：
```
[Cleanup] Service started, TTL=30min, interval=15min, max=10GB
[Cleanup] Starting cleanup...
[Cleanup] Completed: TTL deleted 5, capacity deleted 0
```
