#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════
#  智阶一键部署脚本
#  用法: ./deploy/deploy.sh [--skip-build]
# ═══════════════════════════════════════════

SERVER="root@39.106.254.98"
REMOTE_DIR="/opt/zhijie"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# ── 参数解析 ──
SKIP_BUILD=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

echo "══════════════════════════════════════"
echo "  智阶部署 → $SERVER"
echo "══════════════════════════════════════"

# ── Step 1: 本地构建前端 ──
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "📦 [1/4] 构建前端..."
  npm run build
  echo "   ✅ 构建完成 ($(du -sh dist | cut -f1))"
else
  echo ""
  echo "⏭️  [1/4] 跳过前端构建 (--skip-build)"
fi

# ── Step 2: 同步文件到服务器 ──
echo ""
echo "📤 [2/4] 同步文件到服务器..."

# 确保远程目录存在
ssh "$SERVER" "mkdir -p $REMOTE_DIR/{frontend/dist,backend,deploy}"

# 前端产物
rsync -avz --delete --info=progress2 \
  dist/ "$SERVER:$REMOTE_DIR/frontend/dist/"

# 后端代码（排除开发文件）
rsync -avz --info=progress2 \
  --exclude '__pycache__' \
  --exclude '.venv' \
  --exclude 'node_modules' \
  --exclude '.pytest_cache' \
  --exclude '*.pyc' \
  --exclude '.env' \
  backend/ "$SERVER:$REMOTE_DIR/backend/"

# 部署配置
rsync -avz deploy/ "$SERVER:$REMOTE_DIR/deploy/"

echo "   ✅ 同步完成"

# ── Step 3: 服务器端备份 ──
echo ""
echo "💾 [3/4] 数据库备份 + 服务更新..."
ssh "$SERVER" << 'REMOTE_SCRIPT'
set -euo pipefail
cd /opt/zhijie

# 备份数据库（如果容器在运行）
if docker compose -f backend/docker-compose.yml ps db --status running -q 2>/dev/null | grep -q .; then
  echo "   📀 备份数据库..."
  docker compose -f backend/docker-compose.yml exec -T db \
    pg_dump -U zhijie zhijie > "/opt/zhijie/backup_$(date +%Y%m%d_%H%M%S).sql" 2>/dev/null || true
  echo "   ✅ 数据库已备份"
else
  echo "   ⚠️  数据库容器未运行，跳过备份"
fi

# 复制生产环境变量到后端目录
cp deploy/.env.production backend/.env

# 复制生产 docker-compose
cp deploy/docker-compose.prod.yml backend/docker-compose.yml

# 配置 Nginx
echo "   🌐 配置 Nginx..."
cp deploy/nginx.conf /etc/nginx/sites-available/zhijie.conf
ln -sf /etc/nginx/sites-available/zhijie.conf /etc/nginx/sites-enabled/
# 移除默认站点（如果存在）
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx
echo "   ✅ Nginx 已更新"

REMOTE_SCRIPT

# ── Step 4: 构建并重启 Docker 服务 ──
echo ""
echo "🚀 [4/4] 构建并重启服务..."
ssh "$SERVER" << 'REMOTE_SCRIPT'
set -euo pipefail
cd /opt/zhijie/backend

# 构建 API 镜像
echo "   🔨 构建 Docker 镜像..."
docker compose build api

# 停止旧容器（防止容器名冲突）
echo "   ⏹️  停止旧服务..."
docker compose down --remove-orphans 2>/dev/null || true

# 启动所有服务
echo "   ▶️  启动服务..."
docker compose up -d

# 等待服务就绪
echo "   ⏳ 等待服务就绪..."
sleep 5

# 运行数据库迁移
echo "   📊 运行数据库迁移..."
docker compose exec -T api alembic upgrade head

# 确保 MinIO bucket 存在
echo "   🗄️  检查 MinIO bucket..."
docker compose exec -T minio mc alias set local http://localhost:9000 minioadmin "$(grep MINIO_ROOT_PASSWORD .env | cut -d= -f2)" 2>/dev/null || true
docker compose exec -T minio mc mb --ignore-existing local/zhijie-materials 2>/dev/null || true

# 健康检查
echo ""
echo "══════════════════════════════════════"
echo "  健康检查"
echo "══════════════════════════════════════"

if curl -sf http://127.0.0.1:8003/api/v1/health > /dev/null 2>&1; then
  echo "  ✅ API 服务正常"
else
  echo "  ❌ API 服务异常"
  docker compose logs api --tail 20
fi

if curl -sf http://127.0.0.1:80/ > /dev/null 2>&1; then
  echo "  ✅ 前端正常"
else
  echo "  ❌ 前端异常"
fi

if curl -sf http://127.0.0.1:9002/minio/health/live > /dev/null 2>&1; then
  echo "  ✅ MinIO 正常"
else
  echo "  ❌ MinIO 异常"
fi

echo ""
echo "  服务状态:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

REMOTE_SCRIPT

echo ""
echo "══════════════════════════════════════"
echo "  🎉 部署完成!"
echo "  🌐 http://39.106.254.98"
echo "══════════════════════════════════════"
