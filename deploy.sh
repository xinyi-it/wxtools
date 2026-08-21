#!/bin/bash

# wxtools 部署脚本
# 用法:
#   ./deploy.sh          # 日常更新（只重启容器）
#   ./deploy.sh --build  # 完整构建（当 package.json 或 Dockerfile 变化时）

set -e

BUILD_MODE=false

# 解析参数
for arg in "$@"; do
    case $arg in
        --build|-b)
            BUILD_MODE=true
            shift
            ;;
    esac
done

echo "========================================="
echo "  wxtools 部署脚本"
echo "========================================="

# 拉取最新代码
echo "[1/4] 拉取最新代码..."
git pull origin main

if [ "$BUILD_MODE" = true ]; then
    echo "[2/4] 完整构建模式 (--build)"
    echo "      重新构建 Docker 镜像..."
    docker-compose up -d --build
else
    echo "[2/4] 日常更新模式"
    echo "      重启容器（不重新构建镜像）..."
    docker-compose restart server
fi

# 等待服务启动
echo "[3/4] 等待服务启动..."
sleep 3

# 验证服务状态
echo "[4/4] 验证服务状态..."
docker-compose ps

# API 健康检查
echo ""
echo "API 健康检查:"
if curl -s -f http://127.0.0.1:3001/wxtools/api/menu/list > /dev/null; then
    echo "✅ API 服务正常"
else
    echo "❌ API 服务异常，请检查日志"
    echo ""
    echo "查看日志: docker-compose logs --tail=50 server"
    exit 1
fi

# 清理旧镜像（仅构建模式）
if [ "$BUILD_MODE" = true ]; then
    echo ""
    echo "清理旧镜像..."
    docker image prune -f
fi

echo ""
echo "========================================="
echo "  ✅ 部署完成!"
echo "========================================="
