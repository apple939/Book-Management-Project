process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');
const { db, resetDb, makeAgent, login, registerUser } = require('./helpers/test-utils');

beforeEach(() => {
  resetDb();
});

async function loginUser(agent, username, password) {
  await registerUser(agent, username, password);
  await login(agent, username, password);
}

test('TC_USER_001 修改个人信息成功', async () => {
  const user = makeAgent(app);
  await loginUser(user, 'prof1', '123456');
  const res = await user.post('/user/profile').type('form')
    .send({ realname: '王小明', email: 'wxm@example.com', phone: '13800138000' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('修改成功'));
  const row = db.prepare("SELECT realname, email, phone FROM users WHERE username = 'prof1'").get();
  assert.deepEqual(row, { realname: '王小明', email: 'wxm@example.com', phone: '13800138000' });
});

test('TC_USER_002 手机号非数字被拒', async () => {
  const user = makeAgent(app);
  await loginUser(user, 'prof2', '123456');
  const res = await user.post('/user/profile').type('form')
    .send({ realname: '', email: '', phone: 'abc' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('手机号格式不正确'));
});

test('TC_USER_004 修改密码成功后可用新密码登录', async () => {
  const user = makeAgent(app);
  await loginUser(user, 'pw1', '123456');
  const res = await user.post('/user/password').type('form')
    .send({ oldPassword: '123456', newPassword: 'newpass789', newPassword2: 'newpass789' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('密码修改成功'));

  const oldLogin = await login(makeAgent(app), 'pw1', '123456');
  assert.equal(oldLogin.status, 200, '旧密码应登录失败');
  const newLogin = await login(makeAgent(app), 'pw1', 'newpass789');
  assert.equal(newLogin.status, 302, '新密码应登录成功');
});

test('TC_USER_005 原密码错误被拒', async () => {
  const user = makeAgent(app);
  await loginUser(user, 'pw2', '123456');
  const res = await user.post('/user/password').type('form')
    .send({ oldPassword: 'wrongold', newPassword: 'newpass789', newPassword2: 'newpass789' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('原密码错误'));
});

test('TC_USER_006 新密码长度不足被拒', async () => {
  const user = makeAgent(app);
  await loginUser(user, 'pw3', '123456');
  const res = await user.post('/user/password').type('form')
    .send({ oldPassword: '123456', newPassword: '12345', newPassword2: '12345' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('新密码长度需在6-20位之间'));
});

test('TC_USER_007 两次新密码不一致被拒', async () => {
  const user = makeAgent(app);
  await loginUser(user, 'pw4', '123456');
  const res = await user.post('/user/password').type('form')
    .send({ oldPassword: '123456', newPassword: '123456', newPassword2: '654321' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('两次密码输入不一致'));
});

test('TC_USER_008 管理员查看用户列表', async () => {
  await registerUser(makeAgent(app), 'listed1', '123456');
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  const res = await admin.get('/user/list');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('listed1'));
  assert.ok(res.text.includes('admin'));
});

test('TC_USER_009/010 禁用后无法登录，启用后恢复', async () => {
  await registerUser(makeAgent(app), 'toggled1', '123456');
  const uid = db.prepare("SELECT id FROM users WHERE username = 'toggled1'").get().id;
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');

  const off = await admin.post(`/user/toggle/${uid}`);
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { ok: true, msg: '已禁用' });
  const denied = await login(makeAgent(app), 'toggled1', '123456');
  assert.ok(denied.text.includes('账号已被禁用'));

  const on = await admin.post(`/user/toggle/${uid}`);
  assert.deepEqual(on.body, { ok: true, msg: '已启用' });
  const ok = await login(makeAgent(app), 'toggled1', '123456');
  assert.equal(ok.status, 302);
});

test('TC_USER_011 不能禁用管理员账号', async () => {
  const admin = makeAgent(app);
  await login(admin, 'admin', 'admin123');
  const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  const res = await admin.post(`/user/toggle/${adminId}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.msg, '不能禁用管理员账号');
});

test('TC_USER_012 未登录访问个人信息重定向登录页', async () => {
  const res = await makeAgent(app).get('/user/profile');
  assert.equal(res.status, 302);
  assert.ok(res.headers.location.includes('/auth/login'));
});

test('普通用户访问用户管理列表被拒 403', async () => {
  const user = makeAgent(app);
  await loginUser(user, 'normal2', '123456');
  const res = await user.get('/user/list');
  assert.equal(res.status, 403);
});
