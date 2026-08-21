# 生产阶段
FROM node:20-alpine

# 使用阿里云 Alpine 镜像源加速下载
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 安装 ImageMagick 和 Ghostscript（pdf2pic 依赖）
# 这一层会被 Docker 缓存，除非 Dockerfile 变化
RUN apk add --no-cache \
    imagemagick \
    ghostscript \
    graphicsmagick

WORKDIR /app

# 先复制 package.json，利用 Docker 缓存
# 只有 package.json 变化时才会重新安装依赖
COPY package*.json ./
# 使用淘宝 npm 镜像加速依赖安装
RUN npm config set registry https://registry.npmmirror.com && npm ci --omit=dev

# 最后复制源代码（最常变化）
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/app.js"]
