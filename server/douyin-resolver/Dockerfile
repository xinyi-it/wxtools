# 抖音解析服务 Docker 镜像
# 构建：docker build -t douyin-resolver .
# 运行（通过环境变量提供 cookie）：
#   docker run -d -p 3008:3008 -e "DOUYIN_COOKIE=sessionid=xxx;...;ttwid=xxx" douyin-resolver
#
# cookie 获取方式：浏览器登录抖音后，从 DevTools/Application/Cookies 复制
# 两种来源：环境变量 DOUYIN_COOKIE（优先）> 本机 Chrome（挂载配置目录）

FROM python:3.11-slim

WORKDIR /app

# 先以 root 安装依赖，再切换非 root 用户（避免权限问题）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制解析服务代码
COPY resolve.py http_server.py ./

# 创建非 root 用户运行
RUN useradd -m -u 1000 user && chown -R user:user /app
USER user

# 暴露端口
EXPOSE 3008

# 启动服务
CMD ["python", "http_server.py", "3008"]
