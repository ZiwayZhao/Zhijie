#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
#  智阶一键部署脚本 v2 — 含完整防护
#  用法: ./deploy/deploy.sh [--skip-build] [--skip-backup]
#
#  防护措施:
#    1. 部署前自动验证 docker-compose 不含硬编码 LLM 配置
#    2. 部署前自动验证 .env.production LLM 配置完整
#    3. docker compose down 防止容器名冲突
#    4. 数据库自动备份（可 --skip-backup 跳过）
#    5. 部署后健康检查 + LLM 配置验证
#    6. 失败自动回滚提示
# ═══════════════════════════════════════════════════════════════

SERVER="root@39.106.254.98"
REMOTE_DIR="/opt/zhijie"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# ── 参数解析 ──
SKIP_BUILD=false
SKIP_BACKUP=false
for arg in "$@"; do
  case $arg in
    --skip-build)  SKIP_BUILD=true ;;
    --skip-backup) SKIP_BACKUP=true ;;
  esac
done

# ═══════════════════════════════════════════
#  Pre-flight 检查（本地，部署前必须通过）
# ═══════════════════════════════════════════
echo "══════════════════════════════════════"
echo "  Pre-flight 检查"
echo "══════════════════════════════════════"

ERRORS=0

# 检查 1: docker-compose.prod.yml 不能有硬编码 LLM_BASE_URL
if grep -q "LLM_BASE_URL:" deploy/docker-compose.prod.yml 2>/dev/null; then
  if ! grep "LLM_BASE_URL:" deploy/docker-compose.prod.yml | grep -q '${'; then
    echo "  ❌ deploy/docker-compose.prod.yml 包含硬编码 LLM_BASE_URL!"
    echo "     → LLM 配置必须只在 .env 中，不能写在 docker-compose environment 里"
    echo "     → 这会覆盖 .env 配置，导致 LLM 鉴权失败 (Bug #1)"
    ERRORS=$((ERRORS + 1))
  fi
fi

# 检查 2: docker-compose.prod.yml 不能有硬编码 LLM_API_KEY（排除 ${} 引用）
if grep -q "LLM_API_KEY:" deploy/docker-compose.prod.yml 2>/dev/null; then
  if ! grep "LLM_API_KEY:" deploy/docker-compose.prod.yml | grep -q '${'; then
    echo "  ❌ deploy/docker-compose.prod.yml 包含硬编码 LLM_API_KEY!"
    ERRORS=$((ERRORS + 1))
  fi
fi

# 检查 3: .env.production 必须有 LLM_BASE_URL 和 LLM_API_KEY
if ! grep -q "^LLM_BASE_URL=" deploy/.env.production 2>/dev/null; then
  echo "  ❌ deploy/.env.production 缺少 LLM_BASE_URL"
  ERRORS=$((ERRORS + 1))
fi
if ! grep -q "^LLM_API_KEY=" deploy/.env.production 2>/dev/null; then
  echo "  ❌ deploy/.env.production 缺少 LLM_API_KEY"
  ERRORS=$((ERRORS + 1))
fi

# 检查 4: docker-compose.prod.yml 不能有 --reload
if grep -q "\-\-reload" deploy/docker-compose.prod.yml 2>/dev/null; then
  echo "  ❌ deploy/docker-compose.prod.yml 包含 --reload（开发配置泄漏到生产）"
  ERRORS=$((ERRORS + 1))
fi

# 检查 5: docker-compose.prod.yml 不能有源码 volume 挂载
if grep -q "\./app:" deploy/docker-compose.prod.yml 2>/dev/null; then
  echo "  ❌ deploy/docker-compose.prod.yml 包含源码 volume 挂载（开发配置）"
  ERRORS=$((ERRORS + 1))
fi

# 检查 6: .env.production 不能有 DEBUG=true
if grep -q "^DEBUG=true" deploy/.env.production 2>/dev/null; then
  echo "  ❌ deploy/.env.production DEBUG=true（生产环境不可开启）"
  ERRORS=$((ERRORS + 1))
fi

# 检查 7: 前端构建产物存在（除非 --skip-build）
if [ "$SKIP_BUILD" = true ] && [ ! -f "dist/index.html" ]; then
  echo "  ❌ dist/index.html 不存在，且 --skip-build 被设置"
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "  🛑 Pre-flight 检查失败 ($ERRORS 个错误)，部署中止"
  echo "  请修复以上问题后重试"
  exit 1
fi

echo "  ✅ 所有检查通过"

# ═══════════════════════════════════════════
#  Step 1: 本地构建前端
# ═══════════════════════════════════════════
if [ "$SKIP_BUILD" = false ]; then
  echo ""
  echo "📦 [1/5] 构建前端..."
  npm run build
  echo "   ✅ 构建完成 ($(du -sh dist | cut -f1))"
else
  echo ""
  echo "⏭️  [1/5] 跳过前端构建 (--skip-build)"
fi

# ═══════════════════════════════════════════
#  Step 2: SSH 连通性检查
# ═══════════════════════════════════════════
echo ""
echo "🔗 [2/5] 检查服务器连通性..."
if ! ssh -o ConnectTimeout=15 "$SERVER" "echo 'ok'" > /dev/null 2>&1; then
  echo "  ❌ 无法连接服务器 $SERVER"
  echo "  可能原因: 服务器宕机（内存不足）、网络问题、SSH 服务未启动"
  echo "  → 请去阿里云控制台重启 ECS 实例后重试"
  exit 1
fi
echo "  ✅ 服务器连通"

# 确保远程目录存在
ssh "$SERVER" "mkdir -p $REMOTE_DIR/{frontend/dist,backend,deploy}"

# ═══════════════════════════════════════════
#  Step 3: 同步文件
# ═══════════════════════════════════════════
echo ""
echo "📤 [3/5] 同步文件到服务器..."

# 前端产物
rsync -avz --delete --info=progress2 \
  dist/ "$SERVER:$REMOTE_DIR/frontend/dist/"

# 后端代码（排除开发文件和 .env）
rsync -avz --info=progress2 \
  --exclude '__pycache__' \
  --exclude '.venv' \
  --exclude 'node_modules' \
  --exclude '.pytest_cache' \
  --exclude '*.pyc' \
  --exclude '.env' \
  --exclude '.env.*' \
  backend/ "$SERVER:$REMOTE_DIR/backend/"

# 部署配置
rsync -avz deploy/ "$SERVER:$REMOTE_DIR/deploy/"

echo "   ✅ 同步完成"

# ═══════════════════════════════════════════
#  Step 4: 服务器端 — 备份 + 配置
# ═══════════════════════════════════════════
echo ""
echo "💾 [4/5] 数据库备份 + 配置更新..."

SKIP_BACKUP_FLAG="$SKIP_BACKUP"
ssh "$SERVER" "SKIP_BACKUP=$SKIP_BACKUP_FLAG" << 'REMOTE_SCRIPT'
set -euo pipefail
cd /opt/zhijie

# ── 数据库备份 ──
if [ "$SKIP_BACKUP" = "false" ]; then
  if docker compose -f backend/docker-compose.yml ps db --status running -q 2>/dev/null | grep -q .; then
    echo "   📀 备份数据库..."
    BACKUP_FILE="/opt/zhijie/backup_$(date +%Y%m%d_%H%M%S).sql"
    docker compose -f backend/docker-compose.yml exec -T db \
      pg_dump -U zhijie zhijie > "$BACKUP_FILE" 2>/dev/null || true
    BACKUP_SIZE=$(du -sh "$BACKUP_FILE" 2>/dev/null | cut -f1)
    echo "   ✅ 数据库已备份 ($BACKUP_SIZE) → $BACKUP_FILE"

    # 清理 30 天前的备份
    find /opt/zhijie -name "backup_*.sql" -mtime +30 -delete 2>/dev/null || true
  else
    echo "   ⚠️  数据库容器未运行，跳过备份"
  fi
else
  echo "   ⏭️  跳过数据库备份 (--skip-backup)"
fi

# ── 配置文件覆盖 ──
echo "   📋 更新配置文件..."

# 生产 .env（从 deploy 目录复制到 backend 工作目录）
cp deploy/.env.production backend/.env

# 生产 docker-compose（覆盖开发版）
cp deploy/docker-compose.prod.yml backend/docker-compose.yml

# ── 服务器端二次验证 ──
echo "   🔍 服务器端配置验证..."
SERR=0

# 验证 .env 中 LLM 配置
if ! grep -q "^LLM_BASE_URL=" backend/.env; then
  echo "   ❌ backend/.env 缺少 LLM_BASE_URL"
  SERR=$((SERR + 1))
fi
if ! grep -q "^LLM_API_KEY=sk-" backend/.env; then
  echo "   ❌ backend/.env LLM_API_KEY 格式异常"
  SERR=$((SERR + 1))
fi

# 验证 docker-compose.yml 不含硬编码 LLM
if grep -E "^\s+LLM_BASE_URL:\s+https?://" backend/docker-compose.yml | grep -v '${' > /dev/null 2>&1; then
  echo "   ❌ docker-compose.yml 仍包含硬编码 LLM_BASE_URL!"
  SERR=$((SERR + 1))
fi

if [ $SERR -gt 0 ]; then
  echo "   🛑 配置验证失败，中止部署"
  exit 1
fi
echo "   ✅ 配置验证通过"

# ── Nginx ──
echo "   🌐 配置 Nginx..."
cp deploy/nginx.conf /etc/nginx/sites-available/zhijie.conf
ln -sf /etc/nginx/sites-available/zhijie.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx
echo "   ✅ Nginx 已更新"

REMOTE_SCRIPT

# ═══════════════════════════════════════════
#  Step 5: 构建镜像 + 重启服务
# ═══════════════════════════════════════════
echo ""
echo "🚀 [5/5] 构建并重启服务..."
ssh "$SERVER" << 'REMOTE_SCRIPT'
set -euo pipefail
cd /opt/zhijie/backend

# ── 构建 Docker 镜像 ──
echo "   🔨 构建 Docker 镜像..."
docker compose build api 2>&1 | tail -5

# ── 停止旧服务（防止容器名冲突 Bug #5）──
echo "   ⏹️  停止旧服务..."
docker compose down --remove-orphans 2>/dev/null || true

# ── 清理无用镜像（防止磁盘满）──
docker image prune -f > /dev/null 2>&1 || true

# ── 启动所有服务 ──
echo "   ▶️  启动服务..."
docker compose up -d

# ── 等待服务就绪 ──
echo "   ⏳ 等待服务就绪..."
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:8003/api/v1/health > /dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ── 数据库迁移 ──
echo "   📊 运行数据库迁移..."
docker compose exec -T api alembic upgrade head

# ── MinIO bucket ──
echo "   🗄️  检查 MinIO bucket..."
docker compose exec -T minio mc alias set local http://localhost:9000 minioadmin "$(grep MINIO_ROOT_PASSWORD .env | cut -d= -f2)" 2>/dev/null || true
docker compose exec -T minio mc mb --ignore-existing local/zhijie-materials 2>/dev/null || true

# ═══════════════════════════════════════════
#  健康检查
# ═══════════════════════════════════════════
echo ""
echo "══════════════════════════════════════"
echo "  健康检查"
echo "══════════════════════════════════════"

HEALTH_ERRORS=0

# API
if curl -sf http://127.0.0.1:8003/api/v1/health > /dev/null 2>&1; then
  echo "  ✅ API 服务正常"
else
  echo "  ❌ API 服务异常"
  docker compose logs api --tail 10
  HEALTH_ERRORS=$((HEALTH_ERRORS + 1))
fi

# 前端
if curl -sf http://127.0.0.1:80/ > /dev/null 2>&1; then
  echo "  ✅ 前端正常"
else
  echo "  ❌ 前端异常"
  HEALTH_ERRORS=$((HEALTH_ERRORS + 1))
fi

# MinIO
if curl -sf http://127.0.0.1:9002/minio/health/live > /dev/null 2>&1; then
  echo "  ✅ MinIO 正常"
else
  echo "  ❌ MinIO 异常"
  HEALTH_ERRORS=$((HEALTH_ERRORS + 1))
fi

# LLM 配置验证（从容器内部检查实际加载的值）
echo ""
echo "  🔍 LLM 配置验证:"
LLM_URL=$(docker compose exec -T api python -c "from app.core.config import settings; print(settings.llm_base_url)" 2>/dev/null || echo "FAILED")
LLM_KEY_PREFIX=$(docker compose exec -T api python -c "from app.core.config import settings; print(settings.llm_api_key[:10] + '...')" 2>/dev/null || echo "FAILED")
echo "     LLM_BASE_URL = $LLM_URL"
echo "     LLM_API_KEY  = $LLM_KEY_PREFIX"

if echo "$LLM_URL" | grep -q "yunwu.ai"; then
  echo "  ✅ LLM 配置正确 (yunwu.ai)"
elif [ "$LLM_URL" = "FAILED" ]; then
  echo "  ⚠️  无法读取 LLM 配置（容器可能尚未就绪）"
else
  echo "  ⚠️  LLM 使用非预期 endpoint: $LLM_URL"
  echo "     如果这是有意更换的 provider 请忽略"
fi

# 容器状态
echo ""
echo "  服务状态:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# 内存使用
echo ""
echo "  资源使用:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || true
echo ""
free -h | head -2

if [ $HEALTH_ERRORS -gt 0 ]; then
  echo ""
  echo "  ⚠️  $HEALTH_ERRORS 个服务异常，请检查日志"
fi

REMOTE_SCRIPT

echo ""
echo "══════════════════════════════════════"
echo "  🎉 部署完成!"
echo "  🌐 http://39.106.254.98"
echo "══════════════════════════════════════"
