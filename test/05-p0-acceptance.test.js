process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { db, resetDb, makeAgent, login, registerUser, addBook } = require('./helpers/test-utils');
const app = require('../app');

const RED = process.env.RED_TESTS === '1';
const skipWhen = (g) => (RED ? false : `第2批 ${g} 修复后解锁`);

beforeEach(() => {
  resetDb();
});

async function loginAdmin() {
  const agent = makeAgent(app);
  await login(agent, 'admin', 'admin123');
  return agent;
}

test('R1 [G01] 新注册用户的密码应为 bcrypt 哈希而非明文', { skip: skipWhen('G01') }, async () => {
  await registerUser(makeAgent(app), 'r1user', 'plainpass123');
  const row = db.prepare("SELECT password FROM users WHERE username = 'r1user'").get();
  assert.ok(row, '用户应已注册');
  assert.match(row.password, /^\$2[aby]\$/, `密码应为 bcrypt 哈希，实际为: ${row.password}`);
});

test('R2 [G01] 预置 admin 账号密码应为 bcrypt 哈希', { skip: skipWhen('G01') }, async () => {
  const row = db.prepare("SELECT password FROM users WHERE username = 'admin'").get();
  assert.match(row.password, /^\$2[aby]\$/, `admin 密码应为 bcrypt 哈希，实际为: ${row.password}`);
});

test('R3 [G02] 借书应还日期为本地时间+30天（非 UTC）', { skip: skipWhen('G02') }, async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '时区书', author: '作者Z', total_count: '1' });
  const book = db.prepare("SELECT id FROM books WHERE title = '时区书'").get();

  const user = makeAgent(app);
  await registerUser(user, 'tzuser', '123456');
  await login(user, 'tzuser', '123456');
  const before = Date.now();
  const res = await user.post(`/borrow/borrow/${book.id}`);
  assert.ok(res.body.ok, '借书应成功');
  const after = Date.now();

  const rec = db.prepare('SELECT due_date FROM borrow_records WHERE book_id = ?').get(book.id);
  const dueMs = new Date(rec.due_date.replace(' ', 'T')).getTime();
  const expectedMs = (before + after) / 2 + 30 * 86400000;
  const diff = Math.abs(dueMs - expectedMs);
  assert.ok(diff <= 5000, `应还日期应为本地时间+30天，实测偏差 ${diff}ms（疑似 UTC 截断导致约 8 小时偏差）`);
});

test('R4 [G03] borrow_records 应存在防重复借的部分唯一索引', { skip: skipWhen('G03') }, async () => {
  const indexes = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'borrow_records'"
  ).all();
  const hasPartialUnique = indexes.some(
    (i) => /unique/i.test(i.sql) && i.sql.includes("status = 'borrowed'") && i.sql.includes('user_id') && i.sql.includes('book_id')
  );
  assert.ok(hasPartialUnique, `缺少 (user_id, book_id) WHERE status='borrowed' 的部分唯一索引，现有索引: ${JSON.stringify(indexes)}`);
});

test('R5 [G04] 入库数量为负数应被拒绝且不产生脏数据', { skip: skipWhen('G04') }, async () => {
  const admin = await loginAdmin();
  const res = await addBook(admin, { title: '负数书', author: '作者Y', total_count: '-5' });
  assert.notEqual(res.status, 302, '负数数量不应新增成功（不应 302 跳转）');
  assert.ok(res.text.includes('数量'), '应提示数量非法');
  const row = db.prepare("SELECT * FROM books WHERE title = '负数书'").get();
  assert.equal(row, undefined, '不应产生脏数据');
});

test('R6 [G23] 登录后首页应渲染 layout 外壳（完整 HTML/Bootstrap/导航/用户名）', { skip: skipWhen('G23') }, async () => {
  const agent = makeAgent(app);
  await login(agent, 'admin', 'admin123');
  const res = await agent.get('/');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('<!DOCTYPE html>'), '页面应为完整 HTML 文档（当前缺失 layout 外壳）');
  assert.ok(res.text.includes('bootstrap'), '页面应引用 Bootstrap 样式');
  assert.ok(res.text.includes('navbar'), '页面应包含导航栏');
  assert.ok(res.text.includes('系统管理员'), '导航栏应显示登录用户姓名');
});

test('R7 [G24] 无借阅记录的用户访问 /borrow 应返回 200 而非 500', { skip: skipWhen('G24') }, async () => {
  const user = makeAgent(app);
  await registerUser(user, 'emptyborrow', '123456');
  await login(user, 'emptyborrow', '123456');
  const res = await user.get('/borrow');
  assert.equal(res.status, 200, `空记录列表不应 500，实际状态 ${res.status}`);
  assert.ok(res.text.includes('借阅记录'), '应正常渲染借阅记录页');
});

test('隔离防线：测试进程使用的数据库不是生产 bookmanager.db', async () => {
  const dbName = String(db.name || '');
  assert.ok(!dbName.includes('bookmanager.db'), `测试不得使用生产库，实际 db.name: ${dbName}`);
});

test('并发验收 [G03] 库存 1 的书 20 个并发借阅仅成功 1 次且库存不为负', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '并发书', author: '作者X', total_count: '1' });
  const book = db.prepare("SELECT id FROM books WHERE title = '并发书'").get();

  const user = makeAgent(app);
  await registerUser(user, 'concurrent', '123456');
  await login(user, 'concurrent', '123456');

  const results = await Promise.all(
    Array.from({ length: 20 }, () => user.post(`/borrow/borrow/${book.id}`))
  );
  const okCount = results.filter((r) => r.body && r.body.ok === true).length;
  assert.equal(okCount, 1, '20 个并发借阅应恰好成功 1 次');

  const row = db.prepare('SELECT remain_count FROM books WHERE id = ?').get(book.id);
  assert.ok(row.remain_count >= 0, '库存不应为负');
  assert.equal(row.remain_count, 0);
  const recs = db.prepare("SELECT COUNT(*) AS c FROM borrow_records WHERE book_id = ? AND status = 'borrowed'").get(book.id);
  assert.equal(recs.c, 1, '借阅中记录应恰好 1 条');
});
