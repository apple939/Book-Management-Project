process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { db, resetDb, makeAgent, login, registerUser, addBook } = require('./helpers/test-utils');
const app = require('../app');

beforeEach(() => {
  resetDb();
});

function assertLayout(text, pageName) {
  assert.ok(text.includes('<!DOCTYPE html>'), `${pageName} 应输出完整 HTML 文档`);
  assert.ok(text.includes('navbar'), `${pageName} 应包含导航栏`);
  assert.ok(text.includes('bootstrap'), `${pageName} 应引用 Bootstrap 样式`);
}

async function loginAdmin() {
  const agent = makeAgent(app);
  await login(agent, 'admin', 'admin123');
  return agent;
}

test('G23 抽样：index 未登录态渲染 layout', async () => {
  const res = await makeAgent(app).get('/');
  assert.equal(res.status, 200);
  assertLayout(res.text, 'index');
  assert.ok(res.text.includes('最新图书'), '应包含页面内容');
});

test('G23 抽样：login 页渲染 layout', async () => {
  const res = await makeAgent(app).get('/auth/login');
  assert.equal(res.status, 200);
  assertLayout(res.text, 'login');
  assert.ok(res.text.includes('图书管理系统登录'));
});

test('G23 抽样：books/list 渲染 layout', async () => {
  const res = await makeAgent(app).get('/books');
  assert.equal(res.status, 200);
  assertLayout(res.text, 'books/list');
  assert.ok(res.text.includes('图书列表'));
});

test('G23 抽样：books/detail 渲染 layout', async () => {
  const admin = await loginAdmin();
  await addBook(admin, { title: '布局详情书', author: '作者R' });
  const book = db.prepare("SELECT id FROM books WHERE title = '布局详情书'").get();
  const res = await makeAgent(app).get(`/books/detail/${book.id}`);
  assert.equal(res.status, 200);
  assertLayout(res.text, 'books/detail');
  assert.ok(res.text.includes('布局详情书'));
});

test('G23 抽样：borrow/list 登录态渲染 layout', async () => {
  const user = makeAgent(app);
  await registerUser(user, 'layoutuser', '123456');
  await login(user, 'layoutuser', '123456');
  const res = await user.get('/borrow');
  assert.equal(res.status, 200);
  assertLayout(res.text, 'borrow/list');
  assert.ok(res.text.includes('借阅记录'));
});

test('G23 抽样：user/list 管理员渲染 layout', async () => {
  const admin = await loginAdmin();
  const res = await admin.get('/user/list');
  assert.equal(res.status, 200);
  assertLayout(res.text, 'user/list');
  assert.ok(res.text.includes('用户管理'));
});

test('G23 抽样：user/profile 登录态渲染 layout', async () => {
  const user = makeAgent(app);
  await registerUser(user, 'profileuser', '123456');
  await login(user, 'profileuser', '123456');
  const res = await user.get('/user/profile');
  assert.equal(res.status, 200);
  assertLayout(res.text, 'user/profile');
  assert.ok(res.text.includes('个人信息'));
});
