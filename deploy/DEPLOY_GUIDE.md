# 智阶部署与运维指南

## 架构总览

```
用户浏览器 → Nginx (:80)
               ├── /           → dist/ 静态文件 (SPA)
               ├── /api/       → localhost:8003 (FastAPI)
               └── /s3/        → localhost:9002 (MinIO)

Docker Compose 内部网络:
  ├── api     (FastAPI uvicorn ×2)    → .env 读取所有业务配置
  ├── worker  (Celery ×2)             → .env 读取所有业务配置
  ├── db      (PostgreSQL 16)         → pgdata volume
  ├── redis   (Redis 7.4)             → appendonly
  └── minio   (MinIO)                 → miniodata volume
```

---

## 已知陷阱与防护规则

### 规则 1: docker-compose environment 只放基础设施

**陷阱**: `docker-compose.yml` 的 `environment` 优先级高于 `env_file`。
如果在 `environment` 中写了 `LLM_BASE_URL`，`.env` 中的值会被忽略。

**规则**:
- `environment` 段只允许: `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT_URL`
- 所有业务配置 (`LLM_*`, `CORS_*`, `SECRET_KEY`, `DEBUG`) 只放 `.env`
- deploy.sh 的 pre-flight 检查会自动拦截违规

**验证命令**:
```bash
# 检查 docker-compose 是否包含不该有的配置
grep -E "LLM_|CORS_|SECRET_|DEBUG" backend/docker-compose.yml
# 应该无输出
```

### 规则 2: LLM Provider 兼容性

**陷阱**: glm-4.7 不支持 OpenAI function calling，会超时 10 分钟返回空结果。

**防护**: `llm_client.py` 自动检测 `yunwu.ai` 或 `glm-` 前缀，跳过 FC。

**更换 LLM Provider 前的检查清单**:
1. 是否支持 OpenAI 兼容 API？
2. 是否支持 function calling / tool_choice？（不支持则加入跳过列表）
3. API Key 格式和鉴权方式？
4. 速率限制？（调整 retry 参数）
5. JSON 输出质量？（是否会产生非法转义字符）

### 规则 3: JSON 解析必须有容错层

**陷阱**: LLM 输出的 JSON 可能包含 `\g`, `\S` 等非法转义序列。

**防护**: 所有 `json.loads()` 解析 LLM 输出的地方都有 try/except + regex fix。

**受保护的路径**:
- `llm_client.py` → `_structured_output_json_prompt()` (JSON 模式)
- `llm_client.py` → `_structured_output_function_calling()` (FC 模式)

### 规则 4: 部署必须 down 再 up

**陷阱**: `docker compose up -d` 不会清理异常状态的容器，可能报 name conflict。

**防护**: deploy.sh 在 `up -d` 前执行 `docker compose down --remove-orphans`。

### 规则 5: 生产不能有开发配置

**禁止项清单**:
- `--reload` (uvicorn)
- `volumes: ./app:/code/app` (源码热加载)
- `DEBUG=true`
- `--concurrency=4` (2 核服务器只用 2)

**防护**: deploy.sh pre-flight 自动检查。

### 规则 6: Pydantic 模型字段名

**陷阱**: 不同模型用不同字段名 (`ModulePlan.name` vs `KnowledgeCard.title`)。

**规则**: 引用 Pydantic 模型字段前，先查该模型的 class 定义，不凭记忆写字段名。

---

## 日常运维

### 部署新版本

```bash
# 完整部署（构建前端 + 同步 + 重启）
./deploy/deploy.sh

# 仅后端更新（跳过前端构建）
./deploy/deploy.sh --skip-build

# 快速部署（跳过前端构建和数据库备份）
./deploy/deploy.sh --skip-build --skip-backup
```

### 查看日志

```bash
# SSH 到服务器
ssh root@39.106.254.98

# API 日志
cd /opt/zhijie/backend
docker compose logs api --tail 50 -f

# Worker 日志（LLM 管道）
docker compose logs worker --tail 50 -f

# 全部日志
docker compose logs --tail 20
```

### 紧急回滚

```bash
ssh root@39.106.254.98
cd /opt/zhijie/backend

# 查看最近备份
ls -la /opt/zhijie/backup_*.sql

# 恢复数据库
docker compose exec -T db psql -U zhijie zhijie < /opt/zhijie/backup_YYYYMMDD_HHMMSS.sql

# 重启服务
docker compose restart
```

### 服务器资源监控

```bash
# 内存使用（最常见的问题根源）
free -h

# Docker 容器资源
docker stats --no-stream

# 磁盘
df -h /

# 清理 Docker 垃圾
docker image prune -f
docker system prune -f  # 更激进的清理
```

### 修改 LLM 配置

```bash
ssh root@39.106.254.98
cd /opt/zhijie/backend

# 编辑 .env（唯一的配置源）
vim .env  # 修改 LLM_BASE_URL 和 LLM_API_KEY

# 重启加载新配置
docker compose restart api worker

# 验证
docker compose exec -T api python -c "from app.core.config import settings; print(settings.llm_base_url)"
```

**注意**: 修改后同步更新本地 `deploy/.env.production`，否则下次部署会覆盖回旧值。

---

## 服务器升级计划

### 当前配置（不足）
- 2 vCPU / 2-4 GB RAM
- 问题: docker build OOM、SSH 超时、服务器无响应

### 推荐升级
- **ecs.g7.xlarge**: 4 vCPU / 16 GB RAM
- 包年 ~500-550 元/月
- 解决所有内存问题

### 升级步骤
1. 阿里云控制台 → ECS 实例管理 → 更改实例规格
2. 选择 ecs.g7.xlarge (4C/16G)
3. 重启生效
4. 升级后调整 docker-compose:
   - worker concurrency 可提到 3-4
   - api workers 可提到 3-4
   - 加 memory limits 防止单容器 OOM

### 升级后 docker-compose 调整

```yaml
# deploy/docker-compose.prod.yml
services:
  api:
    command: uvicorn app.main:app --host 0.0.0.0 --port 8003 --workers 3
    deploy:
      resources:
        limits:
          memory: 1G
  worker:
    command: celery ... --concurrency=3
    deploy:
      resources:
        limits:
          memory: 2G
  db:
    deploy:
      resources:
        limits:
          memory: 2G
```

---

## 定期维护（建议加 cron）

```bash
# /etc/cron.d/zhijie-maintenance

# 每日 3:00 清理 Docker 无用镜像
0 3 * * * root docker image prune -f >> /var/log/zhijie-cleanup.log 2>&1

# 每日 3:05 检查磁盘（<20% 报警）
5 3 * * * root df -h / | awk 'NR==2{if(int($5)>80) print "DISK WARNING: " $5 " used"}' >> /var/log/zhijie-disk.log

# 每周日 3:10 清理 30 天前的数据库备份
10 3 * * 0 root find /opt/zhijie -name "backup_*.sql" -mtime +30 -delete
```
