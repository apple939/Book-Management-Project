process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { db, resetDb, makeAgent, login, registerUser } = require('./helpers/test-utils');
const app = require('../app');

beforeEach(() => {
  resetDb();
});

test('TC_LOGIN_001 正确账号密码登录成功并跳转首页', async () => {
  const agent = makeAgent(app);
  const res = await login(agent, 'admin', 'admin123');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
  const home = await agent.get('/');
  assert.equal(home.status, 200);
});

test('TC_LOGIN_002 错误密码提示账号或密码错误', async () => {
  const agent = makeAgent(app);
  const res = await login(agent, 'admin', 'wrongpass');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('账号或密码错误'));
});

test('TC_LOGIN_006 错误验证码提示验证码错误', async () => {
  const agent = makeAgent(app);
  const res = await agent
    .post('/auth/login')
    .set('X-Test-Captcha', 'test')
    .type('form')
    .send({ username: 'admin', password: 'admin123', captcha: 'wrong' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('验证码错误'));
});

test('TC_LOGIN_007 不存在的账号提示账号或密码错误', async () => {
  const agent = makeAgent(app);
  const res = await login(agent, 'nosuchuser', 'whatever');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('账号或密码错误'));
});

test('TC_LOGIN_008 禁用账号无法登录', async () => {
  db.prepare("INSERT INTO users (username, password, status) VALUES ('disabled1', '123456', 0)").run();
  const agent = makeAgent(app);
  const res = await login(agent, 'disabled1', '123456');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('账号已被禁用'));
});

test('TC_LOGIN_011 SQL 注入不生效', async () => {
  const agent = makeAgent(app);
  const res = await login(agent, "' OR '1'='1", 'x');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('账号或密码错误'));
  assert.ok(!res.headers.location, '不应跳转');
});

test('TC_LOGIN_012 XSS 输入被转义不触发脚本', async () => {
  const agent = makeAgent(app);
  const res = await login(agent, '<script>alert(1)</script>', 'x');
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes('<script>alert(1)</script>'), '响应不应包含原始脚本标签');
});

test('TC_LOGIN_009 用户名前后空格不被 trim（视为不同账号）', async () => {
  await registerUser(makeAgent(app), 'testuser', '123456');
  const agent = makeAgent(app);
  const res = await login(agent, ' testuser ', '123456');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('账号或密码错误'));
});

test('TC_LOGIN_010 特殊字符密码可登录', async () => {
  await registerUser(makeAgent(app), 'specuser', 'p@ss#word!');
  const agent = makeAgent(app);
  const res = await login(agent, 'specuser', 'p@ss#word!');
  assert.equal(res.status, 302);
});

test('TC_LOGIN_013 连续 5 次错误密码锁定 30 分钟', async () => {
  await registerUser(makeAgent(app), 'lockuser', '123456');
  const agent = makeAgent(app);
  for (let i = 1; i <= 4; i++) {
    const r = await login(agent, 'lockuser', 'badpass');
    assert.ok(r.text.includes('账号或密码错误'), `第${i}次应提示密码错误`);
  }
  const fifth = await login(agent, 'lockuser', 'badpass');
  assert.equal(fifth.status, 200);
  assert.ok(fifth.text.includes('锁定'), '第 5 次失败应提示锁定');
});

test('TC_LOGIN_014 锁定期间正确密码也无法登录', async () => {
  await registerUser(makeAgent(app), 'lockuser2', '123456');
  const agent = makeAgent(app);
  for (let i = 0; i < 5; i++) {
    await login(agent, 'lockuser2', 'badpass');
  }
  const res = await login(agent, 'lockuser2', '123456');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('账号已锁定'), '锁定期间正确密码也应被拒');
});

test('TC_LOGIN_016 第 4 次错误第 5 次正确不锁定', async () => {
  await registerUser(makeAgent(app), 'fouruser', '123456');
  const agent = makeAgent(app);
  for (let i = 0; i < 4; i++) {
    await login(agent, 'fouruser', 'badpass');
  }
  const res = await login(agent, 'fouruser', '123456');
  assert.equal(res.status, 302);
  const row = db.prepare('SELECT login_fails, locked_until FROM users WHERE username = ?').get('fouruser');
  assert.equal(row.login_fails, 0);
  assert.equal(row.locked_until, null);
});

test('TC_LOGIN_015 锁定到期后自动解锁', async () => {
  await registerUser(makeAgent(app), 'unlockuser', '123456');
  const agent = makeAgent(app);
  for (let i = 0; i < 5; i++) {
    await login(agent, 'unlockuser', 'badpass');
  }
  db.prepare("UPDATE users SET locked_until = '2000-01-01T00:00:00.000Z' WHERE username = 'unlockuser'").run();
  const res = await login(agent, 'unlockuser', '123456');
  assert.equal(res.status, 302, '锁定到期后应可登录');
});

test('TC_LOGIN_017 验证码接口返回 SVG', async () => {
  const agent = makeAgent(app);
  const res = await agent.get('/auth/captcha');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'] || '', /svg/i);
  const body = res.text || res.body.toString();
  assert.ok(body.startsWith('<svg'), '响应应为 SVG 内容');
});

test('TC_LOGIN_018 已登录访问登录页重定向首页', async () => {
  const agent = makeAgent(app);
  await login(agent, 'admin', 'admin123');
  const res = await agent.get('/auth/login');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
});

test('TC_REG_001 正常注册跳转登录页', async () => {
  const agent = makeAgent(app);
  const res = await registerUser(agent, 'test001', '123456');
  assert.equal(res.status, 302);
  assert.ok(res.headers.location.includes('/auth/login'));
});

test('TC_REG_002 重复账号注册被拒', async () => {
  await registerUser(makeAgent(app), 'dupuser', '123456');
  const res = await registerUser(makeAgent(app), 'dupuser', '123456');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('该账号已被注册'));
});

test('TC_REG_003 两次密码不一致被拒', async () => {
  const agent = makeAgent(app);
  const res = await agent.post('/auth/register').type('form')
    .send({ username: 'mismatch', password: '123456', password2: '654321', realname: '', email: '' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('两次密码输入不一致'));
});

test('TC_REG_004 账号 3 位注册成功', async () => {
  const res = await registerUser(makeAgent(app), 'abc', '123456');
  assert.equal(res.status, 302);
});

test('TC_REG_006 账号 2 位注册失败', async () => {
  const res = await registerUser(makeAgent(app), 'ab', '123456');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('账号长度需在3-20位之间'));
});

test('TC_REG_008 密码 6 位注册成功', async () => {
  const res = await registerUser(makeAgent(app), 'sixuser', '123456');
  assert.equal(res.status, 302);
});

test('TC_REG_009 密码 5 位注册失败', async () => {
  const agent = makeAgent(app);
  const res = await agent.post('/auth/register').type('form')
    .send({ username: 'shortpw', password: '12345', password2: '12345', realname: '', email: '' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('密码长度需在6-20位之间'));
});

test('TC_REG_010/011 空账号或空密码被拒', async () => {
  const agent = makeAgent(app);
  const res1 = await agent.post('/auth/register').type('form')
    .send({ username: '', password: '123456', password2: '123456', realname: '', email: '' });
  assert.equal(res1.status, 200);
  assert.ok(res1.text.includes('账号和密码不能为空'));
  const res2 = await agent.post('/auth/register').type('form')
    .send({ username: 'emptyuser', password: '', password2: '', realname: '', email: '' });
  assert.equal(res2.status, 200);
  assert.ok(res2.text.includes('账号和密码不能为空'));
});

test('未登录访问受保护页面重定向到登录页', async () => {
  const agent = makeAgent(app);
  const res = await agent.get('/borrow');
  assert.equal(res.status, 302);
  assert.ok(res.headers.location.includes('/auth/login'));
});
