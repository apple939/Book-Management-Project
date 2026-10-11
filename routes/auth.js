const express = require('express');
const router = express.Router();
const { db, addLog } = require('../database');
const svgCaptcha = require('svg-captcha');
const { verifyPassword, hashPassword } = require('../lib/password');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: '用户登录', error: null });
});

router.post('/login', (req, res) => {
  const { username, password, captcha } = req.body;

  if (!captcha || captcha.toLowerCase() !== (req.session.captcha || '').toLowerCase()) {
    return res.render('login', { title: '用户登录', error: '验证码错误' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.render('login', { title: '用户登录', error: '账号或密码错误' });
  }

  if (user.status === 0) {
    return res.render('login', { title: '用户登录', error: '账号已被禁用' });
  }

  if (user.locked_until) {
    const lockTime = new Date(user.locked_until);
    if (new Date() < lockTime) {
      const minutes = Math.ceil((lockTime - new Date()) / 60000);
      return res.render('login', { title: '用户登录', error: `账号已锁定，请${minutes}分钟后重试` });
    }
    db.prepare('UPDATE users SET login_fails = 0, locked_until = NULL WHERE id = ?').run(user.id);
  }

  const verify = verifyPassword(password, user.password);
  if (!verify.valid) {
    const fails = user.login_fails + 1;
    if (fails >= 5) {
      const lockUntil = new Date(Date.now() + 30 * 60000).toISOString();
      db.prepare('UPDATE users SET login_fails = ?, locked_until = ? WHERE id = ?').run(fails, lockUntil, user.id);
      addLog(user.id, 'LOGIN_LOCKED', `账号因5次登录失败被锁定30分钟`);
      return res.render('login', { title: '用户登录', error: '连续输错5次密码，账号已锁定30分钟' });
    }
    db.prepare('UPDATE users SET login_fails = ? WHERE id = ?').run(fails, user.id);
    return res.render('login', { title: '用户登录', error: `账号或密码错误，剩余尝试${5 - fails}次` });
  }

  db.prepare('UPDATE users SET login_fails = 0, locked_until = NULL WHERE id = ?').run(user.id);
  if (verify.needsUpgrade) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), user.id);
    addLog(user.id, 'PASSWORD_UPGRADED', '密码已从明文透明升级为 bcrypt 哈希');
  }
  req.session.user = { id: user.id, username: user.username, realname: user.realname, role: user.role };
  addLog(user.id, 'LOGIN_SUCCESS', '登录成功');
  res.redirect('/');
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { title: '用户注册', error: null });
});

router.post('/register', (req, res) => {
  const { username, password, password2, realname, email } = req.body;

  if (!username || !password) {
    return res.render('register', { title: '用户注册', error: '账号和密码不能为空' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.render('register', { title: '用户注册', error: '账号长度需在3-20位之间' });
  }
  if (password.length < 6 || password.length > 20) {
    return res.render('register', { title: '用户注册', error: '密码长度需在6-20位之间' });
  }
  if (password !== password2) {
    return res.render('register', { title: '用户注册', error: '两次密码输入不一致' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.render('register', { title: '用户注册', error: '该账号已被注册' });
  }

  db.prepare('INSERT INTO users (username, password, realname, email) VALUES (?, ?, ?, ?)').run(
    username, hashPassword(password), realname || '', email || ''
  );
  addLog(null, 'REGISTER', `新用户注册: ${username}`);
  res.redirect('/auth/login?registered=1');
});

router.get('/captcha', (req, res) => {
  const captcha = svgCaptcha.create({ size: 4, noise: 3, color: true, background: '#f0f0f0' });
  req.session.captcha = captcha.text;
  res.type('svg');
  res.send(captcha.data);
});

module.exports = router;
