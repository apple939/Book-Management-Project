process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { db, resetDb, makeAgent, login, registerUser, addBook, formatLocalDateTime } = require('./helpers/test-utils');
const app = require('../app');

beforeEach(() => {
  resetDb();
});

async function loginUser(agent, username, password) {
  await registerUser(agent, username, password);
  await login(agent, username, password);
}

test('TC_BORROW_001 正常借书成功且库存减一', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '可借书', author: '作者A', total_count: '2' });
  const book = db.prepare("SELECT id FROM books WHERE title = '可借书'").get();

  const user = makeAgent(app);
  await loginUser(user, 'reader1', '123456');
  const res = await user.post(`/borrow/borrow/${book.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, msg: '借阅成功' });
  const row = db.prepare('SELECT remain_count FROM books WHERE id = ?').get(book.id);
  assert.equal(row.remain_count, 1);
  const rec = db.prepare("SELECT * FROM borrow_records WHERE book_id = ? AND status = 'borrowed'").get(book.id);
  assert.ok(rec, '应产生借阅记录');
  assert.ok(rec.due_date, '应有应还日期');
});

test('TC_BORROW_002 无库存图书不可借', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '无库存书', author: '作者B', total_count: '1' });
  const book = db.prepare("SELECT id FROM books WHERE title = '无库存书'").get();

  const u1 = makeAgent(app);
  await loginUser(u1, 'readerA', '123456');
  await u1.post(`/borrow/borrow/${book.id}`);

  const u2 = makeAgent(app);
  await loginUser(u2, 'readerB', '123456');
  const res = await u2.post(`/borrow/borrow/${book.id}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.msg, '该书已全部借出');
});

test('TC_BORROW_003 重复借同一本书被拒', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '重复借书', author: '作者C', total_count: '5' });
  const book = db.prepare("SELECT id FROM books WHERE title = '重复借书'").get();

  const user = makeAgent(app);
  await loginUser(user, 'reader2', '123456');
  const first = await user.post(`/borrow/borrow/${book.id}`);
  assert.ok(first.body.ok);
  const second = await user.post(`/borrow/borrow/${book.id}`);
  assert.equal(second.status, 400);
  assert.equal(second.body.msg, '您已借过该书，请先归还');
});

test('TC_BORROW_004 有逾期未还记录禁止再借', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '新书A', author: '作者D', total_count: '2' });
  await addBook(admin, { title: '旧书B', author: '作者E', total_count: '2' });
  const bookA = db.prepare("SELECT id FROM books WHERE title = '新书A'").get();
  const bookB = db.prepare("SELECT id FROM books WHERE title = '旧书B'").get();

  const user = makeAgent(app);
  await loginUser(user, 'reader3', '123456');
  const uid = db.prepare("SELECT id FROM users WHERE username = 'reader3'").get().id;
  const due = formatLocalDateTime(new Date(Date.now() - 4 * 86400000 - 3600000));
  db.prepare("INSERT INTO borrow_records (user_id, book_id, due_date) VALUES (?, ?, ?)").run(uid, bookB.id, due);

  const res = await user.post(`/borrow/borrow/${bookA.id}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.msg, '您有逾期未还的图书，请先归还后再借');
});

test('TC_BORROW_005 正常归还且库存加一', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '归还书', author: '作者F', total_count: '1' });
  const book = db.prepare("SELECT id FROM books WHERE title = '归还书'").get();

  const user = makeAgent(app);
  await loginUser(user, 'reader4', '123456');
  await user.post(`/borrow/borrow/${book.id}`);
  const rec = db.prepare("SELECT id FROM borrow_records WHERE book_id = ?").get(book.id);

  const res = await user.post(`/borrow/return/${rec.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, msg: '归还成功' });
  const row = db.prepare('SELECT remain_count FROM books WHERE id = ?').get(book.id);
  assert.equal(row.remain_count, 1);
  const updated = db.prepare('SELECT status, return_date FROM borrow_records WHERE id = ?').get(rec.id);
  assert.equal(updated.status, 'returned');
  assert.ok(updated.return_date);
});

test('TC_BORROW_006 重复归还被拒', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '重复还书', author: '作者G', total_count: '1' });
  const book = db.prepare("SELECT id FROM books WHERE title = '重复还书'").get();

  const user = makeAgent(app);
  await loginUser(user, 'reader5', '123456');
  await user.post(`/borrow/borrow/${book.id}`);
  const rec = db.prepare("SELECT id FROM borrow_records WHERE book_id = ?").get(book.id);
  await user.post(`/borrow/return/${rec.id}`);
  const res = await user.post(`/borrow/return/${rec.id}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.msg, '该书已归还');
});

test('TC_BORROW_007 管理员可代任何用户还书', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '代还书', author: '作者H', total_count: '1' });
  const book = db.prepare("SELECT id FROM books WHERE title = '代还书'").get();

  const user = makeAgent(app);
  await loginUser(user, 'reader6', '123456');
  await user.post(`/borrow/borrow/${book.id}`);
  const rec = db.prepare("SELECT id FROM borrow_records WHERE book_id = ?").get(book.id);

  const res = await admin.post(`/borrow/return/${rec.id}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
});

test('TC_BORROW_008 借阅记录状态筛选', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '筛选书', author: '作者I', total_count: '2' });
  await addBook(admin, { title: '筛选书2', author: '作者J', total_count: '2' });
  const book1 = db.prepare("SELECT id FROM books WHERE title = '筛选书'").get();
  const book2 = db.prepare("SELECT id FROM books WHERE title = '筛选书2'").get();

  const user = makeAgent(app);
  await loginUser(user, 'reader7', '123456');
  await user.post(`/borrow/borrow/${book1.id}`);
  await user.post(`/borrow/borrow/${book2.id}`);
  const rec = db.prepare("SELECT id FROM borrow_records WHERE book_id = ?").get(book1.id);
  await user.post(`/borrow/return/${rec.id}`);

  const borrowed = await user.get('/borrow?status=borrowed');
  assert.ok(borrowed.text.includes('筛选书2'));
  assert.ok(!borrowed.text.includes('筛选书<'));
  const returned = await user.get('/borrow?status=returned');
  assert.ok(returned.text.includes('筛选书'));
});

test('TC_BORROW_009 逾期提醒页显示逾期天数', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '逾期书', author: '作者K', total_count: '1' });
  const book = db.prepare("SELECT id FROM books WHERE title = '逾期书'").get();

  const user = makeAgent(app);
  await loginUser(user, 'reader8', '123456');
  const uid = db.prepare("SELECT id FROM users WHERE username = 'reader8'").get().id;
  const due = formatLocalDateTime(new Date(Date.now() - 4 * 86400000 - 3600000));
  db.prepare("INSERT INTO borrow_records (user_id, book_id, due_date) VALUES (?, ?, ?)").run(uid, book.id, due);

  const res = await user.get('/borrow/overdue');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('逾期书'));
  assert.ok(res.text.includes('4 天'), '应显示逾期 4 天');
});

test('TC_BORROW_010 无逾期时显示空提示', async () => {
  const user = makeAgent(app);
  await loginUser(user, 'reader9', '123456');
  const res = await user.get('/borrow/overdue');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('没有逾期记录'));
});

test('TC_BORROW_011 未登录用户看不到借阅按钮且接口被重定向', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '未登录书', author: '作者L', total_count: '1' });
  const book = db.prepare("SELECT id FROM books WHERE title = '未登录书'").get();

  const anon = makeAgent(app);
  const list = await anon.get('/books');
  assert.equal(list.status, 200);
  assert.ok(!list.text.includes('borrowBook('), '未登录不应显示借阅按钮');
  const res = await anon.post(`/borrow/borrow/${book.id}`);
  assert.equal(res.status, 302);
  assert.ok(res.headers.location.includes('/auth/login'));
});

test('借阅记录列表：普通用户只能看到自己的记录', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  await addBook(admin, { title: '隐私书', author: '作者M', total_count: '2' });
  await addBook(admin, { title: '自有书', author: '作者N', total_count: '2' });

  const u1 = makeAgent(app);
  await loginUser(u1, 'userA', '123456');
  await u1.post(`/borrow/borrow/${db.prepare("SELECT id FROM books WHERE title = '隐私书'").get().id}`);

  const u2 = makeAgent(app);
  await loginUser(u2, 'userB', '123456');
  await u2.post(`/borrow/borrow/${db.prepare("SELECT id FROM books WHERE title = '自有书'").get().id}`);

  const res = await u2.get('/borrow');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('自有书'), '应看到自己的借阅记录');
  assert.ok(!res.text.includes('userA'), '不应出现他人用户名');
  assert.ok(!res.text.includes('隐私书'), '不应看到他人借阅的书');
});
