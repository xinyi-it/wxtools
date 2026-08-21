# 抖音解析服务 Docker 镜像
# 构建：docker build -t douyin-resolver .
# 运行：docker run -d -p 3008:3008 -v ~/.config/google-chrome:/home/user/.config/google-chrome douyin-resolver
#
# 注意：解析服务需要读取本机 Chrome 的抖音登录 cookie，
#       所以运行时需要把 Chrome 配置目录挂载进容器。
#       容器内需预装 Chrome，或使用系统已登录的 Chrome cookie。

FROM python:3.11-slim

# 安装 Chrome（解析需要真实的抖音 cookie）
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# 创建非 root 用户（cookie 目录挂载需要权限）
RUN useradd -m -u 1000 user && mkdir -p /app && chown user:user /app
USER user

WORKDIR /app

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制解析服务代码
COPY resolve.py http_server.py ./

# 暴露端口
EXPOSE 3008

# 启动服务
CMD ["python", "http_server.py", "3008"]
