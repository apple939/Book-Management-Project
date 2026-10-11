# 图书管理系统（BooksManagement）

基于 Node.js + Express 5 + SQLite 的图书借阅管理 Web 应用（服务端渲染，EJS + Bootstrap 5 CDN），面向图书馆管理员与普通读者，覆盖注册登录、图书档案、查询检索、借阅归还、用户管理等流程。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js（CommonJS） |
| Web 框架 | Express ^5.2.1 |
| 模板引擎 | EJS ^6.0.1（layout 统一外壳 + 白名单 include） |
| 数据库 | SQLite（better-sqlite3 ^13.0.3，WAL 模式） |
| 会话 | express-session（内存存储，secret 支持环境变量） |
| 密码 | bcryptjs ^3.0.3（rounds=10，旧明文登录自动透明升级） |
| 验证码 | svg-captcha |
| 前端 | Bootstrap 5.3 + Bootstrap Icons（bootcdn CDN） |
| 测试 | node:test + supertest |

## 功能列表

- 登录注册：图形验证码、连续 5 次失败锁定 30 分钟、账号禁用、注册校验
- 图书档案：新增/修改/逻辑删除（有借阅记录禁删）、详情、ISBN/书名/作者/出版社/分类/数量/简介
- 查询检索：关键词（书名/作者/ISBN）+ 分类筛选 + 分页，首页最新 12 本
- 借阅归还：借期 30 天、防重复借、逾期禁借、逾期提醒（含逾期天数）、管理员代还
- 用户管理：个人信息、改密（验原密码）、管理员启用/禁用用户
- 审计日志：system_logs 记录登录/借还/管理操作（暂无查询界面，见已知问题）
- 预置分类：8 个图书分类

## 安装与运行

```bash
npm install
npm start        # 默认 http://localhost:3000
```

环境变量（均可选，详见 `.env.example`）：

| 变量 | 说明 |
|---|---|
| `SESSION_SECRET` | 会话签名密钥；未设置时每次启动随机生成（内存会话重启即失效，无副作用） |
| `DB_PATH` | 数据库路径；默认 `bookmanager.db`（测试框架使用 `:memory:`） |

数据库迁移（轻量版）：

```bash
npm run migrate  # 基于 migrations/ 目录 + schema_version 表，幂等可重跑
```

## 默认账号

- 管理员：`admin` / `admin123`（首次初始化时由 `database.js` 预置，登录后请立即通过"修改密码"更换）

## 目录结构

```
app.js               # Express 入口（导出 app，require.main 时才 listen）
database.js          # SQLite 连接、建表、种子数据
lib/password.js      # bcrypt 校验/哈希（含旧明文透明升级）
routes/              # auth / books / borrow / user 四个路由模块
views/               # EJS 视图（layout.ejs 统一外壳）
migrations/          # 迁移脚本 + migrate.js
test/                # node:test 测试（5 个模块回归 + 06-layout 抽样 + helpers）
docs/                # 事件记录
需求文档.md / 测试用例模板.csv   # 原始需求与手工测试用例
```

## 测试

```bash
npm test            # 82 条测试，全部使用 :memory: 内存库，不触碰生产 db
```

- 测试隔离硬防线：`test/helpers/test-utils.js` 强制要求 `DB_PATH` 且禁止指向生产 `bookmanager.db`，否则直接抛错终止。
- `RED_TESTS=1` 环境变量可解锁红灯工作流（当前无红灯测试）。

## 已知问题 / 后续计划

> 以下为审计后明确推迟或砍掉的项（教学项目单机场景权衡），详见 git 历史与 docs/。

- **G03**（已砍）：借书/还书未用事务包裹、borrow_records 无防重复借唯一索引；单进程同步 SQLite 下竞态窗口极小，多实例部署前必须补做
- **G05**：逻辑删除（status=0）后，图书列表/详情页未过滤已删记录（首页有过滤）
- **G06**：全部 POST 接口无 CSRF 防护；删除图书仍为 GET 请求
- **G08/G09**：登录无 IP 限流（可被故意锁号 DoS）；注册无验证码/频率限制
- **G10**：借期 30 天硬编码，无单用户借阅上限、无续借/预约/罚款
- **G11**：system_logs 只有写入，无管理员查询界面
- **G12**：编辑不存在的图书会 500；无全局错误处理中间件
- **G13**：会话存内存，重启全站登出
- **G14**：迁移机制为轻量版（schema_version + 编号脚本），无自动备份
- **G15**：books/borrow_records/users 无索引，数据量大后 LIKE 查询全表扫描
- **G16**：分页 page 参数可为负数导致 SQLite OFFSET 报错
- **G17**：手机号校验宽松（0-11 位数字即可）、邮箱无后端格式校验
- **G18**：未使用 helmet 等安全响应头
- **G19**：requireLogin/requireAdmin 在 4 个路由文件重复定义
- **G21**：Bootstrap 走 CDN（bootcdn.net），断网时页面无样式
- **G22**：删除有借阅图书的提示用 `res.send('<script>alert(...)')` 实现
- 依赖审计：npm audit 报告 2 个传递依赖漏洞（1 moderate / 1 critical），待评估升级
- 历史问题（已修复）：布局模板 layout.ejs 曾为孤儿文件，此前所有页面无统一布局与导航（2026-10 审计后修复）

## License

[MIT](LICENSE)
