const express = require('express');
const router = express.Router();
const { db, addLog } = require('../database');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  if (req.session.user.role !== 'admin') return res.status(403).send('无权限访问');
  next();
}

function formatLocalDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

router.get('/', requireLogin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';

  const baseSelect = `SELECT br.*, b.title as book_title, b.isbn, u.username, u.realname
    FROM borrow_records br
    JOIN books b ON br.book_id = b.id
    JOIN users u ON br.user_id = u.id`;
  let whereSql = 'WHERE 1=1';
  const params = [];

  if (req.session.user.role !== 'admin') {
    whereSql += ' AND br.user_id = ?';
    params.push(req.session.user.id);
  }
  if (status) {
    whereSql += ' AND br.status = ?';
    params.push(status);
  }

  const countSql = `SELECT COUNT(*) as total FROM borrow_records br
    JOIN books b ON br.book_id = b.id
    JOIN users u ON br.user_id = u.id ${whereSql}`;
  const total = db.prepare(countSql).get(...params).total;

  const records = db.prepare(`${baseSelect} ${whereSql} ORDER BY br.borrow_date DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const totalPages = Math.ceil(total / limit);

  res.render('borrow/list', {
    title: '借阅记录',
    records,
    status,
    page,
    totalPages,
    total
  });
});

router.post('/borrow/:bookId', requireLogin, (req, res) => {
  const bookId = req.params.bookId;
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND status = 1').get(bookId);
  if (!book) return res.status(404).json({ ok: false, msg: '图书不存在' });
  if (book.remain_count <= 0) return res.status(400).json({ ok: false, msg: '该书已全部借出' });

  const alreadyBorrowed = db.prepare("SELECT id FROM borrow_records WHERE user_id = ? AND book_id = ? AND status = 'borrowed'").get(req.session.user.id, bookId);
  if (alreadyBorrowed) return res.status(400).json({ ok: false, msg: '您已借过该书，请先归还' });

  const overdueCount = db.prepare("SELECT COUNT(*) as cnt FROM borrow_records WHERE user_id = ? AND status = 'borrowed' AND due_date < datetime('now','localtime')").get(req.session.user.id);
  if (overdueCount.cnt > 0) return res.status(400).json({ ok: false, msg: '您有逾期未还的图书，请先归还后再借' });

  const dueDateStr = formatLocalDateTime(new Date(Date.now() + 30 * 86400000));

  db.prepare('INSERT INTO borrow_records (user_id, book_id, due_date) VALUES (?, ?, ?)').run(req.session.user.id, bookId, dueDateStr);
  db.prepare('UPDATE books SET remain_count = remain_count - 1 WHERE id = ?').run(bookId);

  addLog(req.session.user.id, 'BORROW', `借阅图书: ${book.title}`);
  res.json({ ok: true, msg: '借阅成功' });
});

router.post('/return/:recordId', requireLogin, (req, res) => {
  const record = db.prepare('SELECT br.*, b.title FROM borrow_records br JOIN books b ON br.book_id = b.id WHERE br.id = ?').get(req.params.recordId);
  if (!record) return res.status(404).json({ ok: false, msg: '借阅记录不存在' });
  if (record.status === 'returned') return res.status(400).json({ ok: false, msg: '该书已归还' });
  if (record.user_id !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).json({ ok: false, msg: '无权限' });
  }

  db.prepare("UPDATE borrow_records SET status = 'returned', return_date = datetime('now','localtime') WHERE id = ?").run(req.params.recordId);
  db.prepare('UPDATE books SET remain_count = remain_count + 1 WHERE id = ?').run(record.book_id);

  addLog(req.session.user.id, 'RETURN', `归还图书: ${record.title}`);
  res.json({ ok: true, msg: '归还成功' });
});

router.get('/overdue', requireLogin, (req, res) => {
  let sql = `SELECT br.*, b.title as book_title, u.username, u.realname
    FROM borrow_records br JOIN books b ON br.book_id = b.id
    JOIN users u ON br.user_id = u.id
    WHERE br.status = 'borrowed' AND br.due_date < datetime('now','localtime')`;
  if (req.session.user.role !== 'admin') {
    sql += ' AND br.user_id = ?';
    const records = db.prepare(sql).all(req.session.user.id);
    return res.render('borrow/overdue', { title: '逾期提醒', records });
  }
  const records = db.prepare(sql).all();
  res.render('borrow/overdue', { title: '逾期提醒', records });
});

module.exports = router;
