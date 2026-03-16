# 智阶后端开发规格 — 四大模块完整设计

> 技术栈：FastAPI + PostgreSQL + Redis + MinIO (S3-compatible)
> 前端：React + TypeScript + Vite + Tailwind CSS

---

## 模块1：知识网络（课程体系）

### 1.1 数据库 Schema

```sql
-- ==================== 课程体系 ====================

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL UNIQUE,   -- '数学', '计算机', '化学'...
    slug        VARCHAR(100) NOT NULL UNIQUE,    -- 'math', 'cs', 'chemistry'
    parent_id   UUID REFERENCES categories(id),  -- 支持树形分类
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE schools (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,           -- 'TU Munich'
    short_name  VARCHAR(50) NOT NULL UNIQUE,     -- 'TUM'
    country     VARCHAR(100),
    logo_url    TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE courses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(300) NOT NULL,
    slug            VARCHAR(300) NOT NULL,
    description     TEXT,
    category_id     UUID NOT NULL REFERENCES categories(id),
    school_id       UUID NOT NULL REFERENCES schools(id),
    created_by      UUID NOT NULL REFERENCES users(id),

    -- 搜索优化
    search_vector   tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(description, '')), 'B')
    ) STORED,

    -- AI 归并
    canonical_id    UUID REFERENCES courses(id), -- 指向规范课程（被归并后）
    embedding       vector(384),                  -- 课程描述向量（用于相似度计算）

    -- 统计（定期更新的物化值）
    material_count  INT DEFAULT 0,
    student_count   INT DEFAULT 0,

    tags            TEXT[] DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),

    UNIQUE(slug, school_id)
);

CREATE INDEX idx_courses_search ON courses USING GIN (search_vector);
CREATE INDEX idx_courses_category ON courses(category_id);
CREATE INDEX idx_courses_school ON courses(school_id);
CREATE INDEX idx_courses_canonical ON courses(canonical_id) WHERE canonical_id IS NOT NULL;
CREATE INDEX idx_courses_embedding ON courses USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE enrollments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    course_id   UUID NOT NULL REFERENCES courses(id),
    role        VARCHAR(20) DEFAULT 'student' CHECK (role IN ('student', 'ta', 'instructor')),
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, course_id)
);

CREATE INDEX idx_enrollments_user ON enrollments(user_id);
CREATE INDEX idx_enrollments_course ON enrollments(course_id);

-- 课程标签（多对多，便于筛选）
CREATE TABLE course_tags (
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    tag         VARCHAR(100) NOT NULL,
    PRIMARY KEY (course_id, tag)
);
CREATE INDEX idx_course_tags_tag ON course_tags(tag);
```

### 1.2 搜索方案决策

**选择：PostgreSQL 全文搜索（Phase 1）+ pgvector 向量搜索**

理由：
- 课程数据量 < 100K，PostgreSQL FTS 完全胜任
- 无需额外基础设施（Elasticsearch 运维成本高）
- `tsvector` + GIN 索引对中英文混合搜索已够用
- pgvector 扩展支持语义搜索（课程描述嵌入向量）
- 未来数据量超 1M 再考虑 Elasticsearch 或 ParadeDB

**搜索实现：**

```sql
-- 关键词搜索
SELECT * FROM courses
WHERE search_vector @@ plainto_tsquery('simple', '量子力学')
  AND is_active = true
  AND canonical_id IS NULL
ORDER BY ts_rank(search_vector, plainto_tsquery('simple', '量子力学')) DESC
LIMIT 20 OFFSET 0;

-- 语义相似度搜索（AI 归并用）
SELECT id, name, 1 - (embedding <=> $1) AS similarity
FROM courses
WHERE embedding IS NOT NULL
  AND 1 - (embedding <=> $1) > 0.85
ORDER BY embedding <=> $1
LIMIT 10;
```

### 1.3 AI 课程归并算法

```python
# 归并流程
async def merge_similar_courses():
    """
    定期任务（每日），找出疑似重复课程 → 人工确认 → 归并
    """
    # 1. 对所有无 canonical_id 的课程计算 embedding
    # 2. 对每对课程计算 cosine similarity
    # 3. similarity > 0.90 → 自动合并建议
    # 4. 0.85 < similarity < 0.90 → 需人工审核
    # 5. 合并：将 B.canonical_id = A.id，B 的材料/学生迁移到 A
```

### 1.4 后端 API

```python
# ==================== 课程 CRUD ====================

# GET /api/v1/courses
# Query params: q, category_id, school_id, page, per_page, sort_by
@router.get("/courses", response_model=PaginatedResponse[CourseOut])
async def list_courses(
    q: str | None = None,
    category_id: UUID | None = None,
    school_id: UUID | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    sort_by: Literal["relevance", "popular", "newest"] = "relevance",
): ...

# POST /api/v1/courses
@router.post("/courses", response_model=CourseOut, status_code=201)
async def create_course(body: CourseCreate, user: User = Depends(get_current_user)):
    # 自动生成 slug
    # 检查同校重名
    # 生成 embedding（异步）
    ...

# GET /api/v1/courses/{course_id}
@router.get("/courses/{course_id}", response_model=CourseDetail)
async def get_course(course_id: UUID): ...

# PUT /api/v1/courses/{course_id}
@router.put("/courses/{course_id}", response_model=CourseOut)
async def update_course(
    course_id: UUID, body: CourseUpdate,
    user: User = Depends(get_current_user),
): ...

# DELETE /api/v1/courses/{course_id}   (soft delete: is_active=false)
@router.delete("/courses/{course_id}", status_code=204)
async def delete_course(course_id: UUID, user: User = Depends(get_current_user)): ...

# POST /api/v1/courses/{course_id}/enroll
@router.post("/courses/{course_id}/enroll", status_code=201)
async def enroll_course(course_id: UUID, user: User = Depends(get_current_user)): ...

# DELETE /api/v1/courses/{course_id}/enroll
@router.delete("/courses/{course_id}/enroll", status_code=204)
async def unenroll_course(course_id: UUID, user: User = Depends(get_current_user)): ...

# GET /api/v1/courses/search/semantic?q=...
@router.get("/courses/search/semantic", response_model=list[CourseWithSimilarity])
async def semantic_search(q: str): ...

# ==================== 分类 & 学校 ====================

# GET /api/v1/categories  (树形返回)
# GET /api/v1/schools
# POST /api/v1/schools   (admin only)
```

### 1.5 TypeScript 类型

```typescript
// ==================== 前端类型 ====================

interface Category {
  id: string
  name: string
  slug: string
  parentId: string | null
  children?: Category[]
  sortOrder: number
}

interface School {
  id: string
  name: string
  shortName: string  // 'TUM', 'ETH'
  country: string
  logoUrl?: string
}

interface Course {
  id: string
  name: string
  slug: string
  description: string
  category: Category
  school: School
  createdBy: string   // user id
  tags: string[]
  materialCount: number
  studentCount: number
  isEnrolled?: boolean // 当前用户是否已加入
  createdAt: string
  updatedAt: string
}

interface CourseCreate {
  name: string
  description?: string
  categoryId: string
  schoolId: string
  tags?: string[]
}

interface CourseSearchResult {
  courses: Course[]
  total: number
  page: number
  perPage: number
}

// API 调用
const courseApi = {
  list: (params: CourseListParams) => get<CourseSearchResult>('/courses', params),
  get: (id: string) => get<Course>(`/courses/${id}`),
  create: (data: CourseCreate) => post<Course>('/courses', data),
  update: (id: string, data: Partial<CourseCreate>) => put<Course>(`/courses/${id}`, data),
  delete: (id: string) => del(`/courses/${id}`),
  enroll: (id: string) => post(`/courses/${id}/enroll`),
  unenroll: (id: string) => del(`/courses/${id}/enroll`),
  semanticSearch: (q: string) => get<Course[]>('/courses/search/semantic', { q }),
}
```

### 1.6 前端组件改造

```
当前：ExplorePage 从 mocks/courses.ts 读硬编码数据
改造：
  1. ExplorePage → useQuery('courses', courseApi.list) + Suspense
  2. 新增 CourseSearchBar 组件（debounced input → API 搜索）
  3. 新增 CreateCourseModal 组件（表单: name, school, category, tags）
  4. CoursePage → 增加「加入课程」按钮 + 成员列表 Tab
  5. 新增 SchoolSelector 组件（支持搜索选择学校）
```

---

## 模块2：文件上传与存储

### 2.1 数据库 Schema

```sql
-- ==================== 文件存储 ====================

CREATE TABLE materials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id       UUID NOT NULL REFERENCES courses(id),
    uploaded_by     UUID NOT NULL REFERENCES users(id),

    -- 文件信息
    original_name   VARCHAR(500) NOT NULL,         -- 用户上传的原始文件名
    storage_key     VARCHAR(500) NOT NULL UNIQUE,   -- MinIO 中的 object key
    mime_type       VARCHAR(100) NOT NULL,           -- 'application/pdf'
    file_size       BIGINT NOT NULL,                 -- 字节数
    checksum_sha256 VARCHAR(64) NOT NULL,            -- 去重 + 完整性校验

    -- 业务分类
    material_type   VARCHAR(20) NOT NULL CHECK (
        material_type IN ('课件', '习题', '笔记', '考题', '其他')
    ),

    -- AI 处理状态
    processing_status VARCHAR(20) DEFAULT 'pending' CHECK (
        processing_status IN ('pending', 'processing', 'completed', 'failed')
    ),
    disassembly_task_id VARCHAR(100),  -- science1204 任务 ID

    -- 元数据
    page_count      INT,
    thumbnail_key   VARCHAR(500),      -- 首页缩略图 storage key
    description     TEXT,

    is_public       BOOLEAN DEFAULT true,  -- 课程内可见 vs 仅自己
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_materials_course ON materials(course_id);
CREATE INDEX idx_materials_uploader ON materials(uploaded_by);
CREATE INDEX idx_materials_checksum ON materials(checksum_sha256);

-- 分片上传追踪
CREATE TABLE upload_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    original_name   VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(100) NOT NULL,
    total_size      BIGINT NOT NULL,
    chunk_size      INT NOT NULL DEFAULT 5242880,  -- 5MB
    total_chunks    INT NOT NULL,
    upload_id       VARCHAR(200),                   -- S3 multipart upload ID
    storage_key     VARCHAR(500) NOT NULL,
    status          VARCHAR(20) DEFAULT 'active' CHECK (
        status IN ('active', 'completed', 'aborted', 'expired')
    ),
    completed_parts JSONB DEFAULT '[]',             -- [{partNumber, etag}]
    created_at      TIMESTAMPTZ DEFAULT now(),
    expires_at      TIMESTAMPTZ DEFAULT now() + INTERVAL '24 hours'
);

CREATE INDEX idx_upload_sessions_user ON upload_sessions(user_id);
CREATE INDEX idx_upload_sessions_status ON upload_sessions(status) WHERE status = 'active';
```

### 2.2 存储方案

```
选型：MinIO（自部署 S3 兼容存储）

理由：
- S3 API 100% 兼容，未来可无缝迁移到 AWS S3 / Cloudflare R2
- Docker 部署简单，适合开发和中小规模生产
- 支持 multipart upload、presigned URL、lifecycle policy
- 免费开源

Bucket 结构：
  zhijie-materials/
    ├── {course_id}/{material_id}/original.pdf       # 原始文件
    ├── {course_id}/{material_id}/thumbnail.webp     # 首页缩略图
    └── {course_id}/{material_id}/processed/         # AI 处理产出

CDN 策略（Phase 2）：
  - Cloudflare R2 或 nginx 反向代理 + 缓存
  - 热门材料（下载次数 > 50）自动升级到 CDN
```

### 2.3 后端 API

```python
# ==================== 文件上传 ====================

# --- 小文件直传（< 10MB）---
# POST /api/v1/materials/upload
@router.post("/materials/upload", response_model=MaterialOut, status_code=201)
async def upload_small_file(
    file: UploadFile,
    course_id: UUID = Form(...),
    material_type: str = Form(...),
    user: User = Depends(get_current_user),
):
    """直接上传小文件到 MinIO"""
    # 1. 校验 file size < 10MB, mime_type in allowed
    # 2. 计算 SHA-256, 检查去重
    # 3. 上传到 MinIO
    # 4. 生成缩略图（异步）
    # 5. 插入 materials 表
    # 6. 触发 AI 处理任务（异步）
    ...

# --- 大文件分片上传（≥ 10MB）---

# POST /api/v1/upload/initiate
@router.post("/upload/initiate", response_model=UploadSessionOut)
async def initiate_multipart_upload(
    body: InitiateUploadRequest,
    user: User = Depends(get_current_user),
):
    """
    创建分片上传会话。
    返回：session_id, chunk_size, total_chunks, presigned_urls[]
    """
    # 1. 创建 MinIO multipart upload
    # 2. 为每个 chunk 生成 presigned PUT URL（有效期 1h）
    # 3. 存入 upload_sessions 表
    ...

# PUT /api/v1/upload/{session_id}/part/{part_number}
# → 客户端直接用 presigned URL 上传到 MinIO（不经过后端）

# POST /api/v1/upload/{session_id}/complete
@router.post("/upload/{session_id}/complete", response_model=MaterialOut)
async def complete_multipart_upload(
    session_id: UUID,
    body: CompleteUploadRequest,  # { course_id, material_type, parts: [{partNumber, etag}] }
    user: User = Depends(get_current_user),
):
    """
    合并分片，创建 material 记录。
    """
    # 1. 调用 MinIO complete_multipart_upload
    # 2. 插入 materials 表
    # 3. 触发缩略图生成 + AI 处理
    ...

# POST /api/v1/upload/{session_id}/abort
@router.post("/upload/{session_id}/abort", status_code=204)
async def abort_upload(session_id: UUID, user: User = Depends(get_current_user)): ...

# --- 下载与预览 ---

# GET /api/v1/materials/{material_id}/download
@router.get("/materials/{material_id}/download")
async def download_material(material_id: UUID, user: User = Depends(get_current_user)):
    """返回 presigned GET URL（有效期 15min）"""
    ...

# GET /api/v1/materials/{material_id}/preview
@router.get("/materials/{material_id}/preview")
async def preview_material(material_id: UUID):
    """返回 presigned GET URL + 内嵌 Content-Disposition: inline"""
    ...

# --- CRUD ---
# GET    /api/v1/courses/{course_id}/materials?type=&page=&per_page=
# GET    /api/v1/materials/{material_id}
# DELETE /api/v1/materials/{material_id}
# PATCH  /api/v1/materials/{material_id}   (改名、改分类)
```

### 2.4 TypeScript 类型

```typescript
// ==================== 文件上传类型 ====================

interface Material {
  id: string
  courseId: string
  uploadedBy: string
  originalName: string
  mimeType: string
  fileSize: number          // bytes
  materialType: '课件' | '习题' | '笔记' | '考题' | '其他'
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  pageCount?: number
  thumbnailUrl?: string
  description?: string
  isPublic: boolean
  createdAt: string
  updatedAt: string
}

interface UploadSession {
  id: string
  chunkSize: number
  totalChunks: number
  presignedUrls: string[]   // 每个 chunk 的 presigned PUT URL
}

interface UploadProgress {
  sessionId: string
  fileName: string
  totalSize: number
  uploadedSize: number
  uploadedChunks: number
  totalChunks: number
  status: 'uploading' | 'completing' | 'completed' | 'error' | 'paused'
  error?: string
}

// 上传 Hook
function useChunkedUpload() {
  return {
    upload: (file: File, courseId: string, materialType: string) => Promise<Material>,
    progress: UploadProgress | null,
    pause: () => void,
    resume: () => void,
    cancel: () => void,
  }
}
```

### 2.5 前端上传组件改造

```
当前：UploadPage 读文件为 base64 存 localStorage
改造：
  1. useChunkedUpload Hook:
     - file < 10MB → POST /upload (FormData)
     - file >= 10MB → initiate → 逐 chunk PUT presigned URL → complete
     - 每 chunk 完成后更新 progress state
     - 支持 pause/resume（记录 completedParts）
     - 网络断开自动暂停，恢复后继续
  2. DropZone 组件改造：
     - 移除 base64 编码逻辑
     - 添加进度条（per-file + overall）
     - 文件类型/大小校验前置（前端 100MB 限制）
  3. UploadProgress 组件：
     - 显示每个文件上传进度
     - 错误重试按钮
     - 取消/暂停按钮
  4. WorkbenchPage 改造：
     - MaterialReader 从 presigned URL 加载 PDF（不再从 localStorage）
     - useMemo 缓存 blob URL
```

---

## 模块3：用户认证系统

### 3.1 数据库 Schema

```sql
-- ==================== 用户认证 ====================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(320) NOT NULL UNIQUE,
    email_verified  BOOLEAN DEFAULT false,
    password_hash   VARCHAR(256),                  -- NULL if OAuth-only user
    display_name    VARCHAR(100) NOT NULL,
    avatar_url      TEXT,

    -- OAuth 关联
    github_id       VARCHAR(100) UNIQUE,
    google_id       VARCHAR(100) UNIQUE,

    -- 角色
    role            VARCHAR(20) DEFAULT 'student' CHECK (
        role IN ('student', 'instructor', 'admin')
    ),

    is_active       BOOLEAN DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_github ON users(github_id) WHERE github_id IS NOT NULL;
CREATE INDEX idx_users_google ON users(google_id) WHERE google_id IS NOT NULL;

-- Refresh Token 存储（支持多设备 + 撤销）
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(256) NOT NULL UNIQUE,  -- SHA-256 of refresh token
    device_info     VARCHAR(500),                   -- User-Agent / device name
    ip_address      INET,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,                    -- NULL = active
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at)
    WHERE revoked_at IS NULL;

-- 邮箱验证码 / 密码重置 token
CREATE TABLE verification_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(256) NOT NULL UNIQUE,
    purpose     VARCHAR(20) NOT NULL CHECK (
        purpose IN ('email_verify', 'password_reset')
    ),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 Token 策略

```
Access Token (JWT):
  - 签名算法: HS256 (单服务) / RS256 (微服务)
  - 过期时间: 15 分钟
  - Payload: { sub: user_id, email, role, exp, iat, jti }
  - 存储: 前端内存 (非 localStorage，防 XSS)

Refresh Token:
  - 格式: 随机 UUID + 签名
  - 过期时间: 30 天
  - 存储: HttpOnly Secure SameSite=Strict Cookie
  - 数据库存 hash（支持撤销）
  - 每次 refresh 旋转（rotation）：旧 token 失效，发新 token

安全措施:
  - 密码: argon2id 哈希 (优于 bcrypt)
  - Rate limiting: 登录 5次/分钟, 注册 3次/分钟
  - CORS: 严格白名单
  - CSRF: SameSite Cookie + 自定义 header 双重防护
```

### 3.3 后端 API

```python
# ==================== 认证 API ====================

# --- 注册 ---
# POST /api/v1/auth/register
@router.post("/auth/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterRequest):
    """
    body: { email, password, display_name }
    1. 校验邮箱格式 + 唯一性
    2. argon2id 哈希密码
    3. 创建用户
    4. 发送验证邮件（异步）
    5. 返回 access_token + set refresh_token cookie
    """
    ...

# --- 登录 ---
# POST /api/v1/auth/login
@router.post("/auth/login", response_model=AuthResponse)
async def login(body: LoginRequest, response: Response):
    """
    body: { email, password }
    1. 查用户
    2. argon2id 验证密码
    3. 生成 access_token (JWT)
    4. 生成 refresh_token → 存数据库 hash → set HttpOnly cookie
    5. 更新 last_login_at
    """
    ...

# --- Token 刷新 ---
# POST /api/v1/auth/refresh
@router.post("/auth/refresh", response_model=TokenResponse)
async def refresh_token(request: Request, response: Response):
    """
    从 cookie 取 refresh_token
    1. 查数据库, 校验未过期/未撤销
    2. Token Rotation: 撤销旧 token, 生成新 refresh_token
    3. 返回新 access_token + set 新 refresh_token cookie
    """
    ...

# --- 登出 ---
# POST /api/v1/auth/logout
@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, user: User = Depends(get_current_user)):
    """
    1. 撤销当前 refresh_token
    2. 清除 cookie
    """
    ...

# POST /api/v1/auth/logout-all   (撤销所有设备)
@router.post("/auth/logout-all", status_code=204)
async def logout_all(user: User = Depends(get_current_user)): ...

# --- OAuth2 ---
# GET /api/v1/auth/oauth/github
@router.get("/auth/oauth/github")
async def github_oauth_redirect():
    """重定向到 GitHub 授权页"""
    ...

# GET /api/v1/auth/oauth/github/callback
@router.get("/auth/oauth/github/callback")
async def github_oauth_callback(code: str, state: str, response: Response):
    """
    1. 用 code 换 GitHub access token
    2. 获取 GitHub 用户信息 (id, email, name, avatar)
    3. 查找/创建用户 (by github_id)
    4. 签发 token pair
    """
    ...

# GET /api/v1/auth/oauth/google
# GET /api/v1/auth/oauth/google/callback
# (同理)

# --- 邮箱验证 ---
# POST /api/v1/auth/verify-email
@router.post("/auth/verify-email")
async def verify_email(body: VerifyEmailRequest): ...  # { token }

# --- 密码重置 ---
# POST /api/v1/auth/forgot-password
@router.post("/auth/forgot-password", status_code=202)
async def forgot_password(body: ForgotPasswordRequest): ...  # { email }

# POST /api/v1/auth/reset-password
@router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordRequest): ...  # { token, new_password }

# --- 用户信息 ---
# GET /api/v1/auth/me
@router.get("/auth/me", response_model=UserProfile)
async def get_me(user: User = Depends(get_current_user)): ...

# PATCH /api/v1/auth/me
@router.patch("/auth/me", response_model=UserProfile)
async def update_me(body: UpdateProfileRequest, user: User = Depends(get_current_user)): ...
```

### 3.4 FastAPI 依赖注入

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer
from jose import jwt, JWTError

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """从 Bearer token 解析当前用户"""
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await db.get(User, UUID(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def require_role(*roles: str):
    """角色权限装饰器"""
    async def checker(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker
```

### 3.5 TypeScript 类型

```typescript
// ==================== 认证类型 ====================

interface User {
  id: string
  email: string
  emailVerified: boolean
  displayName: string
  avatarUrl?: string
  role: 'student' | 'instructor' | 'admin'
  createdAt: string
}

interface AuthResponse {
  accessToken: string
  user: User
  // refresh token 在 HttpOnly cookie 中，前端不可见
}

interface LoginRequest {
  email: string
  password: string
}

interface RegisterRequest {
  email: string
  password: string
  displayName: string
}

// ==================== AuthContext ====================

interface AuthContextValue {
  user: User | null
  isLoading: boolean         // 初始化时检查 token
  isAuthenticated: boolean
  login: (data: LoginRequest) => Promise<void>
  register: (data: RegisterRequest) => Promise<void>
  logout: () => Promise<void>
  loginWithGithub: () => void
  loginWithGoogle: () => void
  refreshAccessToken: () => Promise<string>
}

// AuthProvider 内部:
// - accessToken 存在 useRef 中（内存，非 localStorage）
// - 启动时调用 /auth/refresh 检查 cookie 中的 refresh token
// - axios interceptor: 401 → refreshAccessToken → 重试原请求
// - refreshAccessToken 失败 → logout + redirect to /auth/login
```

### 3.6 前端认证架构

```typescript
// src/contexts/AuthContext.tsx

const AuthContext = createContext<AuthContextValue>(...)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const accessTokenRef = useRef<string | null>(null)

  // 启动时尝试 refresh
  useEffect(() => {
    refreshAccessToken()
      .then(() => fetchMe())
      .catch(() => {/* not logged in */})
      .finally(() => setIsLoading(false))
  }, [])

  // Axios interceptor setup
  useEffect(() => {
    // Request interceptor: attach Bearer token
    // Response interceptor: 401 → refresh → retry
  }, [])

  // ... login, register, logout implementations
}

// src/components/auth/ProtectedRoute.tsx

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <LoadingSkeleton />
  if (!isAuthenticated) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />
  }
  return children
}

// src/App.tsx 改造
<AuthProvider>
  <Layout>
    <Routes>
      {/* 公开路由 */}
      <Route path="/" element={<HomePage />} />
      <Route path="/explore" element={<ExplorePage />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/oauth/callback" element={<OAuthCallback />} />

      {/* 受保护路由 */}
      <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/my/*" element={...} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* 半保护路由（未登录可查看，但功能受限） */}
      <Route path="/course/:id" element={<CoursePage />} />
      <Route path="/course/:id/material/:mid" element={<WorkbenchPage />} />
    </Routes>
  </Layout>
</AuthProvider>
```

### 3.7 安全清单

```
[ ] 密码强度要求：≥ 8 字符，包含大小写 + 数字
[ ] argon2id 哈希（不用 bcrypt，argon2 抗 GPU/ASIC 攻击更强）
[ ] Rate limiting: slowapi + Redis (login: 5/min, register: 3/min)
[ ] JWT secret ≥ 256 bits，从环境变量读取
[ ] Refresh token rotation（每次刷新都换新 token）
[ ] CORS: 仅允许前端域名
[ ] Cookie: HttpOnly + Secure + SameSite=Strict + Path=/api/v1/auth
[ ] 密码重置 token 一次性使用，15 分钟过期
[ ] OAuth state 参数防 CSRF
[ ] 敏感操作（改密码、删账号）需二次验证
[ ] 登出时撤销 refresh token + 清 cookie
[ ] 禁止在 JWT payload 存敏感数据（密码、手机号）
```

---

## 模块4：跨设备数据同步

### 4.1 当前 localStorage 键清单

```
Key                              数据类型        特征
──────────────────────────────── ─────────────── ────────────────
zhijie_learning_profile          单对象          用户唯一
zhijie_flashcards_{courseId}     数组+FSRS状态   课程维度，频繁更新
zhijie_evolution_logs_{courseId} 数组            追加为主
zhijie_agenda_todos              数组            增删改
zhijie_exam_configs              数组            低频修改
zhijie_user_materials            数组+文件数据   最大，含 base64
zhijie_highlights_{materialId}  数组            材料维度
zhijie_mock_*                   布尔值          不需要同步（忽略）
```

### 4.2 同步数据库 Schema

```sql
-- ==================== 用户数据同步 ====================

-- 学习画像
CREATE TABLE learning_profiles (
    user_id         UUID PRIMARY KEY REFERENCES users(id),
    profile_data    JSONB NOT NULL,          -- LearningProfile 完整对象
    updated_at      TIMESTAMPTZ DEFAULT now(),
    version         BIGINT DEFAULT 1         -- 乐观锁版本号
);

-- 闪卡（最重要，需要精细同步）
CREATE TABLE flashcard_decks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    course_id       UUID NOT NULL REFERENCES courses(id),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    version         BIGINT DEFAULT 1,
    UNIQUE(user_id, course_id)
);

CREATE TABLE flashcard_notes (
    id              UUID PRIMARY KEY,         -- 客户端生成的 UUID
    deck_id         UUID NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
    note_type       VARCHAR(30) NOT NULL,
    fields          JSONB NOT NULL,            -- { front, back, extra }
    tags            TEXT[] DEFAULT '{}',
    source_ref      JSONB,
    generated_by    VARCHAR(20) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ               -- 软删除
);

CREATE TABLE flashcard_cards (
    id                  UUID PRIMARY KEY,
    note_id             UUID NOT NULL REFERENCES flashcard_notes(id) ON DELETE CASCADE,
    due                 TIMESTAMPTZ NOT NULL,
    stability           FLOAT NOT NULL,
    difficulty          FLOAT NOT NULL,
    state               VARCHAR(20) NOT NULL,
    reps                INT DEFAULT 0,
    lapses              INT DEFAULT 0,
    consecutive_again   INT DEFAULT 0,
    consecutive_easy    INT DEFAULT 0,
    average_response_ms INT,
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE review_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id         UUID NOT NULL REFERENCES flashcard_cards(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 4),
    reviewed_at     TIMESTAMPTZ NOT NULL,
    response_ms     INT,
    -- 不需要 updated_at，review log 只追加不修改
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_review_logs_card ON review_logs(card_id);
CREATE INDEX idx_review_logs_user_time ON review_logs(user_id, reviewed_at DESC);

-- 日程待办
CREATE TABLE agenda_todos (
    id              UUID PRIMARY KEY,         -- 客户端生成
    user_id         UUID NOT NULL REFERENCES users(id),
    todo_data       JSONB NOT NULL,            -- AgendaItem 完整对象
    completed       BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- 考试配置
CREATE TABLE exam_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    course_id       UUID NOT NULL REFERENCES courses(id),
    exam_date       DATE NOT NULL,
    config_data     JSONB NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, course_id)
);

-- PDF 批注
CREATE TABLE highlights (
    id              UUID PRIMARY KEY,         -- 客户端生成
    user_id         UUID NOT NULL REFERENCES users(id),
    material_id     UUID NOT NULL REFERENCES materials(id),
    highlight_data  JSONB NOT NULL,            -- 完整高亮对象
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_highlights_material ON highlights(user_id, material_id);

-- 全局同步水位线
CREATE TABLE sync_cursors (
    user_id         UUID NOT NULL REFERENCES users(id),
    entity_type     VARCHAR(50) NOT NULL,      -- 'flashcards', 'highlights', 'todos'...
    last_sync_at    TIMESTAMPTZ NOT NULL,
    last_version    BIGINT DEFAULT 0,
    PRIMARY KEY (user_id, entity_type)
);
```

### 4.3 同步 API 设计

```python
# ==================== 同步 API ====================

# 核心原则：基于时间戳的增量同步 + 乐观锁冲突检测

# --- 全量拉取（首次登录 / 新设备）---
# GET /api/v1/sync/full
@router.get("/sync/full", response_model=FullSyncResponse)
async def full_sync(user: User = Depends(get_current_user)):
    """
    返回用户所有数据的最新快照。
    用于首次登录或 localStorage 丢失时的全量恢复。
    """
    return FullSyncResponse(
        learning_profile=...,
        flashcard_decks=[...],
        agenda_todos=[...],
        exam_configs=[...],
        highlights={material_id: [...]},
        sync_cursors={...},
    )

# --- 增量同步（常规使用）---
# POST /api/v1/sync/push
@router.post("/sync/push", response_model=SyncPushResponse)
async def sync_push(
    body: SyncPushRequest,
    user: User = Depends(get_current_user),
):
    """
    客户端推送本地变更到服务端。
    body: {
        changes: [
            { entity_type, entity_id, action: 'upsert'|'delete', data, client_updated_at },
            ...
        ]
    }
    返回: {
        accepted: [...],           # 成功写入的变更
        conflicts: [...],          # 冲突（服务端版本更新）
        server_changes: [...],     # 服务端有但客户端没有的变更
    }
    """
    ...

# GET /api/v1/sync/pull?since={timestamp}&entities=flashcards,todos
@router.get("/sync/pull", response_model=SyncPullResponse)
async def sync_pull(
    since: datetime,
    entities: str = "all",  # comma-separated
    user: User = Depends(get_current_user),
):
    """
    拉取自 since 以来的所有服务端变更。
    用于：应用恢复前台、定时轮询、WebSocket 断线重连。
    """
    ...

# --- 特定实体的 CRUD（直接操作，非批量同步）---
# 这些 API 每次操作后也更新 sync cursor

# POST /api/v1/flashcards/review   (记录复习结果)
# PUT  /api/v1/flashcards/{id}     (更新卡片状态)
# POST /api/v1/highlights          (新增批注)
# ...
```

### 4.4 冲突解决算法

```typescript
// ==================== 冲突解决策略 ====================

/**
 * 冲突解决采用「Last-Write-Wins + 实体级合并」策略。
 *
 * 为什么不用 CRDT：
 * - 智阶数据模型以替换为主（闪卡状态、学习画像），不是协同编辑
 * - CRDT 增加大量复杂度，ROI 不高
 * - LWW 对单用户多设备场景足够（同一时刻只在一个设备操作）
 *
 * 特殊处理：
 * - review_logs: 只追加，永不冲突
 * - flashcard_cards: FSRS 状态以最新 reviewed_at 为准（更近的复习数据更准确）
 * - highlights: 按 id 去重，同 id 取 updated_at 最新
 * - learning_profile: 整体替换，version 高的胜出
 */

type ConflictResolution = 'client_wins' | 'server_wins' | 'merge'

interface ConflictPolicy {
  'learning_profile': 'server_wins'     // version 高的胜出
  'flashcard_cards':  'latest_review'   // 最近复习的胜出
  'review_logs':      'append_only'     // 无冲突
  'agenda_todos':     'client_wins'     // 用户操作优先
  'highlights':       'client_wins'     // 用户操作优先
  'exam_configs':     'client_wins'     // 用户操作优先
}

// 冲突检测
interface SyncChange {
  entityType: string
  entityId: string
  action: 'upsert' | 'delete'
  data: unknown
  clientUpdatedAt: string   // ISO timestamp
  clientVersion?: number    // 乐观锁版本号（仅 learning_profile 用）
}

interface SyncConflict {
  entityType: string
  entityId: string
  clientData: unknown
  serverData: unknown
  resolution: ConflictResolution
  resolvedData: unknown     // 最终采用的数据
}
```

### 4.5 前端 SyncManager

```typescript
// src/lib/sync-manager.ts

class SyncManager {
  private syncInterval: number = 30_000  // 30 秒轮询
  private pendingChanges: SyncChange[] = []
  private isOnline: boolean = navigator.onLine
  private isSyncing: boolean = false

  constructor(private api: SyncApi) {
    // 监听网络状态
    window.addEventListener('online', () => this.onOnline())
    window.addEventListener('offline', () => this.onOffline())

    // 监听页面可见性（切回前台时同步）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.pull()
    })
  }

  /**
   * 记录本地变更（写 localStorage 后立即调用）。
   * 变更会缓存在 pending 队列，下次 push 时批量发送。
   */
  trackChange(change: Omit<SyncChange, 'clientUpdatedAt'>) {
    const fullChange = { ...change, clientUpdatedAt: new Date().toISOString() }
    this.pendingChanges.push(fullChange)
    this.savePendingToStorage()

    // 如果在线，延迟 2 秒 push（合并短时间内的多次操作）
    if (this.isOnline) {
      this.debouncedPush()
    }
  }

  /**
   * 推送本地变更到服务端
   */
  async push(): Promise<SyncPushResponse> {
    if (this.pendingChanges.length === 0 || this.isSyncing) return
    this.isSyncing = true

    try {
      const response = await this.api.push({ changes: this.pendingChanges })

      // 移除已接受的变更
      this.pendingChanges = this.pendingChanges.filter(
        c => !response.accepted.some(a => a.entityId === c.entityId)
      )

      // 处理冲突
      for (const conflict of response.conflicts) {
        this.resolveConflict(conflict)
      }

      // 应用服务端变更
      for (const change of response.serverChanges) {
        this.applyServerChange(change)
      }

      this.savePendingToStorage()
      return response
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * 拉取服务端变更
   */
  async pull(): Promise<void> {
    const cursor = this.getLastSyncTimestamp()
    const response = await this.api.pull(cursor)

    for (const change of response.changes) {
      this.applyServerChange(change)
    }

    this.setLastSyncTimestamp(response.syncTimestamp)
  }

  /**
   * 首次登录：全量拉取 → 写入 localStorage
   */
  async fullSync(): Promise<void> {
    const data = await this.api.fullSync()

    // 写入各个 localStorage key
    localStorage.setItem(STORAGE_KEYS.LEARNING_PROFILE, JSON.stringify(data.learningProfile))

    for (const deck of data.flashcardDecks) {
      localStorage.setItem(
        STORAGE_KEYS.FLASHCARDS(deck.courseId),
        JSON.stringify(deck)
      )
    }

    // ... 其他数据类型
    this.setLastSyncTimestamp(data.syncTimestamp)
  }

  // --- 私有方法 ---

  private onOnline() {
    this.isOnline = true
    this.push()  // 上线后立即推送积压变更
  }

  private onOffline() {
    this.isOnline = false
  }

  private resolveConflict(conflict: SyncConflict) {
    // 根据 ConflictPolicy 应用解决方案
    this.applyServerChange({
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      action: 'upsert',
      data: conflict.resolvedData,
    })
  }

  private applyServerChange(change: ServerChange) {
    // 根据 entityType 更新对应的 localStorage key
    switch (change.entityType) {
      case 'flashcard_card':
        // 更新对应 deck 中的卡片
        break
      case 'review_log':
        // 追加到本地 review logs
        break
      case 'highlight':
        // 更新对应材料的高亮
        break
      // ...
    }
  }

  private savePendingToStorage() {
    localStorage.setItem('zhijie_sync_pending', JSON.stringify(this.pendingChanges))
  }

  private debouncedPush = debounce(() => this.push(), 2000)
}
```

### 4.6 localStorage 到后端迁移方案

```
迁移分三个阶段执行：

Phase A: 双写（当前 → 目标）
─────────────────────────────
1. 保持 localStorage 为主存储
2. 用户登录后，SyncManager 初始化
3. 每次写 localStorage 时，同时 trackChange() 记录变更
4. 定期 push 变更到后端
5. 新设备登录 → fullSync() 从后端拉取 → 写入 localStorage
→ 此阶段 localStorage 仍是 source of truth

Phase B: 后端为主 + localStorage 缓存
─────────────────────────────
1. 读数据：先读 localStorage 缓存，后台 pull 最新数据
2. 写数据：先写后端（API），成功后更新 localStorage 缓存
3. 离线时：写入 localStorage + pending 队列，上线后 push
4. 登出时：清除 localStorage（下次登录重新 fullSync）
→ 此阶段后端是 source of truth，localStorage 是缓存 + 离线缓冲

Phase C: 移除 localStorage 直写（最终态）
─────────────────────────────
1. 所有数据操作通过 API
2. localStorage 仅作为性能缓存（TTL 机制）
3. 离线模式通过 IndexedDB 支持（容量更大）
4. Service Worker 处理离线请求队列
```

### 4.7 同步状态 UI

```typescript
// src/components/sync/SyncIndicator.tsx

interface SyncStatus {
  state: 'synced' | 'syncing' | 'pending' | 'offline' | 'error'
  pendingCount: number
  lastSyncAt: string | null
  error?: string
}

// 显示在 Header 右上角，小图标:
// - 绿色圆点: synced（已同步）
// - 旋转图标: syncing（同步中）
// - 黄色圆点 + 数字: pending（N 项待同步）
// - 灰色: offline（离线）
// - 红色: error（同步失败，点击重试）
```

---

## 附录：Docker Compose 总览

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: ./backend
    ports:
      - "8010:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://zhijie:${DB_PASSWORD}@db:5432/zhijie
      - REDIS_URL=redis://redis:6379/0
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
      - GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
    depends_on:
      - db
      - redis
      - minio

  db:
    image: pgvector/pgvector:pg16
    ports:
      - "5436:5432"
    environment:
      POSTGRES_DB: zhijie
      POSTGRES_USER: zhijie
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6383:6379"

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9010:9000"   # S3 API
      - "9011:9001"   # Console
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - miniodata:/data

volumes:
  pgdata:
  miniodata:
```

---

## 附录：后端项目结构

```
backend/
├── app/
│   ├── main.py                 # FastAPI app factory
│   ├── config.py               # Settings (pydantic-settings)
│   ├── database.py             # AsyncSession factory
│   │
│   ├── models/                 # SQLAlchemy ORM models
│   │   ├── user.py
│   │   ├── course.py
│   │   ├── material.py
│   │   ├── flashcard.py
│   │   └── sync.py
│   │
│   ├── schemas/                # Pydantic request/response schemas
│   │   ├── auth.py
│   │   ├── course.py
│   │   ├── material.py
│   │   ├── flashcard.py
│   │   └── sync.py
│   │
│   ├── api/                    # Route handlers
│   │   ├── auth.py
│   │   ├── courses.py
│   │   ├── materials.py
│   │   ├── flashcards.py
│   │   ├── sync.py
│   │   └── upload.py
│   │
│   ├── services/               # Business logic
│   │   ├── auth_service.py
│   │   ├── course_service.py
│   │   ├── upload_service.py
│   │   ├── sync_service.py
│   │   └── embedding_service.py
│   │
│   ├── core/                   # Cross-cutting concerns
│   │   ├── security.py         # JWT, argon2, OAuth
│   │   ├── deps.py             # FastAPI dependencies
│   │   ├── exceptions.py       # Custom exceptions
│   │   └── middleware.py       # CORS, rate limiting
│   │
│   └── tasks/                  # Background tasks (Celery / ARQ)
│       ├── thumbnail.py
│       ├── embedding.py
│       └── course_merge.py
│
├── migrations/                 # Alembic migrations
│   └── versions/
├── tests/
├── alembic.ini
├── Dockerfile
├── pyproject.toml
└── requirements.txt
```

---

## 附录：实施优先级

```
Week 1-2:  模块3 用户认证（其他模块都依赖 user_id）
  → users 表, auth API, AuthContext, ProtectedRoute

Week 3-4:  模块1 知识网络
  → courses/schools/enrollments 表, CRUD API, 搜索, 前端改造

Week 5-6:  模块2 文件上传
  → MinIO 部署, materials 表, 分片上传 API, 前端 DropZone 改造

Week 7-8:  模块4 跨设备同步
  → sync 表, SyncManager, 增量同步 API, 迁移到 Phase A
```

---

## Sources

- [Database Design for Online Learning Platform - GeeksforGeeks](https://www.geeksforgeeks.org/sql/how-to-design-a-database-for-online-learning-platform/)
- [Database Design for a Learning Management System - Red Gate](https://www.red-gate.com/blog/database-design-management-system/)
- [CourseKG: Educational Knowledge Graph for Precision Teaching](https://www.mdpi.com/2076-3417/14/7/2710)
- [Personalized Course Recommendation Fusing Knowledge Graph and Collaborative Filtering](https://pmc.ncbi.nlm.nih.gov/articles/PMC8487836/)
- [S3 Large File Uploader - FastAPI + React Chunked Upload](https://github.com/nicholasadamou/s3-large-file-uploader)
- [FastAPI MinIO Integration](https://medium.com/@mojimich2015/fastapi-minio-integration-31b35076afcb)
- [How to Handle File Uploads with FastAPI (2026)](https://oneuptime.com/blog/post/2026-02-02-fastapi-file-uploads/view)
- [Secure File Uploads with S3 Presigned URLs + React + FastAPI](https://medium.com/@sanmugamsanjai98/secure-file-uploads-made-simple-mastering-s3-presigned-urls-with-react-and-fastapi-258a8f874e97)
- [FastAPI OAuth2 + JWT Official Tutorial](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)
- [Securing FastAPI Endpoints with OAuth2 and JWT in 2025](https://medium.com/@bhagyarana80/securing-fastapi-endpoints-with-oauth2-and-jwt-in-2025-2c31bb14cb58)
- [Top 5 Authentication Solutions for FastAPI 2026 - WorkOS](https://workos.com/blog/top-authentication-solutions-fastapi-2026)
- [Authentication and Authorization with FastAPI - Better Stack](https://betterstack.com/community/guides/scaling-python/authentication-fastapi/)
- [React Router Protected Routes and Authentication](https://ui.dev/react-router-protected-routes-authentication)
- [JWT Authentication in React: Secure Routes, Context, Token Handling](https://www.syncfusion.com/blogs/post/implement-jwt-authentication-in-react)
- [PostgreSQL FTS vs Elasticsearch - Neon](https://neon.com/blog/postgres-full-text-search-vs-elasticsearch)
- [Postgres FTS vs Elasticsearch - Xata](https://xata.io/blog/postgres-full-text-search-postgres-vs-elasticsearch)
- [Offline-First Frontend Apps 2025: IndexedDB and SQLite - LogRocket](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)
- [Local-First: Storage, Sync, Conflicts - Evil Martians](https://evilmartians.com/chronicles/cool-front-end-arts-of-local-first-storage-sync-and-conflicts)
- [Mastering Local-First Apps: Offline-First with Cloud Sync](https://medium.com/@Mahdi_ramadhan/mastering-local-first-apps-the-ultimate-guide-to-offline-first-development-with-seamless-cloud-be656167f43f)
