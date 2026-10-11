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

const MAX_BOOK_COUNT = 99999;

function parseBookCount(v) {
  if (typeof v !== 'string' || !/^\d{1,5}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return (n >= 1 && n <= MAX_BOOK_COUNT) ? n : null;
}

router.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 12;
  const offset = (page - 1) * limit;
  const keyword = req.query.keyword || '';
  const category = req.query.category || '';

  let sql = 'SELECT b.*, c.name as category_name FROM books b LEFT JOIN categories c ON b.category_id = c.id WHERE 1=1';
  const params = [];

  if (keyword) {
    sql += ' AND (b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (category) {
    sql += ' AND b.category_id = ?';
    params.push(category);
  }

  const countSql = sql.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as total FROM');
  const total = db.prepare(countSql).get(...params).total;

  sql += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const books = db.prepare(sql).all(...params);
  const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
  const totalPages = Math.ceil(total / limit);

  res.render('books/list', {
    title: '图书管理',
    books,
    categories,
    keyword,
    category,
    page,
    totalPages,
    total
  });
});

router.get('/add', requireAdmin, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
  res.render('books/edit', { title: '新增图书', book: null, categories });
});

router.post('/add', requireAdmin, (req, res) => {
  const { isbn, title, author, publisher, publish_date, category_id, total_count, description } = req.body;
  if (!title || !author) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
    return res.render('books/edit', { title: '新增图书', book: req.body, categories, error: '书名和作者不能为空' });
  }

  const total = parseBookCount(total_count);
  if (total === null) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
    return res.render('books/edit', { title: '新增图书', book: req.body, categories, error: `入库数量必须为 1-${MAX_BOOK_COUNT} 的整数` });
  }

  db.prepare(`INSERT INTO books (isbn, title, author, publisher, publish_date, category_id, total_count, remain_count, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(isbn, title, author, publisher, publish_date, category_id || null, total, total, description);

  addLog(req.session.user.id, 'BOOK_ADD', `新增图书: ${title}`);
  res.redirect('/books');
});

router.get('/edit/:id', requireAdmin, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).send('图书不存在');
  const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
  res.render('books/edit', { title: '修改图书', book, categories });
});

router.post('/edit/:id', requireAdmin, (req, res) => {
  const { isbn, title, author, publisher, publish_date, category_id, total_count, description } = req.body;
  if (!title || !author) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
    return res.render('books/edit', { title: '修改图书', book: { ...req.body, id: req.params.id }, categories, error: '书名和作者不能为空' });
  }

  const oldBook = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  const total = parseBookCount(total_count);
  if (total === null) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
    return res.render('books/edit', { title: '修改图书', book: { ...req.body, id: req.params.id }, categories, error: `入库数量必须为 1-${MAX_BOOK_COUNT} 的整数` });
  }
  const borrowed = oldBook.total_count - oldBook.remain_count;
  const remain = Math.max(0, total - borrowed);

  db.prepare(`UPDATE books SET isbn=?, title=?, author=?, publisher=?, publish_date=?, category_id=?, total_count=?, remain_count=?, description=? WHERE id=?`)
    .run(isbn, title, author, publisher, publish_date, category_id || null, total, remain, description, req.params.id);

  addLog(req.session.user.id, 'BOOK_EDIT', `修改图书: ${title}`);
  res.redirect('/books');
});

router.get('/delete/:id', requireAdmin, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).send('图书不存在');

  const active = db.prepare("SELECT COUNT(*) as cnt FROM borrow_records WHERE book_id = ? AND status = 'borrowed'").get(req.params.id);
  if (active.cnt > 0) return res.send('<script>alert("该图书尚有借阅记录未归还，无法删除");history.back()</script>');

  db.prepare('UPDATE books SET status = 0 WHERE id = ?').run(req.params.id);
  addLog(req.session.user.id, 'BOOK_DELETE', `删除图书: ${book.title}`);
  res.redirect('/books');
});

router.get('/detail/:id', (req, res) => {
  const book = db.prepare('SELECT b.*, c.name as category_name FROM books b LEFT JOIN categories c ON b.category_id = c.id WHERE b.id = ?').get(req.params.id);
  if (!book) return res.status(404).send('图书不存在');
  res.render('books/detail', { title: book.title, book });
});

module.exports = router;
