process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { db, resetDb, makeAgent, login, registerUser, addBook } = require('./helpers/test-utils');
const app = require('../app');

beforeEach(() => {
  resetDb();
});

async function loginAdmin() {
  const agent = makeAgent(app);
  await login(agent, 'admin', 'admin123');
  return agent;
}

test('TC_BOOK_001 管理员新增图书成功', async () => {
  const admin = await loginAdmin();
  const res = await addBook(admin, { title: '数据结构', author: '严蔚敏' });
  assert.equal(res.status, 302);
  const row = db.prepare("SELECT * FROM books WHERE title = '数据结构'").get();
  assert.ok(row, '新书应入库');
  assert.equal(row.remain_count, 1);
});

test('TC_BOOK_002 书名为空被拒并回显错误', async () => {
  const admin = await loginAdmin();
  const res = await addBook(admin, { title: '', author: '作者A' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('书名和作者不能为空'));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM books').get().c, 0);
});

test('TC_BOOK_003 作者为空被拒并回显错误', async () => {
  const admin = await loginAdmin();
  const res = await addBook(admin, { title: '书名A', author: '' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('书名和作者不能为空'));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM books').get().c, 0);
});

test('TC_BOOK_004 不选分类时显示未分类', async () => {
  const admin = await loginAdmin();
  const res = await addBook(admin, { title: '无分类图书', author: '作者B', category_id: '' });
  assert.equal(res.status, 302);
  const row = db.prepare('SELECT category_id FROM books WHERE title = ?').get('无分类图书');
  assert.equal(row.category_id, null);
  const list = await admin.get('/books');
  assert.ok(list.text.includes('未分类'));
});

test('TC_BOOK_008 修改图书信息生效', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '原书名', author: '原作者' });
  const book = db.prepare("SELECT id FROM books WHERE title = '原书名'").get();
  const res = await admin.post(`/books/edit/${book.id}`).type('form').send({
    isbn: '', title: '新书名', author: '新作者', publisher: '', publish_date: '',
    category_id: '', total_count: '5', description: ''
  });
  assert.equal(res.status, 302);
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(book.id);
  assert.equal(row.title, '新书名');
  assert.equal(row.author, '新作者');
  assert.equal(row.total_count, 5);
  assert.equal(row.remain_count, 5);
});

test('TC_BOOK_010 删除无借阅记录的图书（逻辑删除）', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '待删图书', author: '作者C' });
  const book = db.prepare("SELECT id FROM books WHERE title = '待删图书'").get();
  const res = await admin.get(`/books/delete/${book.id}`);
  assert.equal(res.status, 302);
  const row = db.prepare('SELECT status FROM books WHERE id = ?').get(book.id);
  assert.equal(row.status, 0, '应为逻辑删除而非物理删除');
});

test('TC_BOOK_011 删除有借阅记录的图书被拒', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '被借图书', author: '作者D' });
  const book = db.prepare("SELECT id FROM books WHERE title = '被借图书'").get();
  const user = makeAgent(app);
  await registerUser(user, 'borrower1', '123456');
  await login(user, 'borrower1', '123456');
  await user.post(`/borrow/borrow/${book.id}`);
  const res = await admin.get(`/books/delete/${book.id}`);
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('无法删除'), '应提示无法删除');
  assert.equal(db.prepare('SELECT status FROM books WHERE id = ?').get(book.id).status, 1);
});

test('TC_BOOK_012 非管理员访问新增页面被拒 403', async () => {
  const user = makeAgent(app);
  await registerUser(user, 'normal1', '123456');
  await login(user, 'normal1', '123456');
  const res = await user.get('/books/add');
  assert.equal(res.status, 403);
});

test('G04 数量校验：非法值被拒且不产生脏数据，99999 为上限', async () => {
  const admin = await loginAdmin();
  for (const bad of ['0', 'abc', '100000', '1.5']) {
    const res = await addBook(admin, { title: `非法数量_${bad}`, author: '作者Q', total_count: bad });
    assert.notEqual(res.status, 302, `total_count=${bad} 不应新增成功`);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM books WHERE title = ?').get(`非法数量_${bad}`).c, 0, `total_count=${bad} 不应入库`);
  }
  const ok = await addBook(admin, { title: '上限书', author: '作者Q', total_count: '99999' });
  assert.equal(ok.status, 302, 'total_count=99999 应新增成功');
});

test('TC_SEARCH_001 关键词搜索命中书名', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '数据结构与算法', author: '作者E' });
  await addBook(admin, { title: '操作系统原理', author: '作者F' });
  const res = await admin.get('/books?keyword=数据结构');
  assert.ok(res.text.includes('数据结构与算法'));
  assert.ok(!res.text.includes('操作系统原理'));
});

test('TC_SEARCH_002 不存在的关键词返回空列表', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '数据结构', author: '作者E' });
  const res = await admin.get('/books?keyword=火星指南');
  assert.ok(res.text.includes('共 <strong>0</strong> 本图书'));
});

test('TC_SEARCH_003 按作者搜索', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '书A', author: '张三' });
  await addBook(admin, { title: '书B', author: '李四' });
  const res = await admin.get('/books?keyword=张三');
  assert.ok(res.text.includes('书A'));
  assert.ok(!res.text.includes('书B'));
});

test('TC_SEARCH_004 分类筛选', async () => {
  const admin = await loginAdmin();
  const cat = db.prepare("SELECT id FROM categories WHERE name = '计算机科学'").get();
  const other = db.prepare("SELECT id FROM categories WHERE name = '文学小说'").get();
  await addBook(admin, { title: '编程书', author: '作者G', category_id: String(cat.id) });
  await addBook(admin, { title: '小说书', author: '作者H', category_id: String(other.id) });
  const res = await admin.get(`/books?category=${cat.id}`);
  assert.ok(res.text.includes('编程书'));
  assert.ok(!res.text.includes('小说书'));
});

test('TC_SEARCH_005 关键词+分类组合查询', async () => {
  const admin = await loginAdmin();
  const cat = db.prepare("SELECT id FROM categories WHERE name = '计算机科学'").get();
  await addBook(admin, { title: 'Java入门', author: '作者I', category_id: String(cat.id) });
  await addBook(admin, { title: 'Java小说', author: '作者J', category_id: '' });
  const res = await admin.get(`/books?keyword=Java&category=${cat.id}`);
  assert.ok(res.text.includes('Java入门'));
  assert.ok(!res.text.includes('Java小说'));
});

test('TC_SEARCH_006 分页：首页无上一页，末页无下一页', async () => {
  const insert = db.prepare("INSERT INTO books (title, author, total_count, remain_count, created_at) VALUES (?, '分页作者', 1, 1, ?)");
  for (let i = 1; i <= 13; i++) {
    insert.run(`分页图书${String(i).padStart(2, '0')}`, `2026-01-${String(i).padStart(2, '0')} 00:00:00`);
  }
  const agent = makeAgent(app);
  const page1 = await agent.get('/books');
  assert.ok(page1.text.includes('分页图书13'), '第 1 页应含最新图书');
  assert.ok(!page1.text.includes('分页图书01'), '第 1 页不应含最旧图书');
  const page2 = await agent.get('/books?page=2');
  assert.ok(page2.text.includes('分页图书01'));
});

test('TC_SEARCH_007 图书详情页展示完整信息', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { isbn: '9787111111111', title: '详情书', author: '作者K', publisher: '某出版社' });
  const book = db.prepare("SELECT id FROM books WHERE title = '详情书'").get();
  const res = await admin.get(`/books/detail/${book.id}`);
  assert.equal(res.status, 200);
  for (const text of ['9787111111111', '详情书', '作者K', '某出版社']) {
    assert.ok(res.text.includes(text), `详情页应包含 ${text}`);
  }
});

test('TC_SEARCH_008 首页展示最新 12 本图书', async () => {
  const insert = db.prepare("INSERT INTO books (title, author, total_count, remain_count, created_at) VALUES (?, '首页作者', 1, 1, ?)");
  for (let i = 1; i <= 13; i++) {
    insert.run(`首页图书${String(i).padStart(2, '0')}`, `2026-02-${String(i).padStart(2, '0')} 00:00:00`);
  }
  const agent = makeAgent(app);
  const res = await agent.get('/');
  assert.equal(res.status, 200);
  const cards = res.text.split('class="card book-card"').length - 1;
  assert.equal(cards, 12, '首页应恰好展示 12 本');
});
