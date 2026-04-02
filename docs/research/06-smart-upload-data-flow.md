# 智能批量上传 + 课程云空间 + 数据流动架构

> 设计日期：2026-03-18
> 需求来源：用户实际课程文件夹结构分析（TUM Database课程）

## 核心设计决策

### 1. 数据流动策略
```
原始PDF → MinIO临时桶(TTL=30天) → 分析管道 → 结构化知识(永久存DB+S3)
                                              ├── Specialist Markdown
                                              ├── Quiz Data
                                              └── Flashcard Notes
```
**服务器只永久存储AI生成的结构化知识，不永久存储用户上传的原始PDF。**

### 2. 文件分类体系（8类）
| 类型 | 中文 | 适用场景 |
|------|------|---------|
| lecture | 课件 | PPT/PDF课件 |
| textbook | 教材 | 完整教材或章节 |
| notes | 笔记 | 个人笔记、思维导图 |
| exercise | 习题 | 作业、练习题 |
| exam | 考题 | 往年试卷、模拟卷 |
| project | 项目 | 课程项目 |
| reference | 参考 | 参考资料、安装指南 |
| other | 其他 | 无法归类 |

### 3. AI分类策略（三层推断）
- **Layer 1**: 前端规则引擎（文件夹名+文件名+扩展名，零延迟，覆盖80%）
- **Layer 2**: 后端LLM辅助（仅低置信度文件，一次调用处理整批）
- **Layer 3**: 用户拖拽调整（最终权威）

### 4. 上传流程（5步状态机）
```
idle → scanning(扫描文件夹) → classifying(AI分类) → reviewing(用户审核) → uploading(批量上传) → done
```

### 5. MinIO双桶架构
- `zhijie-uploads`：临时桶，30天TTL自动清理
- `zhijie-knowledge`：永久桶，存放Specialist Markdown等生成内容

### 6. 需要原始PDF的场景
- PDF批注阅读 → 30天内可用，过期提示重新上传
- 工作台默认展示Specialist Markdown，PDF阅读器为可选Tab

## 实施计划
- Phase 0: 数据库迁移（1-2天）
- Phase 1: 文件夹扫描+规则分类器（2-3天）
- Phase 2: 分类预览+拖拽调整UI（3-4天）
- Phase 3: 批量上传+管道触发（2-3天）
- Phase 4: 课程云空间UI（3-4天）
- Phase 5: 数据清理+监控（1-2天）

## 完整方案
详见 agent 输出的完整设计文档（含ASCII art UI草图、数据库模型、API设计、组件架构）。
