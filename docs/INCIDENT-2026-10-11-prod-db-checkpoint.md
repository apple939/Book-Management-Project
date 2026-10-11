# 事件记录：测试触碰生产 bookmanager.db（2026-10-11）

- 时间：2026-10-11 18:48（首次全量 npm test 期间）
- 现象：bookmanager.db 4096B → 36864B，-wal/-shm 文件被清除
- 根因：node --test 默认发现规则把 test/helpers/test-utils.js 当测试文件独立执行，
  其顶部当时未设置 DB_PATH，require database.js 打开生产库；连接关闭时 SQLite
  自动 checkpoint 将 WAL 已提交数据合并进主库并清理 WAL 文件
- 影响：主库文件被改写；WAL 均为已提交数据，业务数据未丢失（只读核对：users=1、
  categories=8、books=0、borrow_records=0、system_logs=0，零异常）
- 修复：
  1. package.json test 脚本改为显式 glob：node --test "test/**/*.test.js"
  2. test/helpers/test-utils.js 顶部加硬防线：DB_PATH 未设置或指向生产库时 throw
  3. database.js：NODE_ENV=test 且 DB_PATH 缺失/指向生产库时 console.warn
  4. 新增回归测试断言测试进程 db 非生产库
  5. 测试文件 require 顺序调整为 helpers 先于 app，确保防线早于数据库打开
- 备份：项目外临时目录（bookmanager.db.bak.20261011-202819），未提交 git
- 教训：任何会执行测试代码的入口都必须在打开数据库前完成隔离校验；
  对生产库的操作（含只读打开）必须显式声明并征得同意
