const express = require('express');
const router = express.Router();
const { db, addLog } = require('../database');
const { verifyPassword, hashPassword } = require('../lib/password');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  if (req.session.user.role !== 'admin') return res.status(403).send('无权限访问');
  next();
}

router.get('/profile', requireLogin, (req, res) => {
  const user = db.prepare('SELECT id, username, realname, email, phone, role, created_at FROM users WHERE id = ?').get(req.session.user.id);
  res.render('layout', { view: 'user/profile', title: '个人信息', user, error: null, success: null });
});

router.post('/profile', requireLogin, (req, res) => {
  const { realname, email, phone } = req.body;

  if (!/^\d{0,11}$/.test(phone)) {
    const user = db.prepare('SELECT id, username, realname, email, phone, role, created_at FROM users WHERE id = ?').get(req.session.user.id);
    return res.render('layout', { view: 'user/profile', title: '个人信息', user, error: '手机号格式不正确', success: null });
  }

  db.prepare('UPDATE users SET realname=?, email=?, phone=? WHERE id=?').run(realname, email, phone, req.session.user.id);
  req.session.user.realname = realname;
  addLog(req.session.user.id, 'UPDATE_PROFILE', '修改个人信息');

  const user = db.prepare('SELECT id, username, realname, email, phone, role, created_at FROM users WHERE id = ?').get(req.session.user.id);
  res.render('layout', { view: 'user/profile', title: '个人信息', user, error: null, success: '修改成功' });
});

router.get('/password', requireLogin, (req, res) => {
  res.render('layout', { view: 'user/password', title: '修改密码', error: null, success: null });
});

router.post('/password', requireLogin, (req, res) => {
  const { oldPassword, newPassword, newPassword2 } = req.body;

  if (!oldPassword || !newPassword) {
    return res.render('layout', { view: 'user/password', title: '修改密码', error: '密码不能为空', success: null });
  }
  if (newPassword.length < 6 || newPassword.length > 20) {
    return res.render('layout', { view: 'user/password', title: '修改密码', error: '新密码长度需在6-20位之间', success: null });
  }
  if (newPassword !== newPassword2) {
    return res.render('layout', { view: 'user/password', title: '修改密码', error: '两次密码输入不一致', success: null });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!verifyPassword(oldPassword, user.password).valid) {
    return res.render('layout', { view: 'user/password', title: '修改密码', error: '原密码错误', success: null });
  }

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(newPassword), req.session.user.id);
  addLog(req.session.user.id, 'CHANGE_PASSWORD', '修改密码');
  res.render('layout', { view: 'user/password', title: '修改密码', error: null, success: '密码修改成功' });
});

router.get('/list', requireAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as total FROM users').get().total;
  const users = db.prepare('SELECT id, username, realname, email, phone, role, status, created_at, login_fails FROM users ORDER BY id LIMIT ? OFFSET ?').all(limit, offset);
  const totalPages = Math.ceil(total / limit);

  res.render('layout', { view: 'user/list', title: '用户管理', users, page, totalPages, total });
});

router.post('/toggle/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ ok: false, msg: '用户不存在' });
  if (user.role === 'admin') return res.status(400).json({ ok: false, msg: '不能禁用管理员账号' });

  const newStatus = user.status === 1 ? 0 : 1;
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, req.params.id);
  addLog(req.session.user.id, 'USER_TOGGLE', `${newStatus === 1 ? '启用' : '禁用'}用户: ${user.username}`);
  res.json({ ok: true, msg: newStatus === 1 ? '已启用' : '已禁用' });
});

module.exports = router;
